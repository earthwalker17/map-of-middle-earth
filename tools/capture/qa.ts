/**
 * QA sheets — bounded and batched for the 7.6 GB host:
 *
 *   node --import tsx tools/capture/qa.ts [--set s1] [--only id1,id2] [--batch 8] [--spp 4]
 *        [--w 1600 --h 900] [--quality review] [--tod 17] [--label "S1 baseline"]
 *
 * Every batch of ≤ N shots runs in a fresh Vite + Chrome (tools/capture/shots.ts --batch k), so peak
 * memory is bounded by one batch. Sets live in data/qa/sets.json (default `s1`: overviews, regions
 * and landmark close-ups). Composes into renders/qa/<stamp>/ (mirrored to renders/qa/latest/):
 *  - contact.png              all shots in a labelled grid
 *  - compare-<shot>.png        the render next to reference images: the shot's `compare` list, then
 *                              reference/manifest.json items whose `subject` is the shot's place /
 *                              landmark (one per kind: film → bigature → photo → concept)
 *  - blind/ + contact-blind.png  anonymised copies of the `blind` set (or `--blind <set>`) for
 *                              recognizability critics (the key is blind-key.json in the run folder,
 *                              never inside blind/)
 * Reference images are gitignored: agent worktrees point MOME_REFERENCE_DIR at the main checkout's
 * reference/ folder (manifest paths `reference/…` resolve against it).
 *  - manifest.json             merged per-batch manifests (timings, memory, footprints)
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { loadShots } from './shotList.ts';
import { fmtMem, hostMemory } from './host.ts';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const d = new Date();
const p2 = (n: number) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
const out = join('renders', 'qa', stamp);
const shotsDir = join(out, 'shots');
mkdirSync(shotsDir, { recursive: true });

const shots = loadShots();
const setsDoc = JSON.parse(readFileSync(join('data', 'qa', 'sets.json'), 'utf8')) as { sets: Record<string, string[]> };
const setName = arg('set', 's1')!;
const only = arg('only')?.split(',').filter(Boolean);
if (!only && !setsDoc.sets[setName]) throw new Error(`unknown set '${setName}' (data/qa/sets.json: ${Object.keys(setsDoc.sets).join(', ')})`);
const ids = only ?? setsDoc.sets[setName];
const batchSize = Math.max(1, Number(arg('batch', '8')));
const label = arg('label') ?? (only ? 'custom' : setName);

// ------------------------------------------------------------------ render in bounded batches
const common = ['--out', shotsDir, '--no-latest', '--spp', arg('spp', '4')!, '--w', arg('w', '1600')!, '--h', arg('h', '900')!];
if (arg('tod')) common.push('--tod', arg('tod')!);
if (arg('quality')) common.push('--quality', arg('quality')!);
const batches: string[][] = [];
for (let i = 0; i < ids.length; i += batchSize) batches.push(ids.slice(i, i + batchSize));
const batchStatus: { batch: number; ids: string[]; status: number | null }[] = [];
console.log(`[qa] ${label}: ${ids.length} shots in ${batches.length} batch(es) of ≤ ${batchSize} · host ${fmtMem(hostMemory())}`);
for (const [k, batch] of batches.entries()) {
  const args = ['--import', 'tsx', 'tools/capture/shots.ts', ...common, '--batch', String(k + 1), ...batch.flatMap((id) => ['--shot', id])];
  const run = spawnSync(process.execPath, args, { stdio: 'inherit', shell: false });
  batchStatus.push({ batch: k + 1, ids: batch, status: run.status });
  if (run.status === 3) console.warn(`[qa] batch ${k + 1} stopped early on low host memory — the next batch waits for memory`);
  else if (run.status !== 0) console.warn(`[qa] batch ${k + 1} reported errors (exit ${run.status}) — continuing`);
}

// ------------------------------------------------------------------ compose (sharp loaded only now, bounded)
const { default: sharp } = await import('sharp');
sharp.cache(false);
sharp.concurrency(2);

const IMG = /\.(png|jpe?g|webp)$/i;
function refImages(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isDirectory())
    return readdirSync(path)
      .filter((f) => IMG.test(f))
      .sort()
      .slice(0, 2)
      .map((f) => join(path, f));
  return IMG.test(extname(path)) ? [path] : [];
}

interface RefItem {
  file: string;
  subject: string;
  kind: string;
}
const REF_DIR = process.env.MOME_REFERENCE_DIR ?? 'reference';
/** a manifest / compare path `reference/…` under the (possibly overridden) reference root */
const refPath = (p: string) => p.replace(/\\/g, '/').replace(/^reference\//, `${REF_DIR.replace(/\\/g, '/')}/`);
const refManifest = existsSync(join(REF_DIR, 'manifest.json'))
  ? (JSON.parse(readFileSync(join(REF_DIR, 'manifest.json'), 'utf8')) as { items: RefItem[] }).items.map((r) => ({ ...r, file: refPath(r.file) }))
  : [];
const KIND_ORDER = ['film', 'bigature', 'photo', 'concept'];
/** one reference per kind for the subject (deterministic: manifest order), existing files only */
function subjectRefs(subject: string | undefined): string[] {
  if (!subject) return [];
  const items = refManifest.filter((r) => r.subject === subject && existsSync(r.file));
  const picked: string[] = [];
  for (const kind of KIND_ORDER) {
    const hit = items.find((r) => r.kind === kind);
    if (hit) picked.push(hit.file);
  }
  return picked;
}
/** landmark ids (folders under src/landmarks), longest first — bookmark ids are `<landmarkId>-<suffix>` */
const LANDMARK_IDS = readdirSync(join('src', 'landmarks'))
  .filter((f) => existsSync(join('src', 'landmarks', f, 'index.ts')))
  .sort((a, b) => b.length - a.length);
/** subject id of a shot: orbit place of a JSON shot, or the landmark of a `<id>-close` / `<id>-wide` bookmark */
function shotSubject(id: string): string | undefined {
  const s = shots.find((x) => x.id === id);
  if (s && 'orbit' in s.camera) return s.camera.orbit.place;
  if (!s) return LANDMARK_IDS.find((l) => id.startsWith(`${l}-`));
  return undefined;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
async function tile(file: string, w: number, h: number, text: string | null): Promise<Buffer> {
  const img = await sharp(file).resize(w, h, { fit: 'contain', background: '#101214' }).toBuffer();
  if (text === null) return sharp(img).png().toBuffer();
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}"><rect x="0" y="${h - 26}" width="${w}" height="26" fill="rgba(0,0,0,0.55)"/><text x="8" y="${h - 8}" font-family="Georgia" font-size="16" fill="#eee4cf">${esc(text)}</text></svg>`,
  );
  return sharp(img).composite([{ input: svg }]).png().toBuffer();
}
async function grid(tiles: Buffer[], cols: number, w: number, h: number, file: string): Promise<void> {
  const rows = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: cols * w, height: rows * h, channels: 3, background: '#101214' } })
    .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * w, top: Math.floor(i / cols) * h })))
    .png()
    .toFile(file);
}

const TW = 640;
const TH = 360;
const shotFile = (id: string) => join(shotsDir, `${id}.png`);
const rendered = ids.filter((id) => existsSync(shotFile(id)));
const missing = ids.filter((id) => !rendered.includes(id));

const tiles: Buffer[] = [];
for (const id of rendered) tiles.push(await tile(shotFile(id), TW, TH, id));
if (tiles.length) await grid(tiles, 3, TW, TH, join(out, 'contact.png'));
tiles.length = 0;

let compares = 0;
for (const id of rendered) {
  const s = shots.find((x) => x.id === id);
  const refs = [...new Set([...(s?.compare ?? []).map(refPath).flatMap(refImages), ...subjectRefs(shotSubject(id))])].slice(0, 3);
  if (!refs.length) continue;
  const parts = [await tile(shotFile(id), TW, TH, `${id} (render)`)];
  for (const r of refs) parts.push(await tile(r, TW, TH, r.replace(/\\/g, '/').split('/').slice(-2).join('/')));
  await grid(parts, parts.length, TW, TH, join(out, `compare-${id}.png`));
  compares++;
}

// blind set: anonymised, deterministically shuffled per run (FNV-1a of stamp + id)
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};
const blindSet = arg('blind', 'blind')!;
const blindIds = (setsDoc.sets[blindSet] ?? []).filter((id) => rendered.includes(id)).sort((a, b) => fnv(stamp + a) - fnv(stamp + b));
if (blindIds.length) {
  const blindDir = join(out, 'blind');
  mkdirSync(blindDir, { recursive: true });
  const key: Record<string, string> = {};
  const blindTiles: Buffer[] = [];
  for (const [i, id] of blindIds.entries()) {
    const name = `image-${String.fromCharCode(65 + i)}`;
    key[name] = id;
    copyFileSync(shotFile(id), join(blindDir, `${name}.png`));
    blindTiles.push(await tile(shotFile(id), TW, TH, String.fromCharCode(65 + i)));
  }
  await grid(blindTiles, 3, TW, TH, join(blindDir, 'contact-blind.png'));
  writeFileSync(join(out, 'blind-key.json'), JSON.stringify(key, null, 2));
}

// merged manifest
const manifests = readdirSync(shotsDir)
  .filter((f) => /^manifest(-\d+)?\.json$/.test(f))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(shotsDir, f), 'utf8')) as Record<string, unknown>);
writeFileSync(
  join(out, 'manifest.json'),
  JSON.stringify(
    {
      label,
      set: only ? null : setName,
      ids,
      missing,
      batches: batchStatus,
      perBatch: manifests.map((m) => ({ memAtStart: m.memAtStart, footprint: m.footprint, results: m.results })),
      info: manifests[0]?.info,
    },
    null,
    2,
  ),
);
writeFileSync(
  join(out, 'README.md'),
  `# QA ${stamp} — ${label}\n\n- contact.png (${rendered.length}/${ids.length} shots)\n- ${compares} compare sheets\n- blind/ (${blindIds.length} anonymised images; key in blind-key.json)\n` +
    (missing.length ? `- **missing:** ${missing.join(', ')}\n` : ''),
);
const latest = join('renders', 'qa', 'latest');
rmSync(latest, { recursive: true, force: true });
cpSync(out, latest, { recursive: true });
console.log(`[qa] ${rendered.length}/${ids.length} shots, ${compares} compare sheets, ${blindIds.length} blind → ${out}`);
if (missing.length) console.warn(`[qa] missing: ${missing.join(', ')}`);
process.exit(missing.length ? 1 : 0);
