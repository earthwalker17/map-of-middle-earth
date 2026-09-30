import type { BufferAttribute, BufferGeometry } from 'three/webgpu';
import { halton } from '../../core/rng.ts';
import type { LodGeometry } from '../records.ts';

/**
 * Vertex ambient occlusion for landmark geometry (kit v2; reusable for GLB landmarks, W2).
 *
 * One voxel occupancy grid per landmark (surface-voxelised LOD0 + the ground below the local terrain,
 * ~40 cells on the longest axis), then a few cosine-weighted Halton hemisphere rays (hashed rotation,
 * one-voxel march) per (cell in front of the surface × quantised normal) — memoised, so the cost follows
 * the occupied volume, not the vertex count — and per vertex a ground-contact darkening term
 * `mix(contact, 1, smoothstep(0, 0.08·h, y − ground))` (h = the part's height from `_contactH`, else
 * `opts.contactH`). The result is written to `color.a` (Uint8, 255 = open) of every LOD; `_contactH` is
 * deleted afterwards. Pure and deterministic (no Math.random): same input → identical bytes.
 */
export interface AOOptions {
  /** voxel cells along the longest bbox axis (default 40, clamped 8..64) */
  res?: number;
  /** hemisphere rays per vertex (default 6) */
  rays?: number;
  /** march steps per ray, one voxel each (default 16) */
  steps?: number;
  /** occlusion strength 0..1 (default 0.85) */
  strength?: number;
  /** darkening where a part meets the ground (default 0.6) */
  contact?: number;
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
  // ---- grid over the LOD0 bounds (+ one cell margin)
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
  const res = Math.min(64, Math.max(8, Math.round(opts.res ?? 40)));
  const ext = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-3);
  const vs = ext / res;
  for (let a = 0; a < 3; a++) {
    min[a] -= vs;
    max[a] += vs;
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
  // ground: every cell whose centre lies below the local terrain (column heights kept for the rays and
  // the contact term: bilinear between column centres)
  const groundCol = new Float32Array(nx * nz);
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      const gy = groundLocal(x0 + (i + 0.5) * vs, z0 + (k + 0.5) * vs);
      groundCol[k * nx + i] = gy;
      const top = Math.min(ny, Math.floor((gy - y0) * inv + 0.5));
      for (let j = 0; j < top; j++) occ[k * nxy + j * nx + i] = 1;
    }
  const groundAt = (x: number, z: number): number => {
    const fx = Math.min(nx - 1, Math.max(0, (x - x0) * inv - 0.5));
    const fz = Math.min(nz - 1, Math.max(0, (z - z0) * inv - 0.5));
    const i = Math.min(nx - 2, Math.floor(fx));
    const k = Math.min(nz - 2, Math.floor(fz));
    if (i < 0 || k < 0) return groundCol[Math.max(0, k) * nx + Math.max(0, i)];
    const u = fx - i;
    const v = fz - k;
    const a = groundCol[k * nx + i] + (groundCol[k * nx + i + 1] - groundCol[k * nx + i]) * u;
    const b = groundCol[(k + 1) * nx + i] + (groundCol[(k + 1) * nx + i + 1] - groundCol[(k + 1) * nx + i]) * u;
    return a + (b - a) * v;
  };
  // surfaces: barycentric point sampling at half-voxel spacing
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
      // ~0.7-voxel spacing along each edge (long thin triangles stay cheap): a closed shell
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
  const contact = opts.contact ?? 0.6;
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
  // occlusion is evaluated per (voxel cell in front of the surface, quantised normal) and memoised —
  // dense geometry shares cells, so the cost follows the occupied volume rather than the vertex count
  const cache = new Map<number, number>();
  const occlusionAt = (ci: number, cj: number, ck: number, qx: number, qy: number, qz: number, key: number): number => {
    const ql = Math.hypot(qx, qy, qz);
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
    const ox = x0 + (ci + 0.5) * vs + Nx * vs * 0.5;
    const oy = y0 + (cj + 0.5) * vs + Ny * vs * 0.5;
    const oz = z0 + (ck + 0.5) * vs + Nz * vs * 0.5;
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
        const i = Math.floor((ox + dx * s - x0) * inv);
        const k = Math.floor((oz + dz * s - z0) * inv);
        if (i < 0 || k < 0 || i >= nx || k >= nz) break; // left the grid sideways: escaped
        const y = oy + dy * s;
        if (y < groundCol[k * nx + i]) {
          occl += 1 - (0.5 * s) / steps;
          break;
        }
        const j = Math.floor((y - y0) * inv);
        if (j >= ny) break; // above everything: escaped
        if (j < 0 || occ[k * nxy + j * nx + i]) {
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
    const ca = col.array as Uint8Array;
    const ch = geo.attributes._contactH?.array as Float32Array | undefined;
    const nv = p.length / 3;
    stats.vertices += nv;
    for (let v = 0; v < nv; v++) {
      const px = p[v * 3];
      const py = p[v * 3 + 1];
      const pz = p[v * 3 + 2];
      const Nx = nrm[v * 3];
      const Ny = nrm[v * 3 + 1];
      const Nz = nrm[v * 3 + 2];
      // quantised normal (one of 26 directions) and the cell one voxel in front of the surface
      const qx = Math.round(Nx * 1.2);
      const qy = Math.round(Ny * 1.2);
      const qz = Math.round(Nz * 1.2);
      const ci = Math.min(nx - 1, Math.max(0, Math.floor((px + Nx * vs - x0) * inv)));
      const cj = Math.min(ny - 1, Math.max(0, Math.floor((py + Ny * vs - y0) * inv)));
      const ck = Math.min(nz - 1, Math.max(0, Math.floor((pz + Nz * vs - z0) * inv)));
      const key = (ck * nxy + cj * nx + ci) * 27 + (qx + 1) * 9 + (qy + 1) * 3 + (qz + 1);
      let occl = cache.get(key);
      if (occl === undefined) {
        occl = occlusionAt(ci, cj, ck, qx, qy, qz, key);
        cache.set(key, occl);
        stats.probes++;
      }
      let ao = 1 - strength * occl;
      const h = ch ? ch[v] : (opts.contactH ?? 0.1);
      const above = py - groundAt(px, pz);
      ao *= contact + (1 - contact) * smooth(0, Math.max(1e-4, 0.08 * h), above);
      ca[v * 4 + 3] = Math.round(Math.min(1, Math.max(0, ao)) * 255);
    }
    col.needsUpdate = true;
    geo.deleteAttribute('_contactH');
  };
  for (const lod of lods) for (const geo of lod.values()) bake(geo);
  return stats;
}
