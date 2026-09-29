/**
 * Baked-world validators (no GPU), run by `pnpm check` when a bake exists (MOME_WORLD_DIR or data/baked):
 *  - rivers.json v2: per-point level/bed, levels monotone non-increasing downstream except at declared
 *    falls (tolerance 1e-3), `into` resolves to a line id or a lake key
 *  - "rivers win": no landmark stamp moves a river-channel or lake cell unless it lies in an onRiver
 *    allowlisted landmark's footprint (places.json)
 *  - onRiver only on landmark places
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LakePoly, RiverLine } from '../../src/world/World.ts';
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

/** Cells where the composited stamp layer differs from the baked base on river channels / lakes. */
export async function checkRiversWin(dir: string): Promise<CheckResult & { moved: number; maxLift: number }> {
  const r: CheckResult = { errors: [], warnings: [], info: [] };
  const { world } = await loadWorld(dir);
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
  for (const part of [checkRiverLevels(rivers, lakes), await checkRiversWin(dir)]) {
    out.errors.push(...part.errors);
    out.warnings.push(...part.warnings);
    out.info.push(...part.info);
  }
  const places = (JSON.parse(readFileSync(join(ROOT, 'data/world/places.json'), 'utf8')) as { places: { id: string; kind: string; onRiver?: boolean }[] }).places;
  for (const p of places) if (p.onRiver && p.kind !== 'landmark') out.errors.push(`places: ${p.id} has onRiver but is not a landmark`);
  if (!m.files.terrain) out.warnings.push('bake has no terrain.rgba8 (v1) — terrain mask unavailable');
  return out;
}
