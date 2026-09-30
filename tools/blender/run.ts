/**
 * Blender GLB pipeline for close-up hero landmarks (S3):
 *
 *   pnpm models [--only <id>[,<id>…]] [--verify]      build public/models/<id>.glb from tools/blender/<id>.py
 *   pnpm models --probe                                 print the Blender version + glTF exporter options
 *
 * Memory guard (≥ 1500 MB available) → the machine-wide heavy-job lock (shared with captures, bake and
 * build) → Blender 4.5 headless, spawned WITHOUT a shell (the install path has spaces):
 *   `$MOME_BLENDER` (default C:\Program Files\Blender Foundation\Blender 4.5\blender.exe)
 *   -b --factory-startup -noaudio --python-exit-code 1 --python tools/blender/<id>.py -- --out <glb>
 * Each script prints one `MOME_STATS {json}` line (tris per LOD, bounds, Blender version, peak memory,
 * build time); the runner hashes the GLB and writes its entry into public/models/manifest.json
 * ({ id, file, sha256, bytes, script, scriptSha256, blender, tris, boundsKm }). `--verify` builds every
 * model a second time into .cache/models/ and requires identical bytes (determinism gate).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { acquireGpuLock, onAbort } from '../capture/gpuLock.ts';
import { fmtMem, waitForMemory } from '../capture/host.ts';
import { MANIFEST, MODELS_DIR, readManifest, scriptHash, sha256, type ModelEntry } from './manifest.ts';

const ROOT = process.cwd();
const BLENDER = process.env.MOME_BLENDER ?? 'C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe';
const NOT_MODELS = new Set(['lib', 'probe']);
/** a hung Blender must never hold the machine-wide GPU lock (normal runs take 20–40 s) */
const TIMEOUT_MS = Number(process.env.MOME_BLENDER_TIMEOUT_MS ?? 600_000);

const argv = process.argv.slice(2);
const flag = (k: string) => argv.includes(k);
const value = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};

interface Stats {
  tris: [number, number, number];
  variants?: Record<string, [number, number, number]>;
  boundsKm: { r: number; h: number };
  blender: string;
  peakMB?: number;
  ms?: number;
}

interface RunResult {
  code: number;
  stats: Stats | null;
  ms: number;
  lines: string[];
}

/** Run one Blender script headless (no shell); stream its output, collect `MOME_*` lines. */
function blender(script: string, extra: string[]): Promise<RunResult> {
  if (!existsSync(BLENDER)) throw new Error(`Blender not found at ${BLENDER} (set MOME_BLENDER)`);
  const args = ['-b', '--factory-startup', '-noaudio', '--python-exit-code', '1', '--python', script, '--', ...extra];
  const t0 = performance.now(); // diagnostics
  return new Promise((resolve, reject) => {
    const child = spawn(BLENDER, args, { cwd: ROOT, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    const kill = () => {
      if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill();
    };
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, TIMEOUT_MS);
    const off = onAbort(kill);
    const lines: string[] = [];
    let buf = '';
    const feed = (chunk: Buffer, err: boolean) => {
      buf += chunk.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line.startsWith('MOME_')) lines.push(line);
        if (err || /^(MOME_|Error|Traceback|  File|\w*Error)/.test(line) || line.includes('[blender]')) (err ? process.stderr : process.stdout).write(`  ${line}\n`);
      }
    };
    child.stdout.on('data', (c: Buffer) => feed(c, false));
    child.stderr.on('data', (c: Buffer) => feed(c, true));
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      off();
      if (timedOut) console.error(`[models] ${script} timed out after ${Math.round(TIMEOUT_MS / 1000)} s — killed`);
      if (buf) lines.push(buf);
      const st = lines.find((l) => l.startsWith('MOME_STATS '));
      resolve({ code: timedOut ? 1 : (code ?? 1), stats: st ? (JSON.parse(st.slice('MOME_STATS '.length)) as Stats) : null, ms: Math.round(performance.now() - t0), lines });
    });
  });
}

function modelIds(): string[] {
  const all = readdirSync(join(ROOT, 'tools/blender'))
    .filter((f) => f.endsWith('.py'))
    .map((f) => f.slice(0, -3))
    .filter((id) => !NOT_MODELS.has(id))
    .sort();
  const only = value('--only')?.split(',');
  if (only) for (const id of only) if (!all.includes(id)) throw new Error(`no tools/blender/${id}.py`);
  return only ?? all;
}

const probe = flag('--probe');
const verify = flag('--verify');
const ids = probe ? [] : modelIds();
if (!probe && !ids.length) {
  console.log('[models] no model scripts in tools/blender/');
  process.exit(0);
}

const mem = await waitForMemory({ minAvailMB: 1500, label: 'blender models' });
const release = await acquireGpuLock(`models ${probe ? 'probe' : ids.join(',')}`);
console.log(`[models] ${fmtMem(mem)} · ${BLENDER}`);

let failed = 0;
try {
  if (probe) {
    const r = await blender('tools/blender/probe.py', []);
    for (const l of r.lines) if (l.startsWith('MOME_PROBE')) console.log(l.slice('MOME_PROBE '.length));
    if (r.code) failed++;
  } else {
    mkdirSync(join(ROOT, MODELS_DIR), { recursive: true });
    const manifest = readManifest(ROOT);
    manifest.notes =
      'Original models generated by tools/blender/<id>.py in this repository (pnpm models); see CREDITS.md "Models". ' +
      'sha256 = the GLB bytes; scriptSha256 = sha256(script + NUL + tools/blender/lib.py) for the staleness check in pnpm check.';
    for (const id of ids) {
      const script = `tools/blender/${id}.py`;
      const file = `${id}.glb`;
      const out = join(ROOT, MODELS_DIR, file);
      console.log(`[models] ${id}: building ${MODELS_DIR}/${file}…`);
      const r = await blender(script, ['--out', out]);
      if (r.code || !r.stats || !existsSync(out)) {
        console.error(`[models] ${id}: Blender failed (exit ${r.code}${r.stats ? '' : ', no MOME_STATS line'})`);
        failed++;
        continue;
      }
      const bytes = readFileSync(out);
      const entry: ModelEntry = {
        id,
        file,
        sha256: sha256(bytes),
        bytes: bytes.length,
        script,
        scriptSha256: scriptHash(ROOT, script),
        blender: r.stats.blender,
        tris: r.stats.tris,
        ...(r.stats.variants ? { variants: r.stats.variants } : {}),
        boundsKm: r.stats.boundsKm,
      };
      console.log(
        `[models] ${id}: ${(bytes.length / 1048576).toFixed(2)} MB, tris ${entry.tris.join(' / ')}` +
          Object.entries(entry.variants ?? {}).map(([k, t]) => ` + ${k} ${t.join(' / ')}`).join('') +
          `, bounds r ${entry.boundsKm.r} h ${entry.boundsKm.h} km, ` +
          `Blender ${r.ms} ms wall (script ${r.stats.ms ?? '?'} ms), peak ${r.stats.peakMB ?? '?'} MB, sha256 ${entry.sha256.slice(0, 16)}…`,
      );
      if (verify) {
        const dir = join(ROOT, '.cache/models');
        mkdirSync(dir, { recursive: true });
        const again = join(dir, `${id}.verify.glb`);
        rmSync(again, { force: true });
        const r2 = await blender(script, ['--out', again]);
        const h2 = r2.code === 0 && existsSync(again) ? sha256(readFileSync(again)) : '(failed)';
        const same = h2 === entry.sha256;
        console.log(`[models] ${id}: verify ${same ? 'IDENTICAL' : 'DIFFERENT'} (${entry.sha256.slice(0, 16)}… vs ${h2.slice(0, 16)}…, ${statSync(out).size} vs ${existsSync(again) ? statSync(again).size : 0} bytes)`);
        if (!same) failed++;
      }
      manifest.models = [...manifest.models.filter((m) => m.id !== id), entry].sort((a, b) => a.id.localeCompare(b.id));
    }
    writeFileSync(join(ROOT, MANIFEST), JSON.stringify(manifest, null, 1) + '\n');
    console.log(`[models] wrote ${MANIFEST}`);
  }
} finally {
  release();
}
process.exit(failed ? 1 : 0);
