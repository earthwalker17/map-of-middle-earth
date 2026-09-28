import { BufferAttribute, InstancedBufferGeometry } from 'three/webgpu';
import { rand } from '../core/rng.ts';

/**
 * Canonical "clump-foliage" tree geometry: a multi-lobe crown (union of overlapping spheres,
 * like the foam clumps of a model-railway / museum-diorama tree) plus an optional short trunk.
 *
 * Local frame: crown bottom at y = 0, horizontal radius 1, top at ≈ CROWN_TOP. The vertex shader
 * scales it per instance (horizontal radius, vertical radius, trunk length, yaw, aspect) and adds a
 * per-instance noise displacement so no two clumps look alike.
 *
 * Attributes: position, normal, `part` (0 crown, 1 trunk), `cavity` (0 open … 1 deep crease).
 */

export interface Lobe {
  c: [number, number, number];
  r: number;
}

/** Deterministic lobe layout (seeded), roughly 1 unit radius. */
function lobeLayout(seed: number): Lobe[] {
  const lobes: Lobe[] = [
    { c: [0, 0, 0], r: 0.78 },
    { c: [0.03, 0.4, -0.04], r: 0.56 },
  ];
  const ring = 6;
  for (let k = 0; k < ring; k++) {
    const a = (k / ring) * Math.PI * 2 + (rand(seed, 'ring-a', k) - 0.5) * 0.7;
    const rad = 0.44 + rand(seed, 'ring-r', k) * 0.1;
    const y = -0.08 + rand(seed, 'ring-y', k) * 0.28;
    lobes.push({ c: [Math.cos(a) * rad, y, Math.sin(a) * rad], r: 0.44 + rand(seed, 'ring-s', k) * 0.12 });
  }
  const top = 4;
  for (let k = 0; k < top; k++) {
    const a = (k / top) * Math.PI * 2 + 0.6 + (rand(seed, 'top-a', k) - 0.5) * 0.8;
    const rad = 0.26 + rand(seed, 'top-r', k) * 0.1;
    lobes.push({ c: [Math.cos(a) * rad, 0.3 + rand(seed, 'top-y', k) * 0.12, Math.sin(a) * rad], r: 0.4 + rand(seed, 'top-s', k) * 0.08 });
  }
  return lobes;
}

/** Radial distance of the (soft) union of lobes along unit direction d. */
function unionRadius(lobes: Lobe[], dx: number, dy: number, dz: number, k: number): number {
  // log-sum-exp smooth max of the far ray/sphere intersections
  let acc = 0;
  let hard = 0;
  const ts: number[] = [];
  for (const l of lobes) {
    const b = dx * l.c[0] + dy * l.c[1] + dz * l.c[2];
    const cc = l.c[0] * l.c[0] + l.c[1] * l.c[1] + l.c[2] * l.c[2];
    const disc = b * b - (cc - l.r * l.r);
    if (disc < 0) continue;
    const t = b + Math.sqrt(disc);
    if (t <= 0) continue;
    ts.push(t);
    hard = Math.max(hard, t);
  }
  for (const t of ts) acc += Math.exp(k * (t - hard));
  return hard + Math.log(acc) / k;
}

interface IcoSphere {
  pos: number[];
  idx: number[];
}

function icosphere(detail: number): IcoSphere {
  const t = (1 + Math.sqrt(5)) / 2;
  const pos: number[] = [];
  const add = (x: number, y: number, z: number) => {
    const l = Math.hypot(x, y, z);
    pos.push(x / l, y / l, z / l);
    return pos.length / 3 - 1;
  };
  [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].forEach(([x, y, z]) => add(x, y, z));
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let d = 0; d < detail; d++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const i = add(pos[a * 3] + pos[b * 3], pos[a * 3 + 1] + pos[b * 3 + 1], pos[a * 3 + 2] + pos[b * 3 + 2]);
      cache.set(key, i);
      return i;
    };
    const next: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return { pos, idx: faces.flat() };
}

/** Height of the canonical crown (bottom 0 → top), for bounds. */
export const CROWN_TOP = 1.3;

export interface ClumpGeometryOptions {
  /** icosphere subdivision level for the crown (1 = 80 tris, 2 = 320, 3 = 1280) */
  detail: number;
  /** add the trunk prism */
  trunk: boolean;
  seed?: number;
}

/**
 * Build one LOD of the clump tree. All LODs share the same lobe layout so switching LOD changes
 * tessellation only, not the silhouette.
 */
export function createClumpGeometry(opts: ClumpGeometryOptions): InstancedBufferGeometry {
  const lobes = lobeLayout(opts.seed ?? 7);
  const ico = icosphere(opts.detail);
  const nv = ico.pos.length / 3;
  const pos = new Float32Array(nv * 3);
  // sample the union surface along each icosphere direction
  let maxH = 0;
  let minY = Infinity;
  for (let i = 0; i < nv; i++) {
    const dx = ico.pos[i * 3];
    const dy = ico.pos[i * 3 + 1];
    const dz = ico.pos[i * 3 + 2];
    const r = unionRadius(lobes, dx, dy, dz, 16);
    pos[i * 3] = dx * r;
    pos[i * 3 + 1] = dy * r;
    pos[i * 3 + 2] = dz * r;
    maxH = Math.max(maxH, Math.hypot(dx * r, dz * r));
  }
  // normalise: horizontal radius 1; flatten the underside (real crowns are flatter below)
  for (let i = 0; i < nv; i++) {
    pos[i * 3] /= maxH;
    pos[i * 3 + 2] /= maxH;
    let y = pos[i * 3 + 1] / maxH;
    const flat = -0.42;
    if (y < flat) y = flat + (y - flat) * 0.35;
    pos[i * 3 + 1] = y;
    minY = Math.min(minY, y);
  }
  for (let i = 0; i < nv; i++) pos[i * 3 + 1] -= minY;

  // smooth normals
  const nrm = new Float32Array(nv * 3);
  const idx = ico.idx;
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f] * 3;
    const b = idx[f + 1] * 3;
    const c = idx[f + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) {
      nrm[o] += nx;
      nrm[o + 1] += ny;
      nrm[o + 2] += nz;
    }
  }
  // orientation check: icosahedron faces above are CCW seen from outside
  for (let i = 0; i < nv; i++) {
    const l = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
    nrm[i * 3] /= l;
    nrm[i * 3 + 1] /= l;
    nrm[i * 3 + 2] /= l;
  }

  // cavity: how much a vertex sits below the average of its neighbours along its normal (creases)
  const nsum = new Float32Array(nv * 3);
  const ncnt = new Float32Array(nv);
  for (let f = 0; f < idx.length; f += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[f + e];
      const b = idx[f + ((e + 1) % 3)];
      nsum[a * 3] += pos[b * 3];
      nsum[a * 3 + 1] += pos[b * 3 + 1];
      nsum[a * 3 + 2] += pos[b * 3 + 2];
      ncnt[a]++;
      nsum[b * 3] += pos[a * 3];
      nsum[b * 3 + 1] += pos[a * 3 + 1];
      nsum[b * 3 + 2] += pos[a * 3 + 2];
      ncnt[b]++;
    }
  }
  const cav = new Float32Array(nv);
  // edge length scale so cavity is tessellation independent
  const edge = 1.1 / 2 ** opts.detail;
  for (let i = 0; i < nv; i++) {
    const mx = nsum[i * 3] / ncnt[i] - pos[i * 3];
    const my = nsum[i * 3 + 1] / ncnt[i] - pos[i * 3 + 1];
    const mz = nsum[i * 3 + 2] / ncnt[i] - pos[i * 3 + 2];
    const d = (mx * nrm[i * 3] + my * nrm[i * 3 + 1] + mz * nrm[i * 3 + 2]) / (edge * edge);
    cav[i] = Math.min(1, Math.max(0, d * 1.6));
  }

  // trunk: hexagonal prism, unit radius, y 0..1 (the shader maps it from below ground up into the crown)
  const tPos: number[] = [];
  const tNrm: number[] = [];
  const tIdx: number[] = [];
  if (opts.trunk) {
    const sides = 6;
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const x = Math.cos(a);
      const z = Math.sin(a);
      tPos.push(x, 0, z, x * 0.7, 1, z * 0.7);
      tNrm.push(x, 0.1, z, x, 0.1, z);
    }
    for (let s = 0; s < sides; s++) {
      const a0 = nv + s * 2;
      const a1 = nv + ((s + 1) % sides) * 2;
      // outward-facing winding (CCW seen from outside)
      tIdx.push(a0, a0 + 1, a1, a1, a0 + 1, a1 + 1);
    }
  }
  const tv = tPos.length / 3;
  const P = new Float32Array((nv + tv) * 3);
  const N = new Float32Array((nv + tv) * 3);
  const part = new Float32Array(nv + tv);
  const cavity = new Float32Array(nv + tv);
  P.set(pos);
  N.set(nrm);
  cavity.set(cav);
  P.set(tPos, nv * 3);
  N.set(tNrm, nv * 3);
  for (let i = 0; i < tv; i++) part[nv + i] = 1;

  const all = idx.concat(tIdx);
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(P, 3));
  g.setAttribute('normal', new BufferAttribute(N, 3));
  g.setAttribute('part', new BufferAttribute(part, 1));
  g.setAttribute('cavity', new BufferAttribute(cavity, 1));
  g.setIndex(all);
  return g;
}
