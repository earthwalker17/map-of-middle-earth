import type { World } from '../world/World.ts';
import { hash32, hashString } from '../core/rng.ts';
import type { Rough, Stamp, Vec2 } from '../world/stamps.ts';
import { landmarkOrigin, localToWorldXZ } from './frame.ts';
import { hexToLinear } from '../materials/families.ts';
import type { EmitterRecord, ExclusionCircle, FallRecord, PoolRecord, ReflectorRecord, TreeCapRecord, V3 } from './records.ts';
import type { LandmarkDefinition } from './types.ts';

/**
 * The terrain-side declarations of landmarks, as pure data usable before any system init (and in
 * Node): stamps for the HeightField, vegetation exclusion circles and tree caps, still-water pools,
 * effect emitters and waterfall ribbons.
 */

/**
 * Convert every landmark's local stamps to world stamps. Heights in local stamps are RELATIVE to the
 * base (pre-stamp) ground at the landmark origin. Must run before any system samples heights.
 */
export function landmarkStamps(world: World, defs: LandmarkDefinition[]): Stamp[] {
  const out: Stamp[] = [];
  for (const d of defs) {
    if (!d.stamps?.length) continue;
    const p = world.place(d.placeId);
    const h0 = world.heights.sample(p.x, p.z, 'base');
    const w = (v: Vec2): Vec2 => localToWorldXZ(world, d, v);
    for (const [i, s] of d.stamps.entries()) {
      switch (s.kind) {
        case 'flatten':
          out.push({ ...s, at: w(s.at), height: typeof s.height === 'number' ? h0 + s.height : s.height });
          break;
        case 'raise':
          out.push({ ...s, at: w(s.at) });
          break;
        case 'cone':
          out.push({ ...s, at: w(s.at), summit: h0 + s.summit, base: h0 });
          break;
        case 'plateau':
          out.push({ ...s, at: w(s.at), height: h0 + s.height });
          break;
        case 'carve':
          out.push({ ...s, path: s.path.map(w) });
          break;
        // ---- stamps v2: additive kinds carry amounts; absolute heights are made relative to h0
        case 'ridge':
          out.push({ ...s, path: s.path.map(w), rough: rough(s.rough, d.id, i) });
          break;
        case 'scarp':
          out.push({ ...s, path: s.path.map(w), rough: rough(s.rough, d.id, i) });
          break;
        case 'massif':
          out.push({
            ...s,
            at: w(s.at),
            summit: h0 + s.summit,
            base: h0 + (s.base ?? 0),
            // local azimuths turn with the landmark heading (clockwise from north)
            spurs: s.spurs.map((sp) => ({ ...sp, azimuthDeg: sp.azimuthDeg + (d.headingDeg ?? 0) })),
            rough: rough(s.rough, d.id, i),
          });
          break;
        case 'basin':
          out.push({ ...s, at: w(s.at), floor: typeof s.floor === 'number' ? h0 + s.floor : s.floor });
          break;
      }
      if ((s.kind === 'raise' || s.kind === 'cone') && s.rough) {
        const last = out[out.length - 1] as typeof s;
        last.rough = rough(s.rough, d.id, i);
      }
    }
  }
  return out;
}

/** A stamp's roughness with a per-landmark default seed (the noise lives in world coordinates). */
function rough(r: Rough | undefined, id: string, index: number): Rough | undefined {
  if (!r) return undefined;
  return { ...r, seed: r.seed ?? hash32(hashString(id), index) };
}

/** Circles (world km) that must stay clear of forest — pure data, usable before any system init. */
export function landmarkExclusions(world: World, defs: LandmarkDefinition[]): ExclusionCircle[] {
  const out: ExclusionCircle[] = [];
  for (const d of defs) {
    const p = world.place(d.placeId);
    const ex = d.vegetationExclusion;
    if (Array.isArray(ex)) {
      for (const c of ex) {
        const [x, z] = localToWorldXZ(world, d, c.at);
        out.push({ x, z, r: c.r });
      }
    } else out.push({ x: p.x, z: p.z, r: ex ?? p.footprintKm ?? 5 });
  }
  return out;
}

/** Still-water pools declared by landmarks (`waterFeatures` of kind 'pool'), in world space. */
export function landmarkPools(world: World, defs: LandmarkDefinition[]): PoolRecord[] {
  const out: PoolRecord[] = [];
  for (const d of defs) {
    const o = landmarkOrigin(world, d);
    for (const f of d.waterFeatures ?? []) {
      if (f.kind !== 'pool') continue;
      out.push({ landmark: d.id, ring: f.ring.map((v) => localToWorldXZ(world, d, v, d.scale ?? 1)), level: o[1] + f.level * (d.scale ?? 1) });
    }
  }
  return out;
}

/** Share of a GLB model's declared bounding radius that stands up as its reflection proxy (the body, not the plinth). */
const MODEL_REFLECTOR_R = 0.5;
/** depth below the landmark origin to which a declared reflector reaches (its foot is under the water) */
const REFLECTOR_FOOT = 3;

/**
 * Upright reflection proxies (world space) for the water's reflection march (S4): one per GLB model instance
 * (its declared bounds) and the landmark's own `reflectors`. Pure, at the design scale.
 */
export function landmarkReflectors(world: World, defs: LandmarkDefinition[]): ReflectorRecord[] {
  const out: ReflectorRecord[] = [];
  for (const d of defs) {
    const o = landmarkOrigin(world, d);
    const sc = d.scale ?? 1;
    if (d.model) {
      for (const inst of d.model.instances ?? [{ at: [0, 0, 0] as V3 }]) {
        const [x, z] = localToWorldXZ(world, d, [inst.at[0], inst.at[2]], sc);
        const y0 = o[1] + inst.at[1] * sc;
        out.push({ landmark: d.id, x, z, r: d.model.boundsKm.r * MODEL_REFLECTOR_R * sc, y0, y1: y0 + d.model.boundsKm.h * sc });
      }
    }
    for (const r of d.reflectors ?? []) {
      const [x, z] = localToWorldXZ(world, d, r.at, sc);
      out.push({ landmark: d.id, x, z, r: r.r * sc, y0: o[1] - REFLECTOR_FOOT, y1: o[1] + r.top * sc });
    }
  }
  return out;
}

/** Local km (x, y above the origin, z) → world, with the landmark's design scale (geometry-side). */
function localToWorld3(world: World, d: LandmarkDefinition, o: V3, v: V3): V3 {
  const sc = d.scale ?? 1;
  const [x, z] = localToWorldXZ(world, d, [v[0], v[2]], sc);
  return [x, o[1] + v[1] * sc, z];
}

/**
 * Effect emitters declared by landmarks (`emitters`), in world space (EffectsSystem, S4). Positions,
 * beam ends and `scale` carry the landmark's design scale; seeds are stable per (landmark, index).
 */
export function landmarkEmitters(world: World, defs: LandmarkDefinition[]): EmitterRecord[] {
  const out: EmitterRecord[] = [];
  for (const d of defs) {
    if (!d.emitters?.length) continue;
    const o = landmarkOrigin(world, d);
    const seed = hashString(`${d.id}/emitters`);
    for (const [i, e] of d.emitters.entries()) {
      const rec: EmitterRecord = {
        landmark: d.id,
        preset: e.preset,
        p: localToWorld3(world, d, o, e.at),
        rate: e.rate ?? 1,
        scale: (e.scale ?? 1) * (d.scale ?? 1),
        seed: hash32(seed, i),
      };
      if (e.to) rec.to = localToWorld3(world, d, o, e.to);
      if (e.color !== undefined) rec.color = hexToLinear(e.color);
      if (e.event !== undefined) rec.event = e.event;
      out.push(rec);
    }
  }
  return out;
}

/** Waterfall / flood ribbons declared by landmarks (`waterFeatures`), in world space (EffectsSystem, S4). */
export function landmarkFalls(world: World, defs: LandmarkDefinition[]): FallRecord[] {
  const out: FallRecord[] = [];
  for (const d of defs) {
    const o = landmarkOrigin(world, d);
    const seed = hashString(`${d.id}/falls`);
    for (const [i, f] of (d.waterFeatures ?? []).entries()) {
      if (f.kind === 'pool') continue;
      out.push({ landmark: d.id, kind: f.kind, path: f.path.map((v) => localToWorld3(world, d, o, v)), width: f.width * (d.scale ?? 1), seed: hash32(seed, i) });
    }
  }
  return out;
}

/** Tree-height caps declared by landmarks (`treeCaps`), as world circles; radius and height carry the design scale. */
export function landmarkTreeCaps(world: World, defs: LandmarkDefinition[]): TreeCapRecord[] {
  const out: TreeCapRecord[] = [];
  for (const d of defs) {
    const sc = d.scale ?? 1;
    for (const c of d.treeCaps ?? []) {
      const [x, z] = localToWorldXZ(world, d, c.at, sc);
      out.push({ landmark: d.id, x, z, r: c.r * sc, maxHeightKm: c.maxHeightKm * sc });
    }
  }
  return out;
}
