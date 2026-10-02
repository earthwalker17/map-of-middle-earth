import type { LightDecl, LocalStamp, V3 } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { buildDoom, CRATER_R } from './parts.ts';

/**
 * Orodruin, Mount Doom (research §15, §13): an ISOLATED, near-symmetric volcanic cone (the film's
 * Ngauruhoe, the RotK composite) rising from the flat ash plain of Gorgoroth — broad and concave, steep
 * under the crater and flaring out into the plain (base ≈ 3× its height) — with radial gullies, one lower
 * shoulder, a crater whose rim glows, a few lava flows down the gullies, and the Sammath Naur door high on
 * the east flank (facing Barad-dûr) reached by a winding path.
 *
 * Local frame (heading 0): x east, z south; the origin is the DEM peak (places.json, src D). Heights are
 * relative to the base ground there. The baked ground is a plain at −1…−2.5 to the west and south with a
 * few low hills, but the Gorgoroth plateau reaches within ~8 km on the north-east (+10…+13).
 *
 * Stamps, in order (landmarks apply in id order, so Barad-dûr's mount is already in place; the cone's
 * foot fades out a few km short of its mount):
 *  1. the Gorgoroth floor: a level ash plain (−0.6 — the cone's foot ends at 0, so a lower plain would
 *     leave a step round the foot) ~50 km across round the cone, and lowerOnly cuts of the plateau hump
 *     to the north-east and north, so a plain runs out toward Barad-dûr (27, −18) and rises to its spur
 *     only beyond ~24 km — the two stand apart;
 *  2. the cone: a radially symmetric `cone` (radius 28, summit +22.5, profile tᵉ with e = 1.8 — in this
 *     stamp e > 1 is CONCAVE: ~50° under the rim, ~45° at mid-flank, ~28° → 17° on the lower flank,
 *     flaring to nothing at the foot; base ≈ 2.9× the height) to a crater rim ≈ +19 with a ~3-deep bowl,
 *     light ridged roughness;
 *  3. the lower shoulder: an old parasitic cone on the west-south-west flank (the film's long left flank);
 *  4. radial ribs: 15 thin `ridge` stamps from just below the rim down to the lower flank, slightly
 *     curved and uneven — the V gullies between them are Ngauruhoe's radial gully pattern (≥ 1 km wide at
 *     the 0.4 km heightfield); the lava flows (parts.ts) follow them.
 */

/** the Gorgoroth plain the cone rises from (rel. the base ground at the origin) */
const PLAIN = -0.6;
const R = 28;
const DEG = Math.PI / 180;
const at = (az: number, d: number): [number, number] => [Math.sin(az * DEG) * d, -Math.cos(az * DEG) * d];

/** radial ribs: [azimuth, start km, end km, crest height, half-width, curve deg] (irregular on purpose) */
const RIBS: [number, number, number, number, number, number][] = [
  [8, 4.0, 19.2, 1.6, 1.2, 6],
  [31, 4.5, 16.0, 1.3, 1.1, -5],
  [55, 3.9, 20.4, 1.8, 1.3, 4],
  [80, 4.7, 16.5, 1.4, 1.1, -7],
  [103, 4.0, 21.5, 1.9, 1.35, 5],
  [127, 4.4, 18.2, 1.5, 1.2, -4],
  [150, 3.9, 19.8, 1.7, 1.25, 7],
  [172, 4.8, 17.6, 1.3, 1.1, -6],
  [194, 4.1, 22.0, 1.9, 1.35, 4],
  [218, 4.5, 18.2, 1.4, 1.15, -5],
  [266, 4.2, 19.2, 1.6, 1.2, -6],
  [289, 4.7, 16.5, 1.3, 1.1, 5],
  [311, 3.9, 20.4, 1.8, 1.3, -4],
  [334, 4.4, 18.2, 1.5, 1.2, 6],
  [355, 5.0, 15.4, 1.2, 1.05, -3],
];

const STAMPS: LocalStamp[] = [
  // 1. the Gorgoroth floor
  { kind: 'flatten', at: [-3, 4], radius: 18, falloff: 9, height: PLAIN },
  { kind: 'flatten', at: [10, -8], radius: 6.5, falloff: 6, height: 0.2, lowerOnly: true },
  { kind: 'flatten', at: [2, -15], radius: 5, falloff: 5, height: 0.4, lowerOnly: true },
  // 2. the cone
  {
    kind: 'cone',
    at: [0, 0],
    radius: R,
    summit: 22.5,
    exponent: 1.8,
    craterRadius: CRATER_R,
    craterDepth: 6,
    rough: { amp: 0.6, scaleKm: 1.7, ridged: true },
    surface: 'rock',
  },
  // 3. the lower shoulder (west-south-west)
  { kind: 'cone', at: at(246, 15), radius: 7, summit: 8.5, exponent: 1.1, rough: { amp: 0.5, scaleKm: 1.8, ridged: true }, surface: 'rock' },
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

/**
 * Low ash sheets over the Gorgoroth foreground (S4 W3-E, C1 note): in the dark dusk plates they hardly
 * read yet (pale billboards against the black plain at 30–50 km) — switch for the main agent's review.
 */
const ASH_SHEETS = true;

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
    // low ash sheets drifting over the Gorgoroth plain (≈ 2 km over the floor at rel −16) south of the cone,
    // across the hero cameras' foreground (ASH_SHEETS)
    ...(ASH_SHEETS
      ? [
          { preset: 'ash' as const, at: [-12, -14, 27] as V3, to: [14, -13.6, 31] as V3, rate: 2.2, scale: 5, color: 0xd0cac2 },
          { preset: 'ash' as const, at: [-8, -13.4, 17] as V3, to: [18, -13, 20] as V3, rate: 1.8, scale: 5, color: 0xd0cac2 },
        ]
      : []),
  ],
  lookOverride: 'mordor',
  vegetationExclusion: 20,
  contrast: 'dark',
  annotation: { title: 'Mount Doom', subtitle: 'Orodruin, the Mountain of Fire', blurb: 'Where the One Ring was forged — and the only place it can be unmade.' },
  bookmarks: [
    {
      id: 'mount-doom-close',
      distanceKm: 56,
      elevationDeg: 1,
      azimuthDeg: 166,
      fov: 46,
      lift: 1,
      aimKm: [10, -6],
      tod: 18.5,
      compare: ['reference/film/mordor/mordor-barad-dur-and-doom-rotk.webp', 'reference/film/mount-doom/mount-doom-plume-lava-fotr.jpg', 'reference/photos/mount-doom/mount-ngauruhoe-cone.jpg'],
      note: 'low over the Gorgoroth ash plain from the south-south-east (backlit by the low sun in the west-north-west): the broad concave cone with its glowing rim and flows, Barad-dûr on the horizon to the right with headroom over its horns (aimKm toward it, on the plain beyond the foot of the cone so the camera stays low); 56 km (shot-list heroKm 50)',
      // the probe's upper-body sample (90 % of the subject height on its axis) lies in the crater bowl,
      // ~3 below the rim — no camera low over the plain can see it; the target ground, the rim, the
      // flows and the summit are in full view
      expect: { los: false },
    },
    {
      id: 'mount-doom-wide',
      distanceKm: 120,
      elevationDeg: 5,
      azimuthDeg: 165,
      fov: 33,
      lift: 0,
      aimKm: [10, 6],
      tod: 18.5,
      compare: ['reference/film/mordor/mordor-barad-dur-and-doom-rotk.webp', 'reference/concept-art/mordor/nasmith-across-gorgoroth.jpg'],
      note: 'Gorgoroth from the south-south-east: the lone cone on the ash plain, Barad-dûr on its Ered Lithui spur to the right with the plain between them, the Ash Mountains behind',
    },
  ],
});
