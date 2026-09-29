/**
 * Baked-world validators (no GPU), run by `pnpm check` when a bake exists (MOME_WORLD_DIR or data/baked):
 *  - rivers.json v2: per-point level/bed, levels monotone non-increasing downstream except at declared
 *    falls (tolerance 1e-3), `into` resolves to a line id or a lake key
 *  - "rivers win": no landmark stamp moves a river-channel or lake cell unless it lies in an onRiver
 *    allowlisted landmark's footprint (places.json)
 *  - stamp loss: per landmark, the share of its stamp volume the river guard takes back (error above
 *    LOSS_SHARE / LOSS_MIN: the landmark sits on the water — move it, reshape it or allowlist it)
 *  - hydro report (report.json from the bake): ground raised / lowered against the relief outside the
 *    channel cores (with the declared marsh / lake allowances), ribbon edges above the ground, new
 *    cliffs outside declared gorges / falls, confluence joins (see checkHydroReport)
 *  - onRiver only on landmark places
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LandmarkDefinition } from '../../src/landmarks/types.ts';
import type { LakePoly, RiverLine, World } from '../../src/world/World.ts';
import type { BakedManifest } from '../../src/world/WorldSpec.ts';
import { loadWorld, readManifest, readMaskChannel, ROOT } from './baked.ts';

export const LEVEL_TOL = 1e-3;

export interface CheckResult {
  errors: string[];
  warnings: string[];
  info: string[];
}

export function checkRiverLevels(rivers: RiverLine[], lakes: LakePoly[]): CheckResult {
  const r: CheckResult = { errors: [], warnings: [], info: [] };
  const ids = new Set(rivers.map((l) => l.id).filter(Boolean));
  const lakeKeys = new Set(lakes.map((l) => l.key));
  let v2 = 0;
  let rises = 0;
  let fallCount = 0;
  for (const l of rivers) {
    if (!l.level) continue;
    v2++;
    const name = l.id ?? l.name ?? 'river';
    if (l.level.length !== l.points.length || (l.bed && l.bed.length !== l.points.length)) {
      r.errors.push(`rivers: ${name} level/bed length ≠ points`);
      continue;
    }
    const falls = new Set((l.falls ?? []).map((f) => f.index));
    fallCount += falls.size;
    for (let i = 0; i + 1 < l.level.length; i++) {
      if (falls.has(i)) continue;
      if (l.level[i + 1] > l.level[i] + LEVEL_TOL) {
        rises++;
        if (rises <= 8) r.errors.push(`rivers: ${name} level rises downstream at point ${i} (${l.level[i].toFixed(4)} → ${l.level[i + 1].toFixed(4)})`);
      }
    }
    if (l.bed && l.bed.some((b, i) => b > l.level![i] + LEVEL_TOL)) r.errors.push(`rivers: ${name} bed above the water level`);
    if (l.into && !ids.has(l.into) && !lakeKeys.has(l.into)) r.errors.push(`rivers: ${name} drains into unknown '${l.into}'`);
  }
  if (rises > 8) r.errors.push(`rivers: … ${rises - 8} more rising points`);
  if (v2 === 0) r.warnings.push('rivers: v1 bake (no baked levels) — monotone check skipped');
  else r.info.push(`rivers: ${v2} lines with baked levels, monotone except at ${fallCount} declared fall(s)`);
  return r;
}

/**
 * Per landmark: how much of its stamp volume the river guard takes back (composited alone). Beside
 * the water the guard only clamps a stamp to a natural bank, so a landmark losing a large share of its
 * shape sits on / over the water — move it (display offset), reshape its stamps, or allowlist it
 * (places.json onRiver). Error above LOSS_SHARE of the stamp volume and LOSS_MIN units·km².
 */
export const LOSS_SHARE = 0.15;
export const LOSS_MIN = 0.5;

export async function checkStampLoss(world: World, landmarks: LandmarkDefinition[]): Promise<CheckResult & { rows: { id: string; cells: number; share: number; lost: number; maxLost: number }[] }> {
  const r: CheckResult = { errors: [], warnings: [], info: [] };
  const { landmarkStamps } = (await import(pathToFileURL(join(ROOT, 'src/landmarks/LandmarkSystem.ts')).href)) as typeof import('../../src/landmarks/LandmarkSystem.ts');
  const rows: { id: string; cells: number; share: number; lost: number; maxLost: number }[] = [];
  for (const d of landmarks) {
    if (!d.stamps?.length) continue;
    const place = world.places.get(d.placeId);
    if (!place || place.onRiver) continue;
    const loss = world.heights.stampLoss(landmarkStamps(world, [d]));
    const share = loss.lostVolume / Math.max(loss.stampVolume, 1e-9);
    rows.push({ id: d.id, cells: loss.cells, share, lost: loss.lostVolume, maxLost: loss.maxLost });
    if (share > LOSS_SHARE && loss.lostVolume > LOSS_MIN) r.errors.push(`stamps: the river guard takes ${(100 * share).toFixed(0)} % of ${d.id}'s stamp volume (${loss.lostVolume.toFixed(2)} units·km², ${loss.cells} cells, max ${loss.maxLost.toFixed(2)})`);
  }
  const touched = rows.filter((x) => x.cells > 0).sort((a, b) => b.share - a.share);
  r.info.push(`stamps: river guard vs landmark stamps — ${touched.length ? touched.map((x) => `${x.id} ${(100 * x.share).toFixed(1)} % (${x.cells} cells, max ${x.maxLost.toFixed(2)})`).join(', ') : 'no landmark touched'}`);
  return { ...r, rows };
}

/**
 * Hydro gates from the bake's report.json (tools/bake/bake/hydro.py geometry_report). Everything is measured
 * against the relief before rivers and lakes (h_pre), outside the channel cores:
 *  - raised > 0.5 that is not a declared allowance (marsh fills, lake rims / deltas) ≤ RAISE_KM2, and the
 *    carve's own levee raise ≤ RAISE_KM2;
 *  - the allowances themselves within their declared bounds (MARSH_KM2: closed hollows beside a river filled
 *    to its water, marshMaxDepth deep at most; LAKE_RIM_KM2 / LAKE_RIM_MAX: lake deltas and edge lips);
 *  - carve lowered > 4 ≤ LOWER4_KM2 and > 6 ≤ LOWER6_KM2 (excavations), lowered > 2 more than 2 km beyond
 *    a core ≤ LOWER2_FAR_KM2 (troughs); lowered > 2 at the channel's own banks is reported, not gated
 *    (the exaggerated channel widths need their floor);
 *  - ribbon edges more than 0.15 above the ground on ≤ EDGE_SHARE of the ribbon length;
 *  - new > 3-unit neighbour steps outside declared gorges / falls ≤ STEP_CELLS cells;
 *  - confluence joins (end on the parent's core edge, at its level, not floating).
 */
export const RAISE_KM2 = 5;
export const MARSH_KM2 = 650;
export const LAKE_RIM_KM2 = 250;
export const LAKE_RIM_MAX = 5;
export const LOWER4_KM2 = 150;
export const LOWER6_KM2 = 10;
export const LOWER2_FAR_KM2 = 60;
export const EDGE_SHARE = 0.01;
export const STEP_CELLS = 100;
export const JOIN_OFF_KM = 0.5;
export const JOIN_LEVEL = 0.1;
export const JOIN_FLOAT = 0.15;

export function checkHydroReport(dir: string): CheckResult {
  const r: CheckResult = { errors: [], warnings: [], info: [] };
  const m = readManifest(dir) as BakedManifest & { files: { report?: { file: string } } };
  if (!m.files.report) {
    r.warnings.push('bake has no report.json (hydro geometry gates skipped)');
    return r;
  }
  interface Join {
    id: string;
    into: string;
    offKm: number;
    dLevel: number;
    float: number;
  }
  const rep = JSON.parse(readFileSync(join(dir, m.files.report.file), 'utf8')) as {
    riverRaise: { over05Km2: number; over1Km2: number; max: number; at: number[] };
    riverLower?: { over2Km2: number; over2NearKm2: number; over2FarKm2: number; over4Km2: number; over6Km2: number; max: number; at: number[]; worst: { id: string; km2: number }[] };
    marshFill: { over05Km2: number; filledKm2: number; max: number };
    terrain?: { raised05Km2: number; lowered2Km2: number; otherRaised05Km2: number; otherLowered2Km2: number; otherLowered4Km2: number; allowances: { marshRaised05Km2: number; lakeRaised05Km2: number; lakeLowered2Km2: number } };
    newSteps: { over3: number; cells?: number; undeclaredCells?: number; clusters?: number; at: number[][]; worst?: { id: string; km2: number }[] };
    joins: Join[];
    edgeFloat: { totalKm: number; lengthKm?: number; share?: number; lines: { id: string; km: number; max: number }[] };
    cuts: { id: string; max: number; over2Km: number }[];
    lakeRims: { key: string; over05Km2: number; max: number; lowered2Km2?: number }[];
    snap?: { byClass: Record<string, { lines: number; maxKm: number; meanKm: number }> };
  };
  const rr = rep.riverRaise;
  if (rr.over05Km2 > RAISE_KM2) r.errors.push(`hydro: the carve raised ground > 0.5 outside the channel cores on ${rr.over05Km2} km² (gate ${RAISE_KM2}; max ${rr.max} at ${rr.at.join(',')} km)`);
  const t = rep.terrain;
  if (!t || !rep.riverLower) r.errors.push('hydro: report.json predates the terrain / riverLower gates — re-bake');
  else {
    if (t.otherRaised05Km2 > RAISE_KM2) r.errors.push(`hydro: ground raised > 0.5 above the relief outside the cores and outside the declared allowances on ${t.otherRaised05Km2} km² (gate ${RAISE_KM2})`);
    const rl = rep.riverLower;
    if (rl.over4Km2 > LOWER4_KM2) r.errors.push(`hydro: the carve lowered ground > 4 outside the cores on ${rl.over4Km2} km² (gate ${LOWER4_KM2}; max ${rl.max} at ${rl.at.join(',')} km)`);
    if (rl.over6Km2 > LOWER6_KM2) r.errors.push(`hydro: the carve lowered ground > 6 outside the cores on ${rl.over6Km2} km² (gate ${LOWER6_KM2})`);
    if (rl.over2FarKm2 > LOWER2_FAR_KM2) r.errors.push(`hydro: the carve lowered ground > 2 more than 2 km beyond a channel core on ${rl.over2FarKm2} km² (gate ${LOWER2_FAR_KM2}: a trough, not a bank)`);
  }
  // declared allowances
  const marshKm2 = t?.allowances.marshRaised05Km2 ?? rep.marshFill.over05Km2;
  if (marshKm2 > MARSH_KM2) r.errors.push(`hydro: marsh fills raise ground > 0.5 above the relief on ${marshKm2} km² (allowance ${MARSH_KM2})`);
  const marshDepth = (JSON.parse(readFileSync(join(ROOT, 'data/world/world.json'), 'utf8')) as { rivers: { marshMaxDepth?: number } }).rivers.marshMaxDepth ?? 3;
  if (rep.marshFill.max > marshDepth + 0.05) r.errors.push(`hydro: a marsh fill is ${rep.marshFill.max} deep (bound world.json rivers.marshMaxDepth ${marshDepth})`);
  const rimKm2 = rep.lakeRims.reduce((a, l) => a + l.over05Km2, 0);
  if (rimKm2 > LAKE_RIM_KM2) r.errors.push(`hydro: lake rims / deltas raise > 0.5 on ${rimKm2.toFixed(0)} km² (allowance ${LAKE_RIM_KM2})`);
  for (const l of rep.lakeRims) if (l.max > LAKE_RIM_MAX) r.errors.push(`hydro: lake ${l.key} shore raised up to ${l.max} (allowance ${LAKE_RIM_MAX})`);
  // ribbon edges
  const share = rep.edgeFloat.share ?? rep.edgeFloat.totalKm / Math.max(1, rep.edgeFloat.lengthKm ?? 1);
  if (share > EDGE_SHARE) r.errors.push(`hydro: ribbon edges > 0.15 above the ground on ${rep.edgeFloat.totalKm} km = ${(100 * share).toFixed(2)} % of the ribbons (gate ${(100 * EDGE_SHARE).toFixed(0)} %)`);
  // new cliffs
  const cells = rep.newSteps.undeclaredCells ?? rep.newSteps.over3;
  const steps = `${rep.newSteps.over3} neighbour pairs, ${cells} cells outside declared gorges / falls in ${rep.newSteps.clusters ?? '?'} clusters (worst ${(rep.newSteps.worst ?? []).slice(0, 3).map((w) => `${w.id} ${w.km2} km²`).join(', ')}; first at ${rep.newSteps.at.slice(0, 3).map((p) => p.join(',')).join('; ')} km)`;
  if (cells > STEP_CELLS) r.errors.push(`hydro: new > 3-unit steps: ${steps} (gate ${STEP_CELLS} cells)`);
  else if (cells) r.warnings.push(`hydro: new > 3-unit steps (mountain torrents): ${steps}`);
  // joins
  const bad = rep.joins.filter((j) => j.offKm > JOIN_OFF_KM || Math.abs(j.dLevel) > JOIN_LEVEL || j.float > JOIN_FLOAT);
  for (const j of bad.slice(0, 8)) r.errors.push(`hydro: ${j.id} → ${j.into}: end ${j.offKm.toFixed(2)} km off the parent's core edge, Δlevel ${j.dLevel.toFixed(3)}, floats ${j.float.toFixed(2)} above its bed`);
  const worstCut = rep.cuts[0];
  const rl = rep.riverLower;
  r.info.push(`hydro: vs the relief outside the cores — raised > 0.5 ${t?.raised05Km2 ?? '?'} km² (marsh ${t?.allowances.marshRaised05Km2 ?? '?'}, lakes ${t?.allowances.lakeRaised05Km2 ?? '?'}, other ${t?.otherRaised05Km2 ?? '?'}); carve lowered > 2 ${rl?.over2Km2 ?? '?'} km² (${rl?.over2NearKm2 ?? '?'} within 1 km of a core, ${rl?.over2FarKm2 ?? '?'} beyond 2 km), > 4 ${rl?.over4Km2 ?? '?'}, > 6 ${rl?.over6Km2 ?? '?'}; lake shores graded > 2 ${t?.allowances.lakeLowered2Km2 ?? '?'} km²`);
  r.info.push(`hydro: ${rep.joins.length - bad.length}/${rep.joins.length} joins OK, ribbon edges > 0.15 above the ground on ${rep.edgeFloat.totalKm} km (${(100 * share).toFixed(2)} %), deepest cut ${worstCut ? `${worstCut.id} ${worstCut.max}` : '—'}, marsh fills > 0.5 ${rep.marshFill.over05Km2} km², lake rims > 0.5 ${rimKm2.toFixed(0)} km² (max ${Math.max(0, ...rep.lakeRims.map((l) => l.max)).toFixed(2)})`);
  if (rep.snap) r.info.push(`hydro: thalweg snap — ${Object.entries(rep.snap.byClass).map(([c, v]) => `${c} max ${v.maxKm} / mean ${v.meanKm} km`).join(', ')}`);
  return r;
}

/** Cells where the composited stamp layer differs from the baked base on river channels / lakes. */
export async function checkRiversWin(dir: string, world: World): Promise<CheckResult & { moved: number; maxLift: number }> {
  const r: CheckResult = { errors: [], warnings: [], info: [] };
  const hf = world.heights;
  const chan = readMaskChannel(dir, 'water', 0);
  const lake = readMaskChannel(dir, 'water', 1);
  const exempt = [...world.places.values()].filter((p) => p.onRiver).map((p) => ({ x: p.x, z: p.z, r: p.footprintKm ?? 5 }));
  const W = hf.width;
  let moved = 0;
  let maxLift = 0;
  let where = '';
  for (let i = 0; i < hf.data.length; i++) {
    if (chan.data[i] < 128 && lake.data[i] < 128) continue;
    const d = hf.data[i] - hf.base[i];
    if (Math.abs(d) < 1e-4) continue;
    const x = world.spec.xMin + ((i % W) + 0.5) * hf.texel;
    const z = world.spec.zMin + (Math.floor(i / W) + 0.5) * hf.texel;
    if (exempt.some((e) => Math.hypot(x - e.x, z - e.z) < e.r)) continue;
    moved++;
    if (d > maxLift) {
      maxLift = d;
      const [kx, ky] = world.spec.worldToKm(x, z);
      where = `${kx.toFixed(1)},${ky.toFixed(1)} km`;
    }
  }
  if (moved) r.errors.push(`rivers win: ${moved} river/lake cells moved by stamps (max lift ${maxLift.toFixed(3)} at ${where})`);
  else r.info.push(`rivers win: no stamp moves a river channel or lake cell (${hf.guardedCells} guarded cells restored; ${exempt.length} onRiver landmarks exempt)`);
  return { ...r, moved, maxLift };
}

export async function checkBakedWorld(dir: string): Promise<CheckResult> {
  const out: CheckResult = { errors: [], warnings: [], info: [] };
  const m = readManifest(dir);
  const rivers = JSON.parse(readFileSync(join(dir, m.files.rivers.file), 'utf8')) as RiverLine[];
  const lakes = JSON.parse(readFileSync(join(dir, m.files.lakes.file), 'utf8')) as LakePoly[];
  const { world, landmarks } = await loadWorld(dir);
  for (const part of [checkRiverLevels(rivers, lakes), await checkRiversWin(dir, world), await checkStampLoss(world, landmarks), checkHydroReport(dir)]) {
    out.errors.push(...part.errors);
    out.warnings.push(...part.warnings);
    out.info.push(...part.info);
  }
  const places = (JSON.parse(readFileSync(join(ROOT, 'data/world/places.json'), 'utf8')) as { places: { id: string; kind: string; onRiver?: boolean }[] }).places;
  for (const p of places) if (p.onRiver && p.kind !== 'landmark') out.errors.push(`places: ${p.id} has onRiver but is not a landmark`);
  if (!m.files.terrain) out.warnings.push('bake has no terrain.rgba8 (v1) — terrain mask unavailable');
  return out;
}
