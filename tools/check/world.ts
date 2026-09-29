/**
 * Baked-world validators (no GPU), run by `pnpm check` when a bake exists (MOME_WORLD_DIR or data/baked):
 *  - rivers.json v2: per-point level/bed, levels monotone non-increasing downstream except at declared
 *    falls (tolerance 1e-3), `into` resolves to a line id or a lake key
 *  - "rivers win": no landmark stamp moves a river-channel or lake cell unless it lies in an onRiver
 *    allowlisted landmark's footprint (places.json)
 *  - stamp loss: per landmark, the share of its stamp volume the river guard takes back (error above
 *    LOSS_SHARE / LOSS_MIN: the landmark sits on the water — move it, reshape it or allowlist it)
 *  - hydro report (report.json from the bake): ground raised outside the channel cores, confluence joins
 *    (end on the parent's core edge, at its level, not floating), new cliffs (warning)
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

/** Hydro gates from the bake's report.json (tools/bake/bake/hydro.py geometry_report). */
export const RAISE_KM2 = 5;
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
    newSteps: { over3: number; at: number[][] };
    joins: Join[];
    edgeFloat: { totalKm: number };
    cuts: { id: string; max: number; over2Km: number }[];
    lakeRims: { key: string; over05Km2: number; max: number }[];
  };
  const rr = rep.riverRaise;
  if (rr.over05Km2 > RAISE_KM2) r.errors.push(`hydro: ground raised > 0.5 outside the channel cores on ${rr.over05Km2} km² (gate ${RAISE_KM2}; max ${rr.max} at ${rr.at.join(',')} km)`);
  const bad = rep.joins.filter((j) => j.offKm > JOIN_OFF_KM || Math.abs(j.dLevel) > JOIN_LEVEL || j.float > JOIN_FLOAT);
  for (const j of bad.slice(0, 8)) r.errors.push(`hydro: ${j.id} → ${j.into}: end ${j.offKm.toFixed(2)} km off the parent's core edge, Δlevel ${j.dLevel.toFixed(3)}, floats ${j.float.toFixed(2)} above its bed`);
  if (rep.newSteps.over3) r.warnings.push(`hydro: ${rep.newSteps.over3} new > 3-unit neighbour steps (mountain torrents), first at ${rep.newSteps.at.map((p) => p.join(',')).join('; ')} km`);
  const worstCut = rep.cuts[0];
  r.info.push(`hydro: raised > 0.5 outside cores ${rr.over05Km2} km² (> 1: ${rr.over1Km2}), ${rep.joins.length - bad.length}/${rep.joins.length} joins OK, ribbon edges > 0.15 above the ground on ${rep.edgeFloat.totalKm} km, deepest cut ${worstCut ? `${worstCut.id} ${worstCut.max}` : '—'}, lake rims > 0.5 on ${rep.lakeRims.reduce((a, l) => a + l.over05Km2, 0).toFixed(0)} km²`);
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
