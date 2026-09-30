import type { V2 } from '../records.ts';
import { defineLandmark } from '../types.ts';
import { archBridge, brokenDome, brokenTower, ruinHall, STONE, STONE_DARK } from './ruins.ts';

/**
 * Osgiliath, the ruined Citadel of the Stars (research §8; the TTT stills — broken towers, roofless halls,
 * round-arched arcades, broken domes, rubble slopes, the partly collapsed bridge; Alan Lee's "Window on the
 * West" era ruins): a ruined city on BOTH banks of the Anduin, its skyline full of gaps, joined by a long
 * multi-arched bridge whose middle spans have fallen into the river. Stone #646e6c lit, cold grey-green;
 * heavy white-grey haze (looks.json spot) so depth falls off fast. Six Orc campfires (dusk-gated).
 *
 * Local frame: heading 0 (x east, z south). The display point lies in the Anduin's channel (≈ 5.2 km wide
 * here, water ≈ 0.3 above the origin ground; its ribbon — where the river guard keeps the banks — reaches
 * ≈ 3.6 km either side of the centreline at x ≈ −0.3), so the ruins stand on the banks beyond it: the
 * west bank x ≈ −6.7 … −4.1, the east bank x ≈ 3.7 … 6.4; the Morgulduin joins from the east ≈ 5 km south.
 *
 * Stamps (relative to the base ground at the display point): the city's level floodplain on both banks —
 * the valley walls are cut down to a terrace at the Anduin's level + 0.4 (lowerOnly: the channel and the
 * floodplain below the terrace are never raised), easing back into the walls; the steep western wall
 * (Minas Tirith's side) is cut back further so the west bank carries its half of the city.
 */

/** the river's centreline x (the snapped Anduin, local) and the ribbon half width, km */
const RIVER_X = (z: number): number => -0.3 + 0.1 * Math.max(0, z - 1.5);
const RIBBON = 3.65;
/** deck height of the bridge above the origin ground (the water ≈ 0.3, the banks ≈ 0.7) */
const BANK_Y = 0.72;

/** the two banks' building zones (local polygons) */
const EAST: V2[] = [
  [3.85, -4.3],
  [5.9, -4.3],
  [6.3, -2.5],
  [6.05, 1.3],
  [5.6, 2.5],
  [4.1, 3.2],
  [3.8, 0.5],
];
const WEST: V2[] = [
  [-4.2, -4.4],
  [-6.3, -4.4],
  [-6.8, 0.2],
  [-6.5, 4.3],
  [-4.4, 4.3],
  [-4.15, 0.5],
];

/** key ruins placed by hand: the bridgeheads' towers, the great domes, the tallest towers */
const EAST_KEYS = {
  gate: [
    [3.9, -0.32],
    [3.9, 0.32],
  ] as V2[],
  dome: [4.85, -1.05] as V2,
  tall: [5.45, 1.45] as V2,
};
const WEST_KEYS = {
  gate: [
    [-4.3, -0.34],
    [-4.3, 0.34],
  ] as V2[],
  dome: [-5.35, 0.95] as V2,
  tall: [-5.05, -1.7] as V2,
};

/** the six campfires (local x, z) — in open ground among the ruins */
const FIRES: V2[] = [
  [4.5, 0.45],
  [5.6, -2.6],
  [4.6, 2.7],
  [-4.8, 0.4],
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
    { kind: 'flatten', at: [-6.2, -2.4], radius: 2.2, falloff: 1.6, height: 0.72, lowerOnly: true },
    { kind: 'flatten', at: [-6.2, 2.4], radius: 2.2, falloff: 1.6, height: 0.72, lowerOnly: true },
    // the steep eastern wall (Ithilien's first slope rises ≈ 5 units within 2 km of the river here) cut
    // back to a broad floodplain, so the east bank's half of the city is not a pocket hidden behind it
    { kind: 'flatten', at: [7.0, -2.6], radius: 2.8, falloff: 2.6, height: 0.8, lowerOnly: true },
    { kind: 'flatten', at: [7.0, 2.0], radius: 2.5, falloff: 2.6, height: 0.8, lowerOnly: true },
  ],
  // the city's open ground stays clear of trees; the river and its banks around it keep theirs
  vegetationExclusion: [
    { at: [5.4, -0.5], r: 3.9 },
    { at: [-5.4, 0], r: 3.6 },
  ],
  proxy: (k) => {
    // ---- the bridge: a long run of round-arched spans on piers standing in the river, its deck at the
    // banks' level; the middle spans (and one further east) have fallen — their piers stand as stumps
    const zB = 0;
    archBridge(k, RIVER_X(zB) - RIBBON - 0.45, RIVER_X(zB) + RIBBON + 0.35, zB, BANK_Y + 0.26, 12, [5, 6, 9], STONE_DARK);

    // ---- the key ruins of both banks
    for (const [keys, sgn] of [
      [EAST_KEYS, 1],
      [WEST_KEYS, -1],
    ] as [typeof EAST_KEYS, number][]) {
      keys.gate.forEach((p, i) => brokenTower(k, p, 0.17, i ? 0.85 : 1.3, 8, STONE[i]));
      brokenDome(k, keys.dome, sgn > 0 ? 0.36 : 0.44, sgn > 0 ? 0.5 : 0.6, sgn > 0 ? 230 : 250, STONE[2]);
      brokenTower(k, keys.tall, 0.15, sgn > 0 ? 1.7 : 2.0, 12, STONE[3]);
    }

    // ---- the city blocks: halls, towers and domes on a street grid parallel to the river
    const keyAvoid = [...EAST_KEYS.gate, EAST_KEYS.dome, EAST_KEYS.tall, ...WEST_KEYS.gate, WEST_KEYS.dome, WEST_KEYS.tall].map((at) => ({ at, r: 0.45 }));
    const fireAvoid = FIRES.map((at) => ({ at, r: 0.2 }));
    // the bridge approach streets
    const roads: V2[][] = [
      [
        [3.7, -0.18],
        [6.4, -0.18],
        [6.4, 0.18],
        [3.7, 0.18],
      ],
      [
        [-6.8, -0.18],
        [-4.1, -0.18],
        [-4.1, 0.18],
        [-6.8, 0.18],
      ],
    ];
    for (const [poly, seed] of [
      [EAST, 1000],
      [WEST, 2000],
    ] as [V2[], number][]) {
      k.scatter(
        { polygon: poly },
        42,
        (i, x, z, u) => {
          const kind = k.r(seed + i);
          const yaw = (u < 0.5 ? 0 : 90) + (k.r(seed + 100 + i) - 0.5) * 12;
          const color = STONE[i % STONE.length];
          if (kind < 0.7) {
            const w = 0.34 + 0.4 * k.r(seed + 200 + i);
            const d = 0.24 + 0.22 * k.r(seed + 300 + i);
            ruinHall(k, [x, z], yaw, w, d, 0.3 + 0.3 * k.r(seed + 400 + i), seed + 500 + i * 70, color);
          } else if (kind < 0.9) {
            brokenTower(k, [x, z], 0.07 + 0.05 * u, 0.55 + 0.7 * k.r(seed + 600 + i), u < 0.5 ? 8 : 12, color, 0);
          } else {
            brokenDome(k, [x, z], 0.18 + 0.1 * u, 0.28 + 0.14 * u, 200 + 60 * u, color);
          }
        },
        { minSpacing: 0.34, avoid: [...keyAvoid, ...fireAvoid, ...roads] },
      );
    }

    // ---- rubble: fallen blocks in the streets and against the walls
    for (const [poly, n] of [
      [EAST, 22],
      [WEST, 22],
    ] as [V2[], number][])
      k.scatter({ polygon: poly }, n, (_i, x, z, u) => k.rock('weathered', 0.03 + 0.04 * u, { at: [x, 0, z], seat: true, squash: 0.55, lump: 0.35, detail: 0, color: STONE_DARK, lod: 0 }), { minSpacing: 0.12 });

    // ---- six Orc campfires among the ruins (dusk-gated, flickering)
    for (const [x, z] of FIRES) k.light([x, k.ground(x, z) + 0.02, z], { color: 0xff8a3a, intensity: 2.2, radius: 0.03, kind: 'fire' });
  },
  annotation: { title: 'Osgiliath', subtitle: 'Citadel of the Stars', blurb: 'The ruined ancient capital of Gondor, straddling the Great River.' },
  bookmarks: [
    {
      id: 'osgiliath-close',
      distanceKm: 28,
      elevationDeg: 33,
      azimuthDeg: 63,
      fov: 38,
      lift: 1,
      aimKm: [-3, -0.8],
      tod: 9.5,
      dayOfYear: 120,
      compare: ['reference/film/osgiliath/osgiliath-ruins-haze-film.png', 'reference/film/osgiliath/osgiliath-reclaimed-ttt.webp'],
      note: 'morning from high over Ithilien, east-north-east across the Anduin (an end-of-April sun 43° up in the south-east rakes the ruins from the right): the ruins on both banks and the broken bridge, Minas Tirith beyond on Mindolluin; heavy grey haze. Later than the first draft (7.5): below ≈ 35° the Ithilien hills (≈ 7 units, 8–10 km east) shade the whole Anduin valley; high because Ithilien rises to ≈ 20 at 35–40 km behind the camera',
    },
  ],
});
