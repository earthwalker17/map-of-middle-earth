/**
 * Landmark build gates (CPU, on the baked world with the stamp layer composited), part of `pnpm check`:
 *  - budgets per landmark: LOD0 tris ≤ data/tour/shotlist.json `budget.lod0Tris`, lights ≤ `budget.lights`,
 *    LOD1 ≤ 25 % of LOD0, coarsest LOD ≤ 4k tris
 *  - totals: LOD0 ≤ 1.2 M tris, geometry ≤ 48 MB, lights ≤ 4096, authored trees ≤ 2000
 *  - seating: every recorded contact sits on the ground — floating `baseY − groundY ≤ max(0.05, 0.1·h)`,
 *    buried `groundY − baseY ≤ max(0.5·h, SINK)` — the kit sinks every part SINK (20 m) into the ground, so a
 *    thin ground decal sunk by that much is seated, not buried (tier A: error, tier B: warning)
 *  - structure: every geometry key is a shared material key ('structure' | 'glow')
 *  - determinism: building every landmark twice gives identical geometry hashes (error)
 *  - Blender GLB models (`ModelDecl`): the file exists in public/models/ with a matching entry and sha256 in
 *    public/models/manifest.json and is covered by the CREDITS.md "Models" section (errors); a changed build
 *    script / tools/blender/lib.py (script hash) or declared bounds smaller than the built model → warning;
 *    the manifest's per-LOD tris per instance (shared nodes + the instance's `node` variant, which must
 *    exist in the manifest) join the budget gates (Node never parses GLBs)
 *
 * Rebuilt vs legacy rule: a landmark counts as REBUILT (kit v2, hard gates) once its data/tour/shotlist.json
 * entry has `"status": "s3"` (the same switch makes its bookmark gates strict, tools/check/bookmarks.ts) or
 * its definition declares `lodPx`. Until then (S1 proxies through the v1-compatible kit API) budget / LOD
 * overruns are warnings.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { World } from '../../src/world/World.ts';
import type { LandmarkDefinition } from '../../src/landmarks/types.ts';
import type { BuiltLandmark } from '../../src/landmarks/records.ts';
import type { CheckResult } from './world.ts';

const ROOT = process.cwd();
const LIMITS = { lod1Share: 0.25, coarsestTris: 4000, lod0Total: 1_200_000, bytesTotal: 48 * 1024 * 1024, lights: 4096, trees: 2000, forestTrees: 30000 };

interface Budget {
  minFeatureKm: number;
  lod0Tris: number;
  lights: number;
}

export async function checkLandmarks(world: World, landmarks: LandmarkDefinition[]): Promise<CheckResult> {
  const out: CheckResult = { errors: [], warnings: [], info: [] };
  const shotlist = JSON.parse(readFileSync(join(ROOT, 'data/tour/shotlist.json'), 'utf8')) as { landmarks: Record<string, { budget?: Budget; status?: string }> };
  const { buildLandmarks, buildStats } = await import('../../src/landmarks/build.ts');
  const { geometryHash } = await import('../../src/landmarks/kit/geom.ts');
  const { MATERIAL_KEYS } = await import('../../src/materials/families.ts');
  const { SINK } = await import('../../src/landmarks/kit/ProxyKit.ts');

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
    const v2 = shotlist.landmarks[b.id]?.status === 's3' || !!b.def.lodPx;
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
      if (-fl > Math.max(0.5 * c.h, SINK + 1e-6)) {
        buryN++;
        worstB = Math.max(worstB, -fl / c.h);
      }
    }
    const seatSev = b.def.tier === 'A' ? out.errors : out.warnings;
    if (floatN) seatSev.push(`landmarks: ${b.id} ${floatN}/${b.contacts.length} contacts float (worst ${(worstF * 1000).toFixed(0)} m above the ground)`);
    if (buryN) seatSev.push(`landmarks: ${b.id} ${buryN}/${b.contacts.length} contacts buried > max(50 % of the part, SINK) (worst ${(worstB * 100).toFixed(0)} % of the part height)`);
    hashes.set(b.id, hashOf(b));
  }
  if (lod0 > LIMITS.lod0Total) out.errors.push(`landmarks: total LOD0 ${lod0} tris > ${LIMITS.lod0Total}`);
  if (bytes > LIMITS.bytesTotal) out.errors.push(`landmarks: geometry ${(bytes / 1048576).toFixed(1)} MB > ${LIMITS.bytesTotal / 1048576} MB`);
  if (lights > LIMITS.lights) out.errors.push(`landmarks: ${lights} lights > ${LIMITS.lights}`);
  if (trees > LIMITS.trees) out.errors.push(`landmarks: ${trees} authored trees > ${LIMITS.trees} (masses of trees belong in \`forests\`)`);
  // landmark forests at full quality density (the vegetation system places them; preview holds fewer)
  const { landmarkForestRecords } = await import('../../src/vegetation/forests.ts');
  const forestTrees = landmarkForestRecords(world, built.flatMap((b) => b.forests), 1).count;
  if (forestTrees > LIMITS.forestTrees) out.errors.push(`landmarks: ${forestTrees} forest tree records > ${LIMITS.forestTrees}`);
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

  // Blender GLB models: manifest / sha256 / CREDITS / staleness / budgets with the manifest tris
  const { readManifest, scriptHash, sha256 } = await import('../blender/manifest.ts');
  const manifest = readManifest(ROOT);
  const credits = readFileSync(join(ROOT, 'CREDITS.md'), 'utf8');
  const modelsSection = /^## Models\b([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(credits)?.[1] ?? '';
  let models = 0;
  let modelBytes = 0;
  for (const d of landmarks) {
    if (!d.model) continue;
    models++;
    const file = d.model.file;
    const path = join(ROOT, 'public/models', file);
    const entry = manifest.models.find((m) => m.file === file);
    if (!existsSync(path)) {
      out.errors.push(`models: ${d.id} public/models/${file} is missing (pnpm models)`);
      continue;
    }
    if (!entry) {
      out.errors.push(`models: ${d.id} ${file} has no entry in public/models/manifest.json (pnpm models)`);
      continue;
    }
    const bytes = readFileSync(path);
    modelBytes += bytes.length;
    const h = sha256(bytes);
    if (h !== entry.sha256) out.errors.push(`models: ${file} sha256 ${h.slice(0, 12)}… ≠ manifest ${entry.sha256.slice(0, 12)}… (rebuild with pnpm models --only ${entry.id})`);
    if (!modelsSection.includes(file) || !modelsSection.includes('tools/blender')) out.errors.push(`models: ${file} is not covered by the CREDITS.md "Models" section (original, generated by tools/blender/*.py)`);
    if (!existsSync(join(ROOT, entry.script))) out.errors.push(`models: ${file} build script ${entry.script} is missing`);
    else if (scriptHash(ROOT, entry.script) !== entry.scriptSha256) out.warnings.push(`models: ${file} is stale — ${entry.script} or tools/blender/lib.py changed since it was built (pnpm models --only ${entry.id})`);
    const bk = d.model.boundsKm;
    if (bk.r < entry.boundsKm.r - 1e-3 || bk.h < entry.boundsKm.h - 1e-3) out.warnings.push(`models: ${d.id} ModelDecl.boundsKm {r ${bk.r}, h ${bk.h}} is smaller than the built model {r ${entry.boundsKm.r}, h ${entry.boundsKm.h}} (LOD / probe bounds too small)`);
    // budgets: kit LODs (built in Node) + per instance the manifest's shared tris + its variant's tris
    const insts: { node?: string }[] = d.model.instances?.length ? d.model.instances : [{}];
    const n = insts.length;
    const variantNames = Object.keys(entry.variants ?? {});
    for (const inst of insts)
      if (inst.node && !entry.variants?.[inst.node])
        out.errors.push(`models: ${d.id} instance node '${inst.node}' is not a variant of ${file} (manifest variants: ${variantNames.join(', ') || 'none'})`);
    // a model built with variants (heads) but placed without a node gets only the shared nodes (a body)
    const bare = insts.filter((inst) => !inst.node).length;
    if (variantNames.length && bare) out.warnings.push(`models: ${d.id} ${bare} instance(s) of ${file} name no variant node — they get the shared nodes only (variants: ${variantNames.join(', ')})`);
    const kt = built.find((b) => b.id === d.id)?.stats.tris ?? [];
    const perInst = (L: number) => insts.reduce((s, inst) => s + entry.tris[Math.min(L, 2)] + (inst.node ? (entry.variants?.[inst.node]?.[Math.min(L, 2)] ?? 0) : 0), 0);
    const lv = (L: number) => (kt.length ? kt[Math.min(L, kt.length - 1)] : 0) + perInst(L);
    const v2 = shotlist.landmarks[d.id]?.status === 's3' || !!d.lodPx;
    const sev = v2 ? out.errors : out.warnings;
    const budget = shotlist.landmarks[d.id]?.budget;
    const [m0, m1, m2] = [lv(0), lv(1), lv(2)];
    if (budget && m0 > budget.lod0Tris) sev.push(`models: ${d.id} LOD0 ${m0} tris (kit + ${n} instance(s) ${perInst(0)}) > budget ${budget.lod0Tris}`);
    if (m1 > LIMITS.lod1Share * m0) sev.push(`models: ${d.id} LOD1 ${m1} tris > ${LIMITS.lod1Share * 100} % of LOD0 ${m0}`);
    if (m2 > LIMITS.coarsestTris) sev.push(`models: ${d.id} coarsest LOD ${m2} tris > ${LIMITS.coarsestTris}`);
  }
  for (const m of manifest.models) if (!landmarks.some((d) => d.model?.file === m.file)) out.warnings.push(`models: public/models/${m.file} is built but no landmark declares it`);

  out.info.push(
    `landmarks: ${built.length} built (${rebuilt} rebuilt v2), LOD0 ${Math.round(lod0 / 1000)}k tris (LOD1 ${Math.round(lod1 / 1000)}k, coarsest ${Math.round(lodN / 1000)}k), ` +
      `geometry ${(bytes / 1048576).toFixed(1)} MB, ${lights} lights, ${trees} authored trees, ${forestTrees} forest tree records, ${contacts} contacts, build ${buildMs} ms (AO ${aoMs} ms), ` +
      `determinism ${mismatch ? 'FAILED' : 'identical'}` +
      (models ? `, ${models} GLB model(s) ${(modelBytes / 1048576).toFixed(2)} MB` : ''),
  );
  return out;
}
