/**
 * Film curve toolkit (S5): easing, monotone tracks, quintic Hermite blends, angle unwrapping, the
 * van Wijk–Nuij zoom / pan path and the 1-D filters the rig bakes its safety tracks with. Pure math —
 * no three.js, no DOM — so Node (checks) and the page compile identical numbers.
 */

// ───────────────────────────── easing ─────────────────────────────

/** smootherstep E(x) = x³(10 − 15x + 6x²), clamped to [0, 1] (C2: zero slope and curvature at both ends). */
export function smootherstep(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * x * (x * (6 * x - 15) + 10);
}

/** dE/dx = 30x²(1 − x)² (peak 1.875 at x = ½). */
export function smootherstepDeriv(x: number): number {
  if (x <= 0 || x >= 1) return 0;
  const y = x * (1 - x);
  return 30 * y * y;
}

/** Peak of dE/dx: a move whose eased path length is S peaks at 1.875·S/Δ. */
export const SMOOTHERSTEP_PEAK = 1.875;

/** smoothstep x²(3 − 2x), clamped. */
export function smoothstep(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ───────────────────────────── angles ─────────────────────────────

/** Wrap degrees to [−180, 180). */
export function wrap180(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

/** The representative of `deg` (mod 360) closest to `ref`: unwrap a sequence of azimuths. */
export function unwrapNear(deg: number, ref: number): number {
  return ref + wrap180(deg - ref);
}

/** Unwrap a sequence of angles (degrees) so consecutive values differ by less than 180°. */
export function unwrap(degs: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < degs.length; i++) out.push(i === 0 ? degs[0] : unwrapNear(degs[i], out[i - 1]));
  return out;
}

// ───────────────────────────── quintic Hermite ─────────────────────────────

/**
 * Quintic Hermite basis with zero end accelerations: f(x) = p0·H0 + Δ·v0·H1 + Δ·v1·H4 + p1·H5 runs from
 * (p0, slope v0) to (p1, slope v1) over a span of Δ seconds (x = (t − t0)/Δ), curvature 0 at both ends.
 */
export function hermite5(x: number): [h0: number, h1: number, h4: number, h5: number] {
  const x3 = x * x * x;
  const x4 = x3 * x;
  const x5 = x4 * x;
  return [1 - 10 * x3 + 15 * x4 - 6 * x5, x - 6 * x3 + 8 * x4 - 3 * x5, -4 * x3 + 7 * x4 - 3 * x5, 10 * x3 - 15 * x4 + 6 * x5];
}

/** The quintic Hermite blend from (p0, v0) to (p1, v1) over Δ seconds at x ∈ [0, 1]. */
export function hermite5Blend(p0: number, v0: number, p1: number, v1: number, dur: number, x: number): number {
  const [h0, h1, h4, h5] = hermite5(clamp(x, 0, 1));
  return p0 * h0 + dur * v0 * h1 + dur * v1 * h4 + p1 * h5;
}

// ───────────────────────────── monotone cubic (PCHIP) ─────────────────────────────

/** A Fritsch–Carlson monotone cubic through (xs, ys): never overshoots, monotone data stays monotone. */
export interface Pchip {
  xs: Float64Array;
  ys: Float64Array;
  /** slopes at the knots */
  ms: Float64Array;
}

export function pchip(xs: readonly number[], ys: readonly number[]): Pchip {
  const n = xs.length;
  if (n !== ys.length || n < 1) throw new Error('pchip: need matching non-empty knots');
  for (let i = 1; i < n; i++) if (!(xs[i] > xs[i - 1])) throw new Error(`pchip: knots must increase (x[${i}] = ${xs[i]} ≤ ${xs[i - 1]})`);
  const ms = new Float64Array(n);
  if (n >= 2) {
    const h: number[] = [];
    const d: number[] = [];
    for (let i = 0; i + 1 < n; i++) {
      h.push(xs[i + 1] - xs[i]);
      d.push((ys[i + 1] - ys[i]) / h[i]);
    }
    // interior: weighted harmonic mean of the secants (Fritsch–Butland form of Fritsch–Carlson)
    for (let i = 1; i + 1 < n; i++) {
      if (d[i - 1] * d[i] <= 0) ms[i] = 0;
      else {
        const w1 = 2 * h[i] + h[i - 1];
        const w2 = h[i] + 2 * h[i - 1];
        ms[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
      }
    }
    // ends: the one-sided three-point estimate, limited so the end interval stays monotone
    const endSlope = (h0: number, h1: number, d0: number, d1: number): number => {
      let m = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
      if (Math.sign(m) !== Math.sign(d0)) m = 0;
      else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(m) > Math.abs(3 * d0)) m = 3 * d0;
      return m;
    };
    if (n === 2) ms[0] = ms[1] = d[0];
    else {
      ms[0] = endSlope(h[0], h[1], d[0], d[1]);
      ms[n - 1] = endSlope(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
    }
  }
  return { xs: Float64Array.from(xs), ys: Float64Array.from(ys), ms };
}

/**
 * A monotone cubic Hermite through (xs, ys) with prescribed knot slopes (null → the Fritsch–Carlson estimate),
 * so monotone data stays monotone. Prescribed slopes are KEPT: the Fritsch–Carlson limiter (α = m0/d,
 * β = m1/d ≥ 0, α² + β² ≤ 9) only rescales free slopes, and an interval whose prescribed slopes still lie
 * outside that circle (a secant far below its neighbours' rates) gets two interior knots instead: it leaves
 * its start at m0 over a short run (secant m0/2), rises across the middle with zero end slopes and arrives at
 * m1 (secant m1/2) — every piece monotone, C1 throughout. So an interval whose two slopes equal its secant
 * stays exactly linear (the film's holds) whatever its neighbours do. Only a slope that no monotone interval
 * can meet — against its secant's sign, or non-zero beside a flat interval — is zeroed; its knot is listed
 * in `bent` (prescribed knots only).
 */
export function monotoneHermite(xs: readonly number[], ys: readonly number[], slopes: readonly (number | null)[]): Pchip & { bent: number[] } {
  const n = xs.length;
  const ms = Array.from(pchip(xs, ys).ms);
  const fixed = xs.map((_, i) => slopes[i] !== null && slopes[i] !== undefined);
  for (let i = 0; i < n; i++) if (fixed[i]) ms[i] = slopes[i]!;
  const sec = (i: number) => (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  // 1 · slopes no monotone interval can meet
  const bent = new Set<number>();
  for (let i = 0; i + 1 < n; i++) {
    const d = sec(i);
    for (const j of [i, i + 1])
      if (ms[j] !== 0 && (d === 0 || Math.sign(ms[j]) !== Math.sign(d))) {
        if (fixed[j]) bent.add(j);
        ms[j] = 0;
      }
  }
  // 2 · Fritsch–Carlson on the free slopes (a prescribed one stays)
  for (let i = 0; i + 1 < n; i++) {
    const d = sec(i);
    if (d === 0) continue;
    const a = ms[i] / d;
    const b = ms[i + 1] / d;
    if (a * a + b * b <= 9) continue;
    if (!fixed[i] && !fixed[i + 1]) {
      const tau = 3 / Math.sqrt(a * a + b * b);
      ms[i] = tau * a * d;
      ms[i + 1] = tau * b * d;
    } else if (!fixed[i]) ms[i] = Math.sqrt(Math.max(0, 9 - b * b)) * d;
    else if (!fixed[i + 1]) ms[i + 1] = Math.sqrt(Math.max(0, 9 - a * a)) * d;
  }
  // 3 · intervals still outside the circle (prescribed slopes): two interior knots with zero slope
  const X: number[] = [];
  const Y: number[] = [];
  const M: number[] = [];
  for (let i = 0; i < n; i++) {
    X.push(xs[i]);
    Y.push(ys[i]);
    M.push(ms[i]);
    if (i + 1 >= n) break;
    const d = sec(i);
    if (d === 0) continue;
    const a = ms[i] / d;
    const b = ms[i + 1] / d;
    if (a * a + b * b <= 9 + 1e-9) continue;
    const h = xs[i + 1] - xs[i];
    // the runs at the ends: ≤ h/4 each, and short enough that the middle keeps ≥ half the rise
    const ha = Math.min(h / 4, (d * h) / (ms[i] + ms[i + 1]));
    X.push(xs[i] + ha, xs[i + 1] - ha);
    Y.push(ys[i] + (ms[i] * ha) / 2, ys[i + 1] - (ms[i + 1] * ha) / 2);
    M.push(0, 0);
  }
  return { xs: Float64Array.from(X), ys: Float64Array.from(Y), ms: Float64Array.from(M), bent: [...bent].sort((a, b) => a - b) };
}

/** Evaluate a PCHIP track (held constant outside the knots). */
export function pchipAt(p: Pchip, x: number): number {
  const { xs, ys, ms } = p;
  const n = xs.length;
  if (n === 1 || x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const h = xs[hi] - xs[lo];
  const u = (x - xs[lo]) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * ys[lo] + (u3 - 2 * u2 + u) * h * ms[lo] + (-2 * u3 + 3 * u2) * ys[hi] + (u3 - u2) * h * ms[hi];
}

// ───────────────────────────── van Wijk–Nuij zoom / pan ─────────────────────────────

/**
 * The optimal zoom / pan path of van Wijk & Nuij ("Smooth and efficient zooming and panning", 2003) from
 * view width w0 to w1 over a pan distance L, trade-off ρ (≈ 1.4: zoom out ~ √2 harder than panning).
 * σ ∈ [0, S] is the path parameter (S = the path length in the paper's metric); u(σ) the pan distance
 * travelled, w(σ) the view width.
 */
export interface ZoomPanPath {
  w0: number;
  w1: number;
  L: number;
  rho: number;
  S: number;
  /** pan distance at σ (0 … L) */
  u(sigma: number): number;
  /** view width at σ (w0 … w1, through a zoom-out when the pan is long) */
  w(sigma: number): number;
  /** true when the pan is negligible against the widths (pure zoom: u ≡ 0) */
  degenerate: boolean;
}

export function zoomPanPath(w0: number, w1: number, L: number, rho: number): ZoomPanPath {
  if (!(w0 > 0 && w1 > 0)) throw new Error(`zoomPanPath: widths must be positive (${w0}, ${w1})`);
  const rho2 = rho * rho;
  if (L < 1e-3 * Math.max(w0, w1)) {
    const k = w1 >= w0 ? 1 : -1;
    const S = Math.abs(Math.log(w1 / w0)) / rho;
    return { w0, w1, L, rho, S, degenerate: true, u: () => 0, w: (s) => w0 * Math.exp(k * rho * Math.min(Math.max(s, 0), S)) };
  }
  const b0 = (w1 * w1 - w0 * w0 + rho2 * rho2 * L * L) / (2 * w0 * rho2 * L);
  const b1 = (w1 * w1 - w0 * w0 - rho2 * rho2 * L * L) / (2 * w1 * rho2 * L);
  // r = ln(−b + √(b² + 1)) = −asinh(b), the stable form for large |b|
  const r0 = -Math.asinh(b0);
  const r1 = -Math.asinh(b1);
  const S = (r1 - r0) / rho;
  const c0 = Math.cosh(r0);
  const s0 = Math.sinh(r0);
  return {
    w0,
    w1,
    L,
    rho,
    S,
    degenerate: false,
    u: (s) => (w0 / rho2) * (c0 * Math.tanh(rho * s + r0) - s0),
    w: (s) => (w0 * c0) / Math.cosh(rho * s + r0),
  };
}

// ───────────────────────────── 1-D filters (uniform grids) ─────────────────────────────

/** prefix counts of non-zero samples (windows of zeros filter to exactly zero without work) */
function nonZeroPrefix(src: ArrayLike<number>): Int32Array {
  const p = new Int32Array(src.length + 1);
  for (let i = 0; i < src.length; i++) p[i + 1] = p[i] + (src[i] !== 0 ? 1 : 0);
  return p;
}

/** Running max over ±r samples (clamped at the ends). */
export function runningMax(src: ArrayLike<number>, r: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n);
  const nz = nonZeroPrefix(src);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - r);
    const b = Math.min(n - 1, i + r);
    if (nz[b + 1] === nz[a]) continue; // all zero → 0
    let m = -Infinity;
    for (let j = a; j <= b; j++) if (src[j] > m) m = src[j];
    out[i] = m;
  }
  return out;
}

/** Normalised Gaussian kernel of σ samples, truncated at ±3σ (at least ±1 tap). */
export function gaussianKernel(sigma: number): Float64Array {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = sigma > 0 ? Math.exp(-(i * i) / (2 * sigma * sigma)) : i === 0 ? 1 : 0;
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** Gaussian smoothing on a uniform grid with clamped ends (an edge sample repeats). */
export function gaussianSmooth(src: ArrayLike<number>, sigma: number): Float64Array {
  const n = src.length;
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) / 2;
  const out = new Float64Array(n);
  const nz = nonZeroPrefix(src);
  for (let i = 0; i < n; i++) {
    if (nz[Math.min(n, i + r + 1)] === nz[Math.max(0, i - r)]) continue; // all zero → 0
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += k[j + r] * src[Math.min(n - 1, Math.max(0, i + j))];
    out[i] = acc;
  }
  return out;
}

// ───────────────────────────── baked tracks ─────────────────────────────

/** A scalar track sampled at a fixed rate from t = 0 (the rig's compile-time bakes). */
export interface Track {
  hz: number;
  v: Float64Array;
}

/** Catmull-Rom (C1, interpolating) read of a baked track at time t (clamped). */
export function trackAt(tr: Track, t: number): number {
  const v = tr.v;
  const n = v.length;
  if (n === 1) return v[0];
  const f = Math.min(n - 1, Math.max(0, t * tr.hz));
  const i = Math.min(n - 2, Math.floor(f));
  const u = f - i;
  const p0 = v[Math.max(0, i - 1)];
  const p1 = v[i];
  const p2 = v[i + 1];
  const p3 = v[Math.min(n - 1, i + 2)];
  // exact for constant runs (all-zero safety tracks stay exactly zero)
  if (p0 === p1 && p1 === p2 && p2 === p3) return p1;
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}
