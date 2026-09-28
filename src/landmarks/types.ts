import type { OrbitSpec } from '../camera/shots.ts';
import type { Stamp } from '../world/stamps.ts';
import type { ProxyKit } from './kit/ProxyKit.ts';

/**
 * A landmark is a declarative bundle. Shared systems realize every part of it:
 *  - stamps → HeightField stamp layer (before any system samples heights)
 *  - proxy / model → LandmarkSystem meshes (material families only)
 *  - lights → emission buffer (S3) · emitters → EffectsSystem (S6) · waterFeatures → WaterSystem
 *  - vegetationExclusion → VegetationSystem.setExclusions · annotation/bookmarks → tour & explorer
 * Landmarks never create materials, particle systems or render loops of their own.
 *
 * Local coordinates: km relative to the place's DISPLAY position, x east, z south (world axes),
 * rotated by headingDeg (clockwise from north, i.e. the landmark's local −Z faces `headingDeg`).
 * Local y = 0 is the ground height at the origin (after stamps).
 */
export type LocalStamp = Stamp;

export interface LightDecl {
  at: [number, number, number];
  color: number;
  intensity: number;
  radius: number;
  kind?: 'window' | 'fire' | 'lava' | 'eye' | 'beacon' | 'magic';
}

export interface EmitterDecl {
  preset: 'smoke' | 'ash' | 'embers' | 'steam' | 'mist' | 'sparks';
  at: [number, number, number];
  rate?: number;
  scale?: number;
}

export interface WaterFeatureDecl {
  kind: 'waterfall' | 'pool' | 'flood';
  path: [number, number, number][];
  width: number;
}

export interface LandmarkDefinition {
  id: string;
  placeId: string;
  tier: 'A' | 'B';
  headingDeg?: number;
  /** multiplies the proxy/model size (km) */
  scale?: number;
  /** vertical anchor of local y = 0: the ground (default) or the local water surface (lake/sea) */
  anchor?: 'ground' | 'water';
  stamps?: LocalStamp[];
  proxy?: (kit: ProxyKit) => void;
  /** Blender-built GLB (S4+): LOD files, near → far */
  model?: { lods: string[] };
  lodDistances?: number[];
  lights?: LightDecl[];
  emitters?: EmitterDecl[];
  waterFeatures?: WaterFeatureDecl[];
  /** km radius cleared of forests (defaults to the place footprint) */
  vegetationExclusion?: number;
  lookOverride?: string;
  night?: { windows?: number; flicker?: number };
  annotation: { title: string; subtitle?: string; blurb?: string };
  bookmarks?: (Omit<OrbitSpec, 'place' | 'targetKm'> & { id: string; tod?: number })[];
  cameraConstraints?: { minDistance?: number };
  audioHooks?: string[];
}

export function defineLandmark(def: LandmarkDefinition): LandmarkDefinition {
  return def;
}
