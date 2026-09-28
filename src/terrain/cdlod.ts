import type { Vector3 } from 'three/webgpu';
import type { HeightField } from '../world/HeightField.ts';
import type { WorldSpec } from '../world/WorldSpec.ts';

/**
 * CDLOD quadtree selection (Strugar 2009, simplified).
 *
 * The frame (1600 x 960 km) is tiled by square root nodes; each level halves the node size.
 * LOD 0 is the finest. A node of LOD l is drawn only within ranges[l] of the camera; vertices
 * morph towards the next-coarser grid as they approach ranges[l], so neighbouring LODs meet
 * without cracks. Quadrants of a node whose child is out of range are drawn at the parent's
 * resolution (forced full morph).
 *
 * Selection is a pure function of the camera position → deterministic.
 */
export interface CdlodOptions {
  rootSize: number;
  levels: number;
  /** ranges[l] = rangeK * leafSize * 2^l */
  rangeK: number;
}

export class Cdlod {
  readonly leafSize: number;
  readonly ranges: number[];
  readonly morphStart: number[];
  private readonly roots: { x: number; z: number }[] = [];

  constructor(
    readonly spec: WorldSpec,
    readonly heights: HeightField,
    readonly opt: CdlodOptions,
  ) {
    this.leafSize = opt.rootSize / 2 ** (opt.levels - 1);
    this.ranges = [];
    this.morphStart = [];
    for (let l = 0; l < opt.levels; l++) {
      const r = opt.rangeK * this.leafSize * 2 ** l;
      this.ranges.push(l === opt.levels - 1 ? Number.POSITIVE_INFINITY : r);
      const prev = l === 0 ? 0 : opt.rangeK * this.leafSize * 2 ** (l - 1);
      this.morphStart.push(prev + (r - prev) * 0.66);
    }
    for (let z = spec.zMin; z < spec.zMax - 1e-6; z += opt.rootSize)
      for (let x = spec.xMin; x < spec.xMax - 1e-6; x += opt.rootSize) this.roots.push({ x, z });
  }

  /**
   * Fill `out` with patches [x, z, size, lodCode] (lodCode = lod, or lod + 100 when the patch is a
   * parent-resolution quadrant that must be fully morphed). Returns the patch count.
   */
  select(cam: Vector3, out: Float32Array): number {
    let n = 0;
    const cap = out.length / 4;
    const push = (x: number, z: number, size: number, code: number) => {
      if (n >= cap) return;
      out[n * 4] = x;
      out[n * 4 + 1] = z;
      out[n * 4 + 2] = size;
      out[n * 4 + 3] = code;
      n++;
    };
    const distToNode = (x: number, z: number, size: number): number => {
      const [mn, mx] = this.heights.rangeMinMax(x, z, x + size, z + size);
      const dx = Math.max(x - cam.x, 0, cam.x - (x + size));
      const dz = Math.max(z - cam.z, 0, cam.z - (z + size));
      const dy = Math.max(mn - cam.y, 0, cam.y - mx);
      return Math.hypot(dx, dy, dz);
    };
    const visit = (x: number, z: number, size: number, lod: number): boolean => {
      if (distToNode(x, z, size) > this.ranges[lod]) return false;
      if (lod === 0) {
        push(x, z, size, 0);
        return true;
      }
      if (distToNode(x, z, size) > this.ranges[lod - 1]) {
        push(x, z, size, lod);
        return true;
      }
      const h = size / 2;
      for (const [ox, oz] of [
        [0, 0],
        [h, 0],
        [0, h],
        [h, h],
      ]) {
        if (!visit(x + ox, z + oz, h, lod - 1)) push(x + ox, z + oz, h, lod + 100);
      }
      return true;
    };
    for (const r of this.roots) visit(r.x, r.z, this.opt.rootSize, this.opt.levels - 1);
    return n;
  }
}
