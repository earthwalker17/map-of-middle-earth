/**
 * Pixel-hash lock of the static world (CPU only — reads QA run manifests, never renders):
 *
 *   pnpm lock --write <run> [--set lock-v1] [--out data/qa/lock-v1.json]
 *   pnpm lock --verify <run> [--lock data/qa/lock-v1.json]
 *   pnpm lock --compare <runA> <runB> [--only id1,id2] [--strict]
 *
 * <run> = a QA run folder (renders/qa/<stamp>) or its shots/ folder (any folder holding the per-batch
 * manifests `manifest(-N).json` with `results[]` = { name, sha256, width, height, spp }, top-level
 * `chrome`, `info` (GPU, quality tier) and `args` (a `tod` override)). Rendering is deterministic for a
 * fixed code + Chrome + display driver + size / spp / tier, so the per-shot pixel sha256 of a set is a
 * sentinel: re-render the set and verify that nothing changed.
 *
 *  --write    records the set's hashes with the settings (w / h / spp / tier / tod override — one value
 *             across the set, else an error), Chrome, GPU info, the Windows display driver version (queried
 *             now: run manifests do not record it; skipped off Windows), the commit (+ dirty flag) and the
 *             run path. Every id of the set must be in the run.
 *  --verify   per lock id IDENTICAL / DIFFERENT / MISSING. Exit 0 all identical · 3 settings differ (not
 *             comparable) · 2 Chrome or driver differ from the lock (hashes advisory) · 1 any DIFFERENT /
 *             MISSING in the same environment.
 *  --compare  the shots present in both runs (IDENTICAL / DIFFERENT) and the ones in only one; exit 0
 *             (informational) unless --strict (then 1 on any DIFFERENT / one-sided id, 3 on other settings).
 * Usage errors (unknown set, ids missing from a --write run, no manifests) exit 64.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fwd, readRun, showPath, type Settings, type Shot } from './runs.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

interface LockFile {
  version: number;
  set: string;
  createdAt: string;
  commit: string;
  dirty: boolean;
  run: string;
  settings: Settings;
  chrome: string;
  gpu: unknown;
  three: string | null;
  driver: string | null;
  driverAdapter: string | null;
  notes: string;
  shots: Record<string, string>;
}

const ROOT = process.cwd();

const fmtSettings = (s: Settings) => `${s.w}×${s.h} spp ${s.spp} ${s.quality}${s.tod !== null ? ` tod ${s.tod}` : ''}`;
const sameSettings = (a: Settings, b: Settings) => a.w === b.w && a.h === b.h && a.spp === b.spp && a.quality === b.quality && a.tod === b.tod;
/** the one value of `pick` over the shots, else null (with the distinct values) */
function uniform<T>(shots: Shot[], pick: (s: Shot) => T, key: (v: T) => string = (v) => JSON.stringify(v)): { value: T | null; values: string[] } {
  const seen = new Map<string, T>();
  for (const s of shots) {
    const v = pick(s);
    seen.set(key(v), v);
  }
  return seen.size === 1 ? { value: [...seen.values()][0], values: [...seen.keys()] } : { value: null, values: [...seen.keys()] };
}

// ------------------------------------------------------------------ environment
function displayDriver(gpuDescription?: string): { version: string | null; adapter: string | null } {
  if (process.platform !== 'win32') return { version: null, adapter: null };
  try {
    const out = execSync(`powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController) | ForEach-Object { $_.Name + '|' + $_.DriverVersion }"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30000,
    });
    const rows = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [name, version] = l.split('|');
        return { name: name.trim(), version: (version ?? '').trim() };
      })
      .filter((r) => r.version);
    if (!rows.length) return { version: null, adapter: null };
    const hit = (gpuDescription && rows.find((r) => r.name.toLowerCase() === gpuDescription.toLowerCase())) || (rows.length === 1 ? rows[0] : null);
    if (hit) return { version: hit.version, adapter: hit.name };
    return { version: rows.map((r) => r.version).join(', '), adapter: rows.map((r) => r.name).join(', ') };
  } catch {
    return { version: null, adapter: null };
  }
}
const gpuDescription = (gpu: unknown) => (gpu && typeof gpu === 'object' && 'description' in gpu ? String((gpu as { description: unknown }).description) : undefined);
const git = (cmd: string) => {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

function table(rows: { id: string; status: string; a?: string; b?: string }[], heads: [string, string]): void {
  const w = Math.max(8, ...rows.map((r) => r.id.length));
  console.log(`  ${'shot'.padEnd(w)}  ${'status'.padEnd(9)}  ${heads[0].padEnd(12)}  ${heads[1]}`);
  for (const r of rows) console.log(`  ${r.id.padEnd(w)}  ${r.status.padEnd(9)}  ${(r.a ?? '—').slice(0, 12).padEnd(12)}  ${(r.b ?? '—').slice(0, 12)}`);
}

// ------------------------------------------------------------------ --write
function write(runPath: string): number {
  const setName = arg('set') ?? 'lock-v1';
  const outFile = arg('out') ?? join('data', 'qa', `${setName.startsWith('lock-') ? setName : `lock-${setName}`}.json`);
  const sets = (JSON.parse(readFileSync(join(ROOT, 'data', 'qa', 'sets.json'), 'utf8')) as { sets: Record<string, string[]> }).sets;
  const ids = sets[setName];
  if (!ids) throw new Error(`lock: unknown set '${setName}' (data/qa/sets.json)`);
  const run = readRun(runPath);
  const missing = ids.filter((id) => !run.shots.has(id));
  if (missing.length) throw new Error(`lock: ${missing.length} id(s) of set ${setName} missing in ${run.dir}: ${missing.join(', ')}`);
  const shots = ids.map((id) => run.shots.get(id)!);
  const st = uniform(shots, (s) => s.settings, fmtSettings);
  if (!st.value) throw new Error(`lock: the set's settings differ inside the run (${st.values.join(' | ')}) — render it in one go`);
  const ch = uniform(shots, (s) => s.chrome, String);
  if (!ch.value) throw new Error(`lock: the run mixes Chrome versions (${ch.values.join(', ')})`);
  const gpu = uniform(shots, (s) => s.gpu);
  if (gpu.value === null && gpu.values.length > 1) throw new Error(`lock: the run mixes GPUs (${gpu.values.join(' | ')})`);
  const three = uniform(shots, (s) => s.three).value;
  const recorded = uniform(shots, (s) => s.driver).value;
  const queried = displayDriver(gpuDescription(gpu.value));
  const driver = recorded ?? queried.version;
  const s = st.value;
  const cmd = `pnpm qa --set ${setName} --w ${s.w} --h ${s.h} --spp ${s.spp}${s.quality !== 'review' ? ` --quality ${s.quality}` : ''}${s.tod !== null ? ` --tod ${s.tod}` : ''} --batch 13 --label ${setName}-verify`;
  const lock: LockFile = {
    version: 1,
    set: setName,
    createdAt: new Date().toISOString(), // tooling metadata
    commit: git('rev-parse HEAD'),
    dirty: git('status --porcelain --untracked-files=no').length > 0,
    run: showPath(runPath),
    settings: s,
    chrome: ch.value,
    gpu: gpu.value,
    three,
    driver,
    driverAdapter: recorded ? null : queried.adapter,
    notes:
      `Pixel-hash lock of the static world: the pixel sha256 of every shot of set ${setName} rendered at ${fmtSettings(s)} in Chrome ${ch.value} on ${gpuDescription(gpu.value) ?? 'an unknown GPU'}` +
      `${driver ? ` (display driver ${driver}${recorded ? '' : ', queried when the lock was written'})` : ''}. Rendering is deterministic for a fixed code + Chrome + driver + settings, so a shot whose hash changes ` +
      `was changed by the code. Verify: ${cmd}, then pnpm lock --verify renders/qa/<stamp> (exit 0 identical, 1 changed / missing, 2 Chrome or driver differ — hashes advisory, ` +
      `3 other settings — not comparable). After a Chrome or driver update, re-render the set on the locked code and re-write the lock (pnpm lock --write <run> --set ${setName}) before judging changes. ` +
      `Commit = the checkout the lock was written from (dirty = uncommitted tracked changes).`,
    shots: Object.fromEntries(shots.map((x) => [x.id, x.sha256])),
  };
  mkdirSync(dirname(resolve(outFile)), { recursive: true });
  writeFileSync(outFile, JSON.stringify(lock, null, 2) + '\n');
  console.log(`[lock] wrote ${fwd(outFile)}: ${ids.length} shots of ${setName} · ${fmtSettings(s)} · Chrome ${ch.value} · driver ${driver ?? 'unknown'} · commit ${lock.commit.slice(0, 10)}${lock.dirty ? ' (dirty)' : ''}`);
  return 0;
}

// ------------------------------------------------------------------ --verify
function verify(runPath: string): number {
  const lockFile = arg('lock') ?? join('data', 'qa', 'lock-v1.json');
  const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as LockFile;
  const run = readRun(runPath);
  const ids = Object.keys(lock.shots);
  const present = ids.filter((id) => run.shots.has(id)).map((id) => run.shots.get(id)!);
  console.log(`[lock] verify ${showPath(run.dir)} against ${fwd(lockFile)} (set ${lock.set}, ${ids.length} shots, written ${lock.createdAt.slice(0, 10)} at ${lock.commit.slice(0, 10)})`);

  // settings: one value over the lock's shots in the run, equal to the lock's
  const st = uniform(present, (s) => s.settings, fmtSettings);
  const settingsOk = !!st.value && sameSettings(st.value, lock.settings);
  // environment: Chrome from the run, driver from the run (if recorded) else queried now
  const ch = uniform(present, (s) => s.chrome, String);
  const recorded = uniform(present, (s) => s.driver).value;
  const driver = recorded ?? displayDriver(gpuDescription(uniform(present, (s) => s.gpu).value)).version;
  const chromeOk = ch.value === lock.chrome;
  const driverOk = !lock.driver || !driver || driver === lock.driver;

  const rows = ids.map((id) => {
    const s = run.shots.get(id);
    return { id, status: !s ? 'MISSING' : s.sha256 === lock.shots[id] ? 'IDENTICAL' : 'DIFFERENT', a: lock.shots[id], b: s?.sha256 };
  });
  table(rows, ['lock', 'run']);
  const n = (k: string) => rows.filter((r) => r.status === k).length;
  console.log(`[lock] ${n('IDENTICAL')} identical · ${n('DIFFERENT')} different · ${n('MISSING')} missing (of ${ids.length})`);
  console.log(`[lock] settings  lock ${fmtSettings(lock.settings)} · run ${st.value ? fmtSettings(st.value) : `mixed (${st.values.join(' | ')})`}${settingsOk ? '' : '  ← DIFFER'}`);
  console.log(`[lock] chrome    lock ${lock.chrome} · run ${ch.value ?? `mixed (${ch.values.join(', ')})`}${chromeOk ? '' : '  ← DIFFER'}`);
  console.log(`[lock] driver    lock ${lock.driver ?? 'unknown'} · ${recorded ? 'run' : 'now'} ${driver ?? 'unknown'}${driverOk ? '' : '  ← DIFFER'}`);
  if (!present.length) {
    console.log('[lock] none of the lock\'s shots is in the run — not comparable');
    return 3;
  }
  if (!settingsOk) {
    console.log('[lock] exit 3: the run was rendered with other settings — hashes are not comparable');
    return 3;
  }
  if (!chromeOk || !driverOk) {
    console.log('[lock] exit 2: Chrome or the display driver differ from the lock — the hashes above are advisory (re-render the locked code to re-baseline)');
    return 2;
  }
  if (n('DIFFERENT') || n('MISSING')) {
    console.log('[lock] exit 1: shots changed or missing in the locked environment');
    return 1;
  }
  console.log('[lock] exit 0: all identical');
  return 0;
}

// ------------------------------------------------------------------ --compare
function compare(aPath: string, bPath: string): number {
  const A = readRun(aPath);
  const B = readRun(bPath);
  const only = arg('only')?.split(',').map((x) => x.trim()).filter(Boolean);
  const strict = flag('strict');
  const ids = only ?? [...new Set([...A.shots.keys(), ...B.shots.keys()])].sort();
  const rows = ids.map((id) => {
    const a = A.shots.get(id);
    const b = B.shots.get(id);
    const status = a && b ? (a.sha256 === b.sha256 ? 'IDENTICAL' : 'DIFFERENT') : a ? 'ONLY-A' : b ? 'ONLY-B' : 'NEITHER';
    return { id, status, a: a?.sha256, b: b?.sha256 };
  });
  console.log(`[lock] compare  A ${showPath(A.dir)}  ·  B ${showPath(B.dir)}${only ? `  (only ${only.length} id(s))` : ''}`);
  table(rows, ['A', 'B']);
  const n = (k: string) => rows.filter((r) => r.status === k).length;
  console.log(`[lock] ${n('IDENTICAL')} identical · ${n('DIFFERENT')} different · ${n('ONLY-A')} only in A · ${n('ONLY-B')} only in B${n('NEITHER') ? ` · ${n('NEITHER')} in neither` : ''}`);
  const both = rows.filter((r) => r.a && r.b).map((r) => r.id);
  const sa = uniform(both.map((id) => A.shots.get(id)!), (s) => s.settings, fmtSettings);
  const sb = uniform(both.map((id) => B.shots.get(id)!), (s) => s.settings, fmtSettings);
  const ca = uniform(both.map((id) => A.shots.get(id)!), (s) => s.chrome, String);
  const cb = uniform(both.map((id) => B.shots.get(id)!), (s) => s.chrome, String);
  const settingsOk = !both.length || (!!sa.value && !!sb.value && sameSettings(sa.value, sb.value));
  console.log(`[lock] settings  A ${sa.value ? fmtSettings(sa.value) : sa.values.join(' | ') || '—'} · B ${sb.value ? fmtSettings(sb.value) : sb.values.join(' | ') || '—'}${settingsOk ? '' : '  ← DIFFER (not comparable)'}`);
  console.log(`[lock] chrome    A ${ca.value ?? (ca.values.join(', ') || '—')} · B ${cb.value ?? (cb.values.join(', ') || '—')}${ca.value === cb.value ? '' : '  ← DIFFER'}`);
  if (!strict) return 0;
  if (!settingsOk) return 3;
  return rows.some((r) => r.status !== 'IDENTICAL') ? 1 : 0;
}

// ------------------------------------------------------------------ main
const usage = 'usage: pnpm lock --write <run> [--set lock-v1] [--out data/qa/lock-v1.json] | --verify <run> [--lock data/qa/lock-v1.json] | --compare <runA> <runB> [--only id,…] [--strict]';
function main(): number {
  if (arg('write')) return write(arg('write')!);
  if (arg('verify')) return verify(arg('verify')!);
  if (arg('compare')) {
    const i = process.argv.indexOf('--compare');
    const a = process.argv[i + 1];
    const b = process.argv[i + 2];
    if (!a || !b || b.startsWith('--')) throw new Error(usage);
    return compare(a, b);
  }
  console.error(usage);
  return 64;
}
// a CLI only (the run-manifest reader shared with showcase.ts lives in runs.ts), so it always runs
try {
  process.exitCode = main();
} catch (e) {
  console.error(`[lock] error: ${(e as Error).message}`);
  process.exitCode = 64;
}
