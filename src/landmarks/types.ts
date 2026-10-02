import type { OrbitSpec } from '../camera/shots.ts';
import type { WeatherState } from '../core/types.ts';
import type { Stamp } from '../world/stamps.ts';
import type { ProxyKit } from './kit/ProxyKit.ts';
import type { EmitterPreset, ForestArea, ForestSpecies, LightExtras, LightGate, LightKind, TreeKind, V2, V3 } from './records.ts';

export type { EmitterPreset, ForestArea, ForestSpecies, LightExtras, LightGate, LightKind, TreeKind, V2, V3 } from './records.ts';

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

export interface LightDecl extends LightExtras {
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

/** Particle/volume/ribbon emitters, realized by the EffectsSystem (S4). Local km. */
export interface EmitterDecl {
  preset: EmitterPreset;
  at: V3;
  /** far end (beam) or drift target, local km */
  to?: V3;
  rate?: number;
  scale?: number;
  /** sRGB hex tint (default by preset) */
  color?: number;
  /** SceneState.events channel that switches the emitter (absent = always on) */
  event?: string;
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

/**
 * A wood of many trees, placed by the vegetation system like the natural forests (chunked, LOD-capped,
 * thinned with the quality density) — for masses of trees (forested hills, wooded gorges). A few
 * characterful individuals stay `trees` (always drawn, never thinned). Local km, landmark frame.
 */
export interface ForestDecl {
  area: ForestArea;
  /** trees per km² at quality density 1 */
  density: number;
  species: ForestSpecies[];
  /** clumping: value-noise stands of about `scaleKm`; `amount` 0 = uniform … 1 = clear gaps between stands */
  clump?: { scaleKm: number; amount: number };
  /** density ramps up over this distance inside the area's edge, km (default 0.15) */
  edgeKm?: number;
  /** no trees on slopes steeper than this (default 70° — the relief is exaggerated ×12, forested flanks are steep) */
  maxSlopeDeg?: number;
  /** clearings: no trees inside these circles (halls, a bald summit, the Seat) */
  avoid?: { at: V2; r: number }[];
  /** no trees where the ground is lower than this local height (km above the origin): shores, flood plains */
  minY?: number;
}

/** A Blender-built GLB (tools/blender → public/models). Materials are named `fam:<FamilyId>`. */
export interface ModelDecl {
  /** file name under public/models/ */
  file: string;
  /**
   * placements in local km (default: one at the origin); `node` names a variant: that instance adds the
   * GLB's `<node>_lod0/1/2` nodes to the shared `lod0/1/2` (e.g. two different helms on one body)
   */
  instances?: { at: V3; headingDeg?: number; mirrorX?: boolean; node?: string }[];
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
  /** SceneState.events channels for this shot (e.g. { beacons: 1 }) */
  events?: Record<string, number>;
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
  forests?: ForestDecl[];
  /** tree-height caps (local km circles): placed, forest and authored trees inside stay ≤ maxHeightKm (S4) */
  treeCaps?: { at: V2; r: number; maxHeightKm: number }[];
  emitters?: EmitterDecl[];
  waterFeatures?: WaterFeatureDecl[];
  /**
   * Upright reflection proxies (local km; `top`: local height of the top): what the water's reflection march
   * cannot see in the HeightField — a rock spire standing in a lake or river mirrors as dark stone instead of
   * the sky above its stamp. GLB model instances get one from their bounds (landmarkReflectors).
   */
  reflectors?: { at: V2; r: number; top: number }[];
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
