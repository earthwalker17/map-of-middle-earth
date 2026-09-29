import { chromium, type BrowserContext, type Page } from 'playwright';
import { chromeProfileDir } from './host.ts';

/**
 * Chrome honours only the LAST --disable-features switch, and Playwright already passes its own
 * list (playwright-core chromiumSwitches.ts). Ours must therefore be a superset of Playwright's or
 * it silently re-enables Translate, OptimizationHints, MediaRouter, … (memory + background work).
 */
const PLAYWRIGHT_DISABLED_FEATURES = [
  'AvoidUnnecessaryBeforeUnloadCheckSync',
  'DestroyProfileOnBrowserClose',
  'DialMediaRouteProvider',
  'GlobalMediaControls',
  'HttpsUpgrades',
  'LensOverlay',
  'MediaRouter',
  'PaintHolding',
  'ThirdPartyStoragePartitioning',
  'BlockOriginHeaderModificationOnRedirect',
  'Translate',
  'AutoDeElevate',
  'OptimizationHints',
];
const OUR_DISABLED_FEATURES = ['CalculateNativeWinOcclusion'];

/**
 * Launch the installed Chrome (new headless) with a persistent profile so Dawn's shader/pipeline
 * cache stays warm between runs. WebGPU canvas screenshots are black in headless — all captures
 * go through the page's readback API instead.
 */
export async function launchChrome(opts: { headed?: boolean } = {}): Promise<BrowserContext> {
  return chromium.launchPersistentContext(chromeProfileDir(), {
    channel: 'chrome',
    headless: !opts.headed,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    args: [
      '--enable-unsafe-webgpu',
      '--ignore-gpu-blocklist',
      '--enable-webgpu-developer-features',
      `--disable-features=${[...PLAYWRIGHT_DISABLED_FEATURES, ...OUR_DISABLED_FEATURES].join(',')}`,
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

/** Ask V8 for a full GC (frees readback/upload ArrayBuffers between shots). */
export async function collectGarbage(ctx: BrowserContext, page: Page): Promise<void> {
  try {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.detach();
  } catch {
    /* best effort */
  }
}
