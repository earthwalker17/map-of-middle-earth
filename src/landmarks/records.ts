import type { BufferGeometry } from 'three/webgpu';
import type { LandmarkDefinition } from './types.ts';

/**
 * World-space records produced by ONE pure landmark build run (build.ts → buildLandmarks) and realized
 * by the shared systems: geometry → LandmarkSystem, lights → EmissionSystem, trees → VegetationSystem,
 * pools → WaterSystem. The build runs once at boot (before vegetation init) and again in Node for the
 * CPU checks / camera probe (geometry: false). Contract frozen at the start of S3 (W0a).
 */

export type V2 = [number, number];
export type V3 = [number, number, number];

/** What a light is: drives colour defaults, flicker and wide-shot behaviour in EmissionSystem. */
export type LightKind = 'window' | 'lamp' | 'fire' | 'lava' | 'eye' | 'beacon' | 'magic' | 'ithildin';

/**
 * When a light is on — a pure function of the env uniforms (sun elevation → night / twilight / golden):
 *  - night:  windows, lamps, ithildin — ramp in through twilight
 *  - dusk:   fires — on from golden hour, dim by day
 *  - always: lava, the Eye, Morgul magic
 *  - event:  switched by the tour timeline (S4 beacons, signals) — off in S3
 */
export type LightGate = 'night' | 'dusk' | 'always' | 'event';

export const DEFAULT_GATE: Record<LightKind, LightGate> = {
  window: 'night',
  lamp: 'night',
  fire: 'dusk',
  lava: 'always',
  eye: 'always',
  beacon: 'event',
  magic: 'always',
  ithildin: 'night',
};

/**
 * Optional light fields added in S4 (W0 contract), shared by LightDecl, the kit's LightOpts / KitLight
 * and LightRecord:
 *  - `event`: the SceneState.events channel that switches a light with gate 'event' (e.g. 'beacons',
 *    'morgul-beam'); the light is on by the channel's 0..1 value
 *  - `spillKm`: reach of the light's surface irradiance ("emission lights its surroundings"); default
 *    by kind in the emission system, 0 = no spill
 *  - `sprite`: false = spill-only light (no emission sprite), e.g. the Morgul wall-wash sources
 */
export interface LightExtras {
  event?: string;
  spillKm?: number;
  sprite?: boolean;
}

/** Copy only the defined LightExtras fields (records without extras stay identical to S3's). */
export function lightExtras(o: LightExtras): LightExtras {
  const out: LightExtras = {};
  if (o.event !== undefined) out.event = o.event;
  if (o.spillKm !== undefined) out.spillKm = o.spillKm;
  if (o.sprite !== undefined) out.sprite = o.sprite;
  return out;
}

/** One point light in WORLD space (EmissionSystem draws all of them in one instanced pass). */
export interface LightRecord extends LightExtras {
  landmark: string;
  p: V3;
  /** linear RGB, 0..1 */
  color: V3;
  /** relative brightness (EmissionSystem maps it to HDR luminance) */
  intensity: number;
  /** physical radius, km (the sprite never shrinks below ~0.6 px) */
  radiusKm: number;
  kind: LightKind;
  gate: LightGate;
  /** 0..1 flicker depth (deterministic, env.tFx driven) */
  flicker: number;
  /** stable per-light seed for rand(seed, …): lit fraction, flicker phase */
  seed: number;
}

/** Particle / volume / ribbon emitter presets realized by the EffectsSystem (S4). */
export type EmitterPreset = 'smoke' | 'ash' | 'embers' | 'steam' | 'mist' | 'sparks' | 'beam';

/** One effect emitter in WORLD space (landmark `emitters`, resolved by landmarks/world.ts). */
export interface EmitterRecord {
  landmark: string;
  preset: EmitterPreset;
  /** world position of the source */
  p: V3;
  /** world end point (beam: the far end; others: optional drift target) */
  to?: V3;
  /** relative emission rate (default 1) */
  rate: number;
  /** size multiplier (default 1; world km already include the landmark design scale) */
  scale: number;
  /** linear RGB tint (default by preset) */
  color?: V3;
  /** SceneState.events channel that switches it (absent = always on) */
  event?: string;
  seed: number;
}

/** One waterfall / flood ribbon in WORLD space (landmark `waterFeatures` of kind waterfall | flood). */
export interface FallRecord {
  landmark: string;
  kind: 'waterfall' | 'flood';
  /** world polyline from the lip down to the plunge point */
  path: V3[];
  /** width, km (design scale applied) */
  width: number;
  seed: number;
}

/** A world-space tree-height cap circle (landmark `treeCaps`): trees inside are no taller than maxHeightKm. */
export interface TreeCapRecord {
  landmark: string;
  x: number;
  z: number;
  r: number;
  maxHeightKm: number;
}

export type TreeKind = 'mallorn' | 'oak' | 'party' | 'holly' | 'autumn' | 'conifer' | 'poplar' | 'willow' | 'scrub';

/** One authored hero tree in WORLD space (VegetationSystem draws it as a canopy cluster). */
export interface AuthoredTree {
  landmark: string;
  x: number;
  z: number;
  kind: TreeKind;
  /** crown radius, km */
  crownKm: number;
  /** total height ground → crown top, km (default: the kind's recipe) */
  heightKm?: number;
  /** crown colour, sRGB hex (default: the kind's recipe) */
  color?: number;
  /** radians */
  yaw: number;
  /** stable id: hash32(hashString(landmark), index) */
  id: number;
}

/**
 * A forest area — local km in a landmark definition (`ForestDecl.area`), world km in a `ForestRecord`.
 * circle · annulus (a ring around a summit: forested flanks, bald crown) · polygon (closed ring) · band
 * (a strip of `halfWidth` either side of a polyline: valley floors, ledges, rims).
 */
export type ForestArea =
  | { circle: { at: V2; r: number } }
  | { annulus: { at: V2; r0: number; r1: number } }
  | { polygon: V2[] }
  | { band: { path: V2[]; halfWidth: number } };

/** One species of a landmark forest. */
export interface ForestSpecies {
  kind: TreeKind;
  /** relative share of the stand */
  share: number;
  /** crown radius range, km */
  crownKm: [number, number];
  /** total height as a multiple of the crown radius (default: the kind's recipe) */
  heightFactor?: [number, number];
  /** sRGB hex palette (default: the kind's recipe) */
  colors?: number[];
}

/**
 * A landmark forest in WORLD space: VegetationSystem places it like the natural forests (chunked,
 * LOD-capped, thinned with the quality density), deterministic per (seed, cell).
 */
export interface ForestRecord {
  landmark: string;
  area: ForestArea;
  /** trees per km² at quality density 1 */
  density: number;
  species: ForestSpecies[];
  clump?: { scaleKm: number; amount: number };
  edgeKm: number;
  maxSlopeDeg: number;
  /** clearings (world km) */
  avoid: { at: V2; r: number }[];
  /** lowest ground (world height) that carries trees */
  minY: number;
  seed: number;
}

export interface ExclusionCircle {
  x: number;
  z: number;
  r: number;
}

/** A small still-water pool (the Sirannon at Moria, the Water at Hobbiton…) in WORLD space. */
export interface PoolRecord {
  landmark: string;
  /** closed ring, world XZ */
  ring: V2[];
  /** water surface height, world units */
  level: number;
}

/** An upright reflection proxy for the water's reflection march, WORLD space: a vertical cylinder. */
export interface ReflectorRecord {
  landmark: string;
  x: number;
  z: number;
  r: number;
  /** world heights of its foot and top */
  y0: number;
  y1: number;
}

/** Where a seated part meets the ground (seating gate: nothing floats, nothing sinks too deep). */
export interface ContactRecord {
  x: number;
  z: number;
  /** world height of the part's base */
  baseY: number;
  /** world ground height under it */
  groundY: number;
  /** part height, km */
  h: number;
}

/**
 * One LOD: one merged geometry per material key. Keys are resolved to shared materials by
 * `materialFor(key)` in src/materials/families.ts (material families only — never per-landmark
 * materials).
 */
export type LodGeometry = Map<string, BufferGeometry>;

export interface BuiltLandmark {
  id: string;
  def: LandmarkDefinition;
  /** world position of local (0, 0, 0): the display position, ground- or water-anchored */
  origin: V3;
  headingDeg: number;
  /** fixed design scale (never distance dependent) */
  scale: number;
  /** LOD0 (finest) … LODn (silhouette); empty when built with `geometry: false` */
  lods: LodGeometry[];
  /** projected bounding radius thresholds in px at viewport height: [LOD0 ≥, LOD1 ≥] */
  lodPx: [number, number];
  lights: LightRecord[];
  trees: AuthoredTree[];
  /** woods placed by the vegetation system (masses of trees; `trees` are the individuals) */
  forests: ForestRecord[];
  /** world-space bounds: centre, horizontal radius (km), height above the origin (km) */
  bounds: { center: V3; r: number; h: number };
  contacts: ContactRecord[];
  /** triangles per LOD, geometry bytes, build time (diagnostics only — never drives rendering) */
  stats: { tris: number[]; bytes: number; buildMs: number };
}
