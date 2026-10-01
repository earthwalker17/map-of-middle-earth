import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, ClampToEdgeWrapping, RGBAFormat, UnsignedByteType } from 'three/webgpu';
import { rand } from '../core/rng.ts';

/**
 * The EffectsSystem's two small textures, generated on the CPU at init from rand(seed, …) — deterministic,
 * no files:
 *  - the PUFF ATLAS (256², 4×4 frames of 64²): R = density of a billowing smoke puff (a cluster of soft
 *    lobes eroded by fbm, exactly 0 at the frame border), G/B = its bump normal (x, y in the frame,
 *    0.5 = flat), A = a finer "wisp" density. Mipmapped (the frames stay 0 at their borders, so the
 *    levels do not bleed for the first few mips).
 *  - the FX NOISE (128², tileable): four fbm octave sets (R period 8 lattice cells, G 4, B 16, A 32 —
 *    the falls' streaks, the mist cards, the beam's ripples).
 */

export const ATLAS = { size: 256, frames: 4, cell: 64 } as const;
export const NOISE_SIZE = 128;

/** periodic value noise from a lattice table (period × period), smoothstep-interpolated */
function lattice(seed: number, period: number): Float32Array {
  const t = new Float32Array(period * period);
  for (let j = 0; j < period; j++) for (let i = 0; i < period; i++) t[j * period + i] = rand(seed, i, j);
  return t;
}

function noiseAt(t: Float32Array, period: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const m = (a: number) => ((a % period) + period) % period;
  const x0 = m(xi);
  const x1 = m(xi + 1);
  const y0 = m(yi) * period;
  const y1 = m(yi + 1) * period;
  const a = t[y0 + x0] + (t[y0 + x1] - t[y0 + x0]) * u;
  const b = t[y1 + x0] + (t[y1 + x1] - t[y1 + x0]) * u;
  return a + (b - a) * v;
}

/** fbm in [0, 1) over a tileable domain: `x, y` in lattice cells of the base octave */
function fbm(tables: Float32Array[], periods: number[], x: number, y: number): number {
  let s = 0;
  let w = 0.5;
  let tot = 0;
  for (let o = 0; o < tables.length; o++) {
    const f = 1 << o;
    s += w * noiseAt(tables[o], periods[o], x * f, y * f);
    tot += w;
    w *= 0.5;
  }
  return s / tot;
}

/** The puff atlas pixels (RGBA8, 256²). Pure function of the seed. */
export function puffAtlasPixels(seed: number): Uint8Array {
  const { size, frames, cell } = ATLAS;
  const px = new Uint8Array(size * size * 4);
  const P = 8;
  const oct = [0, 1, 2, 3].map((o) => lattice(seed + 101 * o, P << o));
  const per = [0, 1, 2, 3].map((o) => P << o);
  const dens = new Float32Array(cell * cell);
  const wisp = new Float32Array(cell * cell);
  for (let f = 0; f < frames * frames; f++) {
    // lobes: a cluster of soft blobs, heavier toward the middle
    const n = 6 + Math.floor(rand(seed, f, 0) * 5);
    const lobes: [number, number, number, number][] = [];
    for (let b = 0; b < n; b++) {
      const ang = rand(seed, f * 31 + b, 1) * Math.PI * 2;
      const r = 0.5 * Math.sqrt(rand(seed, f * 31 + b, 2));
      lobes.push([r * Math.cos(ang), r * Math.sin(ang) * 0.85, 0.22 + 0.22 * rand(seed, f * 31 + b, 3), 0.6 + 0.4 * rand(seed, f * 31 + b, 4)]);
    }
    const ox = rand(seed, f, 5) * 64;
    const oy = rand(seed, f, 6) * 64;
    let mx = 1e-6;
    let mw = 1e-6;
    for (let j = 0; j < cell; j++)
      for (let i = 0; i < cell; i++) {
        const x = ((i + 0.5) / cell) * 2 - 1;
        const y = ((j + 0.5) / cell) * 2 - 1;
        let d = 0;
        for (const [cx, cy, r, w] of lobes) d += w * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (r * r));
        const rr = Math.hypot(x, y);
        const win = 1 - smooth(0.7, 0.98, rr);
        const nse = fbm(oct, per, x * 1.6 + ox, y * 1.6 + oy);
        // cauliflower erosion: the noise eats the thin parts, the lobes' cores survive
        const v = Math.max(0, d * (0.5 + 1.0 * nse) - 0.16) * win;
        dens[j * cell + i] = v;
        if (v > mx) mx = v;
        const wv = Math.max(0, fbm(oct, per, x * 3.1 + oy, y * 3.1 + ox) - 0.42) * win * Math.min(1, d);
        wisp[j * cell + i] = wv;
        if (wv > mw) mw = wv;
      }
    const fx = (f % frames) * cell;
    const fy = Math.floor(f / frames) * cell;
    const H = (i: number, j: number) => dens[Math.min(cell - 1, Math.max(0, j)) * cell + Math.min(cell - 1, Math.max(0, i))] / mx;
    for (let j = 0; j < cell; j++)
      for (let i = 0; i < cell; i++) {
        const d = H(i, j);
        // bump normal of the density as a height field (+ a little of a sphere's: the puff is round)
        const gx = (H(i + 1, j) - H(i - 1, j)) * (cell / 4);
        const gy = (H(i, j + 1) - H(i, j - 1)) * (cell / 4);
        const x = ((i + 0.5) / cell) * 2 - 1;
        const y = ((j + 0.5) / cell) * 2 - 1;
        let nx = -gx * 0.5 + x * 0.45;
        let ny = -gy * 0.5 + y * 0.45;
        const nl = Math.hypot(nx, ny, 1);
        nx /= nl;
        ny /= nl;
        const o = ((fy + j) * size + fx + i) * 4;
        px[o] = Math.round(255 * Math.pow(Math.min(1, d), 1.1));
        px[o + 1] = Math.round(255 * (nx * 0.5 + 0.5));
        px[o + 2] = Math.round(255 * (ny * 0.5 + 0.5));
        px[o + 3] = Math.round(255 * Math.min(1, wisp[j * cell + i] / mw));
      }
  }
  return px;
}

/** The fx noise pixels (RGBA8, 128², tileable). Pure function of the seed. */
export function fxNoisePixels(seed: number): Uint8Array {
  const N = NOISE_SIZE;
  const px = new Uint8Array(N * N * 4);
  const sets = [8, 4, 16, 32].map((base, ch) => {
    const per = [0, 1, 2].map((o) => base << o);
    return { base, per, oct: per.map((p, o) => lattice(seed + 977 * ch + 13 * o, p)) };
  });
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const o = (j * N + i) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const s = sets[ch];
        const v = fbm(s.oct, s.per, (i / N) * s.base, (j / N) * s.base);
        // stretch the fbm's narrow range to ~0..1
        px[o + ch] = Math.round(255 * Math.min(1, Math.max(0, (v - 0.5) * 2.2 + 0.5)));
      }
    }
  return px;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function createPuffAtlas(seed: number): DataTexture {
  const t = new DataTexture(puffAtlasPixels(seed), ATLAS.size, ATLAS.size, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  t.name = 'fx-puff-atlas';
  return t;
}

export function createFxNoise(seed: number): DataTexture {
  const t = new DataTexture(fxNoisePixels(seed), NOISE_SIZE, NOISE_SIZE, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  t.name = 'fx-noise';
  return t;
}
