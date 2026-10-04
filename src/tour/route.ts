/**
 * Route compiler (S5): data/tour/route.json v2 → CompiledRoute (world units, draped, arc length s).
 *
 *  - foot / underground legs: centripetal Catmull-Rom through the leg's points (neighbours from the adjacent
 *    legs, so joins stay smooth), resampled uniformly by arc length (spacingKm ≈ 0.25 km);
 *  - boat legs on a river: the leg's ends are projected onto the river's SEGMENTS; the path runs start →
 *    projection → the river centreline → projection → end at the interpolated baked water level (`level[]`);
 *  - boat legs on a lake: the chord between the points at the lake level;
 *  - heights: foot / underground samples stand on the water-aware surface (ground, sea at 0, river ribbons at
 *    their level, lakes at theirs) under their own centre, raised by a slope-limited across envelope: taps at
 *    ±0.05 / ±0.1 / ±0.2 km count only where the bank rises faster than 1 km/km (H(o) − |o|), and the raise
 *    is capped at 0.1 km — the exaggerated relief puts 1–2 km cliffs within 0.2 km of the path, and the line
 *    must hug the ground under it, not float at the cliff top (the film's ribbon is screen-space wide and
 *    pulled toward the camera, so its edges need no geometric margin). Boat samples ride max(water level,
 *    ground). Then a chord pass lifts both ends of any segment whose straight chord dips under the surface
 *    between the samples (probes at 1/8 steps) by exactly that deficit — crests between samples never cut
 *    the line. Everything + liftKm. The line never dips under water at a river crossing nor sinks into a bank.
 * Marks stay at the place points (place ids, explicit `mark`s, `<leg>:start` / `<leg>:end`).
 * Pure (no three.js render objects, no DOM): Node and the page compile identical routes.
 */
import type { World } from '../world/World.ts';
import { fnv1a } from './hash.ts';
import { ROUTE_MODE, type CompiledRoute, type RouteJson, type RouteLegJson, type RouteMode, type RoutePointJson } from './schema.ts';

export const ROUTE_COMPILER = 'route-v2';

/**
 * The drape (foot / underground samples): across-envelope tap offsets (km), the bank slope below which a tap
 * never raises the line (km/km), the cap on the raise above the centre's own surface (km), and the chord
 * probes per segment (the straight chord between two samples never dips under the surface).
 */
export const DRAPE = { acrossKm: [0.05, 0.1, 0.2], slope: 1, capKm: 0.1, chordProbes: 8 } as const;
/** a sample floating more than this above its own centre's surface is reported (routeReport), km */
export const FLOAT_WARN_KM = 0.3;

interface PolyPt {
  x: number;
  z: number;
  /** water surface the sample rides (river legs) or NaN = drape on the surface envelope */
  y: number;
  /** lake legs: ride the water-aware surface under the sample itself (lake / river level, else the ground) */
  surf?: boolean;
  mode: number;
  leg: number;
  /** mark name at this vertex */
  mark?: string;
}

// ───────────────────────────── numeric hashing ─────────────────────────────

/** FNV-1a over numbers quantised to `quantum` (compiled-data hashes: Node and the page must agree). */
export function hashFloats(h: number, values: ArrayLike<number>, quantum = 1e-4): number {
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const q = Number.isFinite(v) ? Math.round(v / quantum) : 0x7fffffff;
    // fold the integer (up to ±2^53) as two 26-bit halves, 16 bits at a time
    const lo = (q % 67108864) | 0;
    const hi = ((q - (q % 67108864)) / 67108864) | 0;
    h = Math.imul(h ^ (lo & 0xffff), 0x01000193) >>> 0;
    h = Math.imul(h ^ ((lo >>> 16) & 0xffff), 0x01000193) >>> 0;
    h = Math.imul(h ^ (hi & 0xffff), 0x01000193) >>> 0;
    h = Math.imul(h ^ ((hi >>> 16) & 0xffff), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ───────────────────────────── the water-aware surface ─────────────────────────────

/** The surface the route and the camera rig stand on: ground, the sea plane, river ribbons and lakes. */
export interface WaterField {
  /** water surface at (x, z): a river ribbon's level or a lake's level, else −Infinity (the sea is in `surface`) */
  level(x: number, z: number): number;
  /** max(ground, 0 = the sea plane, water level) */
  surface(x: number, z: number): number;
}

function insideRing(r: readonly (readonly [number, number])[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

const RIVER_CELL = 2;
/** floats per river segment record */
const SEG = 8;
const fields = new WeakMap<World, WaterField>();

/** Drop a World's cached water field (the film check's second compile then builds a fresh one). */
export function forgetWaterField(world: World): void {
  fields.delete(world);
}

/** The world's water field (built once per World and shared by the route compiler and the rig). */
export function waterField(world: World): WaterField {
  const cached = fields.get(world);
  if (cached) return cached;
  const R = world.spec.json.rivers as { ribbonScale?: number; ribbonMarginKm?: number };
  const scale = R.ribbonScale ?? 1;
  const margin = R.ribbonMarginKm ?? 0.1;
  // river segments: x0, z0, x1, z1, level0, level1, half width², line index — bucketed in a dense 2 km grid
  // (CSR: cellStart / cellSegs), each segment in every cell its ribbon box overlaps
  const seg: number[] = [];
  const GW = Math.ceil((world.spec.xMax - world.spec.xMin) / RIVER_CELL) + 1;
  const GH = Math.ceil((world.spec.zMax - world.spec.zMin) / RIVER_CELL) + 1;
  const cellOf = (x: number, z: number): number => {
    const i = Math.floor((x - world.spec.xMin) / RIVER_CELL);
    const j = Math.floor((z - world.spec.zMin) / RIVER_CELL);
    return i < 0 || j < 0 || i >= GW || j >= GH ? -1 : j * GW + i;
  };
  const pairs: number[] = [];
  world.rivers.forEach((r, line) => {
    // the runtime ribbon half width (src/water/rivers.ts ribbonHalfWidth): never inside the carved core
    const hw = Math.max((scale * r.widthKm) / 2, Math.max(r.widthKm / 2, 0.5) + margin);
    const lev = r.level ?? r.points.map((p) => world.heights.sample(p[0], p[1], 'base'));
    for (let i = 0; i + 1 < r.points.length; i++) {
      const [x0, z0] = r.points[i];
      const [x1, z1] = r.points[i + 1];
      const id = seg.length / SEG;
      seg.push(x0, z0, x1, z1, lev[i], lev[i + 1], hw * hw, line);
      const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - hw - world.spec.xMin) / RIVER_CELL));
      const i1 = Math.min(GW - 1, Math.floor((Math.max(x0, x1) + hw - world.spec.xMin) / RIVER_CELL));
      const j0 = Math.max(0, Math.floor((Math.min(z0, z1) - hw - world.spec.zMin) / RIVER_CELL));
      const j1 = Math.min(GH - 1, Math.floor((Math.max(z0, z1) + hw - world.spec.zMin) / RIVER_CELL));
      for (let b = j0; b <= j1; b++) for (let a = i0; a <= i1; a++) pairs.push(b * GW + a, id);
    }
  });
  const cellStart = new Int32Array(GW * GH + 1);
  for (let k = 0; k < pairs.length; k += 2) cellStart[pairs[k] + 1]++;
  for (let c = 0; c < GW * GH; c++) cellStart[c + 1] += cellStart[c];
  const cellSegs = new Int32Array(pairs.length / 2);
  const fill = cellStart.slice(0, GW * GH);
  for (let k = 0; k < pairs.length; k += 2) cellSegs[fill[pairs[k]]++] = pairs[k + 1];
  const S = Float64Array.from(seg);
  const lakes = world.lakes
    .filter((l) => l.level !== null)
    .map((l) => {
      const xs = l.ring.map((p) => p[0]);
      const zs = l.ring.map((p) => p[1]);
      return { ring: l.ring, level: l.level as number, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    });
  // per query: the nearest covering segment of each river line (a line's ribbon carries the level of its
  // nearest centreline point — the max over a steep reach would lift the water by the upstream levels)
  const hitLine: number[] = [];
  const hitD2: number[] = [];
  const hitLev: number[] = [];
  const level = (x: number, z: number): number => {
    let n = 0;
    const cell = cellOf(x, z);
    if (cell >= 0)
      for (let q = cellStart[cell]; q < cellStart[cell + 1]; q++) {
        const o = cellSegs[q] * SEG;
        const ax = S[o];
        const az = S[o + 1];
        const dx = S[o + 2] - ax;
        const dz = S[o + 3] - az;
        const l2 = dx * dx + dz * dz;
        const u = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
        const ex = ax + dx * u - x;
        const ez = az + dz * u - z;
        const d2 = ex * ex + ez * ez;
        if (d2 > S[o + 6]) continue;
        const line = S[o + 7];
        const lv = S[o + 4] + (S[o + 5] - S[o + 4]) * u;
        let j = 0;
        while (j < n && hitLine[j] !== line) j++;
        if (j === n) {
          hitLine[n] = line;
          hitD2[n] = d2;
          hitLev[n] = lv;
          n++;
        } else if (d2 < hitD2[j]) {
          hitD2[j] = d2;
          hitLev[j] = lv;
        }
      }
    let best = -Infinity;
    for (let j = 0; j < n; j++) if (hitLev[j] > best) best = hitLev[j];
    for (const l of lakes) if (x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1 && l.level > best && insideRing(l.ring, x, z)) best = l.level;
    return best;
  };
  const f: WaterField = { level, surface: (x, z) => Math.max(world.heights.sample(x, z), 0, level(x, z)) };
  fields.set(world, f);
  return f;
}

// ───────────────────────────── legs → polyline ─────────────────────────────

/** World XZ of a route point (place display position + offset, or ME-GIS km). */
export function routePointXZ(world: World, p: RoutePointJson): [number, number] {
  if (p.place) {
    const q = world.place(p.place);
    const [e, n] = p.offsetKm ?? [0, 0];
    return [q.x + e, q.z - n];
  }
  if (p.at) return world.spec.kmToWorld(p.at[0], p.at[1]);
  throw new Error('route point needs place or at');
}

const markOf = (p: RoutePointJson): string | undefined => p.mark ?? p.place;

/** Centripetal Catmull-Rom (α = 0.5) through p1..p2 with neighbours p0, p3; n steps, excluding p2. */
function catmullRom(p0: number[], p1: number[], p2: number[], p3: number[], n: number, out: number[][]): void {
  const d = (a: number[], b: number[]) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  for (let k = 0; k < n; k++) {
    const t = t1 + ((t2 - t1) * k) / n;
    const pt = [0, 1].map((c) => {
      const a1 = ((t1 - t) / (t1 - t0)) * p0[c] + ((t - t0) / (t1 - t0)) * p1[c];
      const a2 = ((t2 - t) / (t2 - t1)) * p1[c] + ((t - t1) / (t2 - t1)) * p2[c];
      const a3 = ((t3 - t) / (t3 - t2)) * p2[c] + ((t - t2) / (t3 - t2)) * p3[c];
      const b1 = ((t2 - t) / (t2 - t0)) * a1 + ((t - t0) / (t2 - t0)) * a2;
      const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3;
      return ((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2;
    });
    out.push(pt);
  }
}

/** Nearest point of a polyline to (x, z): segment index, parameter on it, distance. */
export function projectOntoPolyline(pts: readonly (readonly [number, number])[], x: number, z: number): { seg: number; u: number; dist: number } {
  let best = { seg: 0, u: 0, dist: Infinity };
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const dx = pts[i + 1][0] - ax;
    const dz = pts[i + 1][1] - az;
    const l2 = dx * dx + dz * dz;
    const u = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const d = Math.hypot(ax + dx * u - x, az + dz * u - z);
    if (d < best.dist) best = { seg: i, u, dist: d };
  }
  return best;
}

/** dry ground inside a lake: an island standing more than this above the lake level */
const ISLAND_KM = 0.05;
/** margin of a detour around an island along the chord, km */
const DETOUR_MARGIN_KM = 1.5;

/**
 * Interior points of a lake crossing a → b at `spacing`: the straight chord, or — when the chord crosses an
 * island inside the lake (Tol Brandir) — the chord bent sideways by the smallest sin² bump that keeps every
 * sample inside the lake on the water.
 */
function lakeChord(world: World, ring: [number, number][], level: number, a: [number, number], b: [number, number], spacing: number): [number, number][] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(2, Math.ceil(len / spacing));
  const nx = -(b[1] - a[1]) / Math.max(len, 1e-9);
  const nz = (b[0] - a[0]) / Math.max(len, 1e-9);
  const path = (d: number, ua: number, ub: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let k = 1; k < n; k++) {
      const u = k / n;
      const v = ub > ua ? Math.min(1, Math.max(0, (u - ua) / (ub - ua))) : 0;
      const bump = Math.sin(Math.PI * v) ** 2;
      out.push([a[0] + (b[0] - a[0]) * u + nx * d * bump, a[1] + (b[1] - a[1]) * u + nz * d * bump]);
    }
    return out;
  };
  const dry = (pts: [number, number][]) => pts.map((p) => insideRing(ring, p[0], p[1]) && world.heights.sample(p[0], p[1]) > level + ISLAND_KM);
  const chord = path(0, 0, 0);
  const wet = dry(chord);
  const first = wet.indexOf(true);
  if (first < 0) return chord;
  const last = wet.lastIndexOf(true);
  const m = DETOUR_MARGIN_KM / len;
  const ua = Math.max(0, (first + 1) / n - m);
  const ub = Math.min(1, (last + 1) / n + m);
  for (let k = 1; k <= 16; k++)
    for (const d of [0.5 * k, -0.5 * k]) {
      const p = path(d, ua, ub);
      if (!dry(p).some(Boolean)) return p;
    }
  return chord;
}

function legPolyline(world: World, legs: RouteLegJson[], li: number, spacing: number): PolyPt[] {
  const leg = legs[li];
  const mode: RouteMode = leg.mode ?? 'foot';
  const code = ROUTE_MODE[mode];
  const ctrl = leg.points.map((p) => routePointXZ(world, p));
  const out: PolyPt[] = [];
  const first = leg.points[0];
  const last = leg.points[leg.points.length - 1];
  if (mode === 'boat' && leg.river) {
    const river = world.rivers.find((r) => r.id === leg.river);
    if (!river) throw new Error(`route leg ${leg.id}: unknown river '${leg.river}'`);
    const P = river.points;
    const lev = river.level ?? P.map((p) => Math.max(0, world.heights.sample(p[0], p[1], 'base')));
    const [a, b] = [ctrl[0], ctrl[ctrl.length - 1]];
    const pa = projectOntoPolyline(P, a[0], a[1]);
    const pb = projectOntoPolyline(P, b[0], b[1]);
    const at = (q: { seg: number; u: number }): [number, number, number] => {
      const i = q.seg;
      return [P[i][0] + (P[i + 1][0] - P[i][0]) * q.u, P[i][1] + (P[i + 1][1] - P[i][1]) * q.u, lev[i] + (lev[i + 1] - lev[i]) * q.u];
    };
    const [ax, az, al] = at(pa);
    const [bx, bz, bl] = at(pb);
    out.push({ x: a[0], z: a[1], y: al, mode: code, leg: li, mark: markOf(first) });
    if (Math.hypot(ax - a[0], az - a[1]) > 1e-6) out.push({ x: ax, z: az, y: al, mode: code, leg: li });
    const fa = pa.seg + pa.u;
    const fb = pb.seg + pb.u;
    if (fa <= fb) for (let i = pa.seg + 1; i <= pb.seg; i++) out.push({ x: P[i][0], z: P[i][1], y: lev[i], mode: code, leg: li });
    else for (let i = pa.seg; i >= pb.seg + 1; i--) out.push({ x: P[i][0], z: P[i][1], y: lev[i], mode: code, leg: li });
    if (Math.hypot(bx - b[0], bz - b[1]) > 1e-6) out.push({ x: bx, z: bz, y: bl, mode: code, leg: li });
    out.push({ x: b[0], z: b[1], y: bl, mode: code, leg: li, mark: markOf(last) });
    // drop zero-length steps (a projection landing on a vertex)
    return out.filter((p, i) => i === 0 || Math.hypot(p.x - out[i - 1].x, p.z - out[i - 1].z) > 1e-6 || p.mark);
  }
  if (mode === 'boat' && leg.lake) {
    const lake = world.lakes.find((l) => l.key === leg.lake);
    if (!lake || lake.level === null) throw new Error(`route leg ${leg.id}: unknown lake '${leg.lake}'`);
    leg.points.forEach((p, i) => {
      if (i > 0) for (const q of lakeChord(world, lake.ring, lake.level!, ctrl[i - 1], ctrl[i], spacing)) out.push({ x: q[0], z: q[1], y: NaN, surf: true, mode: code, leg: li });
      out.push({ x: ctrl[i][0], z: ctrl[i][1], y: NaN, surf: true, mode: code, leg: li, mark: markOf(p) });
    });
    return out;
  }
  // foot / underground: smooth curve; neighbours come from the adjacent legs so joins stay C1
  const prev = li > 0 ? legs[li - 1] : null;
  const next = li < legs.length - 1 ? legs[li + 1] : null;
  const before = prev && prev.points.length >= 2 ? routePointXZ(world, prev.points[prev.points.length - 2]) : null;
  const after = next && next.points.length >= 2 ? routePointXZ(world, next.points[1]) : null;
  const P = [before ?? [2 * ctrl[0][0] - ctrl[1][0], 2 * ctrl[0][1] - ctrl[1][1]], ...ctrl, after ?? [2 * ctrl[ctrl.length - 1][0] - ctrl[ctrl.length - 2][0], 2 * ctrl[ctrl.length - 1][1] - ctrl[ctrl.length - 2][1]]];
  for (let i = 1; i < P.length - 2; i++) {
    const seg: number[][] = [];
    const n = Math.max(2, Math.ceil(Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]) / (spacing * 0.5)));
    catmullRom(P[i - 1], P[i], P[i + 1], P[i + 2], n, seg);
    seg.forEach((q, k) => out.push({ x: q[0], z: q[1], y: NaN, mode: code, leg: li, mark: k === 0 ? markOf(leg.points[i - 1]) : undefined }));
  }
  const end = ctrl[ctrl.length - 1];
  out.push({ x: end[0], z: end[1], y: NaN, mode: code, leg: li, mark: markOf(last) });
  return out;
}

// ───────────────────────────── compile ─────────────────────────────

export function compileRoute(world: World, json: RouteJson): CompiledRoute {
  if (json.version !== 2) throw new Error(`route.json: version ${json.version} (want 2)`);
  const spacing = json.defaults.spacingKm;
  const lift = json.defaults.liftKm;
  const water = waterField(world);
  // legs chain
  for (let i = 1; i < json.legs.length; i++) {
    const [a, b] = [json.legs[i - 1].points.at(-1)!, json.legs[i].points[0]];
    const [ax, az] = routePointXZ(world, a);
    const [bx, bz] = routePointXZ(world, b);
    if (Math.hypot(ax - bx, az - bz) > 1e-6) throw new Error(`route: leg ${json.legs[i].id} does not start where ${json.legs[i - 1].id} ends`);
  }
  // one polyline (joins de-duplicated), cumulative length, marks at vertices
  const poly: PolyPt[] = [];
  json.legs.forEach((_, li) => {
    const pts = legPolyline(world, json.legs, li, spacing);
    if (poly.length) {
      const j = poly[poly.length - 1];
      if (Math.hypot(j.x - pts[0].x, j.z - pts[0].z) < 1e-6) {
        if (!j.mark && pts[0].mark) j.mark = pts[0].mark;
        pts.shift();
      }
    }
    poly.push(...pts);
  });
  const cum = new Float64Array(poly.length);
  for (let i = 1; i < poly.length; i++) cum[i] = cum[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].z - poly[i - 1].z);
  const length = cum[poly.length - 1];
  const marks: Record<string, number> = {};
  poly.forEach((p, i) => {
    if (p.mark && marks[p.mark] === undefined) marks[p.mark] = cum[i];
  });
  // leg spans: a leg starts where the previous one ends (its first vertex is the shared join)
  const legEnd = new Array<number>(json.legs.length).fill(-Infinity);
  const legStart = new Array<number>(json.legs.length).fill(Infinity);
  poly.forEach((p, i) => {
    legEnd[p.leg] = Math.max(legEnd[p.leg], cum[i]);
    legStart[p.leg] = Math.min(legStart[p.leg], cum[i]);
  });
  const legs: CompiledRoute['legs'] = json.legs.map((l, li) => ({ id: l.id, mode: l.mode ?? 'foot', s0: li > 0 ? Math.min(legStart[li], legEnd[li - 1]) : legStart[li], s1: legEnd[li] }));
  for (const l of legs) {
    marks[`${l.id}:start`] = l.s0;
    marks[`${l.id}:end`] = l.s1;
  }
  // uniform resampling by arc length
  const count = Math.max(2, Math.ceil(length / spacing) + 1);
  const step = length / (count - 1);
  const pts = new Float64Array(count * 4);
  const tan = new Float32Array(count * 2);
  const mode = new Uint8Array(count);
  const leg = new Uint16Array(count);
  const surf = new Uint8Array(count);
  let j = 0;
  for (let k = 0; k < count; k++) {
    const s = k === count - 1 ? length : step * k;
    while (j < poly.length - 2 && cum[j + 1] < s) j++;
    const a = poly[j];
    const b = poly[j + 1];
    const u = cum[j + 1] > cum[j] ? Math.min(1, Math.max(0, (s - cum[j]) / (cum[j + 1] - cum[j]))) : 0;
    pts[k * 4] = a.x + (b.x - a.x) * u;
    pts[k * 4 + 2] = a.z + (b.z - a.z) * u;
    pts[k * 4 + 3] = s;
    pts[k * 4 + 1] = Number.isNaN(a.y) || Number.isNaN(b.y) ? NaN : a.y + (b.y - a.y) * u;
    // a segment belongs to the leg of its end vertex (a leg's first vertex is the join, kept by the previous leg)
    const own = k === 0 ? a : b;
    mode[k] = own.mode;
    leg[k] = own.leg;
    surf[k] = own.surf ? 1 : 0;
  }
  for (let k = 0; k < count; k++) {
    const k0 = Math.max(0, k - 1);
    const k1 = Math.min(count - 1, k + 1);
    const dx = pts[k1 * 4] - pts[k0 * 4];
    const dz = pts[k1 * 4 + 2] - pts[k0 * 4 + 2];
    const l = Math.hypot(dx, dz) || 1;
    tan[k * 2] = dx / l;
    tan[k * 2 + 1] = dz / l;
  }
  // heights: boat samples ride their water level (never under the ground); lake samples the surface under
  // them; foot / underground samples their centre's surface + the slope-limited, capped across envelope
  const hs = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const x = pts[k * 4];
    const z = pts[k * 4 + 2];
    const yw = pts[k * 4 + 1];
    if (surf[k]) hs[k] = water.surface(x, z);
    else if (!Number.isNaN(yw)) hs[k] = Math.max(yw, world.heights.sample(x, z), 0);
    else {
      const c = water.surface(x, z);
      const tx = tan[k * 2];
      const tz = tan[k * 2 + 1];
      let raise = 0;
      for (const o of DRAPE.acrossKm)
        for (const side of [-1, 1]) raise = Math.max(raise, water.surface(x - tz * o * side, z + tx * o * side) - DRAPE.slope * o - c);
      hs[k] = c + Math.min(DRAPE.capKm, raise);
    }
  }
  // the chord pass: a segment whose straight chord dips under the surface between its samples lifts both
  // ends by the deficit (raising an end only raises the neighbouring chord, so one pass suffices)
  const deficit = new Float64Array(count);
  for (let k = 0; k + 1 < count; k++) {
    const x0 = pts[k * 4];
    const z0 = pts[k * 4 + 2];
    const dx = pts[(k + 1) * 4] - x0;
    const dz = pts[(k + 1) * 4 + 2] - z0;
    let d = 0;
    for (let q = 1; q < DRAPE.chordProbes; q++) {
      const u = q / DRAPE.chordProbes;
      d = Math.max(d, water.surface(x0 + dx * u, z0 + dz * u) - (hs[k] + (hs[k + 1] - hs[k]) * u));
    }
    deficit[k] = d;
  }
  for (let k = 0; k < count; k++) pts[k * 4 + 1] = hs[k] + Math.max(k > 0 ? deficit[k - 1] : 0, deficit[k]) + lift;
  const hash = hashFloats(hashFloats(Number.parseInt(fnv1a(`${ROUTE_COMPILER}|${JSON.stringify(json)}|${count}`), 16), pts), [length, ...Object.values(marks)]);
  return { pts, tan, mode, leg, count, length, marks, legs, hash: hash.toString(16).padStart(8, '0') };
}

/** Position on the compiled route at arc length s (linear between samples), world units. */
export function routeAt(r: CompiledRoute, s: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const f = Math.min(r.count - 1, Math.max(0, (s / r.length) * (r.count - 1)));
  const i = Math.min(r.count - 2, Math.floor(f));
  const u = f - i;
  for (let c = 0; c < 3; c++) out[c] = r.pts[i * 4 + c] + (r.pts[(i + 1) * 4 + c] - r.pts[i * 4 + c]) * u;
  return out;
}

// ───────────────────────────── diagnostics ─────────────────────────────

export interface RouteReport {
  /** pairs of arc lengths where the line crosses itself (non-adjacent samples) */
  crossings: [number, number][];
  /** sharp turns: arc length and the turn angle (degrees) between the incoming and outgoing 0.5 km chords */
  kinks: { s: number; deg: number; leg: string }[];
  /**
   * consecutive samples more than 1 km apart in height; `cliff` (with a surface): the surface under the two
   * centres steps by ≥ 75 % of it (a real cliff under the line), else the drape lifted one of them
   */
  jumps: { s: number; dy: number; leg: string; cliff?: boolean }[];
  /** largest height step between consecutive samples, km */
  maxStep: number;
  /**
   * with a surface: the line's float above the surface under each sample's own centre (y − liftKm − surface):
   * the largest, where, and the samples above FLOAT_WARN_KM per leg
   */
  float?: { max: number; s: number; leg: string; over: number; overByLeg: Record<string, number> };
}

export interface RouteReportOptions {
  kinkDeg?: number;
  jumpKm?: number;
  /** the water-aware surface (waterField(world).surface) — enables `float` and the cliff classification */
  surface?: (x: number, z: number) => number;
  /** route.json defaults.liftKm (subtracted from the float) */
  liftKm?: number;
}

/**
 * Suspicious geometry of a compiled route (self-crossings, kinks > 120° within 1 km, height jumps > 1 km;
 * with a surface: the float above the ground under the line and which jumps are cliffs).
 */
export function routeReport(r: CompiledRoute, opts: RouteReportOptions = {}): RouteReport {
  const { kinkDeg = 120, jumpKm = 1, surface, liftKm = 0 } = opts;
  const n = r.count;
  const P = r.pts;
  const step = r.length / Math.max(1, n - 1);
  const legOf = (k: number) => r.legs[r.leg[k]]?.id ?? '?';
  const ground = surface ? Float64Array.from({ length: n }, (_, k) => surface(P[k * 4], P[k * 4 + 2])) : null;
  // kinks: chords of 0.5 km either side (a 1 km window), local maxima only
  const w = Math.max(1, Math.round(0.5 / step));
  const kinks: RouteReport['kinks'] = [];
  for (let k = w; k + w < n; k++) {
    const ax = P[k * 4] - P[(k - w) * 4];
    const az = P[k * 4 + 2] - P[(k - w) * 4 + 2];
    const bx = P[(k + w) * 4] - P[k * 4];
    const bz = P[(k + w) * 4 + 2] - P[k * 4 + 2];
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    if (la < 1e-9 || lb < 1e-9) continue;
    const deg = (Math.acos(Math.min(1, Math.max(-1, (ax * bx + az * bz) / (la * lb)))) * 180) / Math.PI;
    if (deg <= kinkDeg) continue;
    const lastK = kinks[kinks.length - 1];
    if (lastK && P[k * 4 + 3] - lastK.s < 1) {
      if (deg > lastK.deg) Object.assign(lastK, { s: P[k * 4 + 3], deg });
    } else kinks.push({ s: P[k * 4 + 3], deg, leg: legOf(k) });
  }
  // height jumps
  const jumps: RouteReport['jumps'] = [];
  let maxStep = 0;
  for (let k = 0; k + 1 < n; k++) {
    const dy = P[(k + 1) * 4 + 1] - P[k * 4 + 1];
    maxStep = Math.max(maxStep, Math.abs(dy));
    if (Math.abs(dy) > jumpKm) jumps.push({ s: P[k * 4 + 3], dy, leg: legOf(k), ...(ground ? { cliff: Math.abs(ground[k + 1] - ground[k]) >= 0.75 * Math.abs(dy) } : {}) });
  }
  // the float above the surface under each centre
  let float: RouteReport['float'];
  if (ground) {
    float = { max: 0, s: 0, leg: '', over: 0, overByLeg: {} };
    for (let k = 0; k < n; k++) {
      const f = P[k * 4 + 1] - liftKm - ground[k];
      if (f > float.max) Object.assign(float, { max: f, s: P[k * 4 + 3], leg: legOf(k) });
      if (f > FLOAT_WARN_KM) {
        float.over++;
        float.overByLeg[legOf(k)] = (float.overByLeg[legOf(k)] ?? 0) + 1;
      }
    }
  }
  // self-crossings: segments hashed into a 2 km grid, non-adjacent pairs tested (each pair once)
  const cell = 2;
  const grid = new Map<string, number[]>();
  for (let k = 0; k + 1 < n; k++) {
    const x0 = Math.floor(Math.min(P[k * 4], P[(k + 1) * 4]) / cell);
    const x1 = Math.floor(Math.max(P[k * 4], P[(k + 1) * 4]) / cell);
    const z0 = Math.floor(Math.min(P[k * 4 + 2], P[(k + 1) * 4 + 2]) / cell);
    const z1 = Math.floor(Math.max(P[k * 4 + 2], P[(k + 1) * 4 + 2]) / cell);
    for (let a = x0; a <= x1; a++)
      for (let b = z0; b <= z1; b++) {
        const key = `${a},${b}`;
        const list = grid.get(key);
        if (list) list.push(k);
        else grid.set(key, [k]);
      }
  }
  const crossings: [number, number][] = [];
  const seen = new Set<string>();
  const cross = (i: number, j: number) => {
    const [ax, az, bx, bz] = [P[i * 4], P[i * 4 + 2], P[(i + 1) * 4], P[(i + 1) * 4 + 2]];
    const [cx, cz, dx, dz] = [P[j * 4], P[j * 4 + 2], P[(j + 1) * 4], P[(j + 1) * 4 + 2]];
    const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
    if (Math.abs(d) < 1e-12) return false;
    const u = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d;
    const v = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d;
    return u > 0 && u < 1 && v > 0 && v < 1;
  };
  for (const list of grid.values())
    for (let p = 0; p < list.length; p++)
      for (let q = p + 1; q < list.length; q++) {
        const i = Math.min(list[p], list[q]);
        const j = Math.max(list[p], list[q]);
        if (j - i < 3) continue;
        const key = `${i}:${j}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (cross(i, j)) crossings.push([P[i * 4 + 3], P[j * 4 + 3]]);
      }
  crossings.sort((a, b) => a[0] - b[0]);
  return { crossings, kinks, jumps, maxStep, ...(float ? { float } : {}) };
}
