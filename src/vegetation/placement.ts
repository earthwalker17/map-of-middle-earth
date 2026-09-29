import { hash32, rand, valueNoise } from '../core/rng.ts';
import { shireFieldGrid } from '../world/fields.ts';
import type { World } from '../world/World.ts';

export { valueNoise };

/**
 * Deterministic vegetation placement: every instance is a pure function of (world seed, grid cell,
 * static world data). Nothing depends on call order or on the camera — the camera only *selects*
 * which of these precomputed instances are drawn (see VegetationSystem).
 *
 * Instance record (FLOATS_PER_INSTANCE floats, shared with the shader):
 *  [0] x  [1] z  [2] hr = horizontal crown radius (km)  [3] vr = vertical crown scale (km)
 *  [4] trunk = crown-bottom height above ground (km, may be < 0 to sink the crown)
 *  [5] kind * 8 + yaw (yaw in [0, 2π))  [6] aspect = depth/width ratio (hedges ≪ 1)
 *  [7] packed sRGB albedo  r*65536 + g*256 + b
 */
export const FLOATS_PER_INSTANCE = 8;

/** Vegetation kinds (instance palette + shader behaviour). */
export const Kind = {
  Generic: 0,
  Mirkwood: 1,
  Fangorn: 2,
  Lorien: 3,
  /** Old Forest, Chetwood, Drúadan (forests.A) — dark deciduous */
  Dark: 4,
  Ithilien: 5,
  Oak: 6,
  Hedge: 7,
  River: 8,
  Scrub: 9,
} as const;
export type Kind = (typeof Kind)[keyof typeof Kind];
export const KIND_COUNT = 10;

export interface ExclusionCircle {
  x: number;
  z: number;
  r: number;
}

/** sRGB palettes per kind (tuned against reference/film/* and docs/research landmark palettes). */
const PALETTE: Record<number, string[]> = {
  [Kind.Generic]: ['#3a5026', '#44592b', '#324823', '#4b5f2e', '#3d5530', '#475a2a', '#36502c', '#506434'],
  [Kind.Mirkwood]: ['#1f2c19', '#25321c', '#2a341c', '#1c2716', '#2e331c', '#232e1c', '#272d18'],
  [Kind.Fangorn]: ['#222b19', '#2a331e', '#333b23', '#26341f', '#3a4326', '#2e341c', '#252e20'],
  [Kind.Lorien]: ['#8a7a2e', '#9a8434', '#7e7230', '#a88e3a', '#74702e', '#b0943c', '#96803a'],
  [Kind.Dark]: ['#263a1d', '#2e4025', '#22331a', '#344322', '#2a3c21', '#213019'],
  [Kind.Ithilien]: ['#3e5a2a', '#4a622e', '#354f26', '#566532', '#44602f', '#263c22', '#50683a'],
  [Kind.Oak]: ['#3f5020', '#4b5c26', '#37481c', '#465826', '#34451c', '#52632a'],
  [Kind.Hedge]: ['#4a6a2c', '#557533', '#43622a', '#4f6e30', '#46662b'],
  [Kind.River]: ['#4a5e2b', '#405229', '#56633e', '#3a4f28', '#4f5f36'],
  [Kind.Scrub]: ['#3f5427', '#495d2c', '#364c26', '#50602f', '#425226'],
};
const MIRK_RUST = ['#33241a', '#2e2414', '#3a2a18', '#2c2616'];
const LORIEN_SAGE = ['#6f7646', '#7a7c44', '#687040'];

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const PAL_RGB: Record<number, [number, number, number][]> = Object.fromEntries(
  Object.entries(PALETTE).map(([k, v]) => [k, v.map(hexToRgb)]),
);
const RUST_RGB = MIRK_RUST.map(hexToRgb);
const SAGE_RGB = LORIEN_SAGE.map(hexToRgb);

function packColor(r: number, g: number, b: number): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return c(r) * 65536 + c(g) * 256 + c(b);
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** CPU bilinear access to the baked world masks (same data the GPU samples). */
export class WorldSampler {
  private readonly W: number;
  private readonly H: number;
  private readonly lcData: Uint8Array;
  private readonly foData: Uint8Array;
  private readonly waData: Uint8Array;
  private readonly lookData: Uint8Array;
  private readonly lookW: number;
  private readonly lookH: number;
  private readonly regionIndex = new Map<string, number>();

  constructor(readonly world: World) {
    const img = (t: { image: unknown }) => (t.image as { data: Uint8Array; width: number; height: number });
    const lc = img(world.landcover);
    this.W = lc.width;
    this.H = lc.height;
    this.lcData = lc.data;
    this.foData = img(world.forests).data;
    this.waData = img(world.water).data;
    const lk = img(world.look);
    this.lookData = lk.data;
    this.lookW = lk.width;
    this.lookH = lk.height;
    world.lookRegions.forEach((id, i) => this.regionIndex.set(id, i));
  }

  private bilinear(data: Uint8Array, w: number, h: number, x: number, z: number, ch: number, layerOffset = 0): number {
    const s = this.world.spec;
    const fx = Math.min(w - 1, Math.max(0, ((x - s.xMin) / s.width) * w - 0.5));
    const fz = Math.min(h - 1, Math.max(0, ((z - s.zMin) / s.depth) * h - 0.5));
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(w - 1, x0 + 1);
    const z1 = Math.min(h - 1, z0 + 1);
    const tx = fx - x0;
    const tz = fz - z0;
    const r0 = (layerOffset + z0 * w) * 4 + ch;
    const r1 = (layerOffset + z1 * w) * 4 + ch;
    const v00 = data[r0 + x0 * 4];
    const v10 = data[r0 + x1 * 4];
    const v01 = data[r1 + x0 * 4];
    const v11 = data[r1 + x1 * 4];
    const a = v00 + (v10 - v00) * tx;
    const b = v01 + (v11 - v01) * tx;
    return (a + (b - a) * tz) / 255;
  }

  /** landcover.R — forest density 0..1 */
  forest(x: number, z: number): number {
    return this.bilinear(this.lcData, this.W, this.H, x, z, 0);
  }
  /** forests.{R mirkwood, G fangorn, B lorien, A oldForest} */
  forestType(x: number, z: number, ch: 0 | 1 | 2 | 3): number {
    return this.bilinear(this.foData, this.W, this.H, x, z, ch);
  }
  /** water.{R riverChannel, G lake, B land, A riverValley} */
  water(x: number, z: number, ch: 0 | 1 | 2 | 3): number {
    return this.bilinear(this.waData, this.W, this.H, x, z, ch);
  }
  region(x: number, z: number, id: string): number {
    const i = this.regionIndex.get(id);
    if (i === undefined) return 0;
    const layer = i >> 2;
    return this.bilinear(this.lookData, this.lookW, this.lookH, x, z, i & 3, layer * this.lookW * this.lookH);
  }
  private nearMask: Uint8Array | null = null;
  private static readonly NEAR_BLOCK = 10; // texels (4 km)
  /** the proximity mask depends only on the landcover data → cached per mask buffer */
  private static readonly nearCache = new WeakMap<Uint8Array, Uint8Array>();

  /**
   * Conservative "is there any forest within ~6 km" test on a block grid (built once), used to
   * reject most fine-grid cells without sampling the full-resolution mask.
   */
  forestNear(x: number, z: number): boolean {
    const B = WorldSampler.NEAR_BLOCK;
    const bw = Math.ceil(this.W / B);
    const bh = Math.ceil(this.H / B);
    if (!this.nearMask) this.nearMask = WorldSampler.nearCache.get(this.lcData) ?? null;
    if (!this.nearMask) {
      const raw = new Uint8Array(bw * bh);
      for (let r = 0; r < this.H; r++)
        for (let c = 0; c < this.W; c++) if (this.lcData[(r * this.W + c) * 4] > 0) raw[((r / B) | 0) * bw + ((c / B) | 0)] = 1;
      const dil = new Uint8Array(bw * bh);
      for (let r = 0; r < bh; r++)
        for (let c = 0; c < bw; c++) {
          let v = 0;
          for (let dr = -1; dr <= 1 && !v; dr++)
            for (let dc = -1; dc <= 1 && !v; dc++) {
              const rr = r + dr;
              const cc = c + dc;
              if (rr >= 0 && rr < bh && cc >= 0 && cc < bw && raw[rr * bw + cc]) v = 1;
            }
          dil[r * bw + c] = v;
        }
      this.nearMask = dil;
      WorldSampler.nearCache.set(this.lcData, dil);
    }
    const s = this.world.spec;
    const c = Math.floor((((x - s.xMin) / s.width) * this.W) / B);
    const r = Math.floor((((z - s.zMin) / s.depth) * this.H) / B);
    if (c < 0 || r < 0 || c >= bw || r >= bh) return false;
    return this.nearMask[r * bw + c] === 1;
  }

  height(x: number, z: number): number {
    return this.world.heights.sample(x, z);
  }
  /** 1 - normal.y of the heightfield (0 flat … 1 vertical) */
  slope(x: number, z: number): number {
    const e = 0.8;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    const ny = (2 * e) / Math.hypot(hx, 2 * e, hz);
    return 1 - ny;
  }
}

/** How much a region supports trees outside mapped forests (0 barren … 1 lush). */
const FERTILE: Record<string, number> = {
  eriador: 0.8,
  lindon: 0.9,
  north: 0.25,
  shire: 1,
  enedwaith: 0.5,
  rhovanion: 0.7,
  mirkwood: 0.8,
  wilderland: 0.6,
  'brown-lands': 0.03,
  lorien: 1,
  fangorn: 1,
  rohan: 0.3,
  gondor: 1,
  ithilien: 1,
  dagorlad: 0,
  mordor: 0,
  nurn: 0.1,
  rhun: 0.25,
  harad: 0.15,
};

/** Growable list of instance records (FLOATS_PER_INSTANCE numbers each). */
export class InstanceList {
  data: number[] = [];
  get count(): number {
    return this.data.length / FLOATS_PER_INSTANCE;
  }
  push(x: number, z: number, hr: number, vr: number, trunk: number, kind: Kind, yaw: number, aspect: number, rgb: [number, number, number]): void {
    const y = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    this.data.push(x, z, hr, vr, trunk, kind * 8 + Math.min(y, 6.28), aspect, packColor(rgb[0], rgb[1], rgb[2]));
  }
}

export interface PlacementOptions {
  /** quality density 0..1 */
  density: number;
  seed: number;
  exclusions: ExclusionCircle[];
}

export interface PlacementResult {
  /** always-drawn instances: forest canopy, hedgerows, isolated trees, river and Ithilien woods */
  coarse: InstanceList;
  /** near-camera detail band: fill trees inside forests, edge scrub, sparse singles */
  fine: InstanceList;
  coarseCell: number;
  fineCell: number;
}

/** Colour pick: palette entry by hash, brightness/hue jitter, regional low-frequency variation. */
function pickColor(kind: Kind, seed: number, id: number, x: number, z: number): [number, number, number] {
  let pal = PAL_RGB[kind];
  const r0 = rand(seed, id, 11);
  if (kind === Kind.Mirkwood) {
    // rust/ochre crowns cluster in patches (the canopy of the Desolation-of-Smaug butterfly scene)
    const patch = valueNoise(x / 22, z / 22, seed + 5);
    if (rand(seed, id, 12) < 0.01 + 0.07 * smooth(0.6, 0.9, patch)) pal = RUST_RGB;
  } else if (kind === Kind.Lorien && rand(seed, id, 12) < 0.03) pal = SAGE_RGB;
  const c = pal[Math.floor(r0 * pal.length) % pal.length];
  const regional = 0.9 + 0.2 * valueNoise(x / 30, z / 30, seed + 9);
  const spread = kind === Kind.Lorien ? 0.36 : kind === Kind.Fangorn ? 0.26 : 0.22;
  const bright = (1.0 - spread * 0.55 + spread * rand(seed, id, 13)) * regional;
  const warm = (rand(seed, id, 14) - 0.5) * 0.12;
  return [c[0] * bright * (1 + warm), c[1] * bright, c[2] * bright * (1 - warm * 1.5)];
}

function excluded(ex: ExclusionCircle[], x: number, z: number, r: number): boolean {
  for (const c of ex) {
    const dx = x - c.x;
    const dz = z - c.z;
    const rr = c.r + r;
    if (dx * dx + dz * dz < rr * rr) return true;
  }
  return false;
}

/** Forest kind at a point from the forests type mask. */
function forestKind(s: WorldSampler, x: number, z: number): Kind {
  const m = s.forestType(x, z, 0);
  const f = s.forestType(x, z, 1);
  const l = s.forestType(x, z, 2);
  const o = s.forestType(x, z, 3);
  const best = Math.max(m, f, l, o);
  if (best < 0.2) return Kind.Generic;
  if (best === m) return Kind.Mirkwood;
  if (best === f) return Kind.Fangorn;
  if (best === l) return Kind.Lorien;
  return Kind.Dark;
}

function fertility(s: WorldSampler, x: number, z: number): number {
  let f = 0;
  for (const id of s.world.lookRegions) {
    const w = s.region(x, z, id);
    if (w > 0) f += w * (FERTILE[id] ?? 0.5);
  }
  return f;
}

/** Crown proportions per forest kind (relative to the grid cell). */
function crownFor(kind: Kind, cell: number, seed: number, id: number): { hr: number; vr: number; trunk: number } {
  const a = rand(seed, id, 21);
  const b = rand(seed, id, 22);
  let hr: number;
  let vr: number;
  let trunk: number;
  switch (kind) {
    case Kind.Mirkwood:
      // tall, closed, flat-topped: big overlapping crowns of even height
      hr = cell * (0.74 + 0.16 * a);
      vr = hr * (0.98 + 0.14 * b);
      trunk = -0.22 * vr;
      break;
    case Kind.Fangorn:
      hr = cell * (0.64 + 0.28 * a);
      vr = hr * (0.85 + 0.45 * b);
      trunk = -0.2 * vr;
      break;
    case Kind.Lorien: {
      const giant = rand(seed, id, 23) < 0.22;
      hr = cell * (0.7 + 0.2 * a) * (giant ? 1.25 : 1);
      vr = hr * (0.95 + 0.25 * b) * (giant ? 1.15 : 1);
      trunk = hr * (giant ? 0.5 : 0.1 + 0.15 * a);
      break;
    }
    case Kind.Dark:
      hr = cell * (0.68 + 0.18 * a);
      vr = hr * (0.9 + 0.15 * b);
      trunk = -0.2 * vr;
      break;
    default:
      hr = cell * (0.66 + 0.18 * a);
      vr = hr * (0.8 + 0.2 * b);
      trunk = -0.18 * vr;
  }
  return { hr, vr, trunk };
}

const TREELINE = 23;

/**
 * Place all vegetation. Pure function of (world data, options).
 */
export function placeVegetation(world: World, opts: PlacementOptions): PlacementResult {
  const s = new WorldSampler(world);
  const spec = world.spec;
  const seed = opts.seed;
  const ex = opts.exclusions;
  const dens = Math.max(0.1, Math.min(1, opts.density));
  const coarseCell = Math.min(3.6, 2.0 / Math.sqrt(dens));
  const fineCell = Math.min(2.4, 1.15 / Math.sqrt(dens));
  const coarse = new InstanceList();
  const fine = new InstanceList();
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------------ forest canopy (coarse grid)
  {
    const c = coarseCell;
    const nx = Math.ceil(spec.width / c);
    const nz = Math.ceil(spec.depth / c);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        if (!s.forestNear(spec.xMin + (i + 0.5) * c, spec.zMin + (j + 0.5) * c)) continue;
        const id = hash32(i, j, 101);
        const x = spec.xMin + (i + 0.12 + 0.76 * rand(seed, id, 1)) * c;
        const z = spec.zMin + (j + 0.12 + 0.76 * rand(seed, id, 2)) * c;
        // dithered edge: sample the mask at a jittered offset so edges break up organically
        const ox = (rand(seed, id, 3) - 0.5) * 2.6;
        const oz = (rand(seed, id, 4) - 0.5) * 2.6;
        const f = s.forest(x + ox, z + oz);
        if (f < 0.5) continue;
        if (s.forest(x, z) < 0.05 && rand(seed, id, 5) < 0.6) continue;
        if (s.water(x, z, 0) > 0.35 || s.water(x, z, 1) > 0.25 || s.water(x, z, 2) < 0.5) continue;
        const h = s.height(x, z);
        if (h < 0.15 || h > TREELINE + 3 * valueNoise(x / 9, z / 9, seed + 3)) continue;
        if (s.slope(x, z) > 0.55) continue;
        const kind = forestKind(s, x, z);
        const cr = crownFor(kind, c, seed, id);
        // smaller, lower crowns towards the forest edge
        const edge = Math.min(s.forest(x + 2.5, z), s.forest(x - 2.5, z), s.forest(x, z + 2.5), s.forest(x, z - 2.5));
        const es = 0.72 + 0.28 * edge;
        if (excluded(ex, x, z, cr.hr * es)) continue;
        coarse.push(x, z, cr.hr * es, cr.vr * es, cr.trunk * es, kind, rand(seed, id, 6) * TAU, 0.85 + 0.3 * rand(seed, id, 7), pickColor(kind, seed, id, x, z));
      }
  }

  // ------------------------------------------------------------------ Shire & Bree-land hedgerows + oaks
  {
    const bree = world.places.get('bree');
    const hedgeWeight = (x: number, z: number) => {
      let w = smooth(0.18, 0.42, s.region(x, z, 'shire'));
      if (bree) w = Math.max(w, 1 - smooth(16, 30, Math.hypot(x - bree.x, z - bree.z)));
      return w;
    };
    // the field lattice is shared with the terrain's field mask (src/world/fields.ts)
    const { n, vert } = shireFieldGrid(spec, seed);
    const landOk = (x: number, z: number) =>
      s.water(x, z, 2) > 0.5 && s.water(x, z, 0) < 0.25 && s.water(x, z, 1) < 0.2 && s.forest(x, z) < 0.4 && s.slope(x, z) < 0.3 && s.height(x, z) > 0.3;
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        const A = vert(i, j);
        for (const [di, dj, k] of [
          [1, 0, 1],
          [0, 1, 2],
        ] as const) {
          const B = vert(i + di, j + dj);
          const mx = (A[0] + B[0]) / 2;
          const mz = (A[1] + B[1]) / 2;
          const w = hedgeWeight(mx, mz);
          if (w <= 0.02) continue;
          const eid = hash32(i, j, k, 203);
          if (rand(seed, eid, 1) > 0.76 * w) continue;
          const dx = B[0] - A[0];
          const dz = B[1] - A[1];
          const len = Math.hypot(dx, dz);
          const segs = Math.max(1, Math.round(len / 1.7));
          const yaw = Math.atan2(-dz, dx); // local +x along the edge after rotation by yaw about +Y
          for (let q = 0; q < segs; q++) {
            // leave occasional gaps (gateways)
            if (rand(seed, eid, 10 + q) < 0.06) continue;
            const t = (q + 0.5) / segs;
            const px = A[0] + dx * t + (rand(seed, eid, 30 + q) - 0.5) * 0.12;
            const pz = A[1] + dz * t + (rand(seed, eid, 50 + q) - 0.5) * 0.12;
            if (!landOk(px, pz)) continue;
            const halfLen = (len / segs) * 0.5 * 1.4;
            if (excluded(ex, px, pz, halfLen)) continue;
            const width = 0.17 + 0.05 * rand(seed, eid, 70 + q);
            const hid = hash32(eid, q);
            coarse.push(px, pz, halfLen, 0.09 + 0.04 * rand(seed, eid, 90 + q), -0.03, Kind.Hedge, yaw, width / halfLen, pickColor(Kind.Hedge, seed, hid, px, pz));
          }
          // hedgerow oaks
          const oaks = rand(seed, eid, 5) < 0.45 * w ? 1 + Math.floor(rand(seed, eid, 6) * 2) : 0;
          for (let q = 0; q < oaks; q++) {
            const t = 0.15 + 0.7 * rand(seed, eid, 110 + q);
            const px = A[0] + dx * t;
            const pz = A[1] + dz * t;
            if (!landOk(px, pz)) continue;
            const hr = 0.55 + 0.35 * rand(seed, eid, 120 + q);
            if (excluded(ex, px, pz, hr)) continue;
            const oid = hash32(eid, q, 7);
            coarse.push(px, pz, hr, hr * (0.78 + 0.15 * rand(seed, oid, 1)), 0.28 + 0.2 * rand(seed, oid, 2), Kind.Oak, rand(seed, oid, 3) * TAU, 0.9 + 0.2 * rand(seed, oid, 4), pickColor(Kind.Oak, seed, oid, px, pz));
          }
        }
        // copses inside fields
        const A2 = vert(i, j);
        const C = vert(i + 1, j + 1);
        const fx = (A2[0] + C[0]) / 2;
        const fz = (A2[1] + C[1]) / 2;
        const fw = hedgeWeight(fx, fz);
        const fid = hash32(i, j, 204);
        if (fw > 0.05 && rand(seed, fid, 1) < 0.16 * fw) {
          const count = 3 + Math.floor(rand(seed, fid, 2) * 5);
          for (let q = 0; q < count; q++) {
            const a = rand(seed, fid, 10 + q) * TAU;
            const rr = Math.sqrt(rand(seed, fid, 20 + q)) * 1.6;
            const px = fx + Math.cos(a) * rr;
            const pz = fz + Math.sin(a) * rr;
            if (!landOk(px, pz)) continue;
            const hr = 0.5 + 0.35 * rand(seed, fid, 30 + q);
            if (excluded(ex, px, pz, hr)) continue;
            const oid = hash32(fid, q, 9);
            coarse.push(px, pz, hr, hr * (0.8 + 0.2 * rand(seed, oid, 1)), 0.15 + 0.2 * rand(seed, oid, 2), Kind.Oak, rand(seed, oid, 3) * TAU, 0.9 + 0.2 * rand(seed, oid, 4), pickColor(Kind.Oak, seed, oid, px, pz));
          }
        }
      }
  }

  // ------------------------------------------------------------------ Ithilien woodland (groves and glades)
  const ithilienGrove = (x: number, z: number) => smooth(0.32, 0.62, valueNoise(x / 13, z / 13, seed + 17));
  {
    const c = 2.6 / Math.sqrt(Math.max(0.35, dens));
    const [x0, z0] = spec.kmToWorld(1100, 760);
    const [x1, z1] = spec.kmToWorld(1215, 560);
    for (let j = 0; j < Math.ceil((z1 - z0) / c); j++)
      for (let i = 0; i < Math.ceil((x1 - x0) / c); i++) {
        const id = hash32(i, j, 301);
        const x = x0 + (i + rand(seed, id, 1)) * c;
        const z = z0 + (j + rand(seed, id, 2)) * c;
        const w = s.region(x, z, 'ithilien');
        if (w < 0.05) continue;
        const p = 0.95 * w * (0.08 + 0.92 * ithilienGrove(x, z));
        if (rand(seed, id, 3) > p) continue;
        if (s.forest(x, z) > 0.4 || s.water(x, z, 2) < 0.5 || s.water(x, z, 0) > 0.25) continue;
        const h = s.height(x, z);
        if (h < 0.2 || h > 17 || s.slope(x, z) > 0.34) continue;
        const hr = c * (0.45 + 0.25 * rand(seed, id, 4));
        if (excluded(ex, x, z, hr)) continue;
        coarse.push(x, z, hr, hr * (0.8 + 0.3 * rand(seed, id, 5)), 0.05 + 0.15 * rand(seed, id, 6), Kind.Ithilien, rand(seed, id, 7) * TAU, 0.85 + 0.3 * rand(seed, id, 8), pickColor(Kind.Ithilien, seed, id, x, z));
      }
  }

  // ------------------------------------------------------------------ river-valley trees (sparse, along banks)
  const nearChannel = (x: number, z: number) => {
    let m = s.water(x, z, 0);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      m = Math.max(m, s.water(x + Math.cos(a) * 2.4, z + Math.sin(a) * 2.4, 0));
    }
    return m;
  };
  {
    const c = 3.0 / Math.sqrt(Math.max(0.35, dens));
    const nx = Math.ceil(spec.width / c);
    const nz = Math.ceil(spec.depth / c);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const id = hash32(i, j, 401);
        const x = spec.xMin + (i + rand(seed, id, 1)) * c;
        const z = spec.zMin + (j + rand(seed, id, 2)) * c;
        const valley = s.water(x, z, 3);
        if (valley < 0.3) continue;
        const r = rand(seed, id, 3);
        if (r > 0.5) continue; // cheap early-out before the expensive tests
        if (s.water(x, z, 0) > 0.2 || s.water(x, z, 1) > 0.2 || s.water(x, z, 2) < 0.5 || s.forest(x, z) > 0.3) continue;
        const bank = nearChannel(x, z);
        const p = (0.42 * smooth(0.2, 0.7, bank) + 0.05 * valley) * Math.min(1, fertility(s, x, z));
        if (r > p) continue;
        const h = s.height(x, z);
        if (h < 0.2 || h > 18 || s.slope(x, z) > 0.3) continue;
        const hr = 0.5 + 0.4 * rand(seed, id, 4);
        if (excluded(ex, x, z, hr)) continue;
        coarse.push(x, z, hr, hr * (0.85 + 0.25 * rand(seed, id, 5)), 0.12 + 0.18 * rand(seed, id, 6), Kind.River, rand(seed, id, 7) * TAU, 0.85 + 0.3 * rand(seed, id, 8), pickColor(Kind.River, seed, id, x, z));
      }
  }

  // ------------------------------------------------------------------ near-camera detail band (fine grid)
  {
    const c = fineCell;
    const nx = Math.ceil(spec.width / c);
    const nz = Math.ceil(spec.depth / c);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const id = hash32(i, j, 501);
        // cheap rejection first (most of the map is open country): only cells near a forest can
        // host fill trees; elsewhere only the sparse-singles branch (r < 0.2) survives
        const r = rand(seed, id, 3);
        if (r > 0.62) continue;
        const cx0 = spec.xMin + (i + 0.5) * c;
        const cz0 = spec.zMin + (j + 0.5) * c;
        const nearForest = s.forestNear(cx0, cz0);
        if (!nearForest && r > 0.2) continue;
        const x = spec.xMin + (i + rand(seed, id, 1)) * c;
        const z = spec.zMin + (j + rand(seed, id, 2)) * c;
        const ox = (rand(seed, id, 4) - 0.5) * 3.6;
        const oz = (rand(seed, id, 5) - 0.5) * 3.6;
        const fd = nearForest ? s.forest(x + ox, z + oz) : 0;
        let kind: Kind;
        let hr: number;
        let vr: number;
        let trunk: number;
        if (fd >= 0.5) {
          // understory / fill between the big crowns, and a softer ragged forest edge
          if (r > 0.62) continue;
          if (s.water(x, z, 0) > 0.3 || s.water(x, z, 1) > 0.2 || s.water(x, z, 2) < 0.5) continue;
          const h = s.height(x, z);
          if (h < 0.15 || h > TREELINE || s.slope(x, z) > 0.55) continue;
          kind = forestKind(s, x + ox, z + oz);
          const inside = s.forest(x, z) > 0.5;
          hr = c * (inside ? 0.42 + 0.28 * rand(seed, id, 6) : 0.3 + 0.25 * rand(seed, id, 6));
          vr = hr * (kind === Kind.Lorien ? 1.2 : kind === Kind.Mirkwood ? 1.0 : 0.8) * (0.8 + 0.3 * rand(seed, id, 7));
          trunk = inside ? -0.1 * vr : 0.05 + 0.1 * rand(seed, id, 8);
        } else {
          // sparse singles in fertile open country, plus river-bank and Ithilien fill
          if (r > 0.2) continue;
          const valley = s.water(x, z, 3);
          const ith = s.region(x, z, 'ithilien');
          if (r > 0.03 && valley <= 0.3 && ith <= 0.05) continue; // cheap reject: p ≤ 0.03 here
          let p = 0.03 * smooth(0.5, 0.85, valueNoise(x / 9, z / 9, seed + 29));
          if (valley > 0.3) p += 0.1 * smooth(0.2, 0.7, nearChannel(x, z));
          if (ith > 0.05) p += 0.16 * ith * ithilienGrove(x, z);
          if (r > p) continue;
          if (s.water(x, z, 0) > 0.2 || s.water(x, z, 1) > 0.2 || s.water(x, z, 2) < 0.5) continue;
          const fert = fertility(s, x, z);
          if (rand(seed, id, 9) > fert) continue;
          const h = s.height(x, z);
          if (h < 0.2 || h > 18 || s.slope(x, z) > 0.32) continue;
          kind = ith > 0.3 ? Kind.Ithilien : valley > 0.3 ? Kind.River : Kind.Scrub;
          hr = 0.38 + 0.35 * rand(seed, id, 6);
          vr = hr * (0.8 + 0.3 * rand(seed, id, 7));
          trunk = 0.15 + 0.2 * rand(seed, id, 8);
        }
        if (excluded(ex, x, z, hr)) continue;
        fine.push(x, z, hr, vr, trunk, kind, rand(seed, id, 10) * TAU, 0.85 + 0.3 * rand(seed, id, 11), pickColor(kind, seed, id, x, z));
      }
  }

  return { coarse, fine, coarseCell, fineCell };
}
