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
  Vector2,
  Vector3,
  Vector4,
} from 'three/webgpu';
import { tsl, type TslNode } from './tsl.ts';
import { env } from './environment.ts';
import { atmoLook, DECK_DEFAULT_HEIGHT, DECK_DEFAULT_TOP, deckLook, lookColor, lookField, strongestDeck, type DeckLook } from './looks.ts';
import type { World } from '../world/World.ts';
import { SLAB } from '../diorama/slabSpec.ts';
import { spillInScatter } from '../emission/spill.ts';

type N = TslNode;
const { Fn, If, abs, atan, clamp, dot, exp, float, length, max, min, mix, output, positionWorld, select, smoothstep, sqrt, step, texture, uniform, vec2, vec3, vec4 } = tsl;

/** In-scatter LUT: azimuth × depression (rows at −dir.y = (j / (ROWS − 1))²). */
const LUT_AZ = 96;
const LUT_ROWS = 16;
/**
 * Valley mist (S4 model): its own thin layer lying on the valley floor — optical depth
 * valley · VALLEY_MIST · regional gain · MIST_SIGMA / max(sinEl, MIST_MIN_SIN) · exp(−(y − floor) / MIST_THICK),
 * where `valley` is the terrain analysis' valley index (World.terrainMask G < 0.5) × the low-sun /
 * moonlit gate (golden hour, dawn twilight, a bright moon), the regional gain is atmo2.B (looks.json
 * atmo `mist` + the named dales) and the floor is atmo2.G. Its in-scatter is the pale horizon light
 * tinted by the region (Morgul's green), not the dark view-direction haze. VALLEY_MIST was 1.4 in S3,
 * calibrated against the old formula (a multiplier on the ground haze layer); it was kept and
 * re-checked visually against the S4 layer (rivendell / anduin dawn, veg-shire-golden).
 * Drawn in every tier since S4 (the mask fetches sit behind the uniform / height pre-tests).
 */
export const VALLEY_MIST = 1.4;
/**
 * Pre-test bound: above this height (world units) no fragment can gather mist — the highest named
 * dale floors (~25) plus a few MIST_THICK; the mask and atmo2 are never fetched above it.
 */
const VALLEY_MIST_TOP = 40;
/**
 * Optical depth of the valley-mist layer per unit of valley mist (seen straight down) and the
 * shallowest view it is integrated for (grazing rays see at most 1 / MIST_MIN_SIN of it).
 */
const MIST_SIGMA = 0.03;
const MIST_MIN_SIN = 0.2;
/**
 * The mist lies on the valley floor: atmo2.G stores the local floor height (the lowest ground within
 * ±MIST_FLOOR_KM, / MIST_FLOOR_RANGE world units) and the mist thins out above it with this scale
 * height, so cliffs and valley sides rise out of it (no mist curtains on the walls).
 */
const MIST_FLOOR_KM = 5;
const MIST_FLOOR_RANGE = 64;
const MIST_THICK = 2.0;
/**
 * Mist in-scatter: a bright droplet cloud lit by the key light (any orientation: MIST_KEY of its
 * irradiance) and the sky fill (MIST_SKY), desaturated by MIST_SAT and tinted by the regional
 * chroma (Morgul's green) — pale and luminous at dawn, dim blue-grey under the moon, never the dark
 * view-direction haze.
 */
const MIST_KEY = 0.11;
const MIST_SKY = 0.45;
const MIST_SAT = 0.45;
/** atmo2.B stores the regional mist gain / MIST_SCALE (RGBA8) */
const MIST_SCALE = 3;
/**
 * Ash haze under a deck (S4): an extra exponential layer, ASH_SIGMA per km at sea level per unit of
 * deck cover, scale height 1 / ASH_FALLOFF — the air under Mordor's pall is thick with ash, so the
 * outer world disappears from the Doom and Gate frames (low rays), while the steep rays of a high
 * camera cross little of it (the plateau stays readable from above). It fades in over the shot's
 * ash ramp (Atmosphere.ashRamp: from ~1.1 × to ~2 × the focus distance), so the subject stays clear
 * while the world behind it is gone, and is halved for a camera above the deck (the pall itself
 * carries the gloom).
 */
const ASH_SIGMA = 0.08;
const ASH_FALLOFF = 0.05;
/**
 * The ash haze's distance ramp (km), written per frame from the shot (EnvironmentSystem: ×1.1 → ×2
 * the focus distance): the subject stays clear, the world behind it disappears into the pall.
 */
const ASH_RAMP_DEFAULT = [30, 220] as const;
/**
 * Under a deck the haze's in-scatter is the overcast's own light (env.deckSky, the dome's colour)
 * keeping this much of the regional chroma (Doom's red, Morgul's green), so far land fades into the
 * overcast horizon without a seam (the dome's horizon uses the same colour).
 */
export const DECK_HAZE_CHROMA = 0.6;
/** ray deck cover over which the under-deck haze takes the overcast's colour (S3/W1: 0.1 → 0.45) */
const DECK_HAZE_ONSET = [0.06, 0.3] as const;
/**
 * deck cover at the camera over which a camera under the pall sees the haze in the overcast's colour, and
 * the ray length (km) over which that takes over (fix round: the mid ground keeps its own haze, so its
 * silhouettes stay separable — only the far world beyond the pall's edge fades into the overcast)
 */
const DECK_EYE_HAZE = [0.3, 0.65] as const;
const DECK_EYE_DIST = [30, 90] as const;
/**
 * Under the deck the far haze is a little paler than the near (a brighter overcast horizon, as under a real
 * overcast): the overcast haze colour lifts by this much over this ray length (km); the dome's horizon
 * under the deck lifts by the same (sky.ts), so far land still meets it without a seam — depth layering
 * (each farther ridge paler) instead of one uniform charcoal murk
 */
export const DECK_FAR_LIFT = 0.3;
const DECK_FAR_DIST = [50, 200] as const;
/** S4 W4-S2: the along-ray ash cover takes a mid-point tap on camera rays (review / final, with the haze's mid tap) */
const ASH_MID_TAP = true;
/** S4 W4-S2: the deck field ignores the default region in the gaps between region masks (see bindWorld) */
const DECK_GAP_FILL = true;
const LUM_W = [0.2126, 0.7152, 0.0722] as const;

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
   * R = ash-deck cover, G = the valley floor height for the mist (/ MIST_FLOOR_RANGE; the deck's
   * tone is baked into the deck mesh and the dome reads env.deckTone, so G carries the floor instead),
   * B = valley-mist gain / MIST_SCALE, A = cloud-cap boost.
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
  /** distance ramp of the ash haze (km): fades in from x to y (focus-scaled per frame) */
  readonly ashRamp = uniform(new Vector2(ASH_RAMP_DEFAULT[0], ASH_RAMP_DEFAULT[1]));
  /** 1 while the camera is under the focus deck (its rays see the overcast's light), 0 above it */
  readonly eyeUnder = uniform(0);
  /**
   * Valley-mist framing gate (per frame from the shot's focus distance): the dales' mist is a
   * regional / close-shot feature — wide shots would draw it as crisp ribbons along every channel.
   */
  readonly mistVis = uniform(1);
  /** the data's strongest deck: prior of the CPU deck blends (continuous at the deck's edge) */
  private deckPrior: DeckLook = strongestDeck([]);
  private readonly lutData = new Uint16Array(LUT_AZ * LUT_ROWS * 4);
  private readonly lutLin = new Float32Array(LUT_AZ * LUT_ROWS * 3);
  private lutKey = '';
  private hazeWorld: World | null = null;
  /** World.terrainMask (G = valley index, 0.5 flat) — a neutral 1×1 until a world with a mask is bound */
  private readonly valleyTex: N;
  /** valley-mist strength: 0 (no world yet) until bindWorld / enableValleyMist */
  private readonly valleyGain = uniform(0);
  /**
   * Graph-level tier switch (set by EnvironmentSystem before any material is built): false on the
   * preview tier, whose graphs leave out the review / final-only terms entirely — the light halos (W2-D)
   * and the valley mist — so the explorer neither compiles nor runs them (S4 perf pass).
   */
  full = true;

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
    this.deckPrior = strongestDeck(ids);
    const spec = world.spec;
    const n = ids.length;
    if (world.terrainMask) {
      this.valleyTex.value = world.terrainMask;
      this.enableValleyMist(this.full);
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
            // the deck's weights (S4 W4-S2): the default region (index 0) fills the gaps the baked
            // region masks leave — the ranges ringing Mordor (Ered Lithui, Ephel Dúath) — so it only
            // counts where it dominates (the ground look's rule) and the pall spans those ranges
            // instead of thinning to ~0.65 over them (a daylit band behind Doom)
            let rest = 0;
            let all = 0;
            for (let k = 0; k < n; k++) {
              all += w[k];
              if (k > 0) rest += w[k];
            }
            const t0 = Math.min(1, Math.max(0, (w[0] - 0.55) / 0.4));
            const w0d = DECK_GAP_FILL && rest > 1e-6 ? w[0] * t0 * t0 * (3 - 2 * t0) : w[0];
            const kRest = rest > 1e-6 ? (all - w0d) / rest : 1;
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
              const c = (k === 0 ? w0d : w[k] * kRest) * D.cover;
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
    // the valley floor for the mist: the lowest ground within ±MIST_FLOOR_KM of the texel centre
    const floor = new Float32Array(HAZE_W * HAZE_H);
    for (let y = 0; y < HAZE_H; y++)
      for (let x = 0; x < HAZE_W; x++) {
        const cx = spec.xMin + ((x + 0.5) / HAZE_W) * spec.width;
        const cz = spec.zMin + ((y + 0.5) / HAZE_H) * spec.depth;
        let lo = Infinity;
        for (let j = -2; j <= 2; j++)
          for (let i = -2; i <= 2; i++) lo = Math.min(lo, world.heights.sample(cx + (i * MIST_FLOOR_KM) / 2, cz + (j * MIST_FLOOR_KM) / 2));
        floor[y * HAZE_W + x] = Math.max(0, lo);
      }
    const t2 = this.atmo2.image.data as Uint8Array;
    const u8 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    for (let i = 0; i < HAZE_W * HAZE_H; i++) {
      const o = i * 4;
      const c = dA[o];
      t2[o] = u8(c);
      t2[o + 1] = u8(floor[i] / MIST_FLOOR_RANGE);
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
      out.height = DECK_DEFAULT_HEIGHT;
      out.topOpacity = DECK_DEFAULT_TOP;
      return out;
    }
    const a = this.sampleCPU(this.deckA, x, z, this._s4);
    const b = this.sampleCPU(this.deckB, x, z, this._s4b);
    // un-premultiply with a small prior (the strongest deck): continuous where the cover → 0
    const P = this.deckPrior;
    const E = 0.02;
    const c = a[0];
    const den = c + E;
    out.cover = c;
    out.r = (a[1] + E * P.tone.r) / den;
    out.g = (a[2] + E * P.tone.g) / den;
    out.b = (a[3] + E * P.tone.b) / den;
    out.height = (b[0] + E * P.height) / den;
    out.topOpacity = (b[1] + E * P.topOpacity) / den;
    return out;
  }

  /**
   * Per frame: the regional haze at the camera (one CPU lookup → a uniform, so the along-ray blend
   * costs one texture tap less) and its gate — the eye sample only counts while the camera is over
   * the slab footprint (an overview camera far outside the frame sees the map through clear air).
   */
  updateEye(cam: Vector3, deckHeight = DECK_DEFAULT_HEIGHT): void {
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    // a camera above the pall sees its top, not the ash under it (the regional view stays readable)
    this.ashGain.value = 1 - 0.85 * clamp01((cam.y - deckHeight) / 60);
    const u = clamp01((cam.y - (deckHeight - 6)) / 10);
    this.eyeUnder.value = 1 - u * u * (3 - 2 * u);
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
    const gain = lowSun.mul(this.valleyGain).mul(this.mistVis);
    const out = float(0).toVar();
    If(gain.greaterThan(0).and(to.y.lessThan(VALLEY_MIST_TOP)), () => {
      const f = this.hazeFrame;
      const uv = vec2(to.x.sub(f.x).mul(f.z), to.z.sub(f.y).mul(f.w));
      const g = this.valleyTex.sample(uv).level(0).g;
      // the regional gain: the named dales gather it, the ash plains and open downs much less
      const a2 = texture(this.atmo2, uv).level(0);
      const regional = a2.b.mul(MIST_SCALE);
      // thinning above the valley floor (the walls rise out of the mist)
      const above = max(to.y.sub(a2.g.mul(MIST_FLOOR_RANGE)), 0);
      const lying = exp(above.div(-MIST_THICK));
      // soft valley edges (the mask is coarse): the mist thins out over the valley sides, and only
      // clear valleys gather it (shallow hollows and stream channels on the slopes stay clear: no
      // blotches, no ribbons tracing the streams)
      out.assign(smoothstep(0.03, 0.2, float(0.47).sub(g)).mul(gain).mul(regional).mul(lying));
    });
    return out;
  }

  /** Ash-deck cover (atmo2.R) at world xz. */
  deckCover(xz: N, explicitLod = false): N {
    return this.field2(xz, explicitLod).r;
  }

  /** atmo2 (all channels) at world xz: deck cover, mist floor / MIST_FLOOR_RANGE, mist gain / 3, cap boost. */
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
  rayRegional(from: N, to: N, explicitLod = false, eye = true, midTap = true): N {
    const k = env.airFalloff;
    const end = this.regional(to.xz, explicitLod);
    const wE = exp(k.mul(max(to.y, 0)).negate());
    let sum = end.mul(wE);
    let wt = wE;
    if (midTap) {
      // (preview skips this tap: the end point and the eye carry the blend)
      const mid = this.regional(from.xz.add(to.xz).mul(0.5), explicitLod);
      const wM = exp(k.mul(max(from.y.add(to.y).mul(0.5), 0)).negate()).mul(2);
      sum = sum.add(mid.mul(wM));
      wt = wt.add(wM);
    }
    if (eye) {
      const wC = exp(k.mul(max(from.y, 0)).negate()).mul(this.eyeIn);
      sum = sum.add(this.eyeHaze.mul(wC));
      wt = wt.add(wC);
    }
    return sum.div(wt);
  }

  /**
   * Ash-deck cover along the ray: the end point, (review / final: `midTap`) the mid point and (camera
   * rays) the eye, air-density weighted like rayRegional. The mid tap (S4 W4-S2) carries the pall over a
   * long low ray that leaves the deck: a camera under Doom's pall looking out over the Gate sees the
   * world beyond through ~100 km of ash, not through the average of its two clear ends.
   */
  rayDeck(from: N, to: N, explicitLod = false, eye = true, midTap = false): N {
    const k = env.airFalloff;
    const end = this.deckCover(to.xz, explicitLod);
    if (!eye && !midTap) return end;
    const wE = exp(k.mul(max(to.y, 0)).negate());
    let sum = end.mul(wE);
    let wt = wE;
    if (midTap) {
      const mid = this.deckCover(from.xz.add(to.xz).mul(0.5), explicitLod);
      const wM = exp(k.mul(max(from.y.add(to.y).mul(0.5), 0)).negate()).mul(2);
      sum = sum.add(mid.mul(wM));
      wt = wt.add(wM);
    }
    if (eye) {
      const wC = exp(k.mul(max(from.y, 0)).negate()).mul(this.eyeIn);
      sum = sum.add(this.eyeDeck.mul(wC));
      wt = wt.add(wC);
    }
    return sum.div(wt);
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
    let tau = layers.mul(air.add(local)).add(this.mistDepth(from, to, valley)).add(env.fogDensity.mul(d.mul(frac)));
    // ash under a deck (local feature: the shot's ash ramp, relaxed for whole-table views)
    if (ash) tau = tau.add(layer(float(ASH_FALLOFF)).mul(ASH_SIGMA).mul(ash).mul(smoothstep(this.ashRamp.x, this.ashRamp.y, d)).mul(table).mul(this.ashGain));
    return tau;
  }

  /**
   * Optical depth of the valley mist (`valley` = valleyMist(to)): a thin layer lying IN the dale at
   * the ray's end (relative to the valley floor, not to sea level — the S3 term rode the ground
   * layer, which is ~0 in the high dales of Rivendell or the Sirannon), seen through
   * 1 / sin(elevation) of it, faded in like the local haze; only on the slab top (never the cut
   * faces or the void).
   */
  mistDepth(from: N, to: N, valley: N): N {
    const ray = to.sub(from);
    const d = length(ray);
    const r = env.hazeRamp;
    const sinEl = abs(ray.y).div(max(d, 1e-3));
    const onTop = step(SLAB.xMin + 0.5, to.x).mul(step(to.x, SLAB.xMax - 0.5)).mul(step(SLAB.zMin + 0.5, to.z)).mul(step(to.z, SLAB.zMax - 0.5)).mul(step(0, to.y));
    return valley.mul(MIST_SIGMA).div(max(sinEl, MIST_MIN_SIN)).mul(smoothstep(r.z, r.w, d)).mul(onTop);
  }

  /**
   * Aerial perspective of a surface colour seen from `from` at world point `to`:
   * colour · T + C∞ · tint · (1 − T). `inScatter = false` (quality tier) uses grey extinction.
   * Must run inside a TSL Fn (the valley-mist pre-test is a branch).
   */
  apply(color: N, from: N, to: N, inScatter = true, explicitLod = false, fromCamera = false, emissive: N | null = null, emissiveFog = 1, midTap = true): N {
    const { T, S } = this.terms(from, to, inScatter, explicitLod, fromCamera, midTap);
    const out = color.mul(T).add(S);
    // an additive light source seen through the haze: extinction only, softened by `emissiveFog`
    // (< 1: the light also scatters forward in the haze around it, so it survives the veil better)
    return emissive ? out.add(emissive.mul(T.pow(emissiveFog))) : out;
  }

  /**
   * The aerial perspective of a point split into transmittance T (rgb) and the additive in-scatter +
   * halos S (rgb), apply(c) = c·T + S, from ONE evaluation (S4 W4-S2 perf): S and the optical depth are
   * packed in one vec4 by one inlined Fn (so the valley-mist branch has its stack), T = exp(−β·τ) is
   * rebuilt from τ (the extinction is a uniform). Used per vertex by the effects and the preview ash deck
   * (two apply() calls there built the whole graph twice).
   */
  applySplit(from: N, to: N, inScatter = true, explicitLod = false, fromCamera = false, midTap = true): { T: N; S: N } {
    const packed = Fn(() => {
      const t = this.terms(from, to, inScatter, explicitLod, fromCamera, midTap);
      return vec4(t.S, t.tau);
    })();
    const beta = inScatter ? env.extinction : vec3(1);
    return { T: exp(beta.mul(packed.w).negate()), S: packed.xyz };
  }

  /** T, S (see applySplit) and the optical depth τ of a ray. Must run inside a TSL Fn (valley-mist branch). */
  private terms(from: N, to: N, inScatter: boolean, explicitLod: boolean, fromCamera: boolean, midTap: boolean): { T: N; S: N; tau: N } {
    const reg = this.rayRegional(from, to, explicitLod, fromCamera, midTap);
    const ash = this.rayDeck(from, to, explicitLod, fromCamera, fromCamera && midTap && ASH_MID_TAP);
    const tauMist = this.mistDepth(from, to, this.valleyMist(to));
    const tau = this.opticalDepth(from, to, reg.a, float(0), ash).add(tauMist);
    const beta = inScatter ? env.extinction : vec3(1);
    const T = exp(beta.mul(tau).negate());
    const ray = to.sub(from);
    const dir = ray.div(max(length(ray), 1e-6));
    let cInf = (inScatter ? this.inScatter(dir, explicitLod) : env.fogColor).mul(reg.rgb);
    if (inScatter) {
      // thin haze is aerosol (Mie) scattering, close to neutral; the sky's blue builds up only over
      // long paths — so a thin veil stays grey (dark forests do not turn teal) and thick haze at
      // the horizon takes the full sky colour (no seam with the dome)
      const grey = dot(cInf, vec3(...LUM_W));
      cInf = mix(vec3(grey), cInf, mix(float(0.55), float(1), smoothstep(0, 0.6, tau)));
    }
    // the region's chroma (luminance-normalised tint: Doom's red, Morgul's green)
    const chroma = reg.rgb.div(max(dot(reg.rgb, vec3(...LUM_W)), 0.05));
    if (fromCamera) {
      // under the ash deck the haze glows with the overcast's own light — the dome's colour — so
      // far land fades into the overcast horizon (no seam), never brighter than the sky above it
      // (S4 W4-S2: an earlier, steeper onset — with the mid tap a long ray out of the pall reads ≈ 0.3–0.5)
      // A camera standing under a dense pall sees every ray's haze lit by the overcast, however clear the
      // ray's far end: whatever lies beyond the pall's edge is seen through ~100 km of ash (its own
      // sunlit haze is extinguished on the way) — the far world beyond the Ered Lithui (Rhovanion,
      // Mirkwood: deck 0 at both the end and the mid point) faded into a daylit band behind Doom
      const rayLen = length(ray);
      const kEye = smoothstep(DECK_EYE_HAZE[0], DECK_EYE_HAZE[1], this.eyeDeck).mul(smoothstep(DECK_EYE_DIST[0], DECK_EYE_DIST[1], rayLen));
      const k = max(smoothstep(DECK_HAZE_ONSET[0], DECK_HAZE_ONSET[1], ash), kEye).mul(this.eyeUnder);
      const far = float(1).add(smoothstep(DECK_FAR_DIST[0], DECK_FAR_DIST[1], rayLen).mul(DECK_FAR_LIFT));
      cInf = mix(cInf, env.deckSky.mul(mix(vec3(1), chroma, DECK_HAZE_CHROMA)).mul(far), k);
    }
    // the valley mist scatters the low sun / moon and the sky light (pale), tinted by its region
    // (under the ash deck the key reaching the mist is the pall's: grey, not sunlit white)
    const keyMist = float(1).sub(ash.mul(env.deckShadow)).mul(env.keyIntensity).mul(MIST_KEY);
    const lit = env.keyColor.mul(keyMist).add(env.skyColor.mul(env.hemiIntensity.mul(MIST_SKY)));
    const mistCol = mix(vec3(dot(lit, vec3(...LUM_W))), lit, MIST_SAT).mul(chroma);
    cInf = mix(cInf, mistCol, clamp(tauMist.div(max(tau, 1e-4)), 0, 1));
    const S0 = cInf.mul(vec3(1).sub(T));
    // + W2-D halos round strong lights (review / final graphs)
    const S = this.full ? S0.add(spillInScatter(from, to, reg.a)) : S0;
    return { T, S, tau };
  }

  /** `scene.fogNode`: the material output seen through the atmosphere from the camera. */
  fogNode(inScatter = true, midTap = true): N {
    return Fn(() => vec4(this.apply(output.rgb, env.cameraPos, positionWorld, inScatter, false, true, null, 1, midTap), output.a))();
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
