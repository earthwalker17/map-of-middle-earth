/**
 * Diagnostics: load the app in capture mode and evaluate an expression against window.__app.
 *   pnpm tsx tools/capture/probe.ts "<js expression using app>"
 */
import { acquireGpuLock } from './gpuLock.ts';
import { startCaptureServer } from './server.ts';
import { collectConsole, launchChrome } from './browser.ts';

const expr = process.argv[2] ?? 'Object.keys(app)';
const release = await acquireGpuLock('probe');
const srv = await startCaptureServer(5198);
const ctx = await launchChrome();
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.setDefaultTimeout(0);
const logs = collectConsole(page);
try {
  await page.goto(`${srv.url}/?capture=1&quality=review`);
  await page.waitForFunction(() => Boolean((window as unknown as { __app?: unknown }).__app), undefined, { timeout: 120000 });
  const out = await page.evaluate(`(async () => { const app = window.__app; return (${expr}); })()`);
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error(e);
} finally {
  for (const l of logs.filter((l) => l.type === 'error' || l.type === 'pageerror').slice(0, 10)) console.error('[console]', l.text);
  await ctx.close();
  await srv.close();
  release();
}
