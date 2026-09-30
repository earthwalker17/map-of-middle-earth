import { defineLandmark } from '../types.ts';
import { buildFlets, buildLamps, GROVE, TREES } from './grove.ts';

/**
 * Caras Galadhon: the city of the Galadhrim in the golden mallorn trees. The ~40 great mallorns are
 * authored trees (VegetationSystem hero list: tiered crowns, flared silver trunks, limbs), the white flets
 * kit geometry round their trunks, and 150 blue-white elven lamps kit light records (EmissionSystem
 * sprites, lit from blue hour on). The only glow geometry is the faint, lamp-gated rail and underside of
 * each flet (the lanterns' light on it), far below the sprites' brightness.
 */
export default defineLandmark({
  id: 'lothlorien',
  placeId: 'lothlorien',
  tier: 'A',
  // the natural Lórien forest stays; only the city floor under the central trees is clear (the
  // authored mallorns are never excluded)
  vegetationExclusion: [{ at: GROVE, r: 2.2 }],
  trees: TREES,
  proxy: (k) => {
    buildFlets(k);
    buildLamps(k);
  },
  lookOverride: 'lorien',
  annotation: { title: 'Lothlórien', subtitle: 'Caras Galadhon', blurb: 'The golden wood of the Lady Galadriel, where no shadow falls.' },
  bookmarks: [
    // just after sunset (sun ≈ 1.5° below the horizon): the warm sky still lights the gold of the wood while
    // the lamps come on (night-gated like every window and lamp: dark at the shot list's 19.0, sun 8.8° up)
    { id: 'lothlorien-close', distanceKm: 24, elevationDeg: 14, azimuthDeg: 250, fov: 35, lift: 3, tod: 20.15, note: 'dusk over the golden canopy, the mallorn crowns of Caras Galadhon lit by blue-white lamps' },
    { id: 'lothlorien-wide', distanceKm: 70, elevationDeg: 20, azimuthDeg: 225, fov: 35, lift: 2, tod: 20.15, note: 'Lórien between the Celebrant and the Anduin, the grove of great mallorns rising from the golden wood, its lamps a blue-white spark' },
  ],
});
