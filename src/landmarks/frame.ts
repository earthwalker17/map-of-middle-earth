import type { World } from '../world/World.ts';
import type { LandmarkDefinition } from './types.ts';
import type { V2, V3 } from './records.ts';

/**
 * A landmark's local frame: km relative to the place's DISPLAY position, x east, z south (world axes),
 * rotated clockwise from north by `headingDeg` (the landmark's local −Z faces `headingDeg`).
 * Shared by the stamp conversion (world.ts), the build (build.ts) and the checks.
 */

/** Rotate a local XZ offset by the landmark heading (clockwise from north). */
export function rotateLocal(p: V2, headingDeg: number): V2 {
  const t = (-headingDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [p[0] * c + p[1] * s, -p[0] * s + p[1] * c];
}

/** Local XZ (km, before scale) → world XZ. `scale` applies to geometry-side offsets only (stamps use 1). */
export function localToWorldXZ(world: World, def: LandmarkDefinition, p: V2, scale = 1): V2 {
  const place = world.place(def.placeId);
  const r = rotateLocal([p[0] * scale, p[1] * scale], def.headingDeg ?? 0);
  return [place.x + r[0], place.z + r[1]];
}

/**
 * World position of local (0, 0, 0): the display position at the composite ground (after stamps), or
 * at the local water surface for `anchor: 'water'` landmarks (Lake-town).
 */
export function landmarkOrigin(world: World, def: LandmarkDefinition): V3 {
  const place = world.place(def.placeId);
  const groundY = world.heights.sample(place.x, place.z);
  const y = def.anchor === 'water' ? (world.waterLevelAt(place.x, place.z) ?? groundY) : groundY;
  return [place.x, y, place.z];
}
