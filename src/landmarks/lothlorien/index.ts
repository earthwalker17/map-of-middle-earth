import { defineLandmark, type LightDecl } from '../types.ts';
import { FLETS, GROVE, lamps, TREES } from './grove.ts';

/**
 * The lamps sit in the crowns and on the flets, i.e. relative to the ground under each tree; the
 * proxy (which knows the composited ground through `k.ground`) fills them before the build reads
 * `lights` (build.ts: proxy first, then lights). Refilled on every build run — a pure function of
 * the world. When kit v2 records lights itself, move them into the proxy.
 */
const LAMPS: LightDecl[] = [];

/** Caras Galadhon: the city of the Galadhrim in the golden mallorn trees. */
export default defineLandmark({
  id: 'lothlorien',
  placeId: 'lothlorien',
  tier: 'A',
  // the natural Lórien forest stays; only the city floor under the central trees is clear (the
  // authored mallorns are never excluded)
  vegetationExclusion: [{ at: GROVE, r: 2.2 }],
  trees: TREES,
  lights: LAMPS,
  proxy: (k) => {
    // white flets around the great trunks (pale stone family until kit v2)
    for (const f of FLETS) k.cylinder('stone', f.r, f.r * 0.92, 0.05, { at: [f.x, k.ground(f.x, f.z) + f.h, f.z], seg: 20, tint: 0xf4f1e6 });
    LAMPS.splice(0, LAMPS.length, ...lamps((x, z) => k.ground(x, z)));
  },
  lookOverride: 'lorien',
  annotation: { title: 'Lothlórien', subtitle: 'Caras Galadhon', blurb: 'The golden wood of the Lady Galadriel, where no shadow falls.' },
  bookmarks: [
    { id: 'lothlorien-close', distanceKm: 24, elevationDeg: 14, azimuthDeg: 250, fov: 35, lift: 3, tod: 19.0, note: 'dusk over the golden canopy, the mallorn crowns of Caras Galadhon lit by blue-white lamps' },
    { id: 'lothlorien-wide', distanceKm: 70, elevationDeg: 14, azimuthDeg: 225, fov: 35, lift: 2, tod: 19.0, note: 'Lórien between the Celebrant and the Anduin, the grove of great mallorns rising from the golden wood' },
  ],
});
