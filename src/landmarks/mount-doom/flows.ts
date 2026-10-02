/**
 * Orodruin's lava flows — ONE table shared by the kit (parts.ts: each flow down the cone from its vent
 * to its toe, its branches and pools) and the terrain (src/terrain/volcanic.ts VOLCANIC.flows: the same
 * flow continuing over the Gorgoroth plain from the same toe, on the same heading). S4 W5 (C2 #15): the kit
 * no longer ends where its steepest-descent trace dies out (a toe the terrain had to hand-measure); it
 * descends the cone's gullies for `coneKm`, then eases onto the authored toe and heading below, so both
 * sides read the toes from here and stay continuous.
 *
 * Local frame of the landmark (heading 0): km from the summit, x east, z south; compass headings
 * (0 = north, 90 = east: x = sin, z = −cos).
 */
export interface DoomFlow {
  /** compass azimuth of the vent on the rim, deg */
  az: number;
  /** the flow's width near the vent, km (side-by-side lanes of ≤ 0.22 km; it narrows by a third downstream) */
  width: number;
  /** braided strands fanning from the vent (1 = none) */
  strands: number;
  /** km of steepest descent down the cone's gullies before the flow eases onto its toe */
  coneKm: number;
  /** the toe (local km) and the flow's heading there (compass deg) */
  toe: readonly [number, number];
  heading: number;
  /** branching toes: heading offset (deg), length (km) and the radius (km) of the glowing pool at its end (0: none) */
  branches: readonly { dh: number; len: number; pool: number }[];
  /** lava lights on the flow (the hero flank): sprite lights (visible glints) and spill-only ones */
  sprites: number;
  spills: number;
  /** the flow over the plain beyond the toe (volcanic.ts): length km, half-width km, heat 0..1 */
  plain: readonly [number, number, number];
}

/**
 * Three widths (C2 #15: ≈ 0.6 / 0.35 / 0.15 km): the hero flow pouring out of the notch in the crater lip
 * (south-south-east, the flank the hero cameras face) with two branching toes ending in pools on the plain,
 * a medium one on the south-south-west with a pool, a thin one on the west-south-west (it ends on the
 * saddle under the old shoulder) and a thin short one on the east (the Sammath Naur side).
 */
export const DOOM_FLOWS: readonly DoomFlow[] = [
  {
    az: 166,
    width: 0.6,
    strands: 3,
    coneKm: 13,
    toe: [5.6, 17.4],
    heading: 170,
    branches: [
      { dh: -34, len: 2.4, pool: 0.6 },
      { dh: 30, len: 1.7, pool: 0.45 },
    ],
    sprites: 1,
    spills: 1,
    plain: [18, 1.5, 1.0],
  },
  {
    az: 205,
    width: 0.35,
    strands: 2,
    coneKm: 14,
    toe: [-7.0, 17.6],
    heading: 202,
    branches: [
      { dh: 26, len: 1.6, pool: 0.5 },
      { dh: -18, len: 1.0, pool: 0 },
    ],
    sprites: 0,
    spills: 1,
    plain: [14, 1.3, 0.9],
  },
  { az: 238, width: 0.15, strands: 1, coneKm: 6.5, toe: [-6.6, 6.1], heading: 236, branches: [], sprites: 0, spills: 0, plain: [12, 1.1, 0.75] },
  { az: 104, width: 0.15, strands: 1, coneKm: 5.5, toe: [7.4, 0.0], heading: 96, branches: [], sprites: 0, spills: 0, plain: [10, 0.9, 0.65] },
];

/** the terrain's continuation of each kit flow: [toe x, toe z, heading, length, half-width, heat, molten channel] */
export const DOOM_PLAIN_FLOWS: readonly (readonly [number, number, number, number, number, number, number])[] = DOOM_FLOWS.map(
  (f) => [f.toe[0], f.toe[1], f.heading, f.plain[0], f.plain[1], f.plain[2], 1] as const,
);
