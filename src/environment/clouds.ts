import { DataTexture, LinearFilter, NoColorSpace, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import { env } from '../materials/environment.ts';
import { rand } from '../core/rng.ts';
import { SLAB } from '../diorama/slabSpec.ts';
import { atmosphere } from '../materials/atmosphere.ts';

type N = TslNode;
const { clamp, float, max, smoothstep, step, texture, vec2 } = tsl;

/** texels of the tileable cloud field and its period in km (≈ 3.2 km per texel) */
const TEX_W = 512;
const TEX_H = 320;
export const PERIOD_X = 1638.4;
export const PERIOD_Z = 1024;
/**
 * Cumulus caps (S4 P4): extra local cloud coverage over the peaks named by looks.json atmo spots
 * `cap` (Caradhras, Mindolluin, Erebor) at full cap weight; 0 switches the caps off.
 * OFF (unfinished): the cumulus sheet rides at env.cloudHeight, ~20 km above the summits, so a boost
 * there reads as a cloud over the range, not a cap hugging the peak (needs a cap layer at the
 * summit height; the atmo2.A field and the data are in place).
 */
export const CLOUD_CAPS = 0;
/** the detail channel repeats this many times faster (and is offset) */
export const DETAIL = 3.3;

/**
 * Tileable value-noise fBm on a periodic lattice (cells per tile in x/y per octave).
 * Pure function of the seed — the same field on every page load.
 */
function fbm(seed: number, key: string, octaves: [number, number, number][]): Float32Array {
  const out = new Float32Array(TEX_W * TEX_H);
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  for (const [cx, cy, amp] of octaves) {
    const lat = new Float32Array(cx * cy);
    for (let i = 0; i < lat.length; i++) lat[i] = rand(seed, `${key}-${cx}`, i);
    for (let y = 0; y < TEX_H; y++) {
      const fy = (y / TEX_H) * cy;
      const y0 = Math.floor(fy);
      const ty = fade(fy - y0);
      const r0 = (y0 % cy) * cx;
      const r1 = ((y0 + 1) % cy) * cx;
      for (let x = 0; x < TEX_W; x++) {
        const fx = (x / TEX_W) * cx;
        const x0 = Math.floor(fx);
        const tx = fade(fx - x0);
        const c0 = x0 % cx;
        const c1 = (x0 + 1) % cx;
        const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * tx;
        const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * tx;
        out[y * TEX_W + x] += amp * (a + (b - a) * ty);
      }
    }
  }
  return out;
}

/** Rank-equalise to a uniform distribution: thresholding at 1 − c then covers a fraction c. */
function equalise(v: Float32Array): Float32Array {
  const idx = new Uint32Array(v.length);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  idx.sort((a, b) => v[a] - v[b] || a - b);
  const out = new Float32Array(v.length);
  for (let r = 0; r < idx.length; r++) out[idx[r]] = (r + 0.5) / idx.length;
  return out;
}

/**
 * Deterministic cloud shadows on the landscape (the slab top: terrain, sea, landmarks and trees;
 * never the cut faces or plinth, which stand in the clear studio air like the atmosphere keeps
 * them). A tileable fBm field of miniature-scale cloud patches (~30–80 km, soft-edged) sits on a
 * deck at env.cloudHeight; each fragment looks up where its ray to the key light crosses the deck,
 * so shadows lengthen with a low sun. The deck drifts with env.wind · env.tFx and its coverage is
 * env.cloudCoverage (SceneState.weather) — a pure function of the frame state, random access.
 */
export class CloudField {
  readonly texture: DataTexture;

  constructor(seed = 0xc10d) {
    // R: equalised patch field (≈100 / 50 / 25 km lattice octaves → rounded patches of ~30–80 km,
    // weak fine octaves so edges stay soft); G: finer detail that breaks the edges a little
    const main = equalise(fbm(seed, 'cloud-main', [[8, 5, 0.3], [16, 10, 1], [32, 20, 0.4], [64, 40, 0.14]]));
    const detail = fbm(seed, 'cloud-detail', [[32, 20, 1], [64, 40, 0.5], [128, 80, 0.25]]);
    // B: equalised weather-system field (~400 km): cloud fields gather in clusters with clear
    // skies between them instead of an even camouflage of patches
    const cluster = equalise(fbm(seed, 'cloud-cluster', [[4, 3, 1], [8, 5, 0.45]]));
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of detail) {
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    const data = new Uint8Array(TEX_W * TEX_H * 4);
    for (let i = 0; i < TEX_W * TEX_H; i++) {
      data[i * 4] = Math.round(main[i] * 255);
      data[i * 4 + 1] = Math.round(((detail[i] - lo) / (hi - lo)) * 255);
      data[i * 4 + 2] = Math.round(cluster[i] * 255);
      data[i * 4 + 3] = 255;
    }
    this.texture = new DataTexture(data, TEX_W, TEX_H, RGBAFormat, UnsignedByteType);
    this.texture.wrapS = RepeatWrapping;
    this.texture.wrapT = RepeatWrapping;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = NoColorSpace;
    this.texture.name = 'cloud-field';
    this.texture.needsUpdate = true;
  }

  /**
   * 0..1 cloud cover over world point p (where its ray to the key light meets the deck).
   * detail = false (preview tier) skips the edge-detail fetch.
   */
  cover(p: N, detail = true, cap: N = float(0)): N {
    const L = env.keyDir;
    const t = max(env.cloudHeight.sub(p.y), 0).div(max(L.y, 0.1));
    const q = p.xz.add(L.xz.mul(t)).sub(env.wind.mul(env.tFx));
    const uv = vec2(q.x.div(PERIOD_X), q.y.div(PERIOD_Z));
    const m = texture(this.texture, uv);
    const v = detail ? m.r.add(texture(this.texture, uv.mul(DETAIL).add(vec2(0.37, 0.61))).g.sub(0.5).mul(0.12)) : m.r;
    // local coverage: the weather-system field gathers the patches (mean stays ≈ cloudCoverage)
    const c = env.cloudCoverage;
    // (+ the cap boost over the high peaks: atmo2.A × CLOUD_CAPS, S4 P4)
    const cl = clamp(c.mul(m.b.mul(1.3).add(0.35)).add(cap.mul(CLOUD_CAPS)), 0, 1);
    const th = float(1).sub(cl);
    // wide, soft penumbra: the deck is a diffuse cloud, not a cut-out
    return smoothstep(th.sub(0.1), th.add(0.16), v).mul(clamp(c.mul(40), 0, 1));
  }

  /**
   * 1 on the slab top (inside the map footprint, at or above sea level), 0 on the cut faces
   * (which sit just outside the footprint), the plinth and anything below the sea surface.
   */
  static slabTop(p: N): N {
    const inX = step(SLAB.xMin, p.x).mul(step(p.x, SLAB.xMax));
    const inZ = step(SLAB.zMin, p.z).mul(step(p.z, SLAB.zMax));
    return inX.mul(inZ).mul(smoothstep(-0.6, -0.05, p.y));
  }

  /**
   * Multiplier on the key light at p: the darker of the drifting cloud shadows and the ash deck
   * (atmo2.R × env.deckShadow — the overcast under Mordor's pall), on the slab top only.
   * `shadows = false` keeps only the deck.
   */
  lightFactor(p: N, detail = true, shadows = true): N {
    // one atmo2 tap: R = deck cover, A = cloud-cap boost (at the fragment: the caps are broad)
    const f2 = atmosphere.field2(p.xz);
    const deck = f2.r.mul(env.deckShadow);
    const shade = shadows ? max(this.cover(p, detail, f2.a).mul(env.cloudShadow), deck) : deck;
    return float(1).sub(shade.mul(CloudField.slabTop(p)));
  }
}
