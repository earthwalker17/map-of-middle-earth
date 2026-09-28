import { BufferAttribute, BufferGeometry, Vector3 } from 'three/webgpu';
import { SLAB } from './slabSpec.ts';

/**
 * The four cut faces of the slab as one strip geometry. Every column sits on a heightfield texel
 * centre (plus the frame corners), so the top edge reproduces the terrain's own bilinear edge
 * profile exactly; the vertex shader lifts `top = 1` vertices to the height texture.
 * Attributes: position (x, 0, z), normal (outward), `top` (1 = upper row, 0 = lower row).
 */
export function createEdgeStrip(texelKm: number, cols: number, rows: number): BufferGeometry {
  const { xMin, xMax, zMin, zMax, faceOffset: e } = SLAB;
  const alongX = (): number[] => {
    const xs = [xMin];
    for (let i = 0; i < cols; i++) xs.push(xMin + (i + 0.5) * texelKm);
    xs.push(xMax);
    return xs;
  };
  const alongZ = (): number[] => {
    const zs = [zMin];
    for (let i = 0; i < rows; i++) zs.push(zMin + (i + 0.5) * texelKm);
    zs.push(zMax);
    return zs;
  };
  // each edge is walked so that (Δz, 0, −Δx) points outward → CCW seen from outside
  const edges: { pts: [number, number][]; n: Vector3 }[] = [
    { pts: alongX().map((x) => [x, zMin - e]), n: new Vector3(0, 0, -1) },
    { pts: alongX().reverse().map((x) => [x, zMax + e]), n: new Vector3(0, 0, 1) },
    { pts: alongZ().reverse().map((z) => [xMin - e, z]), n: new Vector3(-1, 0, 0) },
    { pts: alongZ().map((z) => [xMax + e, z]), n: new Vector3(1, 0, 0) },
  ];
  let nv = 0;
  for (const ed of edges) nv += ed.pts.length * 2;
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const top = new Float32Array(nv);
  const idx: number[] = [];
  let v = 0;
  for (const ed of edges) {
    const start = v;
    for (const [x, z] of ed.pts) {
      for (const t of [0, 1]) {
        pos[v * 3] = x;
        pos[v * 3 + 1] = t;
        pos[v * 3 + 2] = z;
        nor[v * 3] = ed.n.x;
        nor[v * 3 + 1] = 0;
        nor[v * 3 + 2] = ed.n.z;
        top[v] = t;
        v++;
      }
    }
    for (let i = 0; i < ed.pts.length - 1; i++) {
      const b0 = start + i * 2;
      const t0 = b0 + 1;
      const b1 = b0 + 2;
      const t1 = b0 + 3;
      idx.push(b0, t0, b1, t0, t1, b1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('top', new BufferAttribute(top, 1));
  g.setIndex(idx);
  return g;
}

/** A profile vertex of the plinth moulding: outward offset from the slab edge and height. */
export interface ProfilePoint {
  d: number;
  y: number;
}

/** The plinth moulding: top ledge, rounded bevel, face, chamfer, recessed foot (shadow gap). */
export function plinthProfile(): ProfilePoint[] {
  const yB = SLAB.base;
  const W = SLAB.plinthOut;
  const H = SLAB.plinthHeight;
  const r = 1.4;
  const r2 = 0.45;
  const foot = 2.4;
  const pts: ProfilePoint[] = [{ d: -3, y: yB }];
  // a hairline groove on the ledge, a little in from the bevel (catches a thin shadow line)
  pts.push({ d: W - r - 1.3, y: yB }, { d: W - r - 1.2, y: yB - 0.12 }, { d: W - r - 1.0, y: yB - 0.12 }, { d: W - r - 0.9, y: yB });
  pts.push({ d: W - r, y: yB });
  const seg = 6;
  for (let i = 1; i <= seg; i++) {
    const a = (Math.PI / 2) * (1 - i / seg);
    pts.push({ d: W - r + r * Math.cos(a), y: yB - r + r * Math.sin(a) });
  }
  pts.push({ d: W, y: yB - H + r2 }, { d: W - r2, y: yB - H }, { d: W - foot, y: yB - H }, { d: W - foot, y: SLAB.plinthBottom }, { d: -3, y: SLAB.plinthBottom });
  return pts;
}

/**
 * Sweep a profile around the slab rectangle (mitred corners). Normals are smoothed across profile
 * vertices whose segments turn by less than ~35° (the rounded bevel), split elsewhere.
 */
export function sweepProfile(profile: ProfilePoint[]): BufferGeometry {
  const { xMin, xMax, zMin, zMax } = SLAB;
  const segN = (i: number) => {
    const a = profile[i];
    const b = profile[i + 1];
    const dd = b.d - a.d;
    const dy = b.y - a.y;
    const l = Math.hypot(dd, dy) || 1;
    return { nd: -dy / l, ny: dd / l };
  };
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const sides = [
    { n: new Vector3(0, 0, -1), a: (d: number) => [xMax + d, zMin - d], b: (d: number) => [xMin - d, zMin - d] },
    { n: new Vector3(0, 0, 1), a: (d: number) => [xMin - d, zMax + d], b: (d: number) => [xMax + d, zMax + d] },
    { n: new Vector3(-1, 0, 0), a: (d: number) => [xMin - d, zMin - d], b: (d: number) => [xMin - d, zMax + d] },
    { n: new Vector3(1, 0, 0), a: (d: number) => [xMax + d, zMax + d], b: (d: number) => [xMax + d, zMin - d] },
  ];
  const tmp = new Vector3();
  const e1 = new Vector3();
  const e2 = new Vector3();
  for (const side of sides) {
    for (let k = 0; k < profile.length - 1; k++) {
      const n0 = segN(k);
      const vn = (i: number, own: { nd: number; ny: number }) => {
        // smooth with the neighbouring segment when the turn is gentle
        const nb = i === k ? (k > 0 ? segN(k - 1) : null) : k + 1 < profile.length - 1 ? segN(k + 1) : null;
        if (nb && own.nd * nb.nd + own.ny * nb.ny > 0.82) {
          const d = own.nd + nb.nd;
          const y = own.ny + nb.ny;
          const l = Math.hypot(d, y);
          return { nd: d / l, ny: y / l };
        }
        return own;
      };
      const quad: number[] = [];
      for (const [pi, which] of [
        [k, 'a'],
        [k, 'b'],
        [k + 1, 'b'],
        [k + 1, 'a'],
      ] as const) {
        const p = profile[pi];
        const [x, z] = which === 'a' ? side.a(p.d) : side.b(p.d);
        const n = vn(pi, n0);
        pos.push(x, p.y, z);
        tmp.copy(side.n).multiplyScalar(n.nd);
        tmp.y = n.ny;
        tmp.normalize();
        nor.push(tmp.x, tmp.y, tmp.z);
        quad.push(pos.length / 3 - 1);
      }
      // orient each triangle to face along the intended normal
      const want = new Vector3(side.n.x * n0.nd, n0.ny, side.n.z * n0.nd);
      const tri = (a: number, b: number, c: number) => {
        const P = (i: number) => new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        e1.copy(P(b)).sub(P(a));
        e2.copy(P(c)).sub(P(a));
        if (e1.cross(e2).dot(want) >= 0) idx.push(a, b, c);
        else idx.push(a, c, b);
      };
      tri(quad[0], quad[1], quad[2]);
      tri(quad[0], quad[2], quad[3]);
    }
  }
  // bottom cap
  const yb = SLAB.plinthBottom;
  const d = -3;
  const base = pos.length / 3;
  for (const [x, z] of [
    [xMin - d, zMin - d],
    [xMax + d, zMin - d],
    [xMax + d, zMax + d],
    [xMin - d, zMax + d],
  ]) {
    pos.push(x, yb, z);
    nor.push(0, -1, 0);
  }
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  return g;
}
