import type { V2 } from '../records.ts';
import { defineLandmark } from '../types.ts';
import { archBridge, brokenDome, brokenTower, ruinCorner, ruinHall, STONE, STONE_DARK } from './ruins.ts';

/**
 * Osgiliath, the ruined Citadel of the Stars (research §8; the TTT stills — broken towers, roofless halls,
 * round-arched arcades, broken domes, rubble slopes, the partly collapsed bridge; Alan Lee's "Window on the
 * West" era ruins): a ruined city of pale limestone on BOTH banks of the Anduin, dense and tall, its
 * skyline full of gaps, carried down to the water on quay walls at both bridgeheads and joined by a long
 * multi-arched bridge whose middle spans have fallen into the river. The ground under it is pale rubble and
 * dusty paving (looks.json ground spots); heavy grey haze (looks spot) so depth falls off fast. Six Orc
 * campfires (dusk-gated).
 *
 * Local frame: heading 0 (x east, z south). The display point lies in the Anduin's channel (≈ 5.2 km wide
 * here, water ≈ 0.3 above the origin ground; its ribbon — where the river guard keeps the banks — reaches
 * ≈ 3.6 km either side of the centreline at x ≈ −0.3); the banks rise from the water's edge (x ≈ −2.8 and
 * 2.35) to the city's terrace (≈ 0.7) by x ≈ −3.6 and 3.0. The Morgulduin joins from the east ≈ 5 km south.
 *
 * Stamps (relative to the base ground at the display point): the city's level floodplain on both banks —
 * the valley walls are cut down to a terrace at the Anduin's level + 0.4 (lowerOnly: the channel and the
 * floodplain below the terrace are never raised), easing back into the walls; the steep western wall
 * (Minas Tirith's side) is cut back further so the west bank carries its half of the city; the steep
 * eastern wall likewise, kept north of the Morgulduin.
 */

/** the river's centreline x (the snapped Anduin, local) and the ribbon half width, km */
const RIVER_X = (z: number): number => -0.3 + 0.1 * Math.max(0, z - 1.5);
const RIBBON = 3.65;
/** deck height of the bridge above the origin ground (the water ≈ 0.3, the banks ≈ 0.7) */
const BANK_Y = 0.72;

/** the two banks' building zones (local polygons), reaching the quays at the bridgeheads */
const EAST: V2[] = [
  [3.3, -3.8],
  [5.9, -3.8],
  [6.3, -2.2],
  [6.1, 1.3],
  [5.6, 2.5],
  [4.2, 3.0],
  [3.2, 2.5],
  [2.6, 1.8],
  [2.55, -1.8],
  [3.1, -2.6],
];
const WEST: V2[] = [
  [-3.6, -3.9],
  [-6.3, -4.0],
  [-6.8, 0.2],
  [-6.5, 3.9],
  [-4.4, 4.0],
  [-3.6, 2.6],
  [-3.0, 1.8],
  [-2.95, -1.8],
];
/** quay walls at the bridgeheads: the embankment between the water's edge and the terrace */
const QUAYS: V2[][] = [
  [
    [2.45, -1.9],
    [2.62, -1.9],
    [2.62, 1.9],
    [2.45, 1.9],
  ],
  [
    [-3.12, -1.9],
    [-2.95, -1.9],
    [-2.95, 1.9],
    [-3.12, 1.9],
  ],
];

/** key ruins placed by hand: the bridgeheads' gate towers, the great domes, the tallest towers */
const EAST_KEYS = {
  gate: [
    [3.95, -0.4],
    [3.95, 0.4],
  ] as V2[],
  dome: [4.85, -1.15] as V2,
  tall: [5.3, 1.35] as V2,
};
const WEST_KEYS = {
  gate: [
    [-4.5, -0.42],
    [-4.5, 0.42],
  ] as V2[],
  dome: [-5.4, 1.0] as V2,
  tall: [-5.05, -1.6] as V2,
};

/** the six campfires (local x, z) — in open ground among the ruins */
const FIRES: V2[] = [
  [4.5, 0.55],
  [5.6, -2.6],
  [4.6, 2.5],
  [-4.9, 0.45],
  [-5.9, -3.1],
  [-5.2, 2.9],
];

export default defineLandmark({
  id: 'osgiliath',
  placeId: 'osgiliath',
  tier: 'B',
  stamps: [
    { kind: 'flatten', at: [0, -1], radius: 6.3, falloff: 2.7, height: 0.7, lowerOnly: true },
    // the western wall cut back for the west bank's half of the city
    { kind: 'flatten', at: [-6.2, -2.4], radius: 2.2, falloff: 1.3, height: 0.72, lowerOnly: true },
    { kind: 'flatten', at: [-6.2, 2.4], radius: 2.2, falloff: 1.3, height: 0.72, lowerOnly: true },
    // the steep eastern wall (Ithilien's first slope rises ≈ 5 units within 2 km of the river here) cut
    // back to a broad floodplain, so the east bank's half of the city is not a pocket hidden behind it;
    // the southern cut stops short of the Morgulduin (it comes down Ithilien's slope ≈ 3.5 km south-east,
    // its water ≈ 5.4 there: never cut below it)
    { kind: 'flatten', at: [7.0, -2.6], radius: 2.8, falloff: 2.6, height: 0.8, lowerOnly: true },
    { kind: 'flatten', at: [6.6, 0.3], radius: 1.8, falloff: 1.2, height: 0.8, lowerOnly: true },
  ],
  // the city's open ground stays clear of trees; the river and its banks around it keep theirs
  vegetationExclusion: [
    { at: [5.0, -0.5], r: 4.0 },
    { at: [-5.2, 0], r: 3.9 },
  ],
  proxy: (k) => {
    // ---- the bridge: a long run of round-arched spans on piers standing in the river, its deck at the
    // banks' level; the middle spans (and one further east) have fallen — their piers stand as stumps
    const zB = 0;
    archBridge(k, RIVER_X(zB) - RIBBON - 0.45, RIVER_X(zB) + RIBBON + 0.35, zB, BANK_Y + 0.26, 12, [5, 6, 9], STONE_DARK);

    // ---- quays: embankment walls at the water's edge, their tops at the terrace's level (the bank behind
    // them falls a little: from across the river they read as the city's water front), a broken parapet
    QUAYS.forEach((q, i) => {
      const bank = k.ground(i === 0 ? 3.1 : -3.6, 0);
      const top = Math.max(...q.map(([x, z]) => k.ground(x, z)));
      k.extrude('weathered', q, bank + 0.04 - top, { followGround: true, color: STONE_DARK, shade: 1.05 });
      const edge = (q[0][0] + q[1][0]) / 2;
      ruinCorner(k, [edge, -1.85], 0, 0.001, 1.55, 0.14, 4000 + i * 10, STONE[i]);
      ruinCorner(k, [edge, 0.3], 0, 0.001, 1.55, 0.12, 4005 + i * 10, STONE[i + 1]);
    });

    // ---- the key ruins of both banks (large: they carry the city's skyline at the hero distance)
    for (const [keys, sgn] of [
      [EAST_KEYS, 1],
      [WEST_KEYS, -1],
    ] as [typeof EAST_KEYS, number][]) {
      keys.gate.forEach((p, i) => brokenTower(k, p, 0.23, i ? 1.15 : 1.75, 8, STONE[i]));
      brokenDome(k, keys.dome, sgn > 0 ? 0.48 : 0.58, sgn > 0 ? 0.68 : 0.8, sgn > 0 ? 230 : 250, STONE[2], 14);
      brokenTower(k, keys.tall, 0.2, sgn > 0 ? 2.25 : 2.6, 12, STONE[3]);
    }

    // ---- the city: roofless halls with arcades, ruined corners (two broken walls), broken towers and
    // domes, dense and interleaved, on a street grid parallel to the river
    const keyAvoid = [...EAST_KEYS.gate, EAST_KEYS.dome, EAST_KEYS.tall, ...WEST_KEYS.gate, WEST_KEYS.dome, WEST_KEYS.tall].map((at) => ({ at, r: 0.5 }));
    const fireAvoid = FIRES.map((at) => ({ at, r: 0.2 }));
    // the bridge approach streets
    const roads: V2[][] = [
      [
        [2.4, -0.16],
        [6.4, -0.16],
        [6.4, 0.16],
        [2.4, 0.16],
      ],
      [
        [-6.8, -0.16],
        [-2.9, -0.16],
        [-2.9, 0.16],
        [-6.8, 0.16],
      ],
    ];
    for (const [poly, seed] of [
      [EAST, 1000],
      [WEST, 2000],
    ] as [V2[], number][]) {
      k.scatter(
        { polygon: poly },
        80,
        (i, x, z, u) => {
          const kind = k.r(seed + i);
          const yaw = (u < 0.5 ? 0 : 90) + (k.r(seed + 100 + i) - 0.5) * 10;
          const color = STONE[i % STONE.length];
          // taller towards the bridge (the old city centre)
          const centre = Math.max(0, 1 - Math.hypot(Math.abs(x) - 4.6, z) / 4);
          if (kind < 0.18) {
            const w = 0.32 + 0.3 * k.r(seed + 200 + i);
            const d = 0.22 + 0.18 * k.r(seed + 300 + i);
            ruinHall(k, [x, z], yaw, w, d, 0.34 + 0.3 * k.r(seed + 400 + i) + 0.2 * centre, seed * 10 + i * 13, color);
          } else if (kind < 0.84) {
            ruinCorner(k, [x, z], yaw + 90 * Math.floor(4 * k.r(seed + 500 + i)), 0.16 + 0.26 * k.r(seed + 600 + i), 0.12 + 0.2 * u, 0.28 + 0.35 * k.r(seed + 700 + i) + 0.2 * centre, seed * 10 + i * 13 + 5, color);
          } else if (kind < 0.965) {
            brokenTower(k, [x, z], 0.06 + 0.05 * u, 0.5 + 0.8 * k.r(seed + 800 + i) + 0.3 * centre, u < 0.5 ? 6 : 8, color, 0);
          } else {
            brokenDome(k, [x, z], 0.16 + 0.1 * u, 0.26 + 0.14 * u, 200 + 60 * u, color, 8);
          }
        },
        { minSpacing: 0.24, avoid: [...keyAvoid, ...fireAvoid, ...roads] },
      );
    }

    // ---- rubble: pale spills of fallen masonry (low mounds) and blocks in the streets and against walls
    for (const [poly, n] of [
      [EAST, 5],
      [WEST, 5],
    ] as [V2[], number][]) {
      k.scatter({ polygon: poly }, n, (_i, x, z, u) => k.mound('weathered', 0.12 + 0.12 * u, 0.025 + 0.025 * u, { at: [x, 0, z], seg: 8, color: STONE[4], shade: 0.95, lod: 0 }), { minSpacing: 0.35 });
      k.scatter({ polygon: poly }, n, (_i, x, z, u) => k.rock('weathered', 0.03 + 0.04 * u, { at: [x, 0, z], seat: true, squash: 0.55, lump: 0.35, detail: 0, color: STONE_DARK, lod: 0 }), { minSpacing: 0.12 });
    }

    // ---- six Orc campfires among the ruins (dusk-gated, flickering)
    for (const [x, z] of FIRES) k.light([x, k.ground(x, z) + 0.02, z], { color: 0xff8a3a, intensity: 3.2, radius: 0.04, kind: 'fire' });
  },
  annotation: { title: 'Osgiliath', subtitle: 'Citadel of the Stars', blurb: 'The ruined ancient capital of Gondor, straddling the Great River.' },
  bookmarks: [
    {
      id: 'osgiliath-close',
      distanceKm: 32,
      elevationDeg: 26,
      azimuthDeg: 20,
      fov: 26,
      lift: 1.2,
      aimKm: [-0.6, 0.3],
      tod: 9.5,
      dayOfYear: 120,
      compare: ['reference/film/osgiliath/osgiliath-ruins-haze-film.png', 'reference/film/osgiliath/osgiliath-reclaimed-ttt.webp'],
      note: 'morning from high over the Anduin north-north-east of the city, down the river: the ruins on both banks and the broken bridge across it, the quays, the river running on south into the haze, the hill of Minas Tirith on the right (an end-of-April sun 43° up in the east-south-east rakes the ruins from the left); heavy grey haze. Not from due east: from there the Minas Tirith plateau stands as a wall behind the city. Later than the first draft (7.5): below ≈ 35° the Ithilien hills (≈ 7 units, 8–10 km east) shade the whole Anduin valley',
    },
  ],
});
