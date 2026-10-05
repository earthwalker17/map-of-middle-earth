/**
 * Review stills — compose a curated review folder from a QA run (CPU only, sharp):
 *
 *   node --import tsx tools/capture/review.ts --from renders/qa/<stamp> [--before <before qa run>]
 *        [--manifest data/qa/review-v1.json] [--out review/v1] [--allow-missing]
 *
 * Render the stills first (one bounded qa run, see the manifest's `render`), e.g.
 *   pnpm qa --set s4-review --quality final --w 1920 --h 1080 --spp 12 --batch 6 --label s4-review
 * (review/v1 = --from renders/qa/20261003-230100 with the manifest's before run 20261003-010300; the S4
 * manifest review-s4.json was retired in S6 with its deleted S3 "before" run)
 *
 * Writes into --out (gitignored `review/`; its previous stills / pairs / before-after are replaced):
 *  - stills/NN-<id>.png             the renders in the manifest's order (bytes as rendered)
 *  - pairs/dn-<pair>.png            day | night side by side, labelled with the time of day
 *  - before-after/ba-NN-<id>.png    before | after side by side at a common height (the smaller one), labelled
 *                                   with the manifest's `before.tag` / `after.tag` (default S3 / S4)
 *  - contact.jpg                    all stills, numbered and titled
 *  - README.md                      table (#, shot, time of day, distance, what to look at, S3 issue
 *                                   addressed), the pairs, the before/after list, known issues
 *  - manifest.json                  commit, tier, spp, size, sha256 of every written image (+ the
 *                                   render's pixel sha256 from the QA run)
 * Time of day and camera distance come from the shot data (data/qa shots and landmark bookmarks; a
 * `--tod` override of the QA run wins).
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { esc, labelled, sha, sideBySide, size } from './compose.ts';
import { loadShots } from './shotList.ts';
import { loadLandmarks } from '../check/baked.ts';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

interface Still {
  id: string;
  title: string;
  look: string;
  s3Issue: string;
}
interface ReviewManifest {
  title: string;
  set?: string;
  render?: { quality?: string; w?: number; h?: number; spp?: number };
  /** `tag` / `after.tag`: the before / after labels of the before-after sheets and the README (default S3 / S4) */
  before?: { run?: string; label?: string; tag?: string };
  after?: { tag?: string };
  stills: Still[];
  pairs: { id: string; day: string; night: string }[];
  beforeAfter: { id: string; before?: string }[];
  knownIssues?: KnownIssue[];
}
/**
 * A README known issue: plain text, or text shown only for runs that match (`tiers`: the run's quality
 * tier is one of them; `minSpp` / `maxSpp`: the run's largest spp is in range). `{tier}`, `{spp}` and
 * `{size}` in the text are replaced by the run's values.
 */
type KnownIssue = string | { text: string; tiers?: string[]; minSpp?: number; maxSpp?: number };
interface QaResult {
  name: string;
  width: number;
  height: number;
  spp: number;
  sha256: string;
  renderMs: number;
  meanLuma: number;
}

// ------------------------------------------------------------------ inputs
const from = arg('from');
if (!from) throw new Error('review: --from <qa run folder> is required (renders/qa/<stamp>)');
const manifestPath = arg('manifest', join('data', 'qa', 'review-v1.json'))!;
const doc = JSON.parse(readFileSync(manifestPath, 'utf8')) as ReviewManifest;
const beforeRun = arg('before') ?? doc.before?.run;
const outDir = arg('out', join('review', 'v1'))!;
const allowMissing = flag('allow-missing');
const beforeTag = doc.before?.tag ?? 'S3';
const afterTag = doc.after?.tag ?? 'S4';

const fromShots = join(from, 'shots');
if (!existsSync(fromShots)) throw new Error(`review: no shots/ folder in ${from}`);
// per-batch manifests of the run: results (pixel sha256, spp, size), the page tier and the CLI args
const batchFiles = readdirSync(fromShots).filter((f) => /^manifest(-\d+)?\.json$/.test(f)).sort();
const results = new Map<string, QaResult>();
let tier = 'unknown';
let todOverride: number | undefined;
for (const f of batchFiles) {
  const m = JSON.parse(readFileSync(join(fromShots, f), 'utf8')) as { info?: { quality?: string }; args?: { tod?: number }; results?: QaResult[] };
  if (m.info?.quality) tier = m.info.quality;
  if (m.args?.tod !== undefined) todOverride = m.args.tod;
  for (const r of m.results ?? []) results.set(r.name, r);
}
const shotFile = (id: string) => join(fromShots, `${id}.png`);
const beforeFile = (id: string) => (beforeRun ? join(beforeRun, 'shots', `${id}.png`) : '');

// time of day + distance from the shot data (JSON shots, else landmark bookmarks)
const json = loadShots();
const bookmarks = new Map<string, { tod: number; distanceKm: number }>();
for (const def of await loadLandmarks()) for (const b of def.bookmarks ?? []) bookmarks.set(b.id, { tod: b.tod ?? 15, distanceKm: b.distanceKm });
function shotInfo(id: string): { tod: number | null; distanceKm: number | null } {
  const s = json.find((x) => x.id === id);
  if (s) {
    const cam = s.camera;
    const d = 'orbit' in cam ? cam.orbit.distanceKm : Math.hypot(...cam.position.map((p, i) => p - cam.target[i]));
    return { tod: todOverride ?? s.tod, distanceKm: d };
  }
  const b = bookmarks.get(id);
  return b ? { tod: todOverride ?? b.tod, distanceKm: b.distanceKm } : { tod: todOverride ?? null, distanceKm: null };
}
const fmtTod = (t: number | null) => {
  if (t === null) return '—';
  const m = Math.round((((t % 24) + 24) % 24) * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const fmtDist = (d: number | null) => (d === null ? '—' : d >= 100 ? `${Math.round(d)} km` : `${d.toFixed(1)} km`);

const number = new Map(doc.stills.map((s, i) => [s.id, String(i + 1).padStart(2, '0')]));
const missing = doc.stills.map((s) => s.id).filter((id) => !existsSync(shotFile(id)));
if (missing.length && !allowMissing) throw new Error(`review: ${missing.length} still(s) missing in ${from}: ${missing.join(', ')} (pass --allow-missing for a partial test)`);

// ------------------------------------------------------------------ output folder (only our own outputs are replaced)
for (const d of ['stills', 'pairs', 'before-after']) rmSync(join(outDir, d), { recursive: true, force: true });
for (const f of ['contact.jpg', 'README.md', 'manifest.json']) rmSync(join(outDir, f), { force: true });
for (const d of ['stills', 'pairs', 'before-after']) mkdirSync(join(outDir, d), { recursive: true });

// the same sharp module instance as compose.ts (the settings apply to its helpers too)
const { default: sharp } = await import('sharp');
sharp.cache(false);
sharp.concurrency(2);

interface Written {
  file: string;
  kind: 'still' | 'pair' | 'before-after' | 'contact';
  id: string;
  width: number;
  height: number;
  sha256: string;
  renderSha256?: string;
  spp?: number;
}
const written: Written[] = [];
const outAbs = resolve(outDir);
async function record(file: string, kind: Written['kind'], id: string, extra: Partial<Written> = {}): Promise<void> {
  const { w, h } = await size(file);
  // relative to the resolved --out (a trailing slash or a relative / absolute spelling cannot shift it)
  written.push({ file: relative(outAbs, resolve(file)).replace(/\\/g, '/'), kind, id, width: w, height: h, sha256: sha(file), ...extra });
}

// ------------------------------------------------------------------ stills
for (const s of doc.stills) {
  if (!existsSync(shotFile(s.id))) continue;
  const file = join(outDir, 'stills', `${number.get(s.id)}-${s.id}.png`);
  copyFileSync(shotFile(s.id), file);
  const r = results.get(s.id);
  await record(file, 'still', s.id, r ? { renderSha256: r.sha256, spp: r.spp } : {});
}

// ------------------------------------------------------------------ day / night pairs
const pairsDone: string[] = [];
for (const p of doc.pairs) {
  if (!existsSync(shotFile(p.day)) || !existsSync(shotFile(p.night))) continue;
  const D = await size(shotFile(p.day));
  const N = await size(shotFile(p.night));
  // both halves at the day still's height, each keeping its own aspect
  const h = D.h;
  const wn = Math.round((N.w * h) / N.h);
  const day = await labelled(shotFile(p.day), D.w, h, `Day · ${fmtTod(shotInfo(p.day).tod)}`);
  const night = await labelled(shotFile(p.night), wn, h, `Night · ${fmtTod(shotInfo(p.night).tod)}`);
  const file = join(outDir, 'pairs', `dn-${p.id}.png`);
  await sideBySide([{ img: day, w: D.w }, { img: night, w: wn }], h, file);
  await record(file, 'pair', p.id);
  pairsDone.push(p.id);
}

// ------------------------------------------------------------------ before / after (e.g. S3 → S4)
const baDone: { id: string; before: string }[] = [];
const baMissing: string[] = [];
for (const b of doc.beforeAfter) {
  const before = b.before ?? b.id;
  if (!existsSync(shotFile(b.id)) || !beforeRun || !existsSync(beforeFile(before))) {
    baMissing.push(b.id);
    continue;
  }
  const A = await size(beforeFile(before));
  const B = await size(shotFile(b.id));
  // a common height: the smaller one (never upscale a render); each side keeps its own aspect
  const h = Math.min(A.h, B.h);
  const wa = Math.round((A.w * h) / A.h);
  const wb = Math.round((B.w * h) / B.h);
  const left = await labelled(beforeFile(before), wa, h, `${beforeTag} · ${before}`);
  const right = await labelled(shotFile(b.id), wb, h, `${afterTag} · ${b.id}`);
  const file = join(outDir, 'before-after', `ba-${number.get(b.id) ?? '00'}-${b.id}.png`);
  await sideBySide([{ img: left, w: wa }, { img: right, w: wb }], h, file);
  await record(file, 'before-after', b.id);
  baDone.push({ id: b.id, before });
}

// ------------------------------------------------------------------ contact sheet
const TW = 480;
const TH = 270;
const COLS = 4;
const tiles: Buffer[] = [];
for (const s of doc.stills) {
  if (!existsSync(shotFile(s.id))) continue;
  const img = await sharp(shotFile(s.id)).resize(TW, TH, { fit: 'contain', background: '#101214' }).toBuffer();
  const svg = Buffer.from(
    `<svg width="${TW}" height="${TH}"><rect x="0" y="${TH - 24}" width="${TW}" height="24" fill="rgba(0,0,0,0.55)"/>` +
      `<text x="8" y="${TH - 7}" font-family="Georgia" font-size="15" fill="#eee4cf">${esc(`${number.get(s.id)} · ${s.title}`)}</text></svg>`,
  );
  tiles.push(await sharp(img).composite([{ input: svg }]).png().toBuffer());
}
if (tiles.length) {
  const rows = Math.ceil(tiles.length / COLS);
  const file = join(outDir, 'contact.jpg');
  await sharp({ create: { width: COLS * TW, height: rows * TH, channels: 3, background: '#101214' } })
    .composite(tiles.map((t, i) => ({ input: t, left: (i % COLS) * TW, top: Math.floor(i / COLS) * TH })))
    .jpeg({ quality: 88 })
    .toFile(file);
  await record(file, 'contact', 'contact');
}

// ------------------------------------------------------------------ README + manifest
const git = (cmd: string) => {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const commit = git('rev-parse HEAD');
const dirty = git('status --porcelain --untracked-files=no').length > 0;
const anyResult = [...results.values()][0];
const spps = [...new Set([...results.values()].map((r) => r.spp))];
const sizeStr = anyResult ? `${anyResult.width}×${anyResult.height}` : 'unknown';
const cell = (t: string) => t.replace(/\|/g, '\\|').replace(/\n/g, ' ');

const lines: string[] = [];
lines.push(`# ${doc.title}`, '');
lines.push(`Rendered from \`${from.replace(/\\/g, '/')}\` · tier **${tier}** · ${sizeStr} · spp ${spps.join('/') || '?'} · commit \`${commit.slice(0, 10)}\`${dirty ? ' (dirty tree)' : ''}.`);
if (beforeRun) lines.push(`Before (${beforeTag}): \`${beforeRun.replace(/\\/g, '/')}\`${doc.before?.label ? ` — ${doc.before.label}` : ''}.`);
lines.push('', `\`stills/\` the renders in film order · \`pairs/\` day / night · \`before-after/\` ${beforeTag} → ${afterTag} · \`contact.jpg\` all stills · \`manifest.json\` hashes.`, '');
lines.push('| # | Shot | Time of day | Distance | What to look at | S3 issue addressed |', '|---|---|---|---|---|---|');
for (const s of doc.stills) {
  const info = shotInfo(s.id);
  const have = existsSync(shotFile(s.id));
  const name = have ? `[${s.title}](stills/${number.get(s.id)}-${s.id}.png)<br>\`${s.id}\`` : `${s.title}<br>\`${s.id}\` **(missing)**`;
  lines.push(`| ${number.get(s.id)} | ${cell(name)} | ${fmtTod(info.tod)} | ${fmtDist(info.distanceKm)} | ${cell(s.look)} | ${cell(s.s3Issue)} |`);
}
lines.push('', '## Day / night pairs', '');
for (const p of doc.pairs)
  lines.push(pairsDone.includes(p.id) ? `- [${p.id}](pairs/dn-${p.id}.png): \`${p.day}\` (${fmtTod(shotInfo(p.day).tod)}) / \`${p.night}\` (${fmtTod(shotInfo(p.night).tod)})` : `- ${p.id}: **missing** (\`${p.day}\` / \`${p.night}\`)`);
lines.push('', `## Before / after (${beforeTag} → ${afterTag})`, '');
for (const b of doc.beforeAfter) {
  const done = baDone.find((x) => x.id === b.id);
  lines.push(done ? `- [${b.id}](before-after/ba-${number.get(b.id) ?? '00'}-${b.id}.png) (${beforeTag} \`${done.before}\`)` : `- ${b.id}: **missing**`);
}
lines.push('', '## Known issues', '');
// issues that apply to this run only (tier / spp conditions), with the run's values filled in
const maxSpp = spps.length ? Math.max(...spps) : 0;
for (const k of doc.knownIssues ?? []) {
  const it = typeof k === 'string' ? { text: k } : k;
  if (it.tiers && !it.tiers.includes(tier)) continue;
  if (it.minSpp !== undefined && maxSpp < it.minSpp) continue;
  if (it.maxSpp !== undefined && maxSpp > it.maxSpp) continue;
  lines.push(`- ${it.text.replace(/\{tier\}/g, tier).replace(/\{spp\}/g, spps.join('/') || '?').replace(/\{size\}/g, sizeStr)}`);
}
if (missing.length) lines.push(`- Missing stills in this run: ${missing.join(', ')}.`);
if (baMissing.length) lines.push(`- Missing before/after sheets: ${baMissing.join(', ')}.`);
lines.push('');
writeFileSync(join(outDir, 'README.md'), lines.join('\n'));

writeFileSync(
  join(outDir, 'manifest.json'),
  JSON.stringify(
    {
      title: doc.title,
      createdAt: new Date().toISOString(),
      commit,
      dirty,
      manifest: manifestPath.replace(/\\/g, '/'),
      from: resolve(from).replace(/\\/g, '/'),
      before: beforeRun ? resolve(beforeRun).replace(/\\/g, '/') : null,
      tier,
      spp: spps,
      size: sizeStr,
      missing,
      images: written,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `[review] ${written.filter((w) => w.kind === 'still').length}/${doc.stills.length} stills, ${pairsDone.length} pairs, ${baDone.length} before/after → ${outDir}` +
    (missing.length ? ` · missing: ${missing.join(', ')}` : ''),
);
