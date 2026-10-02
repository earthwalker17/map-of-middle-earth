import { MeshStandardNodeMaterial, type Material } from 'three/webgpu';
import type { LightGate } from '../landmarks/records.ts';
import { tsl, type TslNode } from './tsl.ts';
import { env } from './environment.ts';
import { strata, strataFootprint, strataSteep } from './strata.ts';
import { gateCode, gateNode } from './gates.ts';
import { spillIrradiance } from '../emission/spill.ts';

// NB: TSL vec3(new Color()) silently yields black in r186 — always use color(Color) for colour constants
const { Fn, If, float, vec3, vec4, attribute, fract, mx_noise_float, positionWorld, positionLocal, normalGeometry, normalView, normalWorld, cameraPosition, reflect, normalize, positionViewDirection, fwidth, length, smoothstep, mix, clamp, max, abs, sin, step, floor, select, hash, dot, sRGBTransferEOTF } = tsl;

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
 *                  streak · 2 fibre / thatch · 3 smooth · 4 foliage (leaf clumps). The contact term is the
 *                  ONLY baked darkening applied to the albedo (× mix(1, contact, 0.3) at the foot of a part).
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
 */
export const NOISE = { stone: 0, wood: 1, fibre: 2, smooth: 3, foliage: 4, rock: 5, roof: 6 } as const;
export type NoiseClass = (typeof NOISE)[keyof typeof NOISE];

/**
 * S4 W4-S1 weathering of built surfaces (every class but foliage and rock), all in landmark-local km and
 * faded by the pixel footprint, so wides keep the crisp model read and never shimmer:
 *  - tone: the house-scale noise octave (≈ 0.11 km) as a per-part value breakup, plus a district-scale
 *    (≈ 0.5 km) value / warm–cool drift — neighbouring houses and wall runs never share one flat paint;
 *  - tonal courses on stone: large masonry courses and staggered blocks with a hashed value each;
 *  - rain / grime streaks on walls: hashed columns at two widths, each streak hanging from a hashed
 *    "ledge" line and fading downward (rust-tinted on metals);
 *  - crevice grime from the baked hemisphere AO (corners, under eaves and ledges, narrow lanes) and a
 *    stronger, damp-tinted ground-contact term at the foot of every part (soot / damp rising);
 *  - roofs (class roof): courses with a shadowed lip under each course, slate jitter, darker eaves
 *    (fascia / soffit), moss; thatch (fibre) courses and grey weathering; wood: boards with dark seams,
 *    per-board tone, greyed timber in patches.
 * Toggle with WEATHERING_ON (false = the S3 surfaces).
 */
export const WEATHERING_ON = true;
const W = {
  /** per-part value amplitude of the house-scale octave */
  tone: 0.12,
  /** district-scale value drift and its warm / cool hue shift */
  district: 0.09,
  hue: 0.05,
  /** tonal masonry courses (stone): course height, block length (km), value amplitude */
  course: 0.07,
  block: 0.19,
  courseTone: 0.15,
  /** darkening of the joint line at the foot of each course */
  joint: 0.16,
  /** grime / rain streak column widths (km) and their darkening */
  streakW: [0.09, 0.032, 0.012] as const,
  streakDark: 0.5,
  /** crevice grime from the baked AO (darkening at the AO floor) */
  aoDirt: 0.2,
  /** ground-contact weight of built classes (CONTACT_WEIGHT stays for foliage / rock) */
  contact: 0.5,
  /** roof courses (km), lip shadow, highlight of the butt edge, slate jitter, eave darkening, moss */
  roofRow: 0.014,
  roofLip: 0.34,
  roofEdge: 0.08,
  roofJit: 0.2,
  eave: 0.55,
  moss: 0.55,
  /** thatch courses (km) and their shadow band */
  thatchRow: 0.022,
  thatchBand: 0.24,
  /** wood boards (km): width, length, per-board jitter, seam darkening */
  board: 0.011,
  boardLen: 0.075,
  boardJit: 0.18,
  seam: 0.35,
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
/** Weight of the baked ground-contact term on the albedo: albedo × mix(1, contact, CONTACT_WEIGHT). */
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

/**
 * S4 W4-S1: the weathering multiplier (linear rgb) of a built surface at landmark-local `p` (km) with
 * geometry normal `n` (see W / WEATHERING_ON). `n1` / `n2` are the pattern's footprint-faded house-scale
 * (≈ 0.11 km) and fine (≈ 0.03 km) octaves, `ao` the baked hemisphere AO, `metal` the metalness. Every
 * hashed cell term fades out where its cell would shrink below ~2–3 px, so wides keep the crisp model
 * read. Pure function of the fragment (no time, no state); call in uniform control flow (derivatives).
 */
function weathering(p: TslNode, n: TslNode, n1: TslNode, n2: TslNode, ao: TslNode, metal: TslNode, c: WeatherMasks): TslNode {
  // pixel footprint on the surface (km) and the visibility of a feature of `size` km (≥ b px: 1)
  const fp = max(length(fwidth(p)), 1e-6).toVar();
  // (fp = |fwidth(p)| ≈ 1.4–2 px of surface: a feature of `size` is fully drawn from ≈ 2.3 px, gone below ≈ 1.1 px)
  const vis = (size: number, a = 0.8, b = 1.6): TslNode => smoothstep(a, b, float(size).div(fp));
  const ny = n.y;
  const ay = abs(ny);
  const wall = float(1).sub(smoothstep(0.35, 0.6, ay)).toVar();
  // up-facing slopes: roof planes and cone roofs (flat tops excluded)
  const slope = smoothstep(0.15, 0.3, ny).mul(float(1).sub(smoothstep(0.97, 0.995, ny))).toVar();
  // horizontal coordinate along a face (the masonry coursing's convention)
  const along = select(abs(n.x).greaterThan(abs(n.z)), p.z, p.x).toVar();

  // ---- tone: house-scale value breakup + a district-scale value and warm / cool drift
  const wD = float(1).sub(smoothstep(0.35, 1, fp.mul(2.1)));
  const nD = mx_noise_float(p.mul(2.1).add(vec3(17.3, 3.1, 41.7))).mul(wD).toVar();
  let val: TslNode = float(1).add(n1.mul(W.tone)).add(nD.mul(W.district));
  const h = nD.mul(W.hue * 2);
  let tint: TslNode = vec3(float(1).add(h), float(1), float(1).sub(h));

  // ---- tonal masonry courses on stone walls: a value per course and per staggered block
  // and a darker joint line at the foot of each course (its mean kept where the courses fade out)
  const cy = p.y.div(W.course);
  const crs = floor(cy);
  const blk = floor(along.div(W.block).add(crs.mul(0.5)));
  const bT = hash(crs.mul(131).add(blk.mul(17)).add(2100000)).sub(0.5);
  const rT = hash(crs.mul(53).add(2300000)).sub(0.5);
  const joint = float(1).sub(smoothstep(0.04, 0.16, fract(cy))).mul(W.joint);
  const courses = mix(float(-W.joint * 0.1), bT.mul(0.65).add(rT.mul(0.35)).mul(W.courseTone * 2).sub(joint), vis(W.course));
  val = val.add(courses.mul(wall).mul(c.isStone));

  // ---- rain / grime streaks on walls: hashed columns, each streak hanging from a hashed ledge line
  // and fading downward (strongest just under the ledge), two widths
  let streak: TslNode = float(0);
  W.streakW.forEach((sw, k) => {
    const u = along.div(sw).add(0.37 * k);
    const colId = floor(u);
    const fu = fract(u);
    const h1 = hash(colId.mul(13).add(2500000 + 400000 * k));
    const h2 = hash(colId.mul(29).add(2700000 + 400000 * k));
    const amt = smoothstep(0.35, 0.95, h1);
    const len = h2.mul(10).add(4).mul(sw);
    const t = fract(p.y.div(len).add(h2.mul(5.3)));
    // a flat-topped profile across the column (soft edges), a faint tail down the whole run
    const prof = smoothstep(0, 0.3, fu).mul(smoothstep(1, 0.7, fu));
    streak = max(streak, amt.mul(prof).mul(t.mul(t.sqrt()).mul(0.7).add(0.3)).mul(vis(sw, 0.7, 1.4)));
  });
  streak = streak.mul(wall);
  // grey-brown grime on stone, plaster and wood; rust on metals
  const grime = mix(vec3(0.42, 0.43, 0.45), vec3(0.7, 0.42, 0.25), smoothstep(0.2, 0.6, metal));
  tint = tint.mul(mix(vec3(1), grime, streak.mul(W.streakDark / 0.58)));

  // ---- crevice grime: the baked hemisphere AO (corners, under eaves and ledges, narrow lanes)
  val = val.mul(float(1).sub(clamp(float(1).sub(ao).div(1 - AO_MIN), 0, 1).mul(W.aoDirt)));

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
  // the fascia / soffit faces of a roof part (vertical or down-facing): the dark eave line
  const eave = float(1).sub(smoothstep(0.08, 0.2, ny));
  const roofVal = float(1).add(rows.mul(slope)).mul(mix(float(1), float(W.eave), eave));
  val = val.mul(mix(float(1), roofVal, c.isRoof));

  // ---- thatch: courses with a shadow band, grey weathered patches
  const tfr = fract(p.y.div(W.thatchRow));
  const tRows = mix(float(W.thatchBand * 0.2), smoothstep(0.6, 1, tfr).mul(W.thatchBand), vis(W.thatchRow));
  val = val.mul(mix(float(1), float(1).sub(tRows.mul(slope)), c.isFibre));
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

  return mix(vec3(1), tint.mul(max(val, 0.2)), c.built);
}

function structureMaterial(): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0 });
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
  // xyz = the weathering multiplier (rgb) of built surfaces, w = the albedo pattern (× grain)
  const surface = Fn(() => {
    // landmark-local km (the meshes sit at the landmark origin): small arguments, so the fine octave
    // never bands on float32 world coordinates of several hundred km
    const p = positionLocal;
    // anisotropy by class: wood = vertical streaks (planks), fibre = finer streaks (thatch)
    const ay = float(1).sub(isWood.mul(0.88)).sub(isFibre.mul(0.7));
    const axz = float(1).add(isWood.mul(0.6)).add(isFibre.mul(1.2));
    const q = vec3(p.x.mul(axz), p.y.mul(ay), p.z.mul(axz));
    // octaves ~9, 37, 140 per km, each faded out where it would shimmer (texel footprint)
    const fw = length(fwidth(q));
    const w1 = float(1).sub(smoothstep(0.35, 1, fw.mul(9))).toVar();
    const w2 = float(1).sub(smoothstep(0.35, 1, fw.mul(37)));
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
    // rock: the stone noise without masonry coursing, banded on its sheer faces by the terrain's own
    // strata (world-space bedding, so a kit cliff and the terrain face beside it band alike). A branch on
    // the class: no other surface pays for it. The pattern scales the albedo by grain, so the strata's
    // luminance enters divided by it.
    const rockBands = float(0).toVar();
    if (KIT_STRATA) {
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
        rockBands.assign(st.lum.sub(1).mul(sw).div(max(surf.b, 0.1)));
      });
    }
    const pattern = mix(n.mul(float(1).sub(isSmooth.mul(0.75))).add(coursing).add(rockBands), leaf, isFoliage);
    const weather = WEATHERING_ON ? weathering(p, nG, n1.mul(w1), n2.mul(w2), col.a, surf.g, { isStone, isWood, isFibre, isRoof, built }) : vec3(1);
    return vec4(weather, pattern);
  })().toVar();
  const pattern = surface.w;
  const weather = surface.xyz;
  const albedo = sRGBTransferEOTF(col.rgb);
  // leaf masses: sun-bleached tops, shaded undersides (like the canopy shader's sub-crown shading)
  const leafTone = mix(float(1), mix(float(0.78), float(1.12), smoothstep(-0.6, 0.9, nG.y)), isFoliage);
  // the baked ground-contact term is the main baked darkening on the albedo; the hemisphere AO (col.a)
  // goes to the AO slot (indirect light) and, on built surfaces, only as a mild crevice grime inside the
  // weathering (S3 fix: small parts went near-black when both applied in full). S4 W4-S1: built classes
  // take a stronger contact (soot / damp at the foot of every part) with a damp tint.
  const contactW = WEATHERING_ON ? mix(float(CONTACT_WEIGHT), float(W.contact), built) : float(CONTACT_WEIGHT);
  const foot = float(1).sub(contact);
  const damp = WEATHERING_ON ? mix(vec3(1), vec3(0.9, 0.93, 0.85), foot.mul(foot).mul(built).mul(0.8)) : vec3(1);
  const baseColor = albedo
    .mul(float(1).add(pattern.mul(surf.b)))
    .mul(leafTone)
    .mul(mix(float(1), contact, contactW))
    .mul(damp)
    .mul(weather);
  m.colorNode = baseColor;
  m.aoNode = col.a;
  m.roughnessNode = clamp(surf.r.add(pattern.mul(0.08)), 0.04, 1);
  m.metalnessNode = surf.g;
  // specular ambient: the scene has no environment map, so metals (iron, gold, metal) and glossy dark
  // stone reflected nothing and went black in shade. Approximate image-based specular with the
  // hemisphere light's own sky / ground radiance along the reflection vector, Fresnel-weighted
  // (F0 = 0.04 for stone, the albedo for metals), dimmed by roughness and the baked AO
  m.emissiveNode = Fn(() => {
    const v = normalize(cameraPosition.sub(positionWorld));
    const r = reflect(v.negate(), normalWorld);
    const sky = mix(vec3(env.groundColor), vec3(env.skyColor), smoothstep(-0.25, 0.55, r.y)).mul(env.hemiIntensity);
    const f0 = mix(vec3(0.04), albedo, surf.g);
    const specAmb = sky.mul(f0).mul(float(1).sub(surf.r.mul(0.45))).mul(col.a);
    // S4 W2-D: the light the emission spill throws onto the structure (Lambertian: diffuse albedo · E / π;
    // half the baked AO — the spill is local direct light, the AO only hints at the occluded corners)
    const diffuse = baseColor.mul(float(1).sub(surf.g)).mul(mix(float(0.5), float(1), col.a));
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
