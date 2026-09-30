import { defineLandmark } from '../types.ts';
import type { LocalStamp } from '../types.ts';

/**
 * Erebor, the Lonely Mountain (research §13): ONE massive mountain alone on the plain, with ridged
 * spurs — not a clay cone. The display position is the Front Gate at the southern foot, where the
 * River Running issues (places.json offset); the summit sits over the DEM summit, 8.7 km north
 * (azimuth summit → gate ≈ 197°).
 *
 * A broad, heavy body (radius 8 km, a gently concave profile) standing well above the ranges on the
 * northern horizon, with six long spurs whose shoulders hold a third to a half of its height — the heavy,
 * snow-capped mountain of the film (a stamp snow cap above 0.7 of its height). The
 * gate valley between the south-east arm (132°) and Ravenhill's south-west arm (238°) stays open — nothing
 * within ~40° of the gate line — so the river leaves the mountain down its own valley (it flows S then SE
 * from the gate); those two arms are the highest, flanking the gate. Surface 'auto': the foothills keep
 * their turf, the steep upper mountain its rock.
 */
const SUMMIT_AT: [number, number] = [2.545, -8.348];

const MASSIF: LocalStamp = {
  kind: 'massif',
  at: SUMMIT_AT,
  radius: 8,
  summit: 27.5,
  // the profile starts from the level of the plain around (the gate at the foot lies ~1 lower)
  base: 1.2,
  exponent: 1.2,
  // a broad, heavy crown rather than a needle (12× exaggerated heights make any pointed peak a Matterhorn)
  dome: 0.6,
  // each spur drops from the summit as an arête to a shoulder at about two-thirds of the height
  // (rootFrac), then runs out long, heavy and slowly falling toward the plain (heightFrac halfway out)
  spurs: [
    { azimuthDeg: 18, lengthKm: 20, widthKm: 5, heightFrac: 0.35, rootFrac: 0.65 },
    { azimuthDeg: 78, lengthKm: 23, widthKm: 5.5, heightFrac: 0.36, rootFrac: 0.65 },
    // the eastern arm of the gate valley
    { azimuthDeg: 132, lengthKm: 21, widthKm: 5, heightFrac: 0.46, rootFrac: 0.66 },
    // Ravenhill's spur: the western arm of the gate valley, the watch-post near its end
    { azimuthDeg: 238, lengthKm: 23, widthKm: 5, heightFrac: 0.5, rootFrac: 0.66 },
    { azimuthDeg: 290, lengthKm: 20, widthKm: 5, heightFrac: 0.35, rootFrac: 0.64 },
    { azimuthDeg: 338, lengthKm: 17, widthKm: 4.5, heightFrac: 0.34, rootFrac: 0.64 },
  ],
  // steep flanks: ridged spurs with deep V valleys between them
  flankSlope: 2.3,
  rough: { amp: 1.0, scaleKm: 3.6, ridged: true },
  // the snow-capped upper mountain of the film: snow above 0.7 of the height on all but the sheerest faces
  snowCap: 0.7,
};

/** the massif's rock (looks.json erebor spot rock #63646a, a little lighter as dressed stone) */
const GATE_STONE = 0x75736d;

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
    // the Front Gate placeholder on the south face (rebuilt in W4): dressed stone in the mountain's rock
    // tint, only the door recess dark; every part kit-seated on the LOWEST ground under its footprint
    // (sunk 0.02 km) with its uphill back let into the rising face — never floating over the slope or the
    // river bank in front (local y = 0 is the ground at the gate, where the river issues)
    k.box('stone', 3.2, 2.8, 0.6, { at: [0, 0, 0.2], color: GATE_STONE, seat: 'min' });
    k.box('darkStone', 1.0, 1.8, 0.12, { at: [0, 0, 0.52], seat: 'min' });
    for (const s of [-1, 1]) k.box('stone', 0.7, 3.8, 0.6, { at: [s * 2.2, 0, 0.3], color: GATE_STONE, shade: 1.06, seat: 'min' });
  },
  annotation: { title: 'Erebor', subtitle: 'The Lonely Mountain', blurb: 'The great Dwarf-kingdom under the mountain, once held by the dragon Smaug.' },
  bookmarks: [
    { id: 'erebor-close', distanceKm: 60, elevationDeg: 10, azimuthDeg: 200, fov: 35, lift: 12, tod: 18.0, note: 'dusk from the south: the lone massif with ridged spurs, the gate and the river leaving it' },
    { id: 'erebor-wide', distanceKm: 140, elevationDeg: 6, azimuthDeg: 168, fov: 35, lift: 4, tod: 18.0, note: 'from the south over the Long Lake and Lake-town, Erebor alone on the northern plain, its summit clear of the far ranges' },
  ],
});
