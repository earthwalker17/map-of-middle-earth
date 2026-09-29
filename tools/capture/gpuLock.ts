import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, utimesSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * One heavy-job queue for the whole machine: every tool that drives a WebGPU browser, bakes or
 * builds takes this lock first, so parallel agents code concurrently but run heavy jobs one at a
 * time (7.6 GB RAM shared with the iGPU).
 *
 * The holder refreshes the file's mtime every HEARTBEAT_MS; a lock whose holder is dead or whose
 * heartbeat is older than STALE_MS is reclaimed. Tools register async cleanups (close Chrome/Vite)
 * with `onAbort` so Ctrl+C / console close still tears the browser down before exiting.
 */
// machine-wide (shared by all worktrees/agents), not per checkout
const LOCK =
  process.env.MOME_GPU_LOCK ?? join(process.env.LOCALAPPDATA ?? tmpdir(), 'map-of-middle-earth', 'gpu.lock');
const HEARTBEAT_MS = 15_000;
const STALE_MS = 2 * 60_000;

export const gpuLockPath = LOCK;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const cleanups = new Set<() => unknown>();
let signalsInstalled = false;

/** Register a cleanup to run if the process is interrupted; returns an unregister function. */
export function onAbort(fn: () => unknown): () => void {
  cleanups.add(fn);
  installSignalHandlers();
  return () => cleanups.delete(fn);
}

function installSignalHandlers(): void {
  if (signalsInstalled) return;
  signalsInstalled = true;
  let aborting = false;
  const handler = (sig: string) => {
    if (aborting) return;
    aborting = true;
    console.warn(`[gpu-lock] ${sig}: cleaning up…`);
    // newest first (browser → server → lock), one after another
    const run = async () => {
      for (const fn of [...cleanups].reverse()) {
        try {
          await fn();
        } catch {
          /* keep tearing down */
        }
      }
    };
    const timeout = new Promise((r) => setTimeout(r, 10_000).unref());
    void Promise.race([run(), timeout]).finally(() => process.exit(130));
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) process.on(sig, () => handler(sig));
}

export async function acquireGpuLock(owner: string, timeoutMs = 60 * 60 * 1000): Promise<() => void> {
  mkdirSync(dirname(LOCK), { recursive: true });
  const start = Date.now();
  let announced = false;
  for (;;) {
    try {
      const fd = openSync(LOCK, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, owner, cwd: process.cwd(), since: new Date().toISOString() }));
      closeSync(fd);
      const beat = setInterval(() => {
        try {
          const now = new Date();
          utimesSync(LOCK, now, now);
        } catch {
          /* lock removed underneath us — nothing to refresh */
        }
      }, HEARTBEAT_MS);
      beat.unref();
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        clearInterval(beat);
        try {
          const info = JSON.parse(readFileSync(LOCK, 'utf8')) as { pid: number };
          if (info.pid === process.pid) rmSync(LOCK, { force: true });
        } catch {
          /* ignore */
        }
      };
      process.once('exit', release);
      onAbort(release);
      return release;
    } catch {
      try {
        const info = JSON.parse(readFileSync(LOCK, 'utf8')) as { pid: number; owner: string; cwd?: string };
        const age = Date.now() - statSync(LOCK).mtimeMs;
        if (!alive(info.pid) || age > STALE_MS) {
          console.log(`[gpu-lock] reclaiming stale lock of ${info.owner} (pid ${info.pid}, heartbeat ${Math.round(age / 1000)} s old)`);
          rmSync(LOCK, { force: true });
          continue;
        }
        if (!announced) {
          console.log(`[gpu-lock] waiting for ${info.owner} (pid ${info.pid}${info.cwd ? `, ${info.cwd}` : ''})…`);
          announced = true;
        }
      } catch {
        /* lock vanished between checks */
      }
      if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the heavy-job lock');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
