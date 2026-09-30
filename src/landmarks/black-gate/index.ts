import type { LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { buildGate, TOWERS } from './gate.ts';

/**
 * The Morannon, the Black Gate (research §6): a single long wall of spiked vertical iron plates closing
 * the pass of Cirith Gorgor between two steep rocky ridges, a giant double gate in the middle, the two
 * Towers of the Teeth standing high on the flanking slopes, and a flat pale ash plain in front (the
 * Dagorlad look region carries the #636155 ash).
 *
 * Local frame (heading 25, see HEADING): local −z (the plain in front) faces north-north-east; the origin is
 * the middle of the gate. The baked ground here is
 * a low saddle: the Dagorlad falls away to the north (−7 at 10 km), the pass valley runs south (−5), and
 * the mountains on either side are low and far (the Ephel Dúath's northern end ~20 km south-west, the Ered
 * Lithui's western end rising east of x ≈ 10). Stamps, applied in order:
 *  1. the floor: the saddle the gate line sits on cut down to −4.5 (lowerOnly), a level ash floor from
 *     the pass valley behind the wall to ~10 km in front, running out into the Dagorlad's gentle fall
 *     (raising the ground in front instead made a mesa with an edge);
 *  2. two steep, craggy ridges raised along the pass (crests at x ≈ ∓11.2, ~10 above the floor, their
 *     fronts running 4 km out into the plain: a bay before the gate), so the pass is closed exactly by the
 *     ~15 km wall — the wall's wings climb their feet. They stay well below the wall-to-mountain ratio of
 *     the film's matte (5:1) so the wall still reads at 30 km;
 *  3. two shelves high on the flanks for the Towers of the Teeth.
 */
/**
 * The gate faces north-north-east (Cirith Gorgor opens onto the Dagorlad between the converging ranges):
 * the morning sun (east-north-east) then lights the wall's face at ~45° instead of grazing it — facing due
 * north, the face stood in shadow all morning, a black cut-out.
 */
const HEADING = 25;

const STAMPS: LocalStamp[] = [
  { kind: 'flatten', at: [0, -3], radius: 8, falloff: 7, height: -4.5, lowerOnly: true },
  {
    kind: 'ridge',
    path: [
      [-11.6, -4.8],
      [-11.2, -1],
      [-11.7, 4],
      [-13.8, 10],
      [-17.4, 17],
      [-21, 25],
    ],
    height: [5.5, 10.5, 11.5, 11, 10, 8],
    halfWidth: 5,
    profile: 'round',
    rough: { amp: 2.0, scaleKm: 1.8, ridged: true },
    surface: 'rock',
  },
  {
    kind: 'ridge',
    path: [
      [11.6, -4.8],
      [11.2, -1],
      [11.7, 4],
      [14.4, 9],
      [20.5, 12.5],
      [28, 14.5],
    ],
    height: [4.5, 8.5, 9, 8.5, 7, 5],
    halfWidth: 5,
    profile: 'round',
    rough: { amp: 2.0, scaleKm: 1.8, ridged: true },
    surface: 'rock',
  },
  // 3. shelves for the Towers of the Teeth on the flanks, ~4.5 above the floor (the heightfield holds a
  //    ~2 km ledge; the towers' buttressed feet follow the rest)
  ...TOWERS.map((at) => ({ kind: 'flatten' as const, at, radius: 0.8, falloff: 1.0, height: 0, surface: 'rock' as const })),
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
  vegetationExclusion: 16,
  contrast: 'dark',
  annotation: { title: 'The Black Gate', subtitle: 'The Morannon', blurb: 'The iron gates of Mordor, guarding the pass of Cirith Gorgor.' },
  bookmarks: [
    {
      id: 'black-gate-close',
      distanceKm: 30,
      elevationDeg: 4,
      azimuthDeg: 22,
      fov: 38,
      lift: 3,
      tod: 6.6,
      compare: ['reference/film/black-gate/black-gate-rotk-4k.webp', 'reference/film/black-gate/black-gate-towers-rotk.jpg', 'reference/concept-art/black-gate/howe-the-black-gates.jpg'],
      note: 'from the Dagorlad ash plain, the iron wall spanning the pass between the two ridges, the Towers of the Teeth high on the flanks; early morning (6.6 h: the sun ENE, 21° up) lighting the wall face at ~45° so the plates read — at 9 h the face stands in shadow, a black cut-out',
    },
    {
      id: 'black-gate-wide',
      distanceKm: 90,
      elevationDeg: 10,
      azimuthDeg: 10,
      fov: 35,
      lift: 2,
      tod: 6.6,
      compare: ['reference/film/black-gate/black-gate-towers-rotk.jpg'],
      note: 'the Morannon from over the Dagorlad: the wall closing the gap between the Ephel Dúath and the Ered Lithui, Mordor beyond',
    },
  ],
});
