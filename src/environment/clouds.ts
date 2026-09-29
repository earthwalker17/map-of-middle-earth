import { DataTexture, LinearFilter, NoColorSpace, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import { env } from '../materials/environment.ts';
import { rand } from '../core/rng.ts';

type N = TslNode;
const { clamp, float, max, smoothstep, texture, vec2 } = tsl;

/** texels of the tileable cloud field and its period in km (≈ 3.2 km per texel) */
const TEX_W = 512;
const TEX_H = 320;
const PERIOD_X = 1638.4;
const PERIOD_Z = 1024;
/** the detail channel repeats this many times faster (and is offset) */
const DETAIL = 3.3;

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
 * Deterministic cloud shadows on the landscape (and the sea, slab and landmarks — every lit
 * surface). A tileable fBm field of miniature-scale cloud patches (~15–60 km) sits on a deck at
 * env.cloudHeight; each fragment looks up where its ray to the key light crosses the deck, so
 * shadows lengthen with a low sun. The deck drifts with env.wind · env.tFx and its coverage is
 * env.cloudCoverage (SceneState.weather) — a pure function of the frame state, random access.
 */
export class CloudField {
  readonly texture: DataTexture;

  constructor(seed = 0xc10d) {
    // R: equalised patch field (≈50 / 25 / 13 km lattice octaves → patches of ~15–40 km, a few
    // larger clusters from the 100 km octave); G: finer detail that breaks the edges
    const main = equalise(fbm(seed, 'cloud-main', [[16, 10, 0.35], [32, 20, 1], [64, 40, 0.5], [128, 80, 0.25]]));
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

  /** 0..1 cloud cover over world point p (where its ray to the key light meets the deck). */
  cover(p: N): N {
    const L = env.keyDir;
    const t = max(env.cloudHeight.sub(p.y), 0).div(max(L.y, 0.1));
    const q = p.xz.add(L.xz.mul(t)).sub(env.wind.mul(env.tFx));
    const uv = vec2(q.x.div(PERIOD_X), q.y.div(PERIOD_Z));
    const m = texture(this.texture, uv);
    const b = texture(this.texture, uv.mul(DETAIL).add(vec2(0.37, 0.61))).g;
    const v = m.r.add(b.sub(0.5).mul(0.24));
    // local coverage: the weather-system field gathers the patches (mean stays ≈ cloudCoverage)
    const c = env.cloudCoverage;
    const cl = clamp(c.mul(m.b.mul(1.3).add(0.35)), 0, 1);
    const th = float(1).sub(cl);
    return smoothstep(th.sub(0.03), th.add(0.07), v).mul(clamp(c.mul(40), 0, 1));
  }

  /** Multiplier on the key light at p. */
  lightFactor(p: N): N {
    return float(1).sub(this.cover(p).mul(env.cloudShadow));
  }
}
