import type { V2 } from '../records.ts';

/**
 * Minas Morgul layout (local km, heading 0: x east, z south). The display point (places.json offset
 * 5.3 km north of the canon point, which lies on the Morgulduin) is on the north side of the Morgul vale;
 * the vale runs east–west and falls west towards the Anduin (≈ 1.3 units per km at the city), the
 * Morgulduin flows west ≈ 5.3 km south of the display point in a trench ≈ 4 units deep (level ≈ −4.1
 * below the base ground at the origin). The city stands on a shelf cut into the vale side just above the
 * stream's north bank, its gate facing south over the water; the bridge spans the stream to the road on
 * the south bank.
 */

/** city centre (the pad's centre) */
export const C: V2 = [0.3, 1.35];
/** pad height relative to the base ground at the origin */
export const PAD_REL = -0.4;
/** pad radius / falloff, km */
export const PAD_R = 1.75;
export const PAD_FALL = 0.4;
/** the pad's centre (a little south of the city's, so the shelf runs on in front of the gate) */
export const PAD_C: V2 = [C[0], C[1] + 0.2];

/** the Tower of the Moon (centre of its base), a little behind the city's middle, away from the gate */
export const TOWER: V2 = [C[0] + 0.18, C[1] - 0.32];

/** the outer wall, an open path from the gate's east jamb round the city to its west jamb (local km) */
export const WALL: V2[] = (
  [
    [0.12, 1.6],
    [0.68, 1.42],
    [1.33, 0.97],
    [1.6, 0.12],
    [1.37, -0.78],
    [0.66, -1.33],
    [-0.28, -1.45],
    [-1.14, -1.06],
    [-1.6, -0.3],
    [-1.49, 0.56],
    [-0.95, 1.24],
    [-0.25, 1.55],
  ] as V2[]
).map(([x, z]): V2 => [C[0] + x, C[1] + z]);

/** gate: centre of the gap in the south wall and its outward direction (unit, local x/z) */
export const GATE: V2 = [C[0] - 0.065, C[1] + 1.6];
export const GATE_OUT: V2 = [-0.13, 0.99];

/** the far end of the bridge on the south bank */
export const BRIDGE_END: V2 = [GATE[0] - 0.6, GATE[1] + 4.6];
