# Architecture — Map of Middle-Earth

Contracts that later sessions populate. Keep this document about *interfaces and data flow*;
session history belongs in `PROJECT_STATE.md`.

## Data flow
```
data/source (third-party, fetched)          data/world/*.json (authored truth)
        │  pnpm bake (tools/bake, Python)          │
        ▼                                          ▼
data/baked/  height.u16 · water/landcover/forests/look .rgba8 · rivers/lakes/roads.json · manifest.json
        │  served at /world/* (vite plugin; MOME_WORLD_DIR overrides the directory for worktrees)
        ▼
World (src/world/World.ts): WorldSpec · HeightField (+ stamp layer) · mask textures · look layers · places
        │  constructor-injected into systems
        ▼
Engine: Timeline.evaluate(t) → SceneState → systems.evaluate(frame) → HDR render (×spp) → PostPipeline
        │                                                                  │
        ▼                                                                  ▼
  canvas (explorer)                                   readback → /__capture/frame → PNG / ffmpeg
```

## Coordinates & units
- **ME-GIS km** `[x east, y north]`: all authored data (`places.json`, `regions.geojson`, `route.json`).
- **World**: 1 unit = 1 km, origin at frame centre (ME-GIS 900, 920 km), X east, **−Z north**, Y up.
  `WorldSpec.kmToWorld / worldToKm / worldToUv`.
- **Map uv**: u west→east, v north→south; texture row 0 = north (all baked rasters, `DataTexture` flipY=false).
- **Heights** are world units after exaggeration (`world.json → vertical`): scale-split relief (massifs ×12
  with γ 0.8; local relief ×0.45 of that), sea level = 0, synthesized + DEM-shelf bathymetry below.

## Core contracts (src/core)
- `SceneState` — complete description of a frame: `t`, `tFx` (effect clock), `tod`, `dayOfYear`, `camera`,
  `lens`, `routeProgress`, `annotations`, `lookOverride`, `quality`.
- `Timeline.evaluate(t) → SceneState`. `StaticTimeline` for stills/bookmarks; the tour timeline (S8) is data.
- `System { id, init?(ctx), evaluate(frame), dispose? }` — `evaluate` must be a pure function of
  `frame.state` + static data (random access to any frame). Stateful sims are documented exceptions that
  pre-roll from shot start.
- `rand(seed, id, k)` / `hash32` / `halton` — stateless randomness only.
- Quality tiers `preview | review | final` (`src/core/quality.ts`).
- `Engine.renderAccumulated(stateAt, spp)` — jittered sub-samples (Halton), optional sub-frame time
  (motion blur), running average in HDR, then one post pass.

## World services (src/world)
- `HeightField` — **the only height API**: `sample`, `normal`, `rangeMinMax` (culling bounds), `raycast`,
  GPU `texture` (R32F linear), and `setStamps(stamps)` (TypeScript stamp layer; no re-bake needed).
- Stamps (`stamps.ts`): `flatten | raise | cone | plateau | carve` — declared as data by landmarks.
- `World.places` — `places.json` resolved to world coordinates (display = canonical + `displayOffsetKm`).
- Mask textures (RGBA8, linear): `water` (riverChannel, lake, land, riverValley), `landcover` (forest,
  wetland, vulcanism, road), `forests` (mirkwood, fangorn, lorien, oldForest), `look` (array texture: 4
  region weights per layer, order = `manifest.files.look.regions`).

## Materials (src/materials)
- `env` (environment.ts) — shared uniforms (sun/moon/sky/fog/night/golden/wind/cameraPos/tFx). Written only by
  `EnvironmentSystem`; animated shaders use `env.tFx`, never TSL `time`.
- `LookNodes` (looks.ts) — region palettes as uniform arrays + per-pixel region weights.
- Shader code imports TSL through the `tsl` facade (`src/materials/tsl.ts`) — typed loosely on purpose.
- Material families: terrain (terrain/terrainMaterial.ts), water, foliage, stone, obsidian/metal, emissive,
  particle, text — one factory per family; per-instance parameters instead of new materials.

## Systems (registration order in src/app/boot.ts)
1. `EnvironmentSystem` (environment/) — time of day → sun/moon/sky/hemisphere/fog, view-fitted texel-snapped
   sun shadow. Owns the sky (reversed-Z depth patch for SkyMesh).
2. `TerrainSystem` (terrain/) — one instanced CDLOD draw (root 320 km, 8 levels, morph + skirts).
3. `WaterSystem` (water/) — sea, lakes, rivers, waterfalls.
4. `VegetationSystem` (vegetation/) — forest canopy + instanced near clumps, scatter.
5. `DioramaSystem` (diorama/) — the slab: strata sides, sea cross-section, base, backdrop, props.
6. `LandmarkSystem` (landmarks/) — realizes `defineLandmark` bundles.
7. (later) `EffectsSystem`, `RouteSystem`, `AnnotationSystem`.

## Landmarks (src/landmarks)
`defineLandmark({ id, placeId, tier, stamps[], model, lodDistances, lights[], emitters[], waterFeatures[],
vegetationExclusion, lookOverride, night, annotation, bookmarks[], cameraConstraints, audioHooks })`.
Folders are auto-discovered (`import.meta.glob`). Landmarks never create materials, particle systems or
render loops — shared systems realize their declarations. Proxies (S1) → Blender GLB LODs (S4+).

## Capture & QA (tools/capture)
- `window.__mm` (capture mode `?capture=1`): `ready`, `info()`, `render({name, shot|timelineId, t, width,
  height, spp, shutter, fps})` → RGBA readback POSTed to `/__capture/frame`.
- `pnpm shots --shot <id> | --all | --smoke [--spp n --w --h --tod --quality --determinism]` →
  `renders/shots/<stamp>/` + `latest/`. Shots live in `data/qa/shots.json` (explicit camera or `orbit`).
- GPU lock: one machine-wide lock file in the OS temp dir — every GPU tool takes it (parallel agents
  code concurrently, render one at a time).
- `tools/capture/probe.ts "<expr>"` evaluates an expression against `window.__app` for diagnostics.
