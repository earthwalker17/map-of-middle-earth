import { MeshStandardNodeMaterial, type Material } from 'three/webgpu';
import type { LightGate } from '../landmarks/records.ts';
import { tsl, type TslNode } from './tsl.ts';
import { env } from './environment.ts';
import { strata, strataFootprint, strataSteep } from './strata.ts';
import { gateCode, gateNode } from './gates.ts';
import { spillIrradiance } from '../emission/spill.ts';

// NB: TSL vec3(new Color()) silently yields black in r186 — always use color(Color) for colour constants
const { Fn, If, float, vec3, vec4, attribute, fract, min, mx_noise_float, positionWorld, positionLocal, normalGeometry, normalView, normalWorld, cameraPosition, reflect, normalize, positionViewDirection, fwidth, length, smoothstep, mix, clamp, max, abs, sin, step, floor, select, hash, dot, sRGBTransferEOTF } = tsl;

/**
 * Noise class of rock faces (kit cliffs, `ProxyKit.cliff`): stone noise WITHOUT the masonry coursing +
 * optionally the shared strata (strata.ts).
 */
const ROCK_CLASS = 5; // = NOISE.rock (declared below)
/** The shared strata on the rock class (kit cliffs band with the terrain's world-space bedding). */
const KIT_STRATA = true;
/**
 * strata on kit faces: a kit cliff is only 0.5–1.5 units tall — at the terrain's bed spacing it sits inside
 * one or two beds and shows no banding (the W1-B 'no banding' finding) — so kit faces take beds at 0.3× the
 * spacing (formations ≈ 0.7, beds ≈ 0.18, laminae ≈ 0.05 units; the same world-space, dipping bedding
 * planes, so they run on level with the terrain's) and a stronger contrast under their vertex colour and AO
 */
const KIT_STRATA_SCALE = 0.3;
const KIT_STRATA_CONTRAST = 3.0;

/**
 * Material families v2 (S3): every built structure is drawn with ONE of two shared uber materials —
 * `structure` (opaque, lit, casts shadows) and `glow` (emissive, gated by the time of day, casts no
 * shadow). A family is DATA packed into two vertex attributes, so variety never costs a pipeline:
 *
 *  - `color` (Uint8×4, normalised): rgb = sRGB albedo — the ABSOLUTE paint of the vertex (family preset,
 *    or an explicit colour, times shade) — and a = baked hemisphere ambient occlusion (kit/ao.ts; 1 = open),
 *    which feeds the material's AO slot only (indirect light), never the albedo.
 *  - `surf`  (Uint8×4, normalised):
 *      structure → r roughness, g metalness, b grain (0..1 noise amplitude), a = noise class × 32 +
 *                  ground contact (0..31, 31 = free; kit/ao.ts): classes 0 stone (+ coursing) · 1 wood
 *                  streak · 2 fibre / thatch · 3 smooth · 4 foliage (leaf clumps) · 5 rock (kit cliffs,
 *                  strata) · 6 roof (S4) · 7 carved (S4: sculpted stone, no coursing). The contact term
 *                  darkens the albedo at the foot of a part (× mix(1, contact, CONTACT_WEIGHT); built
 *                  classes take W.contact plus a damp tint and a mild AO crevice grime — see weathering()).
 *      glow      → r strength / GLOW_MAX, g gate code × 32 / 255 (materials/gates.ts: 0 night · 1 nightDim ·
 *                  2 dusk · 3 always · 4.. event slots),
 *                  b flicker depth, a albedo under the emission spill (GlowPreset.spill; 0 = self-luminous)
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

/**
 * Surface pattern of the structure shader (fwidth-faded landmark-space noise). S4 W4-S1: `roof` (6) —
 * slates, tiles and shingles: courses along the slope, darker eaves (the fascia / soffit faces of the roof
 * part), per-slate value jitter, moss; the slate / roofTile families carry it and the kit tags its house
 * and tower roofs with it (ProxyKit.tagRoof) whatever their family (Lake-town roofs are darkStone).
 * `carved` (7) — sculpted stone (Blender hero statues, `carvedVertex`): the stone noise and the weathering
 * (tone, stains, streaks, grime) without masonry courses or joints, which drew a plaid grid across the
 * Argonath's robes.
 */
export const NOISE = { stone: 0, wood: 1, fibre: 2, smooth: 3, foliage: 4, rock: 5, roof: 6, carved: 7 } as const;
export type NoiseClass = (typeof NOISE)[keyof typeof NOISE];

/**
 * S4 W4-S1 weathering of built surfaces (every class but foliage and rock), all in landmark-local km and
 * faded by the pixel footprint, so wides keep the crisp model read and never shimmer:
 *  - tone: the house-scale noise octave (≈ 0.11 km) as a per-part value breakup, plus a district-scale
 *    (≈ 0.5 km) value / warm–cool drift and darker grime stains — neighbouring houses and wall runs never
 *    share one flat paint, and the big value shapes outweigh the small ones;
 *  - tonal courses on stone: large masonry courses and staggered blocks with a hashed value each, their
 *    cell edges warped by the noise (no axis-aligned mosaic);
 *  - rain / grime streaks on walls: hashed columns at three widths, each a long taper (8–24 widths)
 *    hanging from a hashed "ledge" line, soft across; drawn only where a column spans ≥ ~4 px (finer
 *    columns aliased into plank-like stripes) and replaced by their mean beyond (rust-tinted on metals);
 *  - crevice grime from the baked hemisphere AO (corners, under eaves and ledges, narrow lanes) and a
 *    stronger, damp-tinted ground-contact term at the foot of every part (soot / damp rising); the total
 *    darkening relative to the S3 albedo is floored (W.floor: no crushed crevices);
 *  - roofs (class roof): courses with a shadowed lip under each course, slate jitter, darker eaves
 *    (soffits, and fascias where resolved), moss; thatch (fibre) courses at two scales, grey weathering and
 *    a per-roof tone; wood: boards with dark seams, per-board tone, greyed timber in patches;
 *  - dark paints (iron-dark stone, iron): a pale dust deposit instead of grime; glossy paints (obsidian)
 *    stay clean and glossy.
 * The weathering also returns its amount (0..1): weathered patches turn matte and partly dielectric.
 * Toggle with WEATHERING_ON (false = the S3 surfaces).
 */
export const WEATHERING_ON = true;
/**
 * Tier of the structure material, set by LandmarkSystem.init before the first landmark mesh takes its
 * (singleton) material: the preview tier renders the S3 surfaces (no weathering — its hashed cells, streak
 * columns and district noise cost ≈ 10 % of a structure-heavy preview frame); review / final weather.
 */
export const structureTier = { full: true };
const W = {
  /** per-part value amplitude of the house-scale octave */
  tone: 0.12,
  /** district-scale value drift and its warm / cool hue shift */
  district: 0.09,
  hue: 0.05,
  /** district-scale grime stains (darkening only) */
  stain: 0.2,
  /** tonal masonry courses (stone): course height, block length (km), value amplitude (±) */
  course: 0.07,
  block: 0.19,
  courseTone: 0.075,
  /** warp of the course / block cell edges (share of a cell, by the fine / house-scale octaves) */
  courseWarp: 0.22,
  /** darkening of the joint line at the foot of each course */
  joint: 0.16,
  /** grime / rain streak column widths (km), lengths (in widths), darkening, mean where unresolved; timber
   *  takes streakWood of it (its boards already carry the grain). S4 C2: 0.62 → 0.34 and no 0.03 km width —
   *  the critics read the denser, darker streaks as vertical wood grain on stone (Argonath, Morannon) */
  streakW: [0.2, 0.08] as const,
  streakLen: [8, 24] as const,
  streakDark: 0.34,
  streakWood: 0.5,
  streakMean: 0.08,
  /** crevice grime from the baked AO (darkening at the AO floor, away from the foot) */
  aoDirt: 0.2,
  /** ground-contact weight of built classes (CONTACT_WEIGHT stays for foliage / rock) */
  contact: 0.5,
  /** floor of the weathering's total darkening relative to the S3 albedo (luminance) */
  floor: 0.55,
  /** roof courses (km), lip shadow, highlight of the butt edge, slate jitter, eave darkening, moss */
  roofRow: 0.014,
  roofLip: 0.34,
  roofEdge: 0.08,
  roofJit: 0.2,
  eave: 0.55,
  moss: 0.55,
  /** thatch courses (km) and their shadow band; coarser bands (km) that survive at hero distance; per-roof tone */
  thatchRow: 0.022,
  thatchBand: 0.24,
  thatchRow2: 0.066,
  thatchBand2: 0.12,
  thatchTone: 0.15,
  /** wood boards (km): width, length, per-board jitter, seam darkening */
  board: 0.011,
  boardLen: 0.075,
  boardJit: 0.18,
  seam: 0.35,
  /** pale deposit on dark paints (luminance < ≈ 0.1): share of the paint replaced at full dust, its colour (linear) */
  dust: 0.5,
  dustColor: [0.1, 0.094, 0.088] as const,
} as const;

export interface GlowPreset {
  /** sRGB hex of the emitted light (also the dim daytime albedo) */
  color: number;
  /** emissive multiplier on the linear colour (0 … GLOW_MAX) */
  strength: number;
  /** when it is lit (see `gateNode`) */
  gate: LightGate;
  /** 0..1 deterministic flicker depth (env.tFx + world position) */
  flicker: number;
  /** gate 'event': the SceneState.events channel (materials/gates.ts EVENT_SLOT) */
  event?: string;
  /**
   * albedo under the emission spill (0..1, default 0): a skin that stands for lit stone (the Morgul
   * wall wash) takes the spill of nearby sources like the stone under it; self-luminous skins (lava,
   * windows, ithildin, the Eye) keep 0 — they are not lit by their own lights. Packed in `surf.a`.
   */
  spill?: number;
}

export interface FamilyPreset {
  /** sRGB hex base paint */
  albedo: number;
  roughness: number;
  metalness: number;
  /** 0..1 noise amplitude on the albedo */
  grain: number;
  noise: NoiseClass;
  /** floor of the baked hemisphere AO (default AO_MIN; leaf masses transmit light: 0.5) */
  aoMin?: number;
  /** present → the family renders with the `glow` material */
  glow?: GlowPreset;
}

/** Default floor of the baked hemisphere AO (kit/ao.ts). */
export const AO_MIN = 0.35;
/**
 * Weight of the baked ground-contact term on the albedo: albedo × mix(1, contact, CONTACT_WEIGHT) — foliage
 * and rock; built classes take W.contact (+ a damp tint) when WEATHERING_ON.
 */
export const CONTACT_WEIGHT = 0.3;
/** Bits of `surf.a` holding the contact term (the noise class sits above them). */
export const CONTACT_LEVELS = 31;

/** Strength encoding range of glow vertices (surf.r × GLOW_MAX). */
export const GLOW_MAX = 16;

/** albedo under the emission spill of a stone-like glow skin (GlowPreset.spill; spill.ts) */
const GLOW_SPILL_ALBEDO = 0.3;

export const FAMILY: Record<FamilyId, FamilyPreset> = {
  stone: { albedo: 0xd9d3c4, roughness: 0.82, metalness: 0, grain: 0.22, noise: NOISE.stone },
  // near-black iron-dark stone (Barad-dûr, the Morannon): roughness 0.5 so edges catch the light
  darkStone: { albedo: 0x201c1a, roughness: 0.5, metalness: 0.05, grain: 0.3, noise: NOISE.stone },
  weathered: { albedo: 0x8a857a, roughness: 0.9, metalness: 0, grain: 0.3, noise: NOISE.stone },
  plaster: { albedo: 0xe6dfcf, roughness: 0.9, metalness: 0, grain: 0.1, noise: NOISE.smooth },
  wood: { albedo: 0x5a4330, roughness: 0.85, metalness: 0, grain: 0.3, noise: NOISE.wood },
  thatch: { albedo: 0xa88a4a, roughness: 0.95, metalness: 0, grain: 0.35, noise: NOISE.fibre },
  slate: { albedo: 0x5f6266, roughness: 0.7, metalness: 0, grain: 0.2, noise: NOISE.roof },
  roofTile: { albedo: 0x8a4b32, roughness: 0.75, metalness: 0, grain: 0.25, noise: NOISE.roof },
  gold: { albedo: 0xb8923a, roughness: 0.45, metalness: 0.5, grain: 0.12, noise: NOISE.smooth },
  obsidian: { albedo: 0x141619, roughness: 0.22, metalness: 0.1, grain: 0.06, noise: NOISE.smooth },
  iron: { albedo: 0x292b25, roughness: 0.5, metalness: 0.6, grain: 0.2, noise: NOISE.stone },
  foliage: { albedo: 0x3d5a2a, roughness: 0.9, metalness: 0, grain: 0.5, noise: NOISE.foliage, aoMin: 0.5 },
  metal: { albedo: 0x6a6660, roughness: 0.4, metalness: 0.8, grain: 0.2, noise: NOISE.smooth },
  // glow families: lamps / fires light up at night (the Lórien flets no longer glow at noon), lava and
  // Morgul magic always burn, ithildin wakes under the moon
  emissive: { albedo: 0xff7a1a, roughness: 0.6, metalness: 0, grain: 0, noise: NOISE.smooth, glow: { color: 0xff7a1a, strength: 4.5, gate: 'night', flicker: 0.06 } },
  emissiveGreen: { albedo: 0x7ee6a0, roughness: 0.6, metalness: 0, grain: 0, noise: NOISE.smooth, glow: { color: 0x7ee6a0, strength: 2.4, gate: 'always', flicker: 0.12, spill: GLOW_SPILL_ALBEDO } },
  lava: { albedo: 0xff3a0a, roughness: 0.6, metalness: 0, grain: 0, noise: NOISE.smooth, glow: { color: 0xff3a0a, strength: 3.2, gate: 'always', flicker: 0.18 } },
  ithildin: { albedo: 0xdff3ff, roughness: 0.6, metalness: 0, grain: 0, noise: NOISE.smooth, glow: { color: 0xdff3ff, strength: 2.0, gate: 'night', flicker: 0.02 } },
};

export const FAMILY_IDS = Object.keys(FAMILY) as FamilyId[];

/** The two landmark material keys (records.ts LodGeometry keys). */
export type MaterialKey = 'structure' | 'glow';
export const MATERIAL_KEYS: readonly MaterialKey[] = ['structure', 'glow'];

/**
 * Glow vertices carry the shared gate code (materials/gates.ts) in `surf.g` = code × GATE_STEP / 255
 * (codes 0..7: night, nightDim, dusk, always, event slots).
 */
const GATE_STEP = 32;

/** AO floor of a family's vertices (kit/ao.ts). */
export function aoFloor(fam: FamilyId): number {
  return FAMILY[fam].aoMin ?? AO_MIN;
}

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

/** Packed per-vertex family data (bytes 0..255): `color` = sRGB paint + AO (255 = open), `surf` = see header (contact 31 = free). */
export interface FamilyVertex {
  color: [number, number, number, number];
  surf: [number, number, number, number];
}

/** Optional per-part overrides of a glow family's preset. */
export type GlowOverride = Partial<Pick<GlowPreset, 'strength' | 'gate' | 'flicker' | 'event'>>;

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
    return { color: [r, g, b, 255], surf: [u(gl.strength / GLOW_MAX), gateCode(gl.gate, undefined, gl.event) * GATE_STEP, u(gl.flicker), u(gl.spill ?? 0)] };
  }
  return { color: [r, g, b, 255], surf: [u(p.roughness), u(p.metalness), u(p.grain), p.noise * 32 + CONTACT_LEVELS] };
}

/**
 * S4 W4-S1: the same vertex bytes as sculpted stone (NOISE.carved — the weathering without masonry
 * courses or joints) when the family is a stone-class structure family; anything else is returned as is.
 * For Blender hero statues (landmarks/model.ts), whose carved forms the kit's coursing would grid over.
 */
export function carvedVertex(fam: FamilyId, v: FamilyVertex): FamilyVertex {
  const a = v.surf[3];
  if (FAMILY[fam].glow || Math.floor(a / 32) !== NOISE.stone) return v;
  return { color: v.color, surf: [v.surf[0], v.surf[1], v.surf[2], NOISE.carved * 32 + (a % 32)] };
}

// ------------------------------------------------------------------ shaders

/** The glow vertices' gate (materials/gates.ts gateNode) from their `surf.g` byte. */
function glowGate(surfG: TslNode): TslNode {
  return gateNode(surfG.mul(255 / GATE_STEP));
}

interface WeatherMasks {
  isStone: TslNode;
  isWood: TslNode;
  isFibre: TslNode;
  isRoof: TslNode;
  built: TslNode;
}

const lum = (c: TslNode): TslNode => dot(c, vec3(0.2126, 0.7152, 0.0722));

/**
 * S4 W4-S1: the weathering of a built surface at landmark-local `p` (km) with geometry normal `n` (see W /
 * WEATHERING_ON): xyz = the albedo multiplier (linear rgb), w = the weathering amount 0..1 (grime streak,
 * dust deposit or crevice grime — what turns the surface matte and dielectric; independent of the paint,
 * so a dusted near-black paint is not mistaken for a heavily weathered one). `n1` / `n2` are the pattern's
 * footprint-faded house-scale (≈ 0.11 km) and fine (≈ 0.03 km) octaves, `ao` the baked hemisphere AO,
 * `metal` / `rough0` the vertex metalness / roughness, `contact` the ground contact (1 = free). Every
 * hashed cell term is replaced by its mean where its cell would shrink below a few pixels, so wides keep
 * the crisp model read without a value shift. Pure function of the fragment (no time, no state); call in
 * uniform control flow (derivatives).
 */
function weathering(p: TslNode, n: TslNode, n1: TslNode, n2: TslNode, ao: TslNode, metal: TslNode, rough0: TslNode, albedo: TslNode, contact: TslNode, c: WeatherMasks): TslNode {
  // pixel footprint on the surface (km) and the visibility of a feature of `size` km (≥ b px: 1)
  const fp = max(length(fwidth(p)), 1e-6).toVar();
  // (fp = |fwidth(p)| ≈ 1.4–2 px of surface: by default a feature of `size` is fully drawn from ≈ 2.3 px,
  // gone below ≈ 1.1 px)
  const vis = (size: number, a = 0.8, b = 1.6): TslNode => smoothstep(a, b, float(size).div(fp));
  const ny = n.y;
  const ay = abs(ny);
  const wall = float(1).sub(smoothstep(0.35, 0.6, ay)).toVar();
  // up-facing slopes: roof planes, cone roofs and steep spires (flat tops excluded)
  const slope = smoothstep(0.06, 0.16, ny).mul(float(1).sub(smoothstep(0.97, 0.995, ny))).toVar();
  // horizontal coordinate along a face (the masonry coursing's convention)
  const along = select(abs(n.x).greaterThan(abs(n.z)), p.z, p.x).toVar();

  // ---- tone: house-scale value breakup + a district-scale value and warm / cool drift, and darker
  // district-scale grime stains (their mean kept where the district octave fades out)
  const wD = float(1).sub(smoothstep(0.35, 1, fp.mul(2.1))).toVar();
  const nD = mx_noise_float(p.mul(2.1).add(vec3(17.3, 3.1, 41.7))).mul(wD).toVar();
  let val: TslNode = float(1).add(n1.mul(W.tone)).add(nD.mul(W.district));
  const stain = mix(float(0.3), smoothstep(0.05, 0.45, nD.add(n1.mul(0.35))), wD).mul(W.stain);
  val = val.mul(float(1).sub(stain));
  const h = nD.mul(W.hue * 2);
  let tint: TslNode = vec3(float(1).add(h), float(1), float(1).sub(h));

  // ---- tonal masonry courses on stone walls: a value per course and per staggered block (cell edges
  // warped by the noise) and a darker joint line at the foot of each course (their mean kept where the
  // courses fade out)
  const cy = p.y.div(W.course).add(n2.mul(W.courseWarp));
  const crs = floor(cy);
  const blk = floor(along.div(W.block).add(crs.mul(0.5)).add(n1.mul(W.courseWarp * 1.5)));
  const bT = hash(crs.mul(131).add(blk.mul(17)).add(2100000)).sub(0.5);
  const rT = hash(crs.mul(53).add(2300000)).sub(0.5);
  const joint = float(1).sub(smoothstep(0.04, 0.16, fract(cy))).mul(W.joint);
  const courses = mix(float(-W.joint * 0.1), bT.add(rT).mul(W.courseTone).sub(joint), vis(W.course));
  val = val.add(courses.mul(wall).mul(c.isStone));

  // ---- rain / grime streaks on walls: hashed columns, each a long taper hanging from a hashed ledge
  // line (strongest just under it, a faint tail down the run), soft across the column; three widths,
  // each drawn only where its column spans ≥ ~4 px (finer ones aliased into plank-like stripes) and
  // replaced by its mean beyond
  let streak: TslNode = float(0);
  W.streakW.forEach((sw, k) => {
    const u = along.div(sw).add(0.37 * k);
    const colId = floor(u);
    const fu = fract(u);
    const h1 = hash(colId.mul(13).add(2500000 + 400000 * k));
    const h2 = hash(colId.mul(29).add(2700000 + 400000 * k));
    const amt = smoothstep(0.35, 0.95, h1);
    const len = h2.mul(W.streakLen[1] - W.streakLen[0]).add(W.streakLen[0]).mul(sw);
    const t = fract(p.y.div(len).add(h2.mul(5.3)));
    const prof = smoothstep(0, 0.5, fu).mul(float(1).sub(smoothstep(0.5, 1, fu)));
    const run = t.mul(t.sqrt()).mul(0.85).add(0.15).mul(float(1).sub(smoothstep(0.97, 1, t)));
    streak = max(streak, mix(float(W.streakMean), amt.mul(prof).mul(run), vis(sw, 1.8, 3.0)));
  });
  streak = streak.mul(wall).mul(float(1).sub(c.isWood.mul(1 - W.streakWood))).toVar();
  // grey-brown grime on stone, plaster and wood; rust on metals
  const grime = mix(vec3(0.42, 0.43, 0.45), vec3(0.7, 0.42, 0.25), smoothstep(0.2, 0.6, metal));
  tint = tint.mul(mix(vec3(1), grime, streak.mul(W.streakDark / 0.58)));

  // ---- crevice grime: the baked hemisphere AO (corners, under eaves and ledges, narrow lanes); not at
  // the foot of a part, which the contact term already darkens
  const crev = clamp(float(1).sub(ao).div(1 - AO_MIN), 0, 1).mul(contact).toVar();
  val = val.mul(float(1).sub(crev.mul(W.aoDirt)));

  // ---- roofs: courses (a shadowed lip under each course, a lit butt edge), slate jitter, dark eaves
  const ry = p.y.div(W.roofRow);
  const rRow = floor(ry);
  const rf = fract(ry);
  const lip = smoothstep(0.55, 1, rf).mul(W.roofLip).sub(float(1).sub(smoothstep(0, 0.12, rf)).mul(W.roofEdge));
  const tile = floor(along.div(W.roofRow * 1.7).add(rRow.mul(0.5)));
  const tj = hash(rRow.mul(31).add(tile.mul(7)).add(3100000)).sub(0.5).mul(W.roofJit);
  // the course pattern's mean, kept where the courses fade out (no value step with distance)
  const lipMean = W.roofLip * 0.225 - W.roofEdge * 0.06;
  const rows = mix(float(-lipMean), tj.sub(lip), vis(W.roofRow));
  // the dark eave line of a roof part: its soffits (down-facing) always, its fascias (vertical) only where
  // a fascia is resolved — far LOD roofs regenerate their gable ends as vertical roof faces
  const eave = max(float(1).sub(smoothstep(0.02, 0.08, ny)).mul(vis(0.012, 1.2, 2.4)), float(1).sub(smoothstep(-0.45, -0.2, ny)));
  const eaveK = mix(float(1), float(W.eave), eave);
  val = val.mul(mix(float(1), float(1).add(rows.mul(slope)).mul(eaveK), c.isRoof));

  // ---- thatch: courses with a shadow band and coarser bands that survive at hero distance, a per-roof
  // tone, dark eaves, grey weathered patches
  const tfr = fract(p.y.div(W.thatchRow));
  const tRows = mix(float(W.thatchBand * 0.2), smoothstep(0.6, 1, tfr).mul(W.thatchBand), vis(W.thatchRow));
  const tfr2 = fract(p.y.div(W.thatchRow2).add(n1.mul(0.3)));
  const tRows2 = mix(float(W.thatchBand2 * 0.3), smoothstep(0.45, 1, tfr2).mul(W.thatchBand2), vis(W.thatchRow2));
  const thatch = float(1).sub(tRows.add(tRows2).mul(slope)).add(n1.mul(W.thatchTone)).mul(eaveK);
  val = val.mul(mix(float(1), thatch, c.isFibre));
  const greyT = smoothstep(-0.15, 0.35, nD.sub(n1.mul(0.4))).mul(0.7);
  tint = tint.mul(mix(vec3(1), mix(vec3(1), vec3(0.8, 0.78, 0.76), greyT), c.isFibre));

  // ---- moss / lichen on roofs and thatch
  const moss = smoothstep(0.05, 0.45, nD.add(n1.mul(0.6)).add(n2.mul(0.25))).mul(W.moss).mul(slope).mul(c.isRoof.add(c.isFibre));
  tint = tint.mul(mix(vec3(1), vec3(0.68, 0.76, 0.5), moss));

  // ---- wood: boards (horizontal on walls, along z on decks) with dark seams and a tone per board
  // (staggered board ends), greyed timber in patches
  const deck = ay.greaterThan(0.7);
  const by = select(deck, p.x, p.y).div(W.board);
  const bRow = floor(by);
  const seam = float(1).sub(smoothstep(0, 0.16, fract(by))).mul(W.seam);
  const bId = floor(select(deck, p.z, along).div(W.boardLen).add(hash(bRow.mul(11).add(3500000)).mul(3)));
  const bj = hash(bRow.mul(37).add(bId.mul(5)).add(3700000)).sub(0.5).mul(W.boardJit);
  const boards = mix(float(-W.seam * 0.08), bj.sub(seam), vis(W.board));
  val = val.mul(mix(float(1), float(1).add(boards), c.isWood));
  const greyW = smoothstep(-0.25, 0.3, nD.add(n1.mul(0.5))).mul(0.8);
  tint = tint.mul(mix(vec3(1), mix(vec3(0.9), vec3(0.68, 0.67, 0.66), greyW), c.isWood));

  // ---- dark materials (iron-dark stone, iron): grime cannot darken a near-black paint, so their
  // weathering is a pale deposit instead — ash / dust / lime streaks, dust on ledges and up-facing faces,
  // dustier blocks and a dusty foot — replacing part of the paint (as a multiplier of it). Glossy paints
  // (obsidian, roughness < ≈ 0.3) stay clean: Orthanc keeps its polished black and its cool specular.
  const dark = float(1).sub(smoothstep(0.02, 0.12, lum(albedo)));
  const foot = float(1).sub(contact);
  const dustAmt = clamp(
    streak
      .mul(0.9)
      .add(smoothstep(0.6, 0.85, ny).mul(0.35))
      .add(max(bT, 0).mul(1.2).mul(vis(W.course)).mul(c.isStone))
      .add(foot.mul(foot).mul(0.5))
      .add(smoothstep(0.1, 0.45, nD.add(n1.mul(0.5))).mul(0.25)),
    0,
    1,
  )
    .mul(dark)
    .mul(smoothstep(0.25, 0.45, rough0))
    // fades out with the house-scale detail: wides and overviews keep the charcoal read of Mordor's towers
    .mul(vis(0.06, 0.6, 1.2))
    .toVar();
  const mul = mix(tint.mul(max(val, 0.2)), vec3(W.dustColor[0], W.dustColor[1], W.dustColor[2]).div(max(albedo, vec3(0.004))), dustAmt.mul(W.dust));
  // the amount: the strongest of streak grime, dust and crevice grime (each 0..1)
  const amount = clamp(max(max(streak, dustAmt), crev.mul(0.5)), 0, 1);
  return vec4(mix(vec3(1), mul, c.built), amount.mul(c.built));
}

function structureMaterial(): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0 });
  const weatherOn = WEATHERING_ON && structureTier.full;
  const col = attribute('color', 'vec4');
  const surf = attribute('surf', 'vec4');
  // surf.a = noise class × 32 + ground contact (0..31)
  const sa = surf.a.mul(255).add(0.5);
  const cls = floor(sa.div(32));
  const contact = clamp(sa.sub(cls.mul(32)).sub(0.5).div(CONTACT_LEVELS), 0, 1);
  const isClass = (c: number) => step(c - 0.5, cls).mul(float(1).sub(step(c + 0.5, cls)));
  const isStone = isClass(NOISE.stone);
  const isWood = isClass(NOISE.wood);
  const isFibre = isClass(NOISE.fibre);
  const isSmooth = isClass(NOISE.smooth);
  const isFoliage = isClass(NOISE.foliage);
  // S4: rock (kit cliffs — class 5, emitted by ProxyKit.cliff; see the strata helper below)
  const isRock = isClass(ROCK_CLASS);
  // S4 W4-S1: roof (slate / tile / shingle faces; FAMILY slate & roofTile, ProxyKit.tagRoof)
  const isRoof = isClass(NOISE.roof);
  // built surfaces take the weathering (foliage and rock keep their own looks)
  const built = float(1).sub(isFoliage).sub(isRock);
  const nG = normalGeometry;
  const albedo = sRGBTransferEOTF(col.rgb);
  // landmark-local km (the meshes sit at the landmark origin): small arguments, so the fine octave never
  // bands on float32 world coordinates of several hundred km
  const p = positionLocal;
  // anisotropy by class: wood = vertical streaks (planks), fibre = finer streaks (thatch)
  const ayK = float(1).sub(isWood.mul(0.88)).sub(isFibre.mul(0.7));
  const axz = float(1).add(isWood.mul(0.6)).add(isFibre.mul(1.2));
  const q = vec3(p.x.mul(axz), p.y.mul(ayK), p.z.mul(axz));
  // octaves ~9, 37, 140 per km, each faded out where it would shimmer (texel footprint)
  const fw = length(fwidth(q)).toVar();
  const w1 = float(1).sub(smoothstep(0.35, 1, fw.mul(9))).toVar();
  const w2 = float(1).sub(smoothstep(0.35, 1, fw.mul(37))).toVar();
  const w3 = float(1).sub(smoothstep(0.35, 1, fw.mul(140)));
  const n1 = mx_noise_float(q.mul(9)).toVar();
  const n2 = mx_noise_float(q.mul(37)).toVar();
  const n = n1.mul(w1.mul(0.5)).add(n2.mul(w2.mul(0.3))).add(mx_noise_float(q.mul(140)).mul(w3.mul(0.2)));
  // stone: masonry coursing on walls — 0.02 km courses of 0.055 km blocks (staggered), a small value
  // jitter per block, faded where a course gets thinner than ~2 px
  const cy = p.y.div(0.02);
  const course = floor(cy);
  const along = select(abs(nG.x).greaterThan(abs(nG.z)), p.z, p.x);
  const block = floor(along.div(0.055).add(course.mul(0.5)));
  const jit = hash(course.mul(97).add(block.mul(7)).add(500000)).sub(0.5);
  const cw = float(1).sub(smoothstep(0.3, 0.8, fwidth(cy))).mul(float(1).sub(abs(nG.y)));
  const coursing = jit.mul(cw).mul(isStone).mul(0.6);
  // foliage: leaf clumps — the two coarse octaves, stronger
  const leaf = n1.mul(w1.mul(0.7)).add(n2.mul(w2.mul(0.45)));
  // rock: the stone noise without masonry coursing, banded on its sheer faces by the terrain's own strata
  // (world-space bedding, so a kit cliff and the terrain face beside it band alike). A branch on the class:
  // no other surface pays for it. The pattern scales the albedo by grain, so the strata's luminance enters
  // divided by it.
  const rockBands = KIT_STRATA
    ? Fn(() => {
        const rb = float(0).toVar();
        // Everything shared with the rest of the shader is built HERE, in uniform control flow, before the
        // branch: the bedding footprint (a derivative) and the world normal. Built lazily inside the branch,
        // the normal's shared var (normalView → the lighting normal) was only assigned on fragments taking
        // it, and every other structure surface lit black (the W1-B 'kit strata' darkening bug).
        const fy = strataFootprint(positionWorld).toVar();
        const nw = normalWorld.toVar();
        If(isRock.greaterThan(0.5), () => {
          const pw = positionWorld;
          const n3k = mx_noise_float(pw.mul(1 / 3));
          const warp = mx_noise_float(pw.xz.mul(1 / 60)).mul(2.2).add(n3k.mul(0.35));
          const st = strata(pw, nw, warp, n3k.mul(0.8), { fy, contrast: KIT_STRATA_CONTRAST, scale: KIT_STRATA_SCALE });
          const sw = strataSteep(nw, 0.45, 0.75);
          rb.assign(st.lum.sub(1).mul(sw).div(max(surf.b, 0.1)));
        });
        return rb;
      })()
    : float(0);
  // the albedo pattern (× grain)
  const pattern = mix(n.mul(float(1).sub(isSmooth.mul(0.75))).add(coursing).add(rockBands), leaf, isFoliage).toVar();
  // S4 W4-S1: xyz = the weathering multiplier (rgb) of built surfaces, w = the weathering amount
  const weather = weatherOn
    ? weathering(p, nG, n1.mul(w1), n2.mul(w2), col.a, surf.g, surf.r, albedo, contact, { isStone, isWood, isFibre, isRoof, built }).toVar()
    : vec4(1, 1, 1, 0);
  // leaf masses: sun-bleached tops, shaded undersides (like the canopy shader's sub-crown shading)
  const leafTone = mix(float(1), mix(float(0.78), float(1.12), smoothstep(-0.6, 0.9, nG.y)), isFoliage);
  // the baked ground-contact term is the main baked darkening on the albedo; the hemisphere AO (col.a)
  // goes to the AO slot (indirect light) and, on built surfaces, only as a mild crevice grime inside the
  // weathering (S3 fix: small parts went near-black when both applied in full). S4 W4-S1: built classes
  // take a stronger contact (soot / damp at the foot of every part) with a damp tint; the weathering's
  // total darkening relative to the S3 albedo (weathering × damp × the stronger contact) is floored at
  // W.floor, so shadowed crevices and door recesses are not crushed to black.
  const contactS3 = mix(float(1), contact, CONTACT_WEIGHT);
  let rel: TslNode = vec3(1);
  if (weatherOn) {
    const contactW = mix(float(CONTACT_WEIGHT), float(W.contact), built);
    const foot = float(1).sub(contact);
    const damp = mix(vec3(1), vec3(0.9, 0.93, 0.85), foot.mul(foot).mul(built).mul(0.8));
    const r0 = weather.xyz.mul(damp).mul(mix(float(1), contact, contactW).div(contactS3));
    rel = r0.mul(max(float(1), float(W.floor).div(max(lum(r0), 1e-3))));
  }
  const baseColor = albedo
    .mul(float(1).add(pattern.mul(surf.b)))
    .mul(leafTone)
    .mul(contactS3)
    .mul(rel)
    .toVar();
  m.colorNode = baseColor;
  m.aoNode = col.a;
  // S4 W4-S1: weathered patches (grime, dust) are matte — the sheen of dark stone and iron breaks up with
  // them instead of reading as one clean panel — and grimy / dusty metal is partly dielectric. Driven by
  // the weathering AMOUNT (never by how far the albedo multiplier moves, which on near-black paints is
  // ≈ dust / albedo); glossy paints (obsidian) keep their gloss.
  const weatherRough = weatherOn ? weather.w.mul(0.35).mul(smoothstep(0.2, 0.45, surf.r)) : float(0);
  const rough = clamp(surf.r.add(pattern.mul(0.08)).add(weatherRough), 0.04, 1);
  const metal = weatherOn ? surf.g.mul(float(1).sub(weatherRough.mul(2))) : surf.g;
  m.roughnessNode = rough;
  m.metalnessNode = metal;
  // specular ambient: the scene has no environment map, so metals (iron, gold, metal) and glossy dark
  // stone reflected nothing and went black in shade. Approximate image-based specular with the
  // hemisphere light's own sky / ground radiance along the reflection vector, Fresnel-weighted
  // (F0 = 0.04 for stone, the albedo for metals), dimmed by roughness and the baked AO
  m.emissiveNode = Fn(() => {
    const v = normalize(cameraPosition.sub(positionWorld));
    const r = reflect(v.negate(), normalWorld);
    const sky = mix(vec3(env.groundColor), vec3(env.skyColor), smoothstep(-0.25, 0.55, r.y)).mul(env.hemiIntensity);
    // (S4 W4-S1: F0 from the weathered paint, roughness and metalness weathered too — metals such as the
    // Morannon's iron are lit mostly by this term, so their weathering has to show here)
    const f0 = weatherOn ? mix(vec3(0.04), baseColor, metal) : mix(vec3(0.04), albedo, surf.g);
    const specAmb = sky.mul(f0).mul(float(1).sub((weatherOn ? rough : surf.r).mul(0.45))).mul(col.a);
    // S4 W2-D: the light the emission spill throws onto the structure (Lambertian: diffuse albedo · E / π;
    // half the baked AO — the spill is local direct light, the AO only hints at the occluded corners)
    const diffuse = baseColor.mul(float(1).sub(metal)).mul(mix(float(0.5), float(1), col.a));
    return specAmb.add(diffuse.mul(spillIrradiance(positionWorld, normalWorld)).mul(1 / Math.PI));
  })();
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
    // a hotter core where the surface faces the viewer (fire, lava, the Eye), the paint at the rim: the
    // weaker channels rise towards the strongest one, green most (red fire → orange → yellow)
    const ndv = clamp(dot(normalView, positionViewDirection), 0, 1);
    const peak = max(paint.r, max(paint.g, paint.b));
    const hot = paint.add(vec3(peak).sub(paint).mul(vec3(0.2, 0.6, 0.1)));
    const c = mix(paint, hot, ndv.mul(ndv).mul(0.6)).mul(ndv.mul(0.4).add(0.8));
    const glow = c.mul(surf.r.mul(GLOW_MAX)).mul(glowGate(surf.g)).mul(max(f, 0.2));
    // S4 W2-D: a skin that stands for lit stone (the Morgul wash bands cover most of each washed face;
    // GlowPreset.spill, surf.a) takes the emission spill like the stone under it, so the spill's falloff
    // shows through the skin; self-luminous skins (surf.a = 0: lava, windows, ithildin) are not lit by
    // their own lights
    return glow.add(spillIrradiance(positionWorld, normalWorld).mul(surf.a.mul(1 / Math.PI)));
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
