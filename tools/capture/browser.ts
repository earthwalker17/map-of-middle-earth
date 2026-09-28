import { chromium, type BrowserContext, type Page } from 'playwright';
import { join } from 'node:path';

/**
 * Launch the installed Chrome (new headless) with a persistent profile so Dawn's shader/pipeline
 * cache stays warm between runs. WebGPU canvas screenshots are black in headless — all captures
 * go through the page's readback API instead.
 */
export async function launchChrome(opts: { headed?: boolean } = {}): Promise<BrowserContext> {
  const profile = join(process.cwd(), '.cache', 'chrome-profile');
  return chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: !opts.headed,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    args: [
      '--enable-unsafe-webgpu',
      '--ignore-gpu-blocklist',
      '--enable-webgpu-developer-features',
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--force-device-scale-factor=1',
    ],
  });
}

export interface ConsoleLog {
  type: string;
  text: string;
}

export function collectConsole(page: Page): ConsoleLog[] {
  const logs: ConsoleLog[] = [];
  page.on('console', (m) => logs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => logs.push({ type: 'pageerror', text: e.message }));
  return logs;
}

export async function browserVersion(ctx: BrowserContext): Promise<string> {
  return ctx.browser()?.version() ?? 'chrome (persistent)';
}
