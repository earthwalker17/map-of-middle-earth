import { MeshStandardNodeMaterial, type Material } from 'three/webgpu';
import type { LightGate } from '../landmarks/records.ts';
import { tsl } from './tsl.ts';
import { env } from './environment.ts';

// NB: TSL vec3(new Color()) silently yields black in r186 — always use color(Color) for colour constants
const { Fn, float, vec3, attribute, mx_noise_float, positionWorld, fwidth, length, smoothstep, mix, clamp, max, sin, step, round, sRGBTransferEOTF } = tsl;

/**
 * Material families v2 (S3): every built structure is drawn with ONE of two shared uber materials —
 * `structure` (opaque, lit, casts shadows) and `glow` (emissive, gated by the time of day, casts no
 * shadow). A family is DATA packed into two vertex attributes, so variety never costs a pipeline:
 *
 *  - `color` (Uint8×4, normalised): rgb = sRGB albedo — the ABSOLUTE paint of the vertex (family preset,
 *    or an explicit colour, times shade) — and a = baked ambient occlusion (kit/ao.ts; 1 = open).
 *  - `surf`  (Uint8×4, normalised):
 *      structure → r roughness, g metalness, b grain (0..1 noise amplitude), a noise class / 3
 *                  (0 stone · 1 wood streak · 2 fibre / thatch · 3 smooth)
 *      glow      → r strength / GLOW_MAX, g gate code / 3 (0 always · 1 night · 2 dusk · 3 event),
 *                  b flicker depth, a unused
 *
 * Positions and normals are Float32 — four vertex buffers per draw in total.
 */
export type FamilyId =
  | 'stone'
  | 'darkStone'
  | 'weathered'
  | 'plaster'
  | 'wood'
  | 'thatch'
  | 'slate'
  | 'roofTile'
  | 'gold'
  | 'obsidian'
  | 'iron'
  | 'foliage'
  | 'metal'
  | 'emissive'
  | 'emissiveGreen'
  | 'lava'
  | 'ithildin';

/** Surface pattern of the structure shader (fwidth-faded world-space noise). */
export const NOISE = { stone: 0, wood: 1, fibre: 2, smooth: 3 } as const;
export type NoiseClass = (typeof NOISE)[keyof typeof NOISE];

export interface GlowPreset {
  /** sRGB hex of the emitted light (also the dim daytime albedo) */
  color: number;
  /** emissive multiplier on the linear colour (0 … GLOW_MAX) */
  strength: number;
  /** when it is lit (see `gateNode`) */
  gate: LightGate;
  /** 0..1 deterministic flicker depth (env.tFx + world position) */
  flicker: number;
}

export interface FamilyPreset {
  /** sRGB hex base paint */
  albedo: number;
  roughness: number;
  metalness: number;
  /** 0..1 noise amplitude on the albedo */
  grain: number;
  noise: NoiseClass;
  /** present → the family renders with the `glow` material */
  glow?: GlowPreset;
}

/** Strength encoding range of glow vertices (surf.r × GLOW_MAX). */
export const GLOW_MAX = 16;

export const FAMILY: Record<FamilyId, FamilyPreset> = {
  stone: { albedo: 0xd9d3c4, roughness: 0.82, metalness: 0, grain: 0.22, noise: NOISE.stone },
  darkStone: { albedo: 0x1d1c20, roughness: 0.72, metalness: 0.05, grain: 0.35, noise: NOISE.stone },
  weathered: { albedo: 0x8a857a, roughness: 0.9, metalness: 0, grain: 0.3, noise: NOISE.stone },
  plaster: { albedo: 0xe6dfcf, roughness: 0.9, metalness: 0, grain: 0.1, noise: NOISE.smooth },
  wood: { albedo: 0x5a4330, roughness: 0.85, metalness: 0, grain: 0.3, noise: NOISE.wood },
  thatch: { albedo: 0xa88a4a, roughness: 0.95, metalness: 0, grain: 0.35, noise: NOISE.fibre },
  slate: { albedo: 0x5f6266, roughness: 0.7, metalness: 0, grain: 0.2, noise: NOISE.stone },
  roofTile: { albedo: 0x8a4b32, roughness: 0.75, metalness: 0, grain: 0.25, noise: NOISE.stone },
  gold: { albedo: 0xb8923a, roughness: 0.45, metalness: 0.5, grain: 0.12, noise: NOISE.smooth },
  obsidian: { albedo: 0x141619, roughness: 0.22, metalness: 0.1, grain: 0.06, noise: NOISE.smooth },
  iron: { albedo: 0x292b25, roughness: 0.5, metalness: 0.6, grain: 0.2, noise: NOISE.stone },
  foliage: { albedo: 0x3d5a2a, roughness: 0.9, metalness: 0, grain: 0.4, noise: NOISE.stone },
  metal: { albedo: 0x6a6660, roughness: 0.4, metalness: 0.8, grain: 0.2, noise: NOISE.smooth },
  // glow families: lamps / fires light up at night (the Lórien flets no longer glow at noon), lava and
  // Morgul magic always burn, ithildin wakes under the moon
  emissive: { albedo: 0xff7a1a, roughness: 0.6, metalness: 0, grain: 0, noise: NOISE.smooth, glow: { color: 0xff7a1a, strength: 4.5, gate: 'night', flicker: 0.06 } },
  emissiveGreen: { albedo: 0x7ee6a0, roughness: 0.6, metalness: 0, grain: 0, noise: NOISE.smooth, glow: { color: 0x7ee6a0, strength: 2.4, gate: 'always', flicker: 0.12 } },
  lava: { albedo: 0xff3a0a, roughness: 0.6, metalness: 0, grain: 0, noise: NOISE.smooth, glow: { color: 0xff3a0a, strength: 3.2, gate: 'always', flicker: 0.18 } },
  ithildin: { albedo: 0xdff3ff, roughness: 0.6, metalness: 0, grain: 0, noise: NOISE.smooth, glow: { color: 0xdff3ff, strength: 2.0, gate: 'night', flicker: 0.02 } },
};

export const FAMILY_IDS = Object.keys(FAMILY) as FamilyId[];

/** The two landmark material keys (records.ts LodGeometry keys). */
export type MaterialKey = 'structure' | 'glow';
export const MATERIAL_KEYS: readonly MaterialKey[] = ['structure', 'glow'];

export const GATE_CODE: Record<LightGate, number> = { always: 0, night: 1, dusk: 2, event: 3 };

/** Which uber material a family renders with. */
export function familyKey(fam: FamilyId): MaterialKey {
  return FAMILY[fam].glow ? 'glow' : 'structure';
}

// ------------------------------------------------------------------ colour helpers (CPU, exact)
const toLin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB hex → linear rgb 0..1 */
export function hexToLinear(hex: number): [number, number, number] {
  return [toLin(((hex >> 16) & 255) / 255), toLin(((hex >> 8) & 255) / 255), toLin((hex & 255) / 255)];
}

/** linear rgb → sRGB bytes */
export function linearToSrgbBytes(c: [number, number, number]): [number, number, number] {
  const b = (v: number) => Math.round(Math.min(1, Math.max(0, toSrgb(v))) * 255);
  return [b(c[0]), b(c[1]), b(c[2])];
}

/** physical albedo range the `shade` multiplier may not push a paint out of (linear) */
export const ALBEDO_MIN = 0.02;
export const ALBEDO_MAX = 0.85;

/**
 * Linear paint of a part: the family preset (or glow colour) × legacy `tint`, or an ABSOLUTE `paint`
 * (sRGB hex), times `shade` (0.5–1.6, may lighten). `shade` never pushes a channel outside
 * [ALBEDO_MIN, ALBEDO_MAX] unless the paint itself already lies outside (obsidian stays obsidian).
 */
export function paintLinear(fam: FamilyId, paint?: number, shade = 1, tint?: number): [number, number, number] {
  const p = FAMILY[fam];
  let c = hexToLinear(paint ?? p.glow?.color ?? p.albedo);
  if (paint === undefined && tint !== undefined) {
    const t = hexToLinear(tint);
    c = [c[0] * t[0], c[1] * t[1], c[2] * t[2]];
  }
  if (shade !== 1)
    c = c.map((v) => Math.min(Math.max(v * shade, Math.min(v, ALBEDO_MIN)), Math.max(v, ALBEDO_MAX))) as [number, number, number];
  return c;
}

/** Packed per-vertex family data (bytes 0..255): `color` = sRGB paint + AO (255 = open), `surf` = see header. */
export interface FamilyVertex {
  color: [number, number, number, number];
  surf: [number, number, number, number];
}

/** Optional per-part overrides of a glow family's preset. */
export type GlowOverride = Partial<Pick<GlowPreset, 'strength' | 'gate' | 'flicker'>>;

/**
 * Pack a family (+ optional absolute paint / shade / legacy tint / glow override) into vertex bytes.
 * Shared by the TS kit and the GLB path (W2: `fam:<FamilyId>` material names → these bytes).
 */
export function familyVertex(fam: FamilyId, paint?: number, shade = 1, tint?: number, glow?: GlowOverride): FamilyVertex {
  const p = FAMILY[fam];
  const [r, g, b] = linearToSrgbBytes(paintLinear(fam, paint, shade, tint));
  const u = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  if (p.glow) {
    const gl = { ...p.glow, ...glow };
    return { color: [r, g, b, 255], surf: [u(gl.strength / GLOW_MAX), GATE_CODE[gl.gate] * 85, u(gl.flicker), 0] };
  }
  return { color: [r, g, b, 255], surf: [u(p.roughness), u(p.metalness), u(p.grain), p.noise * 85] };
}

// ------------------------------------------------------------------ shaders

/**
 * Light gate as a function of the env uniforms (records.ts LightGate), shared with the EmissionSystem
 * semantics: always 1 · night: smoothstep(0.2, 0.7, night) + 0.4·twilight (clamped) · dusk:
 * 0.25 + 0.75·max(night, golden) · event: 0 (switched by the S4 timeline).
 */
export function gateNode(code: unknown): unknown {
  const c = round(code);
  const night = clamp(smoothstep(0.2, 0.7, env.night).add(env.twilight.mul(0.4)), 0, 1);
  const dusk = float(0.25).add(max(env.night, env.golden).mul(0.75));
  // code 0 → 1, 1 → night, 2 → dusk, 3 → 0
  const isAlways = float(1).sub(step(0.5, c));
  const isNight = step(0.5, c).mul(float(1).sub(step(1.5, c)));
  const isDusk = step(1.5, c).mul(float(1).sub(step(2.5, c)));
  return isAlways.add(isNight.mul(night)).add(isDusk.mul(dusk));
}

function structureMaterial(): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0 });
  const col = attribute('color', 'vec4');
  const surf = attribute('surf', 'vec4');
  const ao = col.a;
  const noise = Fn(() => {
    const p = positionWorld;
    const cls = surf.a.mul(3);
    // anisotropy by class: wood = vertical streaks (planks), fibre = finer streaks (thatch), smooth = faint
    const isWood = step(0.5, cls).mul(float(1).sub(step(1.5, cls)));
    const isFibre = step(1.5, cls).mul(float(1).sub(step(2.5, cls)));
    const isSmooth = step(2.5, cls);
    const ay = float(1).sub(isWood.mul(0.88)).sub(isFibre.mul(0.7));
    const axz = float(1).add(isWood.mul(0.6)).add(isFibre.mul(1.2));
    const q = vec3(p.x.mul(axz), p.y.mul(ay), p.z.mul(axz));
    // octaves ~9, 37, 140 per km, each faded out where it would shimmer (texel footprint)
    const fw = length(fwidth(q));
    const w1 = float(1).sub(smoothstep(0.35, 1, fw.mul(9)));
    const w2 = float(1).sub(smoothstep(0.35, 1, fw.mul(37)));
    const w3 = float(1).sub(smoothstep(0.35, 1, fw.mul(140)));
    const n = mx_noise_float(q.mul(9)).mul(w1.mul(0.5)).add(mx_noise_float(q.mul(37)).mul(w2.mul(0.3))).add(mx_noise_float(q.mul(140)).mul(w3.mul(0.2)));
    return n.mul(float(1).sub(isSmooth.mul(0.75)));
  })();
  const albedo = sRGBTransferEOTF(col.rgb);
  m.colorNode = albedo.mul(float(1).add(noise.mul(surf.b))).mul(mix(float(1), ao, 0.6));
  m.aoNode = ao;
  m.roughnessNode = clamp(surf.r.add(noise.mul(0.08)), 0.04, 1);
  m.metalnessNode = surf.g;
  return m;
}

function glowMaterial(): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0 });
  const col = attribute('color', 'vec4');
  const surf = attribute('surf', 'vec4');
  const paint = sRGBTransferEOTF(col.rgb);
  m.colorNode = paint.mul(0.25);
  m.emissiveNode = Fn(() => {
    // deterministic flicker from the effect clock + world position (never wall-clock time)
    const phase = positionWorld.x.mul(3.1).add(positionWorld.z.mul(1.7));
    const f = float(1).add(sin(env.tFx.mul(7.3).add(phase)).mul(sin(env.tFx.mul(2.9).add(phase.mul(0.37)))).mul(surf.b));
    return paint.mul(surf.r.mul(GLOW_MAX)).mul(gateNode(surf.g.mul(3))).mul(max(f, 0.2));
  })();
  return m;
}

const cache = new Map<MaterialKey, Material>();

/** The shared material for a key (created once). */
export function sharedMaterial(key: MaterialKey): Material {
  const hit = cache.get(key);
  if (hit) return hit;
  const m = key === 'glow' ? glowMaterial() : structureMaterial();
  m.name = `family:${key}`;
  cache.set(key, m);
  return m;
}

/**
 * Material for a landmark geometry key (records.ts LodGeometry): 'structure' | 'glow'. Legacy family ids
 * resolve to the uber material they render with (for safety — kit v2 only emits the two keys).
 */
export function materialFor(key: string): Material {
  if (key === 'structure' || key === 'glow') return sharedMaterial(key);
  if (key in FAMILY) return sharedMaterial(familyKey(key as FamilyId));
  throw new Error(`materialFor: unknown landmark material key '${key}'`);
}

/** Legacy accessor (S1 API): the uber material a family renders with. */
export function family(id: FamilyId): Material {
  return sharedMaterial(familyKey(id));
}

