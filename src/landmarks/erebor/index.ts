import { defineLandmark } from '../types.ts';
import type { LocalStamp } from '../types.ts';

/**
 * Erebor, the Lonely Mountain (research §13): ONE massive mountain alone on the plain, with ridged
 * spurs — not a clay cone. The display position is the Front Gate at the southern foot, where the
 * River Running issues (places.json offset); the summit sits over the DEM summit, 8.7 km north
 * (azimuth summit → gate ≈ 197°). The gate valley between the south-east spur and Ravenhill's
 * south-west spur stays open (only a short, low rib at 160°; nothing within ~35° of the gate line), so
 * the river leaves the mountain down its own valley (it flows S then SE from the gate).
 */
const SUMMIT_AT: [number, number] = [2.545, -8.348];

const MASSIF: LocalStamp = {
  kind: 'massif',
  at: SUMMIT_AT,
  // a steep craggy summit on broad ridged shoulders — far wider than it is high, alone on the plain
  radius: 12,
  summit: 21,
  // the profile starts from the level of the plain around (the gate at the foot lies ~1 lower)
  base: 1.2,
  exponent: 2.0,
  spurs: [
    { azimuthDeg: 10, lengthKm: 22, widthKm: 8, heightFrac: 0.56 },
    { azimuthDeg: 40, lengthKm: 16, widthKm: 5, heightFrac: 0.38 },
    { azimuthDeg: 70, lengthKm: 25, widthKm: 9, heightFrac: 0.6 },
    // the eastern arm of the gate valley
    { azimuthDeg: 124, lengthKm: 23, widthKm: 8, heightFrac: 0.56 },
    { azimuthDeg: 160, lengthKm: 15, widthKm: 4.5, heightFrac: 0.34 },
    // Ravenhill's spur: the western arm of the gate valley, the watch-post near its end
    { azimuthDeg: 234, lengthKm: 25, widthKm: 9, heightFrac: 0.6 },
    { azimuthDeg: 262, lengthKm: 16, widthKm: 5, heightFrac: 0.38 },
    { azimuthDeg: 292, lengthKm: 22, widthKm: 8, heightFrac: 0.56 },
    { azimuthDeg: 336, lengthKm: 19, widthKm: 7, heightFrac: 0.5 },
  ],
  rough: { amp: 2, scaleKm: 3, ridged: true },
  surface: 'rock',
};

/** Erebor, the Lonely Mountain: a lone massif with ridged spurs; the Front Gate guarded by carved kings. */
export default defineLandmark({
  id: 'erebor',
  placeId: 'erebor',
  tier: 'A',
  // the massif, then the gate's forecourt: a small level floor at the foot of the face (the river
  // issues across it; lowering toward the water is what the river guard allows)
  stamps: [MASSIF, { kind: 'flatten', at: [0, 0.1], radius: 2.4, falloff: 1.4, height: 0.2 }],
  proxy: (k) => {
    // the Front Gate on the south face (rebuilt in W4): each part stands on the ground at its FRONT
    // (downhill, +z) edge with its back let into the rising face — never floating over the slope in
    // front, never swallowed by it (local y = 0 is the ground at the gate, where the river issues)
    const seat = (x: number, z: number, d: number) => k.ground(x, z + d / 2) - 0.05;
    const wallY = seat(0, 0.2, 0.6);
    k.box('weathered', 3.2, 2.8 - wallY, 0.6, { at: [0, wallY, 0.2], tint: 0x8c8a86 });
    k.box('darkStone', 1.0, 1.6, 0.3, { at: [0, Math.max(wallY, seat(0, 0.55, 0.3)) + 0.2, 0.55] });
    for (const s of [-1, 1]) {
      const y = seat(s * 2.2, 0.3, 0.6);
      k.box('weathered', 0.7, 3.4, 0.6, { at: [s * 2.2, y, 0.3], tint: 0x9a9690 });
      k.box('weathered', 0.5, 0.5, 0.5, { at: [s * 2.2, y + 3.4, 0.3], tint: 0x9a9690 });
    }
  },
  annotation: { title: 'Erebor', subtitle: 'The Lonely Mountain', blurb: 'The great Dwarf-kingdom under the mountain, once held by the dragon Smaug.' },
  bookmarks: [
    { id: 'erebor-close', distanceKm: 58, elevationDeg: 10, azimuthDeg: 205, fov: 35, lift: 7, tod: 18.0, note: 'dusk from the south: the lone massif with ridged spurs, the gate and the river leaving it' },
    { id: 'erebor-wide', distanceKm: 140, elevationDeg: 10, azimuthDeg: 185, fov: 35, lift: 4, tod: 18.0, note: 'from the south over the Long Lake and Lake-town, Erebor alone on the northern plain' },
  ],
});
