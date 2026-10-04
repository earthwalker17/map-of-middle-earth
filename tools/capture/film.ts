/**
 * The journey film renderer (S5): frames of the compiled film timeline (`?film=1`, timeline 'film').
 *
 * Stills (iteration):
 *   pnpm film --at 12,20.5,48 [--tier review] [--w 1280 --h 720] [--spp 2] [--shutter 0.5] [--label x]
 *   pnpm film --every 2 [--from 0 --to 60]          stills every N seconds (storyboard)
 *   pnpm film --beats hobbiton,rivendell             one still at the middle of each named beat
 *   pnpm film --at 30 --determinism                  re-render the first still after the batch: IDENTICAL?
 *   → renders/film/stills-<stamp>[-label]/f<frame>.png + manifest.json + sheet.png ("t · beat · tod")
 *
 * Sequences (chunked, resumable, streamed to ffmpeg — no PNG frames on disk):
 *   pnpm film --render [--tier preview|review|final] [--w --h --spp --shutter] [--from s --to s]
 *                      [--codec x264|prores|ffv1] [--crf 14 --preset medium] [--chunk 96] [--budget 520]
 *                      [--run renders/film/<dir>] [--label x] [--force]
 *     Frame k shows t = k / fps. Chunk i holds frames [i·chunk, (i+1)·chunk) ∩ the range, as
 *     <run>/chunks/cNNNN.<ext> + cNNNN.json (per frame t, sha256, ms, luma); a chunk is encoded into
 *     <run>/partial/ and moved in after ffprobe confirms its frame count. Re-running with --run resumes:
 *     finished chunks are skipped. Exit 0 = the range is complete · 75 = the time budget (seconds per call,
 *     boot included) ran out: run the same command again · 3 = low memory · 1 = error.
 *     --budget 0 = no budget (user-started overnight runs; Chrome is restarted every 25 min).
 *     A run refuses other settings, another film hash or another commit unless --force.
 *   pnpm film --verify-resume --run <dir>           re-render the first frame of each finished chunk: same sha?
 *   pnpm film --assemble --run <dir> [--audio a.wav] [--mp4 name.mp4] [--reencode]
 *     → concat (stream copy) → <run>/<name>.mp4 (+ AAC 320k audio, exact film length).
 *
 * One invocation = one bounded capture session (memory guard → GPU lock → Vite + Chrome) in the
 * foreground; keep a call under ~10 minutes (the default budget is 520 s).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import type { CaptureRequest, CaptureResult } from '../../src/render/capture.ts';
import type { FilmMeta } from '../../src/tour/schema.ts';
import { browserVersion, collectGarbage } from './browser.ts';
import { grid, labelled } from './compose.ts';
import { CODEC_EXT, ChunkEncoder, concatChunks, deliver, probeFrames, type Codec, type EncodeOpts } from './ffmpeg.ts';
import { bootCapturePage, openCaptureSession, withTimeout, type CaptureSession } from './session.ts';

interface Args {
  mode: 'stills' | 'render' | 'assemble' | 'verify-resume';
  at: number[];
  every?: number;
  from?: number;
  to?: number;
  beats: string[];
  tier: string;
  w: number;
  h: number;
  spp?: number;
  shutter?: number;
  label?: string;
  out?: string;
  run?: string;
  determinism: boolean;
  headed: boolean;
  port: number;
  sheetCols: number;
  chunk?: number;
  budget: number;
  codec?: Codec;
  crf?: number;
  preset?: string;
  force: boolean;
  audio?: string;
  mp4?: string;
  reencode: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { mode: 'stills', at: [], beats: [], tier: 'review', w: 1280, h: 720, determinism: false, headed: false, port: 5199, sheetCols: 4, budget: 520, force: false, reencode: false };
  const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
  let wSet = false;
  let hSet = false;
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--at') a.at.push(...list(v()).map(Number));
    else if (k === '--every') a.every = Number(v());
    else if (k === '--from') a.from = Number(v());
    else if (k === '--to') a.to = Number(v());
    else if (k === '--beats') a.beats.push(...list(v()));
    else if (k === '--tier' || k === '--quality') a.tier = v();
    else if (k === '--w') (a.w = Number(v())), (wSet = true);
    else if (k === '--h') (a.h = Number(v())), (hSet = true);
    else if (k === '--spp') a.spp = Number(v());
    else if (k === '--shutter') a.shutter = Number(v());
    else if (k === '--label') a.label = v();
    else if (k === '--out') a.out = v();
    else if (k === '--run') a.run = v();
    else if (k === '--determinism') a.determinism = true;
    else if (k === '--headed') a.headed = true;
    else if (k === '--port') a.port = Number(v());
    else if (k === '--cols') a.sheetCols = Number(v());
    else if (k === '--render') a.mode = 'render';
    else if (k === '--assemble') a.mode = 'assemble';
    else if (k === '--verify-resume') a.mode = 'verify-resume';
    else if (k === '--chunk') a.chunk = Number(v());
    else if (k === '--budget') a.budget = Number(v());
    else if (k === '--codec') a.codec = v() as Codec;
    else if (k === '--crf') a.crf = Number(v());
    else if (k === '--preset') a.preset = v();
    else if (k === '--force') a.force = true;
    else if (k === '--audio') a.audio = v();
    else if (k === '--mp4') a.mp4 = v();
    else if (k === '--reencode') a.reencode = true;
    else throw new Error(`film: unknown argument ${k}`);
  }
  // sequence defaults per tier (animatic / review cut / final)
  if (a.mode === 'render' && !wSet && !hSet && a.tier === 'preview') [a.w, a.h] = [960, 540];
  if (a.mode === 'render' && !wSet && !hSet && a.tier === 'final') [a.w, a.h] = [1920, 1080];
  return a;
}

const RENDER_TIMEOUT = 10 * 60_000;
const ABORT_FREE_MB = Number(process.env.MOME_ABORT_FREE_MB ?? 500);
const MB = 1024 * 1024;
/** Chrome is restarted after this long in unbudgeted (overnight) runs */
const SESSION_CAP_S = 25 * 60;
/** seconds per frame before a run has measured its own (sequence budget estimates) */
const DEFAULT_FRAME_S: Record<string, number> = { preview: 0.35, review: 1.4, final: 5 };
/** per tier: chunk size, codec, x264 crf / preset */
const TIER_SEQ: Record<string, { chunk: number; codec: Codec; crf: number; preset: string }> = {
  preview: { chunk: 240, codec: 'x264', crf: 20, preset: 'veryfast' },
  review: { chunk: 96, codec: 'x264', crf: 14, preset: 'medium' },
  final: { chunk: 48, codec: 'prores', crf: 14, preset: 'medium' },
};

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** the beat a film time falls in */
export function beatAt(meta: FilmMeta, t: number): FilmMeta['beats'][number] {
  return meta.beats.find((b) => t >= b.t0 && t < b.t1) ?? meta.beats[meta.beats.length - 1];
}

function gitCommit(): { commit: string; dirty: boolean } {
  const c = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  const d = spawnSync('git', ['status', '--porcelain', '--', 'src', 'data', 'public', 'index.html', 'vite.config.ts', 'package.json'], { encoding: 'utf8' });
  return { commit: c.stdout.trim(), dirty: d.stdout.trim().length > 0 };
}

/** boot the film page and return the film's metadata */
async function bootFilm(session: CaptureSession, tier: string): Promise<{ info: Awaited<ReturnType<NonNullable<Window['__mm']>['info']>>; meta: FilmMeta }> {
  await bootCapturePage(session, tier, '&film=1');
  const info = await session.page.evaluate(() => window.__mm!.info());
  if (info.gpu.backend !== 'webgpu' || info.gpu.isFallback) throw new Error('not running on hardware WebGPU');
  const tl = await session.page.evaluate(() => window.__mm!.timelineInfo('film'));
  if (!tl) throw new Error('film timeline not registered (boot ?film=1)');
  return { info, meta: tl.meta as FilmMeta };
}

// ───────────────────────────── stills ─────────────────────────────

async function stills(args: Args): Promise<number> {
  const outDir = args.out ?? join('renders', 'film', `stills-${stamp()}${args.label ? `-${args.label}` : ''}`);
  mkdirSync(outDir, { recursive: true });
  sharp.cache(false);
  sharp.concurrency(1);
  const session = await openCaptureSession({ label: `film stills ${args.label ?? ''}`.trim(), port: args.port, headed: args.headed });
  const { srv, ctx, page, logs } = session;
  srv.setHandler(async ({ name, width, height, rgba }) => {
    await sharp(rgba, { raw: { width, height, channels: 4 } }).removeAlpha().png({ compressionLevel: 6 }).toFile(join(outDir, `${name}.png`));
  });
  let exitCode = 0;
  try {
    const { info, meta } = await bootFilm(session, args.tier);
    console.log(`[film] ${info.gpu.vendor}/${info.gpu.architecture} · film ${meta.hash} · ${meta.duration.toFixed(1)} s · ${meta.beats.length} beats · ${meta.status}`);
    const times: number[] = [...args.at];
    if (args.every) for (let t = args.from ?? 0; t <= (args.to ?? meta.duration) + 1e-9; t += args.every) times.push(t);
    for (const id of args.beats) {
      const b = meta.beats.find((x) => x.id === id);
      if (!b) throw new Error(`film: unknown beat '${id}' (beats: ${meta.beats.map((x) => x.id).join(', ')})`);
      times.push((b.t0 + b.t1) / 2);
    }
    if (!times.length) throw new Error('film: nothing to render (use --at, --every or --beats)');
    const last = Math.ceil(meta.duration * meta.fps) - 1;
    const frames = [...new Set(times.map((t) => Math.min(last, Math.max(0, Math.round(t * meta.fps)))))];
    const shutter = args.shutter ?? 0;

    const results: (CaptureResult & { frame: number; t: number; beat: string; tod: number; file: string })[] = [];
    for (const [k, frame] of frames.entries()) {
      const t = frame / meta.fps;
      const name = `f${String(frame).padStart(5, '0')}`;
      const req: CaptureRequest = { name, timelineId: 'film', t, width: args.w, height: args.h, spp: args.spp, shutter, fps: meta.fps };
      const res = await withTimeout(page.evaluate((r) => window.__mm!.render(r), req), RENDER_TIMEOUT, `render ${name}`);
      const st = await page.evaluate(([tt]) => window.__mm!.timelineState('film', tt), [t] as const);
      await collectGarbage(ctx, page);
      const beat = beatAt(meta, t).id;
      results.push({ ...res, frame, t, beat, tod: st?.tod ?? NaN, file: `${name}.png` });
      const freeMB = Math.round(freemem() / MB);
      console.log(`[film] ${name} t ${t.toFixed(2)} ${beat} tod ${st?.tod.toFixed(2)}: ${Math.round(res.renderMs)} ms, luma ${res.meanLuma.toFixed(1)} · ${freeMB} MB free`);
      if (res.meanLuma < 3) console.warn(`[film] WARNING: ${name} is (nearly) black`);
      if (freeMB < ABORT_FREE_MB && k < frames.length - 1) {
        console.error(`[film] host memory low (${freeMB} MB): stopping after ${k + 1}/${frames.length}`);
        exitCode = 3;
        break;
      }
    }
    if (args.determinism && results.length) {
      const f = results[0];
      const again = await page.evaluate((r) => window.__mm!.render(r), { name: `${f.file.replace('.png', '')}__repeat`, timelineId: 'film', t: f.t, width: args.w, height: args.h, spp: args.spp, shutter, fps: meta.fps } as CaptureRequest);
      const same = again.sha256 === f.sha256;
      console.log(`[film] determinism (${f.file} after ${results.length} frames): ${same ? 'IDENTICAL' : 'DIFFERENT'}`);
      if (!same) exitCode = 1;
    }
    const tw = 480;
    const th = Math.round((tw * args.h) / args.w);
    const tiles = await Promise.all(results.map((r) => labelled(join(outDir, r.file), tw, th, `${r.t.toFixed(1)} s · ${r.beat} · ${r.tod.toFixed(2)} h`)));
    if (tiles.length) await grid(tiles, tw, th, args.sheetCols).png({ compressionLevel: 6 }).toFile(join(outDir, 'sheet.png'));
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), chrome: await browserVersion(ctx), info, film: meta, args, results }, null, 2));
    const errs = logs.filter((l) => l.type === 'error' || l.type === 'pageerror');
    if (errs.length) for (const e of errs.slice(0, 20)) console.warn('   [page]', e.text);
  } catch (e) {
    console.error('[film] failed:', e);
    for (const l of logs.slice(-30)) console.error(`   [${l.type}] ${l.text}`);
    exitCode = 1;
  } finally {
    await session.close();
  }
  console.log(`[film] output: ${outDir}`);
  return exitCode;
}

// ───────────────────────────── sequences ─────────────────────────────

interface RunJson {
  version: 1;
  createdAt: string;
  tier: string;
  width: number;
  height: number;
  spp: number | null;
  shutter: number;
  fps: number;
  codec: Codec;
  crf: number;
  preset: string;
  chunk: number;
  /** frame range [k0, k1) */
  frames: [number, number];
  film: { hash: string; duration: number; status: string };
  commit: string;
  dirty: boolean;
  label?: string;
}

interface ChunkJson {
  chunk: number;
  frames: { k: number; t: number; sha256: string; ms: number; luma: number }[];
  file: string;
  bytes: number;
  renderedAt: string;
  chrome: string;
}

const pad = (i: number) => String(i).padStart(4, '0');

function chunkList(run: RunJson): { i: number; k0: number; k1: number }[] {
  const out: { i: number; k0: number; k1: number }[] = [];
  const [a, b] = run.frames;
  for (let i = Math.floor(a / run.chunk); i * run.chunk < b; i++) out.push({ i, k0: Math.max(a, i * run.chunk), k1: Math.min(b, (i + 1) * run.chunk) });
  return out;
}

function chunkDone(dir: string, run: RunJson, c: { i: number; k0: number; k1: number }): boolean {
  const js = join(dir, 'chunks', `c${pad(c.i)}.json`);
  const vid = join(dir, 'chunks', `c${pad(c.i)}.${CODEC_EXT[run.codec]}`);
  if (!existsSync(js) || !existsSync(vid)) return false;
  const j = JSON.parse(readFileSync(js, 'utf8')) as ChunkJson;
  return j.frames.length === c.k1 - c.k0 && j.frames[0]?.k === c.k0;
}

function freeDiskMB(dir: string): number {
  const s = statfsSync(dir);
  return Math.round((s.bavail * s.bsize) / MB);
}

async function render(args: Args): Promise<number> {
  const seq = TIER_SEQ[args.tier];
  if (!seq) throw new Error(`film: unknown tier ${args.tier}`);
  const t0 = Date.now();
  const elapsed = () => (Date.now() - t0) / 1000;
  let dir = args.run;
  const git = gitCommit();
  let exitCode = 0;
  let measured: number[] = [];
  let sessionStart = 0;

  // a resumed run keeps its own settings (tier, size, spp, shutter, codec, chunking, range)
  const existing = dir && existsSync(join(dir, 'run.json')) ? (JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as RunJson) : null;
  const tier = existing?.tier ?? args.tier;

  while (true) {
    const session = await openCaptureSession({ label: `film render ${args.label ?? tier}`, port: args.port, headed: args.headed });
    sessionStart = Date.now();
    const { srv, ctx, page, logs } = session;
    let enc: ChunkEncoder | null = null;
    let sinkErr: Error | null = null;
    srv.setHandler(async ({ rgba }) => {
      try {
        if (!enc) throw new Error('frame without an open chunk');
        await enc.write(rgba);
      } catch (e) {
        sinkErr = e as Error;
        throw e;
      }
    });
    let more = false;
    try {
      const { info, meta } = await bootFilm(session, tier);
      const nFrames = Math.ceil(meta.duration * meta.fps - 1e-9);
      // ---- the run (new or resumed)
      let run: RunJson;
      if (dir && existsSync(join(dir, 'run.json'))) {
        run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as RunJson;
        const diffs = [
          run.film.hash !== meta.hash && `film hash ${run.film.hash} → ${meta.hash}`,
          run.commit !== git.commit && `commit ${run.commit.slice(0, 8)} → ${git.commit.slice(0, 8)}`,
          git.dirty && 'uncommitted changes in src / data / public',
        ].filter(Boolean);
        if (diffs.length && !args.force) throw new Error(`film: run ${dir} differs (${diffs.join(', ')}) — start a new run or pass --force`);
      } else {
        if (git.dirty && !args.force) throw new Error('film: uncommitted changes in src / data / public — commit first (or --force for a throwaway run)');
        const k0 = Math.max(0, Math.round((args.from ?? 0) * meta.fps));
        const k1 = Math.min(nFrames, Math.round((args.to ?? meta.duration) * meta.fps));
        dir = dir ?? join('renders', 'film', `${args.tier}-${args.w}x${args.h}-${stamp()}${args.label ? `-${args.label}` : ''}`);
        run = {
          version: 1,
          createdAt: new Date().toISOString(),
          tier: args.tier,
          width: args.w,
          height: args.h,
          spp: args.spp ?? null,
          shutter: args.shutter ?? meta.shutter,
          fps: meta.fps,
          codec: args.codec ?? seq.codec,
          crf: args.crf ?? seq.crf,
          preset: args.preset ?? seq.preset,
          chunk: args.chunk ?? seq.chunk,
          frames: [k0, k1],
          film: { hash: meta.hash, duration: meta.duration, status: meta.status },
          commit: git.commit,
          dirty: git.dirty,
          ...(args.label ? { label: args.label } : {}),
        };
        mkdirSync(join(dir, 'chunks'), { recursive: true });
        writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2));
        console.log(`[film] new run ${dir}: frames ${k0}–${k1 - 1} (${((k1 - k0) / meta.fps).toFixed(1)} s) · ${run.tier} ${run.width}×${run.height} spp ${run.spp ?? 'tier'} · shutter ${run.shutter} · ${run.codec} · chunks of ${run.chunk}`);
      }
      mkdirSync(join(dir, 'partial'), { recursive: true });
      const chunks = chunkList(run);
      const todo = chunks.filter((c) => !chunkDone(dir!, run, c));
      console.log(`[film] ${info.gpu.vendor}/${info.gpu.architecture} · film ${meta.hash} · ${chunks.length - todo.length}/${chunks.length} chunks done · boot ${elapsed().toFixed(0)} s`);
      const opts: EncodeOpts = { width: run.width, height: run.height, fps: run.fps, codec: run.codec, crf: run.crf, preset: run.preset };
      const chrome = await browserVersion(ctx);
      for (const c of todo) {
        const n = c.k1 - c.k0;
        const perFrame = measured.length ? measured.reduce((x, y) => x + y, 0) / measured.length / 1000 : DEFAULT_FRAME_S[run.tier];
        const est = n * perFrame + 4;
        if (args.budget > 0 && elapsed() + est > args.budget) {
          more = true;
          console.log(`[film] budget: ${elapsed().toFixed(0)} s used, next chunk ≈ ${est.toFixed(0)} s > ${args.budget} s — run again to continue`);
          break;
        }
        if (args.budget === 0 && (Date.now() - sessionStart) / 1000 + est > SESSION_CAP_S) {
          more = true;
          console.log('[film] restarting Chrome (session cap)');
          break;
        }
        const disk = freeDiskMB(dir);
        if (disk < 2048) throw new Error(`film: only ${disk} MB free on disk (need ≥ 2 GB) — stopping`);
        const ext = CODEC_EXT[run.codec];
        const part = join(dir, 'partial', `c${pad(c.i)}.${ext}`);
        rmSync(part, { force: true });
        enc = new ChunkEncoder(opts, part, join(dir, 'partial', `c${pad(c.i)}.log`));
        const frames: ChunkJson['frames'] = [];
        const ct0 = Date.now();
        try {
          for (let k = c.k0; k < c.k1; k++) {
            const t = k / run.fps;
            const req: CaptureRequest = { name: `k${k}`, timelineId: 'film', t, width: run.width, height: run.height, ...(run.spp ? { spp: run.spp } : {}), shutter: run.shutter, fps: run.fps };
            const res = await withTimeout(page.evaluate((r) => window.__mm!.render(r), req), RENDER_TIMEOUT, `render frame ${k}`);
            if (sinkErr) throw sinkErr;
            measured.push(res.renderMs + 40);
            if (measured.length > 48) measured = measured.slice(-48);
            frames.push({ k, t, sha256: res.sha256, ms: Math.round(res.renderMs), luma: Math.round(res.meanLuma * 10) / 10 });
            if (res.meanLuma < 2) console.warn(`[film] WARNING: frame ${k} (t ${t.toFixed(2)}) is (nearly) black`);
            if ((k - c.k0) % 24 === 23) {
              await collectGarbage(ctx, page);
              const freeMB = Math.round(freemem() / MB);
              if (freeMB < ABORT_FREE_MB) {
                exitCode = 3;
                throw new Error(`host memory low (${freeMB} MB)`);
              }
            }
          }
          await enc.finish();
        } catch (e) {
          enc.abort();
          enc = null;
          throw e;
        }
        enc = null;
        const got = probeFrames(part);
        if (got !== n) throw new Error(`film: chunk ${c.i} has ${got} frames, expected ${n}`);
        const final = join(dir, 'chunks', `c${pad(c.i)}.${ext}`);
        renameSync(part, final);
        const bytes = readFileSync(final).length;
        const cj: ChunkJson = { chunk: c.i, frames, file: `c${pad(c.i)}.${ext}`, bytes, renderedAt: new Date().toISOString(), chrome };
        writeFileSync(join(dir, 'chunks', `c${pad(c.i)}.json`), JSON.stringify(cj));
        const secs = (Date.now() - ct0) / 1000;
        const done = chunks.length - todo.length + todo.indexOf(c) + 1;
        console.log(`[film] chunk ${c.i} (frames ${c.k0}–${c.k1 - 1}, t ${(c.k0 / run.fps).toFixed(1)}–${(c.k1 / run.fps).toFixed(1)} s): ${secs.toFixed(0)} s, ${(secs / n).toFixed(2)} s/frame, ${(bytes / MB).toFixed(1)} MB · ${done}/${chunks.length} · ${Math.round(freemem() / MB)} MB free · ${freeDiskMB(dir)} MB disk`);
      }
      if (!more) {
        const left = chunks.filter((c) => !chunkDone(dir!, run, c)).length;
        console.log(left ? `[film] ${left} chunks left` : `[film] run complete: ${dir}`);
        if (left) more = true;
      }
      const errs = logs.filter((l) => l.type === 'error' || l.type === 'pageerror');
      if (errs.length) for (const e of errs.slice(0, 10)) console.warn('   [page]', e.text);
    } catch (e) {
      console.error('[film] failed:', e);
      for (const l of logs.slice(-20)) console.error(`   [${l.type}] ${l.text}`);
      if (exitCode === 0) exitCode = 1;
    } finally {
      srv.setHandler(null);
      await session.close();
    }
    if (exitCode !== 0) break;
    if (!more) break;
    if (args.budget > 0) {
      exitCode = 75;
      break;
    }
  }
  console.log(`[film] run: ${dir} · exit ${exitCode} · ${elapsed().toFixed(0)} s`);
  return exitCode;
}

async function verifyResume(args: Args): Promise<number> {
  if (!args.run) throw new Error('film: --verify-resume needs --run <dir>');
  const run = JSON.parse(readFileSync(join(args.run, 'run.json'), 'utf8')) as RunJson;
  const done = chunkList(run).filter((c) => chunkDone(args.run!, run, c));
  if (!done.length) throw new Error('film: no finished chunks to verify');
  const session = await openCaptureSession({ label: 'film verify-resume', port: args.port });
  session.srv.setHandler(async () => {});
  let bad = 0;
  try {
    const { meta } = await bootFilm(session, run.tier);
    if (meta.hash !== run.film.hash) console.warn(`[film] film hash differs: run ${run.film.hash}, now ${meta.hash}`);
    for (const c of done.slice(0, 12)) {
      const j = JSON.parse(readFileSync(join(args.run, 'chunks', `c${pad(c.i)}.json`), 'utf8')) as ChunkJson;
      const f = j.frames[0];
      const res = await session.page.evaluate((r) => window.__mm!.render(r), { name: 'verify', timelineId: 'film', t: f.t, width: run.width, height: run.height, ...(run.spp ? { spp: run.spp } : {}), shutter: run.shutter, fps: run.fps } as CaptureRequest);
      const same = res.sha256 === f.sha256;
      if (!same) bad++;
      console.log(`[film] chunk ${c.i} frame ${f.k}: ${same ? 'IDENTICAL' : 'DIFFERENT'}`);
    }
  } finally {
    await session.close();
  }
  return bad ? 1 : 0;
}

function assemble(args: Args): number {
  if (!args.run) throw new Error('film: --assemble needs --run <dir>');
  const run = JSON.parse(readFileSync(join(args.run, 'run.json'), 'utf8')) as RunJson;
  const chunks = chunkList(run);
  const missing = chunks.filter((c) => !chunkDone(args.run!, run, c));
  if (missing.length) throw new Error(`film: ${missing.length} chunks missing (first: ${missing[0].i}) — finish the render first`);
  const ext = CODEC_EXT[run.codec];
  const files = chunks.map((c) => resolve(args.run!, 'chunks', `c${pad(c.i)}.${ext}`));
  const video = join(args.run, `video.${ext}`);
  concatChunks(files, join(args.run, 'concat.txt'), video);
  const name = args.mp4 ?? `journey-${run.tier}-${run.height}p.mp4`;
  const out = join(args.run, name);
  const duration = (run.frames[1] - run.frames[0]) / run.fps;
  deliver(video, args.audio ?? null, out, { reencode: args.reencode || run.codec !== 'x264', fps: run.fps, duration });
  const got = probeFrames(out);
  console.log(`[film] assembled ${out}: ${got} frames (${duration.toFixed(2)} s)${args.audio ? ` + audio ${args.audio}` : ''}`);
  for (const f of readdirSync(join(args.run, 'partial'))) rmSync(join(args.run, 'partial', f), { force: true });
  return got === run.frames[1] - run.frames[0] ? 0 : 1;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let code = 1;
  try {
    if (args.mode === 'render') code = await render(args);
    else if (args.mode === 'assemble') code = assemble(args);
    else if (args.mode === 'verify-resume') code = await verifyResume(args);
    else code = await stills(args);
  } catch (e) {
    console.error('[film]', e instanceof Error ? e.message : e);
    code = 1;
  }
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
