import { PerspectiveCamera, REVISION, Vector3 } from 'three/webgpu';
import type { Engine, GpuInfo } from '../core/Engine.ts';
import { StaticTimeline, type ShotSpec, type Timeline } from '../core/Timeline.ts';
import type { SceneState } from '../core/types.ts';
import type { ShotSpecInput } from '../camera/shots.ts';
import { terrainDetailError } from '../terrain/terrainTextures.ts';

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
  /**
   * S5 adaptive film sampling: the sample count the lens' on / off decision uses (the run's base spp), so a
   * fast frame rendered with more time samples keeps the same depth of field as its neighbours (default spp)
   */
  lensSpp?: number;
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
  /** S5: a registered timeline's duration and metadata (the film: fps, beats, hash) */
  timelineInfo(id: string): { id: string; duration: number; meta: unknown } | null;
  /** S5: a registered timeline's SceneState at t (diagnostics, labels; JSON-serializable) */
  timelineState(id: string, t: number): SceneState | null;
  /**
   * S5: how far the image moves while the shutter is open at film time t — the 90th percentile over a 9 × 5
   * grid of view rays of the ground point's screen displacement between the shutter's open and close (px at
   * width × height) — rays over the sky or the void around the board (outside Engine.inFrame) miss; 0 when
   * all do. Pure function of the timeline and the HeightField (the film runner picks a frame's sample count
   * from it: adaptive motion-blur sampling).
   */
  motionPx(id: string, t: number, shutter: number, fps: number, width: number, height: number): number | null;
}

declare global {
  interface Window {
    __mm?: CaptureApi;
  }
}

/**
 * Captured frames must show the real terrain look: a tier that wants the CC0 detail layers but did
 * not get them (missing / failed files) fails the capture instead of silently rendering the
 * procedural fallback (review/final already fail at boot; this also covers preview captures).
 */
function assertTerrainDetail(): void {
  const err = terrainDetailError();
  if (err) throw new Error(`capture: ${err}`);
}

/**
 * Shutter time of accumulation sub-sample i of n, as a fraction of the open shutter (S5). Stratified
 * (cell centres) and permuted by a stride coprime with n, so the time order does not follow the Halton
 * pixel-jitter / aperture order that shares the index i (correlated blur and AA patterns otherwise).
 */
export function shutterFraction(i: number, n: number): number {
  if (n <= 1) return 0;
  const stride = [7, 5, 11, 13, 17].find((p) => n % p !== 0) ?? 1;
  return (((i * stride) % n) + 0.5) / n;
}

/**
 * LOD dither phase of accumulation sub-sample i of n (S5 film, SceneState.lodDither): the cell centres in
 * index order — a different order from the shutter's permuted time (shutterFraction), so the fine / coarse
 * share of a dissolving LOD does not ride on the shutter time.
 */
export function lodDitherPhase(i: number, n: number): number {
  return (i + 0.5) / n;
}

const _camA = new PerspectiveCamera();
const _camB = new PerspectiveCamera();
const _dir = new Vector3();
const _p = new Vector3();

/** a state's camera pose as Engine.applyState sets it (position, look-at, roll, fov, aspect) */
function poseCamera(cam: PerspectiveCamera, s: SceneState, aspect: number): PerspectiveCamera {
  cam.position.set(...s.camera.position);
  cam.up.set(0, 1, 0);
  cam.lookAt(...s.camera.target);
  if (s.camera.roll) cam.rotateZ((s.camera.roll * Math.PI) / 180);
  cam.fov = s.camera.fov;
  cam.aspect = aspect;
  cam.near = 0.05;
  cam.far = 8000;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

/** first ground hit along a ray (geometric march, then bisection), null = no hit within 3000 km */
function groundHit(heightAt: (x: number, z: number) => number, o: Vector3, d: Vector3, out: Vector3): Vector3 | null {
  let prev = 0;
  for (let t = 0.05; t < 3000; t += Math.max(0.02, t * 0.02)) {
    out.copy(d).multiplyScalar(t).add(o);
    if (out.y < heightAt(out.x, out.z)) {
      let a = prev;
      let b = t;
      for (let j = 0; j < 20; j++) {
        const m = (a + b) / 2;
        out.copy(d).multiplyScalar(m).add(o);
        if (out.y < heightAt(out.x, out.z)) b = m;
        else a = m;
      }
      return out;
    }
    prev = t;
  }
  return null;
}

/**
 * Screen displacement (px, 90th percentile over a 9 × 5 grid of view rays) of the ground point each ray hits
 * in `a` (shutter open) when seen from `b` (shutter close); `heightAt` = −Infinity where there is no ground
 * (rays that only find such points miss). Pure; the film's adaptive sampling reads it.
 */
export function shutterMotionPx(a: SceneState, b: SceneState, heightAt: (x: number, z: number) => number, width: number, height: number): number {
  const ca = poseCamera(_camA, a, width / height);
  const cb = poseCamera(_camB, b, width / height);
  const d: number[] = [];
  const GX = 9;
  const GY = 5;
  for (let j = 0; j < GY; j++)
    for (let i = 0; i < GX; i++) {
      const nx = ((i + 0.5) / GX) * 2 - 1;
      const ny = ((j + 0.5) / GY) * 2 - 1;
      _dir.set(nx, ny, 0.5).unproject(ca).sub(ca.position).normalize();
      const P = groundHit(heightAt, ca.position, _dir, _p);
      if (!P) continue;
      P.project(cb);
      if (P.z > 1) continue;
      d.push(Math.hypot(((P.x - nx) * width) / 2, ((P.y - ny) * height) / 2));
    }
  if (!d.length) return 0;
  d.sort((x, y) => x - y);
  return d[Math.min(d.length - 1, Math.floor(0.9 * d.length))];
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
    timelineState: (id, t) => timelines.get(id)?.evaluate(t) ?? null,
    timelineInfo: (id) => {
      const t = timelines.get(id);
      return t ? { id: t.id, duration: t.duration, meta: t.meta?.() ?? null } : null;
    },
    motionPx: (id, t, shutter, fps, width, height) => {
      const tl = timelines.get(id);
      const h = engine.heightAt;
      if (!tl || !h) return null;
      // the void around the floating board is no ground: a ray that leaves the slab's footprint misses (the
      // HeightField clamps to its edge texels, which would extend the board's rim out to the horizon)
      const inFrame = engine.inFrame;
      const ground = inFrame ? (x: number, z: number) => (inFrame(x, z) ? h(x, z) : -Infinity) : h;
      return shutterMotionPx(tl.evaluate(t), tl.evaluate(t + shutter / fps), ground, width, height);
    },
    async render(req) {
      await ready;
      assertTerrainDetail();
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
      const fps = req.fps ?? 24;
      const frameDt = 1 / fps;
      const shutter = req.shutter ?? 0;
      const start = performance.now();
      // a registered timeline (the film): every sub-sample carries the frame's shutter centre (the overlay
      // lays its labels out there, for this capture's actual shutter) and, with several sub-samples, a
      // stratified LOD dither phase (LOD switches dissolve over the accumulation); still shots carry neither
      const film = !input;
      const shutterCentre = t0 + 0.5 * shutter * frameDt;
      // shutter 0 (every still) evaluates t0 for every sub-sample, exactly as before S5
      engine.renderAccumulated(
        (i, n) => {
          const s = timeline.evaluate(shutter > 0 ? t0 + shutterFraction(i, n) * shutter * frameDt : t0);
          return film ? { ...s, shutterCentre, ...(n > 1 ? { lodDither: lodDitherPhase(i, n) } : {}) } : s;
        },
        spp,
        Math.max(1, req.lensSpp ?? spp),
      );
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
      assertTerrainDetail();
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
