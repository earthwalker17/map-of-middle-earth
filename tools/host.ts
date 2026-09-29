/**
 * Host check for the 7.6 GB shared-memory dev laptop — run at session start and before heavy work:
 *
 *   pnpm host            report: memory, approved background apps, autostart drift, orphans, lock, disk
 *   pnpm host --fix      + stop windowless approved background apps, re-disable their autostart
 *                          (per-user entries), sweep orphaned capture processes
 *   pnpm host --prune    + list regenerable temporaries (dist/, old render runs; keeps `latest`, the
 *                          newest runs and any run folder containing a KEEP file); add --yes to delete
 *                          them (+ git worktree prune)
 *
 * Machine-level drift (services, HKLM policies) needs elevation: it is reported, never changed here.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gpuLockPath } from './capture/gpuLock.ts';
import { APPROVED_BACKGROUND_APPS, chromeProfileDir, cleanupStaleChrome, fmtMem, hostMemory, sweepBackgroundApps, topConsumers } from './capture/host.ts';

const fix = process.argv.includes('--fix');
const prune = process.argv.includes('--prune');
const yes = process.argv.includes('--yes');
const issues: string[] = [];

function ps(script: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

// ------------------------------------------------------------------ memory
const mem = hostMemory();
console.log(`[host] memory: ${fmtMem(mem)}`);
console.log(`[host] top: ${topConsumers(8).join(' · ')}`);
if (mem.availMB < 1800) issues.push(`low available memory (${mem.availMB} MB < 1800 MB needed for a capture batch)`);

// ------------------------------------------------------------------ approved background apps
const running = ps(
  `@(${APPROVED_BACKGROUND_APPS.map((n) => `'${n}'`).join(',')}) | ForEach-Object { $p = @(Get-Process -Name $_ -ErrorAction SilentlyContinue); if ($p.Count) { "$_ x$($p.Count)" + $(if (@($p | Where-Object { $_.MainWindowHandle -ne 0 }).Count) { ' (window open)' } else { '' }) } }`,
)
  .split(/\r?\n/)
  .filter(Boolean);
console.log(`[host] approved background apps running: ${running.length ? running.join(', ') : 'none'}`);
if (fix && running.length) {
  const r = sweepBackgroundApps();
  if (r.stopped.length) console.log(`[host]   stopped: ${r.stopped.join(', ')}`);
  if (r.skipped.length) console.log(`[host]   left running (open windows — close them yourself if unused): ${r.skipped.join(', ')}`);
}

// ------------------------------------------------------------------ autostart drift (per-user entries are re-disabled with --fix)
const AUTOSTART_SCRIPT = String.raw`
$sa = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
$run = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue
$out = @()
foreach ($name in @($run.PSObject.Properties.Name | Where-Object { $_ -in @('OneDrive','Microsoft.Lists','Teams') -or $_ -like 'MicrosoftEdgeAutoLaunch_*' })) {
  $v = (Get-ItemProperty $sa -Name $name -ErrorAction SilentlyContinue).$name
  $enabled = (-not $v) -or ($v[0] -band 1) -eq 0
  if ($enabled) {
    if ($env:MOME_FIX -eq '1') {
      if (-not (Test-Path $sa)) { New-Item -Path $sa -Force | Out-Null }
      $b = [byte[]](@(3,0,0,0) + [BitConverter]::GetBytes([DateTime]::UtcNow.ToFileTimeUtc()))
      Set-ItemProperty -Path $sa -Name $name -Value $b -Type Binary; $out += "fixed:run:$name"
    } else { $out += "drift:run:$name" }
  }
}
foreach ($t in @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -like 'WpsExternal_*' -or $_.TaskName -like 'WpsUpdateTask_*' -or $_.TaskName -like 'OneDrive Startup Task*' -or $_.TaskName -like 'OneDrive Reporting Task*' })) {
  if ($t.State -ne 'Disabled') {
    if ($env:MOME_FIX -eq '1') { Disable-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -ErrorAction SilentlyContinue | Out-Null; $out += "fixed:task:$($t.TaskName)" } else { $out += "drift:task:$($t.TaskName)" }
  }
}
$svc = Get-CimInstance Win32_Service -Filter "Name='PCManager Service Store'" -ErrorAction SilentlyContinue
if ($svc -and $svc.StartMode -ne 'Disabled') { $out += "admin:service:PCManager Service Store ($($svc.StartMode))" }
$edge = Get-ItemProperty 'HKLM:\Software\Policies\Microsoft\Edge' -ErrorAction SilentlyContinue
if (-not $edge -or $edge.StartupBoostEnabled -ne 0 -or $edge.BackgroundModeEnabled -ne 0) { $out += 'admin:policy:Edge StartupBoost/BackgroundMode' }
$out -join '|'
`;
const drift = (() => {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', AUTOSTART_SCRIPT], {
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, MOME_FIX: fix ? '1' : '0' },
    }).trim();
    return out ? out.split('|') : [];
  } catch {
    return ['error:autostart check failed'];
  }
})();
for (const d of drift) {
  if (d.startsWith('fixed:')) console.log(`[host] autostart re-disabled: ${d.slice(6)}`);
  else if (d.startsWith('drift:')) issues.push(`autostart re-enabled: ${d.slice(6)} (run pnpm host --fix)`);
  else if (d.startsWith('admin:')) issues.push(`needs elevation to re-disable: ${d.slice(6)} (ask the user before running elevated)`);
  else issues.push(d);
}
if (!drift.length) console.log('[host] autostart: approved apps stay disabled');

// ------------------------------------------------------------------ heavy-job lock + orphaned capture processes
let lockHolder: string | null = null;
if (existsSync(gpuLockPath)) {
  try {
    const info = JSON.parse(readFileSync(gpuLockPath, 'utf8')) as { pid: number; owner: string; cwd?: string };
    let alive = true;
    try {
      process.kill(info.pid, 0);
    } catch {
      alive = false;
    }
    const age = Math.round((Date.now() - statSync(gpuLockPath).mtimeMs) / 1000);
    lockHolder = `${info.owner} (pid ${info.pid}, ${alive ? 'alive' : 'dead'}, heartbeat ${age} s)`;
    if (!alive && fix) {
      rmSync(gpuLockPath, { force: true });
      lockHolder += ' → removed stale lock';
    }
  } catch {
    lockHolder = 'unreadable';
  }
}
console.log(`[host] heavy-job lock: ${lockHolder ?? 'free'}`);
if (fix && (!lockHolder || lockHolder.includes('dead'))) {
  const n = cleanupStaleChrome(chromeProfileDir());
  console.log(`[host] orphaned capture Chrome (this checkout): ${n}`);
}
// orphaned node capture/bake processes: our tools on the command line and a dead parent
const orphans = (() => {
  try {
    const rows = JSON.parse(
      ps(
        "$all = @(Get-CimInstance Win32_Process); $ids = @{}; foreach ($p in $all) { $ids[[int]$p.ProcessId] = 1 }; " +
          "@($all | Where-Object { $_.Name -in @('node.exe','python.exe','uv.exe') -and $_.CommandLine -match 'tools[\\\\/](capture|heavy|bake)' -and -not $ids.ContainsKey([int]$_.ParentProcessId) } | Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress",
      ) || '[]',
    ) as { ProcessId: number; CommandLine: string } | { ProcessId: number; CommandLine: string }[];
    return (Array.isArray(rows) ? rows : [rows]).filter((r) => r.ProcessId !== process.pid);
  } catch {
    return [];
  }
})();
if (orphans.length) {
  if (fix) {
    for (const o of orphans) spawnSync('taskkill', ['/pid', String(o.ProcessId), '/T', '/F'], { stdio: 'ignore' });
    console.log(`[host] killed ${orphans.length} orphaned tool process(es)`);
  } else issues.push(`${orphans.length} orphaned tool process(es): ${orphans.map((o) => o.ProcessId).join(', ')} (pnpm host --fix)`);
}

// ------------------------------------------------------------------ disk / temporaries
function sizeMB(p: string): number {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.size / 2 ** 20;
  return readdirSync(p).reduce((s, f) => s + sizeMB(join(p, f)), 0);
}
const disk = ['renders', '.cache', 'dist'].map((d) => `${d} ${Math.round(sizeMB(d))} MB`).join(' · ');
console.log(`[host] disk: ${disk}`);
if (prune) {
  const drop = (p: string) => {
    const mb = Math.round(sizeMB(p));
    if (yes) rmSync(p, { recursive: true, force: true });
    console.log(`[host] ${yes ? 'pruned' : 'would prune'} ${p} (${mb} MB)`);
  };
  if (existsSync('dist')) drop('dist');
  const keepNewest = (dir: string, n: number) => {
    if (!existsSync(dir)) return;
    const runs = readdirSync(dir)
      .filter((f) => /^\d{8}-\d{6}$/.test(f) && statSync(join(dir, f)).isDirectory())
      .sort()
      .reverse();
    for (const r of runs.slice(n)) {
      if (existsSync(join(dir, r, 'KEEP'))) continue;
      drop(join(dir, r));
    }
  };
  keepNewest(join('renders', 'shots'), 5);
  keepNewest(join('renders', 'qa'), 4);
  if (yes) spawnSync('git', ['worktree', 'prune'], { stdio: 'ignore' });
  else console.log('[host] dry run — add --yes to delete');
}

// ------------------------------------------------------------------ summary
if (issues.length) {
  console.log('[host] ISSUES:');
  for (const i of issues) console.log(`  - ${i}`);
} else console.log('[host] OK');
process.exit(issues.some((i) => i.startsWith('low available memory')) ? 2 : 0);
