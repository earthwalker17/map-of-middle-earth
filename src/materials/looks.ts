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
  spots?: GroundSpotJson[];
}
export interface GroundSpotJson extends Partial<Omit<GroundJson, 'spots'>> {
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

const toSrgb8 = (v: number): number => {
  const c = Math.min(1, Math.max(0, v));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
};
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

const groundCache = new WeakMap<World, DataArrayTexture>();

/**
 * The regional ground look, baked once on the CPU at the look-layer resolution (≈ 1.6 km/texel):
 * region weights × looks.json `ground` + the local spots, as an sRGB RGBA8 array texture —
 *   layer 0: grass.rgb, a = dryness
 *   layer 1: dry.rgb,   a = pattern
 *   layer 2: soil.rgb,  a = snowline offset (blurred; decoded by groundPalette)
 *   layer 3: rock.rgb,  a = volcanic
 *   layer 4: r = rockiness, g = landmark turf value, b = its weight (sRGB-encoded scalars), a spare
 * Five low-resolution fetches replace the per-pixel region-weight blend (5 fetches + 19 × N multiply-adds), and every
 * system that approximates the terrain (the water's reflected terrain) reads the same texture.
 */
export function groundLookTexture(world: World): DataArrayTexture {
  const hit = groundCache.get(world);
  if (hit) return hit;
  const img = world.look.image as unknown as { data: Uint8Array; width: number; height: number };
  const W = img.width;
  const H = img.height;
  const ids = world.lookRegions;
  const n = ids.length;
  const regions = ids.map((id) => regionProps(groundJson(id)));
  const spec = world.spec;
  const px = new Float32Array(W * H * P);
  const d = img.data;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sum = 0;
      const o = (y * W + x) * P;
      for (let r = 0; r < n; r++) {
        let w = d[(((r >> 2) * H + y) * W + x) * 4 + (r & 3)] / 255;
        // the default region (index 0) also fills what the soft region masks leave uncovered; in the
        // gaps between two regions that fill would paint a band of the default ground, so for the
        // ground look it only counts where it dominates (the neighbours are renormalised instead)
        if (r === 0) w *= smooth01((w - 0.55) / 0.4);
        if (w <= 0) continue;
        sum += w;
        const R = regions[r];
        for (let k = 0; k < P; k++) px[o + k] += w * R[k];
      }
      if (sum > 1e-6) for (let k = 0; k < P; k++) px[o + k] /= sum;
      else px.set(regions[0], o);
    }
  // local spots (Gaussian, applied after the region blend)
  const texelKm = spec.width / W;
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
      const target = regionProps(s, new Float32Array(P));
      const has = (k: number) =>
        k < 3 ? !!s.grass : k < 6 ? !!s.dry : k < 9 ? !!s.soil : k < 12 ? !!s.rock : k === 12 ? s.dryness !== undefined : k === 13 ? s.pattern !== undefined : k === 15 ? s.volcanic !== undefined : k === 16 ? s.rockiness !== undefined : k === 17 || k === 18 ? s.turf !== undefined : false;
      const keys = [...Array(P).keys()].filter(has);
      const strength = s.strength ?? 1;
      const reach = Math.ceil((s.radiusKm * 2.6) / texelKm);
      const gx = Math.round((cx - spec.xMin) / texelKm - 0.5);
      const gz = Math.round((cz - spec.zMin) / texelKm - 0.5);
      for (let y = Math.max(0, gz - reach); y <= Math.min(H - 1, gz + reach); y++)
        for (let x = Math.max(0, gx - reach); x <= Math.min(W - 1, gx + reach); x++) {
          const wx = spec.xMin + (x + 0.5) * texelKm;
          const wz = spec.zMin + (y + 0.5) * texelKm;
          const q = Math.hypot(wx - cx, wz - cz) / s.radiusKm;
          const wgt = Math.exp(-q * q) * strength;
          if (wgt < 1e-3) continue;
          const o = (y * W + x) * P;
          for (const k of keys) px[o + k] += (target[k] - px[o + k]) * wgt;
          if (s.snowline) px[o + 14] += s.snowline * wgt;
        }
    }
  }
  blurChannel(px, W, H, P, 14, 5);
  const data = new Uint8Array(W * H * 4 * GROUND_LAYERS);
  const layer = W * H * 4;
  for (let i = 0; i < W * H; i++) {
    const o = i * P;
    for (let L = 0; L < 4; L++) {
      const t = L * layer + i * 4;
      data[t] = toSrgb8(px[o + L * 3]);
      data[t + 1] = toSrgb8(px[o + L * 3 + 1]);
      data[t + 2] = toSrgb8(px[o + L * 3 + 2]);
    }
    data[i * 4 + 3] = to8(px[o + 12]);
    data[layer + i * 4 + 3] = to8(px[o + 13]);
    data[2 * layer + i * 4 + 3] = to8((px[o + 14] + SNOW_RANGE) / (2 * SNOW_RANGE));
    data[3 * layer + i * 4 + 3] = to8(px[o + 15]);
    // scalars in an sRGB layer: encoded so the hardware decode returns the value
    data[4 * layer + i * 4] = toSrgb8(px[o + 16]);
    data[4 * layer + i * 4 + 1] = toSrgb8(px[o + 17]);
    data[4 * layer + i * 4 + 2] = toSrgb8(px[o + 18]);
    data[4 * layer + i * 4 + 3] = 255;
  }
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

/** Separable 3-pass box blur of one channel of an interleaved float image. */
function blurChannel(px: Float32Array, w: number, h: number, stride: number, ch: number, radius: number): void {
  const a = new Float32Array(w * h);
  const b = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = px[i * stride + ch];
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    for (let l = 0; l < lines; l++) {
      let acc = 0;
      const at = (i: number) => src[horizontal ? l * w + Math.min(len - 1, Math.max(0, i)) : Math.min(len - 1, Math.max(0, i)) * w + l];
      for (let k = -radius; k <= radius; k++) acc += at(k);
      for (let i = 0; i < len; i++) {
        dst[horizontal ? l * w + i : i * w + l] = acc / (2 * radius + 1);
        acc += at(i + radius + 1) - at(i - radius);
      }
    }
  };
  for (let it = 0; it < 3; it++) {
    pass(a, b, true);
    pass(b, a, false);
  }
  for (let i = 0; i < w * h; i++) px[i * stride + ch] = a[i];
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
}

/**
 * Sample the ground look at map uv (five fetches). `warpedUv` (optional) is used for the colour and
 * scalar layers — the terrain domain-warps them so region borders are never straight lines — while
 * the landmark layer (turf, rockiness) stays at `uv`. `explicitLod` makes the fetches legal in
 * non-uniform control flow.
 */
export function groundPalette(tex: DataArrayTexture, uv: N, explicitLod = false, warpedUv: N = uv): GroundPalette {
  const f = (L: number): N => {
    const t = texture(tex, L < 4 ? warpedUv : uv).depth(int(L));
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
}
export interface AtmoLook {
  /** multiplier on the in-scattered haze colour, linear (#ffffff / [1, 1, 1] = neutral; > 1 = luminous) */
  tint: Color;
  /** multiplier on the haze density */
  density: number;
  /** multiplier on the sky dome when the camera looks at this region */
  sky: Color;
  /** local haze features around places (Rivendell's luminous valley, the Dead Marshes' damp) */
  spots: AtmoSpot[];
}

interface GradeJson {
  tint?: string;
  saturation?: number;
  contrast?: number;
  exposure?: number;
  lift?: number[];
  redKeep?: number;
  bloom?: number;
  spots?: (GradeJson & { place: string; radiusKm: number })[];
}
interface AtmoJson {
  tint?: ColorJson;
  density?: number;
  sky?: ColorJson;
  spots?: AtmoSpot[];
}

/** Parse an authored colour (hex → linear via Color, arrays are already linear). */
export function lookColor(c: ColorJson | undefined, fallback = '#ffffff'): Color {
  if (Array.isArray(c)) return new Color(c[0] ?? 1, c[1] ?? 1, c[2] ?? 1);
  return new Color(c ?? fallback);
}

function parseGrade(g: GradeJson): Omit<GradeLook, 'spots'> {
  const lift = g.lift ?? [0, 0, 0];
  return {
    tint: new Color(g.tint ?? '#ffffff'),
    saturation: g.saturation ?? 1,
    contrast: g.contrast ?? 1,
    exposure: g.exposure ?? 0,
    lift: [lift[0] ?? 0, lift[1] ?? 0, lift[2] ?? 0],
    redKeep: g.redKeep ?? 0,
    bloom: g.bloom ?? 0,
  };
}

export function gradeLook(id: string): GradeLook {
  const g = ((looksJson.regions as Record<string, { grade?: GradeJson }>)[id]?.grade ?? {}) as GradeJson;
  return { ...parseGrade(g), spots: (g.spots ?? []).map((s) => ({ place: s.place, radiusKm: s.radiusKm, grade: parseGrade(s) })) };
}

export function atmoLook(id: string): AtmoLook {
  const a = ((looksJson.regions as Record<string, { atmo?: AtmoJson }>)[id]?.atmo ?? {}) as AtmoJson;
  return {
    tint: lookColor(a.tint),
    density: a.density ?? 1,
    sky: lookColor(a.sky),
    spots: a.spots ?? [],
  };
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
  /** amplitude of the 60 km / 12 km / 3 km noise on the snow line (mean 0; the water uses none) */
  snowLineNoise: [2.4, 1.1, 0.45] as const,
  /** snow fades in over this many units above the line */
  snowFade: 2.2,
  /** north-facing faces hold snow lower: effective height + northness (−n.z) · this */
  snowNorth: 2.8,
  /** snow sheds from slopes steeper than [a, b]; concave gullies hold it `snowGully` steeper */
  snowSlope: [0.3, 0.6] as const,
  snowGully: 0.16,
  /** snow albedo (sRGB) */
  snow: 0xe4e8ee,
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
  /** wetland: open pools, reed / sedge mottle (sRGB) */
  wetPool: 0x1f2a28,
  wetReed: 0x4f5438,
  wetSedge: 0x5d6247,
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
  return smoothstep(line, line.add(T.snowFade), hEff)
    .mul(float(1).sub(smoothstep(g.add(T.snowSlope[0]), g.add(T.snowSlope[1]), slope)))
    .mul(float(1).sub(volcanic));
}

/**
 * Coarse terrain albedo (linear) for secondary views of the terrain (the water's reflected
 * terrain): the ground look at its mean dryness + rock + snow from the same rules as the terrain
 * material, without its noise, curvature, masks or detail textures.
 */
export function coarseGroundAlbedo(pal: GroundPalette, h: N, slope: N, southness: N, northness: N): N {
  const T = TERRAIN_SHADE;
  const line = snowLineAt(pal, southness);
  const hEff = h.add(northness.mul(T.snowNorth));
  const ground = mix(pal.grass, pal.dry, clamp(pal.dryness.add(h.mul(T.drynessPerHeight)), 0, 1));
  const rock = rockAt(slope, alpineAt(hEff, line), float(0), pal.rockiness);
  const snow = snowAt(hEff, slope, line, pal.volcanic);
  return mix(mix(ground, pal.rock, rock), srgbNode(T.snow), snow);
}
