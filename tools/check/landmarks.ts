/**
 * Landmark build gates (CPU, on the baked world with the stamp layer composited):
 *  - budgets per landmark (LOD0 vs data/tour/shotlist.json, LOD1 ≤ 25 % of LOD0, LOD2 ≤ 4k tris) and in
 *    total (LOD0 ≤ 1.2 M tris, geometry ≤ 48 MB, lights ≤ 4096, authored trees ≤ 2000)
 *  - seating: every recorded contact sits on the ground (no floating, ≤ 50 % buried)
 *  - structure: valid material keys, no size boosts, GLB manifest / CREDITS coverage
 *  - determinism: building every landmark twice gives identical geometry hashes
 *
 * W0a stub: reports build stats only. Implemented with kit v2 (W1).
 */
import type { World } from '../../src/world/World.ts';
import type { LandmarkDefinition } from '../../src/landmarks/types.ts';
import type { CheckResult } from './world.ts';

export async function checkLandmarks(world: World, landmarks: LandmarkDefinition[]): Promise<CheckResult> {
  const out: CheckResult = { errors: [], warnings: [], info: [] };
  const { buildLandmarks } = await import('../../src/landmarks/build.ts');
  const built = await buildLandmarks(world, landmarks, { geometry: false });
  const tris = built.reduce((s, b) => s + (b.stats.tris[0] ?? 0), 0);
  const lights = built.reduce((s, b) => s + b.lights.length, 0);
  const trees = built.reduce((s, b) => s + b.trees.length, 0);
  out.info.push(`landmarks: ${built.length} built, LOD0 ${Math.round(tris / 1000)}k tris, ${lights} lights, ${trees} authored trees`);
  return out;
}
