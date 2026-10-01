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
- `Timeline.evaluate(t) → SceneState`. `StaticTimeline` for stills/bookmarks; the tour timeline (S4) is data
  (`data/tour/timeline.json`), drafted by the S3 shot list `data/tour/shotlist.json` (film segments,
  per-landmark role, hero / context framing, detail budgets).
- Shots: explicit `{position, target, fov, roll}` or `{orbit: {place | targetKm, distanceKm, elevationDeg,
  azimuthDeg, fov, lift, aimKm [east, north], roll}}` (src/camera/shots.ts). Landmark bookmarks
  (`<id>-close` hero, `<id>-wide` context) carry tod, dayOfYear, weather, fStop, compare, note and the
  landmark's lookOverride.
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
  **River guard ("rivers win")**: after stamps are composited, the channel core keeps its baked height; under
  the rest of the ribbon the ground stays between the baked bank and the water, and beyond it stamped terrain
  is clamped to the water level ± a natural bank (`world.json rivers.stampBankSlope`) — no blend back to baked
  walls. `places.json onRiver` landmarks are exempt; `stampLoss()` reports how much of each landmark's stamp
  the guard removed (validated in `pnpm check`).
- Stamps (`stamps.ts`): `flatten | raise | cone | plateau | carve` and (S3) `ridge | scarp | massif | basin`
  — declared as data by landmarks, relative to the landmark's base ground (a cone's / massif's profile
  applies to the height above `base`; `flatten lowerOnly` only cuts ground above its target, e.g. the
  Osgiliath terrace). `ridge` (polyline crest, per-vertex heights, round/sharp profile, asymmetry),
  `scarp` (one side raised into a plateau with a steep face), `massif` (mountain body with arête-to-shoulder
  spurs + side ridges, dome, flank slope, crater, `snowCap`; never lowers), `basin` (flattened floor + rim).
  `rough` (deterministic value noise; octaves < 1.6 km dropped) on raise / cone / v2 kinds; `surface:
  'turf' | 'rock'` overrides the stamp-turf mask (groundMaps `surfaceOverride`). **Resolution rule:** the
  heightfield is 0.4 km/texel — stamps shape forms ≥ ~1.2 km; sheer faces narrower than that are kit
  `cliff` geometry seated on the stamp; beside rivers, walls are raised, never carved below the water.
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
- `src/world/fields.ts` — the shared Shire/Bree field lattice and `fieldWeightAt` (noise-frayed patchwork
  rule) used by both the hedgerows and the terrain's field colouring.

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
- Ground look (looks.ts): `LookField` — one shared CPU region-weight field (multi-scale warp + noise dither,
  per-region `ecotone` width) used by the ground look, the regional haze and the field fringe, released after
  init. `groundLookTexture(world)` bakes it × `looks.json ground` (+ place / km spots) into a 5-layer sRGB array
  texture (grass+dryness, dry+pattern, soil+snowline offset, rock+volcanic, rockiness+wetland cover);
  `groundPalette(tex, uv, explicitLod?)` reads it. `TERRAIN_SHADE`
  and the shared TSL rules (`snowLineAt`, `alpineAt`, `rockAt`, `snowAt`, `coarseGroundAlbedo`) are the single
  source for anything that approximates the terrain (the water's reflected terrain uses them).
- `looks.json` — one key per line per region: `ground` (terrain palette), `grade` (tint, saturation,
  contrast, exposure, lift, redKeep, bloom, spots[] per place), `atmo` (tint, density (> 1 = local haze),
  sky, spots[]).
- Shader code imports TSL through the `tsl` facade (`src/materials/tsl.ts`) — typed loosely on purpose.
- Material families: terrain (terrain/terrainMaterial.ts), water, foliage, landmark structures
  (families.ts), emission sprites (src/emission), particle, text — one factory per family; per-instance /
  per-vertex parameters instead of new materials.
- **Landmark families v2** (families.ts): TWO uber materials for every landmark mesh — `structure`
  (opaque; casts and receives shadows) and `glow` (neither). Family presets are data (`FAMILY`:
  stone, darkStone, weathered, plaster, wood, thatch, slate, roofTile, gold, obsidian, iron, foliage, metal,
  emissive, emissiveGreen, lava, ithildin) packed per vertex: `color` u8×4 = absolute sRGB paint + baked
  hemisphere AO in `a` (→ the material's AO slot only); `surf` u8×4 = roughness, metalness, grain,
  `a` = noise class × 32 + ground-contact term (0..31; class 4 = foliage) — for glow: strength/16, gate
  code, flicker. Contact is the only baked term on the albedo (`× mix(1, contact, 0.3)`). Landmark-local
  fwidth-faded noise (≈9, 37, 140 /km) + stone coursing on walls. Glow = paint × strength × gate × flicker
  (gates from env: always · night = clamp(smoothstep(0.2, 0.7, night) + 0.4·twilight) · dusk =
  0.25 + 0.75·max(night, golden) · event = 0 until S4). `materialFor(key)` resolves geometry keys;
  `familyVertex(fam, paint?, shade?, tint?, glow?)` packs a vertex (also used for GLBs). Specular ambient:
  the scene has no environment map, so `structure` adds a Fresnel-weighted (F0 0.04 → albedo for metals)
  hemisphere sky / ground radiance along the reflection vector (`env.skyColor / groundColor ×
  hemiIntensity`), dimmed by roughness and the baked AO — metals and glossy dark stone keep form in shade.

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
   triplanar on hard ground, triplanar soft detail in review/final), faded by texel footprint. Missing or
   stale detail fails loudly in capture / review / final (`terrainDetailError`, capture assertion). Raw sources
   live in `data/textures-src` (never shipped; `pnpm data:fetch` syncs + derives).
3. `WaterSystem` (water/) — one material family (presets sea/lake/river): depth absorption, sky+heightfield
   reflection, env.tFx waves, shore foam; sea plane, earcut lakes at manifest levels (+ landmark pools from
   `setPools`, merged into the lake mesh with a `waterPool` attribute), merged river ribbons
   built from the baked v2 points/levels as-is (flat across; whitewater only at declared falls or steep baked
   grades; the v1 heuristic stays as a fallback). Waterfalls → effects (S4).
4. `VegetationSystem` (vegetation/) — hashed world-grid placement from forest/look/water masks, forest types
   (Mirkwood, Fangorn, Lórien + emergent mallorns, old, Ithilien groves, deciduous), glades/stands, a Barren
   rule (Mordor, Dagorlad, the Morannon approach, sparse Brown Lands/Emyn Muil), hedgerows on the shared field
   lattice. Every instance is a **cluster of 7 sub-crowns** (10-float records); per-instance LOD (5 levels, a
   single blob below ~5 px), 32 km chunks, near-camera fill band. Foliage material: wrap + translucency +
   per-kind sky fill, micro-structure from a precomputed tileable 48³ foam texture (preview 1 tap, review/final
   2). Note the WebGPU limit of 8 vertex buffers and that `meta` is a reserved WGSL word.
   `setExclusions(circles)` (landmark footprints, several circles per landmark allowed).
   **Authored hero trees** (S3, authored.ts): `setAuthored(trees)` — landmark `AuthoredTree` records
   mapped onto the existing kinds/records (mallorn → tiered Lórien crowns, oak/party → Oak, holly → Dark,
   autumn → Oak in autumn colours, conifer → Generic, poplar/willow → River, scrub → Scrub), emitted as a
   hero list BEFORE the chunks (they win the LOD0 cap; never excluded, barren-ruled or thinned) with a
   dedicated hero trunk geometry (flared, tapered, limbs) at LOD0; `mallornFrame()` gives landmarks the
   trunk / tier geometry to seat flets and lamps. Visible chunks are filled nearest-first.
   **Landmark forests** (S3, forests.ts): `setForests(records)` — landmark `ForestDecl`s (area: circle /
   annulus / polygon / band; density per km²; species mix with crown / height ranges and palettes; stand
   clumping; edge feather; clearings; slope and lowest-ground limits) placed as ordinary coarse instances
   (chunked, LOD-capped, thinned with the quality density), deterministic per (seed, world cell);
   conifers as two-tier firs. Masses of trees go here; `trees` stay for a few characterful individuals.
5. `DioramaSystem` (diorama/) — the slab: strata cut faces following the terrain edge profile (tier-aware:
   the preview variant moves fold/undulation to the vertex stage), glassy sea cross-section, satin-stone
   plinth.
6. `LandmarkSystem` (landmarks/) — realizes the built landmarks (see Landmarks): one group per LOD,
   exactly one visible, chosen per landmark from the projected bounding radius
   `hypot(bounds.r, bounds.h/2) · (H / (2·tan(fov/2))) / max(1, |camera − bounds.center|)` against
   `lodPx` (default [160, 40]); a pure function of the camera (no hysteresis), evaluated per
   accumulation sub-sample. Fixed design scale — never distance-dependent size (S3 readability policy).
7. `EmissionSystem` (emission/) — every landmark `LightRecord` as ONE instanced additive sprite draw in the
   main HDR target (5 vertex buffers, ≤ 4096 instances, depth test on, no depth write, no fog): an
   energy-normalised Gaussian core (σ ≥ 0.6 px, exact per-instance energy) + a per-kind halo, so sub-pixel
   lights stay stable sparkles under jittered accumulation; transmittance `exp(−extinction ·
   atmosphere.opticalDepth)` (no in-scatter squares); capped distance gain for window / lamp / fire; gates
   from env (window / lamp / ithildin at night + twilight, fire from dusk, lava / eye / magic always,
   beacon / event off until the S4 timeline via `setDynamic(fn(state))`); deterministic `env.tFx` flicker.
   **Settlement aggregation:** a landmark's windows / lamps / fires (per gate) crossfade into one aggregate
   spark at their energy-weighted centroid as the group shrinks below ~12 → 6 px (pure function of the
   camera), with a visibility floor. `gradeUniforms.glowKeep` (RegionLook: 0.9·max(night, twilight)) exempts
   bright glows from the night desaturation and soft-compresses their peak (hue kept); 0 by day.
   `env.pxPerKm` / `env.viewportH` are written by EnvironmentSystem.
8. (later) `EffectsSystem`, `RouteSystem`, `AnnotationSystem`.

## Landmarks (src/landmarks)
`defineLandmark({ id, placeId, tier, headingDeg, scale, anchor, stamps[], proxy(kit), model, lodPx,
lights[], trees[], forests[], emitters[], waterFeatures[], vegetationExclusion, contrast, lookOverride, annotation,
bookmarks[], cameraConstraints, audioHooks })` (types.ts). Folders are auto-discovered
(`import.meta.glob`). Landmarks never create materials, particle systems or render loops — shared systems
realize their declarations.
- **One pure build run** (build.ts `buildLandmarks(world, defs, {geometry})`, after the stamp layer, before
  vegetation / water init) → `BuiltLandmark` records (records.ts): geometry LODs (`Map<materialKey,
  BufferGeometry>` per LOD), world-space `LightRecord`s (def.lights + kit records; gate by kind
  `DEFAULT_GATE`), `AuthoredTree`s, contacts (seating gate), bounds, stats. `geometry: false` (Node checks,
  probe) builds LOD0 records only. Local-frame helpers in frame.ts; stamps / exclusions / pools in world.ts.
  Kit `proxy` callbacks must not mutate module-level state (the build runs more than once).
- **Kit v2** (kit/ProxyKit.ts, geom.ts, ao.ts): indexed geometry merged per material key per LOD; parts
  placed by base centre; `PartOpts {at, rot, color (absolute paint), shade, tint (legacy), lod, seat, glow,
  grain}`; two random streams (`k.r()` = the author's; kit internals `rand(hash32(seed, 'kit2'), part, k)`).
  Primitives: house (roofs, windows, dig, bank, ridge caps, gable boards), wallPath (crenels / stakes,
  batter, followGround, towers), tower, lathe, extrude, loft, cliff (faceted band, taper, soft), rock
  (leafy crowns for foliage ≥ 0.3 km), mound, scatter, stairs, bridge, arcade; v1 box / cylinder / cone /
  sphere / blob / ring / torus / wall kept. Records: `light`, `windows`, `tree`. LOD membership by
  part-group extent (≥ 8 % of the bbox diagonal → LOD2, ≥ 2 % → LOD1; nested composites join the
  outermost group; LOD1/2 regenerate with ½ / ¼ segments; a level identical to the previous one reuses
  its geometry). Seating helpers sink parts 0.02 km and record contacts (centre, lowest and uphill corners).
- **Vertex AO** (ao.ts): absolute 0.025 km voxels (coarser only past 2.5 M cells), 6 cosine Halton rays ×
  16 steps starting 1.5 voxels out, exact terrain height test (weight 0.5), per-family floors; structure
  geometry only; ≈ 0.3 s for all 24 landmarks at boot.
- **Readability policy (S3):** one fixed design scale per landmark; wide-shot readability from terrain
  silhouette (stamps), value contrast and emission; framing gates in tools/check/bookmarks.ts.
- **Blender GLBs** (close-up heroes only, after the S3 spike): `pnpm models [--only id] [--verify]`
  (tools/blender/run.ts: memory guard ≥ 1.5 GB → the GPU lock → Blender 4.5 headless without a shell, 10 min
  timeout; `--verify` rebuilds and requires identical bytes) runs `tools/blender/<id>.py` (lib.py: 1 BU =
  1 km, fixed seeds, remesh / decimate into nodes lod0/1/2, materials named `fam:<FamilyId>`, COLOR_0
  paint, no UVs / textures / Draco) → `public/models/<id>.glb` + `public/models/manifest.json` (sha256,
  script hash, tris, bounds). Runtime (model.ts): GLTFLoader → families by material name (unknown names
  throw), COLOR_0 → paint, the kit's packing + AO; GLB materials are never used. `ModelDecl {file,
  instances[{at, headingDeg, mirrorX}], boundsKm}`; Node never parses GLBs (bounds from the decl).
  `pnpm check` verifies manifest sha256, CREDITS coverage and script staleness.

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
- `tools/capture/exportCameras.ts --set <set> --out <file>` — resolved cameras as explicit shots, so another
  checkout (e.g. the previous session's code) can render exactly the current framings for A/B.
- Reference images are gitignored: agent worktrees set `MOME_REFERENCE_DIR` to the main checkout's
  `reference/`. `qa.ts --blind <set>` picks the anonymised set; bookmark ids `<landmarkId>-<suffix>` pair
  with references by the longest landmark-id prefix.
- `tools/capture/pair.ts --a <run> --b <run>` — blind A/B sheets (left/right shuffled; key outside the folder).

## Validation (tools/check, CPU only)
- `pnpm check` (run.ts): places/footprints, landmark definitions, assets vs CREDITS (incl. derived detail
  layers), and on the baked world (honours `MOME_WORLD_DIR`): river levels monotone except at falls,
  continuation continuity, rivers win over stamps, per-landmark stamp loss, and the bake's hydro report gates
  (report.json) expressed as visible-defect budgets (core raise, carve lowering by band, marsh / lake-rim
  areas and a fixed fill-depth cap, ribbon-edge float, new steep steps, source trims).
- `tools/check/geometry.ts` (`MOME_BASELINE_DIR`): coast IoU, lake wetted areas, channel alignment, landmark
  ground and named-peak changes, snowline/treeline area moved, steepness — vs a frozen bake.
- **Landmark gates** (tools/check/landmarks.ts) — per landmark LOD0 tris / lights vs the shot-list budget,
  LOD1 ≤ 25 % of LOD0, coarsest ≤ 4k tris; totals (LOD0 ≤ 1.2 M tris, ≤ 48 MB, ≤ 4096 lights, ≤ 2000
  authored trees); seating (no floating, ≤ 50 % buried); valid material keys; double-build determinism.
- **Bookmark + shot-list gates** (tools/check/bookmarks.ts) — `data/tour/shotlist.json` coverage and film
  length (180–240 s); per landmark `<id>-close` within ±35 % of heroKm with subject ≥ 25 % of frame height,
  ≥ 60 % visible, top-of-frame void ≤ 1 %, void ≤ 3 %, sky ≤ 45 %, clear line of sight; `<id>-wide` when
  contextKm is set (extent ≥ places.json wideShotPxTarget). Both gate files are ERRORS for landmarks at
  shot-list `"status": "s3"` (or declaring `lodPx`), warnings otherwise.
- **Camera probe v2** (tools/check/probe.ts + the cameras.ts CLI) — ray classes terrain / water / sky /
  void (studio backdrop) / edge (strata cut face), top-of-frame void, near foreground, line of sight, and
  the subject's projected px (build bounds ∪ the landmark's raising stamps) with visibility. CLI modes:
  ONLY / OVR / SEARCH / OTHERS / SHOT / SHOTS (file or set) / JSON / LAKES / RINGS / SLAB. Node world loads
  wait for ≥ 1 GB free RAM.
