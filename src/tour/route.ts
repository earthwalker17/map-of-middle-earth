/**
 * Route compiler (S5): data/tour/route.json v2 → CompiledRoute (world units, draped, arc length).
 *
 * WAVE-0 STUB (main agent): legs → control points → centripetal Catmull-Rom (foot / underground),
 * river centreline or lake chord (boat) → uniform resampling by arc length → heights. The tour agent
 * refines it (water-aware draping envelope, river projection details) behind the same signature.
 */
import type { World } from '../world/World.ts';
import { fnv1a } from './hash.ts';
import { ROUTE_MODE, type CompiledRoute, type RouteJson, type RouteLegJson, type RouteMode, type RoutePointJson } from './schema.ts';

export const ROUTE_COMPILER = 'route-v0';

interface PolyPt {
  x: number;
  z: number;
  /** fixed surface height (water legs) or NaN = drape on the ground */
  y: number;
  mode: number;
  leg: number;
  /** mark name at this vertex */
  mark?: string;
}

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

/** Closest vertex index of a polyline to (x, z). */
function nearestIndex(pts: [number, number][], x: number, z: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = (pts[i][0] - x) ** 2 + (pts[i][1] - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

function legPolyline(world: World, legs: RouteLegJson[], li: number, spacing: number): PolyPt[] {
  const leg = legs[li];
  const mode: RouteMode = leg.mode ?? 'foot';
  const code = ROUTE_MODE[mode];
  const ctrl = leg.points.map((p) => routePointXZ(world, p));
  const out: PolyPt[] = [];
  if (mode === 'boat' && leg.river) {
    const river = world.rivers.find((r) => r.id === leg.river);
    if (!river) throw new Error(`route leg ${leg.id}: unknown river '${leg.river}'`);
    const [a, b] = [ctrl[0], ctrl[ctrl.length - 1]];
    const ia = nearestIndex(river.points, a[0], a[1]);
    const ib = nearestIndex(river.points, b[0], b[1]);
    const lev = (i: number) => (river.level ? river.level[i] : Math.max(0, world.heights.sample(river.points[i][0], river.points[i][1])));
    out.push({ x: a[0], z: a[1], y: lev(ia), mode: code, leg: li, mark: markOf(leg.points[0]) });
    const step = ia <= ib ? 1 : -1;
    for (let i = ia; i !== ib; i += step) out.push({ x: river.points[i][0], z: river.points[i][1], y: lev(i), mode: code, leg: li });
    out.push({ x: b[0], z: b[1], y: lev(ib), mode: code, leg: li, mark: markOf(leg.points[leg.points.length - 1]) });
    return out;
  }
  if (mode === 'boat' && leg.lake) {
    const lake = world.lakes.find((l) => l.key === leg.lake);
    if (!lake || lake.level === null) throw new Error(`route leg ${leg.id}: unknown lake '${leg.lake}'`);
    leg.points.forEach((p, i) => out.push({ x: ctrl[i][0], z: ctrl[i][1], y: lake.level!, mode: code, leg: li, mark: markOf(p) }));
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
  const last = ctrl[ctrl.length - 1];
  out.push({ x: last[0], z: last[1], y: NaN, mode: code, leg: li, mark: markOf(leg.points[leg.points.length - 1]) });
  return out;
}

/** Ground height for the line: the upper envelope across the line (±0.2 km) so it never sinks into a bank. */
function drape(world: World, x: number, z: number, tx: number, tz: number): number {
  let h = -Infinity;
  for (const o of [-0.2, 0, 0.2]) h = Math.max(h, world.heights.sample(x - tz * o, z + tx * o));
  return Math.max(0, h);
}

export function compileRoute(world: World, json: RouteJson): CompiledRoute {
  if (json.version !== 2) throw new Error(`route.json: version ${json.version} (want 2)`);
  const spacing = json.defaults.spacingKm;
  const lift = json.defaults.liftKm;
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
  // leg spans (+ start / end marks)
  const legs: CompiledRoute['legs'] = json.legs.map((l, li) => {
    let s0 = Infinity;
    let s1 = -Infinity;
    poly.forEach((p, i) => {
      if (p.leg === li) {
        s0 = Math.min(s0, cum[i]);
        s1 = Math.max(s1, cum[i]);
      }
    });
    if (li > 0) s0 = Math.min(s0, legsEnd(li - 1));
    return { id: l.id, mode: l.mode ?? 'foot', s0, s1 };
  });
  function legsEnd(li: number): number {
    let s = -Infinity;
    poly.forEach((p, i) => p.leg === li && (s = Math.max(s, cum[i])));
    return s;
  }
  for (const l of legs) {
    marks[`${l.id}:start`] = l.s0;
    marks[`${l.id}:end`] = l.s1;
  }
  // uniform resampling by arc length
  const count = Math.max(2, Math.ceil(length / spacing) + 1);
  const pts = new Float64Array(count * 4);
  const tan = new Float32Array(count * 2);
  const mode = new Uint8Array(count);
  const leg = new Uint16Array(count);
  let j = 0;
  for (let k = 0; k < count; k++) {
    const s = (length * k) / (count - 1);
    while (j < poly.length - 2 && cum[j + 1] < s) j++;
    const a = poly[j];
    const b = poly[j + 1];
    const u = cum[j + 1] > cum[j] ? (s - cum[j]) / (cum[j + 1] - cum[j]) : 0;
    pts[k * 4] = a.x + (b.x - a.x) * u;
    pts[k * 4 + 2] = a.z + (b.z - a.z) * u;
    pts[k * 4 + 3] = s;
    pts[k * 4 + 1] = Number.isNaN(a.y) || Number.isNaN(b.y) ? NaN : a.y + (b.y - a.y) * u;
    mode[k] = u < 0.5 ? a.mode : b.mode;
    leg[k] = u < 0.5 ? a.leg : b.leg;
  }
  for (let k = 0; k < count; k++) {
    const k0 = Math.max(0, k - 1);
    const k1 = Math.min(count - 1, k + 1);
    const dx = pts[k1 * 4] - pts[k0 * 4];
    const dz = pts[k1 * 4 + 2] - pts[k0 * 4 + 2];
    const l = Math.hypot(dx, dz) || 1;
    tan[k * 2] = dx / l;
    tan[k * 2 + 1] = dz / l;
    const y = pts[k * 4 + 1];
    pts[k * 4 + 1] = (Number.isNaN(y) ? drape(world, pts[k * 4], pts[k * 4 + 2], tan[k * 2], tan[k * 2 + 1]) : y) + lift;
  }
  return { pts, tan, mode, leg, count, length, marks, legs, hash: fnv1a(`${ROUTE_COMPILER}|${JSON.stringify(json)}|${count}`) };
}

/** Position on the compiled route at arc length s (linear between samples), world units. */
export function routeAt(r: CompiledRoute, s: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const f = Math.min(r.count - 1, Math.max(0, (s / r.length) * (r.count - 1)));
  const i = Math.min(r.count - 2, Math.floor(f));
  const u = f - i;
  for (let c = 0; c < 3; c++) out[c] = r.pts[i * 4 + c] + (r.pts[(i + 1) * 4 + c] - r.pts[i * 4 + c]) * u;
  return out;
}
