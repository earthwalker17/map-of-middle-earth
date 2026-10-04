/**
 * Camera rails (S5): Gaussian low-passes of the compiled route over arc length s, so camera targets
 * follow the route without copying its wiggles. Two rails on the route's own uniform s-grid (≈ 0.25 km):
 *  - fine   σ = 6 km  — targets near the ground (holds, the ends of moves)
 *  - coarse σ = 40 km — targets while a move is zoomed out (the line of the journey, not its bends)
 * Odd (point) reflection pads both ends, so a rail starts and ends exactly on the route and keeps its
 * end direction. Pure data — Node and the page build identical rails.
 */
import type { CompiledRoute } from './schema.ts';

export const RAIL_SIGMA_KM = { fine: 6, coarse: 40 } as const;
export type RailKind = keyof typeof RAIL_SIGMA_KM;

export interface Rails {
  /** grid spacing, km (= the route's sample spacing) */
  step: number;
  count: number;
  length: number;
  /** x, z per grid sample, stride 2 */
  fine: Float64Array;
  coarse: Float64Array;
}

/** Gaussian low-pass of the route's XZ; evaluated every `stride` samples (and the last), linear in between. */
function lowpass(route: CompiledRoute, sigmaKm: number, step: number, stride = 1): Float64Array {
  const n = route.count;
  const out = new Float64Array(n * 2);
  const sig = sigmaKm / step;
  const r = Math.max(1, Math.ceil(3 * sig));
  const k = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sig * sig));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const P = route.pts;
  const x0 = P[0];
  const z0 = P[2];
  const xN = P[(n - 1) * 4];
  const zN = P[(n - 1) * 4 + 2];
  const at = (i: number) => {
    let ax = 0;
    let az = 0;
    for (let j = -r; j <= r; j++) {
      let m = i + j;
      let x: number;
      let z: number;
      // odd reflection about the end samples (repeated if the kernel outruns the whole route)
      if (m < 0) {
        m = Math.min(n - 1, -m);
        x = 2 * x0 - P[m * 4];
        z = 2 * z0 - P[m * 4 + 2];
      } else if (m > n - 1) {
        m = Math.max(0, 2 * (n - 1) - m);
        x = 2 * xN - P[m * 4];
        z = 2 * zN - P[m * 4 + 2];
      } else {
        x = P[m * 4];
        z = P[m * 4 + 2];
      }
      ax += k[j + r] * x;
      az += k[j + r] * z;
    }
    out[i * 2] = ax;
    out[i * 2 + 1] = az;
  };
  let prev = 0;
  at(0);
  for (let i = stride; ; i += stride) {
    const c = Math.min(i, n - 1);
    if (c === prev) break;
    at(c);
    for (let q = prev + 1; q < c; q++) {
      const u = (q - prev) / (c - prev);
      out[q * 2] = out[prev * 2] + (out[c * 2] - out[prev * 2]) * u;
      out[q * 2 + 1] = out[prev * 2 + 1] + (out[c * 2 + 1] - out[prev * 2 + 1]) * u;
    }
    prev = c;
  }
  return out;
}

export function buildRails(route: CompiledRoute): Rails {
  const step = route.count > 1 ? route.length / (route.count - 1) : 1;
  // the coarse rail (σ 40 km) is exact every 1 km and linear in between (its curvature makes that < 5 m off)
  return { step, count: route.count, length: route.length, fine: lowpass(route, RAIL_SIGMA_KM.fine, step), coarse: lowpass(route, RAIL_SIGMA_KM.coarse, step, Math.max(1, Math.round(1 / step))) };
}

/** Rail position at arc length s (linear between grid samples; s is clamped to the route). */
export function railAt(rail: Rails, s: number, kind: RailKind, out: [number, number] = [0, 0]): [number, number] {
  const a = rail[kind];
  if (rail.count < 2) {
    out[0] = a[0];
    out[1] = a[1];
    return out;
  }
  const f = Math.min(rail.count - 1, Math.max(0, s / rail.step));
  const i = Math.min(rail.count - 2, Math.floor(f));
  const u = f - i;
  out[0] = a[i * 2] + (a[i * 2 + 2] - a[i * 2]) * u;
  out[1] = a[i * 2 + 1] + (a[i * 2 + 3] - a[i * 2 + 1]) * u;
  return out;
}

/** Rail heading at s: compass degrees of the direction of travel (0 = north, 90 = east). */
export function railHeading(rail: Rails, s: number, kind: RailKind): number {
  const h = Math.max(rail.step, 0.5);
  const [ax, az] = railAt(rail, s - h, kind);
  const [bx, bz] = railAt(rail, s + h, kind);
  return (Math.atan2(bx - ax, -(bz - az)) * 180) / Math.PI;
}

/** Arc length of the rail point nearest to (x, z), searched in [s0, s1] (coarse scan + local refine). */
export function projectToRail(rail: Rails, x: number, z: number, kind: RailKind, s0 = 0, s1 = rail.length): { s: number; dist: number } {
  const a = rail[kind];
  const i0 = Math.max(0, Math.floor(s0 / rail.step));
  const i1 = Math.min(rail.count - 1, Math.ceil(s1 / rail.step));
  let best = i0;
  let bd = Infinity;
  for (let i = i0; i <= i1; i++) {
    const d = (a[i * 2] - x) ** 2 + (a[i * 2 + 1] - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  // refine on the two segments around the best sample (exact projection onto the polyline)
  let s = best * rail.step;
  let dist = Math.sqrt(bd);
  for (const j of [best - 1, best]) {
    if (j < i0 || j + 1 > i1) continue;
    const ax = a[j * 2];
    const az = a[j * 2 + 1];
    const dx = a[j * 2 + 2] - ax;
    const dz = a[j * 2 + 3] - az;
    const l2 = dx * dx + dz * dz;
    if (l2 <= 0) continue;
    const u = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2));
    const d = Math.hypot(ax + dx * u - x, az + dz * u - z);
    if (d < dist) {
      dist = d;
      s = (j + u) * rail.step;
    }
  }
  return { s: Math.min(rail.length, Math.max(0, s)), dist };
}
