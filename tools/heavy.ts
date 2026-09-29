/**
 * Run a memory-heavy command under the machine-wide heavy-job lock (shared with captures):
 *
 *   node --import tsx tools/heavy.ts <label> [--min-free-mb N] -- <command> [args…]
 *
 * memory guard (waits, bounded) → lock → command → release. Used by `pnpm bake` and `pnpm build`
 * so a bake or build never overlaps a capture on the 7.6 GB shared-memory host.
 */
import { spawn, spawnSync } from 'node:child_process';
import { acquireGpuLock, onAbort } from './capture/gpuLock.ts';
import { fmtMem, waitForMemory } from './capture/host.ts';

const sep = process.argv.indexOf('--');
if (sep < 0 || sep === process.argv.length - 1) {
  console.error('usage: tools/heavy.ts <label> [--min-free-mb N] -- <command> [args…]');
  process.exit(2);
}
const head = process.argv.slice(2, sep);
const [cmd, ...cmdArgs] = process.argv.slice(sep + 1);
const label = head[0] ?? cmd;
const mi = head.indexOf('--min-free-mb');
const minAvailMB = mi >= 0 ? Number(head[mi + 1]) : undefined;

const mem = await waitForMemory({ label, minAvailMB });
const release = await acquireGpuLock(label);
console.log(`[heavy] ${label}: ${fmtMem(mem)}`);
const child = spawn(cmd, cmdArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
onAbort(() => {
  // shell:true on Windows → kill the whole tree (cmd.exe → uv/python, node → esbuild…)
  if (child.pid && process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
});
child.on('exit', (code, signal) => {
  release();
  process.exit(code ?? (signal ? 1 : 0));
});
