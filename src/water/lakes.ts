import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Uint32BufferAttribute, Vector2 } from 'three/webgpu';
import type { World } from '../world/World.ts';
import type { PoolRecord } from '../landmarks/records.ts';

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

/**
 * Landmark pools (world space) as lake polygons for the lake mesh: the ring is opened (a repeated
 * closing point dropped), degenerate rings are skipped. Keys are `pool:<landmark>:<index>`.
 */
export function poolInfos(pools: readonly PoolRecord[]): LakeInfo[] {
  const out: LakeInfo[] = [];
  pools.forEach((p, i) => {
    const ring = p.ring.map(([x, z]) => [x, z] as [number, number]);
    if (ring.length > 1 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 1e-6) ring.pop();
    if (ring.length < 3 || !Number.isFinite(p.level)) return;
    const xs = ring.map((q) => q[0]);
    const zs = ring.map((q) => q[1]);
    out.push({ key: `pool:${p.landmark}:${i}`, name: null, level: p.level, ring, bbox: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] });
  });
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

/**
 * S4 W4-S1 (the lake-town-close black shelf): a baked lake's surface reaches this far (km) beyond its
 * ring. The ring is the coarse ME-GIS polygon (the Long Lake: 34 points, 3–5 km chords) and the bake's
 * flattened lake bed does not follow it: between a chord and the true shore the bed lies below the lake
 * level with no water over it, painted the dark channel colour by the terrain (a hard-edged black
 * polygon in the lake-town-close foreground, and a straight seam where the Forest River's ribbon ran over
 * it). The skirt covers that strip; the lake material's baked-mask fade and waterline anti-aliasing cut
 * the true shore, and its alpha test keeps the invisible rest (over land, outflow valleys below the level)
 * out of the depth buffer.
 */
export const LAKE_SKIRT_KM = 1.2;

/** Push a skirt band `width` km outside an open ring at `level` (mitred offset, capped at concave folds). */
function pushSkirt(ring: [number, number][], level: number, width: number, pos: number[], idx: number[], pool: number[]): void {
  const n = ring.length;
  if (n < 3 || width <= 0) return;
  let a2 = 0;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % n];
    a2 += x0 * z1 - x1 * z0;
  }
  // outward unit normal of the edge i → i+1 (shoelace orientation of the (x, z) polygon)
  const sgn = a2 > 0 ? 1 : -1;
  const edgeN = (i: number): [number, number] => {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % n];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const L = Math.hypot(dx, dz) || 1;
    return [(sgn * dz) / L, (-sgn * dx) / L];
  };
  const base = pos.length / 3;
  for (let i = 0; i < n; i++) {
    const na = edgeN((i - 1 + n) % n);
    const nb = edgeN(i);
    let mx = na[0] + nb[0];
    let mz = na[1] + nb[1];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) {
      mx = nb[0];
      mz = nb[1];
    } else {
      mx /= ml;
      mz /= ml;
    }
    // mitre length 1 / cos(half the turn), capped (sharp corners)
    const k = width / Math.max(0.4, mx * nb[0] + mz * nb[1]);
    const [x, z] = ring[i];
    pos.push(x, level, z, x + mx * k, level, z + mz * k);
    pool.push(0, 0);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ri = base + 2 * i;
    const rj = base + 2 * j;
    pushUpTri(idx, pos, ri, rj, rj + 1);
    pushUpTri(idx, pos, ri, rj + 1, ri + 1);
  }
}

/**
 * All lakes as one flat, earcut-triangulated mesh (each polygon at its own level). `waterPool` is 1 on
 * landmark pools (keys `pool:…`), 0 on baked lakes: the lake material fades baked lakes by the baked
 * lake mask, pools only by their waterline. Baked lakes get a skirt of LAKE_SKIRT_KM beyond the ring.
 */
export function buildLakeGeometry(lakes: LakeInfo[], skirtKm = LAKE_SKIRT_KM): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const pool: number[] = [];
  for (const l of lakes) {
    const base = pos.length / 3;
    const contour = l.ring.map(([x, z]) => new Vector2(x, z));
    const isPool = l.key.startsWith('pool:') ? 1 : 0;
    for (const [x, z] of l.ring) {
      pos.push(x, l.level, z);
      pool.push(isPool);
    }
    const tris = ShapeUtils.triangulateShape(contour, []);
    for (const [a, b, c] of tris) pushUpTri(idx, pos, base + a, base + b, base + c);
    if (!isPool) pushSkirt(l.ring, l.level, skirtKm, pos, idx, pool);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('waterPool', new Float32BufferAttribute(pool, 1));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
