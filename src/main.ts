import { runSmoke, type SmokeReport } from './dev/smoke.ts';

declare global {
  interface Window {
    __smoke?: Promise<SmokeReport>;
  }
}

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const status = document.getElementById('status') as HTMLDivElement;

if (params.has('smoke')) {
  window.__smoke = runSmoke(canvas);
  window.__smoke.then(
    (r) => (status.textContent = `smoke: ${JSON.stringify(r)}`),
    (e) => (status.textContent = `smoke failed: ${e}`),
  );
} else {
  import('./app/boot.ts').then((m) => m.boot(canvas, status, params)).catch((e) => {
    status.textContent = `boot failed: ${e?.message ?? e}`;
    console.error(e);
  });
}
