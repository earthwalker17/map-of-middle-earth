/**
 * Diagnostics: load the app in capture mode and evaluate an expression against window.__app.
 *   node --import tsx tools/capture/probe.ts "<js expression using app>" [--quality preview]
 */
import { bootCapturePage, openCaptureSession } from './session.ts';

const expr = process.argv[2] ?? 'Object.keys(app)';
const qi = process.argv.indexOf('--quality');
const quality = qi > 0 ? process.argv[qi + 1] : 'review';
const session = await openCaptureSession({ label: 'probe', port: 5198 });
try {
  await bootCapturePage(session, quality);
  const out = await session.page.evaluate(`(async () => { const app = window.__app; return (${expr}); })()`);
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error(e);
} finally {
  for (const l of session.logs.filter((l) => l.type === 'error' || l.type === 'pageerror').slice(0, 10)) console.error('[console]', l.text);
  await session.close();
}
