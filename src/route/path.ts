import type { CompiledRoute } from '../tour/schema.ts';

/**
 * The route line's render path (S5 film; pure — no three.js, so Node checks and the page agree): the
 * CompiledRoute's samples with heights made fit to DRAW, and the tangents the ribbon's screen normal
 * comes from. The compiled drape follows the 12×-exaggerated ground sample by sample (slopes of 1–4
 * between 0.25 km samples are common), which reads as jagged "lightning" in oblique views and turns the
 * per-vertex screen normals over in far views (bright ticks where the folded ribbon adds up twice).
 *
 *  - foot legs: a morphological CLOSING of the draped heights (max, then min, over ±CLOSE_KM) bridges
 *    dips narrower than ~2·CLOSE_KM (gullies, river cuts — the path crosses them like a bridge) and is
 *    exact on monotone slopes and crests; then a Gaussian (SIGMA_KM) rounds the kinks. Never below the
 *    drape except by a few metres at sharp crests (the shader's depth pull covers that).
 *  - boat legs: the compiled water level, untouched.
 *  - underground legs (Moria): a straight run in height between the two portals (linear in s between
 *    the neighbouring processed heights) — through the mountain, drawn as an x-ray (routeMaterial.ts).
 *
 * Two levels, morphed per vertex by the vertex shader (by the fine stencil's projected length against the
 * ribbon's width): the NEAR path above, and a FAR path — heights closed again over ±FAR_CLOSE_KM and x, y, z
 * Gaussian-smoothed (FAR_SIGMA_KM, shrinking to 0 at the route's ends). Far away the samples are sub-pixel
 * and the near path's height wiggles move the projected centre back and forth along the line; the ribbon's
 * sides then step backwards and the additive glow adds up twice there (bright ticks). The far path is
 * monotone at the far views' pixel scale.
 *
 * The ribbon (RouteSystem) stores each sample's near and far position and its neighbours on both levels;
 * the shader's chord tangent (B − A) / (s_B − s_A) is dP/ds (s = the CompiledRoute's XZ arc length, km), so
 * its px-per-km "along the line" is per km of s — the unit of the head, the caps, the comet and the dots.
 */

/** closing radius (km): dips narrower than ≈ 2× this are bridged */
export const CLOSE_KM = 0.5;
/** Gaussian smoothing of the closed heights (km) */
export const SIGMA_KM = 0.25;
/** the far path: closing radius of its heights and the Gaussian σ of x, y, z (km) */
export const FAR_CLOSE_KM = 2;
export const FAR_SIGMA_KM = 1.5;

export interface RibbonPath {
  count: number;
  /** total arc length (km of s) */
  length: number;
  /** x, y, z per sample — the render heights (near views) */
  p: Float64Array;
  /** x, y, z per sample — the far path (smoothed at the scale of the far views' pixels) */
  pc: Float64Array;
  /** s per sample (km, = CompiledRoute s) */
  s: Float64Array;
  mode: Uint8Array;
}

/** Build the render path of a compiled route (deterministic, O(n·window)). */
export function ribbonPath(r: CompiledRoute): RibbonPath {
  const n = r.count;
  const spacing = n > 1 ? r.length / (n - 1) : 1;
  const yd = new Float64Array(n);
  for (let k = 0; k < n; k++) yd[k] = r.pts[k * 4 + 1];
  // closing (max then min over ±R samples), then a Gaussian
  const clo = closing(yd, Math.max(0, Math.round(CLOSE_KM / spacing)));
  const sg = SIGMA_KM / spacing;
  const G = Math.ceil(sg * 3);
  const w: number[] = [];
  for (let j = -G; j <= G; j++) w.push(sg > 0 ? Math.exp(-0.5 * (j / sg) ** 2) : j === 0 ? 1 : 0);
  const y = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    if (r.mode[k] !== 0) {
      y[k] = yd[k];
      continue;
    }
    let a = 0;
    let ws = 0;
    for (let j = -G; j <= G; j++) {
      const q = k + j;
      if (q < 0 || q >= n) continue;
      a += w[j + G] * clo[q];
      ws += w[j + G];
    }
    y[k] = a / ws;
  }
  // underground runs: linear in s between the processed heights just outside the run (the portals)
  for (let k = 0; k < n; ) {
    if (r.mode[k] !== 2) {
      k++;
      continue;
    }
    let e = k;
    while (e + 1 < n && r.mode[e + 1] === 2) e++;
    const a = Math.max(0, k - 1);
    const b = Math.min(n - 1, e + 1);
    const sa = r.pts[a * 4 + 3];
    const sb = r.pts[b * 4 + 3];
    const ya = a === k ? yd[k] : y[a];
    const yb = b === e ? yd[e] : y[b];
    for (let q = k; q <= e; q++) {
      const u = sb > sa ? (r.pts[q * 4 + 3] - sa) / (sb - sa) : 0;
      y[q] = ya + (yb - ya) * u;
    }
    k = e + 1;
  }
  const p = new Float64Array(n * 3);
  const s = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    p[k * 3] = r.pts[k * 4];
    p[k * 3 + 1] = y[k];
    p[k * 3 + 2] = r.pts[k * 4 + 2];
    s[k] = r.pts[k * 4 + 3];
  }
  // the far path: the fine path's heights closed again at a larger radius, then x, y, z smoothed by a
  // Gaussian whose σ shrinks toward the route's ends (the start / end points stay exact)
  const Rc = Math.max(0, Math.round(FAR_CLOSE_KM / spacing));
  const yf = new Float64Array(n);
  for (let k = 0; k < n; k++) yf[k] = p[k * 3 + 1];
  const yc = closing(yf, Rc);
  const pc = new Float64Array(n * 3);
  const sgc = FAR_SIGMA_KM / spacing;
  for (let k = 0; k < n; k++) {
    const sk = Math.min(sgc, k / 3, (n - 1 - k) / 3);
    const g = Math.ceil(sk * 3);
    let ax = 0;
    let ay = 0;
    let az = 0;
    let ws = 0;
    for (let j = -g; j <= g; j++) {
      const q = k + j;
      const wj = sk > 0 ? Math.exp(-0.5 * (j / sk) ** 2) : 1;
      ax += wj * p[q * 3];
      ay += wj * yc[q];
      az += wj * p[q * 3 + 2];
      ws += wj;
    }
    pc[k * 3] = ax / ws;
    pc[k * 3 + 1] = ay / ws;
    pc[k * 3 + 2] = az / ws;
  }
  return { count: n, length: r.length, p, pc, s, mode: r.mode };
}

/** Morphological closing (max then min over ±R samples). */
function closing(y: Float64Array, R: number): Float64Array {
  const n = y.length;
  const dil = new Float64Array(n);
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let m = -Infinity;
    for (let j = Math.max(0, k - R); j <= Math.min(n - 1, k + R); j++) m = Math.max(m, y[j]);
    dil[k] = m;
  }
  for (let k = 0; k < n; k++) {
    let m = Infinity;
    for (let j = Math.max(0, k - R); j <= Math.min(n - 1, k + R); j++) m = Math.min(m, dil[j]);
    out[k] = m;
  }
  return out;
}

/**
 * Render-path position at arc length s (linear between samples; uniform spacing), world units: the near
 * path morphed toward the far one by 1 − wNear (as the vertex shader does).
 */
export function pathAt(path: RibbonPath, s: number, wNear = 1, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const n = path.count;
  const f = Math.min(n - 1, Math.max(0, path.length > 0 ? (s / path.length) * (n - 1) : 0));
  const i = Math.min(n - 2, Math.floor(f));
  const u = f - i;
  for (let c = 0; c < 3; c++) {
    const near = path.p[i * 3 + c] + (path.p[(i + 1) * 3 + c] - path.p[i * 3 + c]) * u;
    const far = path.pc[i * 3 + c] + (path.pc[(i + 1) * 3 + c] - path.pc[i * 3 + c]) * u;
    out[c] = far + (near - far) * wNear;
  }
  return out;
}

/** Mode code (CompiledRoute.mode) at arc length s (the nearer sample). */
export function pathModeAt(path: RibbonPath, s: number): number {
  const n = path.count;
  const f = Math.min(n - 1, Math.max(0, path.length > 0 ? (s / path.length) * (n - 1) : 0));
  return path.mode[Math.round(f)];
}
