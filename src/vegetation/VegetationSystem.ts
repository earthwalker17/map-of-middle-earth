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
import { createFoamTexture } from './foamTexture.ts';
import { createFoliageMaterial, type FoliageMaterialParts } from './foliageMaterial.ts';
import { FLOATS_PER_INSTANCE, placeVegetation, type ExclusionCircle } from './placement.ts';

/** Spatial chunk size (km) for culling / LOD selection. */
const CHUNK = 32;
/** Extra margin (km) around chunks for the frustum test so off-screen casters still shadow. */
const SHADOW_MARGIN = 28;
/**
 * LOD ladder: sub-crown tessellation (sphere detail: −1 octahedron … 2 = 320 tris per sub-crown,
 * seven sub-crowns per cluster), trunk prism sides, and the projected cluster diameter (px) above
 * which it is used. The fragment micro-structure carries the close-range detail, so geometry stays
 * modest; the octahedron LOD keeps the seven sub-crowns (the canopy texture of regional shots)
 * and a three-sided trunk hint; below a few pixels one blob stands in for the cluster.
 */
const LODS: { detail: number; trunkSides: number; relief: number; whole?: boolean; minPx: number; cap: number }[] = [
  { detail: 2, trunkSides: 6, relief: 1, minPx: 100, cap: 4000 },
  { detail: 1, trunkSides: 6, relief: 0, minPx: 38, cap: 40000 },
  { detail: 0, trunkSides: 4, relief: 0, minPx: 9, cap: Infinity },
  { detail: -1, trunkSides: 3, relief: 0, minPx: 5, cap: Infinity },
  // a cluster of a few pixels (whole-slab views): one octahedron blob, no trunk
  { detail: -1, trunkSides: 0, relief: 0, whole: true, minPx: 0, cap: Infinity },
];

/** spread from a record's packed shape field (spread + 2·gapQ) */
function spreadOf(shape: number): number {
  return shape - 2 * Math.floor(shape / 2);
}

function lodFor(px: number): number {
  for (let i = 0; i < LODS.length - 1; i++) if (px > LODS[i].minPx) return i;
  return LODS.length - 1;
}

interface Chunk {
  box: Box3;
  /** largest projected-size radius of the chunk's coarse instances (hr · (2 − spread)), km */
  coarseMaxR: number;
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
  /** one foliage material per quality tier (the micro structure is tier-aware); built on demand */
  private materials = new Map<string, FoliageMaterialParts>();
  private materialTier = '';
  private foam: ReturnType<typeof createFoamTexture> | null = null;
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
  private coarseY = new Float32Array(0);
  private chunks: Chunk[] = [];
  private lastKey = '';
  /** diagnostics (probe): force every instance into one LOD bucket, or drop the fine band */
  debug: { forceLod: number | null; noFine: boolean } = { forceLod: null, noFine: false };
  readonly stats: VegetationStats = { coarse: 0, fine: 0, chunks: 0, drawn: [], bandRadius: 0 };

  constructor(private readonly world: World) {}

  init(ctx: InitContext): void {
    this.scene = ctx.scene;
    this.useMaterial(ctx.quality.id);
    this.lodGeometries = LODS.map((l) => createClumpGeometry({ detail: l.detail, trunkSides: l.trunkSides, relief: l.relief, whole: l.whole }));
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

  /** Select (building once) the foliage material of a quality tier: preview samples one foam scale, review/final two. */
  private useMaterial(tier: string): void {
    if (tier === this.materialTier) return;
    let parts = this.materials.get(tier);
    if (!parts) {
      this.foam ??= createFoamTexture(this.world.spec.json.seeds.world + 71);
      parts = createFoliageMaterial(this.world, { microTaps: tier === 'preview' ? 1 : 2, foam: this.foam });
      this.materials.set(tier, parts);
    }
    this.parts = parts;
    this.materialTier = tier;
    for (const b of this.buckets) b.mesh.material = parts.material;
  }

  // ------------------------------------------------------------------ placement

  private place(density: number): void {
    const res = placeVegetation(this.world, { density, seed: this.world.spec.json.seeds.world, exclusions: this.exclusions });
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
    const heightsOf = (list: Float32Array) => {
      const n = list.length / FLOATS_PER_INSTANCE;
      const y = new Float32Array(n);
      for (let k = 0; k < n; k++) y[k] = this.world.heights.sample(list[k * FLOATS_PER_INSTANCE], list[k * FLOATS_PER_INSTANCE + 1]);
      return y;
    };
    this.fineY = heightsOf(this.fine);
    this.coarseY = heightsOf(this.coarse);

    this.chunks = [];
    for (let j = 0; j < ncz; j++)
      for (let i = 0; i < ncx; i++) {
        const id = j * ncx + i;
        if (c.counts[id] === 0 && f.counts[id] === 0) continue;
        const x0 = spec.xMin + i * CHUNK;
        const z0 = spec.zMin + j * CHUNK;
        // crowns can reach a few km beyond the chunk edge and ~CROWN_TOP * vr above the ground
        const [y0, y1] = this.world.heights.rangeMinMax(x0 - 4, z0 - 4, x0 + CHUNK + 4, z0 + CHUNK + 4);
        let coarseMaxR = 0;
        for (let k = c.start[id]; k < c.start[id] + c.counts[id]; k++) coarseMaxR = Math.max(coarseMaxR, this.coarse[k * FLOATS_PER_INSTANCE + 2] * (2 - spreadOf(this.coarse[k * FLOATS_PER_INSTANCE + 8])));
        this.chunks.push({
          box: new Box3(new Vector3(x0 - 4, y0 - 1, z0 - 4), new Vector3(x0 + CHUNK + 4, y1 + CROWN_TOP * 3.5, z0 + CHUNK + 4)),
          coarseMaxR,
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
    this.useMaterial(frame.quality.id);
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
    const F = FLOATS_PER_INSTANCE;
    const last = LODS.length - 1;
    /** append record `s` of `src` to the bucket of `lod` (or the next one with room), crowns scaled by `sc` */
    const emit = (src: Float32Array, s: number, lod: number, sc: number) => {
      while (lod < last && this.buckets[lod].count >= this.buckets[lod].cap) lod++;
      const bk = this.buckets[lod];
      if (bk.count >= bk.cap) return;
      const A = bk.a.array as Float32Array;
      const B = bk.b.array as Float32Array;
      const C = bk.c.array as Uint8Array;
      const o = bk.count * 4;
      A[o] = src[s];
      A[o + 1] = src[s + 1];
      A[o + 2] = src[s + 2] * sc;
      A[o + 3] = src[s + 3] * sc;
      B[o] = src[s + 4] * sc;
      B[o + 1] = src[s + 5];
      B[o + 2] = src[s + 6];
      B[o + 3] = src[s + 8];
      const rgb = src[s + 7];
      C[o] = rgb >>> 16;
      C[o + 1] = (rgb >>> 8) & 255;
      C[o + 2] = rgb & 255;
      C[o + 3] = Math.round(src[s + 9] * 255);
      bk.count++;
    };
    /** LOD from the projected size of the sub-crowns (clustered trees have larger ones than canopy patches) */
    const lodOf = (src: Float32Array, s: number, dist: number, sc: number) =>
      this.debug.forceLod ?? lodFor((2 * src[s + 2] * sc * (2 - spreadOf(src[s + 8])) * pxPerKm) / Math.max(1, dist));

    for (const ch of this.chunks) {
      _box.copy(ch.box).expandByScalar(SHADOW_MARGIN);
      if (!_frustum.intersectsBox(_box)) continue;
      const d = Math.max(1, ch.box.distanceToPoint(camPos));
      // coarse: per-instance LOD, or the whole chunk at the far LOD when even its largest crown is small
      if (ch.coarseCount > 0) {
        const farChunk = this.debug.forceLod === null && lodFor((2 * ch.coarseMaxR * pxPerKm) / d) === last;
        for (let k = ch.coarseStart; k < ch.coarseStart + ch.coarseCount; k++) {
          const s = k * F;
          if (farChunk) {
            emit(this.coarse, s, last, 1);
            continue;
          }
          const dist = _v.set(this.coarse[s] - camPos.x, this.coarseY[k] - camPos.y, this.coarse[s + 1] - camPos.z).length();
          emit(this.coarse, s, lodOf(this.coarse, s, dist, 1), 1);
        }
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
          emit(this.fine, s, lodOf(this.fine, s, dist, sc), sc);
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
    for (const m of this.materials.values()) m.material.dispose();
    this.foam?.dispose();
  }
}
