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
import { LANDMARKS } from '../landmarks/registry.ts';
import { LandmarkSystem } from '../landmarks/LandmarkSystem.ts';
import { landmarkExclusions, landmarkPools, landmarkStamps } from '../landmarks/world.ts';
import { buildLandmarks } from '../landmarks/build.ts';
import { EmissionSystem } from '../emission/EmissionSystem.ts';

/**
 * Load the world and register every system. Order matters: environment first (writes the shared
 * env uniforms), then the systems that read them. Landmark stamps are composited into the
 * HeightField before any system samples heights; the one landmark build run (geometry, lights,
 * trees) follows, before vegetation and water init consume its records.
 */
async function buildWorld(engine: Engine, quality: QualityTierId, shots: ShotSpecInput[], status: HTMLElement): Promise<World> {
  status.textContent = 'loading world…';
  const mark = (k: string) => (engine.timings[k] = Math.round(performance.now()));
  const world = await World.load((m) => (status.textContent = `loading ${m}…`));
  mark('worldLoaded');
  world.heights.setStamps(landmarkStamps(world, LANDMARKS));
  engine.heightAt = (x, z) => world.heights.sample(x, z);
  // landmark bookmarks join the shot list (explorer + capture)
  shots.push(...landmarkShots());
  const built = await buildLandmarks(world, LANDMARKS);
  mark('landmarksBuilt');

  const environment = new EnvironmentSystem(world);
  const terrain = new TerrainSystem(world);
  const water = new WaterSystem(world);
  water.setPools(landmarkPools(world, LANDMARKS));
  const vegetation = new VegetationSystem(world);
  vegetation.setExclusions(landmarkExclusions(world, LANDMARKS)); // before init → placed once
  vegetation.setAuthored(built.flatMap((b) => b.trees));
  vegetation.setForests(built.flatMap((b) => b.forests));
  const diorama = new DioramaSystem(world);
  const landmarks = new LandmarkSystem(world, built);
  const emission = new EmissionSystem(world, built.flatMap((b) => b.lights));
  for (const s of [environment, terrain, water, vegetation, diorama, landmarks, emission]) {
    await engine.register(s);
    mark(`init:${s.id}`);
  }

  // warm up: compile pipelines, then one throwaway frame realizes lazily-created GPU resources
  // (texture uploads, shadow maps, post targets) so the first captured frame is bit-identical to
  // any later render of the same state
  const first = resolveShot(world, shots[0]);
  const warmState = defaultSceneState({ camera: first.camera, tod: first.tod, quality });
  engine.applyState(warmState);
  await engine.renderer.compileAsync(engine.scene, engine.camera);
  mark('compiled');
  engine.renderAccumulated(() => warmState, 1);
  await engine.post.readPixels();
  mark('warm');

  // dev handle for diagnostics scripts (tools/capture/probe.ts)
  (window as unknown as { __app: unknown }).__app = { engine, world, terrain, environment, water, vegetation, diorama, landmarks, emission };
  return world;
}

/** Landmark bookmarks (`<id>-close` hero, `<id>-wide` context) as shots, orbiting the display position. */
export function landmarkShots(): ShotSpecInput[] {
  const out: ShotSpecInput[] = [];
  for (const def of LANDMARKS)
    for (const b of def.bookmarks ?? []) {
      const { id, tod, dayOfYear, weather, fStop, compare, note, expect: _expect, ...orbit } = b;
      out.push({
        id,
        tod: tod ?? 15,
        ...(dayOfYear !== undefined ? { dayOfYear } : {}),
        ...(weather ? { weather } : {}),
        ...(fStop !== undefined ? { fStop } : {}),
        ...(compare ? { compare } : {}),
        ...(note ? { note } : {}),
        lookOverride: def.lookOverride ?? null,
        camera: { orbit: { place: def.placeId, ...orbit } },
      });
    }
  return out;
}

export async function boot(canvas: HTMLCanvasElement, status: HTMLElement, params: URLSearchParams): Promise<void> {
  const capture = params.has('capture');
  const quality = (params.get('quality') as QualityTierId | null) ?? (capture ? 'review' : 'preview');
  const engine = await Engine.create({ canvas, width: innerWidth, height: innerHeight, quality, capture });
  engine.timings.engineCreated = Math.round(performance.now());
  engine.assertHardwareGpu();

  const shots = [...(shotsJson.shots as unknown as ShotSpecInput[])];
  let world: World | null = null;
  let settle!: { resolve: () => void; reject: (e: unknown) => void };
  const ready = new Promise<void>((resolve, reject) => (settle = { resolve, reject }));
  ready.catch(() => {}); // surfaced to the capture harness through window.__mm.ready
  const resolveInWorld = (s: ShotSpecInput) => {
    if (!world) throw new Error('world not loaded');
    return resolveShot(world, s);
  };
  installCaptureApi(engine, ready, resolveInWorld, (id) => shots.find((s) => s.id === id));

  try {
    world = await buildWorld(engine, quality, shots, status);
    settle.resolve();
  } catch (e) {
    settle.reject(e);
    throw e;
  }
  status.textContent = `${engine.gpu.vendor} ${engine.gpu.architecture} · ${engine.gpu.backend} · ${quality}`;
  if (!capture) runExplorer(engine, world, shots, quality, canvas);
}

/** Interactive explorer: orbit controls + debug GUI (wall-clock time is allowed here only). */
function runExplorer(engine: Engine, world: World, shots: ShotSpecInput[], quality: QualityTierId, canvas: HTMLCanvasElement): void {
  const controls = new OrbitControls(engine.camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.zoomSpeed = 1.2;
  const ui = { shot: shots[0].id, tod: shots[0].tod, dayOfYear: 200, fov: 32, animateDay: false };
  let shotLook: Pick<SceneState, 'lookOverride'> & { weather?: Partial<SceneState['weather']> } = { lookOverride: null };
  const applyShot = (id: string) => {
    const s = shots.find((x) => x.id === id);
    if (!s) return;
    const r = resolveShot(world, s);
    engine.camera.position.set(...r.camera.position);
    controls.target.set(...r.camera.target);
    ui.fov = r.camera.fov;
    ui.tod = r.tod;
    ui.dayOfYear = r.dayOfYear ?? 200;
    shotLook = { lookOverride: r.lookOverride ?? null, weather: r.weather };
    controls.update();
  };
  const gui = new GUI({ title: 'Map of Middle-Earth' });
  gui.add(ui, 'shot', shots.map((s) => s.id)).onChange(applyShot);
  gui.add(ui, 'tod', 0, 24, 0.05).name('time of day').listen();
  gui.add(ui, 'dayOfYear', 0, 365, 1).listen();
  gui.add(ui, 'fov', 10, 70, 0.5).listen();
  gui.add(ui, 'animateDay');
  gui.add(gradeUniforms.exposure, 'value', 0.2, 3, 0.01).name('exposure');
  applyShot(ui.shot);

  addEventListener('resize', () => engine.setSize(innerWidth, innerHeight));
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
    const base = defaultSceneState();
    const state: SceneState = defaultSceneState({
      t,
      tFx: t,
      tod: ui.tod,
      dayOfYear: ui.dayOfYear,
      lookOverride: shotLook.lookOverride,
      weather: { ...base.weather, ...shotLook.weather },
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
