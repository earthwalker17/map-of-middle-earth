import { Box3, Color } from 'three/webgpu';
import { hash32, hashString } from '../core/rng.ts';
import type { World } from '../world/World.ts';
import { landmarkOrigin, rotateLocal } from './frame.ts';
import { ProxyKit } from './kit/ProxyKit.ts';
import { DEFAULT_GATE, type AuthoredTree, type BuiltLandmark, type LightRecord, type LodGeometry, type V3 } from './records.ts';
import type { LandmarkDefinition } from './types.ts';

export interface BuildOptions {
  /** false: records, bounds and stats only (Node checks / camera probe); geometry is disposed */
  geometry?: boolean;
}

const DEFAULT_LOD_PX: [number, number] = [160, 40];

function linear(hex: number): V3 {
  const c = new Color(hex); // Color(hex) is linear under ColorManagement
  return [c.r, c.g, c.b];
}

/**
 * ONE pure build run for all landmarks: geometry LODs, world-space lights and trees, bounds, contacts.
 * Runs after the stamp layer is composited (it seats parts on the composite ground) and before
 * vegetation init (trees). Sorted by id, deterministic (rand(seed, …) only).
 *
 * W0a stub: the S1 ProxyKit, a single LOD, lights from `def.lights`, trees from `def.trees`.
 * W1 (kit v2) replaces the body behind the same signature.
 */
export async function buildLandmarks(world: World, defs: LandmarkDefinition[], opts: BuildOptions = {}): Promise<BuiltLandmark[]> {
  return [...defs].sort((a, b) => a.id.localeCompare(b.id)).map((d) => buildOne(world, d, opts));
}

function buildOne(world: World, def: LandmarkDefinition, opts: BuildOptions): BuiltLandmark {
  const t0 = performance.now(); // diagnostics only
  const origin = landmarkOrigin(world, def);
  const hd = def.headingDeg ?? 0;
  const s = def.scale ?? 1;
  const seed = hashString(def.id);
  const toWorld = (x: number, z: number): [number, number] => {
    const [wx, wz] = rotateLocal([x * s, z * s], hd);
    return [origin[0] + wx, origin[2] + wz];
  };
  const localGround = (x: number, z: number) => {
    const [wx, wz] = toWorld(x, z);
    return (world.heights.sample(wx, wz) - origin[1]) / s;
  };

  let lod: LodGeometry = new Map();
  if (def.proxy) {
    const kit = new ProxyKit(seed, localGround);
    def.proxy(kit);
    lod = kit.build();
  }
  const box = new Box3();
  let tris = 0;
  let bytes = 0;
  for (const geo of lod.values()) {
    geo.computeBoundingBox();
    if (geo.boundingBox) box.union(geo.boundingBox);
    tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    for (const a of Object.values(geo.attributes)) bytes += a.array.byteLength;
    if (geo.index) bytes += geo.index.array.byteLength;
  }
  const r = box.isEmpty() ? 0 : Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)) * s;
  const h = box.isEmpty() ? 0 : box.max.y * s;

  const lights: LightRecord[] = (def.lights ?? []).map((l, i) => {
    const [x, z] = toWorld(l.at[0], l.at[2]);
    const kind = l.kind ?? 'window';
    return {
      landmark: def.id,
      p: [x, origin[1] + l.at[1] * s, z],
      color: linear(l.color),
      intensity: l.intensity,
      radiusKm: l.radius * s,
      kind,
      gate: l.gate ?? DEFAULT_GATE[kind],
      flicker: l.flicker ?? 0,
      seed: hash32(seed, i),
    };
  });
  const trees: AuthoredTree[] = (def.trees ?? []).map((t, i) => {
    const [x, z] = toWorld(t.at[0], t.at[1]);
    return {
      landmark: def.id,
      x,
      z,
      kind: t.kind,
      crownKm: t.crownKm * s,
      heightKm: t.heightKm === undefined ? undefined : t.heightKm * s,
      color: t.color,
      yaw: (((t.yawDeg ?? 0) - hd) * Math.PI) / 180,
      id: hash32(seed, 1000 + i),
    };
  });

  const keep = opts.geometry !== false;
  if (!keep) for (const g of lod.values()) g.dispose();
  return {
    id: def.id,
    def,
    origin,
    headingDeg: hd,
    scale: s,
    lods: keep && lod.size ? [lod] : [],
    lodPx: def.lodPx ?? DEFAULT_LOD_PX,
    lights,
    trees,
    bounds: { center: [origin[0], origin[1] + h / 2, origin[2]], r, h },
    contacts: [],
    stats: { tris: [tris], bytes, buildMs: Math.round(performance.now() - t0) },
  };
}
