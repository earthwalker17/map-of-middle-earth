import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, ShapeUtils, Vector2 } from 'three/webgpu';

/**
 * Geometry core of the landmark kit (ProxyKit v2): an indexed, growable triangle mesh in local km and
 * the primitive generators the kit composes. Everything here is pure and deterministic; winding is
 * counter-clockwise seen from outside (three.js front faces), which `tools/check/landmarks.ts`-style
 * tests verify through `outwardShare`.
 */
export type V2 = [number, number];
export type V3 = [number, number, number];

/** Growable indexed triangle mesh (local km): positions, normals, optional per-vertex shade, indices. */
export class Geo {
  readonly p: number[] = [];
  readonly n: number[] = [];
  /** per-vertex paint multiplier (null = 1 everywhere): strata bands, soot, sun-bleached tops */
  s: number[] | null = null;
  readonly i: number[] = [];

  get vertexCount(): number {
    return this.p.length / 3;
  }

  get triCount(): number {
    return this.i.length / 3;
  }

  /** add a vertex, returns its index */
  v(x: number, y: number, z: number, nx = 0, ny = 1, nz = 0): number {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    if (this.s) this.s.push(1);
    return this.p.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.i.push(a, b, c);
  }

  /** quad a→b→c→d, counter-clockwise seen from the front */
  quad(a: number, b: number, c: number, d: number): void {
    this.i.push(a, b, c, a, c, d);
  }

  /** set a vertex's paint multiplier */
  shade(v: number, k: number): void {
    if (!this.s) this.s = new Array<number>(this.vertexCount).fill(1);
    this.s[v] = k;
  }

  append(g: Geo): this {
    const o = this.vertexCount;
    if (g.s && !this.s) this.s = new Array<number>(o).fill(1);
    for (let k = 0; k < g.p.length; k++) this.p.push(g.p[k]);
    for (let k = 0; k < g.n.length; k++) this.n.push(g.n[k]);
    if (this.s) {
      if (g.s) for (const v of g.s) this.s.push(v);
      else for (let k = 0; k < g.vertexCount; k++) this.s.push(1);
    }
    for (const x of g.i) this.i.push(x + o);
    return this;
  }

  clone(): Geo {
    return new Geo().append(this);
  }

  /** apply a matrix to positions (normals by the normal matrix; mirrored matrices flip the winding) */
  transform(m: Matrix4): this {
    const e = m.elements;
    const nm = new Matrix3().getNormalMatrix(m).elements;
    const p = this.p;
    const n = this.n;
    for (let k = 0; k < p.length; k += 3) {
      const x = p[k];
      const y = p[k + 1];
      const z = p[k + 2];
      p[k] = e[0] * x + e[4] * y + e[8] * z + e[12];
      p[k + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      p[k + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const a = n[k];
      const b = n[k + 1];
      const c = n[k + 2];
      let nx = nm[0] * a + nm[3] * b + nm[6] * c;
      let ny = nm[1] * a + nm[4] * b + nm[7] * c;
      let nz = nm[2] * a + nm[5] * b + nm[8] * c;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      n[k] = nx;
      n[k + 1] = ny;
      n[k + 2] = nz;
    }
    if (m.determinant() < 0)
      for (let k = 0; k < this.i.length; k += 3) {
        const t = this.i[k + 1];
        this.i[k + 1] = this.i[k + 2];
        this.i[k + 2] = t;
      }
    return this;
  }

  translate(x: number, y: number, z: number): this {
    for (let k = 0; k < this.p.length; k += 3) {
      this.p[k] += x;
      this.p[k + 1] += y;
      this.p[k + 2] += z;
    }
    return this;
  }

  /** area-weighted smooth normals over shared vertices (for organic shapes built with shared indices) */
  smoothNormals(): this {
    const p = this.p;
    const acc = new Float64Array(p.length);
    for (let k = 0; k < this.i.length; k += 3) {
      const a = this.i[k] * 3;
      const b = this.i[k + 1] * 3;
      const c = this.i[k + 2] * 3;
      const ux = p[b] - p[a];
      const uy = p[b + 1] - p[a + 1];
      const uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a];
      const vy = p[c + 1] - p[a + 1];
      const vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      for (const q of [a, b, c]) {
        acc[q] += nx;
        acc[q + 1] += ny;
        acc[q + 2] += nz;
      }
    }
    for (let k = 0; k < p.length; k += 3) {
      const l = Math.hypot(acc[k], acc[k + 1], acc[k + 2]) || 1;
      this.n[k] = acc[k] / l;
      this.n[k + 1] = acc[k + 1] / l;
      this.n[k + 2] = acc[k + 2] / l;
    }
    return this;
  }

  bounds(): { min: V3; max: V3 } {
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < this.p.length; k += 3)
      for (let a = 0; a < 3; a++) {
        const v = this.p[k + a];
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    return { min, max };
  }
}

// ------------------------------------------------------------------ small vector helpers
export const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm3 = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Add a flat convex polygon with its own vertices. The points must be in order around the face (either
 * direction): the winding is flipped when needed so the face looks along the outward normal `n`.
 */
export function face(g: Geo, pts: V3[], n: V3): void {
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  const nx = n[0] / l;
  const ny = n[1] / l;
  const nz = n[2] / l;
  // Newell normal of the given order
  let ax = 0;
  let ay = 0;
  let az = 0;
  const m = pts.length;
  for (let k = 0; k < m; k++) {
    const a = pts[k];
    const b = pts[k + 1 === m ? 0 : k + 1];
    ax += (a[1] - b[1]) * (a[2] + b[2]);
    ay += (a[2] - b[2]) * (a[0] + b[0]);
    az += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const flip = ax * nx + ay * ny + az * nz < 0;
  const base = g.vertexCount;
  for (let k = 0; k < m; k++) {
    const q = pts[flip ? m - 1 - k : k];
    g.v(q[0], q[1], q[2], nx, ny, nz);
  }
  for (let k = 1; k + 1 < m; k++) g.tri(base, base + k, base + k + 1);
}

/** Triangle with its winding fixed so its geometric normal agrees with `n`. */
export function triFacing(g: Geo, a: number, b: number, c: number, n: V3): void {
  const p = g.p;
  const ux = p[b * 3] - p[a * 3];
  const uy = p[b * 3 + 1] - p[a * 3 + 1];
  const uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3];
  const vy = p[c * 3 + 1] - p[a * 3 + 1];
  const vz = p[c * 3 + 2] - p[a * 3 + 2];
  const d = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
  if (d >= 0) g.tri(a, b, c);
  else g.tri(a, c, b);
}

// ------------------------------------------------------------------ primitives (base at y = 0 unless noted)

/** Axis-aligned box, base centre at the origin (w along x, h up, d along z); `bottom` false skips the floor. */
export function boxGeo(w: number, h: number, d: number, bottom = true): Geo {
  const g = new Geo();
  const x = w / 2;
  const z = d / 2;
  face(g, [[x, 0, -z], [x, h, -z], [x, h, z], [x, 0, z]], [1, 0, 0]);
  face(g, [[-x, 0, -z], [-x, h, -z], [-x, h, z], [-x, 0, z]], [-1, 0, 0]);
  face(g, [[-x, h, -z], [x, h, -z], [x, h, z], [-x, h, z]], [0, 1, 0]);
  if (bottom) face(g, [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]], [0, -1, 0]);
  face(g, [[-x, 0, z], [x, 0, z], [x, h, z], [-x, h, z]], [0, 0, 1]);
  face(g, [[-x, 0, -z], [x, 0, -z], [x, h, -z], [-x, h, -z]], [0, 0, -1]);
  return g;
}

export interface LatheOpts {
  /** segments around (default 24) */
  seg?: number;
  /** partial revolution (open shell) in degrees, default 360 */
  arcDeg?: number;
  /** flat facets around (default: seg ≤ 8) */
  faceted?: boolean;
  /** profile joints turning more than this are hard edges (degrees, default 35) */
  crease?: number;
  /** close the first / last profile point with a flat cap when its radius > 0 (default true) */
  caps?: boolean;
}

/**
 * Surface of revolution around +y. `profile` = [radius, y] points (bottom → top for an outward
 * surface); angle 0 = +x, growing towards +z. Profile joints sharper than `crease` get hard edges;
 * a radius-0 point closes the surface to an apex.
 */
export function latheGeo(profile: V2[], o: LatheOpts = {}): Geo {
  const g = new Geo();
  const seg = Math.max(3, Math.round(o.seg ?? 24));
  const arc = ((o.arcDeg ?? 360) * Math.PI) / 180;
  const full = arc >= Math.PI * 2 - 1e-6;
  const faceted = o.faceted ?? seg <= 8;
  const crease = Math.cos(((o.crease ?? 35) * Math.PI) / 180);
  const cols = full ? seg : seg + 1;
  const ang = (j: number) => (j / seg) * arc;
  // per-segment 2D outward normals (radial, y)
  const sn: V2[] = [];
  for (let k = 0; k + 1 < profile.length; k++) {
    const dr = profile[k + 1][0] - profile[k][0];
    const dy = profile[k + 1][1] - profile[k][1];
    const l = Math.hypot(dr, dy) || 1;
    sn.push([dy / l, -dr / l]);
  }
  const jointNormal = (k: number, segK: number): V2 => {
    // normal of profile point k as seen from segment segK (smooth with the neighbour unless creased)
    const other = segK === k ? k - 1 : k; // the neighbouring segment sharing point k
    const a = sn[segK];
    const b = sn[other];
    if (!b || a[0] * b[0] + a[1] * b[1] < crease) return a;
    const l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
    return [(a[0] + b[0]) / l, (a[1] + b[1]) / l];
  };
  for (let k = 0; k + 1 < profile.length; k++) {
    const [r0, y0] = profile[k];
    const [r1, y1] = profile[k + 1];
    if (Math.hypot(r1 - r0, y1 - y0) < 1e-9) continue;
    const n0 = jointNormal(k, k);
    const n1 = jointNormal(k + 1, k);
    if (faceted) {
      for (let j = 0; j < seg; j++) {
        const a0 = ang(j);
        const a1 = ang(j + 1);
        const am = (a0 + a1) / 2;
        // exact flat facet normal from the facet's own corners, oriented like the analytic one
        const pA: V3 = [r0 * Math.cos(a0), y0, r0 * Math.sin(a0)];
        const pB: V3 = [r1 * Math.cos(a0), y1, r1 * Math.sin(a0)];
        const pC: V3 = [r1 * Math.cos(a1), y1, r1 * Math.sin(a1)];
        const pD: V3 = [r0 * Math.cos(a1), y0, r0 * Math.sin(a1)];
        const approx: V3 = [sn[k][0] * Math.cos(am), sn[k][1], sn[k][0] * Math.sin(am)];
        let fn = norm3(r0 < 1e-9 ? cross3(sub3(pC, pB), sub3(pA, pB)) : cross3(sub3(pB, pA), sub3(pD, pA)));
        if (dot3(fn, approx) < 0) fn = [-fn[0], -fn[1], -fn[2]];
        const A = g.v(r0 * Math.cos(a0), y0, r0 * Math.sin(a0), ...fn);
        const B = g.v(r1 * Math.cos(a0), y1, r1 * Math.sin(a0), ...fn);
        const C = g.v(r1 * Math.cos(a1), y1, r1 * Math.sin(a1), ...fn);
        const D = g.v(r0 * Math.cos(a1), y0, r0 * Math.sin(a1), ...fn);
        if (r1 < 1e-9) g.tri(A, B, D);
        else if (r0 < 1e-9) g.tri(B, C, D);
        else g.quad(A, B, C, D);
      }
      continue;
    }
    // a segment on the axis (r0 = r1 = 0) has no surface: a full revolution would only add zero-area
    // triangles, and a partial one would read apex column `seg`, which does not exist
    if (r0 < 1e-9 && r1 < 1e-9) continue;
    const ring = (r: number, y: number, nn: V2): number[] => {
      const out: number[] = [];
      for (let j = 0; j < cols; j++) {
        const a = ang(j);
        out.push(g.v(r * Math.cos(a), y, r * Math.sin(a), nn[0] * Math.cos(a), nn[1], nn[0] * Math.sin(a)));
      }
      return out;
    };
    // apex rings: one vertex per column at the column's mid angle (well-defined normals)
    const apex = (r: number, y: number, nn: V2): number[] => {
      const out: number[] = [];
      for (let j = 0; j < seg; j++) {
        const a = (ang(j) + ang(j + 1)) / 2;
        out.push(g.v(0, y, 0, nn[0] * Math.cos(a), nn[1], nn[0] * Math.sin(a)));
      }
      void r;
      return out;
    };
    const lo = r0 < 1e-9 ? apex(r0, y0, n0) : ring(r0, y0, n0);
    const hi = r1 < 1e-9 ? apex(r1, y1, n1) : ring(r1, y1, n1);
    for (let j = 0; j < seg; j++) {
      const j1 = full ? (j + 1) % seg : j + 1;
      if (r1 < 1e-9) g.tri(lo[j], hi[j], lo[j1]);
      else if (r0 < 1e-9) g.tri(hi[j], hi[j1], lo[j]);
      else g.quad(lo[j], hi[j], hi[j1], lo[j1]);
    }
  }
  if (o.caps !== false) {
    const cap = (pt: V2, up: boolean) => {
      const [r, y] = pt;
      if (r < 1e-9) return;
      const ny = up ? 1 : -1;
      const c = g.v(0, y, 0, 0, ny, 0);
      const rim: number[] = [];
      for (let j = 0; j < cols; j++) rim.push(g.v(r * Math.cos(ang(j)), y, r * Math.sin(ang(j)), 0, ny, 0));
      for (let j = 0; j < seg; j++) {
        const j1 = full ? (j + 1) % seg : j + 1;
        if (up) g.tri(c, rim[j1], rim[j]);
        else g.tri(c, rim[j], rim[j1]);
      }
    };
    const first = profile[0];
    const last = profile[profile.length - 1];
    const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9;
    if (!closed && profile.length > 1) {
      cap(first, profile[1][1] < first[1]);
      cap(last, last[1] >= profile[profile.length - 2][1]);
    }
    // partial revolutions of a closed profile get flat end walls
    if (!full && closed) {
      const poly = profile.slice(0, -1).map(([r, y]) => new Vector2(r, y));
      const tris = ShapeUtils.triangulateShape(poly, []);
      for (const a of [0, arc]) {
        const nrm: V3 = a === 0 ? [0, 0, -1] : [-Math.sin(a), 0, Math.cos(a)];
        const ids = poly.map((q) => g.v(q.x * Math.cos(a), q.y, q.x * Math.sin(a), ...nrm));
        for (const t of tris) triFacing(g, ids[t[0]], ids[t[1]], ids[t[2]], nrm);
      }
    }
  }
  return g;
}

const icoCache = new Map<number, { p: number[]; i: number[] }>();

/** Unit icosphere (shared vertices, outward winding), `detail` subdivisions (0 → 20 tris, 1 → 80, 2 → 320). */
export function icoGeo(detail: number): Geo {
  const d = Math.max(0, Math.round(detail));
  let hit = icoCache.get(d);
  if (!hit) {
    const g = icoBuild(d);
    hit = { p: g.p, i: g.i };
    icoCache.set(d, hit);
  }
  const g = new Geo();
  for (let k = 0; k < hit.p.length; k++) {
    g.p.push(hit.p[k]);
    g.n.push(hit.p[k]);
  }
  for (const x of hit.i) g.i.push(x);
  return g;
}

function icoBuild(detail: number): Geo {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: V3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((v) => norm3(v as V3));
  let faces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let d = 0; d < Math.max(0, Math.round(detail)); d++) {
    const mid = new Map<string, number>();
    const m = (a: number, b: number): number => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const hit = mid.get(key);
      if (hit !== undefined) return hit;
      const v = norm3([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2]);
      verts.push(v);
      mid.set(key, verts.length - 1);
      return verts.length - 1;
    };
    const next: [number, number, number][] = [];
    for (const [a, b, c] of faces) {
      const ab = m(a, b);
      const bc = m(b, c);
      const ca = m(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
    verts = [...verts];
  }
  const g = new Geo();
  for (const v of verts) g.v(v[0], v[1], v[2], v[0], v[1], v[2]);
  for (const [a, b, c] of faces) {
    const cen: V3 = [(verts[a][0] + verts[b][0] + verts[c][0]) / 3, (verts[a][1] + verts[b][1] + verts[c][1]) / 3, (verts[a][2] + verts[b][2] + verts[c][2]) / 3];
    triFacing(g, a, b, c, cen);
  }
  return g;
}

/** integer lattice hash → [0, 1) (deterministic, allocation-free) */
function lattice(seed: number, x: number, y: number, z: number): number {
  let h = seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Stateless smooth 3D value noise in [0, 1) (hashed integer lattice, smoothstep interpolation). */
export function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const s = seed | 0;
  const c000 = lattice(s, xi, yi, zi);
  const c100 = lattice(s, xi + 1, yi, zi);
  const c010 = lattice(s, xi, yi + 1, zi);
  const c110 = lattice(s, xi + 1, yi + 1, zi);
  const c001 = lattice(s, xi, yi, zi + 1);
  const c101 = lattice(s, xi + 1, yi, zi + 1);
  const c011 = lattice(s, xi, yi + 1, zi + 1);
  const c111 = lattice(s, xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * u;
  const x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u;
  const x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

/** Signed area of a 2D polygon (x, z): > 0 when counter-clockwise in the (x, z) plane. */
export function area2(poly: V2[]): number {
  let a = 0;
  for (let k = 0; k < poly.length; k++) {
    const [x0, z0] = poly[k];
    const [x1, z1] = poly[(k + 1) % poly.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

export interface PrismOpts {
  /** top outline scaled towards the centroid by (1 − taper) */
  taper?: number;
  holes?: V2[][];
  /** per-outline-vertex bottom height (followGround); default 0 */
  bottomAt?: (x: number, z: number) => number;
  /** closes the bottom (default true unless bottomAt is given) */
  bottom?: boolean;
}

/** Vertical prism over a polygon outline (x, z), from the bottom to `h` (flat top); holes allowed. */
export function prismGeo(outline: V2[], h: number, o: PrismOpts = {}): Geo {
  const g = new Geo();
  const rings: V2[][] = [outline, ...(o.holes ?? [])];
  let cx = 0;
  let cz = 0;
  for (const q of outline) {
    cx += q[0] / outline.length;
    cz += q[1] / outline.length;
  }
  const s = 1 - (o.taper ?? 0);
  const top = (q: V2): V2 => [cx + (q[0] - cx) * s, cz + (q[1] - cz) * s];
  const bot = (q: V2) => (o.bottomAt ? Math.min(o.bottomAt(q[0], q[1]), h - 1e-4) : 0);
  rings.forEach((ring, ri) => {
    const outer = ri === 0;
    const ringCcw = area2(ring) > 0;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      const ta = top(a);
      const tb = top(b);
      // away from the solid: for a ring with positive area2 the interior lies left of a→b, so the
      // outward side is (dz, −dx); negative rings flip, holes flip again (outward = into the hole)
      const sgn = (ringCcw ? 1 : -1) * (outer ? 1 : -1);
      const el = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = (sgn * (b[1] - a[1])) / el;
      const nz = (sgn * -(b[0] - a[0])) / el;
      // a tapered wall leans inwards: tilt the normal up by the inset over the wall's own height (h is
      // the absolute top — with bottomAt it may be negative, so never scale the normal by it)
      const inset = (1 - s) * Math.hypot((a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cz);
      const wallH = Math.max(1e-6, h - (bot(a) + bot(b)) / 2);
      const n = norm3([nx, inset / wallH, nz] as V3);
      face(g, [[a[0], bot(a), a[1]], [b[0], bot(b), b[1]], [tb[0], h, tb[1]], [ta[0], h, ta[1]]], n);
    }
  });
  const contour = outline.map((q) => new Vector2(q[0], q[1]));
  const holes = (o.holes ?? []).map((hl) => hl.map((q) => new Vector2(q[0], q[1])));
  const tris = ShapeUtils.triangulateShape(contour, holes);
  const all = [...outline, ...(o.holes ?? []).flat()];
  const topIds = all.map((q) => {
    const t = top(q);
    return g.v(t[0], h, t[1], 0, 1, 0);
  });
  for (const t of tris) triFacing(g, topIds[t[0]], topIds[t[1]], topIds[t[2]], [0, 1, 0]);
  if (o.bottom ?? !o.bottomAt) {
    const botIds = all.map((q) => g.v(q[0], bot(q), q[1], 0, -1, 0));
    for (const t of tris) triFacing(g, botIds[t[0]], botIds[t[1]], botIds[t[2]], [0, -1, 0]);
  }
  return g;
}

/** Share of triangles whose geometric normal agrees with the vertex normals (1 = consistent winding). */
export function outwardShare(g: Geo): number {
  let ok = 0;
  const P = (k: number): V3 => [g.p[k * 3], g.p[k * 3 + 1], g.p[k * 3 + 2]];
  const N = (k: number): V3 => [g.n[k * 3], g.n[k * 3 + 1], g.n[k * 3 + 2]];
  for (let k = 0; k < g.i.length; k += 3) {
    const [a, b, c] = [g.i[k], g.i[k + 1], g.i[k + 2]];
    const fn = cross3(sub3(P(b), P(a)), sub3(P(c), P(a)));
    const vn = N(a).map((v, q) => v + N(b)[q] + N(c)[q]) as V3;
    if (dot3(fn, vn) > 0 || Math.hypot(...fn) < 1e-12) ok++;
  }
  return g.triCount ? ok / g.triCount : 1;
}

// ------------------------------------------------------------------ packing

/** One piece of a merged landmark geometry: a mesh plus its packed family bytes. */
export interface PackItem {
  geo: Geo;
  /** linear paint (shade from `geo.s` multiplies it per vertex) */
  paint: [number, number, number];
  surf: [number, number, number, number];
  /** part height, km (contact AO scale) */
  h: number;
  /** floor of the baked hemisphere AO (families.ts aoFloor) */
  aoMin: number;
}

const toSrgbByte = (v: number): number => {
  const c = Math.min(1, Math.max(0, v));
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
};

/**
 * Merge items into one indexed BufferGeometry: position / normal (Float32×3), color / surf (Uint8×4
 * normalised), index (Uint32), plus the temporary `_contactH` (Float32, part height) and `_aoMin`
 * (Float32, AO floor) that the AO bake consumes and deletes.
 */
export function packGeometry(items: PackItem[]): BufferGeometry {
  let nv = 0;
  let ni = 0;
  for (const it of items) {
    nv += it.geo.vertexCount;
    ni += it.geo.i.length;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const col = new Uint8Array(nv * 4);
  const surf = new Uint8Array(nv * 4);
  const ch = new Float32Array(nv);
  const am = new Float32Array(nv);
  const idx = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const it of items) {
    const g = it.geo;
    const base = [toSrgbByte(it.paint[0]), toSrgbByte(it.paint[1]), toSrgbByte(it.paint[2])];
    for (let k = 0; k < g.vertexCount; k++) {
      const v = vo + k;
      pos[v * 3] = g.p[k * 3];
      pos[v * 3 + 1] = g.p[k * 3 + 1];
      pos[v * 3 + 2] = g.p[k * 3 + 2];
      nor[v * 3] = g.n[k * 3];
      nor[v * 3 + 1] = g.n[k * 3 + 1];
      nor[v * 3 + 2] = g.n[k * 3 + 2];
      const sh = g.s ? g.s[k] : 1;
      if (sh === 1) {
        col[v * 4] = base[0];
        col[v * 4 + 1] = base[1];
        col[v * 4 + 2] = base[2];
      } else {
        col[v * 4] = toSrgbByte(it.paint[0] * sh);
        col[v * 4 + 1] = toSrgbByte(it.paint[1] * sh);
        col[v * 4 + 2] = toSrgbByte(it.paint[2] * sh);
      }
      col[v * 4 + 3] = 255;
      surf.set(it.surf, v * 4);
      ch[v] = it.h;
      am[v] = it.aoMin;
    }
    for (let k = 0; k < g.i.length; k++) idx[io + k] = g.i[k] + vo;
    vo += g.vertexCount;
    io += g.i.length;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nor, 3));
  geo.setAttribute('color', new BufferAttribute(col, 4, true));
  geo.setAttribute('surf', new BufferAttribute(surf, 4, true));
  geo.setAttribute('_contactH', new BufferAttribute(ch, 1));
  geo.setAttribute('_aoMin', new BufferAttribute(am, 1));
  geo.setIndex(new BufferAttribute(idx, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** FNV-1a over every attribute and the index of a geometry (determinism gate). */
export function geometryHash(geo: BufferGeometry, h = 0x811c9dc5): number {
  const feed = (arr: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }) => {
    const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let k = 0; k < b.length; k++) {
      h ^= b[k];
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const name of Object.keys(geo.attributes).sort()) feed(geo.attributes[name].array as Float32Array);
  if (geo.index) feed(geo.index.array as Uint32Array);
  return h >>> 0;
}
