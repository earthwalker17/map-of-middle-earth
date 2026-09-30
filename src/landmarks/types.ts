import type { OrbitSpec } from '../camera/shots.ts';
import type { WeatherState } from '../core/types.ts';
import type { Stamp } from '../world/stamps.ts';
import type { ProxyKit } from './kit/ProxyKit.ts';
import type { LightGate, LightKind, TreeKind, V2, V3 } from './records.ts';

export type { LightGate, LightKind, TreeKind, V2, V3 } from './records.ts';

/**
 * A landmark is a declarative bundle. One pure build run (build.ts) turns it into world-space records
 * that the shared systems realize:
 *  - stamps → HeightField stamp layer (world.ts; before any system samples heights)
 *  - proxy (TS kit) / model (Blender GLB) → LandmarkSystem meshes, projected-px LODs (shared families)
 *  - lights (+ kit windows/lamps) → EmissionSystem (one instanced draw, night/dusk/always gates)
 *  - trees (+ kit trees) → VegetationSystem hero clusters · pools → WaterSystem
 *  - emitters / waterfalls → EffectsSystem (S4) · annotation / bookmarks → tour, explorer, QA
 * Landmarks never create materials, particle systems or render loops of their own.
 *
 * Local coordinates (frame.ts): km relative to the place's DISPLAY position, x east, z south (world
 * axes), rotated by headingDeg (clockwise from north: the landmark's local −Z faces `headingDeg`).
 * Local y = 0 is the ground height at the origin (after stamps), or the water surface for
 * `anchor: 'water'`.
 *
 * Readability policy (S3): a landmark has ONE fixed design scale. It reads in wide shots through its
 * terrain silhouette (stamps), value contrast against the region ground, and emission — never by
 * growing with camera distance.
 */
export type LocalStamp = Stamp;

export interface LightDecl {
  /** local km (x, y above the origin, z) */
  at: V3;
  /** sRGB hex */
  color: number;
  intensity: number;
  /** physical radius, km */
  radius: number;
  kind?: LightKind;
  /** default by kind (records.ts DEFAULT_GATE) */
  gate?: LightGate;
  /** 0..1 */
  flicker?: number;
}

/** Particle/volume emitters, realized by the EffectsSystem (S4). */
export interface EmitterDecl {
  preset: 'smoke' | 'ash' | 'embers' | 'steam' | 'mist' | 'sparks';
  at: V3;
  rate?: number;
  scale?: number;
}

export type WaterFeatureDecl =
  /** still pool (S3, WaterSystem): local XZ ring; `level` = water surface in local y */
  | { kind: 'pool'; ring: V2[]; level: number }
  /** falls / floods: EffectsSystem + WaterSystem (S4); path in local km (x, y, z) */
  | { kind: 'waterfall' | 'flood'; path: V3[]; width: number };

/** An authored hero tree (local km), drawn by VegetationSystem as a canopy cluster. */
export interface TreeDecl {
  at: V2;
  kind: TreeKind;
  /** crown radius, km */
  crownKm: number;
  /** total height, km (default: the kind's recipe) */
  heightKm?: number;
  /** sRGB hex (default: the kind's recipe) */
  color?: number;
  yawDeg?: number;
}

/** A Blender-built GLB (tools/blender → public/models). Materials are named `fam:<FamilyId>`. */
export interface ModelDecl {
  /** file name under public/models/ */
  file: string;
  /** placements in local km (default: one at the origin) */
  instances?: { at: V3; headingDeg?: number; mirrorX?: boolean }[];
  /** declared local bounds (km) for CPU checks and probes — Node never parses GLBs */
  boundsKm: { r: number; h: number };
}

/**
 * A landmark shot. Ids are `<landmarkId>-close` (the hero framing, see data/tour/shotlist.json) or
 * `<landmarkId>-wide` (context, 60–300 km); the orbit is around the landmark's display position.
 */
export interface BookmarkDecl extends Omit<OrbitSpec, 'place' | 'targetKm'> {
  id: string;
  tod?: number;
  dayOfYear?: number;
  weather?: Partial<WeatherState>;
  fStop?: number;
  /** extra reference images for QA compare sheets (paths relative to the project root) */
  compare?: string[];
  note?: string;
  /** probe expectations checked by `pnpm check` (defaults by suffix + tier) */
  expect?: { minSubjectPx?: number; maxTopVoid?: number; sky?: [number, number]; los?: boolean };
}

export interface LandmarkDefinition {
  id: string;
  placeId: string;
  tier: 'A' | 'B';
  headingDeg?: number;
  /** fixed uniform DESIGN scale of the proxy/model (km multiplier) — never camera dependent; stamps are unscaled */
  scale?: number;
  /** vertical anchor of local y = 0: the ground (default) or the local water surface (lake/sea) */
  anchor?: 'ground' | 'water';
  stamps?: LocalStamp[];
  /** TS procedural kit: geometry plus kit-recorded lights / windows / trees */
  proxy?: (kit: ProxyKit) => void;
  /** Blender-built GLB (replaces or complements the proxy) */
  model?: ModelDecl;
  /** LOD switch on the projected bounding radius (px at viewport height): [LOD0 ≥, LOD1 ≥]; default [160, 40] */
  lodPx?: [number, number];
  lights?: LightDecl[];
  trees?: TreeDecl[];
  emitters?: EmitterDecl[];
  waterFeatures?: WaterFeatureDecl[];
  /** km radius cleared of forest around the origin (default: the place footprint), or explicit local circles */
  vegetationExclusion?: number | { at: V2; r: number }[];
  /** readability intent vs the local ground (checked as a warning) */
  contrast?: 'light' | 'dark';
  lookOverride?: string;
  annotation: { title: string; subtitle?: string; blurb?: string };
  bookmarks?: BookmarkDecl[];
  cameraConstraints?: { minDistance?: number };
  audioHooks?: string[];
}

export function defineLandmark(def: LandmarkDefinition): LandmarkDefinition {
  return def;
}
