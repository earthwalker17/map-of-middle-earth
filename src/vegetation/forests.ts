import { hash32, rand, valueNoise } from '../core/rng.ts';
import type { ForestArea, ForestRecord, V2 } from '../landmarks/records.ts';
import type { World } from '../world/World.ts';
import { pushForestTree } from './authored.ts';
import { InstanceList, WorldSampler } from './placement.ts';

/**
 * Landmark forests (`ForestDecl` → `ForestRecord`, world space) → instance records that join the placed
 * vegetation (VegetationSystem.place: chunked, LOD-capped, drawn like the natural forests). A jittered grid
 * aligned to world cells of 1/√(density · quality density) km — so preview holds fewer trees than final,
 * exactly like the natural forests — keeps a candidate with probability
 *   (inside distance / edgeKm, capped at 1) × clump stand noise,
 * never inside an `avoid` clearing, never in a river channel, a lake or the sea, never on slopes steeper than `maxSlopeDeg`. Species by
 * share; crowns / heights / colours from the kind recipes (authored.ts), conifers as two-tier firs.
 * Pure function of (world, forests, density).
 */
export function landmarkForestRecords(world: World, forests: readonly ForestRecord[], density: number): InstanceList {
  const out = new InstanceList();
  if (!forests.length) return out;
  const sampler = new WorldSampler(world);
  const dens = Math.min(1, Math.max(0.1, density));
  for (const f of forests) {
    const perKm2 = f.density * dens;
    if (!(perKm2 > 0) || !f.species.length) continue;
    const cell = 1 / Math.sqrt(perKm2);
    const [x0, z0, x1, z1] = areaBounds(f.area);
    const cosMax = Math.cos((f.maxSlopeDeg * Math.PI) / 180);
    const shareSum = f.species.reduce((a, sp) => a + Math.max(0, sp.share), 0) || 1;
    const clumpSeed = f.seed % 65521;
    for (let j = Math.floor(z0 / cell); j <= Math.ceil(z1 / cell); j++)
      for (let i = Math.floor(x0 / cell); i <= Math.ceil(x1 / cell); i++) {
        const id = hash32(f.seed, i, j);
        const x = (i + rand(f.seed, id, 1)) * cell;
        const z = (j + rand(f.seed, id, 2)) * cell;
        const d = insideDistance(f.area, x, z);
        if (d <= 0) continue;
        if (f.avoid.some((c) => Math.hypot(x - c.at[0], z - c.at[1]) < c.r)) continue;
        let p = Math.min(1, d / Math.max(1e-3, f.edgeKm));
        if (f.clump && f.clump.amount > 0) {
          const v = valueNoise(x / f.clump.scaleKm, z / f.clump.scaleKm, clumpSeed);
          p *= 1 - f.clump.amount * (1 - smooth(0.3, 0.62, v));
        }
        if (rand(f.seed, id, 3) >= p) continue;
        // dry land only: no river channel, lake or sea; not on cliffs
        const ground = world.heights.sample(x, z);
        if (sampler.water(x, z, 0) > 0.5 || sampler.water(x, z, 1) > 0.5 || ground <= 0.02 || ground < f.minY) continue;
        if (world.heights.normal(x, z).y < cosMax) continue;
        // species by share
        let u = rand(f.seed, id, 4) * shareSum;
        let sp = f.species[f.species.length - 1];
        for (const s of f.species) {
          u -= Math.max(0, s.share);
          if (u < 0) {
            sp = s;
            break;
          }
        }
        const crown = sp.crownKm[0] + (sp.crownKm[1] - sp.crownKm[0]) * rand(f.seed, id, 5);
        const heightKm = sp.heightFactor ? crown * (sp.heightFactor[0] + (sp.heightFactor[1] - sp.heightFactor[0]) * rand(f.seed, id, 6)) : undefined;
        const color = sp.colors?.length ? sp.colors[Math.floor(rand(f.seed, id, 7) * sp.colors.length) % sp.colors.length] : undefined;
        pushForestTree(out, { x, z, kind: sp.kind, crownKm: crown, heightKm, color, yaw: rand(f.seed, id, 8) * Math.PI * 2, id }, f.seed);
      }
  }
  return out;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** world bounding box [x0, z0, x1, z1] of a forest area */
export function areaBounds(a: ForestArea): [number, number, number, number] {
  if ('circle' in a) return [a.circle.at[0] - a.circle.r, a.circle.at[1] - a.circle.r, a.circle.at[0] + a.circle.r, a.circle.at[1] + a.circle.r];
  if ('annulus' in a) return [a.annulus.at[0] - a.annulus.r1, a.annulus.at[1] - a.annulus.r1, a.annulus.at[0] + a.annulus.r1, a.annulus.at[1] + a.annulus.r1];
  const pts = 'polygon' in a ? a.polygon : a.band.path;
  const pad = 'band' in a ? a.band.halfWidth : 0;
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  return [Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) + pad, Math.max(...zs) + pad];
}

function segDist(px: number, pz: number, a: V2, b: V2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2)) : 0;
  return Math.hypot(a[0] + t * dx - px, a[1] + t * dz - pz);
}

/** distance from (x, z) to the area's boundary, positive inside, ≤ 0 outside (km) */
export function insideDistance(a: ForestArea, x: number, z: number): number {
  if ('circle' in a) return a.circle.r - Math.hypot(x - a.circle.at[0], z - a.circle.at[1]);
  if ('annulus' in a) {
    const r = Math.hypot(x - a.annulus.at[0], z - a.annulus.at[1]);
    return Math.min(r - a.annulus.r0, a.annulus.r1 - r);
  }
  if ('band' in a) {
    const p = a.band.path;
    let d = Infinity;
    for (let k = 1; k < p.length; k++) d = Math.min(d, segDist(x, z, p[k - 1], p[k]));
    return a.band.halfWidth - d;
  }
  const r = a.polygon;
  let inside = false;
  let d = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    d = Math.min(d, segDist(x, z, r[j], r[i]));
  }
  return inside ? d : -d;
}
