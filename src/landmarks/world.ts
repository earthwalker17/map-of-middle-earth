import type { World } from '../world/World.ts';
import { hash32, hashString } from '../core/rng.ts';
import type { Rough, Stamp, Vec2 } from '../world/stamps.ts';
import { landmarkOrigin, localToWorldXZ } from './frame.ts';
import type { ExclusionCircle, PoolRecord } from './records.ts';
import type { LandmarkDefinition } from './types.ts';

/**
 * The terrain-side declarations of landmarks, as pure data usable before any system init (and in
 * Node): stamps for the HeightField, vegetation exclusion circles, still-water pools.
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
