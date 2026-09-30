import type { LightDecl, LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { buildDoom, CRATER_R } from './parts.ts';

/**
 * Orodruin, Mount Doom (research §15, §13): an ISOLATED, near-symmetric, steep volcanic cone (the film's
 * Ngauruhoe) rising from the flat ash plain of Gorgoroth — radial gullies, one lower shoulder, a crater
 * whose rim glows, a few irregular lava flows down the gullies, and the Sammath Naur door high on the
 * east flank (facing Barad-dûr) reached by a winding path.
 *
 * Local frame (heading 0): x east, z south; the origin is the DEM peak (places.json, src D). Heights are
 * relative to the base ground there. The baked ground is a plain at −1…−2.5 to the west and south with a
 * few low hills, but the Gorgoroth plateau reaches within ~8 km on the north-east (+10…+13): the old cone
 * drowned in it as "one dome".
 *
 * Stamps, in order (landmarks apply in id order, so Barad-dûr's mount is already in place; nothing here
 * reaches within 6 km of it):
 *  1. the Gorgoroth floor: a level ash plain (−1.2) 34 km across round the cone, and lowerOnly cuts of the
 *     plateau hump to the north-east and north, so a plain runs out toward Barad-dûr (27, −18) and rises
 *     to its spur only beyond ~20 km — the two stand apart;
 *  2. the cone: a radially symmetric `cone` (radius 17, profile ^1.25 — near-straight steep flanks over a
 *     concave apron, as Ngauruhoe) to a crater rim ≈ +21.5 with a real bowl (depth 6.5 against the cone's
 *     4-unit fall from apex to rim), light ridged roughness. (A `massif` was tried first: its domain warp
 *     and broad spur flanks read as a lumpy hill, not a volcano.)
 *  3. the lower shoulder: an old parasitic cone on the west-south-west flank (the film's long left flank);
 *  4. radial ribs: 15 thin `ridge` stamps from just below the rim down to the apron, slightly curved and
 *     uneven — the V gullies between them are Ngauruhoe's radial gully pattern (≥ 1 km wide at the 0.4 km
 *     heightfield); the lava flows (parts.ts) follow them.
 */

/** the Gorgoroth plain the cone rises from (rel. the base ground at the origin) */
const PLAIN = -1.2;
const R = 17;
const DEG = Math.PI / 180;
const at = (az: number, d: number): [number, number] => [Math.sin(az * DEG) * d, -Math.cos(az * DEG) * d];

/** radial ribs: [azimuth, start km, end km, crest height, half-width, curve deg] (irregular on purpose) */
const RIBS: [number, number, number, number, number, number][] = [
  [8, 3.2, 12.5, 1.5, 1.1, 6],
  [31, 3.6, 10.5, 1.2, 1.0, -5],
  [55, 3.0, 13.5, 1.7, 1.2, 4],
  [80, 3.8, 11, 1.3, 1.0, -7],
  [103, 3.1, 14, 1.8, 1.25, 5],
  [127, 3.5, 12, 1.4, 1.1, -4],
  [150, 3.0, 13, 1.6, 1.15, 7],
  [172, 3.9, 11.5, 1.2, 1.0, -6],
  [194, 3.2, 14.5, 1.8, 1.25, 4],
  [218, 3.6, 12, 1.3, 1.05, -5],
  [266, 3.3, 12.5, 1.5, 1.1, -6],
  [289, 3.8, 11, 1.2, 1.0, 5],
  [311, 3.0, 13.5, 1.7, 1.2, -4],
  [334, 3.5, 12, 1.4, 1.1, 6],
  [355, 4.0, 10, 1.1, 0.95, -3],
];

const STAMPS: LocalStamp[] = [
  // 1. the Gorgoroth floor
  { kind: 'flatten', at: [-3, 4], radius: 17, falloff: 7, height: PLAIN },
  { kind: 'flatten', at: [10, -8], radius: 6.5, falloff: 6, height: PLAIN + 1.4, lowerOnly: true },
  { kind: 'flatten', at: [2, -15], radius: 5, falloff: 5, height: PLAIN + 1.6, lowerOnly: true },
  // 2. the cone
  {
    kind: 'cone',
    at: [0, 0],
    radius: R,
    summit: 25.5,
    exponent: 1.25,
    craterRadius: CRATER_R,
    craterDepth: 6.5,
    rough: { amp: 0.55, scaleKm: 1.7, ridged: true },
    surface: 'rock',
  },
  // 3. the lower shoulder (west-south-west)
  { kind: 'cone', at: at(246, 12.5), radius: 7.5, summit: 8, exponent: 1.1, rough: { amp: 0.5, scaleKm: 1.8, ridged: true }, surface: 'rock' },
  // 4. radial ribs
  ...RIBS.map(([az, d0, d1, h, hw, curve]): LocalStamp => ({
    kind: 'ridge',
    path: [at(az, d0), at(az + curve * 0.4, (d0 + d1) * 0.45), at(az + curve, d1)],
    height: [h * 0.55, h, 0],
    halfWidth: hw,
    profile: 'sharp',
    surface: 'rock',
  })),
];

/** declared lights beyond the kit records (the kit records the crater, door and flow lights) */
const LIGHTS: LightDecl[] = [];

export default defineLandmark({
  id: 'mount-doom',
  placeId: 'mount-doom',
  tier: 'A',
  stamps: STAMPS,
  proxy: (k) => buildDoom(k),
  lights: LIGHTS,
  emitters: [
    { preset: 'smoke', at: [0, 1, 0], rate: 1, scale: 3 },
    { preset: 'ash', at: [0, 4, 0], rate: 0.6, scale: 6 },
    { preset: 'sparks', at: [0, 0.5, 0], rate: 0.4 },
  ],
  lookOverride: 'mordor',
  vegetationExclusion: 20,
  contrast: 'dark',
  annotation: { title: 'Mount Doom', subtitle: 'Orodruin, the Mountain of Fire', blurb: 'Where the One Ring was forged — and the only place it can be unmade.' },
  bookmarks: [
    {
      id: 'mount-doom-close',
      distanceKm: 52,
      elevationDeg: 0,
      azimuthDeg: 166,
      fov: 42,
      lift: 1,
      aimKm: [6, -6],
      tod: 18.5,
      compare: ['reference/film/mordor/mordor-barad-dur-and-doom-rotk.webp', 'reference/film/mount-doom/mount-doom-plume-lava-fotr.jpg', 'reference/photos/mount-doom/mount-ngauruhoe-cone.jpg'],
      note: 'low over the Gorgoroth ash plain from the south-south-east (backlit by the low sun in the west-north-west): the isolated cone with its glowing rim and flows, Barad-dûr on the horizon to the right (aimKm toward it); 52 km (shot-list heroKm 50: the cone rises ~22 above the plain — at 40 km it overfills the frame with no room for Barad-dûr)',
      // the probe's upper-body sample (90 % of the subject height on its axis) lies in the crater bowl,
      // ~2 below the rim — no camera low over the plain can see it; the target ground (losG −1.8), the
      // rim, the flows and the summit are in full view
      expect: { los: false },
    },
    {
      id: 'mount-doom-wide',
      distanceKm: 120,
      elevationDeg: 7,
      azimuthDeg: 165,
      fov: 35,
      lift: 0,
      aimKm: [10, 6],
      tod: 18.5,
      compare: ['reference/film/mordor/mordor-barad-dur-and-doom-rotk.webp', 'reference/concept-art/mordor/nasmith-across-gorgoroth.jpg'],
      note: 'Gorgoroth from the south-south-east: the lone cone on the ash plain, Barad-dûr on its Ered Lithui spur to the right with the plain between them, the Ash Mountains behind',
    },
  ],
});
