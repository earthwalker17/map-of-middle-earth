/**
 * Render named QA shots (or the smoke test) through the page's readback API.
 *
 *   pnpm shots --smoke
 *   pnpm shots --shot overview-day --shot shire-close [--spp 4] [--w 1920 --h 1080]
 *   pnpm shots --all [--tod 18.5] [--quality final] [--determinism] [--headed]
 *
 * Output: renders/shots/<stamp>/<name>.png + manifest.json, mirrored to renders/shots/latest/.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { acquireGpuLock } from './gpuLock.ts';
import { startCaptureServer } from './server.ts';
import { browserVersion, collectConsole, launchChrome } from './browser.ts';
import type { ShotSpec } from '../../src/core/Timeline.ts';
import type { CaptureResult } from '../../src/render/capture.ts';

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
}

function parseArgs(argv: string[]): Args {
  const a: Args = { smoke: false, shots: [], all: false, w: 1920, h: 1080, headed: false, determinism: false, port: 5199 };
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
  }
  return a;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function loadShots(): ShotSpec[] {
  const file = join(process.cwd(), 'data', 'qa', 'shots.json');
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, 'utf8')) as { shots: ShotSpec[] }).shots;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.out ?? join('renders', 'shots', stamp());
  mkdirSync(outDir, { recursive: true });

  const release = await acquireGpuLock(`shots ${args.smoke ? 'smoke' : args.shots.join(',') || 'all'}`);
  const srv = await startCaptureServer(args.port);
  const ctx = await launchChrome({ headed: args.headed });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.setDefaultTimeout(0);
  const logs = collectConsole(page);
  const results: (CaptureResult & { file: string })[] = [];

  srv.setHandler(async ({ name, width, height, rgba }) => {
    const file = join(outDir, `${name}.png`);
    await sharp(rgba, { raw: { width, height, channels: 4 } }).removeAlpha().png({ compressionLevel: 6 }).toFile(file);
  });

  let exitCode = 0;
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
      const missing = args.shots.filter((id) => !all.some((s) => s.id === id));
      if (missing.length) throw new Error(`unknown shots: ${missing.join(', ')} (see data/qa/shots.json)`);
      if (!wanted.length) throw new Error('no shots selected (use --shot <id> or --all)');

      await page.goto(`${srv.url}/?capture=1&quality=${args.quality ?? 'review'}`);
      await page.waitForFunction(() => Boolean(window.__mm), undefined, { timeout: 120_000 });
      await page.evaluate(() => window.__mm!.ready);
      const info = await page.evaluate(() => window.__mm!.info());
      console.log(`[shots] ${info.gpu.vendor}/${info.gpu.architecture} ${info.gpu.backend} three r${info.three}`);
      if (info.gpu.backend !== 'webgpu' || info.gpu.isFallback) throw new Error('not running on hardware WebGPU');

      for (const shot of wanted) {
        const spec: ShotSpec = { ...shot, tod: args.tod ?? shot.tod, quality: (args.quality as ShotSpec['quality']) ?? shot.quality };
        const res = await page.evaluate((req) => window.__mm!.render(req), { name: shot.id, shot: spec, width: args.w, height: args.h, spp: args.spp });
        results.push({ ...res, file: `${shot.id}.png` });
        console.log(`[shots] ${shot.id}: ${Math.round(res.renderMs)} ms, spp ${res.spp}, luma ${res.meanLuma.toFixed(1)}`);
        if (res.meanLuma < 3) console.warn(`[shots] WARNING: ${shot.id} is (nearly) black`);
      }
      if (args.determinism && wanted.length) {
        const shot = wanted[0];
        const again = await page.evaluate((req) => window.__mm!.render(req), { name: `${shot.id}__repeat`, shot, width: args.w, height: args.h, spp: args.spp });
        const same = again.sha256 === results[0].sha256;
        console.log(`[shots] determinism (${shot.id} rendered twice): ${same ? 'IDENTICAL' : 'DIFFERENT'}`);
        if (!same) exitCode = 1;
      }
      writeFileSync(
        join(outDir, 'manifest.json'),
        JSON.stringify({ createdAt: new Date().toISOString(), chrome: await browserVersion(ctx), info, args, results, logs }, null, 2),
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
    await ctx.close();
    await srv.close();
    release();
  }
  const latest = join('renders', 'shots', 'latest');
  rmSync(latest, { recursive: true, force: true });
  cpSync(outDir, latest, { recursive: true });
  console.log(`[shots] output: ${outDir}`);
  process.exit(exitCode);
}

main();
