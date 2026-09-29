import { Data3DTexture, LinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three/webgpu';
import { rand } from '../core/rng.ts';

/**
 * Tileable 3D "foam clump" field for the foliage micro structure, precomputed once on the CPU so
 * the fragment shader needs one texture tap per scale instead of a cellular search per pixel.
 *
 * The field is a jittered 3D grid of balls of varied radius (the foam / lichen clumps of a
 * bigature tree): A = clump height 0 (crease) … 1 (ball top), RGB = its gradient (per cell unit)
 * encoded 0.5 + g / 8 — the shader tilts the macro normal away from the ball centre with it.
 * Several neighbours blend softly, so clumps merge into clusters instead of a regular cell
 * network. Period PERIOD cells, SIZE texels per side, repeat wrapping; a pure function of `seed`.
 */
export const FOAM_PERIOD = 8;
const SIZE = 64;

export function createFoamTexture(seed: number): Data3DTexture {
  const P = FOAM_PERIOD;
  // feature point + radius per cell
  const fx = new Float32Array(P * P * P);
  const fy = new Float32Array(P * P * P);
  const fz = new Float32Array(P * P * P);
  const fr = new Float32Array(P * P * P);
  for (let k = 0; k < P; k++)
    for (let j = 0; j < P; j++)
      for (let i = 0; i < P; i++) {
        const c = (k * P + j) * P + i;
        const id = c + 1;
        fx[c] = i + 0.15 + 0.7 * rand(seed, id, 1);
        fy[c] = j + 0.15 + 0.7 * rand(seed, id, 2);
        fz[c] = k + 0.15 + 0.7 * rand(seed, id, 3);
        fr[c] = 0.5 + 0.38 * rand(seed, id, 4);
      }
  const data = new Uint8Array(SIZE * SIZE * SIZE * 4);
  const s = P / SIZE;
  const SOFT = 10; // smooth-max sharpness of the ball union
  const wrap = (a: number) => ((a % P) + P) % P;
  const hs = new Float64Array(27);
  const gs = new Float64Array(81);
  for (let z = 0; z < SIZE; z++)
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const qx = (x + 0.5) * s;
        const qy = (y + 0.5) * s;
        const qz = (z + 0.5) * s;
        const ci = Math.floor(qx);
        const cj = Math.floor(qy);
        const ck = Math.floor(qz);
        // soft max over the neighbours' ball heights, with the matching gradient
        let wsum = 0;
        let hsum = 0;
        let gx = 0;
        let gy = 0;
        let gz = 0;
        let hmax = -Infinity;
        let n = 0;
        for (let dk = -1; dk <= 1; dk++)
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++, n++) {
              const ii = ci + di;
              const jj = cj + dj;
              const kk = ck + dk;
              const wi = wrap(ii);
              const wj = wrap(jj);
              const wk = wrap(kk);
              const c = (wk * P + wj) * P + wi;
              // feature point relative to this (unwrapped) neighbour cell
              const dx = qx - (fx[c] - wi + ii);
              const dy = qy - (fy[c] - wj + jj);
              const dz = qz - (fz[c] - wk + kk);
              const r2 = fr[c] * fr[c];
              const h = 1 - (dx * dx + dy * dy + dz * dz) / r2;
              hs[n] = h;
              gs[n * 3] = (-2 * dx) / r2;
              gs[n * 3 + 1] = (-2 * dy) / r2;
              gs[n * 3 + 2] = (-2 * dz) / r2;
              if (h > hmax) hmax = h;
            }
        for (let n = 0; n < 27; n++) {
          const wgt = Math.exp(SOFT * (hs[n] - hmax));
          wsum += wgt;
          hsum += wgt * hs[n];
          gx += wgt * gs[n * 3];
          gy += wgt * gs[n * 3 + 1];
          gz += wgt * gs[n * 3 + 2];
        }
        const h = Math.max(0, Math.min(1, hsum / wsum));
        const enc = (g: number) => Math.max(0, Math.min(255, Math.round((0.5 + g / wsum / 8) * 255)));
        const o = ((z * SIZE + y) * SIZE + x) * 4;
        data[o] = enc(gx);
        data[o + 1] = enc(gy);
        data[o + 2] = enc(gz);
        data[o + 3] = Math.round(h * 255);
      }
  const tex = new Data3DTexture(data, SIZE, SIZE, SIZE);
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = RepeatWrapping;
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}
