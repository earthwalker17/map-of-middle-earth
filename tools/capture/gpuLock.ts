import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * One GPU render queue for the whole machine: every tool that drives a WebGPU browser takes this
 * lock first, so parallel agents code concurrently but render one at a time (1 GB shared iGPU).
 */
const LOCK = join(process.cwd(), '.cache', 'gpu.lock');
const STALE_MS = 45 * 60 * 1000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function acquireGpuLock(owner: string, timeoutMs = 60 * 60 * 1000): Promise<() => void> {
  mkdirSync(dirname(LOCK), { recursive: true });
  const start = Date.now();
  let announced = false;
  for (;;) {
    try {
      const fd = openSync(LOCK, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, owner, since: new Date().toISOString() }));
      closeSync(fd);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        try {
          rmSync(LOCK, { force: true });
        } catch {
          /* ignore */
        }
      };
      process.once('exit', release);
      process.once('SIGINT', () => {
        release();
        process.exit(130);
      });
      return release;
    } catch {
      try {
        const info = JSON.parse(readFileSync(LOCK, 'utf8')) as { pid: number; owner: string };
        const age = Date.now() - statSync(LOCK).mtimeMs;
        if (!alive(info.pid) || age > STALE_MS) {
          rmSync(LOCK, { force: true });
          continue;
        }
        if (!announced) {
          console.log(`[gpu-lock] waiting for ${info.owner} (pid ${info.pid})…`);
          announced = true;
        }
      } catch {
        /* lock vanished between checks */
      }
      if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for GPU lock');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
