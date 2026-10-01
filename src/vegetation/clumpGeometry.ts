import { BufferAttribute, InstancedBufferGeometry } from 'three/webgpu';
import { rand } from '../core/rng.ts';

/**
 * Canonical vegetation geometry: a CLUSTER of sub-crowns (one centre crown and a ring of six),
 * each a slightly lumpy ellipsoid like the foam / lichen clumps of a bigature tree, plus an
 * optional trunk.
 *
 * The same geometry serves every kind; the vertex shader decides per instance what it becomes:
 * - `spread` 1 — a patch of forest canopy: seven separate crowns of varied size and height, some
 *   dropped (gaps), neighbouring patches interleave into a continuous, textured canopy;
 * - `spread` ≈ 0.3–0.5 — one tree: the sub-crowns overlap into a single lumpy crown (oak, beech,
 *   elm silhouettes from the per-instance proportions);
 * - aspect ≪ 1 — a hedge: the ring collapses into a lumpy, broken row.
 *
 * Unit (cluster) space at spread 1: sub-crown centres within radius ≈ RING, nominal sub-crown
 * radius ≈ RNOM, cluster radius ≈ 1. The shader scales sub-crowns by (1 − RING·spread)/RNOM so a
 * clustered tree still spans radius 1, then maps unit space to (hr, vr, hr·aspect) km.
 *
 * Attributes: position = sub-crown-local shape point (radius ≈ 1, centre at the origin),
 * normal, `sub` = (cx, cz, radius, index) of the sub-crown in unit space, `clumpMeta` = (part: 0 crown,
 * 1 trunk; cavity: 0 open … 1 deep crease within the sub-crown's own lumps; relief: how much clump
 * displacement this tessellation can carry, 1 on the finest LOD, 0 on coarse ones) — packed, as
 * WebGPU allows only eight vertex buffers including the three instance attributes.
 *
 * Trunk parts (part 1) come in three types, `sub.w`: TRUNK_PLAIN (a prism baked with its 0.7 top taper,
 * y 0..1), TRUNK_RING (hero geometry: rings of unit circles at ring parameter y; the shader gives them the
 * hero trunk profile — root flare, taper, deep foot) and TRUNK_LIMB (hero geometry: primary limbs, unit
 * circle (x, z) at parameter y along the limb, `sub.x` = limb azimuth; the shader lays each limb from the
 * upper trunk out into the crown).
 */

/** sub-crowns per cluster (index 0 = centre crown) */
export const SUBS = 7;
/** ring radius and nominal sub-crown radius in unit space (shared with the vertex shader) */
export const RING = 0.6;
export const RNOM = 0.4;
/** sub-crown radius of the single-blob far LOD (unit space; > 0.9 flags it to the shader) */
export const WHOLE = 0.95;
/** Height of the canonical crown (bottom 0 → top, in units of the vertical crown radius), for bounds. */
export const CROWN_TOP = 1.3;

/** trunk part types (`sub.w` of part-1 vertices) */
export const TRUNK_PLAIN = 0;
export const TRUNK_RING = 1;
export const TRUNK_LIMB = 2;
/**
 * ring codes of the hero trunk (foliageMaterial.ts): −2 the deep foot below the ground, −1…0 flare rings
 * at that fraction of the flare height above the ground (dense where the root flare curves), 0…1 a
 * fraction of the trunk top
 */
const HERO_RINGS = [-2, -0.0001, -0.2, -0.45, -0.72, -1, 0.1, 0.3, 0.55, 0.8, 1];
/** primary limbs of the hero geometry: azimuths (radians, before the instance yaw) and rings along each */
const HERO_LIMBS = [0.35, 1.95, 3.3, 4.75];
const LIMB_RINGS = [0, 0.35, 0.7, 1];

export interface SubCrown {
  cx: number;
  cz: number;
  r: number;
}

/** Deterministic sub-crown layout of the cluster (unit space, spread 1). */
export function clusterLayout(seed = 7): SubCrown[] {
  const subs: SubCrown[] = [{ cx: 0, cz: 0, r: 0.42 }];
  for (let k = 0; k < SUBS - 1; k++) {
    const a = (k / (SUBS - 1)) * Math.PI * 2 + (rand(seed, 'sub-a', k) - 0.5) * 0.45;
    const d = RING * (0.9 + 0.2 * rand(seed, 'sub-d', k));
    subs.push({ cx: Math.cos(a) * d, cz: Math.sin(a) * d, r: RNOM * (0.86 + 0.24 * rand(seed, 'sub-r', k)) });
  }
  return subs;
}

interface Lobe {
  c: [number, number, number];
  r: number;
}

/** Lumps of one sub-crown (seeded): a main body and a few smaller bulges. */
function lobeLayout(seed: number): Lobe[] {
  const lobes: Lobe[] = [{ c: [0, 0, 0], r: 0.7 }];
  const n = 6;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + (rand(seed, 'lobe-a', k) - 0.5) * 0.8;
    const y = -0.12 + rand(seed, 'lobe-y', k) * 0.5;
    const d = 0.34 + rand(seed, 'lobe-d', k) * 0.14;
    lobes.push({ c: [Math.cos(a) * d, y, Math.sin(a) * d], r: 0.4 + rand(seed, 'lobe-r', k) * 0.16 });
  }
  // a top knob
  lobes.push({ c: [(rand(seed, 'lobe-t', 0) - 0.5) * 0.2, 0.36, (rand(seed, 'lobe-t', 1) - 0.5) * 0.2], r: 0.42 });
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

interface Mesh {
  pos: number[];
  idx: number[];
}

/** Unit sphere mesh: detail −1 = octahedron (8 tris), 0 = icosahedron (20), n = 20·4ⁿ. */
function sphereMesh(detail: number): Mesh {
  if (detail < 0) {
    return {
      pos: [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1],
      // CCW seen from outside
      idx: [0, 2, 4, 4, 2, 1, 1, 2, 5, 5, 2, 0, 4, 3, 0, 1, 3, 4, 5, 3, 1, 0, 3, 5],
    };
  }
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

/** One sub-crown shape: lumpy (from `seed`), flattened underside, radius ≈ 1 around the origin. */
function subCrownShape(detail: number, seed: number): { pos: Float32Array; nrm: Float32Array; cav: Float32Array; idx: number[] } {
  const ico = sphereMesh(detail);
  const nv = ico.pos.length / 3;
  const pos = new Float32Array(nv * 3);
  const lumpy = detail >= 1;
  const lobes = lobeLayout(seed);
  let maxR = 0;
  for (let i = 0; i < nv; i++) {
    const dx = ico.pos[i * 3];
    const dy = ico.pos[i * 3 + 1];
    const dz = ico.pos[i * 3 + 2];
    // coarse tessellations keep only a hint of the lumps (sampled at 42 directions they facet)
    const r = lumpy ? 1 + (unionRadius(lobes, dx, dy, dz, 18) - 1) * (detail >= 2 ? 1 : 0.45) : 1;
    pos[i * 3] = dx * r;
    pos[i * 3 + 1] = dy * r;
    pos[i * 3 + 2] = dz * r;
    maxR = Math.max(maxR, Math.hypot(dx * r, dz * r));
  }
  for (let i = 0; i < nv; i++) {
    pos[i * 3] /= maxR;
    pos[i * 3 + 2] /= maxR;
    let y = pos[i * 3 + 1] / maxR;
    // real crowns are flatter below
    const flat = -0.5;
    if (y < flat) y = flat + (y - flat) * 0.4;
    pos[i * 3 + 1] = y;
  }
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
  for (let i = 0; i < nv; i++) {
    const l = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
    nrm[i * 3] /= l;
    nrm[i * 3 + 1] /= l;
    nrm[i * 3 + 2] /= l;
  }
  // cavity: how much a vertex sits below the average of its neighbours along its normal (creases)
  const cav = new Float32Array(nv);
  if (lumpy) {
    const nsum = new Float32Array(nv * 3);
    const ncnt = new Float32Array(nv);
    for (let f = 0; f < idx.length; f += 3) {
      for (let e = 0; e < 3; e++) {
        const a = idx[f + e];
        const b = idx[f + ((e + 1) % 3)];
        for (let q = 0; q < 3; q++) {
          nsum[a * 3 + q] += pos[b * 3 + q];
          nsum[b * 3 + q] += pos[a * 3 + q];
        }
        ncnt[a]++;
        ncnt[b]++;
      }
    }
    const edge = 1.1 / 2 ** detail;
    for (let i = 0; i < nv; i++) {
      const mx = nsum[i * 3] / ncnt[i] - pos[i * 3];
      const my = nsum[i * 3 + 1] / ncnt[i] - pos[i * 3 + 1];
      const mz = nsum[i * 3 + 2] / ncnt[i] - pos[i * 3 + 2];
      const d = (mx * nrm[i * 3] + my * nrm[i * 3 + 1] + mz * nrm[i * 3 + 2]) / (edge * edge);
      cav[i] = Math.min(1, Math.max(0, d * 1.4));
    }
  }
  return { pos, nrm, cav, idx };
}

export interface ClumpGeometryOptions {
  /** sub-crown tessellation: −1 octahedron (8 tris), 0 icosahedron (20), 1 = 80, 2 = 320 */
  detail: number;
  /** trunk prism sides (0 = none; 3 = a cheap far-LOD hint) */
  trunkSides: number;
  /** clump-relief weight of this tessellation (0..1) */
  relief?: number;
  /**
   * one blob standing in for the whole cluster (radius WHOLE, flagged by sub.z > 0.9): the
   * distant LOD where a cluster covers only a few pixels
   */
  whole?: boolean;
  seed?: number;
  /**
   * hero geometry (authored landmark trees near the camera): a ringed trunk (`trunkSides` sides, HERO_RINGS)
   * with the hero profile, and four primary limbs
   */
  hero?: boolean;
  /**
   * primary limbs on a plain trunk (the near LOD of the placed trees, S4): the hero geometry's four limbs,
   * cheaper (four-sided), so a lifted broadleaf crown shows its branches, not a ball on a stick
   */
  limbs?: boolean;
}

/**
 * Build one LOD of the cluster. All LODs share the same sub-crown layout so switching LOD changes
 * tessellation only, not the silhouette.
 */
export function createClumpGeometry(opts: ClumpGeometryOptions): InstancedBufferGeometry {
  const layout = opts.whole ? [{ cx: 0, cz: 0, r: WHOLE }] : clusterLayout(opts.seed ?? 7);
  const P: number[] = [];
  const N: number[] = [];
  const S: number[] = [];
  const part: number[] = [];
  const cavity: number[] = [];
  const idx: number[] = [];
  layout.forEach((sc, s) => {
    const shape = subCrownShape(opts.detail, 1000 + s * 17);
    const base = P.length / 3;
    const nv = shape.pos.length / 3;
    for (let i = 0; i < nv; i++) {
      P.push(shape.pos[i * 3], shape.pos[i * 3 + 1], shape.pos[i * 3 + 2]);
      N.push(shape.nrm[i * 3], shape.nrm[i * 3 + 1], shape.nrm[i * 3 + 2]);
      S.push(sc.cx, sc.cz, sc.r, s);
      part.push(0);
      cavity.push(shape.cav[i]);
    }
    for (const i of shape.idx) idx.push(base + i);
  });

  // trunk: prism, unit radius, y 0..1 (the shader maps it from below ground up into the crown)
  const sides = opts.trunkSides;
  /** a tube of `sides` sides through rings at parameters `rings` (unit circles, y = ring parameter) */
  const tube = (rings: number[], type: number, azimuth: number, taper: (v: number) => number) => {
    const base = P.length / 3;
    for (const v of rings)
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const x = Math.cos(a);
        const z = Math.sin(a);
        const t = taper(v);
        P.push(x * t, v, z * t);
        N.push(x, type === TRUNK_PLAIN ? 0.1 : 0, z);
        S.push(azimuth, 0, 0.42, type);
        part.push(1);
        cavity.push(0);
      }
    for (let r = 0; r + 1 < rings.length; r++)
      for (let s = 0; s < sides; s++) {
        const a0 = base + r * sides + s;
        const a1 = base + r * sides + ((s + 1) % sides);
        // outward-facing winding (CCW seen from outside)
        idx.push(a0, a0 + sides, a1, a1, a0 + sides, a1 + sides);
      }
  };
  /** the four primary limbs (TRUNK_LIMB tubes; the shader lays them from the upper trunk into the crown) */
  const limbs = (limbSides: number) => {
    for (const az of HERO_LIMBS) {
      const base = P.length / 3;
      for (const v of LIMB_RINGS)
        for (let s = 0; s < limbSides; s++) {
          const a = (s / limbSides) * Math.PI * 2;
          P.push(Math.cos(a), v, Math.sin(a));
          N.push(Math.cos(a), 0, Math.sin(a));
          S.push(az, 0, 0.42, TRUNK_LIMB);
          part.push(1);
          cavity.push(0);
        }
      for (let r = 0; r + 1 < LIMB_RINGS.length; r++)
        for (let s = 0; s < limbSides; s++) {
          const a0 = base + r * limbSides + s;
          const a1 = base + r * limbSides + ((s + 1) % limbSides);
          idx.push(a0, a0 + limbSides, a1, a1, a0 + limbSides, a1 + limbSides);
        }
    }
  };
  if (sides > 0) {
    if (opts.hero) {
      tube(HERO_RINGS, TRUNK_RING, 0, () => 1);
      limbs(Math.max(5, Math.round(sides / 2)));
    } else {
      tube([0, 1], TRUNK_PLAIN, 0, (v) => 1 - 0.3 * v);
      if (opts.limbs) limbs(4);
    }
  }

  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(N), 3));
  g.setAttribute('sub', new BufferAttribute(new Float32Array(S), 4));
  const meta = new Float32Array(part.length * 3);
  for (let i = 0; i < part.length; i++) {
    meta[i * 3] = part[i];
    meta[i * 3 + 1] = cavity[i];
    meta[i * 3 + 2] = opts.relief ?? 0;
  }
  g.setAttribute('clumpMeta', new BufferAttribute(meta, 3));
  g.setIndex(idx);
  return g;
}
