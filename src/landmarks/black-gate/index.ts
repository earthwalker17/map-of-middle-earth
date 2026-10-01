import type { LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { buildGate, EAST_RIDGE, TOWERS, WEST_RIDGE } from './gate.ts';

/**
 * The Morannon, the Black Gate (research §6): a single long wall of spiked, plated iron closing the pass
 * of Cirith Gorgor between two steep rocky ridges, a giant double gate in the middle, the two Towers of
 * the Teeth standing high on the flanking slopes, and a flat pale ash plain in front (the Dagorlad look
 * region carries the ash; a ground-look spot in looks.json darkens the ridges' rock).
 *
 * Local frame (heading 312, see HEADING): local −z (the plain in front) faces north-west; the origin is the
 * middle of the gate. Stamps, applied in order:
 *  1. the floor: the saddle the gate line sits on cut down to −6.2 (lowerOnly), a level ash floor from
 *     the pass behind the wall to ~10 km in front, level with the Dagorlad beyond (−6.5…−7.7 at 10 km: a
 *     higher floor left a berm between the plain and the gate; raising the ground in front instead made
 *     a mesa with an edge); behind the wall, Udûn: a dale cut through the baked hump toward Mordor
 *     (lowerOnly, rising gently from −5.4 to −2.4 over 40 km);
 *  2. two steep, craggy ridges along the pass (crests at x ≈ ∓11.2, ~10 above the floor, sharp-crested
 *     with strong ridged noise so their skylines are serrated; their noses run 4 km out into the plain: a
 *     bay before the gate), so the pass is closed exactly by the ~15 km wall — the wall's wings climb their
 *     feet. Kit shards (gate.ts) break the crests and noses into crags;
 *  3. two shelves high on the flanks for the Towers of the Teeth.
 */
/**
 * The gate faces north-west, as the Morannon does: Cirith Gorgor opens onto the Dagorlad and the Dead
 * Marshes road arrives from the north-west (route bearing ≈ 312°) straight at it, and every camera on the
 * plain looks south-east THROUGH the pass into Mordor — Mount Doom stands right behind the gate (bearing
 * ≈ 136°), Barad-dûr a little left of it — instead of across the Ephel Dúath into green Ithilien with
 * Minas Morgul's light in the sky. The face is lit by the afternoon and evening sun (tod 17–18.5: the sun
 * in the west, 30–40° off the face normal); in the morning it stands against the light.
 */
const HEADING = 312;

const STAMPS: LocalStamp[] = [
  { kind: 'flatten', at: [0, -3], radius: 8, falloff: 7, height: -6.2, lowerOnly: true },
  // Udûn: the dale behind the gate, cut through the baked hump (+9…+15 over the floor) south-east toward
  // the Isenmouthe, so the pass opens into Mordor (Mount Doom stands straight down it, ~84 km)
  ...([
    [-1, 11, 4, 5, -5.4],
    [-1.5, 20, 5, 6, -4.4],
    [-2.5, 30, 5.5, 6.5, -3.4],
    [-3.5, 40, 6, 7, -2.4],
  ] as const).map(([x, z, radius, falloff, height]): LocalStamp => ({ kind: 'flatten', at: [x, z], radius, falloff, height, lowerOnly: true })),
  {
    kind: 'ridge',
    path: WEST_RIDGE,
    height: [5.5, 10.5, 11.5, 11, 10, 8],
    halfWidth: 5,
    profile: 'sharp',
    rough: { amp: 3.2, scaleKm: 1.8, ridged: true },
    surface: 'rock',
  },
  {
    kind: 'ridge',
    path: EAST_RIDGE,
    height: [4.5, 8.5, 9, 8.5, 7, 5],
    halfWidth: 5,
    profile: 'sharp',
    rough: { amp: 3.2, scaleKm: 1.8, ridged: true },
    surface: 'rock',
  },
  // 3. shelves for the Towers of the Teeth on the flanks, ~6 above the floor (the heightfield holds a
  //    ~2 km ledge; the towers' buttressed feet follow the rest)
  ...TOWERS.map((at) => ({ kind: 'flatten' as const, at, radius: 1.4, falloff: 1.0, height: 0, surface: 'rock' as const })),
];

/** The Morannon: a black wall of iron closing Cirith Gorgor, flanked by the Towers of the Teeth. */
export default defineLandmark({
  id: 'black-gate',
  placeId: 'black-gate',
  tier: 'A',
  headingDeg: HEADING,
  stamps: STAMPS,
  proxy: (k) => buildGate(k),
  lookOverride: 'dagorlad',
  // no trees in the pass, on the ridges or on the Dagorlad approach in any hero framing
  vegetationExclusion: 36,
  contrast: 'dark',
  annotation: { title: 'The Black Gate', subtitle: 'The Morannon', blurb: 'The iron gates of Mordor, guarding the pass of Cirith Gorgor.' },
  bookmarks: [
    {
      id: 'black-gate-close',
      distanceKm: 36,
      elevationDeg: -4,
      azimuthDeg: 316,
      fov: 40,
      lift: 5.5,
      tod: 16.0,
      compare: ['reference/film/black-gate/black-gate-rotk-4k.webp', 'reference/film/black-gate/black-gate-towers-rotk.jpg', 'reference/concept-art/black-gate/howe-the-black-gates.jpg'],
      note: 'from the Dagorlad ash plain (the Dead Marshes road), the plated wall spanning the pass between the two craggy ridges, the Towers of the Teeth high on the flanks, Udûn and Mordor beyond; afternoon (16 h: the sun in the west, 35° up, ~50° off the face) in a high, neutral light, so the iron reads grey',
    },
    {
      id: 'black-gate-wide',
      distanceKm: 90,
      elevationDeg: 1.5,
      azimuthDeg: 312,
      fov: 32,
      lift: 9,
      aimKm: [8, -7],
      tod: 16.0,
      compare: ['reference/film/black-gate/black-gate-towers-rotk.jpg'],
      note: 'the Morannon from over the Dagorlad: the wall closing the gap between the Ephel Dúath and the Ered Lithui, Mount Doom and Barad-dûr beyond it in Mordor (aimKm into the pass)',
    },
  ],
});
