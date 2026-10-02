import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from 'three/webgpu';
import type { RiverLine, World } from '../world/World.ts';
import { lakeNear, pushUpTri, type LakeInfo } from './lakes.ts';

export interface RiverBuildOptions {
  includeStreams: boolean;
  /** ribbon half width = widthKm / 2 × widthScale (world.json rivers.ribbonScale; v2: never inside the carved core) */
  widthScale: number;
  /** v2: the ribbon reaches at least this far beyond the carved core (world.json rivers.ribbonMarginKm) */
  marginKm?: number;
}

export interface RiverStats {
  lines: number;
  vertices: number;
  triangles: number;
  lengthKm: number;
  rapidKm: number;
  /** share of cross-sections whose centre vertex ends up below the ground (dry patches), % */
  dryCentrePct: number;
  /** v2: rapid (whitewater) length within ±1 km of a declared fall; `rapidKm` counts the rest */
  fallKm?: number;
  /** v2: ribbons built on baked levels (true) or the v1 runtime estimate (false) */
  baked?: boolean;
}

/** Water level above the thalweg the profile aims for (the terrain channel is carved ~0.35–0.53). */
const CLEAR = 0.18;
/** weight of the backward-max envelope in the level profile (0 = cut, 1 = fill) */
const FILL = 0.6;
/** the blended level is kept at least this far above the thalweg before smoothing … */
const KEEP_ABOVE_BED = 0.12;
/** … and never below the thalweg by less than this after smoothing */
const MIN_ABOVE_BED = 0.07;
/** per vertex: never float more than this above the ground under it … */
const MAX_ABOVE_GROUND = 0.18;
/** … and where the bank rises above the water, bury the vertex just below the ground */
const BURY = 0.08;
/** interior vertices (|across| < 1) always keep this much water over the ground: the carved channel
 * often sits on a sloped DEM valley side, so a flat level alone would leave dry, patchy reaches */
const INTERIOR_MIN = 0.1;

interface Run {
  name: string | null;
  cls: RiverLine['cls'];
  w: number;
  pts: [number, number][];
}

interface Profile {
  run: Run;
  x: Float64Array;
  z: Float64Array;
  tx: Float64Array;
  tz: Float64Array;
  s: Float64Array;
  bed: Float64Array;
  y: Float64Array;
  taper: boolean;
  startLevel: number | null;
  endFade: boolean;
}

const smooth01 = (e0: number, e1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Split a polyline into the runs that lie inside the frame. */
function clipRuns(world: World, r: RiverLine): Run[] {
  const out: Run[] = [];
  let cur: [number, number][] = [];
  const flush = () => {
    if (cur.length >= 2) out.push({ name: r.name, cls: r.cls, w: r.widthKm, pts: cur });
    cur = [];
  };
  for (const p of r.points) {
    if (world.spec.inFrame(p[0], p[1])) cur.push(p);
    else flush();
  }
  flush();
  return out;
}

function resample(pts: [number, number][], ds: number): [number, number][] {
  const out: [number, number][] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-9) continue;
    let t = ds - carry;
    while (t < L) {
      out.push([ax + ((bx - ax) * t) / L, az + ((bz - az) * t) / L]);
      t += ds;
    }
    carry = L - (t - ds);
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > ds * 0.35) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

/** Binomial smoothing of interior points (rounds polyline corners, keeps the ends). */
function smoothLine(p: [number, number][], passes: number): void {
  for (let k = 0; k < passes; k++) {
    let prev = p[0];
    for (let i = 1; i < p.length - 1; i++) {
      const cur = p[i];
      const nx = 0.25 * prev[0] + 0.5 * cur[0] + 0.25 * p[i + 1][0];
      const nz = 0.25 * prev[1] + 0.5 * cur[1] + 0.25 * p[i + 1][1];
      prev = cur;
      p[i] = [nx, nz];
    }
  }
}

/**
 * River surface ribbons: one merged mesh for every river line (streams optional).
 *  - Bake v2 (rivers.json carries per-point `level`): the ribbon runs on the processed centreline
 *    exactly as the bake carved it, flat across at the baked water level. The bake cut the channel
 *    below that level and built the banks above it, so nothing is draped or clamped here; whitewater
 *    comes only from declared falls and genuinely steep baked reaches.
 *  - v1 bakes: see buildEstimatedRivers (runtime level estimate + drape clamps).
 * Widths taper at sources, ribbons fade into the sea at mouths and into the main river at
 * confluences. Attributes: flow = (along km, across −1..1, half width km, fade),
 * flowDir = (dir.x, dir.z, rapid 0..1, lake share 0..1: 1 where a ribbon runs on into a lake, fading out
 * over LAKE_BLEND_KM of the river — the material matches the lake there).
 */
export function buildRiverGeometry(world: World, lakes: LakeInfo[], opts: RiverBuildOptions): { geometry: BufferGeometry; stats: RiverStats } {
  const baked = world.rivers.length > 0 && world.rivers.every((r) => r.level && r.level.length === r.points.length);
  return baked ? buildBakedRivers(world, lakes, opts) : buildEstimatedRivers(world, lakes, opts);
}

/**
 * v1 fallback: the level is a smoothed blend of the downhill-monotone "cut" and "fill" envelopes of
 * the thalweg (+ clearance), capped at lake-outlet / upstream-run levels; per vertex it is clamped to
 * the ground (never more than MAX_ABOVE_GROUND over it, the interior at least INTERIOR_MIN over it);
 * steep reaches of the draped surface are flagged as rapids.
 */
function buildEstimatedRivers(world: World, lakes: LakeInfo[], opts: RiverBuildOptions): { geometry: BufferGeometry; stats: RiverStats } {
  const hf = world.heights;
  const runs: Run[] = [];
  for (const r of world.rivers) {
    if (r.cls === 'stream' && !opts.includeStreams) continue;
    runs.push(...clipRuns(world, r));
  }

  // orient every run downstream (source → mouth) by comparing the ends' mean heights
  for (const r of runs) {
    const n = r.pts.length;
    const k = Math.max(1, Math.floor(n * 0.1));
    let a = 0;
    let b = 0;
    for (let i = 0; i < k; i++) {
      a += hf.sample(r.pts[i][0], r.pts[i][1]);
      b += hf.sample(r.pts[n - 1 - i][0], r.pts[n - 1 - i][1]);
    }
    if (a < b) r.pts.reverse();
  }

  const endpointsNear = (x: number, z: number, self: Run, which: 'start' | 'end' | 'any', radius: number) => {
    for (const o of runs) {
      if (o === self) continue;
      const cand = which === 'start' ? [o.pts[0]] : which === 'end' ? [o.pts[o.pts.length - 1]] : o.pts;
      for (const p of cand) if (Math.hypot(p[0] - x, p[1] - z) < radius) return o;
    }
    return null;
  };
  /** is (x, z) on (within radius of) another run's polyline? */
  const onOtherRiver = (x: number, z: number, self: Run, radius: number) => {
    for (const o of runs) {
      if (o === self) continue;
      const p = o.pts;
      for (let i = 1; i < p.length; i++) {
        const [ax, az] = p[i - 1];
        const ex = p[i][0] - ax;
        const ez = p[i][1] - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
        if (Math.hypot(x - (ax + ex * t), z - (az + ez * t)) < radius) return o;
      }
    }
    return null;
  };

  const profiles: Profile[] = [];
  for (const run of runs) {
    const w = run.w;
    const hw = (w / 2) * opts.widthScale;
    const ds = run.cls === 'stream' ? 0.6 : run.cls === 'minor' ? 0.5 : 0.45;
    const pts = resample(run.pts, ds);
    if (pts.length < 3) continue;
    smoothLine(pts, 2);
    const n = pts.length;
    const x = new Float64Array(n);
    const z = new Float64Array(n);
    const tx = new Float64Array(n);
    const tz = new Float64Array(n);
    const s = new Float64Array(n);
    const bed = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = pts[i][0];
      z[i] = pts[i][1];
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const dx = x[b] - x[a];
      const dz = z[b] - z[a];
      const L = Math.hypot(dx, dz) || 1;
      tx[i] = dx / L;
      tz[i] = dz / L;
      if (i > 0) s[i] = s[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
      // thalweg: lowest ground across the middle of the channel
      let m = Infinity;
      for (const o of [-0.35, -0.175, 0, 0.175, 0.35]) {
        const px = x[i] - tz[i] * o * hw;
        const pz = z[i] + tx[i] * o * hw;
        m = Math.min(m, hf.sample(px, pz));
      }
      bed[i] = m;
    }
    if (s[n - 1] < 1.5) continue;

    const start = run.pts[0];
    const end = run.pts[run.pts.length - 1];
    const startLake = lakeNear(lakes, start[0], start[1], 1.5);
    const endLake = lakeNear(lakes, end[0], end[1], 1.5);
    const fedByRiver = endpointsNear(start[0], start[1], run, 'end', 1.5) ?? onOtherRiver(start[0], start[1], run, 1.0);
    const continues = endpointsNear(end[0], end[1], run, 'start', 1.5);
    const joins = !continues && !endLake ? onOtherRiver(end[0], end[1], run, 2.5) : null;
    profiles.push({
      run,
      x,
      z,
      tx,
      tz,
      s,
      bed,
      y: new Float64Array(n),
      taper: !startLake && !fedByRiver,
      startLevel: startLake ? startLake.level : null,
      endFade: Boolean(joins),
    });
  }

  // water level profiles; runs fed by an upstream run start at its end level (two passes settle chains)
  const endLevel = new Map<Run, number>();
  for (let pass = 0; pass < 2; pass++) {
    for (const p of profiles) {
      const n = p.s.length;
      const target = (i: number) => {
        // close to the sea the clearance shrinks so mouths meet the sea surface
        const c = CLEAR * smooth01(0.0, 0.6, p.bed[i]) + 0.012;
        return p.bed[i] + c;
      };
      // the DEM thalweg is noisy (±0.3 after exaggeration), deeper than the carved channel: a pure
      // running minimum ("cut") leaves the water skimming the bed below every bump, a pure
      // backward maximum ("fill") floods everything upstream of a sill. Both envelopes are
      // monotone downhill, so is any blend of them; the blend is then kept a little above the
      // thalweg (bumps become gentle humps rather than dry patches).
      let cap = Infinity;
      if (p.startLevel !== null) cap = p.startLevel;
      const up = runs.find((r) => r !== p.run && endLevel.has(r) && Math.hypot(r.pts[r.pts.length - 1][0] - p.run.pts[0][0], r.pts[r.pts.length - 1][1] - p.run.pts[0][1]) < 1.5);
      if (up) cap = Math.min(cap, endLevel.get(up)!);
      const cut = new Float64Array(n);
      const fill = new Float64Array(n);
      let m = Math.min(cap, target(0));
      for (let i = 0; i < n; i++) cut[i] = m = Math.min(m, target(i));
      let M = -Infinity;
      for (let i = n - 1; i >= 0; i--) fill[i] = M = Math.max(M, target(i));
      const raw = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const blend = Math.min(cap, cut[i] + FILL * (fill[i] - cut[i]));
        raw[i] = Math.max(blend, p.bed[i] + KEEP_ABOVE_BED);
      }
      // smooth (≈ ±2 km) and re-clamp to the bed
      const r = Math.max(1, Math.round(2 / Math.max(1e-3, p.s[1] - p.s[0])));
      const pre = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + raw[i];
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - r);
        const b = Math.min(n - 1, i + r);
        const avg = (pre[b + 1] - pre[a]) / (b - a + 1);
        p.y[i] = Math.max(0.004, avg, p.bed[i] + MIN_ABOVE_BED);
      }
      if (p.startLevel !== null) p.y[0] = Math.min(p.y[0], p.startLevel);
      endLevel.set(p.run, p.y[n - 1]);
    }
  }

  // ------------------------------------------------------------------ mesh
  const pos: number[] = [];
  const flow: number[] = [];
  const dir: number[] = [];
  const idx: number[] = [];
  let lengthKm = 0;
  let rapidKm = 0;
  let dry = 0;
  let sections = 0;
  for (const p of profiles) {
    const { run } = p;
    const n = p.s.length;
    const L = p.s[n - 1];
    lengthKm += L;
    const hwFull = (run.w / 2) * opts.widthScale;
    // vertices across: ≤ ~0.5 km apart so the draped interior follows the 0.4 km heightfield
    const K = 2 * Math.max(1, Math.ceil(hwFull / 0.5)) + 1;
    // the always-wet interior spans 80% of the nominal channel half width
    const interiorV = (0.4 * run.w) / hwFull + 1e-6;
    const taperLen = Math.min(L * 0.25, run.w * 5 + 2);
    const base = pos.length / 3;
    // vertex heights first: the level profile, draped over the channel floor where it rises
    const vx = new Float64Array(n * K);
    const vz = new Float64Array(n * K);
    const vy = new Float64Array(n * K);
    const hwOf = new Float64Array(n);
    const centre = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const hw = hwFull * (p.taper ? 0.3 + 0.7 * smooth01(0, taperLen, p.s[i]) : 1);
      hwOf[i] = hw;
      const nx = -p.tz[i];
      const nz = p.tx[i];
      for (let k = 0; k < K; k++) {
        const v = -1 + (2 * k) / (K - 1);
        const px = p.x[i] + nx * v * hw;
        const pz = p.z[i] + nz * v * hw;
        const g = hf.sample(px, pz);
        const lo = Math.abs(v) <= interiorV ? g + INTERIOR_MIN : g - BURY;
        const y = Math.max(0.004, Math.min(Math.max(p.y[i], lo), g + MAX_ABOVE_GROUND));
        vx[i * K + k] = px;
        vz[i * K + k] = pz;
        vy[i * K + k] = y;
        if (2 * k === K - 1) {
          centre[i] = y;
          sections++;
          if (y < g - 0.005) dry++;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      // rapids / whitewater: steep reaches of the actual (draped) water surface — falls, sills
      const a = Math.max(0, i - 2);
      const b = Math.min(n - 1, i + 2);
      const grade = Math.abs(centre[a] - centre[b]) / Math.max(1e-3, p.s[b] - p.s[a]);
      const rapid = smooth01(0.3, 0.75, grade);
      if (rapid > 0.5 && i > 0) rapidKm += p.s[i] - p.s[i - 1];
      let fade = smooth01(-0.12, 0.0, p.bed[i]); // hand over to the sea at the mouth
      if (p.taper) fade *= smooth01(0, 0.8, p.s[i]);
      if (p.endFade) fade *= smooth01(L, L - (run.w + 1.0), p.s[i]);
      for (let k = 0; k < K; k++) {
        const v = -1 + (2 * k) / (K - 1);
        pos.push(vx[i * K + k], vy[i * K + k], vz[i * K + k]);
        flow.push(p.s[i], v, hwOf[i], fade);
        dir.push(p.tx[i], p.tz[i], rapid, 0);
      }
      if (i > 0) {
        const r0 = base + (i - 1) * K;
        const r1 = base + i * K;
        for (let k = 0; k < K - 1; k++) {
          pushUpTri(idx, pos, r0 + k, r1 + k, r0 + k + 1);
          pushUpTri(idx, pos, r0 + k + 1, r1 + k, r1 + k + 1);
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('flow', new Float32BufferAttribute(flow, 4));
  g.setAttribute('flowDir', new Float32BufferAttribute(dir, 4));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return {
    geometry: g,
    stats: { lines: profiles.length, vertices: pos.length / 3, triangles: idx.length / 3, lengthKm: Math.round(lengthKm), rapidKm: Math.round(rapidKm), dryCentrePct: Math.round((1000 * dry) / Math.max(1, sections)) / 10 },
  };
}

/** v2 whitewater: level grade (units per km) where rapids start / are full — mountain torrents only */
const RAPID_GRADE: [number, number] = [1.5, 4.0];
/** declared falls whiten the ribbon this far up- and downstream of the lip (km) */
const FALL_SPRAY_KM = 1.0;
/** a free end (a stream ending in its own valley) fades out over this length (km) */
const FREE_END_FADE_KM = 0.8;
/**
 * S4 W4-S1 P4: a ribbon whose end lies in a lake at the lake's level (± LAKE_LEVEL_TOL) runs on this far
 * (km) into the lake along its end tangent, fading out, so river and lake cross-fade instead of meeting
 * at the bake's straight clip edge (the Forest River's seam on the Long Lake). 0 switches it off.
 */
const LAKE_OVERLAP_KM = 1.2;
const LAKE_OVERLAP_STEP = 0.4;
const LAKE_LEVEL_TOL = 0.06;
/** the river's share of 'lake look' (flowDir.w) fades out over this length (km) beyond the lake */
const LAKE_BLEND_KM = 1.0;
/**
 * S4 W4-S1: an outflow (a ribbon starting in a lake at its level) keeps the lake's level while the lake
 * surface is still visible over it (baked lake mask above the lake material's cut, LAKE_MASK_VISIBLE)
 * and one point beyond, so its first drop lies past the lake's edge. Dropping under the lake's fading
 * edge, the ribbon was hidden by the lake surface there and the edge showed the channel paint as a dark
 * straight line across the outflow (water-long-lake, the Celduin).
 */
const OUTFLOW_HOLD = true;
const LAKE_MASK_VISIBLE = 0.12;

/** CPU bilinear lake mask (water.g, the same texel convention as the GPU) at (x, z). */
function lakeMaskSampler(world: World): (x: number, z: number) => number {
  const img = world.water.image as { data?: Uint8Array; width: number; height: number };
  const data = img.data;
  if (!data) return () => 0;
  const w = img.width;
  const h = img.height;
  const sp = world.spec;
  return (x, z) => {
    const fx = Math.min(w - 1, Math.max(0, ((x - sp.xMin) / sp.width) * w - 0.5));
    const fz = Math.min(h - 1, Math.max(0, ((z - sp.zMin) / sp.depth) * h - 0.5));
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(w - 1, x0 + 1);
    const z1 = Math.min(h - 1, z0 + 1);
    const tx = fx - x0;
    const tz = fz - z0;
    const at = (xx: number, zz: number) => data[(zz * w + xx) * 4 + 1];
    const a = at(x0, z0) + (at(x1, z0) - at(x0, z0)) * tx;
    const b = at(x0, z1) + (at(x1, z1) - at(x0, z1)) * tx;
    return (a + (b - a) * tz) / 255;
  };
}
/** on a bend tighter than the ribbon, the inner edge stays inside this share of the bend radius */
const INNER_EDGE = 0.9;

/** The carved channel core half width of a line (tools/bake/bake/hydro.py Line.core). */
export const coreHalfWidth = (r: { widthKm: number }): number => Math.max(r.widthKm / 2, 0.5);

/** Ribbon half width on bake v2 (tools/bake/bake/hydro.py ribbon_half): scale × half the width, but
 * always `margin` beyond the carved core so no dry channel wall shows beside a stream. */
export const ribbonHalfWidth = (r: { widthKm: number }, scale: number, margin: number): number => Math.max((scale * r.widthKm) / 2, coreHalfWidth(r) + margin);

function distToPolyline(p: [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1];
    const ex = p[i][0] - ax;
    const ez = p[i][1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    best = Math.min(best, Math.hypot(x - (ax + ex * t), z - (az + ez * t)));
  }
  return best;
}

/**
 * Bake v2 ribbons: the processed centreline points, level per point, falls — used exactly as baked.
 * Three vertices across (the surface is flat across), so the mesh is far lighter than the draped v1.
 * The half width is `widthScale` × half the width but at least `marginKm` beyond the carved core, so
 * the ribbon edge always lies on the bank just beyond the channel (never over a dry channel wall). A tributary ends at its parent's core
 * edge (the bake clipped it there, at the parent's level) and fades out across the parent's ribbon; a
 * distributary starts there and fades in; a line ending in its own valley (no `into`) fades out.
 */
function buildBakedRivers(world: World, lakes: LakeInfo[], opts: RiverBuildOptions): { geometry: BufferGeometry; stats: RiverStats } {
  const hf = world.heights;
  const lines = world.rivers.filter((r) => opts.includeStreams || r.cls !== 'stream');
  const byId = new Map(world.rivers.map((r) => [r.id, r]));
  const ends = world.rivers.map((r) => r.points[r.points.length - 1]);
  const halfWidth = (r: RiverLine) => ribbonHalfWidth(r, opts.widthScale, opts.marginKm ?? 0.1);
  /** the other line whose water (core) a start at (x, z) lies on: a continuation or a distributary */
  const feeder = (self: RiverLine, x: number, z: number): RiverLine | null => {
    for (let j = 0; j < world.rivers.length; j++) {
      const o = world.rivers[j];
      if (o === self) continue;
      if (Math.hypot(ends[j][0] - x, ends[j][1] - z) < 0.5) return o;
      if (distToPolyline(o.points, x, z) < coreHalfWidth(o) + 0.3) return o;
    }
    return null;
  };
  const K = 3;
  const pos: number[] = [];
  const flow: number[] = [];
  const dir: number[] = [];
  const idx: number[] = [];
  let lengthKm = 0;
  let rapidKm = 0;
  let fallKm = 0;
  let dry = 0;
  let sections = 0;
  let count = 0;
  const lakeMask = lakeMaskSampler(world);
  for (const r of lines) {
    const pts0 = r.points;
    const lv0 = r.level!;
    const bed0 = r.bed ?? lv0;
    const n0 = pts0.length;
    if (n0 < 2) continue;
    count++;
    const s0 = new Float64Array(n0);
    for (let i = 1; i < n0; i++) s0[i] = s0[i - 1] + Math.hypot(pts0[i][0] - pts0[i - 1][0], pts0[i][1] - pts0[i - 1][1]);
    const L = s0[n0 - 1];
    lengthKm += L;
    const [sx, sz] = pts0[0];
    const [ex, ez] = pts0[n0 - 1];
    // S4 W4-S1 P4: an end in a lake at the lake's level runs on into the lake, fading out (LAKE_OVERLAP_KM)
    const lakeAt = (x: number, z: number, level: number) => {
      const l = lakeNear(lakes, x, z, 1.0);
      return l !== null && Math.abs(l.level - level) < LAKE_LEVEL_TOL;
    };
    const extA = LAKE_OVERLAP_KM > 0 && lakeAt(sx, sz, lv0[0]) ? LAKE_OVERLAP_KM : 0;
    const extB = LAKE_OVERLAP_KM > 0 && lakeAt(ex, ez, lv0[n0 - 1]) ? LAKE_OVERLAP_KM : 0;
    const pts: [number, number][] = [];
    const lv: number[] = [];
    const bed: number[] = [];
    const sl: number[] = [];
    const extend = (from: number, to: number, ext: number, sign: number) => {
      const [fx, fz] = pts0[from];
      const [tx0, tz0] = pts0[to];
      const dl = Math.hypot(tx0 - fx, tz0 - fz) || 1;
      const k = Math.max(1, Math.ceil(ext / LAKE_OVERLAP_STEP));
      const out: number[] = [];
      for (let j = 1; j <= k; j++) out.push((ext * j) / k);
      if (sign < 0) out.reverse();
      for (const d of out) {
        pts.push([tx0 + ((tx0 - fx) / dl) * d, tz0 + ((tz0 - fz) / dl) * d]);
        lv.push(lv0[to]);
        bed.push(bed0[to]);
        sl.push(sign < 0 ? -d : L + d);
      }
    };
    if (extA) extend(Math.min(2, n0 - 1), 0, extA, -1);
    const first = pts.length;
    for (let i = 0; i < n0; i++) {
      pts.push(pts0[i]);
      lv.push(lv0[i]);
      bed.push(bed0[i]);
      sl.push(s0[i]);
    }
    if (extB) extend(Math.max(0, n0 - 3), n0 - 1, extB, 1);
    if (extA && OUTFLOW_HOLD) {
      for (let i = first + 1; i < first + n0; i++) {
        if (lakeMask(pts[i - 1][0], pts[i - 1][1]) <= LAKE_MASK_VISIBLE) break;
        lv[i] = Math.max(lv[i], lv0[0]);
      }
    }
    const n = pts.length;
    const s = Float64Array.from(sl);
    const up = lakeNear(lakes, sx, sz, 1.0) ? null : feeder(r, sx, sz);
    const source = !up && !lakeNear(lakes, sx, sz, 1.0);
    const parent = typeof r.into === 'string' ? byId.get(r.into) : undefined;
    const sp = world.spec;
    const atEdge = Math.min(ex - sp.xMin, sp.xMax - ex, ez - sp.zMin, sp.zMax - ez) < 1.0;
    const freeEnd = !r.into && bed[n - 1] >= 0 && !atEdge && !lakeNear(lakes, ex, ez, 1.0);
    // across the parent's ribbon beyond its core (where the tributary's own ribbon overlaps it)
    const overlap = (o: RiverLine | null | undefined) => (o ? Math.max(0.15, halfWidth(o) - coreHalfWidth(o) + 0.1) : 0);
    const joinFade = parent ? overlap(parent) : 0;
    const startFade = up && distToPolyline(up.points, sx, sz) > 0.3 ? overlap(up) : 0;
    const hwFull = halfWidth(r);
    const taperLen = Math.min(L * 0.25, r.widthKm * 5 + 2);
    const at = (i: number) => s0[Math.min(n0 - 1, i)];
    const fallS = (r.falls ?? []).map((f) => 0.5 * (at(f.index) + at(f.index + 1)));
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const dx = pts[b][0] - pts[a][0];
      const dz = pts[b][1] - pts[a][1];
      const dl = Math.hypot(dx, dz) || 1;
      const tx = dx / dl;
      const tz = dz / dl;
      const hw = hwFull * (source ? 0.3 + 0.7 * smooth01(0, taperLen, s[i]) : 1);
      // bend radius from the turn between the neighbouring segments: the inner edge never folds over
      let inner = 0;
      let rInner = Infinity;
      if (i > 0 && i < n - 1) {
        const ax = pts[i][0] - pts[i - 1][0];
        const az = pts[i][1] - pts[i - 1][1];
        const bx = pts[i + 1][0] - pts[i][0];
        const bz = pts[i + 1][1] - pts[i][1];
        const la = Math.hypot(ax, az) || 1;
        const lb = Math.hypot(bx, bz) || 1;
        const cross = (ax * bz - az * bx) / (la * lb);
        const turn = Math.asin(Math.max(-1, Math.min(1, cross)));
        if (Math.abs(turn) > 1e-4) {
          rInner = (0.5 * (la + lb)) / Math.abs(turn);
          // the normal (−tz, tx) (v = +1) is the tangent turned the way a positive cross product turns
          inner = cross > 0 ? 1 : -1;
        }
      }
      // whitewater: declared falls (spray around the lip) or a genuinely steep baked reach
      const a2 = Math.max(0, i - 2);
      const b2 = Math.min(n - 1, i + 2);
      const grade = (lv[a2] - lv[b2]) / Math.max(1e-3, s[b2] - s[a2]);
      const nearFall = fallS.some((f) => Math.abs(s[i] - f) < FALL_SPRAY_KM);
      const rapid = nearFall ? 1 : smooth01(RAPID_GRADE[0], RAPID_GRADE[1], grade);
      if (i > 0 && rapid > 0.5) {
        if (nearFall) fallKm += s[i] - s[i - 1];
        else rapidKm += s[i] - s[i - 1];
      }
      let fade = smooth01(-0.12, 0.0, bed[i]); // hand over to the sea at the mouth
      if (source) fade *= smooth01(0, 0.8, s[i]);
      if (startFade) fade *= smooth01(0, startFade, s[i]);
      if (joinFade) fade *= smooth01(L, L - joinFade, s[i]);
      if (freeEnd) fade *= smooth01(L, L - Math.min(FREE_END_FADE_KM, 0.5 * L), s[i]);
      if (extA) fade *= smooth01(-extA, 0, s[i]);
      if (extB) fade *= smooth01(L + extB, L, s[i]);
      const nx = -tz;
      const nz = tx;
      const y = lv[i];
      const lakeShare = Math.max(extA ? 1 - smooth01(0, LAKE_BLEND_KM, s[i]) : 0, extB ? 1 - smooth01(L, L - LAKE_BLEND_KM, s[i]) : 0);
      for (let k = 0; k < K; k++) {
        const v = -1 + (2 * k) / (K - 1);
        const off = v === inner ? Math.min(hw, INNER_EDGE * rInner) : hw;
        pos.push(pts[i][0] + nx * v * off, y, pts[i][1] + nz * v * off);
        flow.push(s[i], v, hw, fade);
        dir.push(tx, tz, rapid, lakeShare);
      }
      if (i >= first && i < first + n0) {
        sections++;
        if (y < hf.sample(pts[i][0], pts[i][1]) - 0.005) dry++;
      }
      if (i > 0) {
        const r0 = base + (i - 1) * K;
        const r1 = base + i * K;
        for (let k = 0; k < K - 1; k++) {
          pushUpTri(idx, pos, r0 + k, r1 + k, r0 + k + 1);
          pushUpTri(idx, pos, r0 + k + 1, r1 + k, r1 + k + 1);
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('flow', new Float32BufferAttribute(flow, 4));
  g.setAttribute('flowDir', new Float32BufferAttribute(dir, 4));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return {
    geometry: g,
    stats: {
      lines: count,
      vertices: pos.length / 3,
      triangles: idx.length / 3,
      lengthKm: Math.round(lengthKm),
      rapidKm: Math.round(rapidKm),
      fallKm: Math.round(fallKm * 10) / 10,
      dryCentrePct: Math.round((1000 * dry) / Math.max(1, sections)) / 10,
      baked: true,
    },
  };
}
