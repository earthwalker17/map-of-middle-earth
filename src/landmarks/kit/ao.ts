import type { BufferAttribute, BufferGeometry } from 'three/webgpu';
import { halton } from '../../core/rng.ts';
import { AO_MIN, CONTACT_LEVELS } from '../../materials/families.ts';
import type { LodGeometry } from '../records.ts';

/**
 * Vertex ambient occlusion for landmark geometry (kit v2; reusable for GLB landmarks, W2).
 *
 * One voxel occupancy grid per landmark from LOD0 (every material key — glow parts occlude too), with an
 * ABSOLUTE voxel size (`voxelKm`, default 0.025 km: walls, palisades and crowns 0.03–0.08 km thick span
 * whole voxels instead of self-occluding inside one), grown only when the grid would exceed `maxCells`.
 * The terrain is an exact height test per ray step (not voxels), and a ray that meets it counts
 * `groundWeight` (the ground bounces light; the environment's hemisphere already darkens from below).
 *
 * Per vertex: a few cosine-weighted Halton hemisphere rays start 1.5 voxels out along the normal (the
 * start cell never counts as a hit), memoised per (start cell × quantised normal) so the cost follows
 * the occupied volume, not the vertex count. Results, for 'structure' geometry only:
 *  - `color.a` = hemisphere AO, clamped to the part's floor (`_aoMin`: foliage 0.5, else AO_MIN 0.35) —
 *    the shader feeds it to the AO slot (indirect light) only;
 *  - `surf.a` low 5 bits = ground contact `smoothstep(0, 0.08·h, y − ground)` (h = the part's height from
 *    `_contactH`) — the one baked term the shader applies to the albedo (families.ts CONTACT_WEIGHT).
 * The temporary `_contactH` / `_aoMin` attributes are deleted from every LOD. Pure and deterministic.
 */
export interface AOOptions {
  /** target voxel edge, km (default 0.025) */
  voxelKm?: number;
  /** cell budget of the grid (default 2.5 M): larger landmarks get coarser voxels */
  maxCells?: number;
  /** hemisphere rays per vertex (default 6) */
  rays?: number;
  /** march steps per ray, one voxel each (default 16) */
  steps?: number;
  /** occlusion strength 0..1 (default 0.85) */
  strength?: number;
  /** weight of a ray that meets the terrain (default 0.5) */
  groundWeight?: number;
  /** part height for the contact term when a geometry has no `_contactH` (km, default 0.1) */
  contactH?: number;
  /** seed for the per-vertex ray rotation */
  seed?: number;
}

export interface AOStats {
  cells: number;
  voxelKm: number;
  vertices: number;
  /** distinct (cell, normal) occlusion evaluations */
  probes: number;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function bakeVertexAO(lods: LodGeometry[], groundLocal: (x: number, z: number) => number, opts: AOOptions = {}): AOStats {
  const lod0 = lods[0];
  const stats: AOStats = { cells: 0, voxelKm: 0, vertices: 0, probes: 0 };
  if (!lod0 || lod0.size === 0) return stats;
  // ---- grid over the LOD0 bounds (+ two cells margin)
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const geo of lod0.values()) {
    const p = geo.attributes.position.array as Float32Array;
    for (let k = 0; k < p.length; k += 3)
      for (let a = 0; a < 3; a++) {
        if (p[k + a] < min[a]) min[a] = p[k + a];
        if (p[k + a] > max[a]) max[a] = p[k + a];
      }
  }
  const ext = [Math.max(1e-3, max[0] - min[0]), Math.max(1e-3, max[1] - min[1]), Math.max(1e-3, max[2] - min[2])];
  const maxCells = opts.maxCells ?? 2.5e6;
  const vs = Math.max(opts.voxelKm ?? 0.025, Math.cbrt((ext[0] * ext[1] * ext[2]) / maxCells), Math.max(...ext) / 512);
  for (let a = 0; a < 3; a++) {
    min[a] -= 2 * vs;
    max[a] += 2 * vs;
  }
  const nx = Math.max(1, Math.ceil((max[0] - min[0]) / vs));
  const ny = Math.max(1, Math.ceil((max[1] - min[1]) / vs));
  const nz = Math.max(1, Math.ceil((max[2] - min[2]) / vs));
  const x0 = min[0];
  const y0 = min[1];
  const z0 = min[2];
  const inv = 1 / vs;
  const nxy = nx * ny;
  const occ = new Uint8Array(nx * ny * nz);
  stats.cells = occ.length;
  stats.voxelKm = vs;
  // terrain heights at the column centres (bilinear between them for the rays and the contact term)
  const groundCol = new Float32Array(nx * nz);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) groundCol[k * nx + i] = groundLocal(x0 + (i + 0.5) * vs, z0 + (k + 0.5) * vs);
  const groundAt = (x: number, z: number): number => {
    const fx = Math.min(nx - 1, Math.max(0, (x - x0) * inv - 0.5));
    const fz = Math.min(nz - 1, Math.max(0, (z - z0) * inv - 0.5));
    const i = Math.min(Math.max(0, nx - 2), Math.floor(fx));
    const k = Math.min(Math.max(0, nz - 2), Math.floor(fz));
    const i1 = Math.min(nx - 1, i + 1);
    const k1 = Math.min(nz - 1, k + 1);
    const u = fx - i;
    const v = fz - k;
    const a = groundCol[k * nx + i] + (groundCol[k * nx + i1] - groundCol[k * nx + i]) * u;
    const b = groundCol[k1 * nx + i] + (groundCol[k1 * nx + i1] - groundCol[k1 * nx + i]) * u;
    return a + (b - a) * v;
  };
  // surfaces: barycentric point sampling at ~0.7-voxel spacing (a closed shell of voxels)
  for (const geo of lod0.values()) {
    const p = geo.attributes.position.array as Float32Array;
    const idx = geo.index!.array as Uint32Array;
    for (let t = 0; t < idx.length; t += 3) {
      let a = idx[t] * 3;
      let b = idx[t + 1] * 3;
      let c = idx[t + 2] * 3;
      // start at a vertex of the shortest edge (u = that edge): skinny triangles need few samples
      const lab = Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
      const lbc = Math.hypot(p[c] - p[b], p[c + 1] - p[b + 1], p[c + 2] - p[b + 2]);
      const lca = Math.hypot(p[a] - p[c], p[a + 1] - p[c + 1], p[a + 2] - p[c + 2]);
      if (lbc < lab && lbc <= lca) [a, b, c] = [b, c, a];
      else if (lca < lab && lca < lbc) [a, b, c] = [c, a, b];
      const ax = p[a];
      const ay = p[a + 1];
      const az = p[a + 2];
      const ux = p[b] - ax;
      const uy = p[b + 1] - ay;
      const uz = p[b + 2] - az;
      const vx = p[c] - ax;
      const vy = p[c + 1] - ay;
      const vz = p[c + 2] - az;
      const nu = Math.max(1, Math.ceil(Math.hypot(ux, uy, uz) * inv * 1.4));
      const nv = Math.max(1, Math.ceil(Math.hypot(vx, vy, vz) * inv * 1.4));
      for (let u = 0; u <= nu; u++)
        for (let v = 0, vmax = Math.floor(nv * (1 - u / nu) + 1e-9); v <= vmax; v++) {
          const fu = u / nu;
          const fv = v / nv;
          const i = Math.floor((ax + ux * fu + vx * fv - x0) * inv);
          const j = Math.floor((ay + uy * fu + vy * fv - y0) * inv);
          const k = Math.floor((az + uz * fu + vz * fv - z0) * inv);
          if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) occ[k * nxy + j * nx + i] = 1;
        }
    }
  }
  // ---- rays
  const rays = Math.max(1, Math.round(opts.rays ?? 6));
  const steps = Math.max(1, Math.round(opts.steps ?? 16));
  const strength = opts.strength ?? 0.85;
  const gw = opts.groundWeight ?? 0.5;
  const seed = (opts.seed ?? 0x0a0) >>> 0;
  const dirST = new Float64Array(rays);
  const dirCT = new Float64Array(rays);
  const dirPh = new Float64Array(rays);
  for (let r = 0; r < rays; r++) {
    const u1 = halton(r + 1, 2);
    dirST[r] = Math.sqrt(u1);
    dirCT[r] = Math.sqrt(1 - u1);
    dirPh[r] = halton(r + 1, 3) * Math.PI * 2;
  }
  const cache = new Map<number, number>();
  /** occlusion from the centre of start cell (ci, cj, ck) along the quantised normal q; the start cell never counts */
  const occlusionAt = (ci: number, cj: number, ck: number, qx: number, qy: number, qz: number, key: number): number => {
    const ql = Math.hypot(qx, qy, qz) || 1;
    const Nx = qx / ql;
    const Ny = qy / ql;
    const Nz = qz / ql;
    const up = Math.abs(Ny) < 0.9;
    let tx = up ? Nz : 0;
    let ty = up ? 0 : -Nz;
    let tz = up ? -Nx : Ny;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const bx = Ny * tz - Nz * ty;
    const by = Nz * tx - Nx * tz;
    const bz = Nx * ty - Ny * tx;
    // per-key rotation of the ray set (integer hash, deterministic)
    let hsh = Math.imul(key ^ seed, 0x9e3779b1);
    hsh ^= hsh >>> 15;
    hsh = Math.imul(hsh, 0x85ebca6b);
    hsh ^= hsh >>> 13;
    const rot = ((hsh >>> 0) / 4294967296) * Math.PI * 2;
    const ox = x0 + (ci + 0.5) * vs;
    const oy = y0 + (cj + 0.5) * vs;
    const oz = z0 + (ck + 0.5) * vs;
    const start = ck * nxy + cj * nx + ci;
    let occl = 0;
    for (let r = 0; r < rays; r++) {
      const f = dirPh[r] + rot;
      const st = dirST[r];
      const ct = dirCT[r];
      const cx = Math.cos(f) * st;
      const cz = Math.sin(f) * st;
      const dx = (tx * cx + bx * cz + Nx * ct) * vs;
      const dy = (ty * cx + by * cz + Ny * ct) * vs;
      const dz = (tz * cx + bz * cz + Nz * ct) * vs;
      for (let s = 1; s <= steps; s++) {
        const x = ox + dx * s;
        const y = oy + dy * s;
        const z = oz + dz * s;
        const i = Math.floor((x - x0) * inv);
        const k = Math.floor((z - z0) * inv);
        if (i < 0 || k < 0 || i >= nx || k >= nz) break; // left the grid sideways: escaped
        if (y < groundAt(x, z)) {
          occl += gw * (1 - (0.5 * s) / steps);
          break;
        }
        const j = Math.floor((y - y0) * inv);
        if (j >= ny) break; // above everything: escaped
        if (j < 0) break;
        const c = k * nxy + j * nx + i;
        if (c !== start && occ[c]) {
          occl += 1 - (0.5 * s) / steps;
          break;
        }
      }
    }
    return occl / rays;
  };
  const bake = (geo: BufferGeometry) => {
    const p = geo.attributes.position.array as Float32Array;
    const nrm = geo.attributes.normal.array as Float32Array;
    const col = geo.attributes.color as BufferAttribute;
    const surf = geo.attributes.surf as BufferAttribute;
    const ca = col.array as Uint8Array;
    const sa = surf.array as Uint8Array;
    const ch = geo.attributes._contactH?.array as Float32Array | undefined;
    const am = geo.attributes._aoMin?.array as Float32Array | undefined;
    const nv = p.length / 3;
    stats.vertices += nv;
    for (let v = 0; v < nv; v++) {
      const px = p[v * 3];
      const py = p[v * 3 + 1];
      const pz = p[v * 3 + 2];
      const Nx = nrm[v * 3];
      const Ny = nrm[v * 3 + 1];
      const Nz = nrm[v * 3 + 2];
      // quantised normal (one of 26 directions) and the start cell 1.5 voxels out along the normal
      const qx = Math.round(Nx * 1.2);
      const qy = Math.round(Ny * 1.2);
      const qz = Math.round(Nz * 1.2);
      const ci = Math.min(nx - 1, Math.max(0, Math.floor((px + Nx * 1.5 * vs - x0) * inv)));
      const cj = Math.min(ny - 1, Math.max(0, Math.floor((py + Ny * 1.5 * vs - y0) * inv)));
      const ck = Math.min(nz - 1, Math.max(0, Math.floor((pz + Nz * 1.5 * vs - z0) * inv)));
      const key = (ck * nxy + cj * nx + ci) * 27 + (qx + 1) * 9 + (qy + 1) * 3 + (qz + 1);
      let occl = cache.get(key);
      if (occl === undefined) {
        occl = qx === 0 && qy === 0 && qz === 0 ? 0 : occlusionAt(ci, cj, ck, qx, qy, qz, key);
        cache.set(key, occl);
        stats.probes++;
      }
      const ao = Math.max(am ? am[v] : AO_MIN, 1 - strength * occl);
      ca[v * 4 + 3] = Math.round(Math.min(1, Math.max(0, ao)) * 255);
      const h = ch ? ch[v] : (opts.contactH ?? 0.1);
      const contact = smooth(0, Math.max(1e-4, 0.08 * h), py - groundAt(px, pz));
      sa[v * 4 + 3] = (sa[v * 4 + 3] & ~CONTACT_LEVELS) | Math.round(contact * CONTACT_LEVELS);
    }
    col.needsUpdate = true;
    surf.needsUpdate = true;
  };
  // a LOD may reuse the previous level's geometry objects (ProxyKit.buildLods): bake each once
  const done = new Set<BufferGeometry>();
  for (const lod of lods)
    for (const [key, geo] of lod) {
      if (done.has(geo)) continue;
      done.add(geo);
      if (key === 'structure') bake(geo);
      geo.deleteAttribute('_contactH');
      geo.deleteAttribute('_aoMin');
    }
  return stats;
}

/** Drop the AO bake's temporary attributes without baking (build with `ao: false`). */
export function stripBakeAttributes(lods: LodGeometry[]): void {
  for (const lod of lods)
    for (const geo of lod.values()) {
      geo.deleteAttribute('_contactH');
      geo.deleteAttribute('_aoMin');
    }
}
