import { REVISION } from 'three/webgpu';
import type { Engine, GpuInfo } from '../core/Engine.ts';
import { StaticTimeline, type ShotSpec, type Timeline } from '../core/Timeline.ts';
import type { ShotSpecInput } from '../camera/shots.ts';

export interface CaptureRequest {
  /** output name (file stem) — the Node harness decides the directory */
  name: string;
  /** a still shot, or the id of a registered timeline */
  shot?: ShotSpecInput;
  /** id of a shot known to the page (data/qa shots + landmark bookmarks) */
  shotId?: string;
  /** override the time of day of shotId shots */
  tod?: number;
  timelineId?: string;
  t?: number;
  width: number;
  height: number;
  spp?: number;
  /** shutter as a fraction of the frame interval (0 = none, 0.5 = 180°) */
  shutter?: number;
  fps?: number;
}

export interface CaptureResult {
  name: string;
  width: number;
  height: number;
  spp: number;
  renderMs: number;
  sha256: string;
  /** mean luminance 0..255 (quick black-frame detection) */
  meanLuma: number;
}

export interface BenchRequest {
  name: string;
  shot?: ShotSpecInput;
  shotId?: string;
  width: number;
  height: number;
  /** timed frames (after warm-up) */
  frames?: number;
  warmup?: number;
  /** total camera orbit around the shot target over the run, degrees (exercises per-camera culling/LOD) */
  orbitDeg?: number;
}

export interface BenchResult {
  name: string;
  width: number;
  height: number;
  frames: number;
  medianMs: number;
  p95Ms: number;
  meanMs: number;
  maxMs: number;
}

export interface CaptureApi {
  version: 1;
  ready: Promise<void>;
  info(): { gpu: GpuInfo; three: string; quality: string; timings: Record<string, number>; jsHeapMB: number | null };
  render(req: CaptureRequest): Promise<CaptureResult>;
  /**
   * Interactive-path frame timing (single sample, presented). Every frame is awaited to GPU
   * completion, so the numbers are latency (CPU + GPU, no pipelining) — a conservative budget.
   * Diagnostics only: uses wall-clock time and never produces a captured frame.
   */
  benchmark(req: BenchRequest): Promise<BenchResult>;
  registerTimeline(t: Timeline): void;
}

declare global {
  interface Window {
    __mm?: CaptureApi;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function installCaptureApi(
  engine: Engine,
  ready: Promise<void>,
  resolveShot: (s: ShotSpecInput) => ShotSpec,
  findShot: (id: string) => ShotSpecInput | undefined = () => undefined,
): CaptureApi {
  const timelines = new Map<string, Timeline>();
  const api: CaptureApi = {
    version: 1,
    ready,
    info: () => ({
      gpu: engine.gpu,
      three: REVISION,
      quality: engine.quality.id,
      timings: { ...engine.timings },
      // Chrome-only heap counter (misses ArrayBuffers and GPU memory — indicative only)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jsHeapMB: (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 2 ** 20) : null,
    }),
    registerTimeline: (t) => timelines.set(t.id, t),
    async render(req) {
      await ready;
      let input = req.shot;
      if (!input && req.shotId) {
        const found = findShot(req.shotId);
        if (found) input = req.tod !== undefined ? { ...found, tod: req.tod } : found;
      }
      const timeline: Timeline | undefined = input ? new StaticTimeline(resolveShot(input)) : timelines.get(req.timelineId ?? '');
      if (!timeline) throw new Error(`capture: no shot/timeline for ${req.name}`);
      if (input?.quality) engine.setQuality(input.quality);
      engine.setSize(req.width, req.height);
      const spp = Math.max(1, req.spp ?? engine.quality.spp);
      const t0 = req.t ?? 0;
      const frameDt = 1 / (req.fps ?? 24);
      const shutter = req.shutter ?? 0;
      const start = performance.now();
      engine.renderAccumulated((i, n) => timeline.evaluate(t0 + (n > 1 ? (i / n) * shutter * frameDt : 0)), spp);
      const pixels = await engine.post.readPixels();
      const renderMs = performance.now() - start;
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4 * 97) sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
      const meanLuma = sum / Math.ceil(pixels.length / (4 * 97));
      const sha256 = await sha256Hex(pixels);
      // a Blob body keeps the frame out of the DevTools protocol's request events (Playwright keeps
      // the last 100 requests' post data in the harness process)
      const res = await fetch(`/__capture/frame?name=${encodeURIComponent(req.name)}&w=${engine.post.width}&h=${engine.post.height}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Blob([pixels as BlobPart]),
      });
      if (!res.ok) throw new Error(`capture sink rejected frame: ${res.status}`);
      return { name: req.name, width: engine.post.width, height: engine.post.height, spp, renderMs, sha256, meanLuma };
    },
    async benchmark(req) {
      await ready;
      const input = req.shot ?? (req.shotId ? findShot(req.shotId) : undefined);
      if (!input) throw new Error(`benchmark: unknown shot ${req.shotId ?? req.name}`);
      const base = resolveShot(input);
      engine.setSize(req.width, req.height);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const device = (engine.renderer.backend as any).device as GPUDevice;
      const frames = req.frames ?? 60;
      const warm = req.warmup ?? 10;
      const orbit = ((req.orbitDeg ?? 0) * Math.PI) / 180;
      const [px, py, pz] = base.camera.position;
      const [tx, , tz] = base.camera.target;
      const dx = px - tx;
      const dz = pz - tz;
      const times: number[] = [];
      for (let i = 0; i < warm + frames; i++) {
        const a = (orbit * i) / (warm + frames);
        const c = Math.cos(a);
        const s = Math.sin(a);
        const position: [number, number, number] = [tx + dx * c - dz * s, py, tz + dx * s + dz * c];
        const state = new StaticTimeline({ ...base, camera: { ...base.camera, position } }).evaluate(i / 24);
        const t0 = performance.now();
        engine.renderInteractive(state);
        await device.queue.onSubmittedWorkDone();
        if (i >= warm) times.push(performance.now() - t0);
      }
      const sorted = [...times].sort((x, y) => x - y);
      const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
      return {
        name: req.name,
        width: engine.post.width,
        height: engine.post.height,
        frames,
        medianMs: q(0.5),
        p95Ms: q(0.95),
        meanMs: times.reduce((x, y) => x + y, 0) / times.length,
        maxMs: sorted[sorted.length - 1],
      };
    },
  };
  window.__mm = api;
  return api;
}
