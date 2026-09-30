import { defineLandmark } from '../types.ts';
import type { LocalStamp } from '../types.ts';

/**
 * Erebor, the Lonely Mountain (research §13): ONE massive mountain alone on the plain, with ridged
 * spurs — not a clay cone. The display position is the Front Gate at the southern foot, where the
 * River Running issues (places.json offset); the summit sits over the DEM summit, 8.7 km north
 * (azimuth summit → gate ≈ 197°).
 *
 * A steep craggy spire (body radius 6 km, six arêtes) standing above the shoulders of six long ridged foothill
 * spurs (each with two side ridges), with V valleys between them. The gate valley between the
 * south-east arm (132°) and Ravenhill's south-west arm (238°) stays open — nothing within ~40° of the
 * gate line — so the river leaves the mountain down its own valley (it flows S then SE from the gate).
 * Surface 'auto': the foothills keep their turf, the steep upper mountain its rock.
 */
const SUMMIT_AT: [number, number] = [2.545, -8.348];

const MASSIF: LocalStamp = {
  kind: 'massif',
  at: SUMMIT_AT,
  // a steep craggy spire (the body) standing above the shoulders of six long foothill spurs
  radius: 6,
  summit: 21,
  // the profile starts from the level of the plain around (the gate at the foot lies ~1 lower)
  base: 1.2,
  exponent: 1.5,
  // each spur is a steep arête from the summit down to a shoulder at about half the height (rootFrac),
  // then runs out long and low toward the plain (heightFrac halfway out) — the pyramid peak on a skirt
  // of foothill ridges of the film's Lonely Mountain
  spurs: [
    { azimuthDeg: 18, lengthKm: 20, widthKm: 5, heightFrac: 0.26, rootFrac: 0.52 },
    { azimuthDeg: 78, lengthKm: 23, widthKm: 5.5, heightFrac: 0.3, rootFrac: 0.56 },
    // the eastern arm of the gate valley
    { azimuthDeg: 132, lengthKm: 21, widthKm: 5, heightFrac: 0.28, rootFrac: 0.54 },
    // Ravenhill's spur: the western arm of the gate valley, the watch-post near its end
    { azimuthDeg: 238, lengthKm: 23, widthKm: 5, heightFrac: 0.3, rootFrac: 0.56 },
    { azimuthDeg: 290, lengthKm: 20, widthKm: 5, heightFrac: 0.26, rootFrac: 0.5 },
    { azimuthDeg: 338, lengthKm: 17, widthKm: 4.5, heightFrac: 0.24, rootFrac: 0.5 },
  ],
  // steep flanks: narrow ridged spurs with deep V valleys between them
  flankSlope: 1.7,
  rough: { amp: 1.3, scaleKm: 3.6, ridged: true },
};

/** Erebor, the Lonely Mountain: a lone massif with ridged spurs; the Front Gate guarded by carved kings. */
export default defineLandmark({
  id: 'erebor',
  placeId: 'erebor',
  tier: 'A',
  // the massif, then the head of the gate valley: a level floor opening south with the gate at its
  // north rim, where the face rises (the river issues across it; lowering toward the water is what the
  // river guard allows)
  stamps: [MASSIF, { kind: 'flatten', at: [0, 2.2], radius: 2.4, falloff: 2.2, height: 0.2 }],
  proxy: (k) => {
    // the Front Gate on the south face (rebuilt in W4): each part stands on the LOWEST ground under its
    // footprint (sunk 0.02 km) with its uphill back let into the rising face — never floating over the
    // slope or the river bank in front (local y = 0 is the ground at the gate, where the river issues)
    const foot = (x: number, z: number, w: number, d: number) => {
      let g = Infinity;
      for (const [u, v] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, 0.5], [0, -0.5]]) g = Math.min(g, k.ground(x + u * w, z + v * d));
      return g - 0.02;
    };
    const wallY = foot(0, 0.2, 3.2, 0.6);
    k.box('weathered', 3.2, 2.8, 0.6, { at: [0, wallY, 0.2], tint: 0x8c8a86 });
    k.box('darkStone', 1.0, 1.6, 0.3, { at: [0, Math.max(wallY, foot(0, 0.55, 1.0, 0.3)) + 0.2, 0.55] });
    for (const s of [-1, 1]) {
      const y = foot(s * 2.2, 0.3, 0.7, 0.6);
      k.box('weathered', 0.7, 3.4, 0.6, { at: [s * 2.2, y, 0.3], tint: 0x9a9690 });
      k.box('weathered', 0.5, 0.5, 0.5, { at: [s * 2.2, y + 3.4, 0.3], tint: 0x9a9690 });
    }
  },
  annotation: { title: 'Erebor', subtitle: 'The Lonely Mountain', blurb: 'The great Dwarf-kingdom under the mountain, once held by the dragon Smaug.' },
  bookmarks: [
    { id: 'erebor-close', distanceKm: 52, elevationDeg: 11, azimuthDeg: 200, fov: 35, lift: 8, tod: 18.0, note: 'dusk from the south: the lone massif with ridged spurs, the gate and the river leaving it' },
    { id: 'erebor-wide', distanceKm: 140, elevationDeg: 10, azimuthDeg: 185, fov: 35, lift: 4, tod: 18.0, note: 'from the south over the Long Lake and Lake-town, Erebor alone on the northern plain' },
  ],
});
