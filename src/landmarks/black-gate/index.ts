import type { LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { buildGate, EAST_RIDGE, OUTCROP, TOWERS, WEST_RIDGE } from './gate.ts';

/**
 * The Morannon, the Black Gate (research §6): a single iron rampart closing the pass of Cirith Gorgor
 * between two steep rocky ridges, a giant riveted double gate under a fang crest in the middle, the two
 * Towers of the Teeth on broken crags high on the flanking slopes, and a flat pale ash plain in front
 * (the Dagorlad look region carries the ash; a ground-look spot in looks.json darkens the ridges' rock).
 * gate.ts builds the iron (the wall's level top dies into the rising rock under the Towers).
 *
 * Local frame (heading 312, see HEADING): local −z (the plain in front) faces north-west; the origin is the
 * middle of the gate. Stamps, applied in order:
 *  1. the floor: the saddle the gate line sits on cut down to −6.2 (lowerOnly), a level ash floor from
 *     the pass behind the wall to ~10 km in front, level with the Dagorlad beyond (−6.5…−7.7 at 10 km: a
 *     higher floor left a berm between the plain and the gate; raising the ground in front instead made
 *     a mesa with an edge); behind the wall, Udûn: a dale cut through the baked hump toward Mordor
 *     (lowerOnly, rising gently from −5.4 to −2.4 over 40 km);
 *  2. two steep, craggy ridges along the pass (crests at x ≈ ∓11.2, ~10 above the floor, sharp-crested
 *     with ridged noise — moderate, so the noses do not break into smooth pointed cones; their noses run
 *     4 km out into the plain: a bay before the gate), so the pass is closed by the ~16 km wall. Kit
 *     cliffs, flat-topped broken blocks and scree (gate.ts) break the Towers' knobs, the noses and the
 *     crests into fractured basalt;
 *  3. two shelves (r 1.4) high on the flanks, 6.2 above the floor, for the Towers of the Teeth — the wall
 *     (3.6) stands at ≈ 0.58 of their height.
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
  // (S4 W5, C2 #5: massive round-shouldered flanks looming ≈ 1.5× the Towers' tops, as in the RotK plate —
  // at 10 above the floor the S3 crests stood lower than the Towers, which read as lighthouses on soft
  // cones; a 'sharp' profile at these heights made witch-hat spires)
  {
    kind: 'ridge',
    path: WEST_RIDGE,
    height: [9, 20, 24, 24, 20, 14],
    halfWidth: 5,
    profile: 'round',
    rough: { amp: 2.2, scaleKm: 1.6, ridged: true },
    surface: 'rock',
  },
  {
    kind: 'ridge',
    path: EAST_RIDGE,
    height: [8, 18, 21, 20, 16, 11],
    halfWidth: 5,
    profile: 'round',
    rough: { amp: 2.2, scaleKm: 1.6, ridged: true },
    surface: 'rock',
  },
  // the Ephel Dúath's northern arm, a broken rock spur running out north-west from the west ridge's nose
  // over the green foothill dome beside the pass: in black-gate-wide it closes the right of the frame (the
  // S3 frame showed the dome and a pale flat strip of the far horizon through the gap)
  {
    kind: 'ridge',
    path: [
      [-12.5, -4],
      [-19, -7.5],
      [-27, -11],
      [-35, -15],
      [-44, -19],
      [-53, -22],
    ],
    height: [7, 8, 9, 9, 7, 0],
    halfWidth: 6,
    profile: 'round',
    rough: { amp: 2.0, scaleKm: 1.6, ridged: true },
    surface: 'rock',
  },
  // the butte on the Dagorlad in the hero's right foreground (gate.ts OUTCROP: the kit keeps only its upper
  // cliff band): a flat-topped body 2.4 above the plain (≈ −8.6 here, relative to the base ground at the
  // origin), steep broken sides
  { kind: 'massif', at: OUTCROP, radius: 2.4, summit: -6.2, base: -8.8, exponent: 0.6, dome: 2, spurs: [], rough: { amp: 0.7, scaleKm: 1.6, ridged: true }, surface: 'rock' },
  // 3. shelves for the Towers of the Teeth on the flanks, 6.2 above the floor (wide enough for the
  //    Towers' stepped plinths; their foot follows the rest)
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
  // smoke of Udûn's forges rising behind the wall (local +z = behind, into Mordor), drifting downwind (S4 W5:
  // the third, far emitter hung as a lone black cumulus over the west ridge in black-gate-wide — removed)
  emitters: [
    { preset: 'smoke', at: [-4, 0.8, 6], rate: 0.3, scale: 0.9 },
    { preset: 'smoke', at: [3, 1.2, 9], rate: 0.28, scale: 1.1 },
  ],
  lookOverride: 'dagorlad',
  // no trees in the pass, on the ridges or on the Dagorlad approach in any hero framing
  vegetationExclusion: 36,
  contrast: 'dark',
  annotation: { title: 'The Black Gate', subtitle: 'The Morannon', blurb: 'The iron gates of Mordor, guarding the pass of Cirith Gorgor.' },
  bookmarks: [
    {
      id: 'black-gate-close',
      fStop: 5.6,
      distanceKm: 26.2,
      elevationDeg: -11.5,
      azimuthDeg: 320.5,
      fov: 48,
      lift: 5.0,
      tod: 16.0,
      compare: ['reference/film/black-gate/black-gate-rotk-4k.webp', 'reference/film/black-gate/black-gate-towers-rotk.jpg', 'reference/concept-art/black-gate/howe-the-black-gates.jpg'],
      note: 'from the Dagorlad ash plain, low (the Dead Marshes road, looking up): the iron rampart spanning the pass, the riveted gate under its fang crest the single subject between the Towers of the Teeth on their broken crags, a basalt outcrop in the right foreground; the camera stands where two lines cross — Barad-dûr hidden behind the east Tower, Mount Doom\'s summit hidden behind the east gate tower (only its flanks show low behind the wall: hazed to silhouette in S4); afternoon (the sun in the west, raking the wall). The outcrop 14 km out widens the landmark bounds past the near corners of the camera, where the probe measures 0 px: visibility is still checked',
      expect: { minSubjectPx: 0 },
    },
    {
      id: 'black-gate-wide',
      distanceKm: 90,
      elevationDeg: -0.5,
      azimuthDeg: 346,
      fov: 26,
      lift: 9,
      aimKm: [-2, -2],
      tod: 16.0,
      compare: ['reference/film/black-gate/black-gate-towers-rotk.jpg'],
      note: 'the Morannon from the north-west over the Dagorlad, low (the plain foreshortened), the gate on the lower third: the wall closing the gap between the Ephel Dúath and the Ered Lithui; Barad-dûr beyond the left edge, Mount Doom offset far left of the crest axis',
    },
  ],
});
