import { ClampToEdgeWrapping, DataTexture, LinearFilter, NoColorSpace, RGBAFormat, UnsignedByteType, Vector2, Vector4 } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import { env } from '../materials/environment.ts';
import { archOf, retires } from './archetypes.ts';

/**
 * Far canopy shell (S4 W2-C): far off, the forests are drawn by the terrain shader as a canopy surface
 * whose colour comes from the placed vegetation records, while the canopy-patch instances (archetypes
 * Canopy / ConiferStand) retire across the same distance band (VegetationSystem: their crowns sink into
 * the shell over the band, a pure function of the camera and viewport — see SHELL_NEAR_PX). Single trees,
 * hedges, clusters and emergent mallorns stay instances.
 *
 * W0 contract: the terrain material calls `canopyShell(p, footprintKm, forest)` in its forest-floor block
 * and mixes `albedo` in by `weight` and adds `dn·weight` to its normal.
 *
 * Data: one 512×307 RGBA8 texture over the world frame (`bakeCanopyShell`, at placement): rgb = mean sRGB
 * albedo of the retiring canopy records per texel (dilated into empty texels so bilinear filtering never
 * pulls black in), a = cover (patch count × cell area / texel area). The terrain samples it once (its one
 * allowed extra texture); the crown relief is two octaves of value noise with an analytic gradient.
 */

type N = TslNode;
const { If, clamp, dot, float, floor, fract, hash, length, max, min, mix, pow, select, smoothstep, sqrt, texture, uint, uniform, vec2, vec3 } = tsl;

/** Switch: off = no retirement, no shell (the S3 instanced forests everywhere). */
export const SHELL_ON = true;
/**
 * The hand-over band, in PIXELS of a canopy crown (≈ SHELL_CROWN_KM across): the canopy instances retire
 * while a crown shrinks from SHELL_NEAR_PX to SHELL_FAR_PX on screen, i.e. over the distances
 * SHELL_CROWN_KM · pxPerKm / px (720p, 35°: ≈ 114 … 196 km; 1080p: ≈ 171 … 293 km).
 *
 * (The brief's fixed 28–45 km band was built and rendered first: at those distances a canopy crown still
 * spans 25–40 px and the forest canopy stands ≈ 1 km above the ground — Mirkwood's and Fangorn's edges
 * lost their wall of trees and the shell read as a flat dark sheet / cobbles at grazing angles. Scaling the
 * band with the screen keeps every regional shot instanced and gives the shell the far views, where the
 * instances were sub-10-px blob carpets and the cost.)
 */
export const SHELL_CROWN_KM = 1.2;
export const SHELL_NEAR_PX = 12;
export const SHELL_FAR_PX = 7;
/** the band (km) for a view of `pxPerKm` screen pixels per km at 1 km distance */
export function shellBand(pxPerKm: number): [number, number] {
  return [(SHELL_CROWN_KM * pxPerKm) / SHELL_NEAR_PX, (SHELL_CROWN_KM * pxPerKm) / SHELL_FAR_PX];
}
/** the current band (near, far km): set per frame by the VegetationSystem (a pure function of the view) */
export const shellBandUniform = uniform(new Vector2(114, 196));
export const SHELL_W = 512;
export const SHELL_H = 307;
/**
 * Effective shell albedo vs the records' base colour, per vegetation kind (linear RGB): the instanced
 * crowns self-shadow (sub-crown undersides, cluster cavities, the floor between patches) and scatter
 * (wrap, translucency, Lórien's glow) in ways a flat lit surface cannot — calibrated against the S3
 * instanced forests in the same shots (veg-fangorn-close, veg-lorien-golden). Indexed by placement Kind.
 */
const KIND_RESPONSE: Record<number, [number, number, number]> = {
  1: [0.44, 0.52, 0.27], // Mirkwood
  2: [0.42, 0.5, 0.26], // Fangorn
  3: [0.95, 0.9, 0.44], // Lórien
};
const DEFAULT_RESPONSE: [number, number, number] = [0.46, 0.54, 0.28];
/** mean of the crown shading (lit tops / crevices) where the relief has faded out */
const SHELL_MEAN_LIT = 0.86;
/** crown dome grid (km per cell): the canopy patches' sub-crowns are ≈ 0.4–0.9 km across */
const CROWN_CELL = 1.0;

const shellData = new Uint8Array(SHELL_W * SHELL_H * 4);
export const canopyTexture = new DataTexture(shellData, SHELL_W, SHELL_H, RGBAFormat, UnsignedByteType);
canopyTexture.wrapS = ClampToEdgeWrapping;
canopyTexture.wrapT = ClampToEdgeWrapping;
canopyTexture.minFilter = LinearFilter;
canopyTexture.magFilter = LinearFilter;
canopyTexture.generateMipmaps = false;
canopyTexture.colorSpace = NoColorSpace;
canopyTexture.name = 'canopy-shell';
canopyTexture.needsUpdate = true;
/** world frame of the texture: (xMin, zMin, 1 / width, 1 / depth) */
const canopyFrame = uniform(new Vector4(0, 0, 1, 1));

export interface ShellFrame {
  xMin: number;
  zMin: number;
  width: number;
  depth: number;
}

/**
 * Bake the canopy texture from instance records (FLOATS_PER_INSTANCE floats each; only the retiring
 * archetypes count). `cellKm`: the canopy grid cell (one patch per cell → cover). Pure function of the
 * records; re-uploads the texture.
 */
export function bakeCanopyShell(frame: ShellFrame, recs: ArrayLike<number>, F: number, cellKm: number): void {
  const W = SHELL_W;
  const H = SHELL_H;
  const n = new Float32Array(W * H);
  const rgb = new Float32Array(W * H * 3);
  const lin = (b: number) => (b / 255) ** 2.2;
  const count = recs.length / F;
  for (let k = 0; k < count; k++) {
    const s = k * F;
    if (!retires(archOf(recs[s + 8]))) continue;
    // bilinear splat (texel centres at +0.5)
    const fx = ((recs[s] - frame.xMin) / frame.width) * W - 0.5;
    const fz = ((recs[s + 1] - frame.zMin) / frame.depth) * H - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const c = recs[s + 7];
    const resp = KIND_RESPONSE[Math.floor(recs[s + 5] / 8)] ?? DEFAULT_RESPONSE;
    const r = lin(Math.floor(c / 65536) & 255) * resp[0];
    const g = lin(Math.floor(c / 256) & 255) * resp[1];
    const b = lin(c & 255) * resp[2];
    for (let dz = 0; dz < 2; dz++)
      for (let dx = 0; dx < 2; dx++) {
        const xi = x0 + dx;
        const zi = z0 + dz;
        if (xi < 0 || zi < 0 || xi >= W || zi >= H) continue;
        const w = (dx ? tx : 1 - tx) * (dz ? tz : 1 - tz);
        const t = zi * W + xi;
        n[t] += w;
        rgb[t * 3] += r * w;
        rgb[t * 3 + 1] += g * w;
        rgb[t * 3 + 2] += b * w;
      }
  }
  // mean colour per covered texel, then dilate into empty texels (a few rings) so the filtered colour at a
  // forest edge stays the forest's
  const col = new Float32Array(W * H * 3);
  const has = new Uint8Array(W * H);
  for (let t = 0; t < W * H; t++)
    if (n[t] > 1e-4) {
      for (let q = 0; q < 3; q++) col[t * 3 + q] = rgb[t * 3 + q] / n[t];
      has[t] = 1;
    }
  for (let pass = 0; pass < 3; pass++) {
    const add: number[] = [];
    for (let z = 0; z < H; z++)
      for (let x = 0; x < W; x++) {
        const t = z * W + x;
        if (has[t]) continue;
        let m = 0;
        let a0 = 0;
        let a1 = 0;
        let a2 = 0;
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const zz = z + dz;
            if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
            const u = zz * W + xx;
            if (!has[u]) continue;
            m++;
            a0 += col[u * 3];
            a1 += col[u * 3 + 1];
            a2 += col[u * 3 + 2];
          }
        if (m > 0) add.push(t, a0 / m, a1 / m, a2 / m);
      }
    for (let i = 0; i < add.length; i += 4) {
      const t = add[i];
      col[t * 3] = add[i + 1];
      col[t * 3 + 1] = add[i + 2];
      col[t * 3 + 2] = add[i + 3];
      has[t] = 1;
    }
  }
  const texelArea = (frame.width / W) * (frame.depth / H);
  const enc = (v: number) => Math.max(0, Math.min(255, Math.round(v ** (1 / 2.2) * 255)));
  for (let t = 0; t < W * H; t++) {
    shellData[t * 4] = enc(col[t * 3]);
    shellData[t * 4 + 1] = enc(col[t * 3 + 1]);
    shellData[t * 4 + 2] = enc(col[t * 3 + 2]);
    shellData[t * 4 + 3] = Math.round(Math.min(1, (n[t] * cellKm * cellKm) / texelArea) * 255);
  }
  canopyFrame.value.set(frame.xMin, frame.zMin, 1 / frame.width, 1 / frame.depth);
  canopyTexture.needsUpdate = true;
}

export interface CanopyShellSample {
  /** 0..1 how much of the ground is replaced by canopy */
  weight: N;
  /** canopy albedo (linear RGB) */
  albedo: N;
  /** world-space normal perturbation of the canopy surface */
  dn: N;
}

/**
 * The crowns of the shell: domes on a fully jittered grid (3×3 search), each a crown of radius 0.42–0.72
 * cell and its own height; the surface is the highest dome over the point (overlapping crowns clump, the
 * gaps between them are low and dark) — never a cell network. At world xz `q` (km): `h` the crown height
 * (km), `grad` the outward slope of the crown surface (normal tilt), `tone` 0..1 of the crown.
 */
function crownDomes(q: N, cell: number, hScale: number, salt: number): { h: N; grad: N; tone: N } {
  const g = q.div(cell).add(50000);
  const i = floor(g);
  const f = fract(g);
  const best = float(0).toVar();
  const grad = vec2(0).toVar();
  const tone = float(0.5).toVar();
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const key = uint(i.x.add(dx)).add(uint(i.y.add(dz)).mul(uint(65599))).mul(uint(5)).add(uint(salt));
      // offset from the point to the dome centre (cell units)
      const c = vec2(dx, dz).add(vec2(hash(key), hash(key.add(uint(1))))).sub(f);
      const r = mix(float(0.42), float(0.72), hash(key.add(uint(2))));
      const t = sqrt(max(float(1).sub(dot(c, c).div(r.mul(r))), 0.0));
      // crown height (km): bigger crowns taller, each its own
      const peak = r.mul(cell * hScale).mul(mix(float(0.75), float(1.25), hash(key.add(uint(3)))));
      const hgt = t.mul(peak);
      // (a var: evaluated here, before `best` is updated — a plain node would be read after the update)
      const win = hgt.greaterThan(best).toVar();
      best.assign(max(best, hgt));
      // d(height)/d(km): peak · (−c / (r² t)) / cell, outward = −c (flattened where t → 0)
      grad.assign(select(win, c.negate().mul(peak).div(r.mul(r).mul(max(t, 0.3)).mul(cell)), grad));
      tone.assign(select(win, hash(key.add(uint(4))), tone));
    }
  return { h: best, grad, tone };
}

/** `p` world position, `footprintKm` texel footprint (km per pixel), `forest` 0..1 forest cover mask. */
export function canopyShell(p: N, footprintKm: N, forest: N): CanopyShellSample {
  if (!SHELL_ON) return { weight: float(0), albedo: vec3(0), dn: vec3(0) };
  // the one canopy fetch (outside any branch; the texture has no mips)
  const uv = vec2(p.x.sub(canopyFrame.x).mul(canopyFrame.z), p.z.sub(canopyFrame.y).mul(canopyFrame.w));
  const tex = texture(canopyTexture, uv).level(0);
  const dist = length(p.sub(env.cameraPos));
  // cover: the baked patch cover, its edge sharpened by the (finer) forest mask
  const cover = smoothstep(0.12, 0.5, tex.a).mul(smoothstep(0.22, 0.6, forest));
  const weight = smoothstep(shellBandUniform.x, shellBandUniform.y, dist).mul(cover).toVar();
  // (the baked colour is already the canopy's effective albedo: kind response, self-shadowing)
  const base = pow(max(tex.rgb, vec3(0)), vec3(2.2)).toVar();
  const albedo = base.mul(SHELL_MEAN_LIT).toVar();
  const dn = vec3(0).toVar();
  const fp = footprintKm.toVar();
  const pq = p.xz.toVar();
  // relief amplitude: the crowns resolve while a dome spans more than a few pixels
  const amp = float(1).sub(smoothstep(CROWN_CELL / 9, CROWN_CELL / 3.5, fp)).toVar();
  // (called inside the terrain material's Fn: the branch joins its stack)
  If(weight.greaterThan(1e-3).and(amp.greaterThan(0.01)), () => {
    // two sizes of crown: the canopy's own (≈ 1 km) and the smaller fill between them
    const big = crownDomes(pq, CROWN_CELL, 0.55, 17);
    const small = crownDomes(pq, CROWN_CELL * 0.47, 0.5, 29);
    const smallH = small.h.mul(0.8);
    const winBig = big.h.greaterThanEqual(smallH);
    const h = max(big.h, smallH);
    const tilt = select(winBig, big.grad, small.grad.mul(0.8));
    const tone = select(winBig, big.tone, small.tone).sub(0.5);
    dn.assign(vec3(tilt.x, 0, tilt.y).mul(amp));
    // lit crown tops, dark low gaps between the crowns; each crown its own tone and a little warm / cool
    const lit = smoothstep(0.0, CROWN_CELL * 0.3, h);
    const crown = base
      .mul(mix(float(0.45), float(1.08), lit))
      .mul(tone.mul(0.32).add(1))
      .mul(vec3(float(1).add(tone.mul(0.08)), 1, float(1).sub(tone.mul(0.14))));
    albedo.assign(mix(base.mul(SHELL_MEAN_LIT), crown, amp));
  });
  return { weight: clamp(weight, 0, 1), albedo, dn };
}
