import { rand } from '../../core/rng.ts';
import type { V2 } from '../records.ts';

/**
 * Lake-town layout (local km, heading 0: x east, z south; local y = 0 is the Long Lake's surface). The
 * display point lies 1.3 km off the lake's west shore, at the mouth of the Forest River; the lake is
 * ≈ 5.5 km wide here (shore x ≈ −1.4 … +4.3), its bed 0.8 below the water at the display point and
 * ≈ 2.5 below it 1.5 km out.
 *
 * The town (≈ 3.4 × 2.6 km) is ONE continuous timber deck on piles in the middle of the lake — an
 * organically grown stilt town, not a raft park: an irregular outline with harbour notches and jetties,
 * cut by a broad Grand Canal running the town's length (south-south-west → north-north-east, the hero's
 * view), a cross canal running west from it and narrower side canals (one to two house widths) that run in
 * from the lake — all of them ending inside the town (only the Grand Canal divides it), bridged over here
 * and there. Everything here is a pure
 * function of the town frame (u, v): the deck mask, the canals, the house regions.
 *
 * Town frame: (u, v) turned by YAW (u ≈ east-south-east, v ≈ south-south-west), centred on C.
 */
export const C: V2 = [1.45, -0.6];
/** grid yaw, degrees (the kit's rot convention: +yaw turns x towards −z): −15 runs the Grand Canal NNE */
export const YAW = -15;
/** deck top above the water, km */
export const DECK = 0.075;
/** deck slab thickness, km */
export const DECK_T = 0.012;
/**
 * the Grand Canal: centre line u and width (S4 W5: 0.3 → 0.195, so the town reads as one town cut by a
 * canal, not two islands)
 */
export const GRAND = { u: 0.05, w: 0.195 };
/** the cross canal: centre line v and width; it runs west from the Grand Canal and ends inside the town at u0 */
export const CROSS = { v: 0.2, w: 0.1, u0: -0.72 };

const SEED = 0x1a4e70;
const DEG = Math.PI / 180;
const cy = Math.cos(YAW * DEG);
const sy = Math.sin(YAW * DEG);

/** town frame → local x, z */
export const T = (u: number, v: number): V2 => [C[0] + u * cy + v * sy, C[1] - u * sy + v * cy];
/** local x, z → town frame */
export const Tinv = (x: number, z: number): V2 => {
  const dx = x - C[0];
  const dz = z - C[1];
  return [dx * cy - dz * sy, dx * sy + dz * cy];
};

/** half extents of the town's outline ellipse */
const A = 1.7;
const B = 1.3;
/** harbour notches cut into the outline: centre angle (rad, in the ellipse-normalised frame), half width (rad), depth */
const NOTCHES: [number, number, number][] = [
  [0.35, 0.06, 0.2],
  [1.15, 0.045, 0.16],
  [2.05, 0.05, 0.22],
  [2.75, 0.07, 0.15],
  [3.55, 0.05, 0.2],
  [4.25, 0.045, 0.14],
  [5.0, 0.06, 0.2],
  [5.75, 0.05, 0.17],
];
const angDiff = (a: number, b: number): number => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** outline radius (ellipse-normalised) at angle a: a low wobble, a ragged fine edge and the notches */
function rim(a: number): number {
  let r = 1 + 0.07 * Math.sin(3 * a + 0.7) + 0.05 * Math.sin(5 * a + 2.1) + 0.03 * Math.sin(8 * a + 0.3);
  // a ragged edge: steps of ≈ 0.08 km where the outer houses stand out or fall back
  // (S4 W5: 110 steps of ≈ 0.09 km, deeper: no straight edge longer than ≈ 0.12 km)
  r += (rand(SEED, Math.floor((a / (Math.PI * 2)) * 110 + 110) % 110, 41) - 0.5) * 0.075;
  for (const [c, w, d] of NOTCHES) if (Math.abs(angDiff(a, c)) < w) r -= d;
  return r;
}

/** inside the town's outline (grow > 1: a little beyond it) */
export function insideTown(u: number, v: number, grow = 1): boolean {
  const a = Math.atan2(v / B, u / A);
  return Math.hypot(u / A, v / B) <= rim(a) * grow;
}

/** a side canal: runs along `axis` ('u': constant v, 'v': constant u) at `at`, width `w`, from `from` to `to` */
interface SideCanal {
  axis: 'u' | 'v';
  at: number;
  w: number;
  from: number;
  to: number;
}
/** side canals: in from the lake 0.5–0.8 km, ending inside the town (one to two house widths wide) */
export const SIDE_CANALS: SideCanal[] = [
  { axis: 'u', at: -0.72, w: 0.1, from: -9, to: -0.95 },
  { axis: 'u', at: 0.8, w: 0.085, from: -9, to: -0.85 },
  { axis: 'u', at: -0.34, w: 0.12, from: 1.0, to: 9 },
  { axis: 'u', at: 0.62, w: 0.09, from: 0.85, to: 9 },
  { axis: 'v', at: -0.98, w: 0.085, from: 0.7, to: 9 },
  { axis: 'v', at: 1.0, w: 0.1, from: -9, to: -0.7 },
];

/** canal edge wander: each edge drifts ±0.012 km in 0.06 km steps (no ruler-straight canals) */
const wander = (key: number, s: number): number => (rand(SEED, key * 1009 + Math.floor(s / 0.06 + 500), 7) - 0.5) * 0.024;

/** in a canal (Grand, cross or a side canal)? `margin` widens every canal (keep-out for houses) */
export function inCanal(u: number, v: number, margin = 0): boolean {
  if (Math.abs(u - GRAND.u - wander(1, v)) < GRAND.w / 2 + margin) return true;
  if (u < GRAND.u && u > CROSS.u0 - margin && Math.abs(v - CROSS.v - wander(2, u)) < CROSS.w / 2 + margin) return true;
  for (let i = 0; i < SIDE_CANALS.length; i++) {
    const c = SIDE_CANALS[i];
    const [along, across] = c.axis === 'u' ? [u, v] : [v, u];
    if (along < c.from || along > c.to + margin) continue;
    if (Math.abs(across - c.at - wander(10 + i, along)) < c.w / 2 + margin) return true;
  }
  return false;
}

/** on the deck: inside the outline and not in a canal */
export function onDeck(u: number, v: number): boolean {
  return insideTown(u, v) && !inCanal(u, v);
}

/**
 * House regions: the parts of the town between the canals, each with its own small rotation (±5–10°,
 * the blocks grew separately) and the market square / the Master's house carved out of two of them.
 * Region key from the side of the Grand Canal and the bands between the canals that cross it.
 */
export function regionOf(u: number, v: number): number {
  const east = u > GRAND.u;
  if (!east) {
    const band = v < -0.72 ? 0 : v < CROSS.v ? 1 : v < 0.8 ? 2 : 3;
    return band + (u < -0.98 && v > CROSS.v ? 10 : 0);
  }
  const band = v < -0.34 ? 4 : v < 0.62 ? 5 : 6;
  return band + (u > 1.0 && v < -0.34 ? 10 : 0);
}

/** a region's rotation, degrees (±5–10°, sign alternating with a random part) */
export function regionYaw(r: number): number {
  const s = rand(SEED, r, 3) < 0.5 ? -1 : 1;
  return s * (5 + 5 * rand(SEED, r, 4));
}

/** the market square: an open deck on the west bank of the Grand Canal, just south of the cross canal */
export const MARKET = { u0: GRAND.u - GRAND.w / 2 - 0.36, u1: GRAND.u - GRAND.w / 2 - 0.02, v0: CROSS.v + CROSS.w / 2 + 0.05, v1: CROSS.v + CROSS.w / 2 + 0.3 };
/** the Master's house: west bank of the Grand Canal, just north of the cross canal */
export const MASTER = { u0: GRAND.u - GRAND.w / 2 - 0.42, u1: GRAND.u - GRAND.w / 2 - 0.03, v0: CROSS.v - CROSS.w / 2 - 0.3, v1: CROSS.v - CROSS.w / 2 - 0.03 };

export const inRect = (r: { u0: number; u1: number; v0: number; v1: number }, u: number, v: number, m = 0): boolean => u >= r.u0 - m && u <= r.u1 + m && v >= r.v0 - m && v <= r.v1 + m;

/**
 * The deck as row strips: for every row of `dv` km, the runs of deck along u (sampled every 0.01 km).
 * `wet(u, v)` = deep enough water there (the town never runs onto the shore). Pure.
 */
export function deckRuns(dv: number, wet: (u: number, v: number) => boolean, mask: (u: number, v: number) => boolean = onDeck): { v: number; u0: number; u1: number }[] {
  const out: { v: number; u0: number; u1: number }[] = [];
  for (let v = -B * 1.15; v <= B * 1.15; v += dv) {
    const vc = v + dv / 2;
    let start: number | null = null;
    for (let u = -A * 1.15; u <= A * 1.15 + 0.01; u += 0.01) {
      const on = u <= A * 1.15 && mask(u, vc) && wet(u, vc);
      if (on && start === null) start = u;
      if (!on && start !== null) {
        if (u - start > 0.03) out.push({ v, u0: start, u1: u - 0.01 });
        start = null;
      }
    }
  }
  return out;
}
