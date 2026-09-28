import { Group, Mesh } from 'three/webgpu';
import type { FrameContext, InitContext, System } from '../core/types.ts';
import { hashString } from '../core/rng.ts';
import type { World } from '../world/World.ts';
import type { Stamp, Vec2 } from '../world/stamps.ts';
import { family } from '../materials/families.ts';
import { ProxyKit } from './kit/ProxyKit.ts';
import type { LandmarkDefinition } from './types.ts';

function rotate(p: Vec2, headingDeg: number): Vec2 {
  const t = (-headingDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [p[0] * c + p[1] * s, -p[0] * s + p[1] * c];
}

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
    const hd = d.headingDeg ?? 0;
    const w = (v: Vec2): Vec2 => {
      const r = rotate(v, hd);
      return [p.x + r[0], p.z + r[1]];
    };
    for (const s of d.stamps) {
      switch (s.kind) {
        case 'flatten':
          out.push({ ...s, at: w(s.at), height: typeof s.height === 'number' ? h0 + s.height : s.height });
          break;
        case 'raise':
          out.push({ ...s, at: w(s.at) });
          break;
        case 'cone':
          out.push({ ...s, at: w(s.at), summit: h0 + s.summit });
          break;
        case 'plateau':
          out.push({ ...s, at: w(s.at), height: h0 + s.height });
          break;
        case 'carve':
          out.push({ ...s, path: s.path.map(w) });
          break;
      }
    }
  }
  return out;
}

/** Circles (world km) that must stay clear of vegetation — pure data, usable before any system init. */
export function landmarkExclusions(world: World, defs: LandmarkDefinition[]): { x: number; z: number; r: number }[] {
  return defs.map((d) => {
    const p = world.place(d.placeId);
    return { x: p.x, z: p.z, r: d.vegetationExclusion ?? p.footprintKm ?? 5 };
  });
}

/** Realizes landmark bundles as meshes (S1: proxies; S4+: Blender GLB LODs). */
export class LandmarkSystem implements System {
  readonly id = 'landmarks';
  readonly root = new Group();
  readonly groups = new Map<string, Group>();

  constructor(
    private readonly world: World,
    readonly defs: LandmarkDefinition[],
  ) {}

  init(ctx: InitContext): void {
    this.root.name = 'landmarks';
    for (const def of this.defs) {
      const place = this.world.place(def.placeId);
      const g = new Group();
      g.name = `landmark:${def.id}`;
      const groundY = this.world.heights.sample(place.x, place.z);
      const originY = def.anchor === 'water' ? (this.world.waterLevelAt(place.x, place.z) ?? groundY) : groundY;
      const hd = def.headingDeg ?? 0;
      const s = def.scale ?? 1;
      const localGround = (x: number, z: number) => {
        const [wx, wz] = rotate([x * s, z * s], hd);
        return (this.world.heights.sample(place.x + wx, place.z + wz) - originY) / s;
      };
      if (def.proxy) {
        const kit = new ProxyKit(hashString(def.id), localGround);
        def.proxy(kit);
        for (const [fam, geo] of kit.build()) {
          const mesh = new Mesh(geo, family(fam));
          mesh.castShadow = !fam.startsWith('emissive') && fam !== 'lava';
          mesh.receiveShadow = true;
          mesh.name = `${def.id}:${fam}`;
          g.add(mesh);
        }
      }
      g.scale.setScalar(s);
      g.rotation.y = (-hd * Math.PI) / 180;
      g.position.set(place.x, originY, place.z);
      g.updateMatrixWorld(true);
      this.root.add(g);
      this.groups.set(def.id, g);
    }
    ctx.scene.add(this.root);
  }

  evaluate(frame: FrameContext): void {
    const cam = frame.camera.position;
    for (const def of this.defs) {
      const g = this.groups.get(def.id);
      if (!g) continue;
      const boost = def.wideBoost ?? (def.tier === 'A' ? { refKm: 160, max: 2.6 } : { refKm: 160, max: 1.8 });
      const d = cam.distanceTo(g.position);
      // smoothstep-shaped growth so the boost eases in rather than kinking at refKm
      const t = Math.min(1, Math.max(0, (d / boost.refKm - 1) / (boost.max - 1)));
      const k = 1 + (boost.max - 1) * t * t * (3 - 2 * t);
      g.scale.setScalar((def.scale ?? 1) * k);
      g.updateMatrixWorld(true);
    }
  }
}
