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
import { landmarkEmitters, landmarkExclusions, landmarkFalls, landmarkPools, landmarkReflectors, landmarkStamps, landmarkTreeCaps } from '../landmarks/world.ts';
import { buildLandmarks } from '../landmarks/build.ts';
import { EmissionSystem } from '../emission/EmissionSystem.ts';
import { EffectsSystem } from '../effects/EffectsSystem.ts';
import routeJson from '../../data/tour/route.json';
import timelineJson from '../../data/tour/timeline.json';
import { compileFilm, type FilmProgram } from '../tour/compile.ts';
import { FilmTimeline } from '../tour/FilmTimeline.ts';
import type { RouteJson, TimelineJson } from '../tour/schema.ts';
import { RouteSystem } from '../route/RouteSystem.ts';
import { TitleSystem, titleSubjects } from '../titles/TitleSystem.ts';
import { loadFilmFonts } from '../titles/fonts.ts';

/**
 * Load the world and register every system. Order matters: environment first (writes the shared
 * env uniforms), then the systems that read them. Landmark stamps are composited into the
 * HeightField before any system samples heights; the one landmark build run (geometry, lights,
 * trees) follows, before vegetation and water init consume its records.
 */
async function buildWorld(engine: Engine, quality: QualityTierId, shots: ShotSpecInput[], status: HTMLElement, filmMode: boolean): Promise<{ world: World; film: FilmProgram | null }> {
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
  water.setReflectors(landmarkReflectors(world, LANDMARKS));
  const vegetation = new VegetationSystem(world);
  vegetation.setExclusions(landmarkExclusions(world, LANDMARKS)); // before init → placed once
  vegetation.setAuthored(built.flatMap((b) => b.trees));
  vegetation.setForests(built.flatMap((b) => b.forests));
  vegetation.setTreeCaps(landmarkTreeCaps(world, LANDMARKS));
  const diorama = new DioramaSystem(world);
  const landmarks = new LandmarkSystem(world, built);
  const emission = new EmissionSystem(world, built.flatMap((b) => b.lights));
  // S4 W3-E: plumes, falls, mist, the beam; crater sparks and beacon flames ride on the emission sprites
  const effects = new EffectsSystem(world, { emitters: landmarkEmitters(world, LANDMARKS), falls: landmarkFalls(world, LANDMARKS), lights: emission.records, pools: landmarkPools(world, LANDMARKS) });
  // S5: the journey film (`?film=1` only — still pages never compile it, so their frames are untouched)
  const film = filmMode
    ? compileFilm({ world, landmarks: LANDMARKS, shots: shotsJson.shots as unknown as ShotSpecInput[], route: routeJson as unknown as RouteJson, timeline: timelineJson as unknown as TimelineJson, built })
    : null;
  let route: RouteSystem | null = null;
  let titles: TitleSystem | null = null;
  if (film) {
    mark('filmCompiled');
    // the route line + its head light, and the titles / captions overlay (fonts loaded before `ready`)
    await loadFilmFonts();
    mark('filmFonts');
    // (the crowns over the line come from the vegetation's placement: the route registers after it)
    route = new RouteSystem(world, film.film.route, (xyz, reachKm) => vegetation.canopyAlong(xyz, reachKm));
    const r = route;
    const f = film;
    // labels: laid out at the shutter's centre, placed off their landmark's silhouette, faded while it is
    // hidden behind terrain, and marking the route head while it rests on their landmark
    titles = new TitleSystem(film.film.captions, {
      fps: film.film.fps,
      shutter: film.film.shutter,
      stateAt: (t) => f.evaluate(t),
      heightAt: (x, z) => world.heights.sample(x, z),
      subjects: titleSubjects(built, (x, z) => world.heights.sample(x, z)),
      headAt: (s, out) => r.headPoint(s, out),
    });
    emission.setDynamic((s) => [...effects.lights(s), ...r.lights(s)]);
  } else emission.setDynamic((s) => effects.lights(s));
  for (const s of [environment, terrain, water, vegetation, diorama, landmarks, emission, effects, ...(route ? [route] : []), ...(titles ? [titles] : [])]) {
    await engine.register(s);
    mark(`init:${s.id}`);
  }
  if (film) {
    if (titles) engine.post.overlay = titles;
    // the route line keeps its gold through the grade (its coverage rides in the HDR alpha)
    if (route) engine.post.enableRouteKeep();
    // the film's adaptive motion-blur sampling measures ground motion on the slab only (not the void)
    engine.inFrame = (x, z) => world.spec.inFrame(x, z);
    // motion: the key shadow is fitted continuously (no extent steps, no texel snap) and fades out radially
    // at the end of its reach — a moving camera never sees the frustum jump (before the first compile)
    environment.shadow.setMode('smooth');
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
  if (film) {
    // film: one more throwaway frame with the route line, its head light and a caption card on screen, so
    // their pipelines and the first card texture exist before the first captured frame (bit-identical to
    // any later render of the same t)
    const filmState = film.evaluate(filmWarmTime(film));
    engine.applyState(filmState);
    await engine.renderer.compileAsync(engine.scene, engine.camera);
    engine.renderAccumulated(() => filmState, 1);
    await engine.post.readPixels();
  }
  mark('warm');

  // dev handle for diagnostics scripts (tools/capture/probe.ts)
  (window as unknown as { __app: unknown }).__app = { engine, world, terrain, environment, water, vegetation, diorama, landmarks, emission, effects, film, route, titles };
  return { world, film };
}

/**
 * A film time for the warm-up frame: the middle of the first place caption whose frame shows the route
 * (routeGlow and progress > 0), else of the first place caption, else the film's middle.
 */
function filmWarmTime(film: FilmProgram): number {
  const places = film.film.captions.filter((c) => c.kind === 'place');
  for (const c of places) {
    const t = (c.t0 + c.t1) / 2;
    const s = film.evaluate(t);
    if ((s.routeGlow ?? 0) > 0 && s.routeProgress > 0) return t;
  }
  return places.length ? (places[0].t0 + places[0].t1) / 2 : film.film.duration / 2;
}

/** Landmark bookmarks (`<id>-close` hero, `<id>-wide` context) as shots, orbiting the display position. */
export function landmarkShots(): ShotSpecInput[] {
  const out: ShotSpecInput[] = [];
  for (const def of LANDMARKS)
    for (const b of def.bookmarks ?? []) {
      const { id, tod, dayOfYear, weather, fStop, events, compare, note, expect: _expect, ...orbit } = b;
      out.push({
        id,
        tod: tod ?? 15,
        ...(dayOfYear !== undefined ? { dayOfYear } : {}),
        ...(weather ? { weather } : {}),
        ...(fStop !== undefined ? { fStop } : {}),
        ...(events ? { events } : {}),
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
  const api = installCaptureApi(engine, ready, resolveInWorld, (id) => shots.find((s) => s.id === id));
  const filmMode = params.has('film');

  try {
    const built = await buildWorld(engine, quality, shots, status, filmMode);
    world = built.world;
    if (built.film) api.registerTimeline(new FilmTimeline(built.film));
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
