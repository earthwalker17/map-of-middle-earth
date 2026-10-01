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
  UnsignedByteType,
  Vector3,
  Vector4,
} from 'three/webgpu';
import { tsl, type TslNode } from './tsl.ts';
import { env } from './environment.ts';
import { atmoLook, deckLook, lookColor, lookField } from './looks.ts';
import type { World } from '../world/World.ts';
import { SLAB } from '../diorama/slabSpec.ts';

type N = TslNode;
const { Fn, If, abs, atan, clamp, dot, exp, float, length, max, min, mix, output, positionWorld, select, smoothstep, sqrt, step, texture, uniform, vec2, vec3, vec4 } = tsl;

/** In-scatter LUT: azimuth × depression (rows at −dir.y = (j / (ROWS − 1))²). */
const LUT_AZ = 96;
const LUT_ROWS = 16;
/**
 * Valley mist: the ground haze layer thickens over valleys (World.terrainMask G < 0.5) when the sun
 * is low (env.golden, env.twilight) or a bright moon is up — golden-hour, dawn and moonlit mist in
 * the dales. Multiplier on the ground layer at full strength (a clearly valley-bottom endpoint,
 * golden hour), times the regional mist gain (atmo2.B: looks.json atmo `mist` + the named dales).
 * Reviewed (terrain look round 2) at veg-shire-golden, env-shadow-golden, overview-golden and the
 * dawn minas-tirith-close, mist on vs off: the wave-2 value 3.5 whitened distant hollows into
 * snow-like patches; 1.4 reads as a translucent veil in the dales that trees stand in.
 * S4: drawn in every tier (the mask fetches sit behind the same uniform / height pre-tests).
 */
export const VALLEY_MIST = 1.4;
/** above this height (world units; ~6 e-folds of the ground layer) no fragment can gather mist */
const VALLEY_MIST_TOP = 40;
/**
 * Optical depth of the valley-mist layer per unit of valley mist (seen straight down) and the
 * shallowest view it is integrated for (grazing rays see at most 1 / MIST_MIN_SIN of it).
 */
const MIST_SIGMA = 0.03;
const MIST_MIN_SIN = 0.15;
/** atmo2.B stores the regional mist gain / MIST_SCALE (RGBA8) */
const MIST_SCALE = 3;
/**
 * Ash haze under a deck (S4): an extra exponential layer, ASH_SIGMA per km at sea level per unit of
 * deck cover, scale height 1 / ASH_FALLOFF — the air under Mordor's pall is thick with ash, so the
 * outer world disappears from the Doom and Gate frames (low rays), while the steep rays of a high
 * camera cross little of it (the plateau stays readable from above). It fades in over ASH_RAMP km,
 * so the heroes at 25–55 km stay clear while the world beyond ~150 km is gone, and is halved for a
 * camera above the deck (the pall itself carries the gloom).
 */
const ASH_SIGMA = 0.03;
const ASH_FALLOFF = 0.05;
const ASH_RAMP = [30, 220] as const;

/** Regional haze texture over the map frame (≈ 6.3 km per texel before the blur). */
const HAZE_W = 256;
const HAZE_H = 154;

/** The ash deck's static field at a world point (CPU; see Atmosphere.deckAt). */
export interface DeckSample {
  /** 0..1 cover of the pall */
  cover: number;
  /** linear tone (albedo-like) */
  r: number;
  g: number;
  b: number;
  /** deck base height (world units) and its opacity seen from above */
  height: number;
  topOpacity: number;
}

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
 *  - Valley mist: at low sun (env.golden / twilight) or under a bright moon a thin mist layer lies
 *    in the valleys of the baked terrain analysis (World.terrainMask G < 0.5) at the ray endpoint,
 *    scaled by the regional gain (atmo2.B: the named dales) and faded in like the local haze — mist
 *    lies in the dales at golden hour and dawn, the heights stay clear. Pre-tested (low sun / moon,
 *    fragment height), so midday frames never sample the mask (all tiers since S4).
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
  /**
   * Second regional field (S4, RGBA8 over the map frame, same LookField weights as the haze):
   * R = ash-deck cover, G = deck tone (luma), B = valley-mist gain / MIST_SCALE, A = cloud-cap boost.
   */
  readonly atmo2: DataTexture;
  /** CPU copies of the static fields (eye-haze lookups, the deck mesh bake) */
  private hazePx: Float32Array | null = null;
  /** per texel: cover, tone·cover (rgb) | height·cover, topOpacity·cover, mist, cap */
  private deckA: Float32Array | null = null;
  private deckB: Float32Array | null = null;
  /** the regional haze at the camera (CPU-sampled per frame) and its weight gate (camera over the slab) */
  readonly eyeHaze = uniform(new Vector4(1, 1, 1, 1));
  readonly eyeIn = uniform(0);
  /** the deck cover at the camera (CPU-sampled per frame) */
  readonly eyeDeck = uniform(0);
  /** gain on the ash haze: 1 under the deck, ½ for a camera well above it */
  readonly ashGain = uniform(1);
  private readonly lutData = new Uint16Array(LUT_AZ * LUT_ROWS * 4);
  private readonly lutLin = new Float32Array(LUT_AZ * LUT_ROWS * 3);
  private lutKey = '';
  private hazeWorld: World | null = null;
  /** World.terrainMask (G = valley index, 0.5 flat) — a neutral 1×1 until a world with a mask is bound */
  private readonly valleyTex: N;
  /** valley-mist strength: 0 (no world yet) until bindWorld / enableValleyMist */
  private readonly valleyGain = uniform(0);

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

    const flat = new DataTexture(new Uint8Array([255, 128, 0, 0]), 1, 1, RGBAFormat);
    flat.colorSpace = NoColorSpace;
    flat.needsUpdate = true;
    this.valleyTex = texture(flat);

    // neutral until the world is bound: no deck, mist gain 1
    const a2 = new Uint8Array(HAZE_W * HAZE_H * 4);
    for (let i = 0; i < HAZE_W * HAZE_H; i++) a2[i * 4 + 2] = Math.round(255 / MIST_SCALE);
    this.atmo2 = new DataTexture(a2, HAZE_W, HAZE_H, RGBAFormat, UnsignedByteType);
    this.atmo2.wrapS = ClampToEdgeWrapping;
    this.atmo2.wrapT = ClampToEdgeWrapping;
    this.atmo2.minFilter = LinearFilter;
    this.atmo2.magFilter = LinearFilter;
    this.atmo2.generateMipmaps = false;
    this.atmo2.colorSpace = NoColorSpace;
    this.atmo2.name = 'atmosphere-atmo2';
    this.atmo2.needsUpdate = true;
  }

  /**
   * Switch the valley mist (static per page). S4: on in every tier once a world with a terrain
   * mask is bound (bindWorld) — the mask fetch sits behind the low-sun / moon and height
   * pre-tests, so midday frames never sample it.
   */
  enableValleyMist(on: boolean): void {
    this.valleyGain.value = on ? VALLEY_MIST : 0;
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
    const decks = ids.map((id) => deckLook(id));
    const spec = world.spec;
    const n = ids.length;
    if (world.terrainMask) {
      this.valleyTex.value = world.terrainMask;
      this.enableValleyMist(true);
    }
    const field = lookField(world);
    const w = new Float32Array(n);
    const px = new Float32Array(HAZE_W * HAZE_H * 4);
    // the deck field, premultiplied by its cover so the blur and the blends stay consistent
    const dA = new Float32Array(HAZE_W * HAZE_H * 4);
    const dB = new Float32Array(HAZE_W * HAZE_H * 4);
    const acc = new Float64Array(7);
    const SS = 2; // 2×2 sub-samples per texel (the haze is blurred to ~15 km below)
    for (let y = 0; y < HAZE_H; y++)
      for (let x = 0; x < HAZE_W; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        acc.fill(0);
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
              acc[6] += w[k] * L.mist;
              const D = decks[k];
              const c = w[k] * D.cover;
              if (c > 0) {
                acc[0] += c;
                acc[1] += c * D.tone.r;
                acc[2] += c * D.tone.g;
                acc[3] += c * D.tone.b;
                acc[4] += c * D.height;
                acc[5] += c * D.topOpacity;
              }
              s += w[k];
            }
            // outside every region (sea, frame edge): neutral
            r += 1 - s;
            g += 1 - s;
            b += 1 - s;
            a += 1 - s;
            acc[6] += 1 - s;
            tot++;
          }
        const o = (y * HAZE_W + x) * 4;
        px[o] = r / tot;
        px[o + 1] = g / tot;
        px[o + 2] = b / tot;
        px[o + 3] = a / tot;
        dA[o] = acc[0] / tot;
        dA[o + 1] = acc[1] / tot;
        dA[o + 2] = acc[2] / tot;
        dA[o + 3] = acc[3] / tot;
        dB[o] = acc[4] / tot;
        dB[o + 1] = acc[5] / tot;
        dB[o + 2] = acc[6] / tot;
        dB[o + 3] = 0;
      }
    // soften the region-weight borders (haze has no hard edges), THEN the place spots: they are
    // Gaussian already (falloff at radiusKm), so blurring them would only shrink their authored
    // strength (a 14 km spot kept ~30 % of its peak under the ~15 km blur)
    blur(px, HAZE_W, HAZE_H, 2);
    blur(dA, HAZE_W, HAZE_H, 2);
    blur(dB, HAZE_W, HAZE_H, 2);
    const gauss = (place: string, radiusKm: number, fn: (o: number, s: number) => void) => {
      const p = world.places.get(place);
      if (!p) return;
      for (let y = 0; y < HAZE_H; y++)
        for (let x = 0; x < HAZE_W; x++) {
          const wx = spec.xMin + ((x + 0.5) / HAZE_W) * spec.width;
          const wz = spec.zMin + ((y + 0.5) / HAZE_H) * spec.depth;
          const q = Math.hypot(wx - p.x, wz - p.z) / radiusKm;
          if (q > 3) continue;
          fn((y * HAZE_W + x) * 4, Math.exp(-q * q));
        }
    };
    for (const L of looks)
      for (const spot of L.spots) {
        // haze spots set tint and density; mist and cap spots only their own channel
        if (spot.tint !== undefined || spot.density !== undefined) {
          const tint = lookColor(spot.tint);
          const dens = spot.density ?? 1;
          gauss(spot.place, spot.radiusKm, (o, s) => {
            px[o] += (tint.r - px[o]) * s;
            px[o + 1] += (tint.g - px[o + 1]) * s;
            px[o + 2] += (tint.b - px[o + 2]) * s;
            px[o + 3] += (dens - px[o + 3]) * s;
          });
        }
        if (spot.mist !== undefined) {
          const m = spot.mist;
          gauss(spot.place, spot.radiusKm, (o, s) => {
            dB[o + 2] += (m - dB[o + 2]) * s;
          });
        }
        if (spot.cap !== undefined) {
          const c = spot.cap;
          gauss(spot.place, spot.radiusKm, (o, s) => {
            dB[o + 3] = Math.max(dB[o + 3], c * s);
          });
        }
      }
    // deck spots: move the cover towards the spot's (the premultiplied channels scale with it)
    for (const D of decks)
      for (const spot of D.spots)
        gauss(spot.place, spot.radiusKm, (o, s) => {
          const c0 = dA[o];
          if (c0 <= 1e-6) return;
          const k = (c0 + (spot.cover - c0) * s) / c0;
          for (let i = 0; i < 4; i++) dA[o + i] *= k;
          dB[o] *= k;
          dB[o + 1] *= k;
        });
    const d = this.haze.image.data as Uint16Array;
    for (let i = 0; i < px.length; i++) d[i] = DataUtils.toHalfFloat(px[i]);
    this.haze.needsUpdate = true;
    const t2 = this.atmo2.image.data as Uint8Array;
    const u8 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    for (let i = 0; i < HAZE_W * HAZE_H; i++) {
      const o = i * 4;
      const c = dA[o];
      const lum = c > 1e-6 ? (0.2126 * dA[o + 1] + 0.7152 * dA[o + 2] + 0.0722 * dA[o + 3]) / c : 0;
      t2[o] = u8(c);
      t2[o + 1] = u8(lum);
      t2[o + 2] = u8(dB[o + 2] / MIST_SCALE);
      t2[o + 3] = u8(dB[o + 3]);
    }
    this.atmo2.needsUpdate = true;
    this.hazePx = px;
    this.deckA = dA;
    this.deckB = dB;
    this.hazeFrame.value.set(spec.xMin, spec.zMin, 1 / spec.width, 1 / spec.depth);
  }

  /** Bilinear CPU sample of a static RGBA field at world (x, z) (clamped to the frame). */
  private sampleCPU(arr: Float32Array, x: number, z: number, out: number[]): number[] {
    const f = this.hazeFrame.value;
    const fx = Math.min(HAZE_W - 1, Math.max(0, (x - f.x) * f.z * HAZE_W - 0.5));
    const fy = Math.min(HAZE_H - 1, Math.max(0, (z - f.y) * f.w * HAZE_H - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(HAZE_W - 1, x0 + 1);
    const y1 = Math.min(HAZE_H - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    for (let c = 0; c < 4; c++) {
      const at = (xx: number, yy: number) => arr[(yy * HAZE_W + xx) * 4 + c];
      const a = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * tx;
      const b = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * tx;
      out[c] = a + (b - a) * ty;
    }
    return out;
  }

  private readonly _s4 = [0, 0, 0, 0];
  private readonly _s4b = [0, 0, 0, 0];

  /** True once a world's deck field exists and some region has a deck. */
  get hasDeck(): boolean {
    return !!this.deckA && this.deckA.some((v, i) => (i & 3) === 0 && v > 0.01);
  }

  /** The ash deck's static field at world (x, z) (CPU; zero cover before a world is bound). */
  deckAt(x: number, z: number, out: DeckSample): DeckSample {
    if (!this.deckA || !this.deckB) {
      out.cover = 0;
      out.r = out.g = out.b = 0.25;
      out.height = 40;
      out.topOpacity = 0.35;
      return out;
    }
    const a = this.sampleCPU(this.deckA, x, z, this._s4);
    const b = this.sampleCPU(this.deckB, x, z, this._s4b);
    const c = a[0];
    const ok = c > 1e-6;
    out.cover = c;
    out.r = ok ? a[1] / c : 0.25;
    out.g = ok ? a[2] / c : 0.25;
    out.b = ok ? a[3] / c : 0.25;
    out.height = ok ? b[0] / c : 40;
    out.topOpacity = ok ? b[1] / c : 0.35;
    return out;
  }

  /**
   * Per frame: the regional haze at the camera (one CPU lookup → a uniform, so the along-ray blend
   * costs one texture tap less) and its gate — the eye sample only counts while the camera is over
   * the slab footprint (an overview camera far outside the frame sees the map through clear air).
   */
  updateEye(cam: Vector3, deckHeight = 40): void {
    this.ashGain.value = 1 - 0.5 * Math.min(1, Math.max(0, (cam.y - deckHeight) / 60));
    const S = 30;
    const inside = Math.min(Math.min(cam.x - SLAB.xMin, SLAB.xMax - cam.x), Math.min(cam.z - SLAB.zMin, SLAB.zMax - cam.z)) / S;
    this.eyeIn.value = Math.min(1, Math.max(0, inside));
    if (!this.hazePx) return;
    const s = this.sampleCPU(this.hazePx, cam.x, cam.z, this._s4);
    this.eyeHaze.value.set(s[0], s[1], s[2], s[3]);
    this.eyeDeck.value = this.sampleCPU(this.deckA!, cam.x, cam.z, this._s4b)[0];
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
   * Valley-mist multiplier on the ground layer at world point `to`: the terrain analysis' valley
   * index (World.terrainMask G, < 0.5 in valleys) × the low-sun amount (golden hour, dawn
   * twilight) × the tier gain. The mask is only fetched behind cheap pre-tests — tier and sun
   * (uniform: no preview fragment and no midday fragment ever samples it) and the fragment's
   * height (above VALLEY_MIST_TOP nothing can gather mist) — at explicit LOD, so the branch is
   * legal anywhere; every surface in a dale (ground, water, trees) gets the same mist.
   */
  valleyMist(to: N): N {
    // low sun (golden hour, dawn twilight) or a bright moon up at night
    const lowSun = max(max(env.golden, env.twilight.mul(0.8)), env.night.mul(env.moonIllum).mul(0.5));
    const gain = lowSun.mul(this.valleyGain);
    const out = float(0).toVar();
    If(gain.greaterThan(0).and(to.y.lessThan(VALLEY_MIST_TOP)), () => {
      const f = this.hazeFrame;
      const uv = vec2(to.x.sub(f.x).mul(f.z), to.z.sub(f.y).mul(f.w));
      const g = this.valleyTex.sample(uv).level(0).g;
      // the regional gain: the named dales gather it, the ash plains and open downs much less
      const regional = texture(this.atmo2, uv).level(0).b.mul(MIST_SCALE);
      // soft valley edges (the mask is coarse): the mist thins out over the valley sides
      out.assign(smoothstep(0, 1, clamp(float(0.47).sub(g).mul(2.6), 0, 1)).mul(gain).mul(regional));
    });
    return out;
  }

  /** Ash-deck cover (atmo2.R) at world xz. */
  deckCover(xz: N, explicitLod = false): N {
    return this.field2(xz, explicitLod).r;
  }

  /** atmo2 (all channels) at world xz: deck cover, deck tone luma, mist gain / 3, cap boost. */
  field2(xz: N, explicitLod = false): N {
    const f = this.hazeFrame;
    const t = texture(this.atmo2, vec2(xz.x.sub(f.x).mul(f.z), xz.y.sub(f.y).mul(f.w)));
    return explicitLod ? t.level(0) : t;
  }

  /** Regional haze at world xz: rgb = in-scatter tint, a = density multiplier. */
  regional(xz: N, explicitLod = false): N {
    const f = this.hazeFrame;
    const t = texture(this.haze, vec2(xz.x.sub(f.x).mul(f.z), xz.y.sub(f.y).mul(f.w)));
    return explicitLod ? t.level(0) : t;
  }

  /**
   * Regional haze ALONG the ray from → to (S4): the end point, the mid point and (for camera rays)
   * the eye, each weighted by the broad air layer's density at its height (exp(−airFalloff·y)) —
   * low rays through Mordor's air take Mordor's density and tint all the way out (the outer world
   * disappears from the Doom and Gate frames), while the steep rays of a high camera are still
   * governed by the air at their end (overviews unchanged). One extra fetch over `regional`.
   */
  rayRegional(from: N, to: N, explicitLod = false, eye = true): N {
    const k = env.airFalloff;
    const end = this.regional(to.xz, explicitLod);
    const mid = this.regional(from.xz.add(to.xz).mul(0.5), explicitLod);
    const wE = exp(k.mul(max(to.y, 0)).negate());
    const wM = exp(k.mul(max(from.y.add(to.y).mul(0.5), 0)).negate()).mul(2);
    let sum = end.mul(wE).add(mid.mul(wM));
    let wt = wE.add(wM);
    if (eye) {
      const wC = exp(k.mul(max(from.y, 0)).negate()).mul(this.eyeIn);
      sum = sum.add(this.eyeHaze.mul(wC));
      wt = wt.add(wC);
    }
    return sum.div(wt);
  }

  /** Ash-deck cover along the ray: the end point and (camera rays) the eye, air-density weighted. */
  rayDeck(from: N, to: N, explicitLod = false, eye = true): N {
    const k = env.airFalloff;
    const end = this.deckCover(to.xz, explicitLod);
    if (!eye) return end;
    const wE = exp(k.mul(max(to.y, 0)).negate());
    const wC = exp(k.mul(max(from.y, 0)).negate()).mul(this.eyeIn);
    return end.mul(wE).add(this.eyeDeck.mul(wC)).div(wE.add(wC));
  }

  /**
   * Optical depth τ (scalar, green-channel reference: the per-channel extinction multiplies it)
   * from `from` to `to`. The landscape's haze layers live in the air over the slab only: the ray
   * is clipped to the slab's xz footprint and to y ≥ 0, so the cut faces, plinth and void (outside
   * or below it) see nothing but the faint studio air. `density` is the regional multiplier: up
   * to 1 it scales the distance-ramped air, the excess above 1 is local haze (short ramp).
   */
  opticalDepth(from: N, to: N, density: N, valley: N = float(0), ash: N | null = null): N {
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
    // whole-table views: seen from far above the slab (overview cameras at 1000–7000 km) the model
    // should read crisp and vivid, as a physical miniature does — relax the air and local haze with
    // the eye height (regional and close shots, and reflections from the water, are unaffected)
    const table = float(1).sub(smoothstep(350, 1400, from.y).mul(0.65));
    const air = smoothstep(r.x, r.y, d).mul(min(density, 1)).mul(table).mul(env.hazeGain);
    const local = smoothstep(r.z, r.w, d).mul(max(density.sub(1), 0)).mul(table);
    // valley mist is a local feature too (short ramp): a thin layer lying IN the dale at the ray's
    // end (S4: relative to the valley floor, not to sea level — the S3 term rode the ground layer,
    // which is ~0 in the high dales of Rivendell or the Sirannon), seen through 1 / sin(elevation)
    // of it; only on the slab top (never the cut faces or the void)
    const sinEl = abs(ray.y).div(max(d, 1e-3));
    const onTop = step(SLAB.xMin + 0.5, to.x).mul(step(to.x, SLAB.xMax - 0.5)).mul(step(SLAB.zMin + 0.5, to.z)).mul(step(to.z, SLAB.zMax - 0.5)).mul(step(0, to.y));
    const mist = valley.mul(MIST_SIGMA).div(max(sinEl, MIST_MIN_SIN)).mul(smoothstep(r.z, r.w, d)).mul(onTop);
    let tau = layers.mul(air.add(local)).add(mist).add(env.fogDensity.mul(d.mul(frac)));
    // ash under a deck (local feature: the short ramp, relaxed for whole-table views)
    if (ash) tau = tau.add(layer(float(ASH_FALLOFF)).mul(ASH_SIGMA).mul(ash).mul(smoothstep(ASH_RAMP[0], ASH_RAMP[1], d)).mul(table).mul(this.ashGain));
    return tau;
  }

  /**
   * Aerial perspective of a surface colour seen from `from` at world point `to`:
   * colour · T + C∞ · tint · (1 − T). `inScatter = false` (quality tier) uses grey extinction.
   * Must run inside a TSL Fn (the valley-mist pre-test is a branch).
   */
  apply(color: N, from: N, to: N, inScatter = true, explicitLod = false, fromCamera = false, emissive: N | null = null, emissiveFog = 1): N {
    const reg = this.rayRegional(from, to, explicitLod, fromCamera);
    const tau = this.opticalDepth(from, to, reg.a, this.valleyMist(to), this.rayDeck(from, to, explicitLod, fromCamera));
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
    const out = color.mul(T).add(cInf.mul(vec3(1).sub(T)));
    // an additive light source seen through the haze: extinction only, softened by `emissiveFog`
    // (< 1: the light also scatters forward in the haze around it, so it survives the veil better)
    return emissive ? out.add(emissive.mul(T.pow(emissiveFog))) : out;
  }

  /** `scene.fogNode`: the material output seen through the atmosphere from the camera. */
  fogNode(inScatter = true): N {
    return Fn(() => vec4(this.apply(output.rgb, env.cameraPos, positionWorld, inScatter, false, true), output.a))();
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
