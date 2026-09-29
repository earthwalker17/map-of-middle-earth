import { hash32, rand, valueNoise } from '../core/rng.ts';
import { fieldWeight, shireFieldGrid } from '../world/fields.ts';
import type { World } from '../world/World.ts';

export { valueNoise };

/**
 * Deterministic vegetation placement: every instance is a pure function of (world seed, grid cell,
 * static world data). Nothing depends on call order or on the camera — the camera only *selects*
 * which of these precomputed instances are drawn (see VegetationSystem).
 *
 * An instance is one CLUSTER of seven sub-crowns (clumpGeometry.ts): a patch of forest canopy
 * (spread 1), a single tree (spread ≈ 0.3–0.5, the sub-crowns merge into one lumpy crown) or a
 * hedge segment (aspect ≪ 1).
 *
 * Instance record (FLOATS_PER_INSTANCE floats, shared with the shader):
 *  [0] x  [1] z  [2] hr = horizontal cluster radius (km)  [3] vr = vertical crown scale (km)
 *  [4] trunk = crown-bottom height above ground (km, may be < 0 to sink the crown)
 *  [5] kind * 8 + yaw (yaw in [0, 2π))  [6] aspect = depth/width ratio (hedges ≪ 1)
 *  [7] packed sRGB albedo  r*65536 + g*256 + b
 *  [8] shape = spread + 2·round(gap·50)  (spread in [0.2, 1]: sub-crown spacing; gap: drop
 *      probability of each ring sub-crown)
 *  [9] hVar = sub-crown height variation (unit cluster space, 0..1)
 */
export const FLOATS_PER_INSTANCE = 10;

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

/**
 * sRGB palettes per kind (tuned in renders under the atmosphere against reference/film/*: Mirkwood
 * dark green-black, Fangorn olive-moss, the Old Forest dark, Lórien autumn gold, Ithilien verdant,
 * Shire / Eriador deciduous greens).
 */
const PALETTE: Record<number, string[]> = {
  [Kind.Generic]: ['#3c5427', '#465c2c', '#354b24', '#4d612f', '#3f5731', '#495d2b', '#38522d', '#526736'],
  [Kind.Mirkwood]: ['#2b3a25', '#2f3d24', '#344127', '#283621', '#384128', '#2e3a24', '#323b22'],
  [Kind.Fangorn]: ['#323f25', '#3a462c', '#414c2b', '#344128', '#47502e', '#3c4422', '#303a29'],
  [Kind.Lorien]: ['#a88c2c', '#b89a30', '#96822a', '#c4a436', '#8a8430', '#caa83a', '#a48e34', '#7f8a36', '#909434'],
  [Kind.Dark]: ['#2d4124', '#34472b', '#2a3b22', '#3a4a29', '#304227', '#283820'],
  [Kind.Ithilien]: ['#3f5c2a', '#4b652f', '#375327', '#58693a', '#46632f', '#2f4a26', '#52693a'],
  [Kind.Oak]: ['#3f5421', '#4b5e27', '#38491d', '#475a27', '#36481d', '#53652b', '#5a6a30'],
  [Kind.Hedge]: ['#34481f', '#3b5023', '#2f431d', '#40552a', '#374b22'],
  [Kind.River]: ['#4a5e2b', '#405229', '#56633e', '#3a4f28', '#4f5f36'],
  [Kind.Scrub]: ['#3f5427', '#495d2c', '#364c26', '#50602f', '#425226'],
};
/** Mirkwood's older stands: muted bronze-olive patches (never isolated red crowns) */
const MIRK_BRONZE = ['#3c3c26', '#403b25', '#383924', '#3d3d24'];
const LORIEN_SAGE = ['#6f7646', '#7a7c44', '#687040'];
/** Ithilien's dark cypresses and cedars */
const CYPRESS = ['#233a22', '#2a4226', '#1f351f'];

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const PAL_RGB: Record<number, [number, number, number][]> = Object.fromEntries(
  Object.entries(PALETTE).map(([k, v]) => [k, v.map(hexToRgb)]),
);
const BRONZE_RGB = MIRK_BRONZE.map(hexToRgb);
const SAGE_RGB = LORIEN_SAGE.map(hexToRgb);
const CYPRESS_RGB = CYPRESS.map(hexToRgb);

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
  /** raw (bilinear, un-normalised) look-region weight — the value fields.ts fieldWeight expects */
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

/**
 * Where nothing grows, whatever the masks say (0 … 1 = no trees): Mordor (Gorgoroth, the
 * Morgai), Dagorlad and the Morannon, the Dead Marshes; sparse in the Brown Lands, the Emyn Muil,
 * Nurn and Harad. From the look-region weights plus declared place radii (km, full → none).
 */
const BARREN_REGION: Record<string, number> = { mordor: 1, dagorlad: 1, 'brown-lands': 0.85, nurn: 0.8, harad: 0.55 };
const BARREN_PLACE: { id: string; full: number; none: number; b: number }[] = [
  { id: 'black-gate', full: 42, none: 58, b: 1 },
  { id: 'dead-marshes', full: 20, none: 34, b: 0.95 },
  { id: 'emyn-muil', full: 24, none: 38, b: 0.85 },
  { id: 'minas-morgul', full: 8, none: 14, b: 1 },
];

class Barren {
  private readonly places: { x: number; z: number; full: number; none: number; b: number }[] = [];
  constructor(private readonly s: WorldSampler) {
    for (const p of BARREN_PLACE) {
      const pl = s.world.places.get(p.id);
      if (pl) this.places.push({ x: pl.x, z: pl.z, full: p.full, none: p.none, b: p.b });
    }
  }
  at(x: number, z: number): number {
    let b = 0;
    for (const id in BARREN_REGION) b = Math.max(b, smooth(0.25, 0.6, this.s.region(x, z, id)) * BARREN_REGION[id]);
    for (const p of this.places) b = Math.max(b, p.b * (1 - smooth(p.full, p.none, Math.hypot(x - p.x, z - p.z))));
    return b;
  }
}

/** Growable list of instance records (FLOATS_PER_INSTANCE numbers each). */
export class InstanceList {
  data: number[] = [];
  get count(): number {
    return this.data.length / FLOATS_PER_INSTANCE;
  }
  push(x: number, z: number, hr: number, vr: number, trunk: number, kind: Kind, yaw: number, aspect: number, rgb: [number, number, number], shape: Shape): void {
    const y = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const spread = Math.max(0.2, Math.min(0.999, shape.spread));
    const gapQ = Math.round(Math.max(0, Math.min(0.9, shape.gap)) * 50);
    this.data.push(x, z, hr, vr, trunk, kind * 8 + Math.min(y, 6.28), aspect, packColor(rgb[0], rgb[1], rgb[2]), spread + 2 * gapQ, Math.max(0, Math.min(1, shape.hVar)));
  }
}

/** Cluster shape of one instance (see clumpGeometry.ts). */
export interface Shape {
  spread: number;
  gap: number;
  hVar: number;
}

export interface PlacementOptions {
  /** quality density 0..1 */
  density: number;
  seed: number;
  exclusions: ExclusionCircle[];
}

export interface PlacementResult {
  /** always-drawn instances: forest canopy, hedgerows, field / river / Ithilien trees, mallorns */
  coarse: InstanceList;
  /** near-camera detail band: fill trees inside forests, edge trees, sparse singles */
  fine: InstanceList;
  coarseCell: number;
  fineCell: number;
}

type RGB = [number, number, number];

/** Colour pick: palette entry by hash, brightness/hue jitter, regional low-frequency variation. */
function pickColor(kind: Kind, seed: number, id: number, x: number, z: number, pal: RGB[] = PAL_RGB[kind]): RGB {
  const r0 = rand(seed, id, 11);
  if (kind === Kind.Mirkwood) {
    // older bronze-olive stands in coherent patches (never isolated red crowns)
    const patch = valueNoise(x / 26, z / 26, seed + 5);
    if (rand(seed, id, 12) < 0.4 * smooth(0.64, 0.9, patch)) pal = BRONZE_RGB;
  } else if (kind === Kind.Lorien && rand(seed, id, 12) < 0.05) pal = SAGE_RGB;
  const c = pal[Math.floor(r0 * pal.length) % pal.length];
  // stands: low-frequency tone so wide shots read texture instead of a flat carpet
  const regional = 0.86 + 0.28 * valueNoise(x / 19, z / 19, seed + 9);
  const spread = kind === Kind.Lorien ? 0.3 : kind === Kind.Fangorn ? 0.24 : 0.2;
  const bright = (1.0 - spread * 0.55 + spread * rand(seed, id, 13)) * regional;
  const warm = (rand(seed, id, 14) - 0.5) * 0.1;
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
  // a low threshold: the type masks fade out at the forest edges, where a lighter generic crown
  // would dot the dark forests' rims
  if (best < 0.08) return Kind.Generic;
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

interface Crown {
  hr: number;
  vr: number;
  trunk: number;
  shape: Shape;
}

/**
 * Canopy patch proportions per forest kind (relative to the grid cell). A patch is seven crowns of
 * about 0.4·hr radius; neighbouring patches interleave into a closed canopy.
 */
function canopyFor(kind: Kind, cell: number, seed: number, id: number): Crown {
  const a = rand(seed, id, 21);
  const b = rand(seed, id, 22);
  switch (kind) {
    case Kind.Mirkwood: {
      // tall, closed, even canopy of dense crowns
      const hr = cell * (0.86 + 0.12 * a);
      const vr = hr * (0.92 + 0.15 * b);
      return { hr, vr, trunk: -0.12 * vr, shape: { spread: 1, gap: 0.04, hVar: 0.14 } };
    }
    case Kind.Fangorn: {
      // ancient, ragged: crowns of very different height, more holes
      const hr = cell * (0.74 + 0.2 * a);
      const vr = hr * (0.9 + 0.45 * b);
      return { hr, vr, trunk: -0.1 * vr, shape: { spread: 0.95, gap: 0.12, hVar: 0.38 } };
    }
    case Kind.Lorien: {
      const hr = cell * (0.76 + 0.14 * a);
      const vr = hr * (1.0 + 0.25 * b);
      return { hr, vr, trunk: -0.08 * vr, shape: { spread: 1, gap: 0.1, hVar: 0.3 } };
    }
    case Kind.Dark: {
      const hr = cell * (0.74 + 0.16 * a);
      const vr = hr * (0.9 + 0.25 * b);
      return { hr, vr, trunk: -0.1 * vr, shape: { spread: 0.95, gap: 0.1, hVar: 0.26 } };
    }
    default: {
      const hr = cell * (0.72 + 0.16 * a);
      const vr = hr * (0.85 + 0.25 * b);
      return { hr, vr, trunk: -0.1 * vr, shape: { spread: 0.95, gap: 0.12, hVar: 0.26 } };
    }
  }
}

/** Canopy top above the ground (km) of a patch (for emergent trees rising above it). */
function canopyTop(c: Crown): number {
  return c.trunk + c.vr * 0.62;
}

/**
 * One broadleaf tree: oak (broad, spreading, short bole), beech (round dome) or elm (tall, narrow
 * vase), scaled by `size` (≈ horizontal crown radius, km).
 */
function broadleaf(seed: number, id: number, size: number): Crown {
  const t = rand(seed, id, 31);
  const a = rand(seed, id, 32);
  const b = rand(seed, id, 33);
  if (t < 0.5) {
    const hr = size * (0.95 + 0.25 * a);
    const vr = hr * (0.72 + 0.14 * b);
    return { hr, vr, trunk: vr * (0.45 + 0.15 * a), shape: { spread: 0.62, gap: 0.14, hVar: 0.4 } };
  }
  if (t < 0.82) {
    const hr = size * (0.85 + 0.2 * a);
    const vr = hr * (0.9 + 0.16 * b);
    return { hr, vr, trunk: vr * (0.36 + 0.12 * a), shape: { spread: 0.5, gap: 0.06, hVar: 0.26 } };
  }
  const hr = size * (0.62 + 0.14 * a);
  const vr = hr * (1.4 + 0.35 * b);
  return { hr, vr, trunk: vr * (0.34 + 0.1 * a), shape: { spread: 0.42, gap: 0.08, hVar: 0.34 } };
}

/** base of the tree line (world units; the alpine zone of the terrain starts ≈ 20) */
const TREELINE = 22;

/**
 * Place all vegetation. Pure function of (world data, options).
 */
export function placeVegetation(world: World, opts: PlacementOptions): PlacementResult {
  const s = new WorldSampler(world);
  const barren = new Barren(s);
  const spec = world.spec;
  const seed = opts.seed;
  const ex = opts.exclusions;
  const dens = Math.max(0.1, Math.min(1, opts.density));
  const coarseCell = Math.min(3.6, 2.0 / Math.sqrt(dens));
  const fineCell = Math.min(2.4, 1.15 / Math.sqrt(dens));
  const coarse = new InstanceList();
  const fine = new InstanceList();
  const TAU = Math.PI * 2;
  /** tree line with a ragged edge; 0 below the thinning zone … 1 at the line */
  const alpine = (x: number, z: number, h: number) => smooth(TREELINE - 6, TREELINE + 3 * valueNoise(x / 9, z / 9, seed + 3), h);
  /** glades: clearings of a few km inside the forests */
  const glade = (x: number, z: number) => 0.62 * valueNoise(x / 9, z / 9, seed + 61) + 0.38 * valueNoise(x / 3.4, z / 3.4, seed + 62);

  // ------------------------------------------------------------------ forest canopy (coarse grid)
  const lorienCanopy: { x: number; z: number; top: number }[] = [];
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
        if (h < 0.15) continue;
        const al = alpine(x, z, h);
        if (al >= 1 || rand(seed, id, 8) < 0.75 * al) continue;
        if (s.slope(x, z) > 0.55) continue;
        if (rand(seed, id, 9) < barren.at(x, z)) continue;
        const kind = forestKind(s, x, z);
        const gT = kind === Kind.Mirkwood ? 0.24 : kind === Kind.Fangorn ? 0.2 : kind === Kind.Lorien ? 0.22 : 0.23;
        if (rand(seed, id, 10) > smooth(gT - 0.05, gT + 0.05, glade(x, z))) continue;
        const cr = canopyFor(kind, c, seed, id);
        // ragged edges: smaller, lower, more open patches with crowns pulled in towards the forest edge
        const edge = Math.min(s.forest(x + 2.5, z), s.forest(x - 2.5, z), s.forest(x, z + 2.5), s.forest(x, z - 2.5));
        const es = (0.78 + 0.22 * edge) * (1 - 0.3 * al);
        // stands of different age: low-frequency canopy height
        const stand = 0.82 + 0.36 * valueNoise(x / 14, z / 14, seed + 63);
        const hr = cr.hr * es;
        if (excluded(ex, x, z, hr)) continue;
        const vr = cr.vr * es * stand * (1 - 0.25 * al);
        const shape: Shape = {
          spread: cr.shape.spread * (0.86 + 0.14 * edge),
          gap: cr.shape.gap + 0.2 * (1 - edge) + 0.3 * al,
          hVar: cr.shape.hVar,
        };
        const trunk = cr.trunk * es;
        coarse.push(x, z, hr, vr, trunk, kind, rand(seed, id, 6) * TAU, 0.85 + 0.3 * rand(seed, id, 7), pickColor(kind, seed, id, x, z), shape);
        if (kind === Kind.Lorien && edge > 0.6) lorienCanopy.push({ x, z, top: canopyTop({ ...cr, vr, trunk }) });
      }
  }

  // ------------------------------------------------------------------ Lórien: emergent mallorns
  // silver columns with golden crowns rising above the canopy, on a sparse lattice of the patches
  for (let k = 0; k < lorienCanopy.length; k++) {
    const p = lorienCanopy[k];
    const id = hash32(Math.round(p.x * 100), Math.round(p.z * 100), 111);
    if (rand(seed, id, 1) > 0.15) continue;
    const x = p.x + (rand(seed, id, 2) - 0.5) * coarseCell * 0.6;
    const z = p.z + (rand(seed, id, 3) - 0.5) * coarseCell * 0.6;
    const hr = coarseCell * (0.42 + 0.14 * rand(seed, id, 4));
    if (excluded(ex, x, z, hr)) continue;
    const vr = hr * (1.6 + 0.4 * rand(seed, id, 5));
    const trunk = p.top * (1.0 + 0.25 * rand(seed, id, 6));
    coarse.push(x, z, hr, vr, trunk, Kind.Lorien, rand(seed, id, 7) * TAU, 0.9 + 0.2 * rand(seed, id, 8), pickColor(Kind.Lorien, seed, id, x, z), {
      spread: 0.6,
      gap: 0.04,
      hVar: 0.9,
    });
  }

  // ------------------------------------------------------------------ Shire & Bree-land hedgerows + field trees
  {
    const bree = world.places.get('bree');
    // one rule with the terrain's field colouring (src/world/fields.ts)
    const hedgeWeight = (x: number, z: number) => fieldWeight(s.region(x, z, 'shire'), bree ? Math.hypot(x - bree.x, z - bree.z) : Infinity);
    const { n, vert } = shireFieldGrid(spec, seed);
    const landOk = (x: number, z: number) =>
      s.water(x, z, 2) > 0.5 && s.water(x, z, 0) < 0.25 && s.water(x, z, 1) < 0.2 && s.forest(x, z) < 0.4 && s.slope(x, z) < 0.3 && s.height(x, z) > 0.3;
    const tree = (px: number, pz: number, size: number, tid: number, list: InstanceList) => {
      const t = broadleaf(seed, tid, size);
      if (excluded(ex, px, pz, t.hr)) return;
      list.push(px, pz, t.hr, t.vr, t.trunk, Kind.Oak, rand(seed, tid, 3) * TAU, 0.85 + 0.25 * rand(seed, tid, 4), pickColor(Kind.Oak, seed, tid, px, pz), t.shape);
    };
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
          if (rand(seed, eid, 1) > 0.72 * w) continue;
          const dx = B[0] - A[0];
          const dz = B[1] - A[1];
          const len = Math.hypot(dx, dz);
          const segs = Math.max(1, Math.round(len / 1.1));
          const yaw = Math.atan2(-dz, dx); // local +x along the edge after rotation by yaw about +Y
          // hedges of one boundary share an age: some are thick and whole, others grown out and gappy
          const upkeep = rand(seed, eid, 2);
          for (let q = 0; q < segs; q++) {
            // gateways and grown-out stretches
            if (rand(seed, eid, 10 + q) < 0.1 + 0.22 * (1 - upkeep)) continue;
            const t = (q + 0.5) / segs;
            const px = A[0] + dx * t + (rand(seed, eid, 30 + q) - 0.5) * 0.08;
            const pz = A[1] + dz * t + (rand(seed, eid, 50 + q) - 0.5) * 0.08;
            if (!landOk(px, pz)) continue;
            const halfLen = (len / segs) * 0.5 * 1.18;
            if (excluded(ex, px, pz, halfLen)) continue;
            const width = 0.075 + 0.045 * rand(seed, eid, 70 + q);
            const hid = hash32(eid, q);
            coarse.push(px, pz, halfLen, 0.05 + 0.035 * rand(seed, eid, 90 + q), -0.012, Kind.Hedge, yaw, width / halfLen, pickColor(Kind.Hedge, seed, hid, px, pz), {
              spread: 1,
              gap: 0.12 + 0.28 * (1 - upkeep),
              hVar: 0.4,
            });
          }
          // hedgerow trees
          const trees = rand(seed, eid, 5) < 0.55 * w ? 1 + Math.floor(rand(seed, eid, 6) * 3) : 0;
          for (let q = 0; q < trees; q++) {
            const t = 0.1 + 0.8 * rand(seed, eid, 110 + q);
            const px = A[0] + dx * t;
            const pz = A[1] + dz * t;
            if (!landOk(px, pz)) continue;
            tree(px, pz, 0.27 + 0.18 * rand(seed, eid, 120 + q), hash32(eid, q, 7), coarse);
          }
        }
        // copses and single field trees
        const A2 = vert(i, j);
        const C = vert(i + 1, j + 1);
        const fx = (A2[0] + C[0]) / 2;
        const fz = (A2[1] + C[1]) / 2;
        const fw = hedgeWeight(fx, fz);
        const fid = hash32(i, j, 204);
        if (fw > 0.05 && rand(seed, fid, 1) < 0.2 * fw) {
          const count = 4 + Math.floor(rand(seed, fid, 2) * 8);
          const rad = 0.5 + 0.6 * rand(seed, fid, 3);
          for (let q = 0; q < count; q++) {
            const a = rand(seed, fid, 10 + q) * TAU;
            const rr = Math.sqrt(rand(seed, fid, 20 + q)) * rad;
            const px = fx + Math.cos(a) * rr;
            const pz = fz + Math.sin(a) * rr;
            if (!landOk(px, pz)) continue;
            tree(px, pz, 0.2 + 0.18 * rand(seed, fid, 30 + q), hash32(fid, q, 9), coarse);
          }
        } else if (fw > 0.05 && rand(seed, fid, 4) < 0.35 * fw) {
          const px = fx + (rand(seed, fid, 5) - 0.5) * 2.4;
          const pz = fz + (rand(seed, fid, 6) - 0.5) * 2.4;
          if (landOk(px, pz)) tree(px, pz, 0.26 + 0.16 * rand(seed, fid, 7), hash32(fid, 11), coarse);
        }
      }
  }

  // ------------------------------------------------------------------ Ithilien woodland (groves, glades, cypresses)
  const ithilienGrove = (x: number, z: number) => smooth(0.28, 0.58, valueNoise(x / 13, z / 13, seed + 17));
  {
    const c = 1.4 / Math.sqrt(Math.max(0.35, dens));
    const [x0, z0] = spec.kmToWorld(1100, 760);
    const [x1, z1] = spec.kmToWorld(1215, 560);
    for (let j = 0; j < Math.ceil((z1 - z0) / c); j++)
      for (let i = 0; i < Math.ceil((x1 - x0) / c); i++) {
        const id = hash32(i, j, 301);
        const x = x0 + (i + rand(seed, id, 1)) * c;
        const z = z0 + (j + rand(seed, id, 2)) * c;
        const w = s.region(x, z, 'ithilien');
        if (w < 0.05) continue;
        const grove = ithilienGrove(x, z);
        const p = w * (0.18 + 0.82 * grove);
        if (rand(seed, id, 3) > p) continue;
        if (s.forest(x, z) > 0.4 || s.water(x, z, 2) < 0.5 || s.water(x, z, 0) > 0.25) continue;
        const h = s.height(x, z);
        if (h < 0.2 || h > 17 || s.slope(x, z) > 0.34) continue;
        if (rand(seed, id, 9) < barren.at(x, z)) continue;
        const t = rand(seed, id, 4);
        const yaw = rand(seed, id, 7) * TAU;
        if (t < 0.55 * grove) {
          // a grove: a cluster of crowns
          const hr = c * (0.42 + 0.16 * rand(seed, id, 5));
          if (excluded(ex, x, z, hr)) continue;
          const vr = hr * (0.8 + 0.3 * rand(seed, id, 6));
          coarse.push(x, z, hr, vr, -0.06 * vr, Kind.Ithilien, yaw, 0.85 + 0.3 * rand(seed, id, 8), pickColor(Kind.Ithilien, seed, id, x, z), { spread: 0.9, gap: 0.2, hVar: 0.32 });
        } else if (t < 0.6) {
          // cypress / cedar: dark and slender
          const hr = 0.13 + 0.08 * rand(seed, id, 5);
          if (excluded(ex, x, z, hr)) continue;
          const vr = hr * (2.1 + 0.8 * rand(seed, id, 6));
          coarse.push(x, z, hr, vr, 0.12 * vr, Kind.Ithilien, yaw, 0.9 + 0.2 * rand(seed, id, 8), pickColor(Kind.Ithilien, seed, id, x, z, CYPRESS_RGB), { spread: 0.24, gap: 0.05, hVar: 0.5 });
        } else {
          const tr = broadleaf(seed, id, 0.3 + 0.22 * rand(seed, id, 5));
          if (excluded(ex, x, z, tr.hr)) continue;
          coarse.push(x, z, tr.hr, tr.vr, tr.trunk, Kind.Ithilien, yaw, 0.85 + 0.3 * rand(seed, id, 8), pickColor(Kind.Ithilien, seed, id, x, z), tr.shape);
        }
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
    const c = 2.6 / Math.sqrt(Math.max(0.35, dens));
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
        if (rand(seed, id, 9) < barren.at(x, z)) continue;
        const yaw = rand(seed, id, 7) * TAU;
        if (rand(seed, id, 10) < 0.3) {
          // a small gallery wood on the bank
          const hr = 0.55 + 0.35 * rand(seed, id, 4);
          if (excluded(ex, x, z, hr)) continue;
          const vr = hr * (0.7 + 0.2 * rand(seed, id, 5));
          coarse.push(x, z, hr, vr, 0, Kind.River, yaw, 0.7 + 0.3 * rand(seed, id, 8), pickColor(Kind.River, seed, id, x, z), { spread: 0.8, gap: 0.25, hVar: 0.3 });
        } else {
          const hr = 0.24 + 0.2 * rand(seed, id, 4);
          if (excluded(ex, x, z, hr)) continue;
          const vr = hr * (0.85 + 0.25 * rand(seed, id, 5));
          coarse.push(x, z, hr, vr, vr * (0.2 + 0.15 * rand(seed, id, 6)), Kind.River, yaw, 0.85 + 0.3 * rand(seed, id, 8), pickColor(Kind.River, seed, id, x, z), {
            spread: 0.42,
            gap: 0.1,
            hVar: 0.3,
          });
        }
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
        let cr: Crown;
        if (fd >= 0.5) {
          // understory / fill between the canopy patches, and single trees stepping out of the edge
          if (s.water(x, z, 0) > 0.3 || s.water(x, z, 1) > 0.2 || s.water(x, z, 2) < 0.5) continue;
          const h = s.height(x, z);
          if (h < 0.15 || s.slope(x, z) > 0.55) continue;
          const al = alpine(x, z, h);
          if (al >= 1 || rand(seed, id, 12) < 0.75 * al) continue;
          kind = forestKind(s, x + ox, z + oz);
          const inside = s.forest(x, z) > 0.5;
          if (inside) {
            const hr = c * (0.42 + 0.28 * rand(seed, id, 6)) * (1 - 0.3 * al);
            const vr = hr * (kind === Kind.Lorien ? 1.15 : kind === Kind.Mirkwood ? 1.0 : 0.9) * (0.8 + 0.3 * rand(seed, id, 7));
            cr = { hr, vr, trunk: -0.08 * vr, shape: { spread: 0.65 + 0.25 * rand(seed, id, 8), gap: 0.18, hVar: 0.3 } };
          } else {
            cr = broadleaf(seed, id, 0.22 + 0.2 * rand(seed, id, 6));
          }
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
          cr = broadleaf(seed, id, kind === Kind.Scrub ? 0.16 + 0.14 * rand(seed, id, 6) : 0.22 + 0.18 * rand(seed, id, 6));
        }
        if (rand(seed, id, 13) < barren.at(x, z)) continue;
        if (excluded(ex, x, z, cr.hr)) continue;
        fine.push(x, z, cr.hr, cr.vr, cr.trunk, kind, rand(seed, id, 10) * TAU, 0.85 + 0.3 * rand(seed, id, 11), pickColor(kind, seed, id, x, z), cr.shape);
      }
  }

  return { coarse, fine, coarseCell, fineCell };
}
