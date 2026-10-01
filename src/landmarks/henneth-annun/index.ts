import type { V2, V3 } from '../records.ts';
import type { ForestDecl, TreeDecl } from '../types.ts';
import { defineLandmark } from '../types.ts';

/**
 * Henneth Annûn, the Window on the West (research §7; the TTT waterfall still, Alan Lee's "Henneth Annûn"
 * and the Forbidden Pool): a west-facing wall of wet, dark slate-blue rock in the green woods of Ithilien,
 * bent round a deep alcove where the falls come down (the waterfall curtain is an S4 effect); the cave
 * mouth in the back of the alcove behind the falls, a still pool at its foot, moss and ferns on the
 * ledges and the rim, trees crowding above; two torches at the cave. Local frame: heading 0 (x east,
 * z south). The display point (places.json offset moved 1.2 km north of the S1 point so the shelf keeps
 * clear of the stream 3 km to the south-east).
 *
 * Stamps (relative to the base ground at the display point, on Ithilien's gently rolling slope ≈ 5 units
 * above the Anduin): a scarp raising the ground east of a U-bent face line by 2 into a wooded shelf that
 * fades back into the rising slope, and a bowl for the pool in the mouth of the U. The sheer faces are ONE
 * kit cliff along the foot of the scarp's face — the north arm, round the back of the alcove, the south
 * arm — so arms and back wall are one wet slate (the terrain face stays hidden behind it); its outer ends
 * taper into the slope, its crest rounds over the shelf's rim. The Ithilien forest is kept: only the pool
 * and the faces are cleared.
 */

/** the stamp's face line (north → south: the scarp raises its left = east side), bent into a U */
const SCARP: V2[] = [
  [-0.45, -1.85],
  [-0.15, -1.25],
  [0.0, -0.75],
  [0.35, -0.45],
  [0.5, 0.05],
  [0.35, 0.55],
  [0.0, 0.85],
  [-0.15, 1.3],
  [-0.42, 1.8],
];
/** the cliff along the foot of the face (walking south its face looks right = west, into the alcove) */
const CLIFF: V2[] = [
  [-1.3, -2.75],
  [-1.0, -2.25],
  [-0.62, -1.62],
  [-0.36, -1.08],
  [-0.2, -0.72],
  [0.02, -0.5],
  [0.2, -0.32],
  [0.28, 0.05],
  [0.2, 0.42],
  [0.02, 0.62],
  [-0.2, 0.82],
  [-0.36, 1.18],
  [-0.62, 1.72],
  [-0.98, 2.3],
  [-1.3, 2.8],
];
/** lower tier: face heights at the path points (to the ledge), falling to the buried outer ends */
const LOW_H = [0.8, 1.3, 1.5, 1.6, 1.65, 1.7, 1.75, 1.8, 1.75, 1.7, 1.65, 1.6, 1.5, 1.3, 0.8];
/** the upper tier stands this far back into the face; its crest reaches the shelf's rim + RIM_UP */
const SETBACK = 0.24;
const RIM_UP = 0.28;
/** the pool at the foot of the alcove */
const POOL_C: V2 = [-0.25, 0.05];
const POOL_R = 0.72;
/** pool floor / water level relative to the base ground at the display point */
const FLOOR_REL = -0.46;
const LEVEL_REL = -0.38;
/** the cave in the alcove's back wall */
const CAVE: V2 = [0.28, 0.05];
/** wet dark slate-blue (the looks.json spot paints the ground round it the same) */
const ROCK = 0x2b3440;
const ROCK_UP = 0x313a45;
const ROCK_DARK = 0x242b33;
const MOSS = [0x34522a, 0x2c4724, 0x3d5c2e];

const TREES: TreeDecl[] = (() => {
  const out: TreeDecl[] = [];
  // a few characterful trees by the pool and on the rim over the falls, irregularly placed (the woods
  // themselves are landmark forests and Ithilien's natural forest)
  const rim: [number, number, TreeDecl['kind'], number][] = [
    [0.92, -0.85, 'oak', 0.17],
    [1.12, 0.92, 'oak', 0.13],
    [0.78, -0.12, 'oak', 0.11],
    [1.3, 0.3, 'conifer', 0.08],
    [-1.02, -0.62, 'oak', 0.14],
    [-1.12, 0.78, 'oak', 0.16],
    [-0.42, -0.84, 'scrub', 0.07],
    [-0.36, 0.92, 'scrub', 0.08],
    [-0.98, 0.1, 'scrub', 0.06],
  ];
  for (const [x, z, kind, c] of rim) out.push({ at: [x, z], kind, crownKm: c, color: kind === 'conifer' ? 0x2c3b25 : kind === 'scrub' ? 0x3e5a2c : 0x3f5a2e });
  return out;
})();

/** Ithilien's greens (research §7: olive #51553b, #2a3122, #636a4e — here greener: the woods are lush) */
const OLIVE = [0x3f5a2c, 0x2e4424, 0x4a6232, 0x36502a];
const UNDER = [0x3a5629, 0x46612f, 0x324b25];
/**
 * The woods crowding the shelf above the falls and the slopes below the pool (placed by the vegetation
 * system with the natural forest): dense, clumped holm-oak-like broad crowns, a few cypress-like conifers
 * and an understory of scrub; the pool, the alcove and the rock faces stay clear. The shelf wood's
 * western edge wanders (a straight edge read as a hedge along the rim).
 */
const WOODS: ForestDecl[] = [
  {
    area: {
      polygon: [
        [0.75, -2.75],
        [2.9, -2.6],
        [3.0, 2.4],
        [0.7, 2.35],
        [0.95, 1.8],
        [0.62, 1.25],
        [0.9, 0.75],
        [0.78, 0.2],
        [1.0, -0.35],
        [0.7, -0.95],
        [0.95, -1.6],
        [0.62, -2.1],
      ],
    },
    density: 30,
    species: [
      { kind: 'oak', share: 0.62, crownKm: [0.11, 0.22], colors: OLIVE },
      { kind: 'conifer', share: 0.12, crownKm: [0.06, 0.1], heightFactor: [4.2, 5.2], colors: [0x2c3b25, 0x33432a] },
      { kind: 'scrub', share: 0.26, crownKm: [0.05, 0.09], colors: UNDER },
    ],
    clump: { scaleKm: 0.6, amount: 0.6 },
    edgeKm: 0.35,
    avoid: [{ at: [0.4, 0.05], r: 0.4 }],
  },
  {
    area: { annulus: { at: POOL_C, r0: 0.95, r1: 2.5 } },
    density: 24,
    species: [
      { kind: 'oak', share: 0.72, crownKm: [0.12, 0.21], colors: OLIVE },
      { kind: 'scrub', share: 0.28, crownKm: [0.05, 0.09], colors: UNDER },
    ],
    clump: { scaleKm: 0.7, amount: 0.55 },
    edgeKm: 0.3,
    // west of the faces only (the shelf has its own wood)
    avoid: [
      { at: [1.2, -1.4], r: 1.35 },
      { at: [1.2, 1.4], r: 1.35 },
      { at: [1.3, 0], r: 1.2 },
    ],
  },
];

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
      falloff: 1.8,
      // the face is rock (dark wet slate from the looks.json spot), the shelf above it grassed by the
      // terrain's slope rule
      surface: 'rock',
    },
    // the pool's bowl at the foot of the alcove
    { kind: 'flatten', at: POOL_C, radius: POOL_R, falloff: 0.35, height: FLOOR_REL, lowerOnly: true },
  ],
  // keep Ithilien's woods: clear only the pool and the faces
  vegetationExclusion: [
    { at: POOL_C, r: POOL_R + 0.12 },
    { at: [-0.25, -1.1], r: 0.55 },
    { at: [-0.25, 1.2], r: 0.55 },
  ],
  trees: TREES,
  forests: WOODS,
  proxy: (k) => {
    // ---- the wall of wet dark slate: one cliff along the foot of the scarp's face round the alcove,
    // smoothed (wet, water-worn rock, not folded paper), banded by horizontal strata and ledges, leaning
    // back a little; its outer ends taper into the slope, its body sinks into the shelf behind
    // two tiers: a lower wall to a mossy ledge, an upper wall set back into the face up to the rim (the
    // terrain face between them is the ledge, dark slate from the looks.json spot)
    const normals = CLIFF.map((_, i): V2 => {
      const a = CLIFF[Math.max(0, i - 1)];
      const b = CLIFF[Math.min(CLIFF.length - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      // the face looks right of the walking direction: (−dz, dx)
      return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
    });
    k.cliff('weathered', CLIFF, LOW_H, { depth: 0.6, rough: 0.45, strata: 0.9, soft: 0.75, overhang: 0.03, taper: 0.6, color: ROCK });
    const upper = CLIFF.map((p, i): V2 => [p[0] - normals[i][0] * SETBACK, p[1] - normals[i][1] * SETBACK]);
    const rim = (p: V2, n: V2) => Math.max(...[0.5, 0.8, 1.1].map((d) => k.ground(p[0] - n[0] * d, p[1] - n[1] * d)));
    const upH = upper.map((p, i) => Math.max(0.3, rim(p, normals[i]) + RIM_UP - k.ground(p[0], p[1])) * (i === 0 || i === upper.length - 1 ? 0.5 : 1));
    k.cliff('weathered', upper, upH, { depth: 0.7, rough: 0.4, strata: 0.9, soft: 0.75, overhang: 0.02, taper: 0.7, color: ROCK_UP });
    // ---- moss and ferns: leafy clumps on the ledge between the tiers and along the rim over the face
    CLIFF.forEach((p, i) => {
      if (i === 0 || i === CLIFF.length - 1) return;
      const [nx, nz] = normals[i];
      for (let j = 0; j < 3; j++) {
        const back = j < 2 ? 0.1 + 0.08 * k.r(500 + i * 4 + j) : SETBACK + 0.38 + 0.2 * k.r(500 + i * 4 + j);
        const side = (k.r(520 + i * 4 + j) - 0.5) * 0.34;
        k.rock('foliage', 0.05 + 0.05 * k.r(540 + i * 4 + j), { at: [p[0] - nx * back - nz * side, 0, p[1] - nz * back + nx * side], seat: true, leafy: true, detail: 1, color: MOSS[(i + j) % MOSS.length], lod: 0 });
      }
    });
    // ---- the cave mouth behind the falls: a dark, round-headed recess in the alcove's back wall, its front
    // plane just in front of the rock face (the cliff's face leans back ≈ 0.07 at mid height), its body deep
    // in the rock. Euler XYZ turns z first: (cos a, 0, sin a) → (0, sin a, −cos a) — a half-disc standing
    // in the face, the lathe axis → −x
    const floorY = k.ground(CAVE[0] - 0.15, CAVE[1]);
    const r = 0.27;
    const front = CAVE[0] - 0.06;
    k.lathe(
      'darkStone',
      [
        [0, 0],
        [r, 0],
        [r, 0.5],
        [0, 0.5],
        [0, 0],
      ],
      { at: [front + 0.5, floorY + 0.16, CAVE[1]], rot: [-90, 0, 90], seg: 8, arcDeg: 180, color: 0x0b0e12 },
    );
    k.box('darkStone', 0.5, 0.2, 0.54, { at: [front + 0.25, floorY - 0.04, CAVE[1]], color: 0x0b0e12 });
    for (const s of [-1, 1]) k.rock('weathered', 0.08, { at: [front - 0.06, 0, CAVE[1] + s * 0.33], seat: true, squash: 0.7, lump: 0.3, detail: 1, color: ROCK_DARK, lod: 0 });
    // stepping stones and boulders round the pool and at the feet of the walls
    k.scatter({ annulus: { at: POOL_C, r0: POOL_R - 0.12, r1: POOL_R + 0.1, a0: 190, a1: 350 } }, 9, (_i, x, z, u) => k.rock('weathered', 0.04 + 0.04 * u, { at: [x, 0, z], seat: true, squash: 0.6, lump: 0.35, detail: 1, color: ROCK_DARK, lod: 0 }), { minSpacing: 0.14 });
    // ---- two torches at the cave mouth (the Rangers' refuge)
    for (const s of [-1, 1]) k.light([front - 0.03, floorY + 0.14, CAVE[1] + s * 0.29] as V3, { color: 0xffa24a, intensity: 2, radius: 0.022, kind: 'fire' });
  },
  waterFeatures: [
    // the pool. Its level is relative to the landmark origin, whose local y = 0 is the COMPOSITE ground at
    // the display point — inside the bowl's full-weight radius (the origin lies 0.25 km from POOL_C, the
    // bowl is POOL_R = 0.72 wide), so y = 0 is the pool floor and the water stands LEVEL_REL − FLOOR_REL
    // above it. Moving POOL_C or shrinking the bowl past the origin breaks this. The ring reaches past the
    // bowl's flat floor into its falloff; the terrain occludes the water beyond the shore.
    {
      kind: 'pool',
      ring: Array.from({ length: 20 }, (_, j): V2 => [POOL_C[0] + Math.cos((j / 20) * Math.PI * 2) * (POOL_R + 0.14), POOL_C[1] + Math.sin((j / 20) * Math.PI * 2) * (POOL_R + 0.14)]),
      level: LEVEL_REL - FLOOR_REL,
    },
    // the falls over the cave (S4 effect): from the rim down the alcove's back wall into the pool
    { kind: 'waterfall', path: [[0.7, 2.05, 0.05], [0.42, 1.2, 0.05], [0.2, 0.05, 0.05]], width: 0.36 },
  ],
  annotation: { title: 'Henneth Annûn', subtitle: 'The Window on the West', blurb: 'Hidden refuge of the Rangers of Ithilien behind a curtain of falling water.' },
  bookmarks: [
    {
      id: 'henneth-annun-close',
      distanceKm: 25,
      elevationDeg: 9,
      azimuthDeg: 288,
      fov: 18,
      lift: 2.5,
      aimKm: [0.3, 0],
      tod: 16.0,
      note: 'afternoon from the west-north-west, low over the woods: the dark wet wall bent round the alcove, the cave mouth over the pool, the woods of Ithilien in front and crowding the rim; the sun in the west-south-west lights the faces from the left',
    },
  ],
});
