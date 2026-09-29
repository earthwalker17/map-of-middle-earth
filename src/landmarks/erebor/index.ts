import { defineLandmark } from '../types.ts';
import type { LocalStamp } from '../types.ts';

// the display position is the Front Gate at the southern foot, where the River Running issues
// (places.json offset); the summit sits over the DEM summit, 8.7 km north. The cone ends at the gate
// and there is no southern spur, so neither lifts the river
const SUMMIT_AT: [number, number] = [2.545, -8.348];
const spurs: LocalStamp[] = [0, 60, 120, 240, 300].map((deg) => ({
  kind: 'raise' as const,
  at: [SUMMIT_AT[0] + Math.sin((deg * Math.PI) / 180) * 9, SUMMIT_AT[1] - Math.cos((deg * Math.PI) / 180) * 9] as [number, number],
  radius: 7,
  amount: 3,
}));

/** Erebor, the Lonely Mountain: a lone peak with six spurs; the Front Gate guarded by carved kings. */
export default defineLandmark({
  id: 'erebor',
  placeId: 'erebor',
  tier: 'A',
  stamps: [{ kind: 'cone', at: SUMMIT_AT, radius: 9, summit: 24, exponent: 1.25 }, ...spurs],
  proxy: (k) => {
    // the Front Gate on the south face; local y = 0 is the slope under the gate
    k.box('weathered', 3.2, 2.8, 0.6, { at: [0, 0, 0.2], tint: 0x8c8a86 });
    k.box('darkStone', 1.0, 1.6, 0.3, { at: [0, 0.2, 0.55] });
    for (const s of [-1, 1]) {
      k.box('weathered', 0.7, 3.4, 0.6, { at: [s * 2.2, 0, 0.3], tint: 0x9a9690 });
      k.box('weathered', 0.5, 0.5, 0.5, { at: [s * 2.2, 3.4, 0.3], tint: 0x9a9690 });
    }
  },
  annotation: { title: 'Erebor', subtitle: 'The Lonely Mountain', blurb: 'The great Dwarf-kingdom under the mountain, once held by the dragon Smaug.' },
  bookmarks: [{ id: 'erebor-close', distanceKm: 60, elevationDeg: 16, azimuthDeg: 185, fov: 35, tod: 12 }],
});
