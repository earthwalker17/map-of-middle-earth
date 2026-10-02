import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { freemem } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Host hygiene for heavy jobs on the 7.6 GB shared-memory laptop (captures, bake, build):
 *  - a free-RAM / commit-headroom guard that runs BEFORE the heavy-job lock is taken (so waiting
 *    never blocks other agents),
 *  - cleanup of orphaned capture Chrome processes of THIS checkout's profile (only after the lock is
 *    held, so it never kills another agent's live capture),
 *  - a footprint probe for the per-batch memory log.
 * Thresholds can be overridden with MOME_MIN_FREE_MB / MOME_MIN_COMMIT_MB; MOME_MEM_GUARD=0 disables.
 */

const MB = 1024 * 1024;

function powershell(script: string, timeoutMs = 20_000): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

export interface HostMemory {
  /** physical memory available to new allocations (free + standby), MB */
  availMB: number;
  /** commit limit − committed bytes, MB (null off Windows or if the query failed) */
  commitFreeMB: number | null;
}

export function hostMemory(withCommit = true): HostMemory {
  const availMB = Math.round(freemem() / MB);
  let commitFreeMB: number | null = null;
  if (withCommit && process.platform === 'win32') {
    try {
      const kb = Number(powershell('(Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory').trim());
      if (Number.isFinite(kb) && kb > 0) commitFreeMB = Math.round(kb / 1024);
    } catch {
      /* CIM unavailable — rely on physical memory only */
    }
  }
  return { availMB, commitFreeMB };
}

export function fmtMem(m: HostMemory): string {
  return `${m.availMB} MB available${m.commitFreeMB !== null ? `, ${m.commitFreeMB} MB commit headroom` : ''}`;
}

export interface MemoryGuardOptions {
  minAvailMB?: number;
  minCommitMB?: number;
  timeoutMs?: number;
  label?: string;
}

/**
 * Background apps the user approved (2026-09-29) to be stopped automatically before heavy jobs —
 * but only while none of their processes has an open window (never close something in use).
 * Their autostart entries were disabled the same day; `pnpm host --fix` re-applies that if an
 * app update re-enables them.
 */
export const APPROVED_BACKGROUND_APPS = [
  'msedge',
  'wps',
  'wpscloudsvr',
  'promecefpluginhost',
  'OneDrive',
  'OneDrive.Sync.Service',
  'PhoneExperienceHost',
  'ms-teams',
  'MSPCManager',
];

/** Stop approved background apps that have no open window; returns what was stopped / skipped. */
export function sweepBackgroundApps(): { stopped: string[]; skipped: string[] } {
  if (process.platform !== 'win32') return { stopped: [], skipped: [] };
  const names = APPROVED_BACKGROUND_APPS.map((n) => `'${n}'`).join(',');
  try {
    const out = powershell(
      `$r = @(); foreach ($n in @(${names})) { $ps = @(Get-Process -Name $n -ErrorAction SilentlyContinue); if (-not $ps.Count) { continue }; ` +
        `if (@($ps | Where-Object { $_.MainWindowHandle -ne 0 }).Count) { $r += "skip:$n" } else { $ps | Stop-Process -Force -ErrorAction SilentlyContinue; $r += "stop:$n x$($ps.Count)" } }; $r -join '|'`,
      30_000,
    ).trim();
    const parts = out ? out.split('|') : [];
    return {
      stopped: parts.filter((p) => p.startsWith('stop:')).map((p) => p.slice(5)),
      skipped: parts.filter((p) => p.startsWith('skip:')).map((p) => p.slice(5)),
    };
  } catch {
    return { stopped: [], skipped: [] };
  }
}

/** Largest processes by private memory (for an actionable "not enough memory" message). */
export function topConsumers(n = 8): string[] {
  if (process.platform !== 'win32') return [];
  try {
    return powershell(
      `Get-Process | Group-Object ProcessName | ForEach-Object { [pscustomobject]@{ N=$_.Name; C=$_.Count; P=[math]::Round(($_.Group | Measure-Object PrivateMemorySize64 -Sum).Sum/1MB) } } | Sort-Object P -Descending | Select-Object -First ${n} | ForEach-Object { "$($_.N) x$($_.C) $($_.P) MB" }`,
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Wait (bounded) until the host has room for a heavy job; throws with advice if it never does. */
export async function waitForMemory(opts: MemoryGuardOptions = {}): Promise<HostMemory> {
  const minAvail = Number(process.env.MOME_MIN_FREE_MB ?? opts.minAvailMB ?? 1800);
  const minCommit = Number(process.env.MOME_MIN_COMMIT_MB ?? opts.minCommitMB ?? 1500);
  const timeoutMs = opts.timeoutMs ?? 3 * 60_000;
  const label = opts.label ?? 'heavy job';
  let m = hostMemory();
  if (process.env.MOME_MEM_GUARD === '0') return m;
  const low = (x: HostMemory) => x.availMB < minAvail || (x.commitFreeMB !== null && x.commitFreeMB < minCommit);
  if (low(m)) {
    // free what the user pre-approved before waiting (windowless background apps only)
    const { stopped, skipped } = sweepBackgroundApps();
    if (stopped.length) console.log(`[host] stopped approved background apps: ${stopped.join(', ')}`);
    if (skipped.length) console.log(`[host] left running (open windows): ${skipped.join(', ')}`);
    if (stopped.length) {
      await new Promise((r) => setTimeout(r, 3000));
      m = hostMemory();
    }
  }
  const start = Date.now();
  let lastLog = 0;
  while (low(m)) {
    if (Date.now() - start > timeoutMs)
      throw new Error(
        `[host] not enough memory for ${label}: ${fmtMem(m)} (need ≥ ${minAvail} MB available and ≥ ${minCommit} MB commit headroom). ` +
          `Top consumers: ${topConsumers().join('; ')}. Close apps you are not using (or approve stopping them), wait for other agents, ` +
          'or lower MOME_MIN_FREE_MB deliberately.',
      );
    if (Date.now() - lastLog > 15_000) {
      console.log(`[host] waiting for memory before ${label}: ${fmtMem(m)} (need ${minAvail}/${minCommit} MB)…`);
      lastLog = Date.now();
    }
    await new Promise((r) => setTimeout(r, 5000));
    m = hostMemory();
  }
  return m;
}

// ------------------------------------------------------------------ capture Chrome processes

export function chromeProfileDir(): string {
  return resolve(process.env.MOME_CHROME_PROFILE ?? join(process.cwd(), '.cache', 'chrome-profile'));
}

interface ProcRow {
  ProcessId: number;
  ParentProcessId: number;
  CommandLine: string | null;
  WorkingSetSize: number;
  /** CPU time so far, 100 ns units */
  KernelModeTime: number;
  UserModeTime: number;
}

function listProcesses(name: string): ProcRow[] {
  if (process.platform !== 'win32') return [];
  try {
    const out = powershell(
      `Get-CimInstance Win32_Process -Filter "Name='${name}'" | Select-Object ProcessId,ParentProcessId,CommandLine,WorkingSetSize,KernelModeTime,UserModeTime | ConvertTo-Json -Compress`,
    ).trim();
    if (!out) return [];
    const rows = JSON.parse(out) as ProcRow | ProcRow[];
    return Array.isArray(rows) ? rows : [rows];
  } catch {
    return [];
  }
}

const norm = (p: string) => resolve(p).replace(/[\\/]+$/, '').toLowerCase();

/** Chrome processes whose --user-data-dir is exactly `profile` (children inherit the switch). */
function profileChromes(profile: string): ProcRow[] {
  const want = norm(profile);
  return listProcesses('chrome.exe').filter((p) => {
    const m = /--user-data-dir=(?:"([^"]+)"|(\S+))/.exec(p.CommandLine ?? '');
    const dir = m?.[1] ?? m?.[2];
    return dir !== undefined && norm(dir) === want;
  });
}

/** CPU seconds used so far by this checkout's capture Chrome tree (perf noise accounting). */
export function profileCpuSeconds(profile = chromeProfileDir()): number {
  return profileChromes(profile).reduce((s, p) => s + ((p.KernelModeTime ?? 0) + (p.UserModeTime ?? 0)) / 1e7, 0);
}

/**
 * Kill orphaned Chrome processes left by a killed capture of this checkout (Windows does not kill
 * children with their parent) and clear the profile's singleton lock files. Call only while holding
 * the heavy-job lock.
 */
export function cleanupStaleChrome(profile = chromeProfileDir()): number {
  const stale = profileChromes(profile).filter((p) => p.ProcessId !== process.pid);
  for (const p of stale) {
    try {
      process.kill(p.ProcessId);
    } catch {
      /* already gone */
    }
  }
  if (stale.length) console.log(`[host] killed ${stale.length} orphaned capture Chrome process(es) of ${profile}`);
  for (const f of ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try {
      rmSync(join(profile, f), { force: true });
    } catch {
      /* held by a live process — leave it */
    }
  }
  return stale.length;
}

export interface Footprint {
  chromeMB: number;
  chromeProcs: number;
  nodeMB: number;
}

/** Working set of this capture: its Chrome tree + this node process. */
export function captureFootprint(profile = chromeProfileDir()): Footprint {
  const chromes = profileChromes(profile);
  return {
    chromeMB: Math.round(chromes.reduce((s, p) => s + (p.WorkingSetSize ?? 0), 0) / MB),
    chromeProcs: chromes.length,
    nodeMB: Math.round(process.memoryUsage().rss / MB),
  };
}
