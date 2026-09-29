import { Color } from 'three/webgpu';
import { tsl, type TslNode } from './tsl.ts';

const { float, int, texture, uniformArray, vec3 } = tsl;
import looksJson from '../../data/world/looks.json';
import type { World } from '../world/World.ts';

type N = TslNode;

/**
 * Region look data as GPU arrays, indexed like the baked look layers (manifest.look.regions).
 * `regionWeights(uv)` returns one weight node per region (they sum to 1).
 */
export class LookNodes {
  readonly count: number;
  readonly grass;
  readonly dry;
  readonly soil;

  constructor(readonly world: World) {
    bindLookWorld(world);
    const ids = world.lookRegions;
    this.count = ids.length;
    const col = (hex: string) => new Color(hex);
    const g = ids.map((id) => col(looksJson.regions[id].ground.grass));
    const d = ids.map((id) => col(looksJson.regions[id].ground.dry));
    const s = ids.map((id) => col(looksJson.regions[id].ground.soil));
    // palette colours are authored in sRGB; Color(hex) converts to linear working space
    this.grass = uniformArray(g, 'color');
    this.dry = uniformArray(d, 'color');
    this.soil = uniformArray(s, 'color');
  }

  index(id: string): number {
    return this.world.lookRegions.indexOf(id as never);
  }

  /**
   * Per-region weights at map uv (one texture fetch per 4 regions). `level` forces an explicit-LOD
   * fetch, which is legal inside non-uniform control flow (e.g. a reflection march branch).
   */
  regionWeights(uv: N, level?: number): N[] {
    const layers = Math.ceil(this.count / 4);
    const w: N[] = [];
    for (let L = 0; L < layers; L++) {
      const t = texture(this.world.look, uv).depth(int(L));
      const s = level === undefined ? t : t.level(level);
      for (let c = 0; c < 4 && L * 4 + c < this.count; c++) w.push(s.element(int(c)) as N);
    }
    return w;
  }

  /** Weighted ground palette {grass, dry, soil} at the given weights. */
  palette(weights: N[]): { grass: N; dry: N; soil: N } {
    let grass: N = vec3(0);
    let dry: N = vec3(0);
    let soil: N = vec3(0);
    weights.forEach((w, i) => {
      grass = grass.add(this.grass.element(int(i)).mul(w));
      dry = dry.add(this.dry.element(int(i)).mul(w));
      soil = soil.add(this.soil.element(int(i)).mul(w));
    });
    return { grass, dry, soil };
  }

  weightOf(weights: N[], id: string): N {
    const i = this.index(id);
    return i >= 0 ? weights[i] : float(0);
  }
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

export function gradeLook(id: string): GradeLook {
  const g = ((looksJson.regions as Record<string, { grade?: GradeJson }>)[id]?.grade ?? {}) as GradeJson;
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
 * The world whose look layers the CPU-side looks (RegionLook grade, regional haze) read. Static
 * data, bound once before the first frame: by the EnvironmentSystem when it is given the world,
 * and by every LookNodes (the terrain material builds one at init).
 */
let lookWorld: World | null = null;
const lookListeners: ((w: World) => void)[] = [];

export function bindLookWorld(world: World): void {
  if (lookWorld === world) return;
  lookWorld = world;
  for (const f of lookListeners) f(world);
}

export function boundLookWorld(): World | null {
  return lookWorld;
}

/** Run `f` once the look world is bound (immediately if it already is). */
export function onLookWorld(f: (w: World) => void): void {
  lookListeners.push(f);
  if (lookWorld) f(lookWorld);
}

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
