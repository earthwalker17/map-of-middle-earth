import { Engine } from '../core/Engine.ts';
import { installCaptureApi } from '../render/capture.ts';
import type { QualityTierId } from '../core/quality.ts';

/** Placeholder boot until the world systems land (replaced in the world-v0 milestone). */
export async function boot(canvas: HTMLCanvasElement, status: HTMLElement, params: URLSearchParams): Promise<void> {
  const capture = params.has('capture');
  const quality = (params.get('quality') as QualityTierId | null) ?? (capture ? 'review' : 'preview');
  const engine = await Engine.create({ canvas, width: innerWidth, height: innerHeight, quality, capture });
  engine.assertHardwareGpu();
  installCaptureApi(engine, Promise.resolve());
  status.textContent = `${engine.gpu.vendor} ${engine.gpu.architecture} · ${engine.gpu.backend}`;
}
