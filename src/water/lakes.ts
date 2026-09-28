import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Uint32BufferAttribute, Vector2 } from 'three/webgpu';
import type { World } from '../world/World.ts';

export interface LakeInfo {
  key: string;
  name: string | null;
  /** surface level, world units (the baked terrain is flattened below it) */
  level: number;
  /** open ring in world [x, z] */
  ring: [number, number][];
  bbox: [number, number, number, number];
}

/** Lakes with a known level (manifest first, then lakes.json). Lakes without one are skipped. */
export function lakeInfos(world: World): LakeInfo[] {
  const levels = new Map(world.spec.manifest.lakes.map((l) => [l.key, l.level]));
  const out: LakeInfo[] = [];
  for (const l of world.lakes) {
    const level = levels.get(l.key) ?? l.level;
    if (level === null || level === undefined || !Number.isFinite(level)) continue;
    const ring = l.ring.slice();
    const [fx, fz] = ring[0];
    const [lx, lz] = ring[ring.length - 1];
    if (Math.hypot(fx - lx, fz - lz) < 1e-6) ring.pop();
    if (ring.length < 3) continue;
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const [x, z] of ring) {
      x0 = Math.min(x0, x);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      z1 = Math.max(z1, z);
    }
    out.push({ key: l.key, name: l.name, level, ring, bbox: [x0, z0, x1, z1] });
  }
  return out;
}

/** Distance from (x, z) to a lake's shore ring (negative inside). */
export function lakeSignedDistance(lake: LakeInfo, x: number, z: number): number {
  const r = lake.ring;
  let best = Infinity;
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, az] = r[j];
    const [bx, bz] = r[i];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    const ex = bx - ax;
    const ez = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    best = Math.min(best, Math.hypot(x - (ax + ex * t), z - (az + ez * t)));
  }
  return inside ? -best : best;
}

/** The lake (if any) whose shore is within `radius` km of (x, z) or which contains it. */
export function lakeNear(lakes: LakeInfo[], x: number, z: number, radius: number): LakeInfo | null {
  let best: LakeInfo | null = null;
  let bd = radius;
  for (const l of lakes) {
    const [x0, z0, x1, z1] = l.bbox;
    if (x < x0 - radius || x > x1 + radius || z < z0 - radius || z > z1 + radius) continue;
    const d = lakeSignedDistance(l, x, z);
    if (d <= bd) {
      bd = d;
      best = l;
    }
  }
  return best;
}

/** Push triangle (a, b, c) with an upward (+Y) facing winding. */
export function pushUpTri(idx: number[], pos: ArrayLike<number>, a: number, b: number, c: number): void {
  const ax = pos[a * 3];
  const az = pos[a * 3 + 2];
  const bx = pos[b * 3] - ax;
  const bz = pos[b * 3 + 2] - az;
  const cx = pos[c * 3] - ax;
  const cz = pos[c * 3 + 2] - az;
  // (b − a) × (c − a) · ŷ = bz·cx − bx·cz
  if (bz * cx - bx * cz >= 0) idx.push(a, b, c);
  else idx.push(a, c, b);
}

/** All lakes as one flat, earcut-triangulated mesh (each polygon at its own level). */
export function buildLakeGeometry(lakes: LakeInfo[]): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const l of lakes) {
    const base = pos.length / 3;
    const contour = l.ring.map(([x, z]) => new Vector2(x, z));
    for (const [x, z] of l.ring) pos.push(x, l.level, z);
    const tris = ShapeUtils.triangulateShape(contour, []);
    for (const [a, b, c] of tris) pushUpTri(idx, pos, base + a, base + b, base + c);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
