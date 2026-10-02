import type { LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { buildGate, EAST_RIDGE, OUTCROP, TOWERS, WEST_RIDGE } from './gate.ts';

/**
 * The Morannon, the Black Gate (research §6): a single iron rampart closing the pass of Cirith Gorgor
 * between two steep rocky ridges, a giant riveted double gate under a fang crest in the middle, the two
 * Towers of the Teeth on ledges high on the flanking slopes, and a flat pale ash plain in front
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
 *  2. two massive, round-shouldered rock ridges along the pass (S4 W5: crests at x ≈ ∓11.2 rising to ≈ 22
 *     above the floor, ≈ 1.4× the Towers' tops — the RotK plate's ratio; ridged noise breaks them into
 *     crags; their noses run 4 km out into the plain: a bay before the gate), so the pass is closed by the
 *     ~17 km wall; a short rock spur off the west ridge's nose running west-south-west hides the green
 *     foothill dome beside the pass in black-gate-wide. Kit scree and flat-topped broken blocks (gate.ts)
 *     break the noses and the crests;
 *  3. a butte on the plain in the hero's right foreground (a massif stamp with short spurs, rough rock);
 *  4. two shelves (r 1.4) on the flanks, 6.2 above the floor, for the Towers of the Teeth — the wall
 *     (3.6) stands at ≈ 0.58 of the shelves' height and dies into the rock under them.
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
  // (S4 W5, C2 #5: massive round-shouldered flanks whose crests stand ≈ 1.4× the Towers' tops, as in the RotK
  // plate — at 10 above the floor the S3 crests stood lower than the Towers, which read as lighthouses on
  // soft cones; at 24 / 21 the Towers stood swallowed in notches of sheer faces. The vertex beside the
  // Towers stays low (11 / 10), so each Tower stands on a knob of the ridge's nose with the mountain rising
  // behind it; a 'sharp' profile at these heights made witch-hat spires)
  {
    kind: 'ridge',
    path: WEST_RIDGE,
    height: [7, 11, 18, 18, 15, 11],
    halfWidth: 5,
    profile: 'round',
    rough: { amp: 2.2, scaleKm: 1.6, ridged: true },
    surface: 'rock',
  },
  {
    kind: 'ridge',
    path: EAST_RIDGE,
    height: [6, 10, 16, 15, 12, 8],
    halfWidth: 5,
    profile: 'round',
    rough: { amp: 2.2, scaleKm: 1.6, ridged: true },
    surface: 'rock',
  },
  // a short broken rock spur off the west ridge's nose, running west-south-west over the green foothill dome
  // beside the pass and tapering out ≈ 20 km from the gate: in black-gate-wide it closes the right of the
  // frame (the S3 frame showed the dome and a pale flat strip of the far horizon through the gap). It stays
  // clear of the Black Gate → Ithilien route leg (S5 / S8: re-check if the route is redrawn)
  {
    kind: 'ridge',
    path: [
      [-12.5, -4],
      [-17, -6.5],
      [-22, -9],
      [-27, -11],
    ],
    height: [6, 7, 5, 0],
    halfWidth: 5,
    profile: 'round',
    rough: { amp: 2.0, scaleKm: 1.6, ridged: true },
    surface: 'rock',
  },
  // the butte on the Dagorlad in the hero's right foreground (gate.ts OUTCROP: kit breaks and scree on it): a
  // heavy body 2.4 above the plain (≈ −8.6 here, relative to the base ground at the origin), three short
  // ridged spurs breaking its round dome into a fractured heap
  {
    kind: 'massif',
    at: OUTCROP,
    radius: 2.4,
    summit: -6.2,
    base: -8.8,
    exponent: 0.75,
    dome: 1.2,
    spurs: [
      { azimuthDeg: 20, lengthKm: 2.6, widthKm: 0.8, heightFrac: 0.55, rootFrac: 0.9 },
      { azimuthDeg: 140, lengthKm: 2.4, widthKm: 0.8, heightFrac: 0.45, rootFrac: 0.85 },
      { azimuthDeg: 265, lengthKm: 2.8, widthKm: 0.9, heightFrac: 0.5, rootFrac: 0.88 },
    ],
    flankSlope: 2.4,
    rough: { amp: 1.4, scaleKm: 1.6, ridged: true },
    surface: 'rock',
  },
  // 4. shelves for the Towers of the Teeth on the flanks, 6.2 above the floor (wide enough for the
  //    Towers' stepped plinths; their foot follows the rest) — with the S4 W5 flanks the ground there stands
  //    ≈ 0.5 above the shelf, so they are ledges, not notches
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
  // smoke of Udûn's forges rising behind the wall (local +z = behind, into Mordor), drifting downwind — one
  // small source behind the west half (S4 W5: the far emitter hung as a lone black cumulus over a ridge in
  // black-gate-wide, and the one behind the east half stood as a black billow over the gate in the hero)
  emitters: [{ preset: 'smoke', at: [-5, 0.6, 10], rate: 0.25, scale: 0.6 }],
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
      note: 'from the Dagorlad ash plain, low (the Dead Marshes road, looking up): the iron rampart spanning the pass, the riveted gate between its flat iron piers under a fang crest the single subject between the Towers of the Teeth on their ledges high on the flanks, a basalt butte in the right foreground; the camera stands where two lines cross — Barad-dûr hidden behind the east Tower, Mount Doom\'s summit hidden behind the gate (only its flanks show low behind the wall: hazed to silhouette in S4); afternoon (the sun in the west, raking the wall). The butte 18 km out widens the landmark bounds past the near corners of the camera, where the probe measures 0 px: visibility is still checked',
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
