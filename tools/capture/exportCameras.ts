/**
 * Export resolved cameras as explicit shots — so another checkout (e.g. the S2 code at a frozen commit)
 * can render EXACTLY the current framings for paired A/B critiques, even if its shot / bookmark schema
 * differs (orbits, aim offsets, new bookmarks):
 *
 *   node --import tsx tools/capture/exportCameras.ts --set s3 --out data/qa/shots.d/ab-cams.json [--prefix ""]
 *
 * Every id of the set (JSON shots and landmark bookmarks) is resolved on the current baked world + stamp
 * layer to `{position, target, fov, roll}` and written with its tod / dayOfYear / weather / fStop /
 * lookOverride. Copy the file into the other checkout's data/qa/shots.d/ and render the ids there.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bakedDir, loadWorld, ROOT } from '../check/baked.ts';
import { loadShots } from './shotList.ts';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const setName = arg('set', 's3')!;
const outFile = arg('out', join('data', 'qa', 'shots.d', 'ab-cams.json'))!;
const prefix = arg('prefix', '')!;
const sets = (JSON.parse(readFileSync(join(ROOT, 'data/qa/sets.json'), 'utf8')) as { sets: Record<string, string[]> }).sets;
const ids = arg('only')?.split(',') ?? sets[setName];
if (!ids) throw new Error(`unknown set ${setName}`);

const { world, landmarks } = await loadWorld(bakedDir());
const { resolveShot } = (await import(pathToFileURL(join(ROOT, 'src/camera/shots.ts')).href)) as typeof import('../../src/camera/shots.ts');
const { bookmarkShots } = await import('../check/probe.ts');
const json = loadShots();
const bms = bookmarkShots(landmarks);

const out: unknown[] = [];
const missing: string[] = [];
for (const id of ids) {
  const js = json.find((s) => s.id === id);
  const bm = bms.find((b) => b.shot.id === id);
  const input = js ?? (bm ? { ...bm.shot, ...bookmarkExtras(bm.def, id) } : null);
  if (!input) {
    missing.push(id);
    continue;
  }
  const r = resolveShot(world, input);
  const round = (v: number[]) => v.map((x) => Math.round(x * 1e4) / 1e4);
  out.push({
    id: prefix + id,
    tod: r.tod,
    ...(r.dayOfYear !== undefined ? { dayOfYear: r.dayOfYear } : {}),
    ...(r.weather ? { weather: r.weather } : {}),
    ...(r.fStop !== undefined ? { fStop: r.fStop } : {}),
    ...(r.tFx !== undefined ? { tFx: r.tFx } : {}),
    ...(r.events ? { events: r.events } : {}),
    ...(r.lookOverride ? { lookOverride: r.lookOverride } : {}),
    camera: { position: round(r.camera.position), target: round(r.camera.target), fov: r.camera.fov, ...(r.camera.roll ? { roll: r.camera.roll } : {}) },
    note: `exported from ${id} (${new Date().toISOString().slice(0, 10)})`,
  });
}

/** bookmark fields the probe's shot conversion leaves out (grade, day, weather) */
function bookmarkExtras(def: (typeof landmarks)[number], id: string) {
  const b = def.bookmarks!.find((x) => x.id === id)!;
  return {
    lookOverride: def.lookOverride ?? null,
    ...(b.dayOfYear !== undefined ? { dayOfYear: b.dayOfYear } : {}),
    ...(b.weather ? { weather: b.weather } : {}),
    ...(b.fStop !== undefined ? { fStop: b.fStop } : {}),
    ...(b.events ? { events: b.events } : {}),
  };
}

writeFileSync(outFile, JSON.stringify({ version: 1, notes: `Explicit cameras exported from set '${setName}' by tools/capture/exportCameras.ts`, shots: out }, null, 1) + '\n');
console.log(`[export] ${out.length} cameras → ${outFile}${missing.length ? ` · missing: ${missing.join(', ')}` : ''}`);
