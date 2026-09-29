# Architecture — Map of Middle-Earth

Contracts that later sessions populate. Keep this document about *interfaces and data flow*;
session history belongs in `PROJECT_STATE.md`.

## Data flow
```
data/source (third-party, fetched)          data/world/*.json (authored truth)
        │  pnpm bake [--steps …] (tools/bake, Python; heavy-job lock, cached steps)
        ▼                                          ▼
data/baked/  height.u16 · water/landcover/forests/look/terrain .rgba8 · rivers/lakes/roads.json ·
             report.json (validator input) · manifest.json (sha256 per file)
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
- **Heights** are world units after exaggeration (`world.json → vertical`): three-band relief (massifs ×12
  with γ 0.8; meso relief ×`detailRatio`; micro relief ×`microRatio` — the "de-spike"), pulled toward the
  unsplit exaggeration inside river-valley bands (`valleyBandKm`); sea level = 0, synthesized + DEM-shelf
  bathymetry below (`seaArtefacts` removes known DEM ridges).

## Core contracts (src/core)
- `SceneState` — complete description of a frame: `t`, `tFx` (effect clock), `tod`, `dayOfYear`, `camera`,
  `lens`, `routeProgress`, `annotations`, `lookOverride`, `weather {cloudCoverage, wind}`, `quality`.
  Bookmark shots carry their landmark's `lookOverride`.
- `Timeline.evaluate(t) → SceneState`. `StaticTimeline` for stills/bookmarks; the tour timeline (S8) is data.
- `System { id, init?(ctx), evaluate(frame), dispose? }` — `evaluate` must be a pure function of
  `frame.state` + static data (random access to any frame). Stateful sims are documented exceptions that
  pre-roll from shot start.
- `rand(seed, id, k)` / `hash32` / `halton` — stateless randomness only.
- Quality tiers `preview | review | final` (`src/core/quality.ts`): pixel ratio, spp, terrain patch grid,
  shadow map, density, `terrainDetail {size, layers}`, `atmosphere {inScatter}`, `clouds {shadows, layer}`.
- `Engine.renderAccumulated(stateAt, spp)` — jittered sub-samples (Halton), optional sub-frame time
  (motion blur), running average in HDR, then one post pass.

## World services (src/world)
- `HeightField` — **the only height API**: `sample`, `normal`, `rangeMinMax` (culling bounds), `raycast`,
  GPU `texture` (R32F linear), and `setStamps(stamps)` (TypeScript stamp layer; no re-bake needed).
  **River guard ("rivers win")**: after stamps are composited, the water itself (ribbon, lake + graded shore)
  keeps its baked height and stamped terrain beside it is clamped to the water level ± a natural bank
  (`world.json rivers.stampBankSlope`); `places.json onRiver` landmarks are exempt; `stampLoss()` reports
  how much of each landmark's stamp the guard removed (validated in `pnpm check`).
- Stamps (`stamps.ts`): `flatten | raise | cone | plateau | carve` — declared as data by landmarks, relative
  to the landmark's base ground (a cone's profile applies to the height above `base`).
- `World.places` — `places.json` resolved to world coordinates (display = canonical + `displayOffsetKm`).
- Mask textures (RGBA8, linear): `water` (riverChannel, lake, land, riverValley), `landcover` (forest,
  wetland, vulcanism, road), `forests` (mirkwood, fangorn, lorien, oldForest), `look` (array texture: 4
  region weights per layer, order = `manifest.files.look.regions`; uncovered weight belongs to the default
  region), `terrainMask` (2000×1200: ao, valley/TPI (0.5 flat), wetness, log flow accumulation).
- `World.rivers` — `rivers.json` v2: processed centrelines (0.25 km) with per-point `level[]`/`bed[]`
  (monotone downstream except at declared `falls`), `id`, `into` (parent line or lake), per-line flow width.
  Built by the bake's river DAG (hydro.py/profiles.py/snap.py): topology from sinks, stems through lakes,
  **thalweg snap** (Viterbi path over lateral offsets toward the DEM valley floor within a class window,
  `world.json rivers.snap`), pit closing, expectile-isotonic profiles, bank spill cap, clipped confluences,
  edge-bounded carve walls + capped levee, band marsh fills that follow the river level, lake levels solved
  in stems with deltas/lips at the shore. Every gate the bake reports lives in `report.json`.
- `src/world/fields.ts` — the shared Shire/Bree field lattice (hedgerows + field colouring).

## Materials (src/materials)
- `env` (environment.ts) — shared uniforms (sun/moon/sky/night/golden/wind/cloudCoverage/cameraPos/tFx, air
  density/falloff/extinction, hazeRamp, cloudShadow…). Written only by `EnvironmentSystem`; animated shaders
  use `env.tFx`, never TSL `time`.
- `atmosphere` (atmosphere.ts) — **the shared aerial perspective**: `scene.fogNode = atmosphere.fogNode()`;
  per-channel extinction + sun-phase in-scatter from a sky-radiance LUT, distance-ramped (`env.hazeRamp`:
  near field clear, depth grows with distance), height falloff, y < 0 clip (slab/void in clear studio air),
  regional haze from a CPU-built texture (`bindWorld`: region weights × `looks.json atmo` + place spots),
  valley mist (ground layer thickened over `terrainMask` valleys at low sun). The water material uses the
  same functions.
- Ground look (looks.ts): `groundLookTexture(world)` bakes region weights × `looks.json ground` (+ place /
  km spots) once on the CPU into a 5-layer sRGB array texture (grass+dryness, dry+pattern, soil+snowline
  offset, rock+volcanic, rockiness+turf); `groundPalette(tex, uv)` reads it (domain-warped). `TERRAIN_SHADE`
  and the shared TSL rules (`snowLineAt`, `alpineAt`, `rockAt`, `snowAt`, `coarseGroundAlbedo`) are the single
  source for anything that approximates the terrain (the water's reflected terrain uses them).
- `looks.json` — one key per line per region: `ground` (terrain palette), `grade` (tint, saturation,
  contrast, exposure, lift, redKeep, bloom, spots[] per place), `atmo` (tint, density (> 1 = local haze),
  sky, spots[]).
- Shader code imports TSL through the `tsl` facade (`src/materials/tsl.ts`) — typed loosely on purpose.
- Material families: terrain (terrain/terrainMaterial.ts), water, foliage, stone, obsidian/metal, emissive,
  particle, text — one factory per family; per-instance parameters instead of new materials.

## Systems (registration order in src/app/boot.ts)
1. `EnvironmentSystem(world)` (environment/) — time of day → keyframed daylight (by sun elevation), own TSL
   sky (Preetham port + twilight/night layer, sun/moon discs, deterministic stars, studio-lit void backdrop
   below the horizon), the aerial perspective, one shadow light (sun → moon handover at −4°) with a
   slab-clipped, size-quantized, texel-snapped soft PCF shadow (re-rotated per accumulation sample).
   **RegionLook** (regionLook.ts): the post grade is a pure function of the camera focus — region weights
   sampled on the CPU over a disk around the target, blended `looks.json grade`, `lookOverride` honoured,
   no temporal smoothing. **Cloud shadows** (clouds.ts): deterministic world-XZ field scrolled by
   `weather.wind × tFx`, coverage from `weather`, applied through the key light's `colorNode`, slab top only.
2. `TerrainSystem` (terrain/, async init) — one instanced CDLOD draw (root 320 km, 8 levels, morph + skirts).
   Surface pass: 5 shared height taps → normal, slope, curvature; `terrainMask` AO/valley (faded where stamps
   changed the ground); ground look + regional rules (alpine rock, dry-brushed crests, scree, snow v2 with
   aspect and per-region snowlines, volcanic ash/fissures, wetland pools, shores, forest floor, Shire fields).
   `groundMaps.ts` builds CPU masks at init: stamp turf/presence (stamped − base), shore bands, the Shire field
   mask (from `fields.ts`). Detail: 6 CC0-derived layers (`tools/textures/prep.mjs` → `public/textures/terrain`,
   luminance-normalised so the palette keeps the hue; preview 512²×4 planar, review 512²×6, final 1024²×6
   triplanar on hard ground), faded by texel footprint. Raw sources live in `data/textures-src` (never shipped;
   `pnpm data:fetch` syncs + derives).
3. `WaterSystem` (water/) — one material family (presets sea/lake/river): depth absorption, sky+heightfield
   reflection, env.tFx waves, shore foam; sea plane, earcut lakes at manifest levels, merged river ribbons
   built from the baked v2 points/levels as-is (flat across; whitewater only at declared falls or steep baked
   grades; the v1 heuristic stays as a fallback). Waterfalls → effects (S4).
4. `VegetationSystem` (vegetation/) — hashed world-grid placement from forest/look/water masks, forest types
   (Mirkwood, Fangorn, Lórien, old, deciduous), hedgerows/scatter, 32 km chunks × 4 LODs, near-camera fill
   band, foliage material (wrap + translucency); `setExclusions(circles)` (landmark footprints).
5. `DioramaSystem` (diorama/) — the slab: strata cut faces following the terrain edge profile, glassy sea
   cross-section, satin-stone plinth.
6. `LandmarkSystem` (landmarks/) — realizes `defineLandmark` bundles.
7. (later) `EffectsSystem`, `RouteSystem`, `AnnotationSystem`.

## Landmarks (src/landmarks)
`defineLandmark({ id, placeId, tier, stamps[], model, lodDistances, lights[], emitters[], waterFeatures[],
vegetationExclusion, lookOverride, night, annotation, bookmarks[], cameraConstraints, audioHooks })`.
Folders are auto-discovered (`import.meta.glob`). Landmarks never create materials, particle systems or
render loops — shared systems realize their declarations. Proxies (S1) → Blender GLB LODs (S4+).

## Capture & QA (tools/capture)
- The readback target stores bytes as-is (NoColorSpace): the post pass already encodes sRGB.
- `window.__mm` (capture mode `?capture=1`): `ready`, `info()`, `render({name, shot|timelineId, t, width,
  height, spp, shutter, fps})` → RGBA readback POSTed to `/__capture/frame`; `benchmark({shotId, frames,
  orbitDeg})` → interactive-path frame latency (diagnostics only).
- `pnpm shots --shot <id> | --all | --smoke [--spp n --w --h --tod --quality --determinism --batch k --no-latest]` →
  `renders/shots/<stamp>/` + `latest/`. Shots live in `data/qa/shots.json` + `shots.d/` (explicit camera or
  `orbit`); named sets in `data/qa/sets.json`.
- `pnpm qa --set s1 --batch 8` renders a set in bounded batches (fresh Vite + Chrome each), then composes
  contact / compare sheets (references paired from `reference/manifest.json` by subject) and an anonymised
  `blind/` set for recognizability critics.
- Heavy-job lock: one machine-wide lock (`%LOCALAPPDATA%\map-of-middle-earth\gpu.lock`, heartbeat) taken by
  captures, `pnpm bake` and `pnpm build` (`tools/heavy.ts`) after a free-RAM guard (`tools/capture/host.ts`);
  orphaned capture Chrome of the checkout is swept while the lock is held.
- `pnpm perf [--gate]` — preview-tier boot/compile/frame-latency probe vs `data/qa/perf-baseline.json`.
- `tools/capture/probe.ts "<expr>"` evaluates an expression against `window.__app` for diagnostics.
- `tools/capture/pair.ts --a <run> --b <run>` — blind A/B sheets (left/right shuffled; key outside the folder).

## Validation (tools/check, CPU only)
- `pnpm check` (run.ts): places/footprints, landmark definitions, assets vs CREDITS, and on the baked world
  (honours `MOME_WORLD_DIR`): river levels monotone except at falls, rivers win over stamps, per-landmark
  stamp loss, bake hydro report gates (report.json).
- `tools/check/geometry.ts` (`MOME_BASELINE_DIR`): coast IoU, lake wetted areas, channel alignment, landmark
  ground and named-peak changes, snowline/treeline area moved, steepness — vs a frozen bake.
- `tools/check/cameras.ts` — CPU camera probe (sky/foreground/line of sight/subject NDC, lakes, slab
  framing) for designing bookmarks and shot lists without rendering.
