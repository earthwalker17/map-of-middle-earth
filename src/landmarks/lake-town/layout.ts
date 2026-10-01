import { rand } from '../../core/rng.ts';
import type { V2 } from '../records.ts';

/**
 * Lake-town layout (local km, heading 0: x east, z south; local y = 0 is the Long Lake's surface). The
 * display point lies 1.3 km off the lake's west shore, at the mouth of the Forest River; the lake is
 * ≈ 5.5 km wide here (shore x ≈ −1.4 … +4.3), its bed 0.8 below the water at the display point and
 * ≈ 2.5 below it 1.5 km out. The town (≈ 3 × 2.3 km) fills the middle of the lake on a deck of timber
 * platforms ("blocks") on piles, laced by canals — a broad Grand Canal running north–south through the
 * middle, a cross canal, narrow canals between the blocks — and joined to the west shore by a long
 * trestle bridge.
 *
 * Town frame: (u, v) on a grid turned by YAW (u ≈ east, v ≈ south), centred on C.
 */
export const C: V2 = [1.45, -0.6];
/** grid yaw, degrees (the kit's rot convention: +yaw turns x towards −z) */
export const YAW = 8;
/** deck top above the water, km */
export const DECK = 0.075;
/** deck slab thickness, km */
export const DECK_T = 0.028;
/** the Grand Canal: centre line u and width; the cross canal: centre line v and width */
export const GRAND = { u: 0.08, w: 0.18 };
export const CROSS = { v: 0.2, w: 0.12 };

const SEED = 0x1a4e70;
const DEG = Math.PI / 180;
const cy = Math.cos(YAW * DEG);
const sy = Math.sin(YAW * DEG);

/** town frame → local x, z */
export const T = (u: number, v: number): V2 => [C[0] + u * cy + v * sy, C[1] - u * sy + v * cy];

/** the town's outline: an ellipse ≈ 3 × 2.3 km with a low-frequency wobble */
const A = 1.5;
const B = 1.16;
export function insideTown(u: number, v: number, grow = 1): boolean {
  const a = Math.atan2(v, u);
  const wob = 1 + 0.07 * Math.sin(3 * a + 0.7) + 0.05 * Math.sin(5 * a + 2.1) + 0.03 * Math.sin(8 * a + 0.3);
  return (u / A) ** 2 + (v / B) ** 2 <= (wob * grow) ** 2;
}

export interface Block {
  /** grid cell index */
  i: number;
  j: number;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** the market square (no ring of houses) / the Master's house block */
  role: 'houses' | 'square' | 'master';
}

/** split [lo, hi] into blocks separated by canals, honouring one wide canal at `special` */
function cuts(lo: number, hi: number, block: [number, number], canal: [number, number], special: { at: number; w: number }, key: number): [number, number][] {
  const out: [number, number][] = [];
  let p = lo;
  let n = 0;
  while (p < hi) {
    const bw = block[0] + (block[1] - block[0]) * rand(SEED, key, n * 2);
    const cw = canal[0] + (canal[1] - canal[0]) * rand(SEED, key, n * 2 + 1);
    n++;
    const s0 = special.at - special.w / 2;
    const s1 = special.at + special.w / 2;
    if (p < s0 && p + bw + cw > s0 - 0.02) {
      // end this block at the wide canal (if there is room for one), resume beyond it
      if (s0 - p > block[0] * 0.6) out.push([p, s0]);
      // too little room: stretch the previous block up to the wide canal instead
      else if (out.length) out[out.length - 1][1] = s0;
      p = s1;
      continue;
    }
    out.push([p, Math.min(hi, p + bw)]);
    p += bw + cw;
  }
  return out;
}

/** The town's blocks (pure, deterministic). */
export function townBlocks(): Block[] {
  const cols = cuts(-1.75, 1.75, [0.29, 0.46], [0.065, 0.1], { at: GRAND.u, w: GRAND.w }, 11);
  const rows = cuts(-1.38, 1.38, [0.22, 0.35], [0.06, 0.087], { at: CROSS.v, w: CROSS.w }, 23);
  const out: Block[] = [];
  cols.forEach(([u0, u1], i) =>
    rows.forEach(([v0, v1], j) => {
      const cu = (u0 + u1) / 2;
      const cv = (v0 + v1) / 2;
      if (!insideTown(cu, cv, 1.04)) return;
      // a few outer blocks stay open water (lagoons in the ragged edge)
      if (!insideTown(cu, cv, 0.85) && rand(SEED, i * 97 + j, 5) < 0.12) return;
      // shrink the corners that stick out of the outline
      let a = u0;
      let b = u1;
      let c = v0;
      let d = v1;
      for (let it = 0; it < 16; it++) {
        let moved = false;
        if (!insideTown(a, c) || !insideTown(a, d)) {
          if (a < cu - 0.07) {
            a += 0.03;
            moved = true;
          }
        }
        if (!insideTown(b, c) || !insideTown(b, d)) {
          if (b > cu + 0.07) {
            b -= 0.03;
            moved = true;
          }
        }
        if (!insideTown(a, c) || !insideTown(b, c)) {
          if (c < cv - 0.055) {
            c += 0.03;
            moved = true;
          }
        }
        if (!insideTown(a, d) || !insideTown(b, d)) {
          if (d > cv + 0.055) {
            d -= 0.03;
            moved = true;
          }
        }
        if (!moved) break;
      }
      if (b - a < 0.13 || d - c < 0.1) return;
      // a block whose corners still stick out (an outline nub) is dropped: no detached platforms
      const outside = [insideTown(a, c), insideTown(b, c), insideTown(b, d), insideTown(a, d)].filter((q) => !q).length;
      if (outside > 1) return;
      // canals of uneven width: every edge wanders a little
      const jit = (q: number) => (rand(SEED, i * 131 + j, 10 + q) - 0.5) * 0.034;
      out.push({ i, j, u0: a + jit(0), u1: b + jit(1), v0: c + jit(2), v1: d + jit(3), role: 'houses' });
    }),
  );
  // the market square and the Master's house: the two blocks west of the Grand Canal, either side of
  // the cross canal
  const west = out.filter((bk) => Math.abs(bk.u1 - (GRAND.u - GRAND.w / 2)) < 0.03);
  const nearCross = (bk: Block, side: number) => (side < 0 ? Math.abs(bk.v1 - (CROSS.v - CROSS.w / 2)) < 0.03 : Math.abs(bk.v0 - (CROSS.v + CROSS.w / 2)) < 0.03);
  const master = west.find((bk) => nearCross(bk, -1));
  const square = west.find((bk) => nearCross(bk, 1));
  if (master) master.role = 'master';
  if (square) square.role = 'square';
  return out;
}

/** the block containing (u, v), if any */
export function blockAt(blocks: Block[], u: number, v: number): Block | undefined {
  return blocks.find((bk) => u >= bk.u0 && u <= bk.u1 && v >= bk.v0 && v <= bk.v1);
}
