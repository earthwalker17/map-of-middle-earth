import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Vector3, type Mesh, type Object3D } from 'three/webgpu';
import { aoFloor, carvedVertex, FAMILY_IDS, familyKey, familyVertex, linearToSrgbBytes, type FamilyId } from '../materials/families.ts';
import type { LodGeometry, V3 } from './records.ts';
import type { ModelDecl } from './types.ts';

/**
 * Blender-built landmark models (S3 W2-D): tools/blender/<id>.py → public/models/<file> (GLB) → here.
 *
 * `loadModel(decl)` (browser only — Node never parses GLBs; checks and the camera probe use
 * `ModelDecl.boundsKm` through `modelFootprint`) fetches `/models/<file>`, parses it with GLTFLoader and
 * turns the nodes named `lod0` / `lod1` / `lod2` into the SAME packed geometry the TS kit produces
 * (kit/geom.ts packGeometry layout): per primitive the material name `fam:<FamilyId>` picks the family
 * (unknown names throw — GLB materials are never used as they are), COLOR_0 (linear) becomes the absolute
 * sRGB paint, `surf` comes from `familyVertex`, and `_contactH` / `_aoMin` feed the shared vertex AO bake
 * (kit/ao.ts, run by build.ts over the merged LODs). Every instance (local km `at`, `headingDeg` clockwise
 * from north like the landmark heading, `mirrorX`) is baked into one geometry per material key and LOD.
 * Variant nodes `<name>_lod0/1/2` are baked only into the instances whose `node` is `<name>` (on top of the
 * shared `lod<L>` nodes every instance gets); an instance naming a variant the GLB lacks throws.
 */

/** part height used for the model's ground-contact AO term (km): a 0.08·h darkening band at the foot */
const CONTACT_H_MAX = 1.5;
export const MODEL_LODS = 3;

type Packed = { pos: number[]; nor: number[]; col: number[]; surf: number[]; ch: number[]; am: number[]; idx: number[] };
type Instance = NonNullable<ModelDecl['instances']>[number];

/** Instance transform in the landmark's local frame (km). */
export function instanceMatrix(inst: Instance): Matrix4 {
  const m = new Matrix4().makeTranslation(inst.at[0], inst.at[1], inst.at[2]);
  m.multiply(new Matrix4().makeRotationY((-(inst.headingDeg ?? 0) * Math.PI) / 180));
  if (inst.mirrorX) m.multiply(new Matrix4().makeScale(-1, 1, 1));
  return m;
}

export function instancesOf(decl: ModelDecl): Instance[] {
  return decl.instances?.length ? decl.instances : [{ at: [0, 0, 0] }];
}

/**
 * CPU-side placement of a model from its declared bounds (Node and browser alike, so the camera probe and
 * the renderer agree): the local bounding box of all instances (a cylinder of radius `boundsKm.r` from each
 * instance's base up `boundsKm.h`) and one seating contact per instance (its base against the ground).
 */
export function modelFootprint(decl: ModelDecl, localGround: (x: number, z: number) => number): { min: V3; max: V3; contacts: { x: number; z: number; baseY: number; groundY: number; h: number }[] } {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  const contacts: { x: number; z: number; baseY: number; groundY: number; h: number }[] = [];
  const { r, h } = decl.boundsKm;
  for (const inst of instancesOf(decl)) {
    const [x, y, z] = inst.at;
    min[0] = Math.min(min[0], x - r);
    max[0] = Math.max(max[0], x + r);
    min[2] = Math.min(min[2], z - r);
    max[2] = Math.max(max[2], z + r);
    min[1] = Math.min(min[1], y);
    max[1] = Math.max(max[1], y + h);
    contacts.push({ x, z, baseY: y, groundY: localGround(x, z), h });
  }
  return { min, max, contacts };
}

function familyOf(materialName: string, file: string): FamilyId {
  const m = /^fam:(\w+)$/.exec(materialName);
  const fam = m?.[1] as FamilyId | undefined;
  if (!fam || !(FAMILY_IDS as string[]).includes(fam)) throw new Error(`models/${file}: material '${materialName}' is not 'fam:<FamilyId>' (${FAMILY_IDS.join(', ')})`);
  return fam;
}

function pack(p: Packed): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(p.pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(p.nor), 3));
  geo.setAttribute('color', new BufferAttribute(new Uint8Array(p.col), 4, true));
  geo.setAttribute('surf', new BufferAttribute(new Uint8Array(p.surf), 4, true));
  geo.setAttribute('_contactH', new BufferAttribute(new Float32Array(p.ch), 1));
  geo.setAttribute('_aoMin', new BufferAttribute(new Float32Array(p.am), 1));
  geo.setIndex(new BufferAttribute(new Uint32Array(p.idx), 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** Fetch + parse a model and return its LODs (local km, instances baked, packed like the kit). */
export async function loadModel(decl: ModelDecl): Promise<LodGeometry[]> {
  const res = await fetch(`/models/${decl.file}`);
  if (!res.ok) throw new Error(`models/${decl.file}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const contactH = Math.min(CONTACT_H_MAX, decl.boundsKm.h);
  const instances = instancesOf(decl).map((inst) => ({ m: instanceMatrix(inst), node: inst.node }));

  const levels: Map<string, Packed>[] = Array.from({ length: MODEL_LODS }, () => new Map());
  const seen = new Set<string>();
  root.traverse((node: Object3D) => {
    const lm = /^(?:([A-Za-z][A-Za-z0-9]*)_)?lod([0-9])$/.exec(node.name);
    if (!lm) return;
    const variant = lm[1];
    const L = Number(lm[2]);
    if (L >= MODEL_LODS) throw new Error(`models/${decl.file}: node '${node.name}' beyond lod${MODEL_LODS - 1}`);
    seen.add(`${variant ?? ''}:${L}`);
    // shared nodes go into every instance, a variant's nodes only into the instances naming it
    const targets = instances.filter((inst) => !variant || inst.node === variant).map((inst) => inst.m);
    if (!targets.length) return;
    node.traverse((o: Object3D) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.length !== 1) throw new Error(`models/${decl.file}: mesh '${mesh.name}' has ${mats.length} materials (one per primitive expected)`);
      const fam = familyOf(mats[0].name, decl.file);
      const key = familyKey(fam);
      // sculpted stone (hero statues): weathering without masonry courses or joints (NOISE.carved)
      const fv = carvedVertex(fam, familyVertex(fam));
      const aoMin = aoFloor(fam);
      const g = mesh.geometry;
      const P = g.getAttribute('position');
      const N = g.getAttribute('normal');
      const C = g.getAttribute('color');
      if (!P || !N) throw new Error(`models/${decl.file}: mesh '${mesh.name}' lacks POSITION / NORMAL`);
      const index = g.getIndex();
      const nv = P.count;
      const tris = index ? Array.from(index.array as ArrayLike<number>) : Array.from({ length: nv }, (_, i) => i);
      const pk = levels[L].get(key) ?? { pos: [], nor: [], col: [], surf: [], ch: [], am: [], idx: [] };
      levels[L].set(key, pk);
      const v = new Vector3();
      const nm = new Matrix3();
      for (const inst of targets) {
        const m = new Matrix4().multiplyMatrices(inst, mesh.matrixWorld);
        nm.getNormalMatrix(m);
        const flip = m.determinant() < 0;
        const base = pk.pos.length / 3;
        for (let i = 0; i < nv; i++) {
          v.fromBufferAttribute(P, i).applyMatrix4(m);
          pk.pos.push(v.x, v.y, v.z);
          v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
          pk.nor.push(v.x, v.y, v.z);
          const rgb: [number, number, number] = C ? [C.getX(i), C.getY(i), C.getZ(i)] : [0.5, 0.5, 0.5];
          const [r, gg, b] = C ? linearToSrgbBytes(rgb) : fv.color;
          pk.col.push(r, gg, b, 255);
          pk.surf.push(...fv.surf);
          pk.ch.push(contactH);
          pk.am.push(aoMin);
        }
        for (let t = 0; t < tris.length; t += 3) {
          const a = base + tris[t];
          const b = base + tris[t + 1];
          const c = base + tris[t + 2];
          if (flip) pk.idx.push(a, c, b);
          else pk.idx.push(a, b, c);
        }
      }
    });
  });
  // release the loader's objects (its materials are never used)
  root.traverse((o: Object3D) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) mat.dispose();
  });
  for (let L = 0; L < MODEL_LODS; L++) {
    if (!seen.has(`:${L}`)) throw new Error(`models/${decl.file}: no node 'lod${L}'`);
    for (const inst of instances) if (inst.node && !seen.has(`${inst.node}:${L}`)) throw new Error(`models/${decl.file}: no node '${inst.node}_lod${L}' (instance node '${inst.node}')`);
  }
  return levels.map((lv) => {
    const out: LodGeometry = new Map();
    for (const key of ['structure', 'glow']) {
      const p = lv.get(key);
      if (p) out.set(key, pack(p));
    }
    return out;
  });
}

/** Concatenate packed geometries of one material key (same attribute layout: kit/geom.ts packGeometry). */
function concat(list: BufferGeometry[]): BufferGeometry {
  if (list.length === 1) return list[0];
  const geo = new BufferGeometry();
  const names = Object.keys(list[0].attributes);
  for (const name of names) {
    const first = list[0].attributes[name] as BufferAttribute;
    const Ctor = (first.array as Float32Array).constructor as new (n: number) => Float32Array | Uint8Array;
    const total = list.reduce((s, g) => s + (g.attributes[name] as BufferAttribute).array.length, 0);
    const arr = Ctor === Float32Array ? new Float32Array(total) : new Uint8Array(total);
    let o = 0;
    for (const g of list) {
      const a = (g.attributes[name] as BufferAttribute).array as Float32Array | Uint8Array;
      arr.set(a, o);
      o += a.length;
    }
    geo.setAttribute(name, new BufferAttribute(arr, first.itemSize, first.normalized));
  }
  const idx = new Uint32Array(list.reduce((s, g) => s + (g.index ? g.index.count : 0), 0));
  let io = 0;
  let vo = 0;
  for (const g of list) {
    const a = g.index!.array;
    for (let k = 0; k < a.length; k++) idx[io + k] = a[k] + vo;
    io += a.length;
    vo += g.attributes.position.count;
  }
  geo.setIndex(new BufferAttribute(idx, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Merge kit LODs and model LODs level by level (a shorter list repeats its coarsest level), one geometry per
 * material key; the inputs are consumed (disposed when merged into a new geometry).
 */
export function mergeLods(a: LodGeometry[], b: LodGeometry[]): LodGeometry[] {
  if (!a.length) return b;
  if (!b.length) return a;
  const n = Math.max(a.length, b.length);
  const out: LodGeometry[] = [];
  for (let L = 0; L < n; L++) {
    const la = a[Math.min(L, a.length - 1)];
    const lb = b[Math.min(L, b.length - 1)];
    const lod: LodGeometry = new Map();
    for (const key of ['structure', 'glow']) {
      const parts = [la.get(key), lb.get(key)].filter((g): g is BufferGeometry => !!g);
      if (!parts.length) continue;
      lod.set(key, concat(parts));
    }
    out.push(lod);
  }
  // inputs that were merged into new geometries are no longer referenced
  const keep = new Set<BufferGeometry>();
  for (const lod of out) for (const g of lod.values()) keep.add(g);
  for (const src of [...a, ...b]) for (const g of src.values()) if (!keep.has(g)) g.dispose();
  return out;
}

/** Union of two local boxes (either may be null). */
export function unionBox(a: { min: V3; max: V3 } | null, b: { min: V3; max: V3 }): { min: V3; max: V3 } {
  if (!a) return { min: [...b.min] as V3, max: [...b.max] as V3 };
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/** GLBs load only where there is a page to fetch them from (Node checks use the declared bounds). */
export function canLoadModels(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}
