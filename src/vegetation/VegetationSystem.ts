import {
  Box3,
  DynamicDrawUsage,
  Frustum,
  InstancedBufferAttribute,
  type InstancedBufferGeometry,
  Matrix4,
  Mesh,
  Sphere,
  Vector3,
} from 'three/webgpu';
import type { FrameContext, InitContext, System } from '../core/types.ts';
import type { World } from '../world/World.ts';
import type { AuthoredTree, ForestRecord, TreeCapRecord } from '../landmarks/records.ts';
import { createClumpGeometry, CROWN_TOP } from './clumpGeometry.ts';
import { createFoamTexture } from './foamTexture.ts';
import { createFoliageMaterial, type FoliageMaterialParts } from './foliageMaterial.ts';
import { FLOATS_PER_INSTANCE, placeVegetation, type ExclusionCircle } from './placement.ts';
import { authoredRecords, crownMaxReach } from './authored.ts';
import { landmarkForestRecords } from './forests.ts';
import { archOf, retires, spreadOf } from './archetypes.ts';
import { bakeCanopyShell, setShellTier } from './canopyShell.ts';
import { SHELL_ON, shellBand, shellTierScale } from './shellConfig.ts';
import { applyTreeCaps } from './treeCaps.ts';

/** Spatial chunk size (km) for culling / LOD selection. */
const CHUNK = 32;
/**
 * Preview LOD bias (× the projected size the LOD ladder sees): the explorer's tier steps the placed trees
 * down the tessellation ladder sooner — the same crowns at the same size, fewer triangles (S4: the forests
 * hold ≈ 4× the S3 canopy patches at half their size). Hero trees keep the unbiased ladder.
 */
const PREVIEW_LOD_BIAS = 0.6;
/** Extra margin (km) around chunks for the frustum test so off-screen casters still shadow. */
const SHADOW_MARGIN = 28;
/**
 * LOD ladder: sub-crown tessellation (sphere detail: −1 octahedron … 2 = 320 tris per sub-crown,
 * seven sub-crowns per cluster), trunk prism sides, and the projected cluster diameter (px) above
 * which it is used. The fragment micro-structure carries the close-range detail, so geometry stays
 * modest; the octahedron LOD keeps the seven sub-crowns (the canopy texture of regional shots)
 * and a three-sided trunk hint; below a few pixels one blob stands in for the cluster.
 */
const LODS: { detail: number; trunkSides: number; relief: number; whole?: boolean; limbs?: boolean; minPx: number; cap: number }[] = [
  { detail: 2, trunkSides: 6, relief: 1, limbs: true, minPx: 100, cap: 4000 },
  { detail: 1, trunkSides: 6, relief: 0, minPx: 38, cap: 40000 },
  { detail: 0, trunkSides: 4, relief: 0, minPx: 9, cap: Infinity },
  { detail: -1, trunkSides: 3, relief: 0, minPx: 5, cap: Infinity },
  // a cluster of a few pixels (whole-slab views): one octahedron blob, no trunk
  { detail: -1, trunkSides: 0, relief: 0, whole: true, minPx: 0, cap: Infinity },
];

/**
 * Hero geometry: authored landmark trees at LOD0 are drawn with the finest crowns plus a ringed,
 * 12-sided trunk (root flare, taper, deep foot) and four primary limbs — one extra draw (+ its shadow
 * twin), only ever holding the hero list.
 */
const HERO_GEOMETRY = { detail: 2, trunkSides: 12, relief: 1, hero: true } as const;

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
  /** canopy patches (the retiring archetypes; a separate list so far chunks skip them whole) */
  canopyMaxR: number;
  canopyStart: number;
  canopyCount: number;
  fineStart: number;
  fineCount: number;
}

/** 1 → 0 across the shell band [near, far]: the scale of a retiring canopy record at `dist` km from the camera */
function shellScale(dist: number, near: number, far: number): number {
  const t = Math.min(1, Math.max(0, (dist - near) / (far - near)));
  return 1 - t * t * (3 - 2 * t);
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
  /** canopy patches (retiring archetypes, part of the placed coarse grid) */
  canopy: number;
  fine: number;
  /** placed / forest records scaled down by landmark tree-height caps */
  capped: number;
  /** authored (hero) records scaled down by landmark tree-height caps */
  cappedHero: number;
  /** authored landmark trees (hero list) */
  hero: number;
  /** trees of landmark forests (part of `coarse`) */
  forest: number;
  chunks: number;
  drawn: number[];
  bandRadius: number;
}

const _proj = new Matrix4();
const _vp = new Matrix4();
const _frustum = new Frustum();
const _box = new Box3();
const _v = new Vector3();
const _sphere = new Sphere();
const _band = { near: 0, far: 0 };

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
  private authored: AuthoredTree[] = [];
  private forests: ForestRecord[] = [];
  private caps: TreeCapRecord[] = [];
  private placedDensity = -1;
  private placedExclusions = -1;
  private exclusionsVersion = 0;
  private coarse = new Float32Array(0);
  private canopy = new Float32Array(0);
  private fine = new Float32Array(0);
  private fineY = new Float32Array(0);
  private coarseY = new Float32Array(0);
  private canopyY = new Float32Array(0);
  /** authored landmark trees as instance records (+ their ground heights): the hero list */
  private hero = new Float32Array(0);
  private heroY = new Float32Array(0);
  private chunks: Chunk[] = [];
  private lastKey = '';
  /** diagnostics (probe): force every instance into one LOD bucket, or drop the fine band */
  debug: { forceLod: number | null; noFine: boolean } = { forceLod: null, noFine: false };
  readonly stats: VegetationStats = { coarse: 0, canopy: 0, fine: 0, hero: 0, forest: 0, chunks: 0, drawn: [], bandRadius: 0, capped: 0, cappedHero: 0 };

  constructor(private readonly world: World) {}

  init(ctx: InitContext): void {
    this.scene = ctx.scene;
    this.useMaterial(ctx.quality.id);
    this.lodGeometries = LODS.map((l) => createClumpGeometry({ detail: l.detail, trunkSides: l.trunkSides, relief: l.relief, whole: l.whole, limbs: l.limbs }));
    // the last bucket: hero geometry (authored trees at LOD0)
    this.lodGeometries.push(createClumpGeometry(HERO_GEOMETRY));
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

  /**
   * Authored landmark hero trees (world space, from buildLandmarks). Realized as a hero list
   * (authored.ts records) emitted before the placed vegetation every frame, so they win the LOD0
   * cap; never subject to exclusions, the barren rule or density thinning (preview matches final).
   * Call before init (later calls rebuild the list).
   */
  setAuthored(trees: AuthoredTree[]): void {
    this.authored = trees.map((t) => ({ ...t }));
    if (this.placedDensity > 0) {
      this.buildHero();
      this.allocateBuckets(this.stats.coarse + this.stats.canopy + this.stats.fine);
      this.lastKey = '';
    }
  }

  private buildHero(): void {
    const list = authoredRecords(this.authored, this.world.spec.json.seeds.world + 97);
    this.hero = Float32Array.from(list.data);
    this.stats.cappedHero = applyTreeCaps(this.hero, FLOATS_PER_INSTANCE, this.caps);
    const n = list.count;
    this.heroY = new Float32Array(n);
    for (let k = 0; k < n; k++) this.heroY[k] = this.world.heights.sample(this.hero[k * FLOATS_PER_INSTANCE], this.hero[k * FLOATS_PER_INSTANCE + 1]);
    this.stats.hero = n;
  }

  /**
   * Landmark forests (world space, from buildLandmarks): placed with the natural vegetation (chunked,
   * LOD-capped, thinned with the quality density; forests.ts). Call before init (later calls re-place).
   */
  setForests(forests: ForestRecord[]): void {
    this.forests = forests.map((f) => ({ ...f }));
    this.exclusionsVersion++;
    if (this.placedDensity > 0) this.place(this.placedDensity);
  }

  /**
   * Landmark tree-height caps (world circles, landmarks/world.ts landmarkTreeCaps): placed, forest and
   * authored trees inside are scaled to ≤ maxHeightKm. Call before init (later calls re-place).
   */
  setTreeCaps(caps: TreeCapRecord[]): void {
    this.caps = caps.map((c) => ({ ...c }));
    this.exclusionsVersion++;
    if (this.placedDensity > 0) this.place(this.placedDensity);
  }

  getAuthored(): readonly AuthoredTree[] {
    return this.authored;
  }

  getExclusions(): readonly ExclusionCircle[] {
    return this.exclusions;
  }

  /**
   * S5 film (the route line's canopy pull): for each point (x, y, z triples, world km) how far the crowns
   * that reach within `reachKm` of it (horizontally, beyond their own crown radius) rise above its height
   * — 0 where none do. Every placed list (coarse, canopy, fine) and the authored heroes, at full size. Pure
   * function of the placement (quality density, exclusions, forests, caps); call after init.
   */
  canopyAlong(xyz: ArrayLike<number>, reachKm: number): Float32Array {
    const n = Math.floor(xyz.length / 3);
    const out = new Float32Array(n);
    const spec = this.world.spec;
    const CELL = 1;
    const ncx = Math.max(1, Math.ceil(spec.width / CELL));
    const ncz = Math.max(1, Math.ceil(spec.depth / CELL));
    const ci = (x: number) => Math.min(ncx - 1, Math.max(0, Math.floor((x - spec.xMin) / CELL)));
    const cj = (z: number) => Math.min(ncz - 1, Math.max(0, Math.floor((z - spec.zMin) / CELL)));
    // the points in a 1 km hash grid
    const grid = new Map<number, number[]>();
    for (let p = 0; p < n; p++) {
      const key = cj(xyz[p * 3 + 2]) * ncx + ci(xyz[p * 3]);
      const cell = grid.get(key);
      if (cell) cell.push(p);
      else grid.set(key, [p]);
    }
    const F = FLOATS_PER_INSTANCE;
    for (const [list, ys] of [
      [this.coarse, this.coarseY],
      [this.canopy, this.canopyY],
      [this.fine, this.fineY],
      [this.hero, this.heroY],
    ] as const) {
      const count = list.length / F;
      for (let k = 0; k < count; k++) {
        const o = k * F;
        const x = list[o];
        const z = list[o + 1];
        const shape = list[o + 8];
        const spread = spreadOf(shape);
        const r = list[o + 2] * (2 - spread) + reachKm;
        const top = ys[k] + list[o + 4] + crownMaxReach(spread, archOf(shape)) * list[o + 3];
        for (let j = cj(z - r); j <= cj(z + r); j++)
          for (let i = ci(x - r); i <= ci(x + r); i++) {
            const cell = grid.get(j * ncx + i);
            if (!cell) continue;
            for (const p of cell) {
              const dx = xyz[p * 3] - x;
              const dz = xyz[p * 3 + 2] - z;
              if (dx * dx + dz * dz > r * r) continue;
              const rise = top - xyz[p * 3 + 1];
              if (rise > out[p]) out[p] = rise;
            }
          }
      }
    }
    return out;
  }

  /** Select (building once) the foliage material of a quality tier: preview samples one foam scale, review/final two. */
  private useMaterial(tier: string): void {
    if (tier === this.materialTier) return;
    let parts = this.materials.get(tier);
    if (!parts) {
      this.foam ??= createFoamTexture(this.world.spec.json.seeds.world + 71);
      parts = createFoliageMaterial(this.world, { microTaps: tier === 'preview' ? 1 : 2, spill: tier !== 'preview', foam: this.foam });
      this.materials.set(tier, parts);
    }
    this.parts = parts;
    this.materialTier = tier;
    for (const b of this.buckets) b.mesh.material = parts.material;
  }

  // ------------------------------------------------------------------ placement

  private place(density: number): void {
    const res = placeVegetation(this.world, { density, seed: this.world.spec.json.seeds.world, exclusions: this.exclusions });
    // landmark forests join the always-drawn coarse list (chunked and LOD-selected like any stand)
    const woods = landmarkForestRecords(this.world, this.forests, density);
    for (const v of woods.data) res.coarse.data.push(v);
    this.stats.forest = woods.count;
    this.stats.capped = applyTreeCaps(res.coarse.data, FLOATS_PER_INSTANCE, this.caps) + applyTreeCaps(res.fine.data, FLOATS_PER_INSTANCE, this.caps);
    // the far canopy shell: the canopy patches' colour / cover (retiring archetypes and the standing edge
    // ring) go into the shell texture the terrain samples; the retiring patches to their own chunked list
    const canopyData: number[] = [];
    if (SHELL_ON) {
      const F0 = FLOATS_PER_INSTANCE;
      const src = res.coarse.data;
      const sp = this.world.spec;
      bakeCanopyShell({ xMin: sp.xMin, zMin: sp.zMin, width: sp.width, depth: sp.depth }, src, F0);
      const keep: number[] = [];
      for (let k = 0; k < src.length / F0; k++) {
        const dst = retires(archOf(src[k * F0 + 8])) ? canopyData : keep;
        for (let f = 0; f < F0; f++) dst.push(src[k * F0 + f]);
      }
      res.coarse.data = keep;
    }
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
    const cn = sortByChunk(canopyData);
    const f = sortByChunk(res.fine.data);
    this.coarse = c.out;
    this.canopy = cn.out;
    this.fine = f.out;
    const heightsOf = (list: Float32Array) => {
      const n = list.length / FLOATS_PER_INSTANCE;
      const y = new Float32Array(n);
      for (let k = 0; k < n; k++) y[k] = this.world.heights.sample(list[k * FLOATS_PER_INSTANCE], list[k * FLOATS_PER_INSTANCE + 1]);
      return y;
    };
    this.fineY = heightsOf(this.fine);
    this.coarseY = heightsOf(this.coarse);
    this.canopyY = heightsOf(this.canopy);

    this.chunks = [];
    for (let j = 0; j < ncz; j++)
      for (let i = 0; i < ncx; i++) {
        const id = j * ncx + i;
        if (c.counts[id] === 0 && cn.counts[id] === 0 && f.counts[id] === 0) continue;
        const x0 = spec.xMin + i * CHUNK;
        const z0 = spec.zMin + j * CHUNK;
        // crowns can reach a few km beyond the chunk edge and ~CROWN_TOP * vr above the ground
        const [y0, y1] = this.world.heights.rangeMinMax(x0 - 4, z0 - 4, x0 + CHUNK + 4, z0 + CHUNK + 4);
        const maxR = (list: Float32Array, start: number, count: number) => {
          let m = 0;
          for (let k = start; k < start + count; k++) m = Math.max(m, list[k * FLOATS_PER_INSTANCE + 2] * (2 - spreadOf(list[k * FLOATS_PER_INSTANCE + 8])));
          return m;
        };
        this.chunks.push({
          box: new Box3(new Vector3(x0 - 4, y0 - 1, z0 - 4), new Vector3(x0 + CHUNK + 4, y1 + CROWN_TOP * 3.5, z0 + CHUNK + 4)),
          coarseMaxR: maxR(this.coarse, c.start[id], c.counts[id]),
          coarseStart: c.start[id],
          coarseCount: c.counts[id],
          canopyMaxR: maxR(this.canopy, cn.start[id], cn.counts[id]),
          canopyStart: cn.start[id],
          canopyCount: cn.counts[id],
          fineStart: f.start[id],
          fineCount: f.counts[id],
        });
      }
    this.placedDensity = density;
    this.placedExclusions = this.exclusionsVersion;
    this.stats.coarse = res.coarse.count;
    this.stats.canopy = canopyData.length / FLOATS_PER_INSTANCE;
    this.stats.fine = res.fine.count;
    this.stats.chunks = this.chunks.length;
    this.buildHero();
    this.allocateBuckets(res.coarse.count + this.stats.canopy + res.fine.count);
    this.lastKey = '';
  }

  private allocateBuckets(placed: number): void {
    const scene = this.scene!;
    const total = placed + this.hero.length / FLOATS_PER_INSTANCE;
    for (const b of this.buckets) {
      scene.remove(b.mesh);
      b.geometry.dispose();
    }
    this.buckets = [];
    // the high LOD never needs every instance (it only covers the few chunks next to the camera); the
    // hero bucket holds at most the hero list
    const heroCount = this.hero.length / FLOATS_PER_INSTANCE;
    this.lodGeometries.forEach((base, lod) => {
      const cap = Math.max(1, lod >= LODS.length ? heroCount : Math.min(total, LODS[lod].cap));
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
      mesh.name = lod >= LODS.length ? 'vegetation-hero' : `vegetation-lod${lod}`;
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
    // the far canopy shell's hand-over band (the terrain derives the same band from env.pxPerKm and the
    // tier controls set here: the preview retires earlier and draws the shell without its relief)
    const tierScale = shellTierScale(frame.quality.id);
    setShellTier(tierScale, frame.quality.id !== 'preview');
    shellBand(pxPerKm, tierScale, _band);
    const shellNear = _band.near;
    const shellFar = _band.far;

    const e = cam.matrixWorld.elements;
    // every input of the selection below (the fine band's radius reads the camera target's distance; the
    // tier's LOD bias rides on its density): a cache hit is exactly what a fresh evaluation would give
    const key = [cam.fov, cam.aspect, vh, density, this.exclusionsVersion, this.debug.forceLod ?? -1, +this.debug.noFine, ...frame.state.camera.target, ...e].map((v) => v.toFixed(5)).join(',');
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
    /** append record `s` of `src` to bucket `bk` (when it has room), crowns scaled by `sc` (height by `scV`) */
    const write = (bk: Bucket, src: Float32Array, s: number, sc: number, scV = sc) => {
      if (bk.count >= bk.cap) return;
      const A = bk.a.array as Float32Array;
      const B = bk.b.array as Float32Array;
      const C = bk.c.array as Uint8Array;
      const o = bk.count * 4;
      A[o] = src[s];
      A[o + 1] = src[s + 1];
      A[o + 2] = src[s + 2] * sc;
      A[o + 3] = src[s + 3] * scV;
      B[o] = src[s + 4] * scV;
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
    /** append record `s` of `src` to the bucket of `lod` (or the next one with room), crowns scaled by `sc` (height by `scV`) */
    const emit = (src: Float32Array, s: number, lod: number, sc: number, scV = sc) => {
      while (lod < last && this.buckets[lod].count >= this.buckets[lod].cap) lod++;
      write(this.buckets[lod], src, s, sc, scV);
    };
    /** LOD from the projected size of the sub-crowns (clustered trees have larger ones than canopy patches) */
    const lodOf = (src: Float32Array, s: number, dist: number, sc: number, bias = 1) =>
      this.debug.forceLod ?? lodFor((2 * src[s + 2] * sc * (2 - spreadOf(src[s + 8])) * pxPerKm * bias) / Math.max(1, dist));
    const lodBias = frame.quality.id === 'preview' ? PREVIEW_LOD_BIAS : 1;

    // hero list first: authored landmark trees (sphere test with the shadow margin); at LOD0 they take
    // the hero geometry (its own bucket), farther out they win the regular LOD caps
    const heroBucket = this.buckets[LODS.length];
    for (let k = 0; k < this.heroY.length; k++) {
      const s = k * F;
      const hr = this.hero[s + 2];
      const vr = this.hero[s + 3];
      // bounding sphere of the whole tree: trunk foot (1 km below the ground, the deep hero foot) to the
      // tallest crown top (trunk + crownMaxReach(spread, arch)·vr), crown radius hr
      const half = (Math.max(0, this.hero[s + 4]) + crownMaxReach(spreadOf(this.hero[s + 8]), archOf(this.hero[s + 8])) * vr + 1) / 2;
      const cy = this.heroY[k] - 1 + half;
      _sphere.set(_v.set(this.hero[s], cy, this.hero[s + 1]), Math.hypot(hr, half) + SHADOW_MARGIN);
      if (!_frustum.intersectsSphere(_sphere)) continue;
      const dist = _v.set(this.hero[s] - camPos.x, this.heroY[k] + this.hero[s + 4] - camPos.y, this.hero[s + 1] - camPos.z).length();
      const lod = lodOf(this.hero, s, dist, 1);
      if (lod === 0 && this.debug.forceLod === null && heroBucket.count < heroBucket.cap) write(heroBucket, this.hero, s, 1);
      else emit(this.hero, s, lod, 1);
    }

    // visible chunks nearest-first (ties by chunk order), so the capped fine LODs fill from the camera out
    const visible: { ch: Chunk; d: number; i: number }[] = [];
    this.chunks.forEach((ch, i) => {
      _box.copy(ch.box).expandByScalar(SHADOW_MARGIN);
      if (!_frustum.intersectsBox(_box)) return;
      visible.push({ ch, d: Math.max(1, ch.box.distanceToPoint(camPos)), i });
    });
    visible.sort((a, b) => a.d - b.d || a.i - b.i);

    for (const { ch, d } of visible) {
      // coarse: per-instance LOD, or the whole chunk at the far LOD when even its largest crown is small
      if (ch.coarseCount > 0) {
        const farChunk = this.debug.forceLod === null && lodFor((2 * ch.coarseMaxR * pxPerKm * lodBias) / d) === last;
        for (let k = ch.coarseStart; k < ch.coarseStart + ch.coarseCount; k++) {
          const s = k * F;
          if (farChunk) {
            emit(this.coarse, s, last, 1);
            continue;
          }
          const dist = _v.set(this.coarse[s] - camPos.x, this.coarseY[k] - camPos.y, this.coarse[s + 1] - camPos.z).length();
          emit(this.coarse, s, lodOf(this.coarse, s, dist, 1, lodBias), 1);
        }
      }
      // canopy patches: retired into the far canopy shell across [shellNear, shellFar] — the crowns sink
      // into it (height to zero, width to half) while the terrain's shell fades in over the same distances;
      // chunks wholly beyond it are skipped
      if (ch.canopyCount > 0 && d < shellFar) {
        for (let k = ch.canopyStart; k < ch.canopyStart + ch.canopyCount; k++) {
          const s = k * F;
          const dist = _v.set(this.canopy[s] - camPos.x, this.canopyY[k] - camPos.y, this.canopy[s + 1] - camPos.z).length();
          const sc = shellScale(dist, shellNear, shellFar);
          if (sc < 0.03) continue;
          const scH = 0.5 + 0.5 * sc;
          emit(this.canopy, s, lodOf(this.canopy, s, dist, scH, lodBias), scH, sc);
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
          // (forest fill retires into the canopy shell with the patches: sinking like them)
          const band = 1 - t * t * (3 - 2 * t);
          const shell = SHELL_ON && retires(archOf(this.fine[s + 8])) ? shellScale(dist, shellNear, shellFar) : 1;
          const sc = band * shell;
          if (sc < 0.03) continue;
          const scH = band * (0.5 + 0.5 * shell);
          emit(this.fine, s, lodOf(this.fine, s, dist, scH, lodBias), scH, sc);
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
