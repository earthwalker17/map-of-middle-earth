import type { BrowserContext, Page } from 'playwright';
import { acquireGpuLock, onAbort } from './gpuLock.ts';
import { startCaptureServer, type CaptureServer } from './server.ts';
import { collectConsole, launchChrome, type ConsoleLog } from './browser.ts';
import { cleanupStaleChrome, fmtMem, waitForMemory, type HostMemory } from './host.ts';

/**
 * One bounded capture session: memory guard → heavy-job lock → orphan cleanup → Vite + Chrome.
 * The order matters: the guard waits without holding the lock (never blocks other agents), and
 * orphan cleanup only runs while we hold the lock (never kills another agent's capture).
 */
export interface CaptureSession {
  srv: CaptureServer;
  ctx: BrowserContext;
  page: Page;
  logs: ConsoleLog[];
  memAtStart: HostMemory;
  close(): Promise<void>;
}

export interface SessionOptions {
  label: string;
  port?: number;
  headed?: boolean;
  minAvailMB?: number;
}

export async function openCaptureSession(opts: SessionOptions): Promise<CaptureSession> {
  const memAtStart = await waitForMemory({ label: opts.label, minAvailMB: opts.minAvailMB });
  const release = await acquireGpuLock(opts.label);
  cleanupStaleChrome();
  console.log(`[host] ${opts.label}: ${fmtMem(memAtStart)}`);
  let srv: CaptureServer | null = null;
  let ctx: BrowserContext | null = null;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await ctx?.close();
    } catch {
      /* browser already gone */
    }
    try {
      await srv?.close();
    } catch {
      /* ignore */
    }
    // a killed/crashed browser leaves children behind on Windows — sweep before handing the lock on
    cleanupStaleChrome();
    release();
  };
  onAbort(close);
  try {
    srv = await startCaptureServer(opts.port ?? 5199);
    ctx = await launchChrome({ headed: opts.headed });
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    page.setDefaultTimeout(0);
    const logs = collectConsole(page);
    return { srv, ctx, page, logs, memAtStart, close };
  } catch (e) {
    await close();
    throw e;
  }
}

export async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`timeout after ${ms / 1000}s: ${what}`)), ms)));
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Load the app in capture mode and wait for the world to be ready (fail fast: never hold the lock on a broken page). */
export async function bootCapturePage(s: CaptureSession, quality: string): Promise<void> {
  await s.page.goto(`${s.srv.url}/?capture=1&quality=${quality}`);
  await s.page.waitForFunction(() => Boolean(window.__mm), undefined, { timeout: 120_000 });
  await withTimeout(s.page.evaluate(() => window.__mm!.ready), 240_000, 'app boot (window.__mm.ready)');
}
