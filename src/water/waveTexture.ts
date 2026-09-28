import {
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  UnsignedByteType,
} from 'three/webgpu';
import { rand } from '../core/rng.ts';

/**
 * Tileable wave-slope texture with LEAN moments (Olano & Baker 2010):
 *   R, G = slope (dh/du, dh/dv), normalised to unit RMS per axis
 *   B, A = second moments (dh/du)², (dh/dv)²
 * Mip levels are box-filtered on the CPU, so a trilinear/anisotropic fetch returns the mean slope
 * AND its variance over the pixel footprint: variance = E[s²] − E[s]². The water shader turns that
 * variance into GGX roughness, so sub-pixel ripples become sun glitter instead of aliasing — at any
 * distance, deterministically, and without shimmer between accumulated sub-samples.
 *
 * The height field is a sum of sinusoids with integer wave vectors (exactly tileable), a k^-2
 * height spectrum (slope ∝ 1/k, i.e. every octave contributes similar slope energy), spread around
 * +u (the "wind" axis; the shader rotates the texture into env.wind).
 */
export interface WaveTextureOptions {
  size?: number;
  waves?: number;
  seed?: number;
  /** min/max wave number (cycles per tile) */
  kMin?: number;
  kMax?: number;
}

/**
 * Tileable smooth value noise, one octave per channel (4, 8, 16, 32 cells per tile), RGBA8 with
 * box-filtered CPU mips. Replaces per-pixel procedural noise in the water shader (one fetch gives
 * four scales of variation).
 */
export function createNoiseTexture(size = 256, seed = 0x6e5): DataTexture {
  const N = size;
  const cells = [4, 8, 16, 32];
  let cur = new Float32Array(N * N * 4);
  cells.forEach((C, ch) => {
    const lat = new Float32Array(C * C);
    for (let i = 0; i < C * C; i++) lat[i] = rand(seed, `noise-${ch}`, i);
    const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * C;
        const fy = (y / N) * C;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fade(fx - x0);
        const ty = fade(fy - y0);
        const g = (i: number, j: number) => lat[((j + C) % C) * C + ((i + C) % C)];
        const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * tx;
        const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * tx;
        cur[(y * N + x) * 4 + ch] = a + (b - a) * ty;
      }
  });
  const toU8 = (f: Float32Array) => {
    const out = new Uint8Array(f.length);
    for (let i = 0; i < f.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(f[i] * 255)));
    return out;
  };
  const mipmaps: { data: Uint8Array; width: number; height: number }[] = [{ data: toU8(cur), width: N, height: N }];
  let s = N;
  while (s > 1) {
    const ns = s >> 1;
    const next = new Float32Array(ns * ns * 4);
    for (let y = 0; y < ns; y++)
      for (let x = 0; x < ns; x++)
        for (let c = 0; c < 4; c++)
          next[(y * ns + x) * 4 + c] =
            0.25 * (cur[(2 * y * s + 2 * x) * 4 + c] + cur[(2 * y * s + 2 * x + 1) * 4 + c] + cur[((2 * y + 1) * s + 2 * x) * 4 + c] + cur[((2 * y + 1) * s + 2 * x + 1) * 4 + c]);
    cur = next;
    s = ns;
    mipmaps.push({ data: toU8(cur), width: s, height: s });
  }
  const tex = new DataTexture(mipmaps[0].data, N, N, RGBAFormat, UnsignedByteType);
  tex.mipmaps = mipmaps as unknown as typeof tex.mipmaps;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = NoColorSpace;
  tex.name = 'water-noise';
  tex.needsUpdate = true;
  return tex;
}

export function createWaveSlopeTexture(opts: WaveTextureOptions = {}): DataTexture {
  const N = opts.size ?? 256;
  const waves = opts.waves ?? 180;
  const seed = opts.seed ?? 0x5ea;
  const kMin = opts.kMin ?? 2;
  const kMax = opts.kMax ?? 40;

  interface Comp {
    kx: number;
    ky: number;
    amp: number;
    phase: number;
  }
  const comps: Comp[] = [];
  for (let j = 0; comps.length < waves && j < waves * 8; j++) {
    const kmag = kMin * Math.pow(kMax / kMin, rand(seed, 'wave-k', j));
    // wind-aligned directional spread (cos^2-ish) plus a little isotropic energy
    const a = (rand(seed, 'wave-a', j) - 0.5) * Math.PI * 1.5;
    const kx = Math.round(kmag * Math.cos(a));
    const ky = Math.round(kmag * Math.sin(a));
    if (kx === 0 && ky === 0) continue;
    const km = Math.hypot(kx, ky);
    const c = Math.cos(Math.atan2(ky, kx));
    const spread = 0.2 + 0.8 * Math.max(0, c) ** 2;
    comps.push({ kx, ky, amp: spread / (km * km), phase: rand(seed, 'wave-p', j) * Math.PI * 2 });
  }

  // separable evaluation: sin(2π(kx·u + ky·v) + φ) = sin(a)cos(b) + cos(a)sin(b)
  const sx = new Float32Array(N * N);
  const sy = new Float32Array(N * N);
  const ca = new Float32Array(N);
  const sa = new Float32Array(N);
  const cb = new Float32Array(N);
  const sb = new Float32Array(N);
  for (const w of comps) {
    for (let i = 0; i < N; i++) {
      const a = (2 * Math.PI * w.kx * i) / N;
      const b = (2 * Math.PI * w.ky * i) / N + w.phase;
      ca[i] = Math.cos(a);
      sa[i] = Math.sin(a);
      cb[i] = Math.cos(b);
      sb[i] = Math.sin(b);
    }
    // h = amp cos(θ) → ∂h/∂u = −amp 2π kx sin(θ) (u in tiles)
    const gx = -w.amp * 2 * Math.PI * w.kx;
    const gy = -w.amp * 2 * Math.PI * w.ky;
    for (let y = 0; y < N; y++) {
      const cy = cb[y];
      const syy = sb[y];
      const row = y * N;
      for (let x = 0; x < N; x++) {
        const s = sa[x] * cy + ca[x] * syy;
        sx[row + x] += gx * s;
        sy[row + x] += gy * s;
      }
    }
  }
  let m2 = 0;
  for (let i = 0; i < N * N; i++) m2 += sx[i] * sx[i] + sy[i] * sy[i];
  const norm = 1 / Math.sqrt(m2 / (2 * N * N));

  // level 0 in float, then box-filtered mips of all four channels (moments stay consistent)
  let cur = new Float32Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const a = sx[i] * norm;
    const b = sy[i] * norm;
    cur[i * 4] = a;
    cur[i * 4 + 1] = b;
    cur[i * 4 + 2] = a * a;
    cur[i * 4 + 3] = b * b;
  }
  const toHalf = (f: Float32Array) => {
    const out = new Uint16Array(f.length);
    for (let i = 0; i < f.length; i++) out[i] = DataUtils.toHalfFloat(f[i]);
    return out;
  };
  const mipmaps: { data: Uint16Array; width: number; height: number }[] = [];
  let size = N;
  mipmaps.push({ data: toHalf(cur), width: size, height: size });
  while (size > 1) {
    const ns = size >> 1;
    const next = new Float32Array(ns * ns * 4);
    for (let y = 0; y < ns; y++)
      for (let x = 0; x < ns; x++)
        for (let c = 0; c < 4; c++) {
          const i00 = ((2 * y) * size + 2 * x) * 4 + c;
          const i01 = ((2 * y) * size + 2 * x + 1) * 4 + c;
          const i10 = ((2 * y + 1) * size + 2 * x) * 4 + c;
          const i11 = ((2 * y + 1) * size + 2 * x + 1) * 4 + c;
          next[(y * ns + x) * 4 + c] = 0.25 * (cur[i00] + cur[i01] + cur[i10] + cur[i11]);
        }
    cur = next;
    size = ns;
    mipmaps.push({ data: toHalf(cur), width: size, height: size });
  }

  const tex = new DataTexture(mipmaps[0].data, N, N, RGBAFormat, HalfFloatType);
  tex.mipmaps = mipmaps as unknown as typeof tex.mipmaps;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 8;
  tex.colorSpace = NoColorSpace;
  tex.name = 'water-wave-slopes';
  tex.needsUpdate = true;
  return tex;
}
