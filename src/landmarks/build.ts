import { hash32, hashString } from '../core/rng.ts';
import { hexToLinear } from '../materials/families.ts';
import type { World } from '../world/World.ts';
import { landmarkOrigin, rotateLocal } from './frame.ts';
import { bakeVertexAO, stripBakeAttributes } from './kit/ao.ts';
import { ProxyKit, type KitLight, type KitOutput } from './kit/ProxyKit.ts';
import { DEFAULT_GATE, type AuthoredTree, type BuiltLandmark, type ContactRecord, type LightRecord } from './records.ts';
import type { LandmarkDefinition, TreeDecl } from './types.ts';

export interface BuildOptions {
  /** false: records, bounds and stats only (Node checks / camera probe); geometry is disposed, no AO bake */
  geometry?: boolean;
  /** skip the vertex AO bake (diagnostics) */
  ao?: boolean;
}

/** default projected-radius LOD thresholds (px at viewport height): [LOD0 ≥, LOD1 ≥] */
export const DEFAULT_LOD_PX: [number, number] = [160, 40];

/** Build-wide diagnostics of the last buildLandmarks run (never drives rendering). */
export const buildStats = { aoMs: 0, kitMs: 0, total: 0 };

/**
 * ONE pure build run for all landmarks: geometry LODs (kit v2: indexed, merged per material key, vertex
 * AO baked), world-space lights and trees (definition + kit records), bounds, seating contacts, stats.
 * Runs after the stamp layer is composited (it seats parts on the composite ground) and before
 * vegetation init (trees). Sorted by id, deterministic (rand(seed, …) only; timings are diagnostics).
 */
export async function buildLandmarks(world: World, defs: LandmarkDefinition[], opts: BuildOptions = {}): Promise<BuiltLandmark[]> {
  buildStats.aoMs = 0;
  buildStats.kitMs = 0;
  const t0 = performance.now(); // diagnostics only
  const out = [...defs].sort((a, b) => a.id.localeCompare(b.id)).map((d) => buildOne(world, d, opts));
  buildStats.total = Math.round(performance.now() - t0);
  return out;
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
  const keep = opts.geometry !== false;

  let kit: KitOutput = { lods: [], lights: [], trees: [], contacts: [], bbox: null, parts: [] };
  if (def.proxy) {
    const k = new ProxyKit(seed, localGround);
    def.proxy(k);
    kit = k.buildLods({ lod0Only: !keep });
  }
  // TODO(W2): def.model → GLB placements (src/landmarks/model.ts) join the LODs here; Node never parses
  // GLBs, so bounds / checks use `def.model.boundsKm` until then.
  buildStats.kitMs += performance.now() - t0;

  const tris: number[] = [];
  let bytes = 0;
  const counted = new Set<unknown>(); // a level may reuse the previous level's geometry
  for (const lod of kit.lods) {
    let t = 0;
    for (const geo of lod.values()) {
      t += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      if (counted.has(geo)) continue;
      counted.add(geo);
      for (const [name, a] of Object.entries(geo.attributes)) if (!name.startsWith('_')) bytes += a.array.byteLength;
      if (geo.index) bytes += geo.index.array.byteLength;
    }
    tris.push(t);
  }
  if (keep && opts.ao !== false && kit.lods.length) {
    const ta = performance.now();
    bakeVertexAO(kit.lods, localGround, { seed });
    buildStats.aoMs += performance.now() - ta;
  } else if (keep) stripBakeAttributes(kit.lods);
  if (!keep) for (const lod of kit.lods) for (const g of lod.values()) g.dispose();

  // bounds: local bbox → world (centre, horizontal radius about it, height above the origin)
  let bounds: BuiltLandmark['bounds'] = { center: [origin[0], origin[1], origin[2]], r: 0, h: 0 };
  const bb = kit.bbox;
  if (bb) {
    const [cx, cz] = toWorld((bb.min[0] + bb.max[0]) / 2, (bb.min[2] + bb.max[2]) / 2);
    const r = (Math.hypot(bb.max[0] - bb.min[0], bb.max[2] - bb.min[2]) / 2) * s;
    bounds = { center: [cx, origin[1] + ((bb.min[1] + bb.max[1]) / 2) * s, cz], r, h: bb.max[1] * s };
  } else if (def.model) bounds = { center: [origin[0], origin[1] + (def.model.boundsKm.h / 2) * s, origin[2]], r: def.model.boundsKm.r * s, h: def.model.boundsKm.h * s };

  // lights: definition first, then kit records (seeds follow that order)
  const decl: KitLight[] = (def.lights ?? []).map((l) => ({ at: l.at, color: l.color, intensity: l.intensity, radius: l.radius, kind: l.kind ?? 'window', gate: l.gate, flicker: l.flicker ?? 0 }));
  const lights: LightRecord[] = [...decl, ...kit.lights].map((l, i) => {
    const [x, z] = toWorld(l.at[0], l.at[2]);
    return {
      landmark: def.id,
      p: [x, origin[1] + l.at[1] * s, z],
      color: hexToLinear(l.color),
      intensity: l.intensity,
      radiusKm: l.radius * s,
      kind: l.kind,
      gate: l.gate ?? DEFAULT_GATE[l.kind],
      flicker: l.flicker,
      seed: hash32(seed, i),
    };
  });
  const treeDecl: TreeDecl[] = [...(def.trees ?? []), ...kit.trees];
  const trees: AuthoredTree[] = treeDecl.map((t, i) => {
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
  const contacts: ContactRecord[] = kit.contacts.map((c) => {
    const [x, z] = toWorld(c.x, c.z);
    return { x, z, baseY: origin[1] + c.baseY * s, groundY: origin[1] + c.groundY * s, h: c.h * s };
  });

  return {
    id: def.id,
    def,
    origin,
    headingDeg: hd,
    scale: s,
    lods: keep ? kit.lods : [],
    lodPx: def.lodPx ?? DEFAULT_LOD_PX,
    lights,
    trees,
    bounds,
    contacts,
    stats: { tris, bytes, buildMs: Math.round(performance.now() - t0) },
  };
}
