import { valueNoise } from '../core/rng.ts';

/**
 * Terrain stamps: analytic height edits declared as data by landmarks (and places.json).
 * Composited in TypeScript on top of the baked base heightfield — landmark tuning never needs a
 * re-bake. All positions/sizes are world units (km); heights are world units (exaggerated).
 *
 * Kinds: flatten · raise · cone · plateau · carve (S1) and ridge · scarp · massif · basin (S3).
 * Every kind has `stampBounds` + `applyStamp`, so the river guard ("rivers win", HeightField),
 * `stampLoss` and the checks apply to all of them unchanged.
 *
 * Resolution rule: the heightfield is 0.4 km per texel, so stamps shape forms of ≥ ~1.2 km (three
 * texels) — massifs, spurs, gorges, cliffs a few km long, basins. Sheer faces narrower than that
 * (a gate cut into a cliff, the Hornburg's rock, a stair) are kit geometry seated on the stamp.
 * Near rivers, build gorges by RAISING walls beside the water (ridge / scarp), never by carving
 * below it: the guard keeps the channel and lake cells at their baked height and clamps stamped
 * ground to a natural bank next to them.
 *
 * `snowCap` (massif, cone) keeps snow on the stamped mountain above that fraction of its height on all
 * but its sheerest faces (terrainMaterial reads `stampSnowCaps`): at the terrain's 12× exaggeration a
 * lone peak is steeper everywhere than the slope the regional snow rules hold snow on.
 *
 * `rough` (ridge, scarp, massif, raise, cone) adds deterministic value noise (src/core/rng.ts) in
 * WORLD coordinates, faded with the stamp's own profile; octaves finer than ROUGH_MIN_KM (four texels)
 * are dropped — finer ridged noise aliases into regular teeth on the 0.4 km texels. Crest lines of
 * massifs are rounded over at least two texels for the same reason.
 *
 * `surface` overrides the terrain's stamp turf rule inside the stamp's influence (terrain/groundMaps.ts):
 * 'turf' forces grass/soil on the stamped faces, 'rock' leaves them to the terrain's slope / alpine rock
 * rules, 'auto' (default) decides from the pre-stamp slope and the stamp height.
 *
 * Stamps are immutable data: derived per-stamp data (the massif crest lines) is memoised by object
 * identity, so a tool that edits a stamp must replace the object, never mutate it in place.
 */
export type Vec2 = [number, number];

/** Deterministic roughness: fBm value noise (ridged: sharp crests and gullies). */
export interface Rough {
  /** amplitude, world height units */
  amp: number;
  /** feature size of the first octave, km (≥ ROUGH_MIN_KM: octaves finer than that are dropped) */
  scaleKm: number;
  ridged?: boolean;
  seed?: number;
}

export type StampSurface = 'auto' | 'turf' | 'rock';

interface StampBase {
  /** blend weight 0..1 (default 1) */
  strength?: number;
  /** ground look inside the stamp's influence (default 'auto'; see the module doc) */
  surface?: StampSurface;
}

/** Level the ground to `height` (or the local median when 'auto') inside radius, smooth falloff. */
export interface FlattenStamp extends StampBase {
  kind: 'flatten';
  at: Vec2;
  radius: number;
  falloff: number;
  height?: number | 'auto';
  /** only cut ground above `height` down to it, never raise lower ground (a terrace cut into valley walls
   * beside a river: the channel and the floodplain below the terrace stay as they are) */
  lowerOnly?: boolean;
}

/** Add `amount` inside radius with a smooth dome profile (negative = depression). */
export interface RaiseStamp extends StampBase {
  kind: 'raise';
  at: Vec2;
  radius: number;
  amount: number;
  rough?: Rough;
}

/**
 * Volcano-like cone to an absolute summit height, optional crater. The profile is applied to the
 * height ABOVE `base` (the ground the landmark stands on): base + (summit − base)·tᵉ.
 */
export interface ConeStamp extends StampBase {
  kind: 'cone';
  at: Vec2;
  radius: number;
  summit: number;
  /** absolute height the profile starts from (defaults to 0 = sea level) */
  base?: number;
  /** 1 = straight cone, >1 concave (steeper top) */
  exponent?: number;
  craterRadius?: number;
  craterDepth?: number;
  rough?: Rough;
  /** snow above this fraction of (summit − base) on all but the sheerest faces (see the module doc) */
  snowCap?: number;
}

/** Plateau/mesa: raise to at least `height` with a steep rim. */
export interface PlateauStamp extends StampBase {
  kind: 'plateau';
  at: Vec2;
  radius: number;
  height: number;
  rim: number;
}

/** Carve a channel/gorge along a polyline to depth below the local surface. */
export interface CarveStamp extends StampBase {
  kind: 'carve';
  path: Vec2[];
  width: number;
  depth: number;
  falloff: number;
}

/**
 * Additive ridge along a polyline (a spur, a ridge wall, the shoulder of a gorge). `height` is one
 * value or one per path vertex (0 at an end tapers it); the cross profile is 'round' (cos², a
 * rounded crest) or 'sharp' ((1 − u)², a crest line with long flanks); `asym` > 0 widens the right
 * flank (walking along the path, map north up), < 0 the left.
 */
export interface RidgeStamp extends StampBase {
  kind: 'ridge';
  path: Vec2[];
  height: number | number[];
  halfWidth: number;
  profile?: 'round' | 'sharp';
  /** −1..1 */
  asym?: number;
  rough?: Rough;
}

/**
 * Scarp: raises one side of a polyline (the `side` walking along it, map north up) into a plateau
 * `height` above the ground, with a steep face `run` km wide on the line; the plateau extends
 * `plateauKm` beyond the face top and falls back over `falloff`. Beyond the path ends it fades over
 * `falloff`. Cliffs, escarpments, gorge walls (two scarps facing each other across the water).
 */
export interface ScarpStamp extends StampBase {
  kind: 'scarp';
  path: Vec2[];
  height: number;
  run: number;
  side: 'left' | 'right';
  plateauKm: number;
  falloff: number;
  /** also meanders the face line (± a third of `run`) */
  rough?: Rough;
}

/** One ridged spur of a massif: from the summit outward along `azimuthDeg` (clockwise from north). */
export interface MassifSpur {
  azimuthDeg: number;
  lengthKm: number;
  /** width of the crest zone, km (tapers toward the tip; the flanks add their own width) */
  widthKm: number;
  /** crest height halfway out along the spur, as a fraction of (summit − base): ≈ 0.5·rootFrac a
   * straight ridge, higher = full shoulders, lower = a ridge falling away steeply from the summit */
  heightFrac: number;
  /** shoulder height where the spur leaves the peak, as a fraction of (summit − base) (default 1: one
   * even crest from the summit). Lower: a steep arête drops from the summit to the shoulder and the
   * spur runs on from there, long and low — the peak stands on a skirt of foothill ridges */
  rootFrac?: number;
}

/**
 * A mountain body with ridged spurs (Erebor): a concave peak base + (summit − base)·tᵉ,
 * t = 1 − d / radius, and spurs radiating from the summit — each a crest line along a meandering
 * axis (heightFrac·(summit − base) halfway out, knobs and cols, a soft tip) with two side ridges
 * branching off it, concave flanks that widen with the crest height (mean slope `flankSlope`) and
 * undulating edges, V valleys where neighbouring flanks meet. A low-frequency domain warp (0 at the
 * summit, ≤ 2.5 km) curves the spurs. The highest profile wins (spurs never add up).
 * Optional ridged roughness and a crater. Like `cone`, it never lowers the ground; the foot blends
 * out as the profile approaches `base`.
 *
 * Example (Erebor): `{ kind: 'massif', at: [2.5, −8.3], radius: 8, summit: 27.5, base: 1.2, exponent: 1.2,
 * dome: 0.6, flankSlope: 2.3, spurs: [{ azimuthDeg: 238, lengthKm: 23, widthKm: 5, heightFrac: 0.5,
 * rootFrac: 0.66 }, …], rough: { amp: 1, scaleKm: 3.6, ridged: true }, snowCap: 0.7 }` (heights local:
 * relative to the ground at the landmark origin).
 */
export interface MassifStamp extends StampBase {
  kind: 'massif';
  at: Vec2;
  radius: number;
  /** absolute summit height */
  summit: number;
  /** absolute height the profile starts from (defaults to 0 = sea level) */
  base?: number;
  /** body profile exponent (default 1.3) */
  exponent?: number;
  /**
   * convex summit 0..1 (default 0): the body is (1 − (d/radius)^(1 + dome))^exponent — 0 a pointed concave
   * peak, higher a broad, heavy crown that holds its height (and its snow) before the flanks fall away
   */
  dome?: number;
  spurs: MassifSpur[];
  /** mean flank slope of the spurs, height units per km (default 1.5): steeper = narrower spurs and
   * deeper valleys between them */
  flankSlope?: number;
  rough?: Rough;
  craterRadius?: number;
  craterDepth?: number;
  /** snow above this fraction of (summit − base) on all but the sheerest faces (see the module doc) */
  snowCap?: number;
}

/**
 * Basin: a flattened floor at `floor` (or the local median when 'auto') inside `radius`, blending
 * back to the terrain over `falloff`, with an optional raised rim ring (`rim.height` over `rim.width`
 * km) just outside the floor (Isengard's Nan Curunír).
 */
export interface BasinStamp extends StampBase {
  kind: 'basin';
  at: Vec2;
  radius: number;
  floor: number | 'auto';
  falloff: number;
  rim?: { height: number; width: number };
}

export type Stamp = FlattenStamp | RaiseStamp | ConeStamp | PlateauStamp | CarveStamp | RidgeStamp | ScarpStamp | MassifStamp | BasinStamp;

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function distToSegment(px: number, pz: number, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2)) : 0;
  const qx = a[0] + t * dx - px;
  const qz = a[1] + t * dz - pz;
  return Math.hypot(qx, qz);
}

/** Nearest point of a polyline: distance, segment, clamped / raw parameter and side (−1 left, +1 right). */
interface PathHit {
  d: number;
  seg: number;
  t: number;
  tRaw: number;
  side: number;
  /** signed perpendicular distance to the segment's line (+ right) */
  perp: number;
  len: number;
}

function nearestOnPath(path: Vec2[], x: number, z: number): PathHit {
  const hit: PathHit = { d: Infinity, seg: 0, t: 0, tRaw: 0, side: 1, perp: 0, len: 0 };
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, az] = path[i];
    const dx = path[i + 1][0] - ax;
    const dz = path[i + 1][1] - az;
    const l2 = dx * dx + dz * dz;
    const tr = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    const t = Math.min(1, Math.max(0, tr));
    const d = Math.hypot(ax + t * dx - x, az + t * dz - z);
    if (d < hit.d) {
      const len = Math.sqrt(l2);
      // x east, z south: walking east, the left (north) side has cross < 0
      const cross = dx * (z - az) - dz * (x - ax);
      hit.d = d;
      hit.seg = i;
      hit.t = t;
      hit.tRaw = tr;
      hit.side = cross < 0 ? -1 : 1;
      hit.perp = len > 0 ? cross / len : 0;
      hit.len = len;
    }
  }
  return hit;
}

/** finest roughness octave, km: four heightfield texels (finer ridged noise aliases into teeth) */
export const ROUGH_MIN_KM = 1.6;

/**
 * fBm value noise in [−1, 1] at world (x, z) (up to three octaves, none finer than ROUGH_MIN_KM; ridged:
 * sharp crests at +1). Each octave is rotated (0.61 rad per octave) so the value-noise lattice never lines
 * up into regular teeth.
 */
export function roughNoise(r: Rough, x: number, z: number): number {
  const seed = r.seed ?? 0;
  let f = 1 / Math.max(ROUGH_MIN_KM, r.scaleKm);
  let a = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < 3; o++) {
    if (o > 0 && 1 / f < ROUGH_MIN_KM) break;
    const c = Math.cos(o * 0.61);
    const sn = Math.sin(o * 0.61);
    const n = valueNoise((x * c - z * sn) * f + o * 17.31, (x * sn + z * c) * f - o * 9.17, seed + o * 101);
    const v = r.ridged ? 1 - Math.abs(2 * n - 1) : n;
    sum += (r.ridged ? v * v : v) * a;
    norm += a;
    f *= 2.03;
    a *= 0.5;
  }
  return (2 * sum) / norm - 1;
}

/** polynomial smooth max (k: blend width in height units) */
function smax(a: number, b: number, k: number): number {
  if (k <= 0) return Math.max(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

function pathBox(path: Vec2[], r: number): [number, number, number, number] {
  const xs = path.map((p) => p[0]);
  const zs = path.map((p) => p[1]);
  return [Math.min(...xs) - r, Math.min(...zs) - r, Math.max(...xs) + r, Math.max(...zs) + r];
}

/** Largest horizontal reach of a massif from its centre (body, spur tips, noisy spur flanks, domain warp — conservative). */
function massifReach(s: MassifStamp): number {
  const H = Math.max(0, s.summit - (s.base ?? 0));
  const flank = s.flankSlope ?? SPUR_FLANK;
  let r = s.radius;
  for (const sp of s.spurs) r = Math.max(r, Math.hypot(sp.lengthKm, 1.3 * (sp.widthKm * 0.75 + (1.1 * H) / flank)));
  return r + MASSIF_WARP_MAX;
}

/** A stamp's snow cap (world): centre, horizontal reach (km) and the absolute snow line. */
export interface SnowCap {
  x: number;
  z: number;
  reach: number;
  line: number;
}

/** The snow caps declared by cone / massif stamps (`snowCap`), in stamp order. */
export function stampSnowCaps(stamps: readonly Stamp[]): SnowCap[] {
  const out: SnowCap[] = [];
  for (const s of stamps) {
    if ((s.kind !== 'massif' && s.kind !== 'cone') || s.snowCap === undefined) continue;
    const base = s.base ?? 0;
    out.push({ x: s.at[0], z: s.at[1], reach: s.kind === 'massif' ? massifReach(s) : s.radius, line: base + s.snowCap * (s.summit - base) });
  }
  return out;
}

/** World-space bounding box [minX, minZ, maxX, maxZ] of a stamp's influence. */
export function stampBounds(s: Stamp): [number, number, number, number] {
  switch (s.kind) {
    case 'flatten': {
      const r = s.radius + s.falloff;
      return [s.at[0] - r, s.at[1] - r, s.at[0] + r, s.at[1] + r];
    }
    case 'raise':
    case 'cone':
      return [s.at[0] - s.radius, s.at[1] - s.radius, s.at[0] + s.radius, s.at[1] + s.radius];
    case 'plateau': {
      const r = s.radius + s.rim;
      return [s.at[0] - r, s.at[1] - r, s.at[0] + r, s.at[1] + r];
    }
    case 'carve': {
      const r = s.width / 2 + s.falloff;
      const xs = s.path.map((p) => p[0]);
      const zs = s.path.map((p) => p[1]);
      return [Math.min(...xs) - r, Math.min(...zs) - r, Math.max(...xs) + r, Math.max(...zs) + r];
    }
    case 'ridge':
      return pathBox(s.path, s.halfWidth * (1 + Math.abs(s.asym ?? 0)));
    case 'scarp':
      return pathBox(s.path, s.run * 1.4 + s.plateauKm + 2 * s.falloff);
    case 'massif': {
      const r = massifReach(s);
      return [s.at[0] - r, s.at[1] - r, s.at[0] + r, s.at[1] + r];
    }
    case 'basin': {
      const r = s.radius + Math.max(s.falloff, s.rim ? s.rim.width : 0);
      return [s.at[0] - r, s.at[1] - r, s.at[0] + r, s.at[1] + r];
    }
  }
}

/**
 * Apply one stamp to height `h` at world (x, z). `ctx.auto` supplies the resolved height for
 * 'auto' flatten / basin stamps.
 */
export function applyStamp(s: Stamp, x: number, z: number, h: number, ctx: { auto: number }): number {
  const w = s.strength ?? 1;
  switch (s.kind) {
    case 'flatten': {
      const d = Math.hypot(x - s.at[0], z - s.at[1]);
      const k = 1 - smooth(s.radius, s.radius + s.falloff, d);
      const target = s.height === undefined || s.height === 'auto' ? ctx.auto : s.height;
      if (s.lowerOnly && target >= h) return h;
      return h + (target - h) * k * w;
    }
    case 'raise': {
      const d = Math.hypot(x - s.at[0], z - s.at[1]) / s.radius;
      if (d >= 1) return h;
      const k = Math.cos(d * Math.PI * 0.5) ** 2;
      if (!s.rough) return h + s.amount * k * w;
      return h + (s.amount + s.rough.amp * roughNoise(s.rough, x, z)) * k * w;
    }
    case 'cone': {
      const d = Math.hypot(x - s.at[0], z - s.at[1]);
      if (d >= s.radius) return h;
      const t = 1 - d / s.radius;
      const base = s.base ?? 0;
      let cone = base + (s.summit - base) * Math.pow(t, s.exponent ?? 1.3);
      if (s.rough) cone += s.rough.amp * roughNoise(s.rough, x, z) * Math.sqrt(t);
      if (s.craterRadius && d < s.craterRadius) {
        const c = 1 - d / s.craterRadius;
        cone -= (s.craterDepth ?? 0) * Math.sqrt(c);
      }
      // blend the cone foot into the terrain: never lower the ground
      const foot = smooth(0, 0.18, t);
      return h + (Math.max(h, cone) - h) * foot * w;
    }
    case 'plateau': {
      const d = Math.hypot(x - s.at[0], z - s.at[1]);
      const k = 1 - smooth(s.radius, s.radius + s.rim, d);
      return h + Math.max(0, s.height - h) * k * w;
    }
    case 'carve': {
      let d = Number.POSITIVE_INFINITY;
      for (let i = 0; i + 1 < s.path.length; i++) d = Math.min(d, distToSegment(x, z, s.path[i], s.path[i + 1]));
      const k = 1 - smooth(s.width / 2, s.width / 2 + s.falloff, d);
      return h - s.depth * k * w;
    }
    case 'ridge':
      return h + ridgeDelta(s, x, z) * w;
    case 'scarp':
      return h + scarpDelta(s, x, z) * w;
    case 'massif':
      return massifApply(s, x, z, h, w);
    case 'basin': {
      const d = Math.hypot(x - s.at[0], z - s.at[1]);
      const k = 1 - smooth(s.radius, s.radius + s.falloff, d);
      const target = s.floor === 'auto' ? ctx.auto : s.floor;
      let v = h + (target - h) * k * w;
      if (s.rim && s.rim.width > 0) {
        const hw = s.rim.width / 2;
        const u = (d - (s.radius + hw)) / hw;
        if (Math.abs(u) < 1) v += s.rim.height * Math.cos(u * Math.PI * 0.5) ** 2 * w;
      }
      return v;
    }
  }
}

function ridgeDelta(s: RidgeStamp, x: number, z: number): number {
  if (s.path.length < 2) return 0;
  const hit = nearestOnPath(s.path, x, z);
  const hw = s.halfWidth * (1 + (s.asym ?? 0) * hit.side);
  if (hw <= 0 || hit.d >= hw) return 0;
  const u = hit.d / hw;
  const prof = s.profile === 'sharp' ? (1 - u) * (1 - u) : Math.cos(u * Math.PI * 0.5) ** 2;
  let H: number;
  if (typeof s.height === 'number') H = s.height;
  else {
    // per-vertex heights (a short array holds its last value: never NaN)
    const hs = s.height;
    const n = hs.length - 1;
    if (n < 0) return 0;
    const a = hs[Math.min(hit.seg, n)];
    H = a + (hs[Math.min(hit.seg + 1, n)] - a) * hit.t;
  }
  let v = H * prof;
  if (s.rough) v += s.rough.amp * roughNoise(s.rough, x, z) * prof;
  return v;
}

function scarpDelta(s: ScarpStamp, x: number, z: number): number {
  const p = s.path;
  if (p.length < 2) return 0;
  const hit = nearestOnPath(p, x, z);
  const last = p.length - 2;
  // beyond an end: extend the end segment's line straight, fading over `falloff`
  let beyond = 0;
  let dist = hit.d;
  if (hit.seg === 0 && hit.tRaw < 0) {
    beyond = -hit.tRaw * hit.len;
    dist = Math.abs(hit.perp);
  } else if (hit.seg === last && hit.tRaw > 1) {
    beyond = (hit.tRaw - 1) * hit.len;
    dist = Math.abs(hit.perp);
  }
  const endW = 1 - smooth(0, s.falloff, beyond);
  if (endW <= 0) return 0;
  const toSide = s.side === 'right' ? 1 : -1;
  let sd = dist * (hit.side === toSide ? 1 : -1);
  if (s.rough) sd += roughNoise({ ...s.rough, seed: (s.rough.seed ?? 0) + 7 }, x, z) * s.run * 0.35;
  if (sd <= 0) return 0;
  const top = s.run + s.plateauKm;
  const prof = smooth(0, s.run, sd) * (1 - smooth(top, top + s.falloff, sd));
  if (prof <= 0) return 0;
  let v = s.height * prof;
  if (s.rough) v += s.rough.amp * roughNoise(s.rough, x, z) * prof;
  return Math.max(0, v) * endW;
}

/** default mean flank slope of massif spurs (height units per km): the flanks widen with the crest height */
const SPUR_FLANK = 1.5;
/** largest domain-warp offset of a massif, km (curving spurs, irregular valleys; 0 at the summit) */
const MASSIF_WARP_MAX = 2.5;
/** feature size of the domain warp, km (≥ 3× the largest offset × the value noise's peak slope 1.5) */
const MASSIF_WARP_KM = 14;

/**
 * One crest line of a massif, in coordinates relative to the summit: from the root (rx, rz) out along
 * the unit direction (ux, uz) for `len` km. Its height (fraction of the massif height) falls from `h0`
 * at the root to 0 at the tip as (1 − s)^ex with knobs and a soft tip.
 */
interface MassifCrest {
  rx: number;
  rz: number;
  ux: number;
  uz: number;
  len: number;
  h0: number;
  ex: number;
  /** a steep arête from the summit (crest max(u^ARETE_EXP, …)) — main spurs with a shoulder only */
  arete: boolean;
  width: number;
  /** noise index (knobs, wander) */
  k: number;
}

/** crest lines per stamp OBJECT (stamps are immutable data; see the module doc) */
const crestCache = new WeakMap<MassifStamp, MassifCrest[]>();
/** crest exponent of the arête between the summit and a spur's shoulder (falls to ⅓ within 20 % of the spur) */
const ARETE_EXP = 5;
/**
 * Crest rounding (km): the cross profile uses the soft distance √(d² + c²) − c, so every crest is rounded
 * over ≥ 2 texels (0.8 km) where a spur runs on below its shoulder — a sharp V crest meandering across the
 * 0.4 km texels read as regular sawteeth — and a little tighter on the arête above the shoulder.
 */
const CREST_ROUND_KM = 0.8;
const ARETE_ROUND_KM = 0.45;
/** smallest half-width of a crest's flanks, km (two texels) */
const CREST_MIN_HALF_KM = 0.8;
/** largest undulation of a crest's flank edge, km */
const EDGE_KM = 0.9;
/** the crest fades to the tip over this last fraction of a spur (heavy shoulders run out gently, no isolated nose) */
const TIP_FADE = 0.5;
/** smooth union of neighbouring crest profiles (fraction of the height): valley bottoms round over */
const VALLEY_BLEND = 0.04;

/** crest exponent for a spur whose crest falls from `root` to `frac` (fractions of the height) halfway out */
const crestExp = (frac: number, root: number) => Math.log(Math.min(0.95, Math.max(0.05, frac / Math.max(1e-3, root)))) / Math.log(0.5);

/**
 * The massif's crest lines: each spur from the summit, plus two side ridges branching off it (at about
 * 30 % and 55 % of its length, 55–75° off its axis, alternating sides, well below the spur there and
 * about two-thirds as long as what remains of it, on broad flanks) — the dendritic ridges of a real mountain rather than
 * a star of planar faces. Pure function of the stamp (seeded by its roughness seed).
 */
function massifCrests(s: MassifStamp): MassifCrest[] {
  const hit = crestCache.get(s);
  if (hit) return hit;
  const seed = s.rough?.seed ?? 0;
  const out: MassifCrest[] = [];
  s.spurs.forEach((sp, i) => {
    if (sp.lengthKm <= 0) return;
    const a = (sp.azimuthDeg * Math.PI) / 180;
    // clockwise from north (−z): axis direction (sin a, −cos a)
    const ux = Math.sin(a);
    const uz = -Math.cos(a);
    const root = Math.min(1, Math.max(0.05, sp.rootFrac ?? 1));
    const ex = crestExp(sp.heightFrac, root);
    out.push({ rx: 0, rz: 0, ux, uz, len: sp.lengthKm, h0: root, ex, arete: root < 1, width: sp.widthKm, k: i });
    for (let j = 0; j < 2; j++) {
      const q = (k: number) => valueNoise(i * 7.13 + j * 3.71, k * 5.29, seed + 331);
      const fb = (j === 0 ? 0.3 : 0.55) + (q(0) - 0.5) * 0.1;
      const side = (j === 0 ? 1 : -1) * (q(1) < 0.25 ? -1 : 1);
      const turn = side * (55 + 20 * q(2)) * (Math.PI / 180);
      const bx = ux * Math.cos(turn) - uz * Math.sin(turn);
      const bz = ux * Math.sin(turn) + uz * Math.cos(turn);
      // well below the spur there and long for their height, on broad flanks: buttresses that run out into
      // the plain, never fins or isolated cones
      const hRoot = root * Math.pow(1 - fb, ex) * (0.55 + 0.1 * q(3));
      out.push({ rx: ux * fb * sp.lengthKm, rz: uz * fb * sp.lengthKm, ux: bx, uz: bz, len: (1 - fb) * sp.lengthKm * (0.55 + 0.2 * q(4)), h0: hRoot, ex: 1.25, arete: false, width: sp.widthKm * 0.95, k: 100 + i * 2 + j });
    }
  });
  crestCache.set(s, out);
  return out;
}

function massifApply(s: MassifStamp, x: number, z: number, h: number, w: number): number {
  const dx0 = x - s.at[0];
  const dz0 = z - s.at[1];
  const d0 = Math.hypot(dx0, dz0);
  if (d0 >= massifReach(s)) return h;
  const base = s.base ?? 0;
  const H = s.summit - base;
  if (H <= 0) return h;
  const seed = s.rough?.seed ?? 0;
  const flank = s.flankSlope ?? SPUR_FLANK;
  // domain warp: low-frequency offsets growing from 0 at the summit — spurs curve, valleys wander
  const wa = Math.min(MASSIF_WARP_MAX, 0.16 * d0);
  // (cells of MASSIF_WARP_KM: the warp's slope stays well below 1, so it never folds space into creases)
  const dx = dx0 + (valueNoise(x / MASSIF_WARP_KM, z / MASSIF_WARP_KM, seed + 301) - 0.5) * 2 * wa;
  const dz = dz0 + (valueNoise(x / MASSIF_WARP_KM + 5.2, z / MASSIF_WARP_KM - 3.1, seed + 302) - 0.5) * 2 * wa;
  const d = Math.hypot(dx, dz);
  const e = s.exponent ?? 1.3;
  // the body: a concave peak of radius `radius`
  let prof = Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, d / s.radius), 1 + (s.dome ?? 0))), e);
  // crest lines (spurs from the summit and their side ridges): each crest's height follows its own
  // profile (knobs and cols, a soft tip), with concave flanks whose width grows with the crest height
  // (a constant mean flank slope) and whose edge undulates — V valleys where neighbouring flanks meet.
  // The highest profile wins (spurs never add up).
  // undulating flank edges: ±30 % of the distance near a crest, at most ±EDGE_KM far out (a relative
  // wobble of the 15–18 km summit flanks folded them into radial fins)
  const edgeN = (valueNoise(x / 3.5, z / 3.5, seed + 401) - 0.5) * 2;
  for (const c of massifCrests(s)) {
    const px = dx - c.rx;
    const pz = dz - c.rz;
    const alongRaw = px * c.ux + pz * c.uz;
    // distance to the crest SEGMENT (round caps): beyond the root the flank wraps round it
    const along = Math.min(c.len, Math.max(0, alongRaw));
    const sn = along / c.len;
    const u = 1 - sn;
    // knobs and cols along the crest, fading out toward the tip (a long, even nose into the plain)
    const knobs = 1 + 0.16 * (valueNoise(along / 2.6, c.k * 3.17, seed + 223) - 0.5) * 2 * sn * smooth(0, 0.4, u);
    const shoulder = c.h0 * Math.pow(u, c.ex);
    const areteH = c.arete ? Math.pow(u, ARETE_EXP) : 0;
    const line = Math.max(areteH, shoulder);
    const crest = line * knobs * smooth(0, TIP_FADE, u);
    if (crest <= 0) continue;
    const wander = (valueNoise(along / 3.2, c.k * 7.31, seed + 211) - 0.5) * c.width * 0.45 * sn;
    const perp0 = Math.hypot(px * -c.uz + pz * c.ux - wander, alongRaw - along);
    const perp = Math.max(0, perp0 + 0.3 * edgeN * Math.min(perp0, EDGE_KM / 0.3));
    // a round crest below the shoulder, a tighter one on the arête above it
    const cr = CREST_ROUND_KM + (ARETE_ROUND_KM - CREST_ROUND_KM) * smooth(-0.04, 0.04, areteH - shoulder);
    const perpS = Math.sqrt(perp * perp + cr * cr) - cr;
    const half = Math.max(CREST_MIN_HALF_KM, (c.width / 2) * (1 - 0.3 * sn) + (crest * H) / flank);
    if (perpS >= half) continue;
    prof = smax(prof, crest * Math.pow(1 - perpS / half, 1.6), VALLEY_BLEND * crest);
  }
  let m = base + H * prof;
  const rel = Math.min(1, Math.max(0, prof));
  if (s.rough) m += s.rough.amp * roughNoise(s.rough, x, z) * Math.pow(rel, 0.6);
  if (s.craterRadius && d0 < s.craterRadius) m -= (s.craterDepth ?? 0) * Math.sqrt(1 - d0 / s.craterRadius);
  // never lowers; where the profile meets the terrain the union is smooth (no wall along the
  // intersection), and the foot fades out as the profile approaches the base
  const foot = smooth(0, 0.08, rel);
  return h + (smax(h, m, 0.08 * H) - h) * foot * w;
}
