import { ClampToEdgeWrapping, Color, DataArrayTexture, LinearFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three/webgpu';
import { tsl, type TslNode } from './tsl.ts';

const { clamp, float, int, max, mix, smoothstep, texture, vec3 } = tsl;
import looksJson from '../../data/world/looks.json';
import type { World } from '../world/World.ts';

type N = TslNode;

// ------------------------------------------------------------------ ground palette (terrain look v2)

/**
 * A region's ground look (looks.json `ground`, one line per region). Colours are sRGB hex; the
 * scalars are 0..1 unless noted. `spots` are local variations around a place (or an ME-GIS km
 * point): colours and scalars blend towards the spot's values with a Gaussian falloff (weight
 * exp(−(d/radiusKm)²) · strength), `snowline` is ADDED (so neighbouring spots superpose).
 */
export interface GroundJson {
  grass: string;
  dry: string;
  soil: string;
  /** exposed rock on steep faces / above the treeline */
  rock?: string;
  /** mean grass ↔ dry mix at sea level (terrain adds altitude, noise, moisture) */
  dryness?: number;
  /** micro-pattern amplitude: tussock / mottle / patchwork contrast of the ground */
  pattern?: number;
  /** snowline offset, world units (negative = snow lower); blurred ~10 km */
  snowline?: number;
  /** 0..1 volcanic ground: ash detail, darker scree, no snow (Mordor) */
  volcanic?: number;
  /** 0..1 bare-rock tendency: rock starts on gentler slopes and on crests (Emyn Muil) */
  rockiness?: number;
  /**
   * landmark turf override where stamps reshaped the ground: 1 = turf / soil, never slope rock
   * (Edoras), 0 = keep the rock (Moria's cliff); unset = automatic (turf where the stamp built new
   * faces on gentle ground)
   */
  turf?: number;
  /**
   * region only (not spots): 0..1 how far the region's border may wander (default 1). 1 = a vague
   * ecotone (the full multi-scale domain warp + noise-dithered weights, 20–80 km mosaics); below
   * ECOTONE_SHARP the border follows a real feature (Mordor's ranges, a forest edge, the Anduin) and
   * keeps its authored place (a small warp only, never dithered). See LookField.
   */
  ecotone?: number;
  spots?: GroundSpotJson[];
}
export interface GroundSpotJson extends Partial<Omit<GroundJson, 'spots' | 'ecotone'>> {
  place?: string;
  /** ME-GIS km [x, y] (instead of a place) */
  atKm?: [number, number];
  radiusKm: number;
  strength?: number;
}

/** Palette layers of the ground-look texture (see groundLookTexture). */
export const GROUND_LAYERS = 5;
/** snowline offsets are stored as (offset + RANGE) / (2 · RANGE) */
const SNOW_RANGE = 20;

const DEFAULT_ROCK = '#77726a';

function groundJson(id: string): GroundJson {
  return (looksJson.regions as unknown as Record<string, { ground: GroundJson }>)[id].ground;
}

/** linear 0..1 → sRGB byte through a 16k-entry table (well under half an LSB of error) */
const SRGB_LUT = Uint8Array.from({ length: 16385 }, (_, i) => {
  const c = i / 16384;
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
});
const toSrgb8 = (v: number): number => SRGB_LUT[Math.round(Math.min(1, Math.max(0, v)) * 16384)];
const to8 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
const smooth01 = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Per-texel ground properties in linear space: 4 colours × 3 + dryness, pattern, snowline, volcanic, rockiness, turf value, turf weight. */
const P = 19;
function regionProps(g: Partial<GroundJson>, base?: Float32Array): Float32Array {
  const out = base ? base.slice() : new Float32Array(P);
  const col = (hex: string | undefined, o: number) => {
    if (!hex) return;
    const c = new Color(hex);
    out[o] = c.r;
    out[o + 1] = c.g;
    out[o + 2] = c.b;
  };
  col(g.grass, 0);
  col(g.dry, 3);
  col(g.soil, 6);
  col(g.rock ?? (base ? undefined : DEFAULT_ROCK), 9);
  if (g.dryness !== undefined || !base) out[12] = g.dryness ?? 0.4;
  if (g.pattern !== undefined || !base) out[13] = g.pattern ?? 0.4;
  if (!base) out[14] = g.snowline ?? 0;
  if (g.volcanic !== undefined || !base) out[15] = g.volcanic ?? 0;
  if (g.rockiness !== undefined || !base) out[16] = g.rockiness ?? 0;
  if (g.turf !== undefined || !base) out[17] = g.turf ?? 0;
  if (g.turf !== undefined || !base) out[18] = g.turf !== undefined ? 1 : 0;
  return out;
}

// ------------------------------------------------------------------ region weight field (CPU)

/** below this `ecotone` a region's border follows a real feature and stays put (see GroundJson.ecotone) */
export const ECOTONE_SHARP = 0.35;
/**
 * Multi-scale domain warp of the region weights, [wavelength km, amplitude km] per octave (each
 * octave rotated, so no octave lines up with the axis-aligned polygon edges; value noise rarely
 * leaves ±0.5, so typical displacements are about half the amplitude). Scaled per region by its
 * `ecotone`.
 */
const LOOK_WARP: readonly (readonly [number, number])[] = [
  [420, 90],
  [150, 34],
  [50, 12],
  [16, 4],
];
/** noise dithering of the vague regions' weights: [wavelength km, share] octaves and the log gain */
const LOOK_DITHER: readonly (readonly [number, number])[] = [
  [60, 1],
  [20, 0.5],
];
const DITHER_GAIN = 2.4;
/**
 * extra softening of the vague regions' baked masks (box radius in look texels, 3 passes ≈ σ 20 km):
 * the transition band the dither turns into a mosaic (sharp regions keep their baked masks)
 */
const ECOTONE_BLUR = 12;

/** Stateless lattice hash → [0, 1) (init-time CPU fields only; the shader has its own noise). */
function lat(i: number, j: number, seed: number): number {
  let k = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  k = Math.imul(k ^ (k >>> 15), 0x2c1b3c6d);
  k = Math.imul(k ^ (k >>> 12), 0x297a2d39);
  k ^= k >>> 15;
  return (k >>> 0) / 4294967296;
}

/** Smooth 2D value noise in [−1, 1] (a pure function of its inputs). */
export function lookNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const h00 = lat(xi, zi, seed);
  const h10 = lat(xi + 1, zi, seed);
  const h01 = lat(xi, zi + 1, seed);
  const h11 = lat(xi + 1, zi + 1, seed);
  const a = h00 + (h10 - h00) * u;
  const b = h01 + (h11 - h01) * u;
  return (a + (b - a) * v) * 2 - 1;
}

/** Octave table: each octave rotated by its own angle, pre-scaled by 1 / wavelength. */
interface Octave {
  c: number;
  s: number;
  amp: number;
  seed: number;
}
function octaves(spec: readonly (readonly [number, number])[], seed: number): Octave[] {
  return spec.map(([len, amp], o) => {
    const a = 0.61 + o * 1.27;
    return { c: Math.cos(a) / len, s: Math.sin(a) / len, amp, seed: seed + o * 101 };
  });
}
/** Σ amp · noise(R(θ) · p / wavelength) */
function fbm(x: number, z: number, oct: Octave[]): number {
  let s = 0;
  for (const o of oct) s += o.amp * lookNoise(x * o.c - z * o.s, x * o.s + z * o.c, o.seed);
  return s;
}

/**
 * The region weights as the ground look and the regional haze see them (built once per world):
 * the baked soft region masks (World.look) re-sampled through a multi-scale domain warp and, for
 * the vague regions, noise-dithered — so straight polygon edges become meandering, interfingering
 * ecotones (20–80 km mosaics) at any polygon shape, while feature-bound regions (`ecotone` below
 * ECOTONE_SHARP: Mordor, Ithilien, the forests, the Shire) keep their authored borders:
 *   sharp r:  w_r = raw_r(x + e_r · warp(x))                     (their sum capped at 1)
 *   vague r:  w_r ∝ raw_r(x + e_r · warp(x)) · exp(G · e_r · n_r(x)), normalised to 1 − Σ sharp
 * Pure function of the bake + looks.json + the world seed (deterministic, no hidden state).
 */
export class LookField {
  readonly n: number;
  private readonly data: Uint8Array;
  private readonly W: number;
  private readonly H: number;
  private readonly eco: Float32Array;
  private readonly sharp: Uint8Array;
  /** distinct ecotone values and each region's index into them (one bilinear setup per level) */
  private readonly levels: number[];
  private readonly levelOf: Uint8Array;
  private readonly warpX: Octave[];
  private readonly warpZ: Octave[];
  private readonly dither: Octave[][];
  private readonly x0: number;
  private readonly z0: number;
  private readonly sx: number;
  private readonly sz: number;
  // per-call scratch (bilinear setup per level)
  private readonly i00: Int32Array;
  private readonly i10: Int32Array;
  private readonly i01: Int32Array;
  private readonly i11: Int32Array;
  private readonly tx: Float32Array;
  private readonly ty: Float32Array;

  constructor(world: World) {
    const img = world.look.image as unknown as { data: Uint8Array; width: number; height: number };
    this.data = img.data.slice();
    this.W = img.width;
    this.H = img.height;
    this.n = world.lookRegions.length;
    this.eco = Float32Array.from(world.lookRegions, (id) => Math.min(1, Math.max(0, groundJson(id).ecotone ?? 1)));
    this.sharp = Uint8Array.from(this.eco, (e) => (e < ECOTONE_SHARP ? 1 : 0));
    this.levels = [...new Set(this.eco)].sort((a, b) => a - b);
    this.levelOf = Uint8Array.from(this.eco, (e) => this.levels.indexOf(e));
    const seed = (world.spec.json.seeds.world ^ 0x5eed1) >>> 0;
    this.warpX = octaves(LOOK_WARP, seed);
    this.warpZ = octaves(LOOK_WARP, seed + 7919);
    this.dither = world.lookRegions.map((_, r) => octaves(LOOK_DITHER, seed + 131 * (r + 1)));
    this.x0 = world.spec.xMin;
    this.z0 = world.spec.zMin;
    this.sx = this.W / world.spec.width;
    this.sz = this.H / world.spec.depth;
    // vague regions: widen the transition band (per channel, quantised back to bytes)
    const a = new Float32Array(this.W * this.H);
    const tmp = new Float32Array(this.W * this.H);
    for (let r = 0; r < this.n; r++) {
      if (this.sharp[r]) continue;
      const o = (r >> 2) * this.W * this.H * 4 + (r & 3);
      for (let i = 0; i < a.length; i++) a[i] = this.data[o + i * 4];
      blur1(a, this.W, this.H, ECOTONE_BLUR, tmp);
      for (let i = 0; i < a.length; i++) this.data[o + i * 4] = Math.round(a[i]);
    }
    const L = this.levels.length + 1; // + the unwarped position
    this.i00 = new Int32Array(L);
    this.i10 = new Int32Array(L);
    this.i01 = new Int32Array(L);
    this.i11 = new Int32Array(L);
    this.tx = new Float32Array(L);
    this.ty = new Float32Array(L);
  }

  /** bilinear setup of level L at world (x, z) */
  private setup(L: number, x: number, z: number): void {
    const W = this.W;
    const fx = Math.min(W - 1, Math.max(0, (x - this.x0) * this.sx - 0.5));
    const fy = Math.min(this.H - 1, Math.max(0, (z - this.z0) * this.sz - 0.5));
    const xa = Math.floor(fx);
    const ya = Math.floor(fy);
    const dx = xa + 1 < W ? 1 : 0;
    const dy = ya + 1 < this.H ? W : 0;
    this.i00[L] = ya * W + xa;
    this.i10[L] = ya * W + xa + dx;
    this.i01[L] = ya * W + xa + dy;
    this.i11[L] = ya * W + xa + dx + dy;
    this.tx[L] = fx - xa;
    this.ty[L] = fy - ya;
  }

  /** raw weight of region r at the position set up for its level */
  private rawAt(r: number, L: number): number {
    const d = this.data;
    const o = (r >> 2) * this.W * this.H;
    const c = r & 3;
    const tx = this.tx[L];
    const a0 = d[(o + this.i00[L]) * 4 + c];
    const a1 = d[(o + this.i10[L]) * 4 + c];
    const b0 = d[(o + this.i01[L]) * 4 + c];
    const b1 = d[(o + this.i11[L]) * 4 + c];
    const a = a0 + (a1 - a0) * tx;
    const b = b0 + (b1 - b0) * tx;
    return (a + (b - a) * this.ty[L]) / 255;
  }

  /**
   * Region weights at world (x, z) into `out` (sum 1). `groundLook`: the default region (index 0,
   * which also fills what the baked masks leave uncovered) only counts where it dominates, so the
   * gap between two regions is bridged by the neighbours instead of a band of the default ground.
   */
  weights(x: number, z: number, out: Float32Array, groundLook = false): Float32Array {
    const n = this.n;
    const wx = fbm(x, z, this.warpX);
    const wz = fbm(x, z, this.warpZ);
    const U = this.levels.length; // the unwarped position
    for (let L = 0; L < U; L++) this.setup(L, x + wx * this.levels[L], z + wz * this.levels[L]);
    this.setup(U, x, z);
    let sharpSum = 0;
    for (let r = 0; r < n; r++) if (this.sharp[r]) sharpSum += out[r] = this.rawAt(r, this.levelOf[r]);
    // near feature-bound ground a vague region only reaches as far as its own widened mask: the
    // warp moves borders between neighbours, never a region across a feature-bound one (Gondor
    // over Ithilien and the Ephel Dúath into Mordor); elsewhere the borders meander freely
    const strict = smooth01(sharpSum / 0.3);
    let vagueSum = 0;
    for (let r = 0; r < n; r++) {
      if (this.sharp[r]) continue;
      let w = this.rawAt(r, this.levelOf[r]);
      if (groundLook && r === 0) w *= smooth01((w - 0.55) / 0.4);
      if (strict > 0) w *= 1 - strict + strict * smooth01((this.rawAt(r, U) - 0.02) / 0.25);
      vagueSum += w;
      out[r] = w;
    }
    if (sharpSum > 1) {
      for (let r = 0; r < n; r++) if (this.sharp[r]) out[r] /= sharpSum;
      sharpSum = 1;
    }
    const rest = 1 - sharpSum;
    if (vagueSum <= 1e-6) {
      // every vague sample was warped into feature-bound ground (or the default was suppressed):
      // the unwarped weights decide, then the default region
      vagueSum = 0;
      for (let r = 0; r < n; r++)
        if (!this.sharp[r]) {
          out[r] = this.rawAt(r, U);
          vagueSum += out[r];
        }
      if (vagueSum <= 1e-6 && !this.sharp[0]) out[0] = 1;
    }
    // noise-dithered vague weights: the ecotone becomes a mosaic of patches instead of a gradient
    let s = 0;
    for (let r = 0; r < n; r++) {
      if (this.sharp[r] || out[r] <= 0) continue;
      out[r] *= Math.exp(DITHER_GAIN * this.eco[r] * fbm(x, z, this.dither[r]));
      s += out[r];
    }
    if (s > 1e-9) {
      const k = rest / s;
      for (let r = 0; r < n; r++) if (!this.sharp[r]) out[r] *= k;
    }
    return out;
  }
}

const fieldCache = new WeakMap<World, LookField>();

/** The world's shared region-weight field (ground look, regional haze, field patchwork). */
export function lookField(world: World): LookField {
  let f = fieldCache.get(world);
  if (!f) fieldCache.set(world, (f = new LookField(world)));
  return f;
}

/**
 * Drop the cached field (its ~12 MB widened mask copy) once the init-time consumers are built;
 * a later lookField call rebuilds the identical field (a pure function of the world).
 */
export function releaseLookField(world: World): void {
  fieldCache.delete(world);
}

// ------------------------------------------------------------------ ground look texture

const groundCache = new WeakMap<World, DataArrayTexture>();

interface SpotBake {
  target: Float32Array;
  keys: number[];
  strength: number;
  snowline: number;
  cx: number;
  cz: number;
  r: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * The regional ground look, baked once on the CPU at the look-layer resolution (≈ 1.6 km/texel):
 * region weights (LookField: domain-warped, noise-dithered ecotones) × looks.json `ground` + the
 * local spots, as an sRGB RGBA8 array texture —
 *   layer 0: grass.rgb, a = dryness
 *   layer 1: dry.rgb,   a = pattern
 *   layer 2: soil.rgb,  a = snowline offset (blurred; decoded by groundPalette)
 *   layer 3: rock.rgb,  a = volcanic
 *   layer 4: r = rockiness, g = landmark turf value, b = its weight (sRGB-encoded scalars),
 *            a = soft wetland cover (World.landcover G averaged + blurred, σ ≈ 2.5 km: the marsh
 *            edge the terrain frays with noise instead of the binary landcover outline)
 * Five low-resolution fetches replace the per-pixel region-weight blend, and every system that
 * approximates the terrain (the water's reflected terrain) reads the same texture — region
 * borders therefore match wherever it is sampled (the warp is baked in, not applied per shader).
 * Built texel by texel (blend + spots in order into one scratch vector): the only full-size float
 * buffers are the snowline channel and its blur scratch.
 */
export function groundLookTexture(world: World): DataArrayTexture {
  const hit = groundCache.get(world);
  if (hit) return hit;
  const field = lookField(world);
  const W = (world.look.image as unknown as { width: number }).width;
  const H = (world.look.image as unknown as { height: number }).height;
  const ids = world.lookRegions;
  const n = ids.length;
  const regions = ids.map((id) => regionProps(groundJson(id)));
  const spec = world.spec;
  const texelKm = spec.width / W;

  // local spots (Gaussian, applied after the region blend, in authoring order)
  const spots: SpotBake[] = [];
  for (const id of ids) {
    for (const s of groundJson(id).spots ?? []) {
      let cx: number;
      let cz: number;
      if (s.place) {
        const p = world.places.get(s.place);
        if (!p) throw new Error(`looks.json ground spot: unknown place '${s.place}'`);
        cx = p.x;
        cz = p.z;
      } else if (s.atKm) [cx, cz] = spec.kmToWorld(s.atKm[0], s.atKm[1]);
      else throw new Error(`looks.json ground spot in '${id}' needs a place or atKm`);
      const has = (k: number) =>
        k < 3 ? !!s.grass : k < 6 ? !!s.dry : k < 9 ? !!s.soil : k < 12 ? !!s.rock : k === 12 ? s.dryness !== undefined : k === 13 ? s.pattern !== undefined : k === 15 ? s.volcanic !== undefined : k === 16 ? s.rockiness !== undefined : k === 17 || k === 18 ? s.turf !== undefined : false;
      const reach = Math.ceil((s.radiusKm * 2.6) / texelKm);
      const gx = Math.round((cx - spec.xMin) / texelKm - 0.5);
      const gz = Math.round((cz - spec.zMin) / texelKm - 0.5);
      spots.push({
        target: regionProps(s, new Float32Array(P)),
        keys: [...Array(P).keys()].filter(has),
        strength: s.strength ?? 1,
        snowline: s.snowline ?? 0,
        cx,
        cz,
        r: s.radiusKm,
        x0: Math.max(0, gx - reach),
        x1: Math.min(W - 1, gx + reach),
        y0: Math.max(0, gz - reach),
        y1: Math.min(H - 1, gz + reach),
      });
    }
  }

  const data = new Uint8Array(W * H * 4 * GROUND_LAYERS);
  const layer = W * H * 4;
  const snow = new Float32Array(W * H);
  const wts = new Float32Array(n);
  // the region blend runs on a half-resolution node grid (every other texel centre; the ecotone
  // mosaic's finest scale is ~12 km = 7 texels), two node rows at a time, bilinearly upsampled;
  // the spots stay full-resolution (landmark turf spots are a few km wide)
  const NW = (W >> 1) + 1;
  let rowA = new Float32Array(NW * P);
  let rowB = new Float32Array(NW * P);
  const nodeRow = (j: number, dst: Float32Array) => {
    const wz = spec.zMin + (Math.min(H - 1, 2 * j) + 0.5) * texelKm;
    dst.fill(0);
    for (let i = 0; i < NW; i++) {
      field.weights(spec.xMin + (Math.min(W - 1, 2 * i) + 0.5) * texelKm, wz, wts, true);
      const o = i * P;
      for (let r = 0; r < n; r++) {
        const w = wts[r];
        if (w <= 0) continue;
        const R = regions[r];
        for (let k = 0; k < P; k++) dst[o + k] += w * R[k];
      }
    }
  };
  nodeRow(0, rowA);
  nodeRow(1, rowB);
  const v = new Float32Array(P);
  for (let y = 0; y < H; y++) {
    const j = y >> 1;
    if (y > 1 && (y & 1) === 0) {
      [rowA, rowB] = [rowB, rowA];
      nodeRow(j + 1, rowB);
    }
    const ty = (y & 1) * 0.5;
    const wz = spec.zMin + (y + 0.5) * texelKm;
    const rowSpots = spots.filter((s) => y >= s.y0 && y <= s.y1);
    for (let x = 0; x < W; x++) {
      const i0 = (x >> 1) * P;
      const i1 = i0 + (x & 1) * P;
      for (let k = 0; k < P; k++) {
        const a = (rowA[i0 + k] + rowA[i1 + k]) * 0.5;
        const b = (rowB[i0 + k] + rowB[i1 + k]) * 0.5;
        v[k] = a + (b - a) * ty;
      }
      const wx = spec.xMin + (x + 0.5) * texelKm;
      for (const s of rowSpots) {
        if (x < s.x0 || x > s.x1) continue;
        const q = Math.hypot(wx - s.cx, wz - s.cz) / s.r;
        const wgt = Math.exp(-q * q) * s.strength;
        if (wgt < 1e-3) continue;
        for (const k of s.keys) v[k] += (s.target[k] - v[k]) * wgt;
        if (s.snowline) v[14] += s.snowline * wgt;
      }
      const i = y * W + x;
      for (let L = 0; L < 4; L++) {
        const t = L * layer + i * 4;
        data[t] = toSrgb8(v[L * 3]);
        data[t + 1] = toSrgb8(v[L * 3 + 1]);
        data[t + 2] = toSrgb8(v[L * 3 + 2]);
      }
      data[i * 4 + 3] = to8(v[12]);
      data[layer + i * 4 + 3] = to8(v[13]);
      snow[i] = v[14];
      data[3 * layer + i * 4 + 3] = to8(v[15]);
      // scalars in an sRGB layer: encoded so the hardware decode returns the value
      data[4 * layer + i * 4] = toSrgb8(v[16]);
      data[4 * layer + i * 4 + 1] = toSrgb8(v[17]);
      data[4 * layer + i * 4 + 2] = toSrgb8(v[18]);
    }
  }
  blur1(snow, W, H, 5);
  for (let i = 0; i < W * H; i++) data[2 * layer + i * 4 + 3] = to8((snow[i] + SNOW_RANGE) / (2 * SNOW_RANGE));
  // soft wetland cover: landcover G box-averaged onto the look grid, then blurred (reuses `snow`)
  const lc = world.landcover.image as unknown as { data: Uint8Array; width: number; height: number };
  const fx = lc.width / W;
  const fy = lc.height / H;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let acc = 0;
      let cnt = 0;
      for (let yy = Math.floor(y * fy); yy < Math.floor((y + 1) * fy); yy++)
        for (let xx = Math.floor(x * fx); xx < Math.floor((x + 1) * fx); xx++) {
          acc += lc.data[(yy * lc.width + xx) * 4 + 1];
          cnt++;
        }
      snow[y * W + x] = cnt ? acc / (cnt * 255) : 0;
    }
  blur1(snow, W, H, 1);
  for (let i = 0; i < W * H; i++) data[4 * layer + i * 4 + 3] = to8(snow[i]);

  const t = new DataArrayTexture(data, W, H, GROUND_LAYERS);
  t.format = RGBAFormat;
  t.type = UnsignedByteType;
  // sRGB colours (hardware-decoded); alpha stays linear in rgba8unorm-srgb
  t.colorSpace = SRGBColorSpace;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  t.name = 'ground-look';
  t.needsUpdate = true;
  groundCache.set(world, t);
  return t;
}

/** Separable 3-pass box blur (≈ Gaussian) of a single-channel float image, in place (`b`: scratch). */
function blur1(a: Float32Array, w: number, h: number, radius: number, b = new Float32Array(w * h)): void {
  const inv = 1 / (2 * radius + 1);
  // one running-sum pass along lines of `len` samples `step` apart (edges clamped)
  const pass = (src: Float32Array, dst: Float32Array, lines: number, lineStep: number, len: number, step: number) => {
    for (let l = 0; l < lines; l++) {
      const o = l * lineStep;
      const last = o + (len - 1) * step;
      let acc = 0;
      for (let k = -radius; k <= radius; k++) acc += src[o + Math.min(len - 1, Math.max(0, k)) * step];
      for (let i = 0; i < len; i++) {
        dst[o + i * step] = acc * inv;
        const add = i + radius + 1;
        const sub = i - radius;
        acc += (add < len ? src[o + add * step] : src[last]) - (sub > 0 ? src[o + sub * step] : src[o]);
      }
    }
  };
  for (let it = 0; it < 3; it++) {
    pass(a, b, h, w, w, 1);
    pass(b, a, w, 1, h, w);
  }
}

/** The ground look at a map position (TSL). */
export interface GroundPalette {
  grass: N;
  dry: N;
  soil: N;
  rock: N;
  dryness: N;
  pattern: N;
  /** snowline offset, world units */
  snowline: N;
  volcanic: N;
  rockiness: N;
  /** landmark turf override (value, weight; applies where stamps reshaped the ground) */
  turf: N;
  turfWeight: N;
  /** soft wetland cover 0..1 (≈ 2.5 km blur of the landcover wetland mask) */
  wetland: N;
}

/**
 * Sample the ground look at map uv (five fetches). The region borders' domain warp is baked into
 * the texture (LookField), so every system that samples it at the same uv sees the same borders.
 * `explicitLod` makes the fetches legal in non-uniform control flow.
 */
export function groundPalette(tex: DataArrayTexture, uv: N, explicitLod = false): GroundPalette {
  const f = (L: number): N => {
    const t = texture(tex, uv).depth(int(L));
    return explicitLod ? t.level(0) : t;
  };
  const a = f(0);
  const b = f(1);
  const c = f(2);
  const d = f(3);
  const q = f(4);
  return {
    grass: a.rgb,
    dryness: a.a,
    dry: b.rgb,
    pattern: b.a,
    soil: c.rgb,
    snowline: c.a.mul(2 * SNOW_RANGE).sub(SNOW_RANGE),
    rock: d.rgb,
    volcanic: d.a,
    rockiness: q.r,
    turf: q.g,
    turfWeight: q.b,
    wetland: q.a,
  };
}

// ------------------------------------------------------------------ grade / atmo data (CPU)

type RegionId = keyof typeof looksJson.regions;

/** A region's colour grade (the per-shot global layer; blended by RegionLook from the camera focus). */
export interface GradeLook {
  /** multiplicative white balance, linear (authored as an sRGB hex near white) */
  tint: Color;
  /** multiplier on the base saturation */
  saturation: number;
  /** multiplier on the base contrast */
  contrast: number;
  /** exposure bias in stops */
  exposure: number;
  /** additive lift in linear HDR (shadows), e.g. [0, 0.001, 0.003] */
  lift: [number, number, number];
  /** 0..1 hue-selective saturation: reds/oranges keep (or gain) saturation while the rest drops */
  redKeep: number;
  /** 0..1 "Pro-Mist" diffusion (lower bloom threshold, more strength) */
  bloom: number;
  /**
   * split-tone (S4 W3-F, looks.json `grade.split {shadow, highlight, amount}`): the effective
   * multiplicative tints of the shadows / highlights, linear, luminance 1 (white = none)
   */
  splitShadow: Color;
  splitHighlight: Color;
  /** saturation multiplier of yellow-green hues (lime → olive), 1 = none */
  greens: number;
  /** 0..1 hue pull of the yellow-greens towards green (lime → lush), 0 = none */
  greensHue: number;
  /** soft black point added to the base toe (linear HDR; denser, cleaner blacks), ≥ 0, 0 = none */
  toe: number;
  /** halation added to the base (orange fringe from the bloom's red), 0 = none (may be negative: less than the base) */
  halation: number;
  /** highlight gain in stops (day only: RegionLook fades it at night), 0 = none, clamped to [-1, 2] */
  highlights: number;
  /** saturation multiplier of warm hues (beige / taupe / orange earth; strong reds exempt), 1 = none, ≥ 0 */
  warms: number;
  /** local grades around places (Rivendell's autumn gold inside Eriador), blended by the focus */
  spots: GradeSpot[];
}
export interface GradeSpot {
  place: string;
  radiusKm: number;
  grade: Omit<GradeLook, 'spots'>;
}

/** A region's atmosphere (the per-pixel layer, baked into the regional haze texture). */
/** An authored colour: sRGB hex (#ffffff = 1) or a linear [r, g, b] triple (may exceed 1). */
type ColorJson = string | number[];
export interface AtmoSpot {
  place: string;
  radiusKm: number;
  tint?: ColorJson;
  density?: number;
  /** valley-mist gain at the spot (S4: the named dales — Rivendell, the Sirannon, the Anduin, the Morgul vale) */
  mist?: number;
  /** cumulus-cap boost over a peak (S4 P4: Caradhras, Mindolluin, Erebor) */
  cap?: number;
}
/** Default distance ramp of the aerial perspective (km): air fades in x → y, local excess z → w. */
export const DEFAULT_HAZE_RAMP: [number, number, number, number] = [35, 700, 2, 30];
export interface AtmoLook {
  /** multiplier on the in-scattered haze colour, linear (#ffffff / [1, 1, 1] = neutral; > 1 = luminous) */
  tint: Color;
  /** multiplier on the haze density */
  density: number;
  /** multiplier on the sky dome when the camera looks at this region */
  sky: Color;
  /** distance ramp of the haze when the camera looks at this region (env.hazeRamp, focus-blended) */
  ramp: [number, number, number, number];
  /** valley-mist gain of the region (1 = the S3 mist; spots raise it in the named dales) */
  mist: number;
  /** local haze features around places (Rivendell's luminous valley, the Dead Marshes' damp) */
  spots: AtmoSpot[];
}

/** The red underglow of an ash deck around a place (Mount Doom's fires on the pall). */
export interface DeckGlow {
  place: string;
  /** linear colour of the glow (radiance per unit strength) */
  color: Color;
  radiusKm: number;
  strength: number;
}
/** A local change of a deck's cover around a place (a thinner pall, a hole). */
export interface DeckSpot {
  place: string;
  radiusKm: number;
  cover: number;
}
/**
 * A region's overcast ash deck (looks.json `deck`; S4): a cloud ceiling drawn by the environment's
 * cloud layer, darkening the key light under it and turning the sky overcast where the camera looks.
 * Regions without a `deck` line have none (cover 0).
 */
export interface DeckLook {
  /** 0..1 cover of the pall (0 = no deck) */
  cover: number;
  /** linear albedo-like tone of the deck (authored as sRGB hex) */
  tone: Color;
  /** 0..1 darkening of the key light under full cover */
  shadow: number;
  /** height of the deck's base, world units */
  height: number;
  /** opacity of the deck seen from above (overviews still read the plateau through it) */
  topOpacity: number;
  glow: DeckGlow | null;
  spots: DeckSpot[];
}

interface GradeJson {
  tint?: string;
  saturation?: number;
  contrast?: number;
  exposure?: number;
  lift?: number[];
  redKeep?: number;
  bloom?: number;
  split?: SplitJson;
  greens?: number;
  greensHue?: number;
  toe?: number;
  halation?: number;
  highlights?: number;
  warms?: number;
  spots?: (GradeJson & { place: string; radiusKm: number })[];
}
/**
 * A split-tone: the shadows lean towards `shadow`, the highlights towards `highlight` (sRGB hex, only
 * their hue and chroma count — normalised to luminance 1), by `amount` (0..1, default 0.1; subtle).
 */
interface SplitJson {
  shadow?: string;
  highlight?: string;
  amount?: number;
}
interface AtmoJson {
  tint?: ColorJson;
  density?: number;
  sky?: ColorJson;
  ramp?: number[];
  mist?: number;
  spots?: AtmoSpot[];
}
interface DeckJson {
  cover?: number;
  tone?: ColorJson;
  shadow?: number;
  height?: number;
  topOpacity?: number;
  glow?: { place: string; color?: ColorJson; radiusKm?: number; strength?: number };
  spots?: { place: string; radiusKm: number; cover?: number }[];
}

/** Parse an authored colour (hex → linear via Color, arrays are already linear). */
export function lookColor(c: ColorJson | undefined, fallback = '#ffffff'): Color {
  if (Array.isArray(c)) return new Color(c[0] ?? 1, c[1] ?? 1, c[2] ?? 1);
  return new Color(c ?? fallback);
}

/**
 * Effective multiplicative split tint: the authored hue normalised to luminance 1 (linear), mixed
 * from white by `amount` — white (no tint) without a colour.
 */
export function splitTint(hex: string | undefined, amount: number): Color {
  if (!hex) return new Color(1, 1, 1);
  const c = new Color(hex);
  const L = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b || 1;
  const a = Math.min(1, Math.max(0, amount));
  return new Color(1 + (c.r / L - 1) * a, 1 + (c.g / L - 1) * a, 1 + (c.b / L - 1) * a);
}

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A grade line. The S1–S3 fields default to identity (a spot without a tint pulls towards white); the
 * film-grade fields (split, greens, greensHue, toe, halation, highlights, warms) of a spot default to its
 * region's (`parent`). The film-grade fields are clamped to the ranges the post pass is safe for
 * (greensHue > 1 would drive red negative into the contrast pow; a negative toe could divide by ~0).
 */
function parseGrade(g: GradeJson, parent?: Omit<GradeLook, 'spots'>): Omit<GradeLook, 'spots'> {
  const lift = g.lift ?? [0, 0, 0];
  const amount = g.split?.amount ?? 0.1;
  const own = g.split !== undefined;
  return {
    tint: new Color(g.tint ?? '#ffffff'),
    saturation: g.saturation ?? 1,
    contrast: g.contrast ?? 1,
    exposure: g.exposure ?? 0,
    lift: [lift[0] ?? 0, lift[1] ?? 0, lift[2] ?? 0],
    redKeep: g.redKeep ?? 0,
    bloom: g.bloom ?? 0,
    splitShadow: own || !parent ? splitTint(g.split?.shadow, amount) : parent.splitShadow.clone(),
    splitHighlight: own || !parent ? splitTint(g.split?.highlight, amount) : parent.splitHighlight.clone(),
    greens: Math.max(0, g.greens ?? parent?.greens ?? 1),
    greensHue: clampNum(g.greensHue ?? parent?.greensHue ?? 0, 0, 1),
    toe: Math.max(0, g.toe ?? parent?.toe ?? 0),
    halation: clampNum(g.halation ?? parent?.halation ?? 0, -2, 2),
    highlights: clampNum(g.highlights ?? parent?.highlights ?? 0, -1, 2),
    warms: Math.max(0, g.warms ?? parent?.warms ?? 1),
  };
}

export function gradeLook(id: string): GradeLook {
  const g = ((looksJson.regions as Record<string, { grade?: GradeJson }>)[id]?.grade ?? {}) as GradeJson;
  const region = parseGrade(g);
  return { ...region, spots: (g.spots ?? []).map((s) => ({ place: s.place, radiusKm: s.radiusKm, grade: parseGrade(s, region) })) };
}

export function atmoLook(id: string): AtmoLook {
  const a = ((looksJson.regions as Record<string, { atmo?: AtmoJson }>)[id]?.atmo ?? {}) as AtmoJson;
  const r = a.ramp ?? DEFAULT_HAZE_RAMP;
  return {
    tint: lookColor(a.tint),
    density: a.density ?? 1,
    sky: lookColor(a.sky),
    ramp: [r[0] ?? DEFAULT_HAZE_RAMP[0], r[1] ?? DEFAULT_HAZE_RAMP[1], r[2] ?? DEFAULT_HAZE_RAMP[2], r[3] ?? DEFAULT_HAZE_RAMP[3]],
    mist: a.mist ?? 1,
    spots: a.spots ?? [],
  };
}

/** Base height of a deck that does not author one, and of "no deck" (world units). */
export const DECK_DEFAULT_HEIGHT = 40;
/** Opacity seen from above of a deck that does not author one. */
export const DECK_DEFAULT_TOP = 0.35;

export function deckLook(id: string): DeckLook {
  const d = ((looksJson.regions as Record<string, { deck?: DeckJson }>)[id]?.deck ?? null) as DeckJson | null;
  if (!d) return { cover: 0, tone: new Color(0.25, 0.25, 0.25), shadow: 0, height: DECK_DEFAULT_HEIGHT, topOpacity: DECK_DEFAULT_TOP, glow: null, spots: [] };
  const g = d.glow;
  return {
    cover: Math.min(1, Math.max(0, d.cover ?? 0.9)),
    tone: lookColor(d.tone, '#808080'),
    shadow: Math.min(1, Math.max(0, d.shadow ?? 0.6)),
    height: d.height ?? DECK_DEFAULT_HEIGHT,
    topOpacity: Math.min(1, Math.max(0, d.topOpacity ?? DECK_DEFAULT_TOP)),
    glow: g ? { place: g.place, color: lookColor(g.color, '#ff4a1a'), radiusKm: g.radiusKm ?? 80, strength: g.strength ?? 0.5 } : null,
    spots: (d.spots ?? []).map((s) => ({ place: s.place, radiusKm: s.radiusKm, cover: Math.min(1, Math.max(0, s.cover ?? 0)) })),
  };
}

/**
 * The data's strongest deck (largest cover · shadow): the prior every focus blend of the decks
 * leans on as its deck weight goes to 0, so the blended shadow / height / tone stay continuous
 * when a deck region enters the focus (no pop on a camera move into the Dagorlad).
 */
export function strongestDeck(ids: readonly string[]): DeckLook {
  let best = deckLook('');
  for (const id of ids) {
    const d = deckLook(id);
    if (d.cover * d.shadow > best.cover * best.shadow) best = d;
  }
  return best;
}

export function isLookRegion(id: string | null | undefined): id is RegionId {
  return !!id && id in looksJson.regions;
}

// ------------------------------------------------------------------ region weights on the CPU

/**
 * Bilinear region weights at world (x, z) from the look layers' CPU copy (normalised to sum 1).
 * `out` must hold world.lookRegions.length values.
 */
export function sampleRegionWeights(world: World, x: number, z: number, out: Float32Array): Float32Array {
  const img = world.look.image as unknown as { data: Uint8Array; width: number; height: number; depth: number };
  const W = img.width;
  const H = img.height;
  const n = world.lookRegions.length;
  const [u, v] = world.spec.worldToUv(x, z);
  const fx = Math.min(W - 1, Math.max(0, u * W - 0.5));
  const fy = Math.min(H - 1, Math.max(0, v * H - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(W - 1, x0 + 1);
  const y1 = Math.min(H - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const d = img.data;
  let sum = 0;
  for (let r = 0; r < n; r++) {
    const L = r >> 2;
    const c = r & 3;
    const at = (xx: number, yy: number) => d[((L * H + yy) * W + xx) * 4 + c];
    const a = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * tx;
    const b = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * tx;
    const w = (a + (b - a) * ty) / 255;
    out[r] = w;
    sum += w;
  }
  if (sum > 1e-6) for (let r = 0; r < n; r++) out[r] /= sum;
  return out;
}

// ------------------------------------------------------------------ shared terrain shading

/**
 * Terrain shading constants: the ONE source for the terrain material family (src/terrain) and every
 * system that approximates it (the water's reflected terrain), through the shared TSL helpers below.
 * Heights are world units of the exaggerated bake v2 relief; slopes are 1 − n.y.
 */
export const TERRAIN_SHADE = {
  /** snow line: base + south · southness (0 north edge … 1 south edge) + the ground look's regional offset */
  snowLineBase: 32,
  snowLineSouth: 2,
  /**
   * amplitude of the 60 km / 12 km / 3 km noise on the snow line (mean 0; the water uses none) —
   * the 12 / 3 km terms break a long even crest (the Grey Mountains) into snowy and bare reaches
   */
  snowLineNoise: [2.4, 1.7, 0.75] as const,
  /**
   * snow v4 (S4 W4-S2): the cover fades in over a band around the line — from line + shift − band[0] to
   * line + shift + band[1] (world units; ≈ 300 m of real height, not a hard mask) — inside which only
   * the favoured ground holds it (the terrain material: gullies, ledges, lee sides; ribs bare)
   */
  snowBand: [1.8, 2.2] as const,
  /** (fix round: 1.5 → 2.6 — the massifs read iced; less cover, the gullies still reach below the line) */
  snowShift: 2.6,
  /**
   * snow v4: the lee (east-facing, the westerlies' lee) side holds snow lower and the steep windward (west)
   * faces shed it — height bonus / penalty in world units (× the lee / windward ramps of snowLeeWind)
   */
  snowLee: 0.9,
  snowWind: 0.9,
  /** north-facing faces hold snow lower: effective height + northness (−n.z) · this */
  snowNorth: 2.8,
  /** snow sheds from slopes steeper than [a, b]; concave gullies hold it `snowGully` steeper */
  snowSlope: [0.27, 0.5] as const,
  snowGully: 0.12,
  /**
   * snow albedo (sRGB): blue-grey ≈ 0.65 linear luminance with a cool cast (wind-packed, shaded by its own
   * micro relief), never paper white — the sunlit snow read neutral white after the grade at 0xd8dde5
   */
  snow: 0xcad4e8,
  /**
   * grass on slopes facing the sun (south, +Z) dries by up to this much, shade-facing slopes green up
   * (0 switches the aspect term off in the terrain and in the water's coarse albedo alike)
   */
  aspectDry: 0.09,
  /** slope bias of the rock rule in coarseGroundAlbedo (its coarse normal under-reads cliff slopes) */
  coarseRockBias: 0.05,
  /** rock on steep slopes [a, b] (none on turf stamps) */
  rockSlope: [0.2, 0.44] as const,
  /** a rockiness of 1 moves the slope onset this much towards gentler ground */
  rockinessShift: 0.12,
  /** alpine zone (rock and scree above the grass): fades in from snowline − a to snowline − b */
  alpine: [12, 4.5] as const,
  /** rock cover in the alpine zone on gentle / steep ground */
  alpineRock: [0.4, 0.95] as const,
  /** ground dryness added per unit of height */
  drynessPerHeight: 0.01,
  /** scree / talus (sRGB): the light grey gravel below the rock faces */
  scree: 0x8a8c8c,
  /** beaches (sRGB) and lake / river shore gravel */
  beach: 0xb8aa88,
  shore: 0x86857c,
  /** wetland: dark peat pools, and the bog mat of olive sedge, darker reed and red tussock (sRGB) */
  wetPool: 0x1b2325,
  wetReed: 0x4c5036,
  wetSedge: 0x5f6246,
  wetRust: 0x67503d,
  /** water channels under the water system's surfaces */
  channel: 0x1d3137,
  /** roads, ash fields */
  road: 0x9a8a6c,
  ash: 0x1a1817,
} as const;

/** sRGB hex → linear vec3 (TSL constant). */
export function srgbNode(hex: number): N {
  const c = new Color(hex);
  return vec3(c.r, c.g, c.b);
}

/** Snow line (world units) at a map position: base + south gradient + regional offset + `noise`. */
export function snowLineAt(pal: GroundPalette, southness: N, noise: N = float(0)): N {
  const T = TERRAIN_SHADE;
  return float(T.snowLineBase).add(southness.mul(T.snowLineSouth)).add(pal.snowline).add(noise);
}

/** 0..1 alpine zone (rock and scree dominate) at effective height `h` below the snow line. */
export function alpineAt(h: N, line: N): N {
  const T = TERRAIN_SHADE;
  return smoothstep(line.sub(T.alpine[0]), line.sub(T.alpine[1]), h);
}

/**
 * 0..1 rock cover from slope and the alpine zone; `rockiness` (ground look) moves the slope onset
 * towards gentler ground, `turf` suppresses the slope term (landmark stamps on gentle ground).
 */
export function rockAt(slope: N, alpine: N, turf: N = float(0), rockiness: N = float(0)): N {
  const T = TERRAIN_SHADE;
  const r = rockiness.mul(T.rockinessShift);
  const steep = smoothstep(r.negate().add(T.rockSlope[0]), r.negate().add(T.rockSlope[1]), slope).mul(float(1).sub(turf));
  const high = alpine.mul(mix(float(T.alpineRock[0]), float(T.alpineRock[1]), smoothstep(0.04, 0.24, slope)));
  return clamp(max(steep, high), 0, 1);
}

/** 0..1 snow cover: effective height over the line, shed from steep faces, none on volcanic ground. */
export function snowAt(hEff: N, slope: N, line: N, volcanic: N, gully: N = float(0)): N {
  const T = TERRAIN_SHADE;
  const g = gully.mul(T.snowGully);
  const l0 = line.add(T.snowShift);
  return smoothstep(l0.sub(T.snowBand[0]), l0.add(T.snowBand[1]), hEff)
    .mul(float(1).sub(smoothstep(g.add(T.snowSlope[0]), g.add(T.snowSlope[1]), slope)))
    .mul(float(1).sub(volcanic));
}

/**
 * Snow v4's lee and windward ramps (0..1) from the normal's +X component (`eastness`) and the slope: the
 * lee (east-facing) side of the westerlies holds snow, the steep windward (west-facing) faces shed it. Shared
 * by the terrain material and the water's coarse albedo (× TERRAIN_SHADE.snowLee / snowWind on the height).
 */
export function snowLeeWind(eastness: N, slope: N): { lee: N; wind: N } {
  return {
    lee: clamp(eastness.mul(1.8), 0, 1).mul(smoothstep(0.06, 0.28, slope)),
    wind: clamp(eastness.negate().mul(1.6), 0, 1).mul(smoothstep(0.18, 0.42, slope)),
  };
}

/**
 * Dryness offset of a slope by its aspect (`nz`: the normal's +Z = south component): sun-facing slopes
 * drier, shade-facing ones lusher, nothing on the flat.
 */
export function aspectDryness(nz: N, slope: N): N {
  return clamp(nz.mul(2.5), -1, 1).mul(TERRAIN_SHADE.aspectDry).mul(smoothstep(0.02, 0.15, slope));
}

/**
 * Coarse terrain albedo (linear) for secondary views of the terrain (the water's reflected
 * terrain): the ground look at its mean dryness (+ the aspect term) + rock + snow from the same rules as
 * the terrain material, without its noise, curvature, masks or detail textures.
 */
export function coarseGroundAlbedo(pal: GroundPalette, h: N, slope: N, southness: N, northness: N, eastness: N = float(0)): N {
  const T = TERRAIN_SHADE;
  const line = snowLineAt(pal, southness);
  const hEff = h.add(northness.mul(T.snowNorth));
  const ground = mix(pal.grass, pal.dry, clamp(pal.dryness.add(h.mul(T.drynessPerHeight)).add(aspectDryness(northness.negate(), slope)), 0, 1));
  // the coarse normal (central differences over 4 texels) flattens cliffs: its slope reads low, so the
  // rock rule gets a small bias (a rock face mirrors as rock, not as the grass at its foot)
  const rock = rockAt(slope.add(T.coarseRockBias), alpineAt(hEff, line), float(0), pal.rockiness);
  // snow v4's lee / windward terms, as the terrain material reads them (its relief terms — gullies, ribs —
  // average out at this scale): east-facing lee sides hold snow lower, steep west-facing (windward) faces
  // shed it — `eastness` is the normal's +X component (0 when the caller has none)
  const lw = snowLeeWind(eastness, slope);
  const snow = snowAt(hEff.add(lw.lee.mul(T.snowLee)).sub(lw.wind.mul(T.snowWind)), slope.add(lw.wind.mul(0.05)), line, pal.volcanic);
  return mix(mix(ground, pal.rock, rock), srgbNode(T.snow), snow);
}
