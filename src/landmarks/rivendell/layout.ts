import type { V2 } from '../types.ts';
import { offsetPath } from './parts.ts';

/** Rivendell's layout (local km, heading 0): the stream, the walls' foot lines, the ledges. */

/** the stream's centreline through the valley, east → west (baked stream-39, smoothed) */
export const STREAM: V2[] = [
  [11.0, -2.45],
  [9.7, -2.1],
  [8.2, -1.68],
  [6.8, -1.35],
  [6.0, -1.26],
  [4.8, -1.2],
  [3.3, -1.14],
  [2.3, -0.92],
  [1.4, -0.47],
  [0.6, 0.05],
  [-0.3, 0.4],
  [-1.3, 0.48],
  [-2.3, 0.57],
  [-3.3, 0.8],
  [-4.2, 1.05],
];
/** the same line west → east (walking east: north is on the left) */
export const STREAM_WE: V2[] = [...STREAM].reverse();
/** half width of the gorge floor at the foot of its walls, km */
export const FLOOR = 1.0;
/**
 * the walls' foot lines: the north wall stops where the valley opens north-west into the Bruinen's gorge
 * (its slopes fall toward that river: nothing may stand there), the south wall runs on to the falls
 */
export const NORTH_FOOT = offsetPath(STREAM_WE, FLOOR).filter(([x]) => x > -0.9);
export const SOUTH_FOOT = offsetPath(STREAM_WE, -FLOOR);

/** the ledges cut into the walls (halls.ts builds on them): the main one (the Last Homely House) on the
 * sunlit north wall, one across the gorge on the south wall, two smaller shelves further up the valley */
export const LEDGE_N = { at: [0.15, -1.75] as V2, r: 0.72, h: 1.25 };
export const LEDGE_S = { at: [-1.6, 2.1] as V2, r: 0.55, h: 0.95 };
export const LEDGE_NE = { at: [2.25, -2.3] as V2, r: 0.45, h: 1.7 };
export const LEDGE_SE = { at: [1.3, 1.3] as V2, r: 0.42, h: 1.0 };
