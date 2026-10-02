import type { LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { buildApron, buildBeacon, buildCitadel, buildGate, buildProw } from './citadel.ts';
import { buildHouses, buildRoofscape, buildTiers } from './city.ts';
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
  { kind: 'flatten', at: [C[0] - 0.8, C[1]], radius: 1.5, falloff: 0.7, height: BENCH_REL + CITADEL_Y - 0.05, lowerOnly: true, surface: 'rock' },
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
    // (S4 W5, C2 #7: a ridged roughness at the heightfield's finest (≈ 1.6 km): buttresses and gullies,
    // not one flat brown slab behind the city)
    rough: { amp: 1.3, scaleKm: 0.8, ridged: true },
    surface: 'rock',
  },
  // the flanks: where the natural front eases into foot slopes north and south of the city, raise the
  // ground west of the cliff line into a sheer face (the city stands in a bay of the mountain). S4 W5 (C2
  // #7: the flanks carved a deep dark bay, the city in shadow, a grey beehive in a hole): lower (4.2 →
  // 2.8), their lines jogging ±0.6 km and ridged at ≈ 1–1.6 km, so the bay is shallower and its faces
  // break into buttresses and gullies
  ...[
    [
      [-2.9, -11],
      [-2.3, -9.3],
      [-3.1, -7.5],
      [-2.4, -5.6],
      [-2.35, -3.6],
    ],
    [
      [-2.35, 3.6],
      [-2.9, 5.3],
      [-2.2, 7],
      [-2.9, 8.4],
      [-2.8, 9.5],
    ],
  ].map(
    (path): LocalStamp => ({
      kind: 'scarp',
      path: path as [number, number][],
      height: 2.8,
      run: 0.9,
      side: 'right',
      plateauKm: 1.8,
      falloff: 2.6,
      rough: { amp: 1.2, scaleKm: 1.0, ridged: true },
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
    buildApron(k, arcs[0]);
    buildHouses(k, arcs);
    buildRoofscape(k, arcs);
    buildBeacon(k);
  },
  // the beacon crag on the cliff top lifts the bounds (h ≈ 17 km, LOD radius ≈ 12.6 km): LOD0 (the ~900
  // houses) only inside ~60 km, the LOD1 roofscape beyond
  lodPx: [230, 50],
  // no forest crowns on the Pelennor and the flanks before the city (1 km crowns beside 0.2 km houses
  // break the scale)
  vegetationExclusion: [
    { at: [4, 0], r: 12 },
    { at: [0, -12], r: 9 },
    { at: [8, -16], r: 7 },
    { at: [-5, -22], r: 6 },
    { at: [0, 12], r: 9 },
  ],
  annotation: { title: 'Minas Tirith', subtitle: 'The White City of Gondor', blurb: 'Seven-tiered city of the kings, carved into the flank of Mount Mindolluin, facing the shadow in the east.' },
  bookmarks: [
    {
      id: 'minas-tirith-close',
      // S4 W5 (C2 #7 / #10): further and higher (40 → 55 km, 5 → 10°, the frame lifted and aimed a little
      // south-west; shot-list heroKm 40 → 50) so Mindolluin's crest and some sky show over the city in the
      // lower-middle third; from the south-east (110 → 140°) the prow stands in three-quarter view, the dawn
      // sun raking it from the left (≈ 60° off the lens) and its southern face in shade
      distanceKm: 55,
      elevationDeg: 10,
      azimuthDeg: 140,
      fov: 24,
      lift: 7.5,
      aimKm: [-1.5, 1.0],
      tod: 6.3,
      compare: ['reference/film/minas-tirith/minas-tirith-prow-tiers-rotk.jpg', 'reference/concept-art/minas-tirith/lee-the-last-debate.jpg'],
      note: 'dawn from the south-east over the Pelennor: the seven tiers (the two lower walls tall) as pale bands against the broken grey cliff of Mindolluin with its crest and snow over them, great halls, domes and towers among the houses, the rock keel of the prow in three-quarter view over the Great Gate (lit from the left, its southern face in shade), the White Tower the top accent',
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
