import { ClampToEdgeWrapping, DataTexture, FloatType, LinearFilter, RedFormat, Vector3 } from 'three/webgpu';
import type { WorldSpec } from './WorldSpec.ts';
import { applyStamp, stampBounds, type Stamp } from './stamps.ts';

const BLOCK = 16;
/** the channel core keeps its baked height out to this far beyond its half width (km; the baked
 * channel mask is ≥ 0.5 inside the core, so the core itself is always restored) */
const CORE_MARGIN = 0.1;
/** the bank above/below the water level may reach this far above/below it at the edge (units) */
const GUARD_EPS = 0.03;
/** the bank clamp holds `slope` for this distance from the water's edge (km), then steepens by GUARD_RISE
 * (units per km) — like the bake's eased valley walls: a natural bank at the water, the stamp's own
 * shape a little further away */
const GUARD_NEAR = 0.5;
const GUARD_RISE = 4.0;

/**
 * Water the stamp layer must respect ("rivers win"), applied after the stamps are composited:
 *  - in a river's channel core, on a lake and its graded shore every cell keeps its baked height — a
 *    stamp may not lift the channel (false cascades) nor sink the lake;
 *  - under the rest of the ribbon (core edge … ribbon edge) the ground stays between the baked bank and
 *    the water level + a hair: a stamp may lower a baked wall there down to the water (never below it —
 *    the ribbon edge never floats) or keep it, but never raise it above the bank;
 *  - beyond the ribbon edge a stamp keeps its shape, but the ground may rise above (or fall below) the
 *    local water level only as steeply as `slope` (units per km) from the water's edge: a hill beside a
 *    stream gets a natural bank down to it instead of being cut off, a flatten never digs a hole under
 *    the ribbon. The clamp is continuous (it opens from the water level at the ribbon edge) and never
 *    blends back toward the baked height, so a baked valley wall is never restored as a thin wall or
 *    pinnacle between the water and a stamped floor.
 * Allowlisted circles (landmarks on or over the water by design: places.json `onRiver`) are exempt.
 */
export interface RiverGuard {
  /** centreline, water level per point (null = the baked ground there), ribbon half width and carved
   * channel-core half width (km) */
  lines: { points: [number, number][]; level: number[] | null; halfWidth: number; coreHalf: number }[];
  lakes: { ring: [number, number][]; level: number | null }[];
  exempt: { x: number; z: number; r: number }[];
  /** steepest bank a stamp may leave beside the water, units per km */
  slope: number;
}

/** What the river guard took back from a set of stamps (validators: tools/check/world.ts). */
export interface StampLoss {
  /** cells the guard changed */
  cells: number;
  /** Σ |stamp delta| · texel² over the stamps' bounds, units·km² */
  stampVolume: number;
  /** Σ |guard correction| · texel², units·km² */
  lostVolume: number;
  /** largest single-cell correction, units */
  maxLost: number;
}

/** lake cells within this distance (km) of the shore polygon are guarded too (rasterised coverage) */
const LAKE_MARGIN = 0.4;


function ringDistance(r: [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, az] = r[j];
    const ex = r[i][0] - ax;
    const ez = r[i][1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    best = Math.min(best, Math.hypot(x - (ax + ex * t), z - (az + ez * t)));
  }
  return best;
}

function inRing(r: [number, number][], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/**
 * The ONLY height API in the project: base bake (u16 → float) + TypeScript stamp layer.
 * Provides the GPU texture (R32F, linear), CPU bilinear sampling, normals, min/max bounds for
 * culling and a ray-march for picking / camera clearance. Terrain, water, vegetation, landmarks,
 * labels and the route all go through this. The stamp layer never moves the water (rivers, lakes) and
 * leaves natural banks beside it (RiverGuard, registered by World.load).
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
  private guard: RiverGuard | null = null;
  /** cells the river guard restored at the last setStamps (diagnostics / validators) */
  guardedCells = 0;

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
    this.guardedCells = this.guard && stamps.length ? this.applyGuard(stamps, this.guard) : 0;
    this.texture.needsUpdate = true;
    this.buildPyramid();
  }

  /** Register the water the stamp layer must not raise (World.load, before any setStamps). */
  setRiverGuard(guard: RiverGuard): void {
    this.guard = guard;
    if (this.stamps.length) this.setStamps(this.stamps);
  }

  /** Cell index range [c0, c1, r0, r1] covering a world rectangle. */
  private cellRange(x0: number, z0: number, x1: number, z1: number): [number, number, number, number] {
    return [
      Math.max(0, Math.floor((x0 - this.spec.xMin) / this.texel)),
      Math.min(this.width - 1, Math.ceil((x1 - this.spec.xMin) / this.texel)),
      Math.max(0, Math.floor((z0 - this.spec.zMin) / this.texel)),
      Math.min(this.height - 1, Math.ceil((z1 - this.spec.zMin) / this.texel)),
    ];
  }

  /**
   * What the guard takes back from `stamps` (composited alone, nothing else changes): cells touched,
   * the stamps' own volume and the volume the guard removed. The current stamp layer is restored.
   */
  stampLoss(stamps: Stamp[], onCell?: (x: number, z: number, stamped: number, guarded: number) => void): StampLoss {
    const saved = this.data.slice();
    this.data.set(this.base);
    for (const s of stamps) this.applyOne(s);
    const raw = this.data.slice();
    if (this.guard) this.applyGuard(stamps, this.guard);
    const a2 = this.texel * this.texel;
    const out: StampLoss = { cells: 0, stampVolume: 0, lostVolume: 0, maxLost: 0 };
    for (const s of stamps) {
      const [c0, c1, r0, r1] = this.cellRange(...stampBounds(s));
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const i = r * this.width + c;
          if (Number.isNaN(raw[i])) continue;
          const lost = Math.abs(raw[i] - this.data[i]);
          out.stampVolume += Math.abs(raw[i] - this.base[i]) * a2;
          out.lostVolume += lost * a2;
          out.maxLost = Math.max(out.maxLost, lost);
          if (lost > 1e-4) {
            out.cells++;
            onCell?.(this.spec.xMin + (c + 0.5) * this.texel, this.spec.zMin + (r + 0.5) * this.texel, raw[i], this.data[i]);
          }
          raw[i] = Number.NaN; // count overlapping stamp bounds once
        }
    }
    this.data.set(saved);
    return out;
  }

  /**
   * "Rivers win", inside each stamp's bounds: on the water (ribbon, lake + graded shore) the baked
   * height, beside it the stamped height clamped to the water level ± slope × distance from the edge
   * (see RiverGuard). Cells beyond a line's ends are left to whatever the line joins (a stamp may
   * build the mountain a river springs from).
   */
  private applyGuard(stamps: Stamp[], g: RiverGuard): number {
    const seen = new Uint8Array(this.width * this.height);
    const S = g.slope;
    let n = 0;
    for (const s of stamps) {
      const [x0, z0, x1, z1] = stampBounds(s);
      const [c0, c1, r0, r1] = this.cellRange(x0, z0, x1, z1);
      let maxDelta = 0;
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const i = r * this.width + c;
          maxDelta = Math.max(maxDelta, Math.abs(this.data[i] - this.base[i]));
        }
      if (maxDelta === 0) continue;
      // per line, the segments whose clamp can bind anywhere in the bounds: [ax, az, bx, bz, la, lb, ends]
      const groups: { segs: number[]; halfWidth: number; coreHalf: number }[] = [];
      for (const l of g.lines) {
        const m = l.halfWidth + GUARD_NEAR + maxDelta / (S + GUARD_RISE) + this.texel;
        const p = l.points;
        const lv = l.level;
        const segs: number[] = [];
        for (let i = 1; i < p.length; i++) {
          const [ax, az] = p[i - 1];
          const [bx, bz] = p[i];
          if (Math.max(ax, bx) + m < x0 || Math.min(ax, bx) - m > x1 || Math.max(az, bz) + m < z0 || Math.min(az, bz) - m > z1) continue;
          const ends = (i === 1 ? 1 : 0) | (i === p.length - 1 ? 2 : 0);
          segs.push(ax, az, bx, bz, lv ? lv[i - 1] : 0, lv ? lv[i] : 0, ends);
        }
        if (segs.length) groups.push({ segs, halfWidth: l.halfWidth, coreHalf: Math.min(l.coreHalf, l.halfWidth) });
      }
      const rings = g.lakes.filter((lk) => {
        let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
        for (const [x, z] of lk.ring) {
          a0 = Math.min(a0, x);
          a1 = Math.max(a1, x);
          b0 = Math.min(b0, z);
          b1 = Math.max(b1, z);
        }
        const m = LAKE_MARGIN + GUARD_NEAR + maxDelta / (S + GUARD_RISE);
        return a1 + m >= x0 && a0 - m <= x1 && b1 + m >= z0 && b0 - m <= z1;
      });
      if (!groups.length && !rings.length) continue;
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const i = r * this.width + c;
          if (seen[i]) continue;
          seen[i] = 1;
          const hs = this.data[i];
          const b = this.base[i];
          if (hs === b) continue;
          const x = this.spec.xMin + (c + 0.5) * this.texel;
          const z = this.spec.zMin + (r + 0.5) * this.texel;
          if (g.exempt.some((e) => Math.hypot(x - e.x, z - e.z) < e.r)) continue;
          let hi = Infinity;
          let lo = -Infinity;
          let keep = false;
          // the bank envelope at `de` km beyond the water's edge (de ≤ 0: under the ribbon — between the
          // baked bank and the water level)
          const bank = (level: number, de: number) => {
            const reach = de > 0 ? S * de + GUARD_RISE * Math.max(0, de - GUARD_NEAR) : 0;
            hi = Math.min(hi, Math.max(b, level + GUARD_EPS + reach));
            lo = Math.max(lo, Math.min(b, level + GUARD_EPS - reach));
          };
          for (const gr of groups) {
            if (keep) break;
            // each line by its nearest point; cells beyond its source / end are left to what it joins
            const segs = gr.segs;
            let best = Infinity;
            let level = 0;
            let beyond = false;
            for (let k = 0; k < segs.length; k += 7) {
              const ax = segs[k];
              const az = segs[k + 1];
              const ex = segs[k + 2] - ax;
              const ez = segs[k + 3] - az;
              const tr = ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1);
              const t = Math.max(0, Math.min(1, tr));
              const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t));
              if (d < best) {
                best = d;
                level = segs[k + 4] + (segs[k + 5] - segs[k + 4]) * t;
                const ends = segs[k + 6];
                beyond = (ends & 1 && tr < 0) || (ends & 2 && tr > 1) ? true : false;
              }
            }
            // beyond an end only the water itself (the ribbon's round end) is kept
            if (beyond && best > gr.halfWidth) continue;
            if (best <= gr.coreHalf + CORE_MARGIN) keep = true;
            else bank(level, best - gr.halfWidth);
          }
          for (const lk of rings) {
            if (keep) break;
            // lakes (and their graded shore, LAKE_MARGIN km beyond the polygon) stay as baked
            const de = inRing(lk.ring, x, z) ? 0 : ringDistance(lk.ring, x, z) - LAKE_MARGIN;
            if (de <= 0) keep = true;
            else bank(lk.level ?? b, de);
          }
          const v = keep ? b : Math.min(hi, Math.max(lo, hs));
          if (Math.abs(v - hs) < 1e-6) continue;
          this.data[i] = v;
          n++;
        }
    }
    return n;
  }

  get stampCount(): number {
    return this.stamps.length;
  }

  /** The composited stamp layer (read-only; groundMaps reads each stamp's `surface`). */
  get stampList(): readonly Stamp[] {
    return this.stamps;
  }

  private applyOne(s: Stamp): void {
    const [x0, z0, x1, z1] = stampBounds(s);
    const c0 = Math.max(0, Math.floor((x0 - this.spec.xMin) / this.texel));
    const c1 = Math.min(this.width - 1, Math.ceil((x1 - this.spec.xMin) / this.texel));
    const r0 = Math.max(0, Math.floor((z0 - this.spec.zMin) / this.texel));
    const r1 = Math.min(this.height - 1, Math.ceil((z1 - this.spec.zMin) / this.texel));
    let auto = 0;
    if ((s.kind === 'flatten' && (s.height === undefined || s.height === 'auto')) || (s.kind === 'basin' && s.floor === 'auto')) {
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
