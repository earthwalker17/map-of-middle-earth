import type { V2 } from '../records.ts';
import { defineLandmark } from '../types.ts';
import { buildDoors, DOOR, ITHILDIN_LIGHTS } from './doors.ts';

/**
 * The West-gate of Moria (research §6): a sheer dark cliff rising straight out of a still black pool —
 * the dammed Sirannon — in a recess of the mountain wall, a narrow shelf path along its foot, two hollies
 * marking the doors, and the Doors of Durin themselves: invisible by day, silver ithildin lines (arch on
 * pillars, crown and seven stars, the Star of Fëanor) under the moon.
 *
 * Local frame (heading 270: local −Z faces WEST): local +x = north, −x = south, +z = east (into the
 * mountain). The display point (places.json offset 0.7 km east of the canon point) is the door sill at
 * the cliff foot, in the mouth of a ravine that climbs north-east between the massive southern shoulder
 * (x < −1.5, 4–6 units) and a lower northern ridge (x > 2.5). The baked Lake of Moria lies 1.0–1.8 km
 * west of the door (level −0.70 below the base ground here); the river guard keeps it and a 0.4 km shore
 * ring round it at their baked heights (up to −0.47), so the landmark pool stands a little higher
 * (−0.38) and drowns both: one still sheet of water from the cliff foot to the dam.
 *
 * Stamps (heights relative to the base ground at the display point): the pool bowl cut down below the
 * water (lowerOnly flattens: the baked lake bed stays), a dam across the Sirannon's valley on the
 * south-west, the western rim cut to a low sill (the view from the west runs across the water), the
 * mountain wall behind the cliff line (a scarp, ~75° over 1 km: the upper face is terrain rock), the door
 * sill and two holly knolls just above the water. The sheer lower face rising from the water is kit
 * `cliff` geometry seated on the pool bed.
 */

/** water and sill heights relative to the base ground at the display point */
const LEVEL_REL = -0.38;
const SILL_REL = -0.28;
/** pool level in local y (local y = 0 is the sill: the composite ground at the display point) */
export const POOL_LEVEL = LEVEL_REL - SILL_REL;

/**
 * The lower cliff's face line, walking from the northern ridge to the southern shoulder so the face looks
 * right of the walking direction (toward the pool): the long west-facing wall across the recess with the
 * doors at its deepest point, bending round the pool's corners into the ridge and the shoulder.
 * `top`: the crest (local y) at each point; where the natural slopes stand higher the rock sinks into them.
 */
const FACE: { at: V2; top: number }[] = [
  { at: [2.7, -0.62], top: 1.7 },
  { at: [2.2, -0.24], top: 2.0 },
  { at: [1.3, 0.1], top: 2.2 },
  { at: [0.4, 0.2], top: 2.3 },
  { at: [-0.5, 0.2], top: 2.3 },
  { at: [-1.4, 0.05], top: 2.4 },
  { at: [-2.1, -0.45], top: 2.5 },
  { at: [-2.5, -1.05], top: 2.4 },
];
/** cliff rock: blue-grey (the moonlit film still: #1b282b darks, #5f7784 highlights) */
const ROCK = 0x5a6167;
/** dressed rock of the door wall: the same stone, smoothed */
const WALL = 0x687176;

/** pool outline: the bowl in front of the cliff (the waterline is where the ground rises above the water) */
const POOL: V2[] = [
  [3.0, -0.3],
  [3.3, -1.5],
  [3.3, -2.7],
  [2.4, -3.6],
  [1.2, -3.75],
  [0.4, -3.82],
  [-0.4, -3.72],
  [-1.4, -3.28],
  [-2.2, -2.62],
  [-2.8, -1.6],
  [-2.5, -0.2],
  [-1.4, 0.3],
  [0, 0.3],
  [1.5, 0.3],
];

/** the hollies' knolls at the cliff foot either side of the doors */
const HOLLY: V2[] = [
  [DOOR.x + 0.95, -0.14],
  [DOOR.x - 0.95, -0.12],
];

export default defineLandmark({
  id: 'moria',
  placeId: 'moria',
  tier: 'A',
  headingDeg: 270,
  stamps: [
    // the pool bowl: the southern shoulder's west foot, the knoll to the north-west and the ravine floor in
    // front of the door cut down below the water
    { kind: 'flatten', at: [-1.0, -2.0], radius: 1.2, falloff: 0.8, height: -0.8, lowerOnly: true },
    { kind: 'flatten', at: [1.5, -1.95], radius: 1.35, falloff: 0.8, height: -0.8, lowerOnly: true },
    { kind: 'flatten', at: [0.4, -0.55], radius: 0.8, falloff: 0.5, height: -0.75, lowerOnly: true },
    // the western rim levelled to a low sill just above the water (the view from the west runs across it)
    { kind: 'flatten', at: [1.0, -4.45], radius: 1.1, falloff: 0.5, height: LEVEL_REL + 0.16 },
    { kind: 'flatten', at: [-0.5, -4.15], radius: 0.6, falloff: 0.4, height: LEVEL_REL + 0.16 },
    // the dam across the Sirannon's valley on the south-west (the pool spills over it in the tale)
    {
      kind: 'ridge',
      path: [
        [-3.1, -1.8],
        [-2.4, -2.8],
        [-1.5, -3.45],
        [-0.9, -3.75],
      ],
      height: [0.8, 1.6, 1.8, 0.6],
      halfWidth: 0.8,
      profile: 'round',
      surface: 'rock',
    },
    // the mountain wall behind the cliff line (raises the east side, +z): the upper face over the kit cliff
    {
      kind: 'scarp',
      path: [
        [-3.4, 0.75],
        [-1.6, 0.25],
        [0, 0.16],
        [1.6, 0.2],
        [3.2, 0.42],
        [4.5, 1.0],
      ],
      side: 'right',
      height: 3.6,
      run: 0.95,
      plateauKm: 1.2,
      falloff: 1.8,
      rough: { amp: 0.35, scaleKm: 2.4 },
      surface: 'rock',
    },
    // the door sill and the hollies' knolls, a step above the water
    { kind: 'flatten', at: [0, 0], radius: 0.3, falloff: 0.2, height: SILL_REL },
    ...HOLLY.map((at) => ({ kind: 'flatten' as const, at, radius: 0.2, falloff: 0.2, height: LEVEL_REL + 0.08 })),
  ],
  vegetationExclusion: [{ at: [0.2, -1.8], r: 3.3 }],
  trees: [
    // the two hollies flanking the doors (the Elves' tokens), dark, tall and narrow
    { at: HOLLY[0], kind: 'holly', crownKm: 0.3, heightKm: 1.55, yawDeg: 20 },
    { at: HOLLY[1], kind: 'holly', crownKm: 0.31, heightKm: 1.6, yawDeg: 200 },
  ],
  waterFeatures: [{ kind: 'pool', ring: POOL, level: POOL_LEVEL }],
  lights: ITHILDIN_LIGHTS,
  proxy: (k) => {
    // ---- the sheer lower cliff rising from the water; the scarp stamp carries the wall on above it
    const hs = FACE.map(({ at: [x, z], top }) => Math.min(2.8, Math.max(0.4, top + 0.2 - k.ground(x, z))));
    k.cliff(
      'weathered',
      FACE.map((f) => f.at),
      hs,
      { color: ROCK, rough: 0.45, strata: 0.45, depth: 1.0, overhang: -0.02, soft: 0.3, taper: 0.6 },
    );
    // ---- the door wall with the Doors of Durin
    buildDoors(k, WALL, POOL_LEVEL);
    // ---- the shelf path along the foot of the cliff: a narrow ledge of dressed stone just above the water
    // (only where the foot is at the water; elsewhere the ground itself is the path)
    const shelf: V2[] = [
      [2.1, -0.2],
      [1.3, -0.02],
      [0.5, 0.05],
      [-0.5, 0.05],
      [-1.3, -0.09],
      [-1.8, -0.4],
    ];
    for (let i = 0; i + 1 < shelf.length; i++) {
      const a = shelf[i];
      const b = shelf[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const yaw = (-Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      const g = Math.max(k.ground(a[0], a[1]), k.ground(b[0], b[1]), k.ground(mx, mz));
      if (g > POOL_LEVEL + 0.12) continue;
      // the ledge top just above the water, its body reaching down into the pool bed
      const top = Math.max(POOL_LEVEL + 0.035, g + 0.012);
      k.box('weathered', len + 0.02, 0.4, 0.1, { at: [mx, top - 0.4, mz], rot: [0, yaw, 0], color: 0x646c6c, lod: 0 });
    }
    // ---- fallen blocks at the ends of the face, where it meets the shoulders
    k.scatter(
      { polygon: [[2.6, -0.5], [3.1, -1.3], [2.8, -1.7], [2.3, -0.9]] },
      6,
      (_i, x, z, u) => k.rock('weathered', 0.05 + u * 0.05, { at: [x, 0, z], seat: true, squash: 0.7, lump: 0.3, detail: 1, color: 0x59625f, lod: 0 }),
      { minSpacing: 0.15 },
    );
    k.scatter(
      { polygon: [[-1.8, -0.6], [-2.4, -1.3], [-2.1, -1.7], [-1.5, -1.0]] },
      6,
      (_i, x, z, u) => k.rock('weathered', 0.05 + u * 0.05, { at: [x, 0, z], seat: true, squash: 0.7, lump: 0.3, detail: 1, color: 0x59625f, lod: 0 }),
      { minSpacing: 0.15 },
    );
    // ---- the dry bed of the Sirannon below the dam (pale water-worn boulders) and the stair of the old
    // falls climbing beside it
    const bed: V2[] = [
      [-1.9, -3.5],
      [-2.2, -4.1],
      [-2.5, -4.7],
      [-2.9, -5.3],
      [-3.4, -5.9],
    ];
    bed.forEach(([x, z], i) => {
      for (let j = 0; j < 3; j++) {
        const ox = (k.r(1) - 0.5) * 0.25;
        const oz = (k.r(2) - 0.5) * 0.3;
        k.rock('weathered', 0.035 + k.r(3) * 0.03, { at: [x + ox, 0, z + oz], seat: true, squash: 0.6, detail: 1, color: i % 2 ? 0x8a8a80 : 0x7c7d74, lod: 0 });
      }
    });
    k.stairs(
      'weathered',
      [
        [-1.2, Number.NaN, -3.9],
        [-1.5, Number.NaN, -4.5],
        [-1.9, Number.NaN, -5.1],
        [-2.4, Number.NaN, -5.7],
      ],
      0.07,
      { stepKm: 0.04, color: 0x767c76 },
    );
  },
  annotation: { title: 'Moria', subtitle: 'The Doors of Durin', blurb: 'Speak, friend, and enter — the hidden West-gate of Khazad-dûm, greatest of the Dwarf-halls.' },
  bookmarks: [
    {
      id: 'moria-close',
      distanceKm: 11,
      elevationDeg: 7,
      azimuthDeg: 270,
      fov: 35,
      lift: 1.1,
      tod: 22.5,
      dayOfYear: 19,
      compare: ['reference/film/moria/moria-west-gate-night-fotr.webp', 'reference/concept-art/moria/moria-gate-john-howe.jpg', 'reference/bigatures/moria/moria-gates-weta-mini.png'],
      note: 'moonlit mid-January night (13 January: the Fellowship at the gate; waxing gibbous moon 45° up in the WSW behind the camera, deep night: ithildin fully awake), low over the still black pool to the sheer cliff; the doors glow between the hollies, Caradhras above',
    },
    {
      id: 'moria-wide',
      distanceKm: 60,
      elevationDeg: 10,
      azimuthDeg: 245,
      fov: 35,
      lift: 3,
      tod: 22.5,
      dayOfYear: 19,
      compare: ['reference/concept-art/moria/moria-west-gate-alan-lee.jpg', 'reference/film/caradhras'],
      note: 'the West-gate at the foot of the Misty Mountains under the moon, Caradhras above it (Isengard far behind the camera)',
    },
  ],
});
