/**
 * The journey film renderer (S5): frames of the compiled film timeline (`?film=1`, timeline 'film').
 *
 *   pnpm film --at 12,20.5,48 [--tier review] [--w 1280 --h 720] [--spp 2] [--shutter 0.5] [--label x]
 *   pnpm film --every 2 [--from 0 --to 60]          stills every N seconds (storyboard)
 *   pnpm film --beats hobbiton,rivendell             one still at the middle of each named beat
 *   pnpm film --at 30 --determinism                  re-render the first still after the batch: IDENTICAL?
 *
 * Stills: renders/film/stills-<stamp>/<tier>/f<frame>.png + manifest.json + sheet.png (labelled
 * "t · beat · tod" contact sheet). Times snap to whole frames (t = round(t·fps) / fps).
 * One invocation = one bounded capture session (memory guard → GPU lock → Vite + Chrome) in the
 * foreground; keep a call under ~10 minutes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import type { CaptureRequest, CaptureResult } from '../../src/render/capture.ts';
import type { FilmMeta } from '../../src/tour/schema.ts';
import { browserVersion, collectGarbage } from './browser.ts';
import { grid, labelled } from './compose.ts';
import { bootCapturePage, openCaptureSession, withTimeout } from './session.ts';

interface Args {
  at: number[];
  every?: number;
  from: number;
  to?: number;
  beats: string[];
  tier: string;
  w: number;
  h: number;
  spp?: number;
  shutter: number;
  label?: string;
  out?: string;
  determinism: boolean;
  headed: boolean;
  port: number;
  sheetCols: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { at: [], from: 0, beats: [], tier: 'review', w: 1280, h: 720, shutter: 0, determinism: false, headed: false, port: 5199, sheetCols: 4 };
  const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--at') a.at.push(...list(v()).map(Number));
    else if (k === '--every') a.every = Number(v());
    else if (k === '--from') a.from = Number(v());
    else if (k === '--to') a.to = Number(v());
    else if (k === '--beats') a.beats.push(...list(v()));
    else if (k === '--tier' || k === '--quality') a.tier = v();
    else if (k === '--w') a.w = Number(v());
    else if (k === '--h') a.h = Number(v());
    else if (k === '--spp') a.spp = Number(v());
    else if (k === '--shutter') a.shutter = Number(v());
    else if (k === '--label') a.label = v();
    else if (k === '--out') a.out = v();
    else if (k === '--determinism') a.determinism = true;
    else if (k === '--headed') a.headed = true;
    else if (k === '--port') a.port = Number(v());
    else if (k === '--cols') a.sheetCols = Number(v());
    else throw new Error(`film: unknown argument ${k}`);
  }
  return a;
}

const RENDER_TIMEOUT = 10 * 60_000;
const ABORT_FREE_MB = Number(process.env.MOME_ABORT_FREE_MB ?? 500);
const MB = 1024 * 1024;

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** the beat a film time falls in */
export function beatAt(meta: FilmMeta, t: number): FilmMeta['beats'][number] {
  return meta.beats.find((b) => t >= b.t0 && t < b.t1) ?? meta.beats[meta.beats.length - 1];
}

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
    await bootCapturePage(session, args.tier, '&film=1');
    const info = await page.evaluate(() => window.__mm!.info());
    if (info.gpu.backend !== 'webgpu' || info.gpu.isFallback) throw new Error('not running on hardware WebGPU');
    const tl = await page.evaluate(() => window.__mm!.timelineInfo('film'));
    if (!tl) throw new Error('film timeline not registered (boot ?film=1)');
    const meta = tl.meta as FilmMeta;
    console.log(`[film] ${info.gpu.vendor}/${info.gpu.architecture} · film ${meta.hash} · ${meta.duration.toFixed(1)} s · ${meta.beats.length} beats · ${meta.status}`);

    // ---- times (frame-exact)
    const times: number[] = [...args.at];
    if (args.every) for (let t = args.from; t <= (args.to ?? meta.duration) + 1e-9; t += args.every) times.push(t);
    for (const id of args.beats) {
      const b = meta.beats.find((x) => x.id === id);
      if (!b) throw new Error(`film: unknown beat '${id}' (beats: ${meta.beats.map((x) => x.id).join(', ')})`);
      times.push((b.t0 + b.t1) / 2);
    }
    if (!times.length) throw new Error('film: nothing to render (use --at, --every or --beats)');
    const frames = [...new Set(times.map((t) => Math.min(Math.round(meta.duration * meta.fps), Math.max(0, Math.round(t * meta.fps)))))];

    const results: (CaptureResult & { frame: number; t: number; beat: string; tod: number; file: string })[] = [];
    for (const [k, frame] of frames.entries()) {
      const t = frame / meta.fps;
      const name = `f${String(frame).padStart(5, '0')}`;
      const req: CaptureRequest = { name, timelineId: 'film', t, width: args.w, height: args.h, spp: args.spp, shutter: args.shutter, fps: meta.fps };
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
      const again = await page.evaluate((r) => window.__mm!.render(r), { name: `${f.file.replace('.png', '')}__repeat`, timelineId: 'film', t: f.t, width: args.w, height: args.h, spp: args.spp, shutter: args.shutter, fps: meta.fps } as CaptureRequest);
      const same = again.sha256 === f.sha256;
      console.log(`[film] determinism (${f.file} after ${results.length} frames): ${same ? 'IDENTICAL' : 'DIFFERENT'}`);
      if (!same) exitCode = 1;
    }
    // ---- contact sheet
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  process.exit(await stills(args));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
