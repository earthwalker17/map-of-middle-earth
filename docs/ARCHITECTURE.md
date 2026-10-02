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
  `lens`, `routeProgress`, `annotations`, `lookOverride`, `weather {cloudCoverage, wind}`, `events`,
  `quality`. Bookmark shots carry their landmark's `lookOverride`. `events` (S4) are named 0..1 channels
  switched by the timeline / a shot (`beacons`, `morgul-beam`): gate-`event` lights and event-bound emitters
  read them; `ShotSpec.events` / `BookmarkDecl.events` set them for stills.
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
  (motion blur), running average in HDR, then one post pass. **Lens (S4, render/lens.ts):** depth of field by
  aperture jitter — after `applyState` (systems and LOD keep the pinhole camera) each sub-sample moves the
  camera over a Halton(5,7) aperture disc with a compensating view offset (the focus plane stays fixed);
  aperture = K·F/N with the blur at infinity capped at 0.3 % of frame height; active only at `fStop < 22` and
  spp ≥ 8 (`DEEP_FOCUS_FSTOP` 22 is the default: wides, QA at spp 4 and the explorer stay pinhole). Close
  heroes carry their f-stop on the bookmark. The bigatures were shot deep-focus: keep DOF very subtle.

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
  sampled ALONG the ray (end point, mid point in review/final, and the eye as a CPU uniform, weighted by
  height) so a Mordor eye hazes the world beyond; `env.hazeRamp` is written per frame by RegionLook from the
  focus-blended `atmo.ramp` (distances scaled with the focus distance; overviews ≈ S3) and `env.hazeGain`
  adds "film air" to mid / regional shots (< ~320 km focus). **atmo2** (S4, 256×154 RGBA8, same LookField
  weights): R ash-deck cover, G valley-floor height /64, B valley-mist gain /3, A cloud-cap boost. Under a
  deck an **ash layer** (`rayDeck`, focus-scaled ramp) thickens the haze and, with the eye under the deck,
  the in-scatter converges on the overcast colour `env.deckSky` (terrain haze and the overcast dome share
  it: no horizon seam). **Valley mist** (all tiers) is a layer on the valley floor (atmo2.G), gated by
  `max(golden, 0.8·twilight, 0.5·night·moonIllum)` × atmo2.B, lit as pale mist in the regional chroma (the
  Morgul vale stays green), and framed out of wide shots (`mistVis`). The water material uses the same
  functions.
- Ground look (looks.ts): `LookField` — one shared CPU region-weight field (multi-scale warp + noise dither,
  per-region `ecotone` width) used by the ground look, the regional haze and the field fringe, released after
  init. `groundLookTexture(world)` bakes it × `looks.json ground` (+ place / km spots) into a 5-layer sRGB array
  texture (grass+dryness, dry+pattern, soil+snowline offset, rock+volcanic, rockiness+wetland cover);
  `groundPalette(tex, uv, explicitLod?)` reads it. `TERRAIN_SHADE`
  and the shared TSL rules (`snowLineAt`, `alpineAt`, `rockAt`, `snowAt`, `coarseGroundAlbedo`) are the single
  source for anything that approximates the terrain (the water's reflected terrain uses them).
- `looks.json` — one key per line per region: `ground` (terrain palette), `grade` (tint, saturation,
  contrast, exposure, lift, redKeep, bloom, spots[] per place), `atmo` (tint, density (> 1 = local haze),
  sky, `ramp` [near0, near1, local0, local1] haze ramp, `mist` gain, spots[] with tint / density / `mist` /
  `cap`), and (S4) `deck` — a region's overcast ash deck: cover, tone, shadow (key-light loss), height,
  topOpacity (seen from above), `glow` {place, color, radiusKm, strength} (Doom's red underglow), spots[].
  Regions without a `deck` line have none (today: mordor at 52, dagorlad at 46).
- Shader code imports TSL through the `tsl` facade (`src/materials/tsl.ts`) — typed loosely on purpose.
- Material families: terrain (terrain/terrainMaterial.ts), water, foliage, landmark structures
  (families.ts), emission sprites (src/emission), particle, text — one factory per family; per-instance /
  per-vertex parameters instead of new materials.
- **Landmark families v2** (families.ts): TWO uber materials for every landmark mesh — `structure`
  (opaque; casts and receives shadows) and `glow` (neither). Family presets are data (`FAMILY`:
  stone, darkStone, weathered, plaster, wood, thatch, slate, roofTile, gold, obsidian, iron, foliage, metal,
  emissive, emissiveGreen, lava, ithildin) packed per vertex: `color` u8×4 = absolute sRGB paint + baked
  hemisphere AO in `a` (→ the material's AO slot only); `surf` u8×4 = roughness, metalness, grain,
  `a` = noise class × 32 + ground-contact term (0..31; class 4 = foliage, 5 = rock: kit cliffs, stone noise
  without masonry courses + the shared strata; 6 = roof: FAMILY slate / roofTile and the house / tower roofs
  ProxyKit.tagRoof marks; 7 = carved: stone without courses or joints, packed by `carvedVertex` for the Blender
  hero statues in model.ts) — for glow: strength/16, gate
  code, flicker. Contact is the only baked term on the albedo (`× mix(1, contact, 0.3)`). Landmark-local
  fwidth-faded noise (≈9, 37, 140 /km) + stone coursing on walls. Glow = paint × strength × gate × flicker
  (gates from env: always · night = clamp(smoothstep(0.2, 0.7, night) + 0.4·twilight) · dusk =
  0.25 + 0.75·max(night, golden) · event = the light's `SceneState.events` channel). **Gates (S4,
  materials/gates.ts)** are ONE table shared by the emission sprites and the glow family: codes night 0,
  nightDim 1 (ithildin), dusk 2, always 3, event 4 + slot (`EVENT_SLOT`: beacons → x, morgul-beam → y of
  `env.vec4 events`), a TSL `gateNode` and a CPU mirror `gateCPU` (spill selection); glow vertices store
  surf.g = code·32 and surf.a = the glow preset's spill albedo (only emissiveGreen: the Morgul skins take the
  green wall-wash spill). Structures, glow skins, terrain, foliage and water add `albedo · spillIrradiance / π`
  (emission spill, see EmissionSystem). `materialFor(key)` resolves geometry keys;
  `familyVertex(fam, paint?, shade?, tint?, glow?)` packs a vertex (also used for GLBs). Specular ambient:
  the scene has no environment map, so `structure` adds a Fresnel-weighted (F0 0.04 → albedo for metals)
  hemisphere sky / ground radiance along the reflection vector (`env.skyColor / groundColor ×
  hemiIntensity`), dimmed by roughness and the baked AO — metals and glossy dark stone keep form in shade.
  **Weathering (S4 W4-S1; review / final only — `structureTier.full`, set by LandmarkSystem.init before the
  first `materialFor`, so preview renders the S3 surfaces):** every built class (not foliage / rock) gets
  part- and district-scale tone (hue drift, grime stains), tonal masonry courses with warped cell edges and
  joints (stone), long rain / grime streak tapers (0.2 / 0.08 km columns drawn only from ~4 px, mean beyond;
  timber at half strength), AO crevice grime away from the foot, a stronger damp contact, and on dark paints a
  pale dust deposit instead of grime; the total darkening is floored (`W.floor`). Roof faces get slate / tile
  courses, moss and dark soffits; thatch bands; wood boards with seams. Roughness / metalness follow the
  weathering AMOUNT (glossy paints keep their gloss), and the specular ambient takes F0 from the weathered
  paint. All cells are footprint-faded (`vis()`); `WEATHERING_ON` and the `W` constants live in families.ts.

## Systems (registration order in src/app/boot.ts)
1. `EnvironmentSystem(world)` (environment/) — time of day → keyframed daylight (by sun elevation), own TSL
   sky (Preetham port + twilight/night layer, sun/moon discs, deterministic stars, studio-lit void backdrop
   below the horizon), the aerial perspective, one shadow light (sun → moon handover at −4°) with a
   slab-clipped, size-quantized, texel-snapped soft PCF shadow (re-rotated per accumulation sample).
   **RegionLook** (regionLook.ts): the post grade is a pure function of the camera focus — region weights
   sampled on the CPU over a disk around the target, blended `looks.json grade`, `lookOverride` honoured,
   no temporal smoothing. **Film grade (S4, PostPipeline):** one post pass — bloom → halation (warm fringe
   keyed on the bloom's red) → glow key → tint / lift → saturation (redKeep, glowKeep, `greens`, `warms`) →
   `greensHue` (yellow-green pull) → contrast → split-tone × highlight gain × toe (black point with a floor) →
   vignette → night compress → AgX → dither → film grain (final tier only, seeded by pixel and frame). Grade
   fields: `split {shadow, highlight, amount}`, `greens`, `greensHue`, `toe`, `halation`, `highlights` (day
   only, faded between 50 and 250 km camera distance), `warms`; spots inherit their region's film fields. **Cloud shadows** (clouds.ts): deterministic world-XZ field scrolled by
   `weather.wind × tFx`, coverage from `weather`, applied through the key light's `colorNode`, slab top only;
   the key loses `max(cloud·cloudShadow, atmo2.R·deckShadow)` (overcast light under a deck, all tiers).
   **Visible clouds** (S4, cloudLayer.ts): the **ash deck** — a static 4 km grid mesh at the deck height
   (CPU-baked cover / tone / height / glow per vertex, renderOrder 30 below the emission sprites, all tiers,
   1–2 cloud taps): a steel-grey mottled underside lit by transmitted key + grey sky + ground bounce and the
   windowed Gaussian Doom underglow (`env.deckGlow`, strongest at dusk / night), a charcoal top that fades to
   `topOpacity` from above and near the focus (Mordor stays readable in overviews); it fogs itself so the glow
   survives the haze. **Cumulus** (review / final, `quality.clouds.layer`): a sheet at `env.cloudHeight` from
   the same cover field as the shadows (clouds sit over their shadows), faded at grazing angles, at night,
   under decks and with the focus distance. Under a deck (RegionLook's focus cover) the hemisphere sky colour
   turns to the deck tone, the fill rises, and the dome becomes an overcast ceiling with no sun, moon or stars.
   Night (S4): moon key 1.8·illum^1.3, hemisphere lift 1 + 1.3·night, NIGHT grade +0.4 stops, stars at about
   ¼ of S3 with horizon extinction; W4-S2: moonlit shadows keep a 0.28 floor, a brighter greyer night horizon,
   sparser stars. **Mordor pall (W4-S2):** the deck field fills the gaps between region masks
   (`DECK_GAP_FILL`, Ered Lithui / Ephel Dúath ≈ 0.9 cover) and Nurn has its own deck; camera rays take one
   mid-point ash tap (review / final), a camera under a dense pall sees far haze in the overcast colour
   ramped in over 30–90 km (`DECK_EYE_HAZE`, `DECK_EYE_DIST`) with a far lift (`DECK_FAR_LIFT`), no sun disc
   under the deck (`SUN_DECK_HIDE`); seen from above the deck is shaded as a lit volume (review / final) and
   parts along the line of sight to Doom's summit (`DECK_DOOM_SIGHT`, all tiers); the underglow follows the
   cloud masses (`GLOW_MOD`, S4 C2). `atmosphere.applySplit(from, to, …)` returns T and S from ONE
   evaluation (the effects' per-vertex fog); in preview the deck's haze is per vertex.
2. `TerrainSystem` (terrain/, async init) — one instanced CDLOD draw (root 320 km, 8 levels, morph + skirts).
   Surface pass: 5 shared height taps → normal, slope, curvature; `terrainMask` AO/valley (faded where stamps
   changed the ground); ground look + regional rules (alpine rock, dry-brushed crests, scree, snow v2 with
   aspect and per-region snowlines, volcanic ash/fissures, wetland pools, shores, forest floor, Shire fields).
   S4: rock terms use 3D noise (no smear down the fall line); **strata** (materials/strata.ts — dipping
   world-space bedding at three spacings, hard / soft beds with ledge normals, vertical joints and pinch-outs,
   footprint-faded; also the structure family's rock class so kit cliffs band alike); triplanar sides mirrored
   on negative faces, preview a biplanar hard layer on steep ground (+1 fetch); **volcanic crust**
   (terrain/volcanic.ts, procedural, branch only on near volcanic ground: Voronoi plates and cracks at
   6 / 1.5 / 0.4 km, basalt, cinder near Doom, angular fissure glow round Doom's foot, dim by day); grass hue
   breakup (lush ↔ straw); snow v3 (ragged scoured cap rims, wind scouring, crisp margins); a terrain
   `emissiveNode` = fissure glow + albedo · `spillIrradiance` / π (emission spill hook, emission/spill.ts) and
   the `canopyShell()` hook in the forest-floor block (vegetation/canopyShell.ts). The terrain fragment stage
   samples 15 textures (S4 budget, frozen: 13 S3 + atmo2 + the canopy shell; the WebGPU limit is 16).
   S4 W4-S2: **snow v4** — where snow lies is read from the relief (gullies / couloirs, ledges, the lee side
   of the westerlies; ribs and windward faces bare), a ≈ 300 m lower band, steep faces shed it, a cool tint on
   faces turned from the key; `snowLeeWind` is shared with `coarseGroundAlbedo` (water reflections).
   **Macro relief** (review / final): one 0.42 km fall-line-stretched noise → gully / rib creases as a bump
   (forward-difference gradient) and tone on slopes, faded far (`MACRO.fade`) and near (`MACRO.near`: close
   up the fine rock relief carries the face). **Ragged** grass ↔ rock boundary (noise on the rock rule, its
   ramp steepened). **Fields**: mostly greens with a little straw, soft 0.55 km margins, mow rows along each
   field's long axis. **Lava flows** (`VOLCANIC.flows`, crust branch): each continues a Mount Doom kit flow
   from its toe — a crisp molten channel in runs that crust over, a faint spill, lit cracks clustered on the
   flows; the open plain stays dark. Strata contrast (S4 C2): 0.13 / 0.09 / 0.06.
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
   grades; the v1 heuristic stays as a fallback). Waterfalls → effects (S4). S4: emission spill on the body
   and foam plus `spillGlint` (lights reflect), pools (`waterPool`) with deep scatter (no black slabs), the
   reflected sky and land honour the ash deck (`env.deckSky`, deck shadow) and `env.horizonTint`.
   S4 W4-S1: rivers are calm, flow-aligned slicks with brown-green shallows, a far-water Fresnel floor
   (`farSheen`), a ~2.5 px edge fade (`edgePx`) and a darker, cooler mirror of their banks (`mirrorTint`);
   lakes get a skirt over their whole baked bed (`LAKE_SKIRT_KM`, LessDepth), lakes and rivers are alpha-tested
   (`WATER_ALPHA_TEST`), river ends in a lake run on into it (`LAKE_OVERLAP_KM`, the lake share in
   flowDir.w) and outflows hold the lake level under its visible edge (`OUTFLOW_HOLD`). **Reflection proxies
   (S4 C2):** the HeightField-only march cannot see landmark geometry, so `landmarkReflectors` (pure, world
   space) gives one vertical cylinder per GLB model instance (declared bounds) plus each landmark's
   `reflectors`; lakes and rivers test them by exact ray / cylinder intersection in review / final, and a
   proxy in front of the terrain hit mirrors as lit grey stone (`WaterSystem.setReflectors`, before init).
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
   **Crown archetypes (S4, archetypes.ts):** the record's shape word packs spread + 2·gapQ + 128·arch (no new
   vertex buffer, still 7 of 8): Canopy 0, Broadleaf 1 (asymmetric lobes, lean, visible trunk), Conifer 2 (one
   record, stacked tapered whorls), Columnar 3, Holly 4, Shrub 5, ConiferStand 6, Cluster 7 (S3 layout: hedges,
   mallorn tiers), CanopyEdge 8 (a forest's standing outer ring, review / final); the vertex stage picks the
   layout per instance and the far blob gets a per-archetype profile. Field / hedgerow trees at believable
   scale (lognormal crown radius ≈ 0.19 km) in copses; forest crowns ≈ 0.2–0.45 km; quality density thins
   counts but never resizes crowns (preview = final). **Tree caps** (`setTreeCaps(landmarkTreeCaps)`,
   treeCaps.ts): placed, forest and authored trees inside a landmark's cap circle stay below its height.
   **Far canopy shell** (canopyShell.ts + shellConfig.ts): a 512×307 RGBA8 canopy colour / cover texture baked
   from the retiring canopy records at placement; the terrain's forest-floor block draws it (the terrain's 15th
   texture) with crown-dome relief (review / final), while Canopy / ConiferStand instances sink into it across
   a band defined in screen pixels (a 0.6 km crown going 9 → 5 px; preview retires at 0.7×); near the camera
   the same sample darkens the floor between standing crowns. Roads fade under the shell.
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
   **Emission spill (S4, emission/spill.ts + spillSources.ts):** at init the records become spill sources
   (reach by kind: lava 6 km, eye 4, magic 2, beacon 2, fire 0.8, ithildin 0.4, lamp 0.35; windows through their
   settlement aggregates; explicit `spillKm`; `sprite: false` spill-only sources such as the Morgul wall-wash;
   Doom's crater adds a lit pall source above it). Each frame a PURE selection scores the lit sources against
   the camera focus (energy × gate × reach), keeps the top N (8 review / final, 4 preview, ties by index) with
   weights that fade at the cut (no popping) and uploads `spillU` (pos / col / aux uniform arrays, count,
   haloOn). `spillIrradiance(p, n)` (wrap-Lambert, finite core, windowed at the reach) lights terrain,
   structures, Morgul glow skins, foliage and water; `spillInScatter` adds analytic point-light airlight halos
   for lava / eye / magic / beacons in the shared fog (`atmosphere.apply`) and the dome (review / final only,
   soft-capped: no sun disc); `spillGlint` puts GGX glints of the sources on water. A sprite's extinction
   includes the ash pall along the camera ray (`atmosphere.rayDeck`, eye + mid taps), so Mordor's tower
   lights fade with their towers.
8. `EffectsSystem` (effects/, S4) — realizes landmark `emitters` and waterfalls (`landmarkEmitters`,
   `landmarkFalls`, `pools`) in four draws: **puffs** (smoke / ash / steam / wisp / spray billboards: one
   instanced premultiplied draw, CPU-sorted back to front per frame as a pure function of the camera; render
   order 51 under an ash deck — after the emission sprites, so a plume veils its crater orb — and 29 when the
   camera is above the deck), **falls** (core + veil ribbons with scrolling streaks and plunge foam floating on
   the pool / lake surface, order 35), **mist cards** (3 stacked layers per card, order 34; a `mist` emitter's
   rate is its opacity, scale its half-width, `at → to` its band) and the **beam** (additive camera-facing axis
   billboard, order 52; rate = radiance gain, scale = width). Particles are STATELESS: instance (emitter, k),
   `age = fract(tFx / life + hash)`, the position a preset trajectory of (age, hash, wind) — any `tFx` renders
   in isolation, no pre-roll. Strong plumes rise to and spread under the ash deck (Doom's column lit by a CPU
   copy of the spill on its lower third — keep it in step with spillSources' falloff / flicker); smoke below
   `WISP_SCALE` becomes a thin wisp (chimneys, Isengard's pits); falls ≥ 2 km wide raise a mist column (Rauros);
   event emitters (`morgul-beam`, beacons) follow `SceneState.events`; the beam and beacon fires add spill
   lights through `emission.setDynamic`. Emitter LOD by projected size, counts × quality density; all effect
   pipelines are compiled at warm-up. `tools/check/effects.ts` builds the same records (shared `buildEffects`)
   and checks random access determinism.
9. (later) `RouteSystem`, `AnnotationSystem`.

## Landmarks (src/landmarks)
`defineLandmark({ id, placeId, tier, headingDeg, scale, anchor, stamps[], proxy(kit), model, lodPx,
lights[], trees[], forests[], treeCaps[], emitters[], waterFeatures[], vegetationExclusion, contrast, lookOverride,
annotation, bookmarks[], cameraConstraints, audioHooks })` (types.ts). S4 contracts (records.ts / world.ts):
lights (decl, kit, record) carry optional `LightExtras {event, spillKm, sprite}` (event channel; spill reach;
`sprite: false` = spill-only source); emitters `{preset: smoke | ash | embers | steam | mist | sparks | beam, at,
to?, rate, scale, color?, event?}` → world `EmitterRecord`s (`landmarkEmitters`), waterfalls / floods → world
`FallRecord`s (`landmarkFalls`), `treeCaps` → world `TreeCapRecord`s (`landmarkTreeCaps`) — pure, usable in Node. Folders are auto-discovered
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
  It waits for a quiet host before the boot and each view (background CPU ≤ `--quiet` %, at most
  `--quiet-wait` s) and records `noise` per measurement (NOISY ones are flagged). The iGPU shares the package
  power with the CPU and the laptop has a slow and a fast power regime (~1.7× apart): compare only
  interleaved A/B runs with a rest before each (S4: 90 s), never against a baseline from another regime.
- `tools/capture/probe.ts "<expr>"` evaluates an expression against `window.__app` for diagnostics.
- `tools/capture/exportCameras.ts --set <set> --out <file>` — resolved cameras as explicit shots, so another
  checkout (e.g. the previous session's code) can render exactly the current framings for A/B.
- Reference images are gitignored: agent worktrees set `MOME_REFERENCE_DIR` to the main checkout's
  `reference/`. `qa.ts --blind <set>` picks the anonymised set; bookmark ids `<landmarkId>-<suffix>` pair
  with references by the longest landmark-id prefix.
- `tools/capture/pair.ts --a <run> --b <run>` — blind A/B sheets (left/right shuffled; key outside the folder).
- `pnpm review --from <qa run> --before <run> --manifest data/qa/review-s4.json --out review/s4`
  (tools/capture/review.ts, CPU / sharp) composes a session's review stills for the user: numbered stills,
  labelled day / night pairs, S3 → S4 before / after sheets, a contact sheet, README.md (what to look at, the
  critic issue each still answers) and manifest.json (commit, tier, spp, sha256). `review/` is gitignored.

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
