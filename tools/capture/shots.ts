/**
 * Render named QA shots (or the smoke test) through the page's readback API.
 *
 *   pnpm shots --smoke
 *   pnpm shots --shot overview-day --shot shire-close [--spp 4] [--w 1920 --h 1080]
 *   pnpm shots --all [--tod 18.5] [--quality final] [--determinism] [--headed]
 *
 * One invocation = one bounded batch (fresh Vite + Chrome). Prefer `pnpm qa --batch 8` for sets.
 * Output: renders/shots/<stamp>/<name>.png + manifest[-<batch>].json, mirrored to
 * renders/shots/latest/ unless --no-latest.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { browserVersion, collectGarbage } from './browser.ts';
import type { ShotSpecInput as ShotSpec } from '../../src/camera/shots.ts';
import { loadShots } from './shotList.ts';
import { pathToFileURL } from 'node:url';
import type { CaptureRequest, CaptureResult } from '../../src/render/capture.ts';
import { captureFootprint } from './host.ts';
import { bootCapturePage, openCaptureSession, withTimeout } from './session.ts';

interface Args {
  smoke: boolean;
  shots: string[];
  all: boolean;
  spp?: number;
  w: number;
  h: number;
  tod?: number;
  quality?: string;
  out?: string;
  headed: boolean;
  determinism: boolean;
  port: number;
  batch?: string;
  latest: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { smoke: false, shots: [], all: false, w: 1920, h: 1080, headed: false, determinism: false, port: 5199, latest: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--smoke') a.smoke = true;
    else if (k === '--shot') a.shots.push(v());
    else if (k === '--all') a.all = true;
    else if (k === '--spp') a.spp = Number(v());
    else if (k === '--w') a.w = Number(v());
    else if (k === '--h') a.h = Number(v());
    else if (k === '--tod') a.tod = Number(v());
    else if (k === '--quality') a.quality = v();
    else if (k === '--out') a.out = v();
    else if (k === '--headed') a.headed = true;
    else if (k === '--determinism') a.determinism = true;
    else if (k === '--port') a.port = Number(v());
    else if (k === '--batch') a.batch = v();
    else if (k === '--no-latest') a.latest = false;
  }
  return a;
}

const RENDER_TIMEOUT = 10 * 60_000;
/** stop the batch (exit 3) if the host falls below this much available memory between shots */
const ABORT_FREE_MB = Number(process.env.MOME_ABORT_FREE_MB ?? 500);
const MB = 1024 * 1024;

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export { loadShots };

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.out ?? join('renders', 'shots', stamp());
  mkdirSync(outDir, { recursive: true });
  sharp.cache(false);
  sharp.concurrency(1);

  const label = `shots ${args.smoke ? 'smoke' : args.batch ? `batch ${args.batch}` : args.shots.join(',') || 'all'}`;
  const session = await openCaptureSession({ label, port: args.port, headed: args.headed });
  const { srv, ctx, page, logs } = session;
  const results: (CaptureResult & { file: string; freeMB: number; rssMB: number })[] = [];

  srv.setHandler(async ({ name, width, height, rgba }) => {
    const file = join(outDir, `${name}.png`);
    await sharp(rgba, { raw: { width, height, channels: 4 } }).removeAlpha().png({ compressionLevel: 6 }).toFile(file);
  });

  let exitCode = 0;
  let footprint: ReturnType<typeof captureFootprint> | null = null;
  try {
    if (args.smoke) {
      await page.goto(`${srv.url}/?smoke=1`);
      const report = await page.evaluate(() => window.__smoke!);
      console.log(JSON.stringify(report, null, 2));
      writeFileSync(join(outDir, 'smoke.json'), JSON.stringify({ report, logs, chrome: await browserVersion(ctx) }, null, 2));
      const ok = report.backend === 'webgpu' && !report.isFallback && report.readbackNonBlack && report.reversedDepthOk && report.displacementOk;
      console.log(ok ? 'SMOKE: PASS' : 'SMOKE: FAIL');
      if (!ok) exitCode = 1;
    } else {
      const all = loadShots();
      const wanted = args.all ? all : all.filter((s) => args.shots.includes(s.id));
      // ids not in the JSON files are resolved by the page (landmark bookmarks)
      const pageShots = args.shots.filter((id) => !all.some((s) => s.id === id));
      if (!wanted.length && !pageShots.length) throw new Error('no shots selected (use --shot <id> or --all)');

      await bootCapturePage(session, args.quality ?? 'review');
      const info = await page.evaluate(() => window.__mm!.info());
      console.log(`[shots] ${info.gpu.vendor}/${info.gpu.architecture} ${info.gpu.backend} three r${info.three}`);
      if (info.gpu.backend !== 'webgpu' || info.gpu.isFallback) throw new Error('not running on hardware WebGPU');

      type Job = { id: string; req: CaptureRequest };
      const jobs: Job[] = [
        ...wanted.map((shot) => {
          const spec: ShotSpec = { ...shot, tod: args.tod ?? shot.tod, quality: (args.quality as ShotSpec['quality']) ?? shot.quality };
          return { id: shot.id, req: { name: shot.id, shot: spec, width: args.w, height: args.h, spp: args.spp } };
        }),
        ...pageShots.map((id) => ({ id, req: { name: id, shotId: id, tod: args.tod, width: args.w, height: args.h, spp: args.spp } })),
      ];
      for (const [k, job] of jobs.entries()) {
        const res = await withTimeout(page.evaluate((req) => window.__mm!.render(req), job.req), RENDER_TIMEOUT, `render ${job.id}`);
        await collectGarbage(ctx, page);
        const freeMB = Math.round(freemem() / MB);
        const rssMB = Math.round(process.memoryUsage().rss / MB);
        results.push({ ...res, file: `${job.id}.png`, freeMB, rssMB });
        console.log(`[shots] ${job.id}: ${Math.round(res.renderMs)} ms, spp ${res.spp}, luma ${res.meanLuma.toFixed(1)} · host ${freeMB} MB free, node ${rssMB} MB`);
        if (res.meanLuma < 3) console.warn(`[shots] WARNING: ${job.id} is (nearly) black`);
        if (freeMB < ABORT_FREE_MB && k < jobs.length - 1) {
          console.error(`[shots] host memory low (${freeMB} MB < ${ABORT_FREE_MB} MB): stopping this batch after ${k + 1}/${jobs.length} shots`);
          exitCode = 3;
          break;
        }
      }
      if (args.determinism && jobs.length && exitCode === 0) {
        // repeat the first job's exact request (JSON shot or page-resolved bookmark, with any --tod override)
        const first = jobs[0];
        const again = await page.evaluate((req) => window.__mm!.render(req), { ...first.req, name: `${first.id}__repeat` });
        const same = again.sha256 === results[0].sha256;
        console.log(`[shots] determinism (${first.id} rendered twice): ${same ? 'IDENTICAL' : 'DIFFERENT'}`);
        if (!same) exitCode = 1;
      }
      footprint = captureFootprint();
      console.log(`[shots] footprint: chrome ${footprint.chromeMB} MB in ${footprint.chromeProcs} processes, node ${footprint.nodeMB} MB`);
      writeFileSync(
        join(outDir, args.batch ? `manifest-${args.batch}.json` : 'manifest.json'),
        JSON.stringify(
          { createdAt: new Date().toISOString(), chrome: await browserVersion(ctx), info, args, memAtStart: session.memAtStart, footprint, results, logs },
          null,
          2,
        ),
      );
    }
    const errs = logs.filter((l) => l.type === 'error' || l.type === 'pageerror');
    if (errs.length) {
      console.warn(`[shots] ${errs.length} console error(s):`);
      for (const e of errs.slice(0, 20)) console.warn('   ', e.text);
    }
  } catch (e) {
    console.error('[shots] failed:', e);
    for (const l of logs.slice(-30)) console.error(`   [${l.type}] ${l.text}`);
    exitCode = 1;
  } finally {
    await session.close();
  }
  if (args.latest) {
    const latest = join('renders', 'shots', 'latest');
    rmSync(latest, { recursive: true, force: true });
    cpSync(outDir, latest, { recursive: true });
  }
  console.log(`[shots] output: ${outDir}`);
  process.exit(exitCode);
}

// run only when executed directly (never on import)
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
