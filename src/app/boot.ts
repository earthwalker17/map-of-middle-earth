import { Vector3 } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import shotsJson from '../../data/qa/shots.json';
import { Engine } from '../core/Engine.ts';
import { defaultSceneState, type SceneState } from '../core/types.ts';
import type { QualityTierId } from '../core/quality.ts';
import { installCaptureApi } from '../render/capture.ts';
import { World } from '../world/World.ts';
import { EnvironmentSystem } from '../environment/EnvironmentSystem.ts';
import { TerrainSystem } from '../terrain/TerrainSystem.ts';
import { WaterSystem } from '../water/WaterSystem.ts';
import { VegetationSystem } from '../vegetation/VegetationSystem.ts';
import { DioramaSystem } from '../diorama/DioramaSystem.ts';
import { resolveShot, type ShotSpecInput } from '../camera/shots.ts';
import { gradeUniforms } from '../render/PostPipeline.ts';

/**
 * Boot the world. System order matters: environment first (writes env uniforms), then the
 * systems that read them.
 */
export async function boot(canvas: HTMLCanvasElement, status: HTMLElement, params: URLSearchParams): Promise<void> {
  const capture = params.has('capture');
  const quality = (params.get('quality') as QualityTierId | null) ?? (capture ? 'review' : 'preview');
  const engine = await Engine.create({ canvas, width: innerWidth, height: innerHeight, quality, capture });
  engine.assertHardwareGpu();

  let readyResolve!: () => void;
  const ready = new Promise<void>((r) => (readyResolve = r));
  const shots = shotsJson.shots as unknown as ShotSpecInput[];
  let world!: World;
  installCaptureApi(engine, ready, (s) => resolveShot(world, s));

  status.textContent = 'loading world…';
  world = await World.load((m) => (status.textContent = `loading ${m}…`));
  engine.heightAt = (x, z) => world.heights.sample(x, z);

  const environment = new EnvironmentSystem();
  const terrain = new TerrainSystem(world);
  const water = new WaterSystem(world);
  await engine.register(environment);
  await engine.register(terrain);
  await engine.register(water);
  const vegetation = new VegetationSystem(world);
  const diorama = new DioramaSystem(world);
  await engine.register(vegetation);
  await engine.register(diorama);

  // warm up: compile pipelines once with a representative state
  const first = resolveShot(world, shots[0]);
  const warmState = defaultSceneState({ camera: first.camera, tod: first.tod, quality });
  engine.applyState(warmState);
  await engine.renderer.compileAsync(engine.scene, engine.camera);
  // one throwaway frame realizes lazily-created GPU resources (texture uploads, shadow maps, post
  // targets) so the first captured frame is bit-identical to any later render of the same state
  engine.renderAccumulated(() => warmState, 1);
  await engine.post.readPixels();
  // dev handle for diagnostics scripts (tools/capture/probe.ts)
  (window as unknown as { __app: unknown }).__app = { engine, world, terrain, environment, water, vegetation, diorama };
  readyResolve();
  status.textContent = `${engine.gpu.vendor} ${engine.gpu.architecture} · ${engine.gpu.backend} · ${quality}`;
  if (capture) return;

  // ------------------------------------------------------------------ explorer (interactive)
  const controls = new OrbitControls(engine.camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.zoomSpeed = 1.2;
  const applyShot = (id: string) => {
    const s = shots.find((x) => x.id === id);
    if (!s) return;
    const r = resolveShot(world, s);
    engine.camera.position.set(...r.camera.position);
    controls.target.set(...r.camera.target);
    ui.fov = r.camera.fov;
    ui.tod = r.tod;
    controls.update();
  };
  const ui = {
    shot: shots[0].id,
    tod: shots[0].tod,
    dayOfYear: 200,
    fov: 32,
    animateDay: false,
    exposure: 1,
  };
  const gui = new GUI({ title: 'Map of Middle-Earth' });
  gui.add(ui, 'shot', shots.map((s) => s.id)).onChange(applyShot);
  gui.add(ui, 'tod', 0, 24, 0.05).name('time of day').listen();
  gui.add(ui, 'dayOfYear', 0, 365, 1);
  gui.add(ui, 'fov', 10, 70, 0.5).listen();
  gui.add(ui, 'animateDay');
  gui.add(gradeUniforms.exposure, 'value', 0.2, 3, 0.01).name('exposure');
  applyShot(ui.shot);

  const onResize = () => engine.setSize(innerWidth, innerHeight);
  addEventListener('resize', onResize);
  const t0 = performance.now();
  const target = new Vector3();
  let last = t0;
  engine.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    if (ui.animateDay) ui.tod = (ui.tod + dt * 0.5) % 24;
    controls.update();
    target.copy(controls.target);
    const t = (now - t0) / 1000;
    const state: SceneState = defaultSceneState({
      t,
      tFx: t,
      tod: ui.tod,
      dayOfYear: ui.dayOfYear,
      quality,
      camera: {
        position: [engine.camera.position.x, engine.camera.position.y, engine.camera.position.z],
        target: [target.x, target.y, target.z],
        fov: ui.fov,
      },
    });
    engine.renderInteractive(state);
  });
}
