import { ClampToEdgeWrapping, DataTexture, FloatType, LinearFilter, RedFormat, Vector3 } from 'three/webgpu';
import type { WorldSpec } from './WorldSpec.ts';
import { applyStamp, stampBounds, type Stamp } from './stamps.ts';

const BLOCK = 16;

/**
 * The ONLY height API in the project: base bake (u16 → float) + TypeScript stamp layer.
 * Provides the GPU texture (R32F, linear), CPU bilinear sampling, normals, min/max bounds for
 * culling and a ray-march for picking / camera clearance. Terrain, water, vegetation, landmarks,
 * labels and the route all go through this.
 */
export class HeightField {
  readonly width: number;
  readonly height: number;
  /** world units per texel (km) */
  readonly texel: number;
  readonly base: Float32Array;
  readonly data: Float32Array;
  readonly texture: DataTexture;
  private pyramid: { w: number; h: number; min: Float32Array; max: Float32Array }[] = [];
  private stamps: Stamp[] = [];

  private constructor(
    readonly spec: WorldSpec,
    base: Float32Array,
  ) {
    const f = spec.manifest.files.height;
    this.width = f.width;
    this.height = f.height;
    this.texel = spec.manifest.kmPerPixel;
    this.base = base;
    this.data = new Float32Array(base);
    this.texture = new DataTexture(this.data, this.width, this.height, RedFormat, FloatType);
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.buildPyramid();
  }

  static async load(spec: WorldSpec): Promise<HeightField> {
    const f = spec.manifest.files.height;
    const res = await fetch(`/world/${f.file}`);
    if (!res.ok) throw new Error(`failed to load ${f.file}`);
    const u16 = new Uint16Array(await res.arrayBuffer());
    if (u16.length !== f.width * f.height) throw new Error(`height size mismatch: ${u16.length} vs ${f.width}x${f.height}`);
    const out = new Float32Array(u16.length);
    const scale = (f.max - f.min) / 65535;
    for (let i = 0; i < u16.length; i++) out[i] = f.min + u16[i] * scale;
    return new HeightField(spec, out);
  }

  // ---------------------------------------------------------------- sampling

  /** Base (pre-stamp) or composite bilinear height at world (x, z). */
  sample(x: number, z: number, which: 'composite' | 'base' = 'composite'): number {
    const src = which === 'base' ? this.base : this.data;
    const fx = Math.min(this.width - 1, Math.max(0, (x - this.spec.xMin) / this.texel - 0.5));
    const fz = Math.min(this.height - 1, Math.max(0, (z - this.spec.zMin) / this.texel - 0.5));
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(this.width - 1, x0 + 1);
    const z1 = Math.min(this.height - 1, z0 + 1);
    const tx = fx - x0;
    const tz = fz - z0;
    const w = this.width;
    const a = src[z0 * w + x0] + (src[z0 * w + x1] - src[z0 * w + x0]) * tx;
    const b = src[z1 * w + x0] + (src[z1 * w + x1] - src[z1 * w + x0]) * tx;
    return a + (b - a) * tz;
  }

  normal(x: number, z: number, out = new Vector3()): Vector3 {
    const e = this.texel;
    const hx = this.sample(x + e, z) - this.sample(x - e, z);
    const hz = this.sample(x, z + e) - this.sample(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  // ---------------------------------------------------------------- stamps

  /** Replace the stamp layer and recomposite (call once after landmarks register). */
  setStamps(stamps: Stamp[]): void {
    this.stamps = stamps;
    this.data.set(this.base);
    for (const s of stamps) this.applyOne(s);
    this.texture.needsUpdate = true;
    this.buildPyramid();
  }

  get stampCount(): number {
    return this.stamps.length;
  }

  private applyOne(s: Stamp): void {
    const [x0, z0, x1, z1] = stampBounds(s);
    const c0 = Math.max(0, Math.floor((x0 - this.spec.xMin) / this.texel));
    const c1 = Math.min(this.width - 1, Math.ceil((x1 - this.spec.xMin) / this.texel));
    const r0 = Math.max(0, Math.floor((z0 - this.spec.zMin) / this.texel));
    const r1 = Math.min(this.height - 1, Math.ceil((z1 - this.spec.zMin) / this.texel));
    let auto = 0;
    if (s.kind === 'flatten' && (s.height === undefined || s.height === 'auto')) {
      const vals: number[] = [];
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const x = this.spec.xMin + (c + 0.5) * this.texel;
          const z = this.spec.zMin + (r + 0.5) * this.texel;
          if (Math.hypot(x - s.at[0], z - s.at[1]) <= s.radius) vals.push(this.data[r * this.width + c]);
        }
      vals.sort((a, b) => a - b);
      auto = vals.length ? vals[vals.length >> 1] : 0;
    }
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const i = r * this.width + c;
        const x = this.spec.xMin + (c + 0.5) * this.texel;
        const z = this.spec.zMin + (r + 0.5) * this.texel;
        this.data[i] = applyStamp(s, x, z, this.data[i], { auto });
      }
  }

  // ---------------------------------------------------------------- bounds

  private buildPyramid(): void {
    const levels: { w: number; h: number; min: Float32Array; max: Float32Array }[] = [];
    let w = Math.ceil(this.width / BLOCK);
    let h = Math.ceil(this.height / BLOCK);
    const min = new Float32Array(w * h).fill(Number.POSITIVE_INFINITY);
    const max = new Float32Array(w * h).fill(Number.NEGATIVE_INFINITY);
    for (let r = 0; r < this.height; r++) {
      const br = (r / BLOCK) | 0;
      for (let c = 0; c < this.width; c++) {
        const v = this.data[r * this.width + c];
        const bi = br * w + ((c / BLOCK) | 0);
        if (v < min[bi]) min[bi] = v;
        if (v > max[bi]) max[bi] = v;
      }
    }
    levels.push({ w, h, min, max });
    while (w > 1 || h > 1) {
      const prev = levels[levels.length - 1];
      const nw = Math.ceil(prev.w / 2);
      const nh = Math.ceil(prev.h / 2);
      const nmin = new Float32Array(nw * nh).fill(Number.POSITIVE_INFINITY);
      const nmax = new Float32Array(nw * nh).fill(Number.NEGATIVE_INFINITY);
      for (let r = 0; r < prev.h; r++)
        for (let c = 0; c < prev.w; c++) {
          const src = r * prev.w + c;
          const dst = (r >> 1) * nw + (c >> 1);
          nmin[dst] = Math.min(nmin[dst], prev.min[src]);
          nmax[dst] = Math.max(nmax[dst], prev.max[src]);
        }
      levels.push({ w: nw, h: nh, min: nmin, max: nmax });
      w = nw;
      h = nh;
    }
    this.pyramid = levels;
  }

  /** Conservative [min, max] height over a world-space rectangle. */
  rangeMinMax(x0: number, z0: number, x1: number, z1: number): [number, number] {
    const toBlock = (v: number, origin: number) => (v - origin) / this.texel / BLOCK;
    let bc0 = Math.floor(toBlock(x0, this.spec.xMin));
    let bc1 = Math.floor(toBlock(x1, this.spec.xMin));
    let br0 = Math.floor(toBlock(z0, this.spec.zMin));
    let br1 = Math.floor(toBlock(z1, this.spec.zMin));
    let level = 0;
    while (level < this.pyramid.length - 1 && (bc1 - bc0 > 6 || br1 - br0 > 6)) {
      bc0 >>= 1;
      bc1 >>= 1;
      br0 >>= 1;
      br1 >>= 1;
      level++;
    }
    const L = this.pyramid[level];
    let mn = Number.POSITIVE_INFINITY;
    let mx = Number.NEGATIVE_INFINITY;
    for (let r = Math.max(0, br0); r <= Math.min(L.h - 1, br1); r++)
      for (let c = Math.max(0, bc0); c <= Math.min(L.w - 1, bc1); c++) {
        mn = Math.min(mn, L.min[r * L.w + c]);
        mx = Math.max(mx, L.max[r * L.w + c]);
      }
    if (!Number.isFinite(mn)) return [0, 0];
    return [mn, mx];
  }

  get globalMinMax(): [number, number] {
    const top = this.pyramid[this.pyramid.length - 1];
    return [top.min[0], top.max[0]];
  }

  // ---------------------------------------------------------------- picking

  /** March a ray against the composite heightfield. Returns the hit distance or null. */
  raycast(origin: Vector3, dir: Vector3, maxDist = 6000): number | null {
    let t = 0;
    let prevT = 0;
    const p = new Vector3();
    for (let i = 0; i < 4000 && t < maxDist; i++) {
      p.copy(dir).multiplyScalar(t).add(origin);
      const h = this.spec.inFrame(p.x, p.z) ? this.sample(p.x, p.z) : Number.NEGATIVE_INFINITY;
      const gap = p.y - h;
      if (gap < 0) {
        let a = prevT;
        let b = t;
        for (let k = 0; k < 24; k++) {
          const m = (a + b) / 2;
          p.copy(dir).multiplyScalar(m).add(origin);
          if (p.y - this.sample(p.x, p.z) < 0) b = m;
          else a = m;
        }
        return (a + b) / 2;
      }
      prevT = t;
      t += Math.max(this.texel * 0.5, gap * 0.4);
    }
    return null;
  }
}
