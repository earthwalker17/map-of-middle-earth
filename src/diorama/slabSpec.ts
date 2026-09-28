import worldJson from '../../data/world/world.json';

const f = worldJson.frame;
const cx = (f.xMinKm + f.xMaxKm) / 2;
const cy = (f.yMinKm + f.yMaxKm) / 2;

/**
 * Physical dimensions of the diorama slab (world units = km). The map frame comes from
 * data/world/world.json (same maths as WorldSpec); the rest is the craft of the base.
 * Shared with the environment (shadow bounds).
 */
export const SLAB = {
  xMin: f.xMinKm - cx,
  xMax: f.xMaxKm - cx,
  zMin: cy - f.yMaxKm,
  zMax: cy - f.yMinKm,
  /** bottom of the strata sides (top of the plinth) */
  base: -34,
  /** plinth: how far it steps out beyond the slab edge, its height and bevel */
  plinthOut: 7,
  plinthHeight: 9,
  plinthBottom: -34 - 9 - 1.6,
  /** the cut faces sit this far outside the frame so they always cover the terrain's LOD skirts */
  faceOffset: 0.04,
} as const;
