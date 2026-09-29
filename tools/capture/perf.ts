/**
 * Performance gate (preview tier, interactive path):
 *
 *   pnpm perf                          measure → renders/perf/<stamp>.json (+ latest.json)
 *   pnpm perf --save-baseline s1       also write data/qa/perf-baseline.json (committed)
 *   pnpm perf --gate                   fail (exit 1) if over budget vs data/qa/perf-baseline.json
 *
 * Measures boot milestones (world load, per-system init, pipeline compile) and per-view frame
 * latency (each frame awaited to GPU completion, small camera orbit) at 1280×720.
 * Budget: median ≤ max(baseline × 1.25, 33 ms) per view, compile ≤ baseline + 20 %.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BenchResult } from '../../src/render/capture.ts';
import { captureFootprint } from './host.ts';
import { bootCapturePage, openCaptureSession, withTimeout } from './session.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const VIEWS = (arg('views') ?? 'overview-day,shire,anduin-gondor').split(',');
const QUALITY = arg('quality') ?? 'preview';
const W = Number(arg('w') ?? 1280);
const H = Number(arg('h') ?? 720);
const FRAMES = Number(arg('frames') ?? 60);
const BASELINE = join('data', 'qa', 'perf-baseline.json');

interface PerfReport {
  createdAt: string;
  label?: string;
  quality: string;
  width: number;
  height: number;
  gpu: string;
  timings: Record<string, number>;
  compileMs: number;
  bootMs: number;
  jsHeapMB: number | null;
  footprint: ReturnType<typeof captureFootprint>;
  views: BenchResult[];
}

const d = new Date();
const p2 = (n: number) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;

const session = await openCaptureSession({ label: 'perf', port: 5197 });
let report: PerfReport | null = null;
try {
  await bootCapturePage(session, QUALITY);
  const info = await session.page.evaluate(() => window.__mm!.info());
  const views: BenchResult[] = [];
  for (const id of VIEWS) {
    const r = await withTimeout(
      session.page.evaluate((req) => window.__mm!.benchmark(req), { name: id, shotId: id, width: W, height: H, frames: FRAMES, warmup: 10, orbitDeg: 6 }),
      5 * 60_000,
      `benchmark ${id}`,
    );
    views.push(r);
    console.log(`[perf] ${id}: median ${r.medianMs.toFixed(1)} ms · p95 ${r.p95Ms.toFixed(1)} ms · max ${r.maxMs.toFixed(1)} ms`);
  }
  const t = info.timings;
  const lastInit = Math.max(...Object.entries(t).filter(([k]) => k.startsWith('init:')).map(([, v]) => v));
  report = {
    createdAt: new Date().toISOString(),
    label: arg('save-baseline'),
    quality: QUALITY,
    width: W,
    height: H,
    gpu: `${info.gpu.vendor}/${info.gpu.architecture}`,
    timings: t,
    compileMs: (t.compiled ?? 0) - lastInit,
    bootMs: t.warm ?? 0,
    jsHeapMB: info.jsHeapMB,
    footprint: captureFootprint(),
    views,
  };
  console.log(`[perf] boot ${report.bootMs} ms (compile ${report.compileMs} ms) · js heap ${report.jsHeapMB} MB · chrome ${report.footprint.chromeMB} MB`);
} finally {
  await session.close();
}

mkdirSync(join('renders', 'perf'), { recursive: true });
writeFileSync(join('renders', 'perf', `${stamp}.json`), JSON.stringify(report, null, 2));
writeFileSync(join('renders', 'perf', 'latest.json'), JSON.stringify(report, null, 2));
if (arg('save-baseline')) {
  writeFileSync(BASELINE, JSON.stringify(report, null, 2) + '\n');
  console.log(`[perf] baseline saved → ${BASELINE}`);
}

let exit = 0;
if (existsSync(BASELINE) && report) {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as PerfReport;
  for (const v of report.views) {
    const b = base.views.find((x) => x.name === v.name);
    if (!b) continue;
    const budget = Math.max(b.medianMs * 1.25, 33);
    const ok = v.medianMs <= budget;
    console.log(`[perf] ${v.name}: ${v.medianMs.toFixed(1)} ms vs baseline ${b.medianMs.toFixed(1)} ms (budget ${budget.toFixed(1)}) ${ok ? 'OK' : 'OVER'}`);
    if (!ok) exit = 1;
  }
  const cBudget = base.compileMs * 1.2;
  const cOk = report.compileMs <= cBudget;
  console.log(`[perf] compile: ${report.compileMs} ms vs baseline ${base.compileMs} ms (budget ${Math.round(cBudget)}) ${cOk ? 'OK' : 'OVER'}`);
  if (!cOk) exit = 1;
}
process.exit(has('gate') ? exit : 0);
