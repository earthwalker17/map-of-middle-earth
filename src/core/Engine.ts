import { PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu';
import { halton } from './rng.ts';
import { QUALITY, type QualityTier, type QualityTierId } from './quality.ts';
import type { FrameContext, InitContext, SceneState, System } from './types.ts';
import { PostPipeline } from '../render/PostPipeline.ts';

export interface GpuInfo {
  backend: 'webgpu' | 'webgl';
  vendor: string;
  architecture: string;
  description: string;
  isFallback: boolean;
  userAgent: string;
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  quality: QualityTierId;
  /** capture mode: no animation loop, fixed render size, readback path */
  capture: boolean;
}

/** Optional terrain clearance provider used to pick near/far planes. */
export type HeightProvider = (x: number, z: number) => number;

/**
 * Owns the renderer, scene, camera, systems and post pipeline. Rendering a frame is:
 * `renderState(state)` → systems evaluate the state → HDR render (xN jittered sub-samples) → post.
 */
export class Engine {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly systems: System[] = [];
  quality: QualityTier;
  post!: PostPipeline;
  gpu!: GpuInfo;
  heightAt: HeightProvider | null = null;
  width: number;
  height: number;

  private constructor(
    readonly renderer: WebGPURenderer,
    readonly options: EngineOptions,
  ) {
    this.quality = QUALITY[options.quality];
    this.width = options.width;
    this.height = options.height;
    this.camera = new PerspectiveCamera(35, options.width / options.height, 0.05, 8000);
  }

  static async create(options: EngineOptions): Promise<Engine> {
    const renderer = new WebGPURenderer({
      canvas: options.canvas,
      antialias: false,
      alpha: false,
      reversedDepthBuffer: true,
      powerPreference: 'high-performance',
    });
    await renderer.init();
    const engine = new Engine(renderer, options);
    engine.gpu = await Engine.describeGpu(renderer);
    renderer.setPixelRatio(options.capture ? 1 : window.devicePixelRatio * engine.quality.pixelRatio);
    renderer.setSize(options.width, options.height, !options.capture);
    renderer.shadowMap.enabled = true;
    const w = Math.round(options.width * renderer.getPixelRatio());
    const h = Math.round(options.height * renderer.getPixelRatio());
    engine.post = new PostPipeline(renderer, w, h, engine.quality.msaa, engine.quality.bloom);
    return engine;
  }

  private static async describeGpu(renderer: WebGPURenderer): Promise<GpuInfo> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const backend = renderer.backend as any;
    const isWebGPU = backend.isWebGPUBackend === true;
    let info: GPUAdapterInfo | undefined;
    if (isWebGPU && backend.device) {
      info = backend.device.adapterInfo ?? (await navigator.gpu?.requestAdapter())?.info;
    }
    return {
      backend: isWebGPU ? 'webgpu' : 'webgl',
      vendor: info?.vendor ?? 'unknown',
      architecture: info?.architecture ?? 'unknown',
      description: info?.description ?? '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      isFallback: Boolean((info as any)?.isFallbackAdapter),
      userAgent: navigator.userAgent,
    };
  }

  /** Throw if we are not on real WebGPU hardware (silent WebGL/SwiftShader fallback is a failure). */
  assertHardwareGpu(): void {
    if (this.gpu.backend !== 'webgpu') throw new Error(`Expected WebGPU backend, got ${this.gpu.backend}`);
    if (this.gpu.isFallback) throw new Error('WebGPU adapter is a fallback (software) adapter');
  }

  async register(system: System): Promise<void> {
    const ctx: InitContext = { scene: this.scene, camera: this.camera, quality: this.quality };
    await system.init?.(ctx);
    this.systems.push(system);
  }

  setQuality(id: QualityTierId): void {
    this.quality = QUALITY[id];
  }

  /** Resize the drawing buffer (in CSS px for interactive, exact px for capture). */
  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, !this.options.capture);
    const pr = this.renderer.getPixelRatio();
    this.post.setSize(Math.round(width * pr), Math.round(height * pr));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Apply the camera part of a state and let every system evaluate it. */
  applyState(state: SceneState): void {
    const cam = this.camera;
    const [px, py, pz] = state.camera.position;
    const [tx, ty, tz] = state.camera.target;
    cam.position.set(px, py, pz);
    cam.up.set(0, 1, 0);
    cam.lookAt(tx, ty, tz);
    if (state.camera.roll) cam.rotateZ((state.camera.roll * Math.PI) / 180);
    cam.fov = state.camera.fov;
    // near/far from terrain clearance: reversed-Z gives plenty of precision, keep near generous anyway
    const ground = this.heightAt ? this.heightAt(px, pz) : 0;
    const clearance = Math.max(0.01, py - ground);
    cam.near = Math.min(5, Math.max(0.005, clearance * 0.05));
    cam.far = 8000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    const frame: FrameContext = {
      state,
      camera: cam,
      scene: this.scene,
      quality: this.quality,
      viewport: { width: this.post.width, height: this.post.height },
    };
    for (const s of this.systems) s.evaluate(frame);
  }

  /** Render one presented frame for interactive use (single sample). */
  renderInteractive(state: SceneState): void {
    this.applyState(state);
    this.renderer.setRenderTarget(this.post.hdr);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.post.present(false, false);
  }

  /**
   * Offline render: `spp` jittered sub-samples; each sub-sample may evaluate a different state
   * (sub-frame time for motion blur). Result goes to the readback target.
   */
  renderAccumulated(stateAt: (sub: number, spp: number) => SceneState, spp: number): void {
    const cam = this.camera;
    const w = this.post.width;
    const h = this.post.height;
    this.post.beginAccumulation();
    for (let i = 0; i < spp; i++) {
      this.applyState(stateAt(i, spp));
      if (spp > 1) {
        // Halton(2,3) jitter in pixels, centred on 0
        const jx = halton(i + 1, 2) - 0.5;
        const jy = halton(i + 1, 3) - 0.5;
        cam.setViewOffset(w, h, jx, jy, w, h);
      }
      this.renderer.setRenderTarget(this.post.hdr);
      this.renderer.render(this.scene, cam);
      this.renderer.setRenderTarget(null);
      this.post.accumulate();
      cam.clearViewOffset();
    }
    this.post.present(true, true);
  }
}
