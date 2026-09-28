import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Euler,
  ExtrudeGeometry,
  Matrix4,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FamilyId } from '../../materials/families.ts';
import { rand } from '../../core/rng.ts';

type V3 = [number, number, number];

export interface PartOpts {
  /** position of the part's base centre, local km */
  at?: V3;
  /** rotation in degrees (x, y, z) */
  rot?: V3;
  /** multiplicative tint (sRGB hex) */
  tint?: number;
}

/**
 * Blockout/proxy builder: simple primitives in local km collected per material family and merged
 * into one geometry per family (few draw calls). Parts are placed by their BASE centre so building
 * up from the ground is natural. Deterministic: jitter via rand(seed, …).
 */
export class ProxyKit {
  readonly parts = new Map<FamilyId, BufferGeometry[]>();
  private n = 0;

  /**
   * @param groundFn local terrain height at local (x, z) relative to the origin's ground (y = 0),
   *                 after stamps — use `k.ground(x, z)` to sit parts on slopes.
   */
  constructor(
    readonly seed: number,
    private readonly groundFn: (x: number, z: number) => number = () => 0,
  ) {}

  /** local terrain height under local (x, z) */
  ground(x: number, z: number): number {
    return this.groundFn(x, z);
  }

  /** uniform [0,1) random for procedural variation (stateless per call index) */
  r(k = 0): number {
    return rand(this.seed, this.n++, k);
  }

  private add(fam: FamilyId, g: BufferGeometry, o: PartOpts, baseOffset: number): void {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    g.dispose();
    geo.translate(0, baseOffset, 0);
    const m = new Matrix4().compose(
      new Vector3(...(o.at ?? [0, 0, 0])),
      new Quaternion().setFromEuler(new Euler(...((o.rot ?? [0, 0, 0]).map((d) => (d * Math.PI) / 180) as V3))),
      new Vector3(1, 1, 1),
    );
    geo.applyMatrix4(m);
    const c = new Color(o.tint ?? 0xffffff);
    const cols = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < cols.length; i += 3) {
      cols[i] = c.r;
      cols[i + 1] = c.g;
      cols[i + 2] = c.b;
    }
    geo.setAttribute('color', new BufferAttribute(cols, 3));
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(k)) geo.deleteAttribute(k);
    const list = this.parts.get(fam) ?? [];
    list.push(geo);
    this.parts.set(fam, list);
  }

  box(fam: FamilyId, w: number, h: number, d: number, o: PartOpts = {}): this {
    this.add(fam, new BoxGeometry(w, h, d), o, h / 2);
    return this;
  }

  cylinder(fam: FamilyId, rTop: number, rBottom: number, h: number, o: PartOpts & { seg?: number } = {}): this {
    this.add(fam, new CylinderGeometry(rTop, rBottom, h, o.seg ?? 24, 1), o, h / 2);
    return this;
  }

  cone(fam: FamilyId, r: number, h: number, o: PartOpts & { seg?: number } = {}): this {
    this.add(fam, new ConeGeometry(r, h, o.seg ?? 24, 1), o, h / 2);
    return this;
  }

  sphere(fam: FamilyId, r: number, o: PartOpts & { squash?: number } = {}): this {
    const g = new SphereGeometry(r, 20, 14);
    g.scale(1, o.squash ?? 1, 1);
    this.add(fam, g, o, 0);
    return this;
  }

  /** lumpy rock / foliage clump */
  blob(fam: FamilyId, r: number, o: PartOpts & { squash?: number; lump?: number } = {}): this {
    const g = new DodecahedronGeometry(r, 1);
    const p = g.attributes.position as BufferAttribute;
    const lump = o.lump ?? 0.18;
    for (let i = 0; i < p.count; i++) {
      const v = new Vector3().fromBufferAttribute(p, i);
      const k = 1 + (rand(this.seed, this.n, i % 97) - 0.5) * 2 * lump;
      v.multiplyScalar(k);
      v.y *= o.squash ?? 1;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    this.n++;
    g.computeVertexNormals();
    this.add(fam, g, o, 0);
    return this;
  }

  /** ring wall (full or partial arc), base at y = 0 */
  ring(fam: FamilyId, radius: number, thickness: number, h: number, o: PartOpts & { arcDeg?: number; seg?: number } = {}): this {
    const arc = ((o.arcDeg ?? 360) * Math.PI) / 180;
    const shape = new Shape();
    const seg = o.seg ?? 48;
    const r0 = radius - thickness / 2;
    const r1 = radius + thickness / 2;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * arc;
      const x = Math.cos(a) * r1;
      const y = Math.sin(a) * r1;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    for (let i = seg; i >= 0; i--) {
      const a = (i / seg) * arc;
      shape.lineTo(Math.cos(a) * r0, Math.sin(a) * r0);
    }
    const g = new ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 4 });
    g.rotateX(-Math.PI / 2); // extrude along +y
    this.add(fam, g, o, 0);
    return this;
  }

  torus(fam: FamilyId, radius: number, tube: number, o: PartOpts = {}): this {
    const g = new TorusGeometry(radius, tube, 10, 48);
    g.rotateX(Math.PI / 2);
    this.add(fam, g, o, tube);
    return this;
  }

  /** straight wall between two local points (x, z), base at y = 0 */
  wall(fam: FamilyId, a: [number, number], b: [number, number], h: number, thickness: number, o: PartOpts = {}): this {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const yaw = (-Math.atan2(dz, dx) * 180) / Math.PI;
    const at = o.at ?? [0, 0, 0];
    this.box(fam, len, h, thickness, { ...o, at: [(a[0] + b[0]) / 2 + at[0], at[1], (a[1] + b[1]) / 2 + at[2]], rot: [0, yaw, 0] });
    return this;
  }

  /** merged geometry per family (non-indexed, with position/normal/color) */
  build(): Map<FamilyId, BufferGeometry> {
    const out = new Map<FamilyId, BufferGeometry>();
    for (const [fam, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      if (merged) out.set(fam, merged);
      for (const g of list) g.dispose();
    }
    return out;
  }
}
