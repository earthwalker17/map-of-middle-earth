/**
 * Landmark build gates (CPU, on the baked world with the stamp layer composited), part of `pnpm check`:
 *  - budgets per landmark: LOD0 tris ≤ data/tour/shotlist.json `budget.lod0Tris`, lights ≤ `budget.lights`,
 *    LOD1 ≤ 25 % of LOD0, coarsest LOD ≤ 4k tris
 *  - totals: LOD0 ≤ 1.2 M tris, geometry ≤ 48 MB, lights ≤ 4096, authored trees ≤ 2000
 *  - seating: every recorded contact sits on the ground — floating `baseY − groundY ≤ max(0.05, 0.1·h)`,
 *    buried `groundY − baseY ≤ 0.5·h` (tier A: error, tier B: warning)
 *  - structure: every geometry key is a shared material key ('structure' | 'glow')
 *  - determinism: building every landmark twice gives identical geometry hashes (error)
 *
 * Rebuilt vs legacy rule: a landmark counts as REBUILT (kit v2, hard gates) once its definition declares
 * `lodPx` — the rebuild agent tunes the LOD thresholds at the landmark's hero distance, so declaring them
 * is the explicit "this landmark is v2" switch. Until then (S1 proxies through the v1-compatible kit API)
 * budget / LOD overruns are warnings.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { World } from '../../src/world/World.ts';
import type { LandmarkDefinition } from '../../src/landmarks/types.ts';
import type { BuiltLandmark } from '../../src/landmarks/records.ts';
import type { CheckResult } from './world.ts';

const ROOT = process.cwd();
const LIMITS = { lod1Share: 0.25, coarsestTris: 4000, lod0Total: 1_200_000, bytesTotal: 48 * 1024 * 1024, lights: 4096, trees: 2000 };

interface Budget {
  minFeatureKm: number;
  lod0Tris: number;
  lights: number;
}

export async function checkLandmarks(world: World, landmarks: LandmarkDefinition[]): Promise<CheckResult> {
  const out: CheckResult = { errors: [], warnings: [], info: [] };
  const shotlist = JSON.parse(readFileSync(join(ROOT, 'data/tour/shotlist.json'), 'utf8')) as { landmarks: Record<string, { budget?: Budget }> };
  const { buildLandmarks, buildStats } = await import('../../src/landmarks/build.ts');
  const { geometryHash } = await import('../../src/landmarks/kit/geom.ts');
  const { MATERIAL_KEYS } = await import('../../src/materials/families.ts');

  const hashOf = (b: BuiltLandmark): number => {
    let h = 0x811c9dc5;
    b.lods.forEach((lod) => {
      for (const key of [...lod.keys()].sort()) h = geometryHash(lod.get(key)!, h ^ key.length);
    });
    return h >>> 0;
  };
  const dispose = (list: BuiltLandmark[]) => {
    for (const b of list) for (const lod of b.lods) for (const g of lod.values()) g.dispose();
  };

  const t0 = performance.now(); // diagnostics
  const built = await buildLandmarks(world, landmarks);
  const buildMs = Math.round(performance.now() - t0);
  const aoMs = Math.round(buildStats.aoMs);

  let lod0 = 0;
  let lod1 = 0;
  let lodN = 0;
  let bytes = 0;
  let lights = 0;
  let trees = 0;
  let contacts = 0;
  let rebuilt = 0;
  const hashes = new Map<string, number>();
  for (const b of built) {
    const v2 = !!b.def.lodPx;
    if (v2) rebuilt++;
    const sev = v2 ? out.errors : out.warnings;
    const tag = v2 ? '' : ' (legacy proxy)';
    const budget = shotlist.landmarks[b.id]?.budget;
    const t = b.stats.tris;
    const t0l = t[0] ?? 0;
    lod0 += t0l;
    lod1 += t[1] ?? t0l;
    lodN += t[t.length - 1] ?? 0;
    bytes += b.stats.bytes;
    lights += b.lights.length;
    trees += b.trees.length;
    contacts += b.contacts.length;
    if (!budget) out.warnings.push(`landmarks: ${b.id} has no budget in data/tour/shotlist.json`);
    else {
      if (t0l > budget.lod0Tris) sev.push(`landmarks: ${b.id} LOD0 ${t0l} tris > budget ${budget.lod0Tris}${tag}`);
      if (b.lights.length > budget.lights) sev.push(`landmarks: ${b.id} ${b.lights.length} lights > budget ${budget.lights}${tag}`);
    }
    const reuse = b.lods.length > 1 && b.lods[1] === b.lods[0] ? ', LOD1 reuses LOD0 — no part below 2 % of the diagonal' : '';
    if (t.length > 1 && t[1] > LIMITS.lod1Share * t0l) sev.push(`landmarks: ${b.id} LOD1 ${t[1]} tris > ${LIMITS.lod1Share * 100} % of LOD0 (${t0l}${reuse})${tag}`);
    if (t.length && t[t.length - 1] > LIMITS.coarsestTris) sev.push(`landmarks: ${b.id} coarsest LOD${t.length - 1} ${t[t.length - 1]} tris > ${LIMITS.coarsestTris}${tag}`);
    for (const lod of b.lods) for (const key of lod.keys()) if (!(MATERIAL_KEYS as readonly string[]).includes(key)) out.errors.push(`landmarks: ${b.id} geometry key '${key}' is not a shared material key`);
    // seating
    let floatN = 0;
    let buryN = 0;
    let worstF = 0;
    let worstB = 0;
    for (const c of b.contacts) {
      const fl = c.baseY - c.groundY;
      const tol = Math.max(0.05, 0.1 * c.h);
      if (fl > tol) {
        floatN++;
        worstF = Math.max(worstF, fl);
      }
      if (-fl > 0.5 * c.h) {
        buryN++;
        worstB = Math.max(worstB, -fl / c.h);
      }
    }
    const seatSev = b.def.tier === 'A' ? out.errors : out.warnings;
    if (floatN) seatSev.push(`landmarks: ${b.id} ${floatN}/${b.contacts.length} contacts float (worst ${(worstF * 1000).toFixed(0)} m above the ground)`);
    if (buryN) seatSev.push(`landmarks: ${b.id} ${buryN}/${b.contacts.length} contacts buried > 50 % (worst ${(worstB * 100).toFixed(0)} % of the part height)`);
    hashes.set(b.id, hashOf(b));
  }
  if (lod0 > LIMITS.lod0Total) out.errors.push(`landmarks: total LOD0 ${lod0} tris > ${LIMITS.lod0Total}`);
  if (bytes > LIMITS.bytesTotal) out.errors.push(`landmarks: geometry ${(bytes / 1048576).toFixed(1)} MB > ${LIMITS.bytesTotal / 1048576} MB`);
  if (lights > LIMITS.lights) out.errors.push(`landmarks: ${lights} lights > ${LIMITS.lights}`);
  if (trees > LIMITS.trees) out.errors.push(`landmarks: ${trees} authored trees > ${LIMITS.trees}`);
  dispose(built);

  // determinism: a second, independent build must hash identically
  const again = await buildLandmarks(world, landmarks);
  let mismatch = 0;
  for (const b of again) {
    if (hashes.get(b.id) !== hashOf(b)) {
      mismatch++;
      out.errors.push(`landmarks: ${b.id} geometry differs between two builds (non-deterministic kit / AO)`);
    }
  }
  dispose(again);

  out.info.push(
    `landmarks: ${built.length} built (${rebuilt} rebuilt v2), LOD0 ${Math.round(lod0 / 1000)}k tris (LOD1 ${Math.round(lod1 / 1000)}k, coarsest ${Math.round(lodN / 1000)}k), ` +
      `geometry ${(bytes / 1048576).toFixed(1)} MB, ${lights} lights, ${trees} authored trees, ${contacts} contacts, build ${buildMs} ms (AO ${aoMs} ms), ` +
      `determinism ${mismatch ? 'FAILED' : 'identical'}`,
  );
  return out;
}
