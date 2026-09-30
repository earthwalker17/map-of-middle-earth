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
 * network. Period FOAM_PERIOD cells, SIZE texels per side (6 per cell), repeat wrapping; a pure
 * function of `seed` (≈ 0.15 s on the CPU, once per session).
 */
export const FOAM_PERIOD = 8;
const SIZE = 48;
/** balls per cell: one clump and a smaller satellite, so clumps cluster irregularly */
const M = 2;

export function createFoamTexture(seed: number): Data3DTexture {
  const P = FOAM_PERIOD;
  // feature points + radii per cell
  const fx = new Float32Array(P * P * P * M);
  const fy = new Float32Array(P * P * P * M);
  const fz = new Float32Array(P * P * P * M);
  const fr = new Float32Array(P * P * P * M);
  for (let k = 0; k < P; k++)
    for (let j = 0; j < P; j++)
      for (let i = 0; i < P; i++)
        for (let m = 0; m < M; m++) {
          const c = ((k * P + j) * P + i) * M + m;
          const id = c + 1;
          fx[c] = i + 0.08 + 0.84 * rand(seed, id, 1);
          fy[c] = j + 0.08 + 0.84 * rand(seed, id, 2);
          fz[c] = k + 0.08 + 0.84 * rand(seed, id, 3);
          fr[c] = m === 0 ? 0.45 + 0.42 * rand(seed, id, 4) : 0.26 + 0.3 * rand(seed, id, 4);
        }
  const data = new Uint8Array(SIZE * SIZE * SIZE * 4);
  const T = SIZE / P; // texels per cell
  const SOFT = 10; // smooth-max sharpness of the ball union
  const wrap = (a: number) => ((a % P) + P) % P;
  const NB = 27 * M;
  // the neighbourhood is the same for every texel of a cell: gather it once per cell
  const nx = new Float64Array(NB);
  const ny = new Float64Array(NB);
  const nz = new Float64Array(NB);
  const nr2 = new Float64Array(NB);
  const hs = new Float64Array(NB);
  for (let ck = 0; ck < P; ck++)
    for (let cj = 0; cj < P; cj++)
      for (let ci = 0; ci < P; ci++) {
        let n = 0;
        for (let dk = -1; dk <= 1; dk++)
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
              const wi = wrap(ci + di);
              const wj = wrap(cj + dj);
              const wk = wrap(ck + dk);
              for (let m = 0; m < M; m++, n++) {
                const c = ((wk * P + wj) * P + wi) * M + m;
                // feature point relative to this (unwrapped) neighbour cell
                nx[n] = fx[c] - wi + ci + di;
                ny[n] = fy[c] - wj + cj + dj;
                nz[n] = fz[c] - wk + ck + dk;
                nr2[n] = fr[c] * fr[c];
              }
            }
        for (let tz = 0; tz < T; tz++)
          for (let ty = 0; ty < T; ty++)
            for (let tx = 0; tx < T; tx++) {
              const qx = ci + (tx + 0.5) / T;
              const qy = cj + (ty + 0.5) / T;
              const qz = ck + (tz + 0.5) / T;
              let hmax = -Infinity;
              for (let q = 0; q < NB; q++) {
                const dx = qx - nx[q];
                const dy = qy - ny[q];
                const dz = qz - nz[q];
                const h = 1 - (dx * dx + dy * dy + dz * dz) / nr2[q];
                hs[q] = h;
                if (h > hmax) hmax = h;
              }
              // soft max over the neighbours' ball heights, with the matching gradient
              let wsum = 0;
              let hsum = 0;
              let gx = 0;
              let gy = 0;
              let gz = 0;
              for (let q = 0; q < NB; q++) {
                const dh = hs[q] - hmax;
                if (dh < -1.2) continue; // weight < e^-12
                const wgt = Math.exp(SOFT * dh);
                const k = (-2 * wgt) / nr2[q];
                wsum += wgt;
                hsum += wgt * hs[q];
                gx += k * (qx - nx[q]);
                gy += k * (qy - ny[q]);
                gz += k * (qz - nz[q]);
              }
              const h = Math.max(0, Math.min(1, hsum / wsum));
              const enc = (g: number) => Math.max(0, Math.min(255, Math.round((0.5 + g / wsum / 8) * 255)));
              const o = (((ck * T + tz) * SIZE + (cj * T + ty)) * SIZE + (ci * T + tx)) * 4;
              data[o] = enc(gx);
              data[o + 1] = enc(gy);
              data[o + 2] = enc(gz);
              data[o + 3] = Math.round(h * 255);
            }
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
