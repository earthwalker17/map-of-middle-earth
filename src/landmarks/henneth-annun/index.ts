import type { V2, V3 } from '../records.ts';
import type { TreeDecl } from '../types.ts';
import { defineLandmark } from '../types.ts';

/**
 * Henneth Annûn, the Window on the West (research §7; the TTT waterfall still, Alan Lee's "Henneth Annûn"
 * and the Forbidden Pool): a west-facing wall of wet, dark slate-blue rock in the green woods of Ithilien,
 * bent round an alcove where the falls come down (the waterfall curtain is an S4 effect); the cave mouth in
 * the back of the alcove behind the falls, a still pool at its foot, ferns and trees crowding the rim; two
 * torches at the cave. Local frame: heading 0 (x east, z south). The display point (places.json offset
 * moved 1.2 km north of the S1 point so the shelf keeps clear of the stream 3 km to the south-east).
 *
 * Stamps (relative to the base ground at the display point, on Ithilien's gently rolling slope ≈ 5 units
 * above the Anduin): a scarp raising the ground east of a bent face line by 2 into a wooded shelf that
 * fades back into the rising slope (turf: the green woods run up to the rim), and a bowl for the pool.
 * The sheer faces are kit cliff standing just in front of the stamp's face (so the terrain never shows
 * through the rock): two arms either side of the alcove; the alcove's back wall is the scarp itself,
 * with the cave set into it. The Ithilien forest is kept: only the pool and the faces are cleared.
 */

/** the stamp's face line (north → south: the scarp raises its left = east side) */
const SCARP: V2[] = [
  [-0.45, -2.1],
  [0.08, -1.05],
  [0.3, -0.35],
  [0.3, 0.45],
  [0.08, 1.15],
  [-0.4, 1.95],
];
/** the kit cliff arms either side of the alcove (walking south: their faces look right = west) */
const ARM_N: V2[] = [
  [-0.95, -2.35],
  [-0.55, -1.6],
  [-0.2, -1.05],
  [0.02, -0.45],
  [0.14, -0.18],
];
const ARM_S: V2[] = [
  [0.14, 0.28],
  [0.02, 0.55],
  [-0.2, 1.15],
  [-0.5, 1.75],
  [-0.9, 2.3],
];
/** the pool at the foot of the alcove */
const POOL_C: V2 = [-0.3, 0.05];
/** pool floor / water level relative to the base ground at the display point */
const FLOOR_REL = -0.46;
const LEVEL_REL = -0.38;
/** the cave in the alcove's back wall (the scarp's face) */
const CAVE: V2 = [0.3, 0.05];
const ROCK = 0x37414c;
const ROCK_DARK = 0x2e363f;

const TREES: TreeDecl[] = (() => {
  const out: TreeDecl[] = [];
  // a few characterful trees on the rim over the falls and round the pool (the woods themselves are
  // Ithilien's natural forest)
  const rim: [number, number, TreeDecl['kind'], number][] = [
    [0.9, -0.8, 'oak', 0.16],
    [0.95, 0.85, 'oak', 0.14],
    [1.05, -0.3, 'conifer', 0.09],
    [1.0, 0.45, 'conifer', 0.08],
    [-0.95, -0.55, 'oak', 0.13],
    [-1.0, 0.7, 'oak', 0.15],
    [-0.3, -0.62, 'scrub', 0.07],
    [-0.25, 0.72, 'scrub', 0.07],
    [-0.75, 0.15, 'scrub', 0.06],
  ];
  for (const [x, z, kind, c] of rim) out.push({ at: [x, z], kind, crownKm: c, color: kind === 'conifer' ? 0x2c3b25 : kind === 'scrub' ? 0x3e5a2c : 0x3f5a2e });
  return out;
})();

export default defineLandmark({
  id: 'henneth-annun',
  placeId: 'henneth-annun',
  tier: 'B',
  stamps: [
    {
      kind: 'scarp',
      path: SCARP,
      side: 'left',
      height: 2.0,
      run: 0.5,
      plateauKm: 0.9,
      falloff: 2.4,
      // the face is rock (dark wet slate from the looks.json spot), the shelf above it grassed by the
      // terrain's slope rule
      surface: 'rock',
    },
    // the pool's bowl at the foot of the alcove
    { kind: 'flatten', at: POOL_C, radius: 0.45, falloff: 0.35, height: FLOOR_REL, lowerOnly: true },
  ],
  // keep Ithilien's woods: clear only the pool and the faces
  vegetationExclusion: [
    { at: POOL_C, r: 0.55 },
    { at: [0.1, -1.0], r: 0.55 },
    { at: [0.1, 1.1], r: 0.55 },
  ],
  trees: TREES,
  proxy: (k) => {
    // ---- the two arms of wet, dark slate-blue rock, a little taller than the shelf behind them (their
    // crests round over its rim, their bodies sink into it; the outer ends taper into the slope)
    const cliff = { depth: 0.7, rough: 0.45, strata: 0.6, soft: 0.45, overhang: 0.04, color: ROCK };
    k.cliff('weathered', ARM_N, [0.9, 1.5, 1.95, 2.1, 2.2], { ...cliff, taper: 0.22 });
    k.cliff('weathered', ARM_S, [2.2, 2.1, 1.95, 1.5, 0.9], { ...cliff, taper: 0.22 });
    // ---- the cave mouth behind the falls: a dark, round-headed recess in the alcove's back wall (the
    // scarp's rock). Its front plane goes where the terrain face (sampled here, as rendered) reaches the
    // mouth's mid height, just proud of it; its body deep in the rock. Euler XYZ turns z first:
    // (cos a, 0, sin a) → (0, sin a, −cos a) — a half-disc standing in the face, the lathe axis → −x
    const faceY = k.ground(CAVE[0] - 0.3, CAVE[1]);
    const r = 0.17;
    let front = CAVE[0] - 0.3;
    while (front < CAVE[0] + 0.6 && k.ground(front, CAVE[1]) < faceY + 0.2) front += 0.01;
    front -= 0.025;
    k.lathe(
      'darkStone',
      [
        [0, 0],
        [r, 0],
        [r, 0.35],
        [0, 0.35],
        [0, 0],
      ],
      { at: [front + 0.35, faceY + 0.12, CAVE[1]], rot: [-90, 0, 90], seg: 8, arcDeg: 180, color: 0x0e1216 },
    );
    k.box('darkStone', 0.35, 0.16, 0.34, { at: [front + 0.175, faceY - 0.04, CAVE[1]], color: 0x0e1216 });
    for (const s of [-1, 1]) k.rock('weathered', 0.06, { at: [front - 0.05, 0, CAVE[1] + s * 0.22], seat: true, squash: 0.7, lump: 0.3, detail: 1, color: ROCK_DARK, lod: 0 });
    // stepping stones and boulders round the pool and at the feet of the arms
    k.scatter({ annulus: { at: POOL_C, r0: 0.34, r1: 0.52, a0: 190, a1: 350 } }, 7, (_i, x, z, u) => k.rock('weathered', 0.035 + 0.035 * u, { at: [x, 0, z], seat: true, squash: 0.6, lump: 0.35, detail: 1, color: ROCK_DARK, lod: 0 }), { minSpacing: 0.12 });
    // ---- two torches at the cave mouth (the Rangers' refuge)
    for (const s of [-1, 1]) k.light([front - 0.02, faceY + 0.1, CAVE[1] + s * 0.19] as V3, { color: 0xffa24a, intensity: 2, radius: 0.02, kind: 'fire' });
  },
  waterFeatures: [
    // the pool: its level relative to the origin (local y = 0 is the ground at the display point)
    {
      kind: 'pool',
      ring: Array.from({ length: 16 }, (_, j): V2 => [POOL_C[0] + Math.cos((j / 16) * Math.PI * 2) * 0.5, POOL_C[1] + Math.sin((j / 16) * Math.PI * 2) * 0.5]),
      level: LEVEL_REL - FLOOR_REL,
    },
    // the falls over the cave (S4 effect): from the rim down the alcove's back wall into the pool
    { kind: 'waterfall', path: [[0.75, 2.05, 0.05], [0.4, 1.2, 0.05], [0.12, 0.05, 0.05]], width: 0.32 },
  ],
  annotation: { title: 'Henneth Annûn', subtitle: 'The Window on the West', blurb: 'Hidden refuge of the Rangers of Ithilien behind a curtain of falling water.' },
  bookmarks: [
    {
      id: 'henneth-annun-close',
      distanceKm: 21,
      elevationDeg: 18,
      azimuthDeg: 290,
      fov: 24,
      lift: 0.6,
      aimKm: [0.1, 0],
      tod: 16.0,
      note: 'afternoon from the west-north-west: the dark rock walls bent round the alcove, the cave mouth over the pool, the woods of Ithilien crowding the rim; the sun in the west-south-west lights the faces from the left',
    },
  ],
});
