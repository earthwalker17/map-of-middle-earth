import { REVISION } from 'three/webgpu';
import type { Engine, GpuInfo } from '../core/Engine.ts';
import { StaticTimeline, type ShotSpec, type Timeline } from '../core/Timeline.ts';
import type { ShotSpecInput } from '../camera/shots.ts';

export interface CaptureRequest {
  /** output name (file stem) — the Node harness decides the directory */
  name: string;
  /** a still shot, or the id of a registered timeline */
  shot?: ShotSpecInput;
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

export interface CaptureApi {
  version: 1;
  ready: Promise<void>;
  info(): { gpu: GpuInfo; three: string; quality: string };
  render(req: CaptureRequest): Promise<CaptureResult>;
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

export function installCaptureApi(engine: Engine, ready: Promise<void>, resolveShot: (s: ShotSpecInput) => ShotSpec): CaptureApi {
  const timelines = new Map<string, Timeline>();
  const api: CaptureApi = {
    version: 1,
    ready,
    info: () => ({ gpu: engine.gpu, three: REVISION, quality: engine.quality.id }),
    registerTimeline: (t) => timelines.set(t.id, t),
    async render(req) {
      await ready;
      const timeline: Timeline | undefined = req.shot ? new StaticTimeline(resolveShot(req.shot)) : timelines.get(req.timelineId ?? '');
      if (!timeline) throw new Error(`capture: no shot/timeline for ${req.name}`);
      if (req.shot?.quality) engine.setQuality(req.shot.quality);
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
      const res = await fetch(`/__capture/frame?name=${encodeURIComponent(req.name)}&w=${engine.post.width}&h=${engine.post.height}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: pixels as BodyInit,
      });
      if (!res.ok) throw new Error(`capture sink rejected frame: ${res.status}`);
      return { name: req.name, width: engine.post.width, height: engine.post.height, spp, renderMs, sha256, meanLuma };
    },
  };
  window.__mm = api;
  return api;
}
