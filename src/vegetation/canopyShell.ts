import { ClampToEdgeWrapping, DataTexture, LinearFilter, NoColorSpace, RGBAFormat, UnsignedByteType, Vector2, Vector4 } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import { env } from '../materials/environment.ts';
import { archOf, bakes } from './archetypes.ts';
import { Kind } from './placement.ts';
import { SHELL_CROWN_KM, SHELL_FAR_PX, SHELL_H, SHELL_NEAR_PX, SHELL_ON, SHELL_W } from './shellConfig.ts';

/**
 * Far canopy shell (S4 W2-C): far off, the forests are drawn by the terrain shader as a canopy surface
 * whose colour comes from the placed vegetation records, while the canopy-patch instances (archetypes
 * Canopy / ConiferStand) retire across the same distance band (VegetationSystem: their crowns sink into
 * the shell over the band, a pure function of the camera and viewport — shellConfig.ts). Single trees,
 * hedges, clusters, the forest-edge ring (CanopyEdge) and emergent mallorns stay instances.
 *
 * W0 contract: the terrain material calls `canopyShell(p, footprintKm, forest)` in its forest-floor block
 * and mixes `albedo` in by `weight` and adds `dn·weight` to its normal.
 *
 * Near the camera (inside the band) the same sample is the canopy's UNDERLAY: the floor seen between the
 * standing crowns of a closed forest is the canopy's own deep shade (dark olive), not the pale litter of
 * the terrain floor; it hands over into the shell across the band.
 *
 * Data: one 512×307 RGBA8 texture over the world frame (`bakeCanopyShell`, at placement): rgb = mean sRGB
 * albedo of the canopy records per texel (dilated into empty texels so bilinear filtering never pulls
 * black in), a = cover (record crown area / texel area, saturating, then a 3×3 blur: holes enclosed by
 * forest — glades, roads, scars — keep a high cover and the shell closes over them at range; a forest's
 * outer edge does not). The terrain samples it once (its one allowed extra texture).
 */

type N = TslNode;
const { If, clamp, dFdx, dFdy, dot, float, floor, fract, hash, length, max, min, mix, pow, select, smoothstep, sqrt, texture, uint, uniform, vec2, vec3 } = tsl;

/**
 * Effective shell albedo vs the records' base colour, per vegetation kind (linear RGB): the instanced
 * crowns self-shadow (sub-crown undersides, cluster cavities, the floor between patches) and scatter
 * (wrap, translucency, Lórien's glow) in ways a flat lit surface cannot — calibrated against the S3
 * instanced forests in the same shots (veg-fangorn-close, veg-lorien-golden).
 */
const KIND_RESPONSE: Partial<Record<Kind, [number, number, number]>> = {
  [Kind.Mirkwood]: [0.78, 0.86, 0.42],
  [Kind.Fangorn]: [0.74, 0.82, 0.4],
  [Kind.Lorien]: [1.15, 1.08, 0.55],
};
const DEFAULT_RESPONSE: [number, number, number] = [0.8, 0.88, 0.43];
/** mean of the crown shading (lit tops / crevices) where the relief has faded out */
const SHELL_MEAN_LIT = 0.86;
/**
 * crown dome grid (km per cell): the size of the retiring crowns (≈ 0.2–0.45 km across), so the shell's
 * speckle continues the instances' grain instead of coarsening it at the hand-over
 */
const CROWN_CELL = 0.5;
/** far stands (km): the low-frequency tone of stands of different age, kept where the domes are sub-pixel */
const STAND_CELL = 2.2;
/** underlay: how much of the floor between standing crowns is the canopy's shade, and how dark it is */
const UNDER_W = 0.6;
const UNDER_DARK = 0.42;

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
/**
 * per-tier shell controls, set by the VegetationSystem from frame.quality: x = band distance scale
 * (shellTierScale), y = crown relief on (1 review / final, 0 preview: the flat textured shell, no dome ALU)
 */
const shellTier = uniform(new Vector2(1, 1));

/** set the per-tier shell controls (VegetationSystem.evaluate) */
export function setShellTier(bandScale: number, relief: boolean): void {
  shellTier.value.set(bandScale, relief ? 1 : 0);
}

export interface ShellFrame {
  xMin: number;
  zMin: number;
  width: number;
  depth: number;
}

/**
 * Bake the canopy texture from instance records (`F` floats each; only the archetypes the shell carries
 * count — archetypes.ts bakes). A record covers ≈ (hr / 0.82)² km² (the cell it was placed in). Pure
 * function of the records; re-uploads the texture.
 */
export function bakeCanopyShell(frame: ShellFrame, recs: ArrayLike<number>, F: number): void {
  const W = SHELL_W;
  const H = SHELL_H;
  const n = new Float32Array(W * H);
  const area = new Float32Array(W * H);
  const rgb = new Float32Array(W * H * 3);
  const lin = (b: number) => (b / 255) ** 2.2;
  const count = recs.length / F;
  for (let k = 0; k < count; k++) {
    const s = k * F;
    if (!bakes(archOf(recs[s + 8]))) continue;
    // bilinear splat (texel centres at +0.5)
    const fx = ((recs[s] - frame.xMin) / frame.width) * W - 0.5;
    const fz = ((recs[s + 1] - frame.zMin) / frame.depth) * H - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const c = recs[s + 7];
    const resp = KIND_RESPONSE[Math.floor(recs[s + 5] / 8) as Kind] ?? DEFAULT_RESPONSE;
    const r = lin(Math.floor(c / 65536) & 255) * resp[0];
    const g = lin(Math.floor(c / 256) & 255) * resp[1];
    const b = lin(c & 255) * resp[2];
    const cell = recs[s + 2] / 0.82;
    for (let dz = 0; dz < 2; dz++)
      for (let dx = 0; dx < 2; dx++) {
        const xi = x0 + dx;
        const zi = z0 + dz;
        if (xi < 0 || zi < 0 || xi >= W || zi >= H) continue;
        const w = (dx ? tx : 1 - tx) * (dz ? tz : 1 - tz);
        const t = zi * W + xi;
        n[t] += w;
        area[t] += w * cell * cell;
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
  // cover: crown area / texel area (saturating: a forest interior is 1 whatever its glades), then a 3×3
  // blur (centre-weighted) — a hole enclosed by forest keeps ≈ 0.85, a straight outer edge drops to ≈ 0.5
  const texelArea = (frame.width / W) * (frame.depth / H);
  const cov = new Float32Array(W * H);
  for (let t = 0; t < W * H; t++) cov[t] = Math.min(1, (1.4 * area[t]) / texelArea);
  const enc = (v: number) => Math.max(0, Math.min(255, Math.round(v ** (1 / 2.2) * 255)));
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      const t = z * W + x;
      let sum = 0;
      let wsum = 0;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(W - 1, Math.max(0, x + dx));
          const zz = Math.min(H - 1, Math.max(0, z + dz));
          const w = dx === 0 && dz === 0 ? 2 : 1;
          sum += cov[zz * W + xx] * w;
          wsum += w;
        }
      shellData[t * 4] = enc(col[t * 3]);
      shellData[t * 4 + 1] = enc(col[t * 3 + 1]);
      shellData[t * 4 + 2] = enc(col[t * 3 + 2]);
      shellData[t * 4 + 3] = Math.round((sum / wsum) * 255);
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

/** value noise (−0.5 … 0.5) on a lattice of `cell` km: the far stands' tone */
function standNoise(q: N, cell: number, salt: number): N {
  const g = q.div(cell).add(30000);
  const i = floor(g);
  const f = fract(g);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const k = (dx: number, dz: number) => hash(uint(i.x.add(dx)).add(uint(i.y.add(dz)).mul(uint(31337))).add(uint(salt)));
  return mix(mix(k(0, 0), k(1, 0), u.x), mix(k(0, 1), k(1, 1), u.x), u.y).sub(0.5);
}

/** `p` world position, `footprintKm` texel footprint (km per pixel), `forest` 0..1 forest cover mask. */
export function canopyShell(p: N, footprintKm: N, forest: N): CanopyShellSample {
  if (!SHELL_ON) return { weight: float(0), albedo: vec3(0), dn: vec3(0) };
  // the one canopy fetch (outside any branch; the texture has no mips)
  const uv = vec2(p.x.sub(canopyFrame.x).mul(canopyFrame.z), p.z.sub(canopyFrame.y).mul(canopyFrame.w));
  const tex = texture(canopyTexture, uv).level(0);
  const dist = length(p.sub(env.cameraPos));
  // cover: the baked (blurred) cover, its edge sharpened by the (finer) forest mask — except where the
  // forest encloses the point (glades, the Old Forest Road, the scars of the Mountains of Mirkwood): there
  // the shell closes over three quarters of the gap at range (a dark seam, never a pale cut-out)
  const coverTex = smoothstep(0.12, 0.5, tex.a);
  const coverSharp = coverTex.mul(smoothstep(0.22, 0.6, forest)).toVar();
  const enclosed = smoothstep(0.55, 0.85, tex.a).mul(0.75);
  const cover = max(coverSharp, coverTex.mul(enclosed));
  // the hand-over band (km): from the screen's pixels per km (shellConfig.ts; the VegetationSystem
  // retires the instances over the same distances), the shell leading it — full by mid-band, so the gaps
  // opening between the sinking crowns show canopy, never the bare floor
  const bandNear = env.pxPerKm.mul((SHELL_CROWN_KM / SHELL_NEAR_PX) * 0.9).mul(shellTier.x);
  const bandFar = env.pxPerKm.mul(SHELL_CROWN_KM / SHELL_NEAR_PX + (SHELL_CROWN_KM / SHELL_FAR_PX - SHELL_CROWN_KM / SHELL_NEAR_PX) * 0.45).mul(shellTier.x);
  const band = smoothstep(bandNear, bandFar, dist).toVar();
  // (the baked colour is already the canopy's effective albedo: kind response, self-shadowing)
  const base = pow(max(tex.rgb, vec3(0)), vec3(2.2)).toVar();
  // near: the underlay (deep canopy shade between the standing crowns); far: the shell
  const weight = mix(coverSharp.mul(UNDER_W), cover, band).toVar();
  const albedo = mix(base.mul(UNDER_DARK), base.mul(SHELL_MEAN_LIT), band).toVar();
  const dn = vec3(0).toVar();
  // (the terrain's footprint is the long axis of the pixel footprint: the shell uses the short one below)
  void footprintKm;
  const pq = p.xz.toVar();
  // relief amplitude: the crowns' relief resolves while a dome spans more than a few pixels; their tones
  // (the speckle of lit and shaded crowns that reads as canopy) down to a pixel or two; the far stands'
  // tone down to the overview (all fade on the pixel footprint's short axis: at grazing angles the long
  // axis, along the view, would erase them long before the standing instance crowns lose theirs)
  const fpMin = min(length(dFdx(p.xz)), length(dFdy(p.xz))).toVar();
  const amp = float(1).sub(smoothstep(CROWN_CELL / 9, CROWN_CELL / 3.5, fpMin)).toVar();
  const ampT = float(1).sub(smoothstep(CROWN_CELL / 3.5, CROWN_CELL / 1.3, fpMin)).toVar();
  const ampS = float(1).sub(smoothstep(STAND_CELL / 3, STAND_CELL, fpMin)).toVar();
  // (called inside the terrain material's Fn: the branches join its stack. Preview: no relief, no ALU)
  If(band.mul(cover).greaterThan(1e-3).and(shellTier.y.greaterThan(0.5)), () => {
    // stands: two octaves of a low-frequency tone (and a little warm / cool) where the domes are sub-pixel
    const st = standNoise(pq, STAND_CELL, 7).add(standNoise(pq, STAND_CELL * 0.43, 11).mul(0.6)).mul(ampS);
    const stand = base.mul(SHELL_MEAN_LIT).mul(st.mul(0.5).add(1)).mul(vec3(float(1).add(st.mul(0.25)), 1, float(1).sub(st.mul(0.35))));
    albedo.assign(mix(base.mul(UNDER_DARK), stand, band));
    If(ampT.greaterThan(0.01), () => {
      // two sizes: clumps of crowns (CROWN_CELL) and the smaller crowns between them
      const big = crownDomes(pq, CROWN_CELL, 0.55, 17);
      const small = crownDomes(pq, CROWN_CELL * 0.5, 0.5, 29);
      const smallH = small.h.mul(0.8);
      const winBig = big.h.greaterThanEqual(smallH);
      const h = max(big.h, smallH);
      const tilt = select(winBig, big.grad, small.grad.mul(0.8));
      const t0 = select(winBig, big.tone, small.tone);
      const tone = t0.sub(0.5);
      dn.assign(vec3(tilt.x, 0, tilt.y).mul(amp));
      // lit crown tops, dark low gaps between the crowns; each crown its own tone, warm / cool, and now and
      // then a rust or bronze crown (the accents of the instanced canopy)
      const lit = mix(float(SHELL_MEAN_LIT), mix(float(0.26), float(1.22), smoothstep(0.0, CROWN_CELL * 0.3, h)), amp.mul(0.5).add(0.5));
      const rust = smoothstep(0.86, 0.92, fract(t0.mul(7.31)));
      const crown = stand
        .div(SHELL_MEAN_LIT)
        .mul(lit)
        .mul(tone.mul(0.7).add(1))
        .mul(vec3(float(1).add(tone.mul(0.2)), 1, float(1).sub(tone.mul(0.3))))
        .mul(mix(vec3(1), vec3(1.22, 0.95, 0.72), rust));
      albedo.assign(mix(base.mul(UNDER_DARK), mix(stand, crown, ampT), band));
    });
  });
  return { weight: clamp(weight, 0, 1), albedo, dn: dn.mul(band) };
}
