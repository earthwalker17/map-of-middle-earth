/**
 * README showcase images — encodes curated renders into web JPEGs, reproducibly (CPU only, sharp):
 *
 *   pnpm showcase [--manifest data/qa/showcase.json] [--review <run>] [--hero <run>] [--out docs/images]
 *                 [--dry] [--snippet]
 *
 * The manifest (data/qa/showcase.json) names the runs (`runs: { review, hero }` = QA run folders; --review /
 * --hero override them), the encoder defaults (`quality`, `chroma`, `budgetMB`) and the images:
 *  - still   { file, src: "review:<id>" | "hero:<id>", w, h, quality?, crop?: [x, y, w, h] (fractions of the
 *            render), alt, caption } → the crop (else the whole render), Lanczos3 `cover` resize (centred) → JPEG
 *  - pair    { file, pair: ["review:<day>", "review:<night>"], h, seam: 8, alt, caption } → both halves at
 *            height h (each keeps its aspect) side by side with a dark seam (compose.sideBySideImage), no labels
 *  - social  { file, social: true, src, w: 1280, h: 640, crop?, darken?, title?: { text, sub } } → must be
 *            1280×640 and < 1 MB (GitHub's social preview)
 *  - banner  { file, banner: true, src, w, h, crop?, darken: 0..1, title: { text, sub } } → a darkened strip
 *            with the centred title (the README's film placeholder)
 * Titles: sharp `text` (Pango) with the project's OFL fonts only — Cinzel for the title, Cormorant Garamond
 * for `sub` (`subScale` × the title size, default 0.42); white with a soft shadow. The fonts are verified against Pango's fallback first: if this sharp
 * build cannot render text with them, the images are written without titles (warning; never system fonts).
 * JPEG: mozjpeg, the manifest's quality / chroma subsampling, sRGB, metadata stripped.
 *
 * Writes ONLY the listed files (encoded in memory, written to a temp folder, then moved into --out) and
 * deletes the files listed in the previous <out>/manifest.json that are no longer listed — never anything
 * else. It refuses (exit 1, before encoding) to write into a folder whose manifest.json was not written by
 * pnpm showcase, to overwrite an existing file that its previous manifest does not list, or to reuse a
 * non-empty <out>/.showcase-tmp. <out>/manifest.json records the commit, the sharp / libvips versions, the runs and per image file,
 * size, bytes, sha256, alt, caption and its sources (run, id, render sha256, size, spp, tier from the run
 * manifests). Fails (writes nothing) if the total exceeds `budgetMB`. --dry encodes in memory and prints the
 * sizes; --snippet prints the README HTML (stills in rows of 3 with a caption row, pairs / banners full width).
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp, { type OverlayOptions, type Sharp } from 'sharp';
import { esc, shaBuf, sideBySideImage } from './compose.ts';
import { fwd, readRun, showPath, type Run } from './runs.ts';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

type Crop = [number, number, number, number];
interface Title {
  text: string;
  sub?: string;
  subScale?: number;
}
interface Base {
  file: string;
  alt: string;
  caption?: string;
  quality?: number;
}
interface StillImg extends Base {
  src: string;
  w: number;
  h: number;
  crop?: Crop;
}
interface PairImg extends Base {
  pair: [string, string];
  h: number;
  seam?: number;
}
interface SocialImg extends Base {
  social: true;
  src: string;
  w?: number;
  h?: number;
  crop?: Crop;
  darken?: number;
  title?: Title;
}
interface BannerImg extends Base {
  banner: true;
  src: string;
  w: number;
  h: number;
  crop?: Crop;
  darken?: number;
  title: Title;
}
type Img = StillImg | PairImg | SocialImg | BannerImg;
type Kind = 'still' | 'pair' | 'social' | 'banner';
interface Manifest {
  version: number;
  notes?: string;
  runs: Record<string, string>;
  defaults?: { quality?: number; chroma?: string; budgetMB?: number };
  images: Img[];
}
interface Source {
  run: string;
  id: string;
  renderSha256: string | null;
  width: number | null;
  height: number | null;
  spp: number | null;
  tier: string | null;
}
interface Encoded {
  file: string;
  kind: Kind;
  buf: Buffer;
  w: number;
  h: number;
  alt: string;
  caption: string;
  sources: Source[];
}

const SOCIAL = { w: 1280, h: 640, maxBytes: 1024 * 1024 };
const FONT_TITLE = { family: 'Cinzel', file: resolve('public/fonts/cinzel/Cinzel-VariableFont_wght.ttf') };
const FONT_SUB = { family: 'Cormorant Garamond', file: resolve('public/fonts/cormorantgaramond/CormorantGaramond-VariableFont_wght.ttf') };
const FILE_RE = /^[a-z0-9][a-z0-9._-]*\.jpe?g$/i;
const attr = (t: string) => esc(t).replace(/"/g, '&quot;');
const MiB = 1024 * 1024;
const GENERATED_BY = 'tools/capture/showcase.ts (pnpm showcase)';

// ------------------------------------------------------------------ inputs
const manifestPath = arg('manifest', join('data', 'qa', 'showcase.json'))!;
const doc = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
const runs: Record<string, string> = { ...doc.runs };
for (const key of ['review', 'hero']) if (arg(key)) runs[key] = arg(key)!;
const outDir = arg('out', join('docs', 'images'))!;
const dry = flag('dry');
const snippet = flag('snippet');
const quality = doc.defaults?.quality ?? 82;
const chroma = doc.defaults?.chroma ?? '4:4:4';
const budgetMB = doc.defaults?.budgetMB ?? 6;

const kindOf = (img: Img): Kind => ('pair' in img ? 'pair' : 'banner' in img && img.banner ? 'banner' : 'social' in img && img.social ? 'social' : 'still');

// ------------------------------------------------------------------ validation (before any encoding)
const problems: string[] = [];
const seen = new Set<string>();
const refRe = /^([a-z0-9-]+):(.+)$/i;
const checkRef = (where: string, ref: unknown) => {
  const m = typeof ref === 'string' ? refRe.exec(ref) : null;
  if (!m) problems.push(`${where}: source '${String(ref)}' is not "<run>:<id>"`);
  else if (!runs[m[1]]) problems.push(`${where}: no run '${m[1]}' (manifest runs: ${Object.keys(runs).join(', ') || 'none'})`);
};
const checkCrop = (where: string, c: unknown) => {
  if (c === undefined) return;
  const ok = Array.isArray(c) && c.length === 4 && c.every((v) => typeof v === 'number' && v >= 0 && v <= 1) && c[2] > 0 && c[3] > 0 && c[0] + c[2] <= 1 + 1e-9 && c[1] + c[3] <= 1 + 1e-9;
  if (!ok) problems.push(`${where}: crop must be [x, y, w, h] fractions inside the render`);
};
if (!Array.isArray(doc.images) || !doc.images.length) problems.push('the manifest lists no images');
for (const [i, img] of (doc.images ?? []).entries()) {
  const where = `images[${i}] ${img.file ?? '?'}`;
  if (typeof img.file !== 'string' || !FILE_RE.test(img.file)) problems.push(`${where}: file must be a plain *.jpg name`);
  else if (seen.has(img.file.toLowerCase())) problems.push(`${where}: file listed twice`);
  else seen.add(img.file.toLowerCase());
  if (!img.alt) problems.push(`${where}: alt text is required`);
  const k = kindOf(img);
  if (k === 'pair') {
    const p = img as PairImg;
    if (!Array.isArray(p.pair) || p.pair.length !== 2) problems.push(`${where}: pair must list two sources`);
    else p.pair.forEach((r, j) => checkRef(`${where} pair[${j}]`, r));
    if (!(p.h > 0)) problems.push(`${where}: pair needs h`);
  } else {
    const s = img as StillImg | SocialImg | BannerImg;
    checkRef(where, s.src);
    checkCrop(where, s.crop);
    const w = s.w ?? (k === 'social' ? SOCIAL.w : 0);
    const h = s.h ?? (k === 'social' ? SOCIAL.h : 0);
    if (!(w > 0 && h > 0)) problems.push(`${where}: w and h are required`);
    if (k === 'social' && (w !== SOCIAL.w || h !== SOCIAL.h)) problems.push(`${where}: a social image is ${SOCIAL.w}×${SOCIAL.h} (got ${w}×${h})`);
    if (k === 'banner' && !(img as BannerImg).title?.text) problems.push(`${where}: a banner needs title.text`);
    const d = (img as BannerImg).darken;
    if (d !== undefined && !(d >= 0 && d <= 1)) problems.push(`${where}: darken must be 0..1`);
  }
}
if (problems.length) {
  console.error(`[showcase] ${manifestPath}:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

// ------------------------------------------------------------------ the output folder (checked before any encoding)
// Only a folder this tool owns is written to: its manifest.json (if any) must be one pnpm showcase wrote, and
// only the files that manifest lists may be replaced or removed.
const prevFile = join(outDir, 'manifest.json');
const tmp = join(outDir, '.showcase-tmp');
let previous: string[] = []; // the files listed in the previous showcase manifest
const outProblems: string[] = [];
if (existsSync(prevFile)) {
  let prev: { generatedBy?: unknown; images?: unknown } | null = null;
  try {
    prev = JSON.parse(readFileSync(prevFile, 'utf8')) as { generatedBy?: unknown; images?: unknown };
  } catch {
    prev = null;
  }
  if (!prev || typeof prev.generatedBy !== 'string' || !prev.generatedBy.startsWith('tools/capture/showcase.ts'))
    outProblems.push(`${fwd(prevFile)} was not written by pnpm showcase — refusing to write into ${fwd(outDir)}`);
  else
    previous = (Array.isArray(prev.images) ? (prev.images as { file?: unknown }[]) : [])
      .map((i) => (i && typeof i.file === 'string' ? i.file : ''))
      .filter((f) => FILE_RE.test(f));
}
const owned = new Set(previous.map((f) => f.toLowerCase()));
for (const img of doc.images)
  if (existsSync(join(outDir, img.file)) && !owned.has(img.file.toLowerCase()))
    outProblems.push(`${fwd(join(outDir, img.file))} exists but no pnpm showcase manifest lists it — refusing to overwrite it`);
if (existsSync(tmp)) {
  let entries: string[] | null = null;
  try {
    entries = readdirSync(tmp);
  } catch {
    entries = null;
  }
  if (!entries || entries.length) outProblems.push(`${fwd(tmp)} exists and is not an empty folder (an interrupted run?) — inspect it and remove it first`);
}
if (outProblems.length) {
  if (!dry) {
    console.error(`[showcase] refusing to write into ${fwd(outDir)} (nothing written):\n  - ${outProblems.join('\n  - ')}`);
    process.exit(1);
  }
  console.warn(`[showcase] warning: a real run would refuse to write into ${fwd(outDir)}:\n  - ${outProblems.join('\n  - ')}`);
}

sharp.cache(false);
sharp.concurrency(2);

// ------------------------------------------------------------------ sources
const runCache = new Map<string, Run>();
function source(ref: string): { png: string; meta: Source } {
  const [, key, id] = refRe.exec(ref)!;
  const runPath = runs[key];
  let run = runCache.get(runPath);
  if (!run) {
    run = readRun(runPath);
    runCache.set(runPath, run);
  }
  const png = join(run.dir, `${id}.png`);
  if (!existsSync(png)) throw new Error(`showcase: ${ref} — no ${fwd(png)}`);
  const r = run.shots.get(id);
  return {
    png,
    meta: { run: showPath(runPath), id, renderSha256: r?.sha256 ?? null, width: r?.settings.w ?? null, height: r?.settings.h ?? null, spp: r?.settings.spp ?? null, tier: r?.settings.quality ?? null },
  };
}

/** the crop (fractions; else the whole render) resized to cover w × h, centred, Lanczos3 */
async function fitted(png: string, w: number, h: number, crop?: Crop): Promise<Sharp> {
  let img = sharp(png);
  if (crop) {
    const m = await sharp(png).metadata();
    const W = m.width ?? 0;
    const H = m.height ?? 0;
    const left = Math.min(W - 1, Math.round(crop[0] * W));
    const top = Math.min(H - 1, Math.round(crop[1] * H));
    img = img.extract({ left, top, width: Math.max(1, Math.min(W - left, Math.round(crop[2] * W))), height: Math.max(1, Math.min(H - top, Math.round(crop[3] * H))) });
  }
  return img.resize(w, h, { fit: 'cover', position: 'centre', kernel: 'lanczos3' });
}
const jpeg = (img: Sharp, q: number) =>
  img
    .flatten({ background: '#101214' })
    .toColourspace('srgb')
    .jpeg({ quality: q, mozjpeg: true, chromaSubsampling: chroma })
    .toBuffer();

// ------------------------------------------------------------------ titles (OFL fonts through Pango, verified)
async function textPng(str: string, font: { family: string; file?: string }, px: number, color = '#ffffff', spacingPx = 0): Promise<Buffer> {
  const markup = `<span foreground="${color}"${spacingPx ? ` letter_spacing="${Math.round(spacingPx * 1024)}"` : ''}>${esc(str)}</span>`;
  return sharp({ text: { text: markup, font: `${font.family} ${Math.max(1, Math.round(px))}`, ...(font.file ? { fontfile: font.file } : {}), rgba: true, dpi: 72 } })
    .png()
    .toBuffer();
}
let fonts: { title: boolean; sub: boolean } | null = null;
/**
 * Pango silently falls back to another face for a font it cannot load, so each OFL face is checked against
 * the fallback of an unknown family (rendered first, before any font file is registered): a face that
 * renders identically to the fallback is not in use.
 */
async function probeFonts(): Promise<{ title: boolean; sub: boolean }> {
  if (fonts) return fonts;
  const sample = 'Journey Through Middle-Earth';
  let fallback: string | null = null;
  try {
    fallback = shaBuf(await textPng(sample, { family: 'MomeNoSuchFamily' }, 40));
  } catch {
    fallback = null; // no fallback face at all: a face that renders is the real one
  }
  const check = async (font: { family: string; file: string }) => {
    if (!existsSync(font.file)) return { ok: false, hash: '', why: `${font.file} is missing` };
    try {
      const b = await textPng(sample, font, 40);
      const m = await sharp(b).metadata();
      const hash = shaBuf(b);
      if (!m.width || !m.height) return { ok: false, hash, why: 'empty render' };
      return { ok: hash !== fallback, hash, why: hash === fallback ? 'renders as the fallback face' : '' };
    } catch (e) {
      return { ok: false, hash: '', why: (e as Error).message };
    }
  };
  const t = await check(FONT_TITLE);
  const s = await check(FONT_SUB);
  const sub = s.ok && s.hash !== t.hash;
  if (!t.ok) console.warn(`[showcase] warning: this sharp build cannot render ${FONT_TITLE.family} (${t.why}) — images are written WITHOUT titles`);
  else if (!sub) console.warn(`[showcase] warning: ${FONT_SUB.family} is unavailable (${s.why || 'renders as the title face'}) — subtitles use ${FONT_TITLE.family}`);
  fonts = { title: t.ok, sub };
  return fonts;
}

/** overlays for a centred title (+ sub) with a soft shadow on a W × H image */
async function titleOverlays(t: Title, W: number, H: number): Promise<OverlayOptions[]> {
  const f = await probeFonts();
  if (!f.title) return [];
  const subFont = f.sub ? FONT_SUB : FONT_TITLE;
  const maxW = W * 0.88;
  const fit = async (str: string, font: { family: string; file: string }, px: number, track: number) => {
    let buf = await textPng(str, font, px, '#ffffff', px * track);
    let m = await sharp(buf).metadata();
    if ((m.width ?? 0) > maxW) {
      px = (px * maxW) / (m.width ?? 1);
      buf = await textPng(str, font, px, '#ffffff', px * track);
      m = await sharp(buf).metadata();
    }
    return { buf, w: m.width ?? 0, h: m.height ?? 0, px };
  };
  const title = await fit(t.text, FONT_TITLE, H * 0.15, 0.06);
  const sub = t.sub ? await fit(t.sub, subFont, Math.max(14, title.px * (t.subScale ?? 0.42)), 0.02) : null;
  const gap = sub ? Math.round(title.px * 0.22) : 0;
  const total = title.h + (sub ? gap + sub.h : 0);
  let y = Math.round((H - total) / 2);
  const out: OverlayOptions[] = [];
  for (const part of sub ? [title, sub] : [title]) {
    const x = Math.round((W - part.w) / 2);
    // soft shadow: the glyph alpha in black, blurred, a little below
    const pad = Math.ceil(part.px * 0.3);
    const sigma = Math.max(0.6, part.px * 0.07);
    const shadow = await sharp(part.buf)
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .linear([0, 0, 0, 0.75], [0, 0, 0, 0])
      .blur(sigma)
      .png()
      .toBuffer();
    const dy = Math.max(1, Math.round(part.px * 0.04));
    out.push({ input: shadow, left: x - pad, top: y - pad + dy }, { input: part.buf, left: x, top: y });
    y += part.h + gap;
  }
  return out;
}

// ------------------------------------------------------------------ encode (in memory)
async function encode(img: Img): Promise<Encoded> {
  const k = kindOf(img);
  const q = img.quality ?? quality;
  const base = { file: img.file, kind: k, alt: img.alt, caption: img.caption ?? '' };
  if (k === 'pair') {
    const p = img as PairImg;
    const halves = await Promise.all(
      p.pair.map(async (ref) => {
        const s = source(ref);
        const m = await sharp(s.png).metadata();
        const w = Math.round(((m.width ?? 1) * p.h) / (m.height ?? 1));
        return { img: await sharp(s.png).resize(w, p.h, { fit: 'cover', kernel: 'lanczos3' }).png().toBuffer(), w, meta: s.meta };
      }),
    );
    const buf = await jpeg(sideBySideImage(halves, p.h, { gap: p.seam ?? 8, background: '#0b0c0e' }), q);
    const m = await sharp(buf).metadata();
    return { ...base, buf, w: m.width ?? 0, h: m.height ?? 0, sources: halves.map((x) => x.meta) };
  }
  const s = img as StillImg | SocialImg | BannerImg;
  const W = s.w ?? SOCIAL.w;
  const H = s.h ?? SOCIAL.h;
  const src = source(s.src);
  let pipe = await fitted(src.png, W, H, s.crop);
  const title = k === 'still' ? undefined : (s as SocialImg | BannerImg).title;
  const darken = k === 'still' ? 0 : ((s as SocialImg | BannerImg).darken ?? 0);
  if (darken > 0 || title) {
    // materialize the fitted image, then darken and draw the title on it
    const { data, info } = await pipe.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    pipe = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
    if (darken > 0) {
      const { data: d2, info: i2 } = await pipe.linear(1 - darken, 0).raw().toBuffer({ resolveWithObject: true });
      pipe = sharp(d2, { raw: { width: i2.width, height: i2.height, channels: i2.channels } });
    }
    if (title?.text) {
      const overlays = await titleOverlays(title, W, H);
      if (overlays.length) pipe = pipe.composite(overlays);
    }
  }
  const buf = await jpeg(pipe, q);
  const m = await sharp(buf).metadata();
  return { ...base, buf, w: m.width ?? 0, h: m.height ?? 0, sources: [src.meta] };
}

const encoded: Encoded[] = [];
for (const img of doc.images) encoded.push(await encode(img));

// ------------------------------------------------------------------ gates
const total = encoded.reduce((s, e) => s + e.buf.length, 0);
const fail: string[] = [];
for (const e of encoded)
  if (e.kind === 'social') {
    if (e.w !== SOCIAL.w || e.h !== SOCIAL.h) fail.push(`${e.file} is ${e.w}×${e.h}, not ${SOCIAL.w}×${SOCIAL.h}`);
    if (e.buf.length >= SOCIAL.maxBytes) fail.push(`${e.file} is ${(e.buf.length / MiB).toFixed(2)} MB (social previews must stay < 1 MB)`);
  }
if (total > budgetMB * MiB) fail.push(`total ${(total / MiB).toFixed(2)} MB > budget ${budgetMB} MB`);
for (const e of encoded) console.log(`  ${e.file.padEnd(28)} ${e.kind.padEnd(6)} ${`${e.w}×${e.h}`.padEnd(10)} ${(e.buf.length / 1024).toFixed(0).padStart(5)} KB`);
console.log(`[showcase] ${encoded.length} images, ${(total / MiB).toFixed(2)} MB of ${budgetMB} MB (quality ${quality}, ${chroma})${dry ? ' — dry run, nothing written' : ''}`);
if (fail.length) {
  console.error(`[showcase] FAILED (nothing written):\n  - ${fail.join('\n  - ')}`);
  process.exit(1);
}

// ------------------------------------------------------------------ write (temp folder, then move; only listed files)
if (!dry) {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(tmp, { recursive: true }); // new or empty (checked above)
  for (const e of encoded) writeFileSync(join(tmp, e.file), e.buf);
  for (const e of encoded) renameSync(join(tmp, e.file), join(outDir, e.file));
  rmdirSync(tmp); // empty again — never removed recursively
  const now = new Set(encoded.map((e) => e.file.toLowerCase()));
  const removed = previous.filter((f) => !now.has(f.toLowerCase()) && existsSync(join(outDir, f)));
  for (const f of removed) rmSync(join(outDir, f));
  const git = (cmd: string) => {
    try {
      return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return '';
    }
  };
  writeFileSync(
    prevFile,
    JSON.stringify(
      {
        generatedBy: GENERATED_BY,
        manifest: fwd(manifestPath),
        commit: git('rev-parse HEAD'),
        dirty: git('status --porcelain --untracked-files=no').length > 0,
        sharp: sharp.versions.sharp,
        libvips: sharp.versions.vips,
        runs: Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, showPath(v)])),
        encoder: { quality, chroma, mozjpeg: true },
        budgetMB,
        totalBytes: total,
        images: encoded.map((e) => ({ file: e.file, kind: e.kind, w: e.w, h: e.h, bytes: e.buf.length, sha256: shaBuf(e.buf), alt: e.alt, caption: e.caption, sources: e.sources })),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`[showcase] wrote ${encoded.length} files + manifest.json → ${fwd(outDir)}${removed.length ? ` · removed ${removed.length} no longer listed: ${removed.join(', ')}` : ''}`);
}

// ------------------------------------------------------------------ README snippet
if (snippet) {
  const href = (f: string) => `${showPath(outDir)}/${f}`;
  const lines: string[] = [];
  let row: Encoded[] = [];
  const flush = () => {
    if (!row.length) return;
    lines.push(`<p align="center">${row.map((e) => `<a href="${href(e.file)}"><img src="${href(e.file)}" width="32%" alt="${attr(e.alt)}"></a>`).join('\n  ')}</p>`);
    lines.push(`<p align="center"><sub>${row.map((e) => esc(e.caption)).join(' &nbsp;·&nbsp; ')}</sub></p>`);
    row = [];
  };
  for (const e of encoded) {
    if (e.kind === 'still') {
      row.push(e);
      if (row.length === 3) flush();
      continue;
    }
    flush();
    if (e.kind === 'social') {
      lines.push(`<!-- social preview (GitHub → Settings → Social preview): ${href(e.file)} -->`);
      continue;
    }
    lines.push(`<p align="center"><a href="${href(e.file)}"><img src="${href(e.file)}" width="100%" alt="${attr(e.alt)}"></a>${e.caption ? `<br><sub>${esc(e.caption)}</sub>` : ''}</p>`);
  }
  flush();
  console.log('\n' + lines.join('\n'));
}
