import { Color, MeshStandardNodeMaterial, type Material } from 'three/webgpu';
import { tsl } from './tsl.ts';
import { env } from './environment.ts';

// NB: TSL vec3(new Color()) silently yields black in r186 — always use color(Color) for colour constants
const { Fn, float, mx_noise_float, positionWorld, vec3, uniform, sin, max, vertexColor, color } = tsl;

/**
 * Shared material families for built structures (landmarks). One material instance per family
 * (plus a handful of emissive variants) — variety comes from per-vertex colour, never from new
 * materials (keeps WebGPU pipeline count low).
 */
export type FamilyId = 'stone' | 'darkStone' | 'weathered' | 'wood' | 'thatch' | 'foliage' | 'metal' | 'emissive' | 'emissiveGreen' | 'lava';

const cache = new Map<FamilyId, Material>();

function stoneLike(base: number, roughness: number, grain: number, metal = 0): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness, metalness: metal });
  const tint = vertexColor().rgb;
  m.colorNode = Fn(() => {
    const p = positionWorld;
    const n = mx_noise_float(p.mul(9)).mul(0.5).add(mx_noise_float(p.mul(37)).mul(0.25));
    const c = color(new Color(base)).mul(tint); // Color(hex) is already linear (ColorManagement)
    // weathering: darker in crevices (low-frequency noise) and toward the base
    return c.mul(float(1).add(n.mul(grain)));
  })();
  m.roughnessNode = float(roughness).add(mx_noise_float(positionWorld.mul(21)).mul(0.08));
  return m;
}

function emissive(hex: number, strength: number, flicker: number): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0 });
  const c = new Color(hex);
  const k = uniform(strength);
  m.colorNode = color(c).mul(0.25);
  // deterministic flicker from the effect clock + world position
  m.emissiveNode = Fn(() => {
    const phase = positionWorld.x.mul(3.1).add(positionWorld.z.mul(1.7));
    const f = float(1).add(sin(env.tFx.mul(7.3).add(phase)).mul(sin(env.tFx.mul(2.9).add(phase.mul(0.37))).mul(flicker)));
    return color(c).mul(k).mul(max(f, 0.2));
  })();
  return m;
}

export function family(id: FamilyId): Material {
  const hit = cache.get(id);
  if (hit) return hit;
  let m: Material;
  switch (id) {
    case 'stone':
      m = stoneLike(0xd9d3c4, 0.82, 0.22);
      break;
    case 'darkStone':
      m = stoneLike(0x121114, 0.72, 0.35, 0.05);
      break;
    case 'weathered':
      m = stoneLike(0x8a857a, 0.9, 0.3);
      break;
    case 'wood':
      m = stoneLike(0x5a4330, 0.85, 0.3);
      break;
    case 'thatch':
      m = stoneLike(0xa88a4a, 0.95, 0.35);
      break;
    case 'foliage':
      m = stoneLike(0x3d5a2a, 0.9, 0.4);
      break;
    case 'metal':
      m = stoneLike(0x6a6660, 0.4, 0.2, 0.8);
      break;
    case 'emissive':
      m = emissive(0xff7a1a, 4.5, 0.06);
      break;
    case 'emissiveGreen':
      m = emissive(0x7ee6a0, 2.4, 0.12);
      break;
    case 'lava':
      m = emissive(0xff3a0a, 3.2, 0.18);
      break;
  }
  // (vertex colour tint is read explicitly in colorNode — do not also set vertexColors)
  m.name = `family:${id}`;
  cache.set(id, m);
  return m;
}

/**
 * Material for a landmark geometry key (records.ts LodGeometry). Every landmark mesh goes through here,
 * so the family set can be consolidated (W1: structure + glow) without touching LandmarkSystem.
 */
export function materialFor(key: string): Material {
  return family(key as FamilyId);
}
