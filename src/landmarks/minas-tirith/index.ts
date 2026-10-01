import type { LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { buildBeacon, buildCitadel, buildGate, buildProw } from './citadel.ts';
import { buildHouses, buildTiers } from './city.ts';
import { BENCH_REL, C, CITADEL_Y } from './layout.ts';

/**
 * Minas Tirith, the White City (research §9; the RotK prow-and-tiers stills, the 1:72 bigature, Lee's
 * "The Last Debate"): seven walled tiers built INTO the eastern foot of Mindolluin — each a near-semicircle
 * of battered off-white wall against the sheer grey cliff, stepping up to the citadel — split by the
 * great prow of rock pointing east like the keel of a ship, its top level with the citadel; the slim
 * Tower of Ecthelion the top accent; the Great Gate facing east over the Pelennor; ~1000 houses, ~400
 * lit windows; the beacon crag on the cliff top above the city. Layout in layout.ts.
 *
 * Stamps (heights relative to the base ground at the display point, which sits at the cliff foot): the
 * Pelennor bench and the city site cut down to one level from the cliff face east (lowerOnly: the plain
 * beyond and the Anduin flats are never raised — the river stays 13+ km away), a shelf for the keep behind
 * the citadel cut into the face at the citadel's level, and a scarp raising the mountain behind the city
 * into a taller, sheer cliff (Mindolluin's front; the massif itself is the baked terrain).
 */
const SITE: LocalStamp[] = [-6, -3, 0, 3, 6].map(
  (z): LocalStamp => ({ kind: 'flatten', at: [1.0, z], radius: 2.9, falloff: 0.8, height: BENCH_REL, lowerOnly: true, surface: 'rock' }),
);

const STAMPS: LocalStamp[] = [
  // the Pelennor bench before the gate
  { kind: 'flatten', at: [6, 0], radius: 6.5, falloff: 2.5, height: BENCH_REL, lowerOnly: true },
  // the city site: the foot slope cut to the bench right up to the cliff face (x ≈ −1.9)
  ...SITE,
  // the keep shelf behind the citadel, at the citadel's level
  { kind: 'flatten', at: [C[0] - 0.9, C[1]], radius: 1.0, falloff: 0.7, height: BENCH_REL + CITADEL_Y - 0.05, lowerOnly: true, surface: 'rock' },
  // the cliff behind the city: the plateau over the face raised a little (a taller, sheer front)
  {
    kind: 'scarp',
    path: [
      [-3.9, -5],
      [-4.2, 0],
      [-3.9, 5],
    ],
    height: 2.0,
    run: 1.2,
    side: 'right',
    plateauKm: 2.5,
    falloff: 3,
    rough: { amp: 0.5, scaleKm: 2.0, ridged: true },
    surface: 'rock',
  },
  // the flanks: where the natural front eases into foot slopes north and south of the city, raise the
  // ground west of the cliff line into the same sheer face (the city stands in a bay of the mountain)
  ...[
    [
      [-2.9, -11],
      [-2.6, -7.5],
      [-2.35, -3.6],
    ],
    [
      [-2.35, 3.6],
      [-2.6, 7],
      [-2.8, 9.5],
    ],
  ].map(
    (path): LocalStamp => ({
      kind: 'scarp',
      path: path as [number, number][],
      height: 6,
      run: 0.9,
      side: 'right',
      plateauKm: 2.2,
      falloff: 2.6,
      rough: { amp: 0.8, scaleKm: 2.2, ridged: true },
      surface: 'rock',
    }),
  ),
];

export default defineLandmark({
  id: 'minas-tirith',
  placeId: 'minas-tirith',
  tier: 'A',
  stamps: STAMPS,
  proxy: (k) => {
    const arcs = buildTiers(k);
    buildProw(k);
    buildCitadel(k);
    buildGate(k);
    buildHouses(k, arcs);
    buildBeacon(k);
  },
  annotation: { title: 'Minas Tirith', subtitle: 'The White City of Gondor', blurb: 'Seven-tiered city of the kings, carved into the flank of Mount Mindolluin, facing the shadow in the east.' },
  bookmarks: [
    {
      id: 'minas-tirith-close',
      distanceKm: 40,
      elevationDeg: 5,
      azimuthDeg: 110,
      fov: 24,
      lift: 4.2,
      tod: 6.9,
      compare: ['reference/film/minas-tirith/minas-tirith-prow-tiers-rotk.jpg', 'reference/concept-art/minas-tirith/lee-the-last-debate.jpg'],
      note: 'dawn from the east-south-east over the Pelennor: the seven tiers against the cliff of Mindolluin, the prow splitting them, the White Tower the top accent',
    },
    {
      id: 'minas-tirith-wide',
      distanceKm: 110,
      elevationDeg: 26,
      azimuthDeg: 115,
      fov: 35,
      lift: 5,
      tod: 6.9,
      note: 'context: the White City at the foot of Mindolluin at the end of the White Mountains, the Pelennor and the Anduin before it, Osgiliath on the river',
    },
  ],
});
