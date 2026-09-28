import {
  Box3,
  DynamicDrawUsage,
  Frustum,
  InstancedBufferAttribute,
  type InstancedBufferGeometry,
  Matrix4,
  Mesh,
  Vector3,
} from 'three/webgpu';
import type { FrameContext, InitContext, System } from '../core/types.ts';
import type { World } from '../world/World.ts';
import { createClumpGeometry, CROWN_TOP } from './clumpGeometry.ts';
import { createFoliageMaterial, type FoliageMaterialParts } from './foliageMaterial.ts';
import { FLOATS_PER_INSTANCE, placeVegetation, type ExclusionCircle } from './placement.ts';

/** Spatial chunk size (km) for culling / LOD selection. */
const CHUNK = 32;
/** Extra margin (km) around chunks for the frustum test so off-screen casters still shadow. */
const SHADOW_MARGIN = 28;
/**
 * LOD ladder: crown tessellation (icosphere detail) and the projected crown diameter (px) above
 * which it is used. The fragment micro-structure carries the close-range detail, so geometry
 * stays modest (the iGPU is triangle-bound long before it is fragment-bound).
 */
const LODS: { detail: number; trunk: boolean; minPx: number; cap: number }[] = [
  { detail: 3, trunk: true, minPx: 130, cap: 6000 },
  { detail: 2, trunk: true, minPx: 38, cap: 40000 },
  { detail: 1, trunk: true, minPx: 9, cap: Infinity },
  { detail: 0, trunk: false, minPx: 0, cap: Infinity },
];

function lodFor(px: number): number {
  for (let i = 0; i < LODS.length - 1; i++) if (px > LODS[i].minPx) return i;
  return LODS.length - 1;
}

interface Chunk {
  box: Box3;
  coarseStart: number;
  coarseCount: number;
  fineStart: number;
  fineCount: number;
}

interface Bucket {
  mesh: Mesh;
  geometry: InstancedBufferGeometry;
  a: InstancedBufferAttribute;
  b: InstancedBufferAttribute;
  c: InstancedBufferAttribute;
  cap: number;
  count: number;
}

export interface VegetationStats {
  coarse: number;
  fine: number;
  chunks: number;
  drawn: number[];
  bandRadius: number;
}

const _proj = new Matrix4();
const _vp = new Matrix4();
const _frustum = new Frustum();
const _box = new Box3();
const _v = new Vector3();

/**
 * Forests and scatter: instanced clump-foliage trees (one material, one instanced mesh per LOD —
 * four draws plus their shadow-pass twins).
 *
 * - Placement (placement.ts) is a pure function of the world data, the quality density and the
 *   exclusion circles; it is recomputed only when one of those changes.
 * - evaluate(frame) selects what to draw as a pure function of the camera: chunk culling against
 *   the view frustum (+ shadow margin), per-chunk LOD by projected crown size, and a near-camera
 *   detail band (fine instances) whose crowns scale smoothly to zero at the band edge.
 */
export class VegetationSystem implements System {
  readonly id = 'vegetation';
  private parts!: FoliageMaterialParts;
  private lodGeometries: InstancedBufferGeometry[] = [];
  private buckets: Bucket[] = [];
  private scene: InitContext['scene'] | null = null;
  private exclusions: ExclusionCircle[] = [];
  private placedDensity = -1;
  private placedExclusions = -1;
  private exclusionsVersion = 0;
  private coarse = new Float32Array(0);
  private fine = new Float32Array(0);
  private fineY = new Float32Array(0);
  private coarseCell = 2;
  private chunks: Chunk[] = [];
  private lastKey = '';
  /** diagnostics (probe): force every instance into one LOD bucket, or drop the fine band */
  debug: { forceLod: number | null; noFine: boolean } = { forceLod: null, noFine: false };
  readonly stats: VegetationStats = { coarse: 0, fine: 0, chunks: 0, drawn: [], bandRadius: 0 };

  constructor(private readonly world: World) {}

  init(ctx: InitContext): void {
    this.scene = ctx.scene;
    this.parts = createFoliageMaterial(this.world);
    this.lodGeometries = LODS.map((l) => createClumpGeometry({ detail: l.detail, trunk: l.trunk }));
    this.place(ctx.quality.density);
  }

  /**
   * Clear vegetation from landmark footprints (world units). Placement is recomputed; the circles
   * are copied so later mutation by the caller has no effect.
   */
  setExclusions(circles: { x: number; z: number; r: number }[]): void {
    this.exclusions = circles.map((c) => ({ x: c.x, z: c.z, r: c.r }));
    this.exclusionsVersion++;
    if (this.placedDensity > 0) this.place(this.placedDensity);
  }

  getExclusions(): readonly ExclusionCircle[] {
    return this.exclusions;
  }

  // ------------------------------------------------------------------ placement

  private place(density: number): void {
    const res = placeVegetation(this.world, { density, seed: this.world.spec.json.seeds.world, exclusions: this.exclusions });
    this.coarseCell = res.coarseCell;
    const spec = this.world.spec;
    const ncx = Math.ceil(spec.width / CHUNK);
    const ncz = Math.ceil(spec.depth / CHUNK);
    const chunkOf = (x: number, z: number) => {
      const i = Math.min(ncx - 1, Math.max(0, Math.floor((x - spec.xMin) / CHUNK)));
      const j = Math.min(ncz - 1, Math.max(0, Math.floor((z - spec.zMin) / CHUNK)));
      return j * ncx + i;
    };
    // bucket both lists by chunk (counting sort keeps the order within a chunk deterministic)
    const sortByChunk = (src: number[]) => {
      const n = src.length / FLOATS_PER_INSTANCE;
      const counts = new Int32Array(ncx * ncz);
      const ids = new Int32Array(n);
      for (let k = 0; k < n; k++) {
        ids[k] = chunkOf(src[k * FLOATS_PER_INSTANCE], src[k * FLOATS_PER_INSTANCE + 1]);
        counts[ids[k]]++;
      }
      const start = new Int32Array(ncx * ncz);
      for (let c = 1; c < ncx * ncz; c++) start[c] = start[c - 1] + counts[c - 1];
      const fill = start.slice();
      const out = new Float32Array(src.length);
      for (let k = 0; k < n; k++) {
        const dst = fill[ids[k]]++ * FLOATS_PER_INSTANCE;
        for (let f = 0; f < FLOATS_PER_INSTANCE; f++) out[dst + f] = src[k * FLOATS_PER_INSTANCE + f];
      }
      return { out, start, counts };
    };
    const c = sortByChunk(res.coarse.data);
    const f = sortByChunk(res.fine.data);
    this.coarse = c.out;
    this.fine = f.out;
    const nFine = this.fine.length / FLOATS_PER_INSTANCE;
    this.fineY = new Float32Array(nFine);
    for (let k = 0; k < nFine; k++) this.fineY[k] = this.world.heights.sample(this.fine[k * FLOATS_PER_INSTANCE], this.fine[k * FLOATS_PER_INSTANCE + 1]);

    this.chunks = [];
    for (let j = 0; j < ncz; j++)
      for (let i = 0; i < ncx; i++) {
        const id = j * ncx + i;
        if (c.counts[id] === 0 && f.counts[id] === 0) continue;
        const x0 = spec.xMin + i * CHUNK;
        const z0 = spec.zMin + j * CHUNK;
        // crowns can reach a few km beyond the chunk edge and ~CROWN_TOP * vr above the ground
        const [y0, y1] = this.world.heights.rangeMinMax(x0 - 4, z0 - 4, x0 + CHUNK + 4, z0 + CHUNK + 4);
        this.chunks.push({
          box: new Box3(new Vector3(x0 - 4, y0 - 1, z0 - 4), new Vector3(x0 + CHUNK + 4, y1 + CROWN_TOP * 3.5, z0 + CHUNK + 4)),
          coarseStart: c.start[id],
          coarseCount: c.counts[id],
          fineStart: f.start[id],
          fineCount: f.counts[id],
        });
      }
    this.placedDensity = density;
    this.placedExclusions = this.exclusionsVersion;
    this.stats.coarse = res.coarse.count;
    this.stats.fine = res.fine.count;
    this.stats.chunks = this.chunks.length;
    this.allocateBuckets(res.coarse.count + res.fine.count);
    this.lastKey = '';
  }

  private allocateBuckets(total: number): void {
    const scene = this.scene!;
    for (const b of this.buckets) {
      scene.remove(b.mesh);
      b.geometry.dispose();
    }
    this.buckets = [];
    // the high LOD never needs every instance (it only covers the few chunks next to the camera)
    this.lodGeometries.forEach((base, lod) => {
      const cap = Math.max(1, Math.min(total, LODS[lod].cap));
      const geometry = base.clone() as InstancedBufferGeometry;
      const a = new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      const b = new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      const c = new InstancedBufferAttribute(new Uint8Array(cap * 4), 4, true);
      c.setUsage(DynamicDrawUsage);
      geometry.setAttribute('iC', c);
      a.setUsage(DynamicDrawUsage);
      b.setUsage(DynamicDrawUsage);
      geometry.setAttribute('iA', a);
      geometry.setAttribute('iB', b);
      geometry.instanceCount = 0;
      const mesh = new Mesh(geometry, this.parts.material);
      mesh.name = `vegetation-lod${lod}`;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = false;
      scene.add(mesh);
      this.buckets.push({ mesh, geometry, a, b, c, cap, count: 0 });
    });
  }

  // ------------------------------------------------------------------ per frame

  evaluate(frame: FrameContext): void {
    const density = frame.quality.density;
    if (density !== this.placedDensity || this.placedExclusions !== this.exclusionsVersion) this.place(density);

    const cam = frame.camera;
    const vh = frame.viewport.height;
    const tanY = Math.tan((cam.fov * Math.PI) / 360);
    const pxPerKm = vh / (2 * tanY);
    this.parts.pxPerKm.value = pxPerKm;

    const e = cam.matrixWorld.elements;
    const key = [cam.fov, cam.aspect, vh, density, this.exclusionsVersion, this.debug.forceLod ?? -1, +this.debug.noFine, ...e].map((v) => v.toFixed(5)).join(',');
    if (key === this.lastKey) return;
    this.lastKey = key;

    // own frustum (independent of the renderer's reversed-Z projection and of sub-pixel jitter)
    const near = 0.01;
    const top = near * tanY;
    const right = top * cam.aspect;
    _proj.makePerspective(-right, right, top, -top, near, 20000);
    _vp.multiplyMatrices(_proj, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_vp);

    const camPos = cam.position;
    const [tx, ty, tz] = frame.state.camera.target;
    const dTarget = Math.hypot(camPos.x - tx, camPos.y - ty, camPos.z - tz);
    const fineCrown = 1.3;
    const bandR = Math.min((fineCrown * pxPerKm) / 5, Math.max(20, Math.min(140 * Math.sqrt(Math.min(1, density / 0.75)), dTarget * 1.4)));
    const bandIn = bandR * 0.7;
    this.stats.bandRadius = bandR;

    for (const b of this.buckets) b.count = 0;
    const coarseD = 2 * this.coarseCell * 0.7;
    const F = FLOATS_PER_INSTANCE;

    for (const ch of this.chunks) {
      _box.copy(ch.box).expandByScalar(SHADOW_MARGIN);
      if (!_frustum.intersectsBox(_box)) continue;
      const d = Math.max(1, ch.box.distanceToPoint(camPos));
      // coarse: whole chunk at one LOD
      if (ch.coarseCount > 0) {
        const px = (coarseD * pxPerKm) / d;
        let lod = this.debug.forceLod ?? lodFor(px);
        while (lod < LODS.length - 1 && this.buckets[lod].count + ch.coarseCount > this.buckets[lod].cap) lod++;
        const bk = this.buckets[lod];
        const A = bk.a.array as Float32Array;
        const B = bk.b.array as Float32Array;
        const C = bk.c.array as Uint8Array;
        let n = bk.count;
        const end = (ch.coarseStart + ch.coarseCount) * F;
        for (let s = ch.coarseStart * F; s < end; s += F, n++) {
          const o = n * 4;
          A[o] = this.coarse[s];
          A[o + 1] = this.coarse[s + 1];
          A[o + 2] = this.coarse[s + 2];
          A[o + 3] = this.coarse[s + 3];
          B[o] = this.coarse[s + 4];
          B[o + 1] = this.coarse[s + 5];
          B[o + 2] = this.coarse[s + 6];
          B[o + 3] = 0;
          const rgb = this.coarse[s + 7];
          C[o] = rgb >>> 16;
          C[o + 1] = (rgb >>> 8) & 255;
          C[o + 2] = rgb & 255;
        }
        bk.count = n;
      }
      // fine: near-camera band only, crowns grow in over [bandR, 0.7 bandR]
      if (ch.fineCount > 0 && d < bandR && !this.debug.noFine) {
        for (let k = ch.fineStart; k < ch.fineStart + ch.fineCount; k++) {
          const s = k * F;
          const x = this.fine[s];
          const z = this.fine[s + 1];
          const dist = _v.set(x - camPos.x, this.fineY[k] - camPos.y, z - camPos.z).length();
          if (dist >= bandR) continue;
          const t = Math.min(1, Math.max(0, (dist - bandIn) / (bandR - bandIn)));
          const sc = 1 - t * t * (3 - 2 * t);
          if (sc < 0.03) continue;
          const px = (2 * this.fine[s + 2] * sc * pxPerKm) / Math.max(1, dist);
          let lod = this.debug.forceLod ?? lodFor(px);
          while (lod < LODS.length - 1 && this.buckets[lod].count >= this.buckets[lod].cap) lod++;
          const bk = this.buckets[lod];
          if (bk.count >= bk.cap) continue;
          const A = bk.a.array as Float32Array;
          const B = bk.b.array as Float32Array;
          const C = bk.c.array as Uint8Array;
          const o = bk.count * 4;
          A[o] = x;
          A[o + 1] = z;
          A[o + 2] = this.fine[s + 2] * sc;
          A[o + 3] = this.fine[s + 3] * sc;
          B[o] = this.fine[s + 4] * sc;
          B[o + 1] = this.fine[s + 5];
          B[o + 2] = this.fine[s + 6];
          B[o + 3] = 0;
          const rgb = this.fine[s + 7];
          C[o] = rgb >>> 16;
          C[o + 1] = (rgb >>> 8) & 255;
          C[o + 2] = rgb & 255;
          bk.count++;
        }
      }
    }

    this.buckets.forEach((bk, lod) => {
      this.stats.drawn[lod] = bk.count;
      bk.geometry.instanceCount = bk.count;
      bk.mesh.visible = bk.count > 0;
      if (bk.count > 0) {
        for (const attr of [bk.a, bk.b, bk.c]) {
          attr.clearUpdateRanges();
          attr.addUpdateRange(0, bk.count * 4);
          attr.needsUpdate = true;
        }
      }
    });
  }

  dispose(): void {
    for (const b of this.buckets) {
      this.scene?.remove(b.mesh);
      b.geometry.dispose();
    }
    for (const g of this.lodGeometries) g.dispose();
    this.parts?.material.dispose();
  }
}
