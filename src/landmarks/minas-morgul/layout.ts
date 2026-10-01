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

/** the Tower of the Moon (centre of its base): behind the city's middle, up-slope to the north-east */
export const TOWER: V2 = [C[0] + 0.22, C[1] - 0.4];

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

/** a closed polygon round `c`: `n` points at radius r·(1 + wobble), phase-shifted */
function polar(c: V2, r: number, n: number, wobble: number, phase: number): V2[] {
  return Array.from({ length: n }, (_, j): V2 => {
    const a = (j / n) * Math.PI * 2 + phase;
    const rr = r * (1 + wobble * Math.sin(3 * a + 0.7) + 0.5 * wobble * Math.cos(5 * a));
    return [c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr];
  });
}

/**
 * The tiers stacked up toward the mountain (north-east): the second terrace ring (top 1.3 above the shelf,
 * its parapet well over the curtain) and the keep terrace round the Tower (top 2.1), set back toward the
 * north-east inside it so a broad step of the second tier shows in front; the Tower stands on the keep
 * terrace. Walls of the keep terrace that stand inside the second tier rise from its top (city.ts).
 */
export const T2_C: V2 = [C[0] + 0.12, C[1] - 0.23];
export const T2: V2[] = polar(T2_C, 1.05, 10, 0.05, 0.3);
export const T2_TOP = 1.3;
export const T3: V2[] = polar(TOWER, 0.86, 9, 0.04, 0.1);
export const T3_TOP = 2.1;

/** the far end of the bridge on the south bank */
export const BRIDGE_END: V2 = [GATE[0] - 0.6, GATE[1] + 4.6];
