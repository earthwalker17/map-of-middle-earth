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

/** One point light in WORLD space (EmissionSystem draws all of them in one instanced pass). */
export interface LightRecord {
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
  /** world-space bounds: centre, horizontal radius (km), height above the origin (km) */
  bounds: { center: V3; r: number; h: number };
  contacts: ContactRecord[];
  /** triangles per LOD, geometry bytes, build time (diagnostics only — never drives rendering) */
  stats: { tris: number[]; bytes: number; buildMs: number };
}
