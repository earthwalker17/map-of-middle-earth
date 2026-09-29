/**
 * Static project validators (no GPU):  pnpm check
 *  - places: display offsets within the maximum, no overlapping landmark footprints
 *  - landmarks: every definition folder matches a place; every Tier-A place has a definition
 *  - assets: every shipped file in public/ is covered by CREDITS.md
 *  - baked world (when a bake exists; MOME_WORLD_DIR overrides data/baked): monotone baked river levels,
 *    no stamp moves a river channel / lake ("rivers win", onRiver allowlist) — see world.ts
 * Exit code 1 on any error.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { bakedDir, hasBake } from './baked.ts';
import { checkBakedWorld } from './world.ts';

const ROOT = process.cwd();
const errors: string[] = [];
const warnings: string[] = [];

interface Place {
  id: string;
  kind: string;
  tier?: 'A' | 'B';
  canonical: [number, number];
  displayOffsetKm?: [number, number];
  footprintKm?: number;
  parent?: string;
}

// ------------------------------------------------------------------ places
const placesDoc = JSON.parse(readFileSync(join(ROOT, 'data/world/places.json'), 'utf8')) as {
  maxDisplayOffsetKm: number;
  places: Place[];
};
const places = placesDoc.places;
const byId = new Map(places.map((p) => [p.id, p]));
const landmarks = places.filter((p) => p.kind === 'landmark');
for (const p of landmarks) {
  const off = p.displayOffsetKm ?? [0, 0];
  const d = Math.hypot(off[0], off[1]);
  if (d > placesDoc.maxDisplayOffsetKm) errors.push(`places: ${p.id} display offset ${d.toFixed(1)} km > max ${placesDoc.maxDisplayOffsetKm}`);
  if (!p.footprintKm) errors.push(`places: landmark ${p.id} has no footprintKm`);
}
const disp = (p: Place): [number, number] => [p.canonical[0] + (p.displayOffsetKm?.[0] ?? 0), p.canonical[1] + (p.displayOffsetKm?.[1] ?? 0)];
let overlaps = 0;
for (let i = 0; i < landmarks.length; i++)
  for (let j = i + 1; j < landmarks.length; j++) {
    const a = landmarks[i];
    const b = landmarks[j];
    const [ax, ay] = disp(a);
    const [bx, by] = disp(b);
    const d = Math.hypot(ax - bx, ay - by);
    const need = (a.footprintKm ?? 0) + (b.footprintKm ?? 0);
    if (d < need) {
      overlaps++;
      errors.push(`overlap: ${a.id} ↔ ${b.id} ${d.toFixed(1)} km apart < footprints ${need.toFixed(1)} km`);
    }
  }

// ------------------------------------------------------------------ landmark definitions
const lmDir = join(ROOT, 'src/landmarks');
const defs = readdirSync(lmDir).filter((d) => existsSync(join(lmDir, d, 'index.ts')));
const defPlaces = new Set<string>();
for (const d of defs) {
  const src = readFileSync(join(lmDir, d, 'index.ts'), 'utf8');
  const id = /id:\s*'([^']+)'/.exec(src)?.[1];
  const placeId = /placeId:\s*'([^']+)'/.exec(src)?.[1];
  const tier = /tier:\s*'([AB])'/.exec(src)?.[1];
  if (id !== d) errors.push(`landmarks: folder ${d} declares id '${id}'`);
  if (!placeId || !byId.has(placeId)) errors.push(`landmarks: ${d} placeId '${placeId}' not in places.json`);
  else {
    defPlaces.add(placeId);
    const p = byId.get(placeId)!;
    if (p.tier && tier && p.tier !== tier) warnings.push(`landmarks: ${d} tier ${tier} ≠ places.json tier ${p.tier}`);
  }
  if (!/annotation:\s*\{/.test(src)) errors.push(`landmarks: ${d} has no annotation`);
}
for (const p of landmarks) if (!defPlaces.has(p.id)) (p.tier === 'A' ? errors : warnings).push(`landmarks: place ${p.id} (tier ${p.tier}) has no definition`);

// ------------------------------------------------------------------ assets vs credits
const credits = readFileSync(join(ROOT, 'CREDITS.md'), 'utf8').toLowerCase();
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
for (const file of walk(join(ROOT, 'public'))) {
  const rel = relative(join(ROOT, 'public'), file).replace(/\\/g, '/');
  if (rel.endsWith('_manifest.json')) continue;
  const top = rel.split('/').slice(0, 2).join('/');
  const key = rel.split('/')[1]?.toLowerCase() ?? rel.toLowerCase();
  if (!credits.includes(key)) errors.push(`assets: public/${rel} not covered by CREDITS.md (looked for '${key}' from ${top})`);
}

// ------------------------------------------------------------------ baked world
const baked = bakedDir();
const bakedInfo: string[] = [];
if (hasBake(baked)) {
  const r = await checkBakedWorld(baked);
  errors.push(...r.errors);
  warnings.push(...r.warnings);
  bakedInfo.push(...r.info);
} else warnings.push(`baked world: no bake at ${baked} — river / stamp checks skipped`);

// ------------------------------------------------------------------ report
console.log(`[check] places: ${places.length} (${landmarks.length} landmarks), overlaps: ${overlaps}`);
console.log(`[check] landmark definitions: ${defs.length}`);
for (const i of bakedInfo) console.log(`[check] ${i}`);
for (const w of warnings) console.warn(`  warn  ${w}`);
for (const e of errors) console.error(`  ERROR ${e}`);
console.log(errors.length ? `[check] FAILED (${errors.length} errors)` : '[check] OK');
process.exit(errors.length ? 1 : 0);
