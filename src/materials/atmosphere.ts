import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  Vector3,
  Vector4,
} from 'three/webgpu';
import { tsl, type TslNode } from './tsl.ts';
import { env } from './environment.ts';
import { atmoLook, lookColor, lookField } from './looks.ts';
import type { World } from '../world/World.ts';
import { SLAB } from '../diorama/slabSpec.ts';

type N = TslNode;
const { Fn, abs, atan, clamp, dot, exp, float, length, max, min, mix, output, positionWorld, select, smoothstep, sqrt, texture, uniform, vec2, vec3, vec4 } = tsl;

/** In-scatter LUT: azimuth × depression (rows at −dir.y = (j / (ROWS − 1))²). */
const LUT_AZ = 96;
const LUT_ROWS = 16;
/**
 * Valley mist: the ground haze layer thickens over valleys (World.terrainMask G < 0.5) when the sun
 * is low (env.golden, env.twilight) — golden-hour and dawn mist in the dales. Multiplier on the
 * ground layer at full strength (a clearly valley-bottom endpoint, golden hour). Reviewed at
 * overview-golden and golden-hour / dawn valley shots (Shire, Rohan, Anduin vale).
 */
export const VALLEY_MIST = 3.5;

/**
 * The fragment's valley-mist input (0 = none). Only materials that already fetch the terrain
 * analysis assign it (the terrain surface pass; the water from its own mask tap; review/final
 * tiers only) — every other material reads the zero-initialised shader variable, so the shared fog
 * node costs no texture tap for vegetation, landmarks or the slab. One node instance: its name is
 * the shader variable shared by the material's colour code and the fog.
 */
export const valleyMistInput: TslNode = tsl.property('float', 'mmValleyMist');

/** Regional haze texture over the map frame (≈ 6.3 km per texel before the blur). */
const HAZE_W = 256;
const HAZE_H = 154;

const TWO_PI = Math.PI * 2;

/** CPU radiance callback: sky in-scatter for a (unit) view direction → linear RGB. */
export type RadianceFn = (dir: Vector3, out: Color) => Color;

const _dir = new Vector3();
const _c = new Color();

/**
 * Aerial perspective for the miniature world — the one haze model every surface shares (scene
 * fog node, water reflections) and the sky dome's horizon agrees with:
 *
 *   L = L₀ · T + C∞(dir) · (1 − T),   T = exp(−τ · β_rgb)
 *
 *  - τ integrates two exponential height layers analytically along the ray — a thin ground haze
 *    (thick in valleys, peaks stand clear) and a broad air layer — plus a trace of uniform
 *    "studio" air. The layers are the diorama's own air: the ray is clipped to the slab footprint
 *    and to y ≥ 0, so the cut faces, plinth and void stay crisp (the miniature's frame).
 *  - Haze grows with DISTANCE, not with altitude alone: the camera hovers far above most of the
 *    air, so a pure height model lays the same veil over the whole frame. The layers therefore fade
 *    in with the distance from the camera (env.hazeRamp.xy: clear near field, gentle depth at a
 *    150–300 km regional target, real haze only far off and at the horizon; the steep rays of a
 *    wide overview stay light).
 *  - The regional haze texture (region weights × looks.json `atmo`) tints C∞ and scales τ per
 *    pixel. Density below 1 thins the air; the EXCESS above 1 is a local feature (Mordor's fumes,
 *    Dagorlad ash, marsh damp, elven luminous haze) and fades in over a much shorter range
 *    (env.hazeRamp.zw), so Mordor keeps its gloom beyond a clear Ithilien at any shot scale.
 *  - Valley mist: at low sun (env.golden / twilight) the ground layer thickens over the valleys of
 *    the baked terrain analysis (World.terrainMask G < 0.5) at the ray endpoint, faded in like the
 *    local haze — mist lies in the dales at golden hour and dawn, the heights stay clear. The valley
 *    index comes from the surface material (valleyMistInput: the terrain and water, which fetch the
 *    mask anyway; review/final tiers), so the fog itself samples no mask.
 *  - β_rgb is gently Rayleigh-like (blue extincts fastest), so distant land drifts to blue-grey;
 *    the spread is kept small so dark albedos (forests) do not turn teal.
 *  - C∞(dir) is the sky model's single-scattering radiance for the view direction (Preetham with
 *    the true sun phase angle — the Mie forward lobe glows warm toward a low sun — + twilight and
 *    moonlit sky), tabulated on the CPU per frame into a small azimuth × depression LUT; at the
 *    horizon it equals the dome, so terrain fades into exactly the sky behind it.
 */
export class Atmosphere {
  readonly lut: DataTexture;
  readonly haze: DataTexture;
  private readonly lutData = new Uint16Array(LUT_AZ * LUT_ROWS * 4);
  private readonly lutLin = new Float32Array(LUT_AZ * LUT_ROWS * 3);
  private lutKey = '';
  private hazeWorld: World | null = null;

  constructor() {
    this.lut = new DataTexture(this.lutData, LUT_AZ, LUT_ROWS, RGBAFormat, HalfFloatType);
    this.lut.wrapS = RepeatWrapping;
    this.lut.wrapT = ClampToEdgeWrapping;
    this.lut.minFilter = LinearFilter;
    this.lut.magFilter = LinearFilter;
    this.lut.generateMipmaps = false;
    this.lut.colorSpace = NoColorSpace;
    this.lut.name = 'atmosphere-inscatter';
    this.lut.needsUpdate = true;

    // neutral until the world is bound (tint 1, density 1)
    const hz = new Uint16Array(HAZE_W * HAZE_H * 4).fill(DataUtils.toHalfFloat(1));
    this.haze = new DataTexture(hz, HAZE_W, HAZE_H, RGBAFormat, HalfFloatType);
    this.haze.wrapS = ClampToEdgeWrapping;
    this.haze.wrapT = ClampToEdgeWrapping;
    this.haze.minFilter = LinearFilter;
    this.haze.magFilter = LinearFilter;
    this.haze.generateMipmaps = false;
    this.haze.colorSpace = NoColorSpace;
    this.haze.name = 'atmosphere-regional-haze';
    this.haze.needsUpdate = true;
  }

  // ---------------------------------------------------------------- CPU (per frame / once)

  /** LUT row → view direction y (rows are denser near the horizon, where the sun lobe sits). */
  private static rowY(j: number): number {
    const s = j / (LUT_ROWS - 1);
    return -s * s;
  }

  /**
   * Re-tabulate C∞ for the current frame. `key` must encode EXACTLY every input `radiance` reads
   * (SkyModel.radianceKey: full-precision values, no rounding): the table is a pure function of
   * them, so an equal key means an identical table and the upload is skipped (accumulation
   * sub-samples of one frame share it) — jump and sequential rendering give the same frame.
   */
  updateInScatter(radiance: RadianceFn, key: string): void {
    if (key === this.lutKey) return;
    this.lutKey = key;
    const lin = this.lutLin;
    for (let j = 0; j < LUT_ROWS; j++) {
      const y = Atmosphere.rowY(j);
      const hr = Math.sqrt(Math.max(0, 1 - y * y));
      for (let i = 0; i < LUT_AZ; i++) {
        const a = ((i + 0.5) / LUT_AZ - 0.5) * TWO_PI;
        _dir.set(Math.cos(a) * hr, y, Math.sin(a) * hr);
        radiance(_dir, _c);
        const k = (j * LUT_AZ + i) * 3;
        lin[k] = _c.r;
        lin[k + 1] = _c.g;
        lin[k + 2] = _c.b;
      }
    }
    const d = this.lutData;
    for (let p = 0; p < LUT_AZ * LUT_ROWS; p++) {
      d[p * 4] = DataUtils.toHalfFloat(lin[p * 3]);
      d[p * 4 + 1] = DataUtils.toHalfFloat(lin[p * 3 + 1]);
      d[p * 4 + 2] = DataUtils.toHalfFloat(lin[p * 3 + 2]);
      d[p * 4 + 3] = DataUtils.toHalfFloat(1);
    }
    this.lut.needsUpdate = true;
  }

  /** Mean of the horizon row (the single haze colour for systems that need one value). */
  horizonAverage(out: Color): Color {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < LUT_AZ; i++) {
      r += this.lutLin[i * 3];
      g += this.lutLin[i * 3 + 1];
      b += this.lutLin[i * 3 + 2];
    }
    return out.setRGB(r / LUT_AZ, g / LUT_AZ, b / LUT_AZ);
  }

  /**
   * Bind the world (static data; the EnvironmentSystem calls this at init, before the first
   * frame) and build its regional haze texture: RGB = in-scatter tint, A = density multiplier.
   * Region weights × looks.json atmo, softly blurred (haze has no hard borders), then the local
   * spots around places. The weights are the ground look's (LookField: domain-warped, dithered
   * ecotones), so a region's haze meanders with its ground instead of standing over its polygon as
   * a box. Until a world is bound the texture is neutral (tint 1, density 1).
   */
  bindWorld(world: World): void {
    if (this.hazeWorld === world) return;
    this.hazeWorld = world;
    const ids = world.lookRegions;
    const looks = ids.map((id) => atmoLook(id));
    const spec = world.spec;
    const n = ids.length;
    const field = lookField(world);
    const w = new Float32Array(n);
    const px = new Float32Array(HAZE_W * HAZE_H * 4);
    const SS = 2; // 2×2 sub-samples per texel (the haze is blurred to ~15 km below)
    for (let y = 0; y < HAZE_H; y++)
      for (let x = 0; x < HAZE_W; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let tot = 0;
        for (let sy = 0; sy < SS; sy++)
          for (let sx = 0; sx < SS; sx++) {
            const wx = spec.xMin + ((x + (sx + 0.5) / SS) / HAZE_W) * spec.width;
            const wz = spec.zMin + ((y + (sy + 0.5) / SS) / HAZE_H) * spec.depth;
            field.weights(wx, wz, w);
            let s = 0;
            for (let k = 0; k < n; k++) {
              if (w[k] <= 0) continue;
              const L = looks[k];
              r += w[k] * L.tint.r;
              g += w[k] * L.tint.g;
              b += w[k] * L.tint.b;
              a += w[k] * L.density;
              s += w[k];
            }
            // outside every region (sea, frame edge): neutral
            r += 1 - s;
            g += 1 - s;
            b += 1 - s;
            a += 1 - s;
            tot++;
          }
        const o = (y * HAZE_W + x) * 4;
        px[o] = r / tot;
        px[o + 1] = g / tot;
        px[o + 2] = b / tot;
        px[o + 3] = a / tot;
      }
    // soften the region-weight borders (haze has no hard edges), THEN the place spots: they are
    // Gaussian already (falloff at radiusKm), so blurring them would only shrink their authored
    // strength (a 14 km spot kept ~30 % of its peak under the ~15 km blur)
    blur(px, HAZE_W, HAZE_H, 2);
    for (const L of looks)
      for (const spot of L.spots) {
        const p = world.places.get(spot.place);
        if (!p) continue;
        const tint = lookColor(spot.tint);
        const dens = spot.density ?? 1;
        for (let y = 0; y < HAZE_H; y++)
          for (let x = 0; x < HAZE_W; x++) {
            const wx = spec.xMin + ((x + 0.5) / HAZE_W) * spec.width;
            const wz = spec.zMin + ((y + 0.5) / HAZE_H) * spec.depth;
            const q = Math.hypot(wx - p.x, wz - p.z) / spot.radiusKm;
            if (q > 3) continue;
            const s = Math.exp(-q * q);
            const o = (y * HAZE_W + x) * 4;
            px[o] += (tint.r - px[o]) * s;
            px[o + 1] += (tint.g - px[o + 1]) * s;
            px[o + 2] += (tint.b - px[o + 2]) * s;
            px[o + 3] += (dens - px[o + 3]) * s;
          }
      }
    const d = this.haze.image.data as Uint16Array;
    for (let i = 0; i < px.length; i++) d[i] = DataUtils.toHalfFloat(px[i]);
    this.haze.needsUpdate = true;
    this.hazeFrame.value.set(spec.xMin, spec.zMin, 1 / spec.width, 1 / spec.depth);
  }

  /** world xz → haze uv: (xMin, zMin, 1/width, 1/depth) */
  private readonly hazeFrame = uniform(new Vector4(-800, -480, 1 / 1600, 1 / 960));

  // ---------------------------------------------------------------- shader functions

  /**
   * C∞: haze radiance at infinite optical depth for a view direction (one LUT fetch).
   * `explicitLod` makes the fetch legal inside non-uniform control flow (the tables have no mips).
   */
  inScatter(dir: N, explicitLod = false): N {
    const u = atan(dir.z, dir.x).div(TWO_PI).add(0.5);
    const s = sqrt(clamp(dir.y.negate(), 0, 1));
    const v = s.mul(LUT_ROWS - 1).add(0.5).div(LUT_ROWS);
    const t = texture(this.lut, vec2(u, v));
    return (explicitLod ? t.level(0) : t).rgb;
  }

  /**
   * Valley-mist multiplier on the ground layer from the terrain analysis' valley index `g`
   * (World.terrainMask G: 0.5 flat, < 0.5 in valleys) × the low-sun amount (golden hour, dawn
   * twilight). Materials that fetch the mask assign it to valleyMistInput.
   */
  valleyMistFrom(g: N): N {
    const lowSun = max(env.golden, env.twilight.mul(0.8));
    return clamp(float(0.44).sub(g).mul(4), 0, 1).mul(lowSun).mul(VALLEY_MIST);
  }

  /** Regional haze at world xz: rgb = in-scatter tint, a = density multiplier. */
  regional(xz: N, explicitLod = false): N {
    const f = this.hazeFrame;
    const t = texture(this.haze, vec2(xz.x.sub(f.x).mul(f.z), xz.y.sub(f.y).mul(f.w)));
    return explicitLod ? t.level(0) : t;
  }

  /**
   * Optical depth τ (scalar, green-channel reference: the per-channel extinction multiplies it)
   * from `from` to `to`. The landscape's haze layers live in the air over the slab only: the ray
   * is clipped to the slab's xz footprint and to y ≥ 0, so the cut faces, plinth and void (outside
   * or below it) see nothing but the faint studio air. `density` is the regional multiplier: up
   * to 1 it scales the distance-ramped air, the excess above 1 is local haze (short ramp).
   */
  opticalDepth(from: N, to: N, density: N, valley: N = float(0)): N {
    const ray = to.sub(from);
    const d = length(ray);
    const y0 = max(from.y, 0);
    const yRaw = to.y;
    // fraction of the ray above sea level (the camera is above it)
    const frac = select(yRaw.lessThan(0), clamp(y0.div(max(y0.sub(yRaw), 1e-4)), 0, 1), float(1));
    // parametric interval of the ray inside the slab footprint
    const safe = (v: N): N => select(abs(v).lessThan(1e-6), float(1e-6), v);
    const rx = safe(ray.x);
    const rz = safe(ray.z);
    const ax = float(SLAB.xMin).sub(from.x).div(rx);
    const bx = float(SLAB.xMax).sub(from.x).div(rx);
    const az = float(SLAB.zMin).sub(from.z).div(rz);
    const bz = float(SLAB.zMax).sub(from.z).div(rz);
    const tA = max(max(min(ax, bx), min(az, bz)), 0);
    const tB = min(min(max(ax, bx), max(az, bz)), frac);
    const seg = max(tB.sub(tA), 0).mul(d);
    const yA = max(from.y.add(ray.y.mul(tA)), 0);
    const yB = max(from.y.add(ray.y.mul(tB)), 0);
    const dy = yB.sub(yA);
    // ∫ exp(−k y) ds along a straight segment = s · (e^{−k yA} − e^{−k yB}) / (k Δy)
    const layer = (k: N): N => {
      const eA = exp(k.mul(yA).negate());
      const eB = exp(k.mul(yB).negate());
      const kdy = k.mul(dy);
      return select(abs(kdy).greaterThan(1e-3), seg.mul(eA.sub(eB)).div(kdy), seg.mul(eA));
    };
    const ground = env.fogHeightDensity.mul(layer(env.fogHeightFalloff));
    const layers = ground.add(env.airDensity.mul(layer(env.airFalloff)));
    // distance ramps (see the class doc): the air fades in far from the camera, local haze early
    const r = env.hazeRamp;
    const air = smoothstep(r.x, r.y, d).mul(min(density, 1));
    const local = smoothstep(r.z, r.w, d).mul(max(density.sub(1), 0));
    // valley mist is a local feature too (short ramp): the ground layer thickened over the dales
    const mist = ground.mul(valley).mul(smoothstep(r.z, r.w, d));
    return layers.mul(air.add(local)).add(mist).add(env.fogDensity.mul(d.mul(frac)));
  }

  /**
   * Aerial perspective of a surface colour seen from `from` at world point `to`:
   * colour · T + C∞ · tint · (1 − T). `inScatter = false` (quality tier) uses grey extinction;
   * `valley` is the valley-mist multiplier at `to` (valleyMistFrom; 0 = none).
   */
  apply(color: N, from: N, to: N, inScatter = true, explicitLod = false, valley: N = float(0)): N {
    const reg = this.regional(to.xz, explicitLod);
    const tau = this.opticalDepth(from, to, reg.a, valley);
    const beta = inScatter ? env.extinction : vec3(1);
    const T = exp(beta.mul(tau).negate());
    const ray = to.sub(from);
    const dir = ray.div(max(length(ray), 1e-6));
    let cInf = (inScatter ? this.inScatter(dir, explicitLod) : env.fogColor).mul(reg.rgb);
    if (inScatter) {
      // thin haze is aerosol (Mie) scattering, close to neutral; the sky's blue builds up only over
      // long paths — so a thin veil stays grey (dark forests do not turn teal) and thick haze at
      // the horizon takes the full sky colour (no seam with the dome)
      const grey = dot(cInf, vec3(0.2126, 0.7152, 0.0722));
      cInf = mix(vec3(grey), cInf, mix(float(0.55), float(1), smoothstep(0, 0.6, tau)));
    }
    return color.mul(T).add(cInf.mul(vec3(1).sub(T)));
  }

  /** `scene.fogNode`: the material output seen through the atmosphere from the camera. */
  fogNode(inScatter = true): N {
    return Fn(() => vec4(this.apply(output.rgb, env.cameraPos, positionWorld, inScatter, false, valleyMistInput), output.a))();
  }
}

/** Separable box blur (3 passes ≈ Gaussian) of an RGBA float image, radius in texels. */
function blur(px: Float32Array, w: number, h: number, radius: number): void {
  const tmp = new Float32Array(px.length);
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    for (let l = 0; l < lines; l++)
      for (let i = 0; i < len; i++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let cnt = 0;
        for (let k = -radius; k <= radius; k++) {
          const j = Math.min(len - 1, Math.max(0, i + k));
          const o = (horizontal ? l * w + j : j * w + l) * 4;
          r += src[o];
          g += src[o + 1];
          b += src[o + 2];
          a += src[o + 3];
          cnt++;
        }
        const o = (horizontal ? l * w + i : i * w + l) * 4;
        dst[o] = r / cnt;
        dst[o + 1] = g / cnt;
        dst[o + 2] = b / cnt;
        dst[o + 3] = a / cnt;
      }
  };
  for (let it = 0; it < 3; it++) {
    pass(px, tmp, true);
    pass(tmp, px, false);
  }
}

/** The shared atmosphere (one per page; its textures are static data + one per-frame LUT). */
export const atmosphere = new Atmosphere();
