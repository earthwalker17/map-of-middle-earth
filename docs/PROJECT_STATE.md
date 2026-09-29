# Project state — Map of Middle-Earth

_Rolling document: roadmap, current state, decisions, next steps. Keep it compact; replace stale detail
instead of appending logs._

**Last updated:** 2026-09-29 · Session 2 in progress (S1 closed; wave 1 = bake v2 + atmosphere)

## Where we are
**S1 (Foundation & Geography) is closed.**

**The whole world renders deterministically** on the Intel UHD iGPU through the capture harness:
- Arda DEM + ME-GIS geography, verified against the CT 1980 map.
- CDLOD terrain, water v1, vegetation v1, environment v1, and the diorama slab.
- 24 landmark proxies.

**S1 critic pass** (`renders/qa/20260929-205532/critic-s1.json`):
- **Blind recognizability: 9/9** unlabeled images identified top-1.
- **Map features: 86/96** verified correct (51 unique), against an acceptance bar of 10.
- Foundation fixes, re-rendered in `renders/qa/20260929-215504` (**the S1 final baseline, KEEP**):
  - bookmark framing (`lift` was dropped)
  - cone-stamp contract
  - wide-shot boost cap
  - region-weight normalisation (takes effect at the next bake)
  - overview framing

**Tooling:**
- Bounded batched QA (`pnpm qa --set s1 --batch 8`).
- Heavy-job lock and memory guard.
- `pnpm host` session check.
- `pnpm perf` gate. The S1 baseline is committed in `data/qa/perf-baseline.json`: preview tier at
  1280×720, overview frame latency 54 ms, boot 25 s, of which pipeline compile is 18 s.
- CPU camera probe `tools/check/cameras.ts`.

## Roadmap (6 sessions, re-planned 2026-09-29)
| # | Session | Scope | Status |
|---|---|---|---|
| 1 | Foundation & Geography | world, data, systems v1, proxies, capture/QA | ✅ |
| 2 | **World look** | QA harness + host hygiene; bake v2 (monotone rivers, lake shores, relief de-spike, terrain AO/valley mask, region weights); atmosphere (aerial perspective, RegionLook grade and haze, cloud shadows); terrain look v2 (regional ground, rock/AO, snow, Shire fields, CC0 detail); vegetation look fixes | **in progress** |
| 3 | **Landmarks** (all 24) | Shot list v0 first (route + hero distance per landmark → detail budget). Upgraded TS procedural kit by default; Blender GLBs only for 3–5 close-up heroes after a one-landmark spike. Lights → emission buffer. Final readability policy: silhouette, emission and contrast instead of size | — |
| 4 | **Previz, living world, polish** | Tour timeline v0 + low-res animatic first (locks durations). Then EffectsSystem (waterfalls, plumes, lava, Eye, beacons, Morgul light, mist), visible and animated clouds, wind and water motion, luminous route line, cartography labels, DOF/miniature lens, second shadow cascade. Parallel CPU agent: music-toolchain spike (one 30 s cue) | — |
| 5 | **Cinematic journey + music** | Final camera work, title cards, transitions; lock the timeline → original score (code-composed MIDI → sfizz VSCO2/VCSL/SSO + synth → mix) | — |
| 6 | **Performance, final polish, render & release** | Vegetation placement worker, CPU mask drop, shader compile time; final 1080p24 render (≈5–6 h at spp 12 → spp ~8, resumable, overnight, started by the user outside Claude's runner); encode; README/CREDITS; ME-GIS/Arda permission | — |

The perf gate (`pnpm perf --gate`) runs every session; S6 is only for deep optimisation.

## Decisions (stable)
- **Presentation and film:** floating diorama slab; film 3–4 min, 16:9, 1080p24 with a 180° shutter.
- **Tour:** prologue (Erebor/Lake-town), then Frodo's route with side glances (Isengard/Helm's Deep,
  Minas Tirith beacons). Hero pauses (4:30-cut logic): Hobbiton, Rivendell, Moria, Argonath, Black Gate,
  Minas Morgul, Mount Doom.
- **Rendering:** WebGPURenderer + TSL (three 0.186.1 pinned), reversed-Z. Deterministic `SceneState`,
  which now includes `weather`.
- **Geography:** bburns/Arda 32k DEM + ME-GIS canon vectors, with ME-DEM sea level at 304.8 m. ME-GIS is
  the geometric truth; the CT 1980 map is a dev overlay only.
- **Landmarks:** declarative `defineLandmark` bundles. Cone stamps are relative to the base ground. The
  interim wide boost is 1.8 for tier A and 1.5 for tier B; S3 replaces it.
- **Repo:** public, code only. Push only after user approval.
- **Music:** hybrid (code-composed → CC0/CC sample libraries + synth layers).

## Host and workflow (Surface Laptop Go, i5-1035G1, 7.6 GB RAM shared with the iGPU)
- **Session start:** `pnpm host --fix`.
  - On 2026-09-29, with the user's approval, the autostart of Edge (startup boost and background mode
    are also off by policy), WPS, OneDrive, Teams, Phone Link and PC Manager was disabled.
  - The memory guard stops these apps automatically while they have no window open.
  - Idle memory after the cleanup: about 3.7 GB available (up from 2.5) and about 5 GB commit headroom.
- **One heavy job at a time:** capture, bake and build share one lock behind a free-RAM guard.
  - A capture batch costs about 1.3 GB of available memory (Chrome about 1.75 GB working set).
  - Iterate at 1280×720 spp 2; milestone QA at 1600×900 spp 4.
- **At most 2 concurrent implementation agents** in worktrees.
  - Worktrees point `MOME_WORLD_DIR` / `MOME_SOURCE_DIR` at the main tree.
  - `MOME_CHROME_PROFILE` shares the warm Dawn cache.
  - A frozen S1 bake for A/B is at `data/baked-s1`.
- **Cleanup:** `pnpm host --prune` lists regenerable outputs; `--yes` deletes them. Folders containing a
  `KEEP` file survive.

## Camera-distance census (seed of shot list v0)
Estimated screen time for the 3–4 min cut:

| Class | Share | Examples |
|---|---|---|
| wide (>300 km) | ~15% | open, epilogue, chapter moves |
| regional (60–300 km) | ~50% | route travel |
| mid (15–60 km) | ~30% | hero pauses |
| close (<15 km) | ~5% | Hobbiton, the Argonath pass |

**Consequences:**
- At mid distance a 0.4 km height texel covers about 20 px, and at regional distance about 5 px. So
  ground detail (textures, detail normals, relief shaping) matters for about 80% of the film.
- Landmarks need their detail budget at 15–60 km, not below.

## Session 2 — plan and backlog
**Done**
- QA harness, host hygiene, perf gate, S1 closure, and the shared contracts:
  - `QualityTier.terrainDetail / atmosphere / clouds`
  - `SceneState.weather`
  - `World.terrainMask`
  - `RiverLine` v2
  - `looks.json` one key per line (ground / grade / atmo)
  - `src/world/fields.ts`

**Wave 1 (parallel worktrees)**
- **T1: bake v2 + rivers**
  - river DAG with monotone beds, lake-level and fall boundary conditions, carve + levee
  - ribbons on baked levels
  - "rivers win" over stamps
  - stamp fixes: Minas Tirith, Osgiliath, Hobbiton, Erebor River Running, Isengard, Morgul, Rivendell
  - lake shores: Long Lake, Evendim, Núrnen, Nen Hithoel, Mirrormere
  - relief de-spike
  - terrain mask
  - region polygons for the Mordor family
  - validator and geometry checks
- **T3: atmosphere + RegionLook**
  - aerial perspective with per-channel extinction and sun in-scatter
  - regional haze/grade and `lookOverride` (Mordor gloom, Morgul green)
  - cloud shadows
  - sky fill for navy shadows
  - sea retune
  - night grade

**Wave 2**
- **T2: terrain look v2**
  - regional ground palettes (Mordor ash-black, Rohan gold, Shire green…)
  - rock via curvature + AO
  - snow v2: aspect-aware, White Mountains snowcaps, Misty not a solid sheet
  - stamp turf override
  - CC0 detail at 512², ≤6 layers
  - Shire field mask
  - wetland material
- **Vegetation look** (T4 or main):
  - smaller, varied canopies instead of km-wide balls
  - lift the forest albedo
  - hedgerows thinner, darker and broken
  - no trees in Mordor / Dagorlad

**Phase D:** joint tuning, then the S1-vs-S2 paired critic pass (≥70% S2 wins), perf gate and geometry gates.

**Cut order if behind:** vegetation extras → visible clouds → CC0 textures → minor lakes → de-spike.
Never cut the river items.

## Backlog for S3+ (from the S1 critic pass)
- **S3:**
  - proxy scale hierarchy (no structure above the ranges)
  - small landmarks unreadable in wide shots
  - Erebor clay cone (gate belongs at the foot)
  - Isengard ring oversized/floating; Hornburg/Deeping Wall; Black Gate spanning the pass; Moria gate proxy
  - hero set shapes: Argonath gorge, Rivendell cleft, Morgul glen, Caras Galadhon mallorn
  - Doom isolated from Barad-dûr
  - mallorn trunks
  - Emyn Muil / Nen Hithoel artistic scale (deliberate override only)
  - Lake of Moria (tiny ME-GIS lake, not rendered)
- **S4:**
  - lava look, smoke, Eye glow
  - night settlement/beacon lights
  - marsh/valley mist
  - DOF amount
  - serrated shadow edges (second cascade)
- **Open decision (bake v2):** extend the frame south by about 60–100 km so Tolfalas and southern Mordor
  aren't sliced.

## Learned gotchas (r186 / this machine)
- **TSL:** `vec3(new Color())` silently yields black, so use `color(c)`. An `int(x)` index into a
  uniformArray must be `.toVar()`.
- **Sky:** SkyMesh pins depth to 1, which is wrong with reversed-Z; it is replaced by our own sky.
  SkyMesh clouds use wall-clock `time`.
- **Capture:**
  - Headless WebGPU canvas screenshots are black, so use readback only.
  - The first frame after boot differs, hence the warm-up frame.
  - The readback RT must be NoColorSpace.
- **Grade:** saturation > 1 can push saturated HDR emissives negative, so clamp before `pow`.
  Accumulation takes the first sample verbatim.
- **Data:**
  - The ME-DEM sea level is 16 grey levels.
  - Seas connected only outside the frame need seeds.
  - Browsers decode 16-bit PNG to 8-bit, so heights ship as raw u16.
- **Tooling:**
  - Never import a CLI module that runs `main()` on import.
  - Harness waits have hard timeouts.
- **Host:**
  - Claude Code's background-task watchdog kills a process tree when free RAM is low. On Windows the
    tree's Chrome children survive as orphans; the lock-held sweep cleans them up.
  - Run captures in short foreground batches.
- **Playwright:** Chrome honours only the last `--disable-features` flag, so ours must include
  Playwright's list.
- **Bookmarks:** `OrbitSpec.lift` must be passed through (boot.ts). The CPU probe measures subject
  heights from the ground, not the lifted aim point.
- **Stamps:** apply a cone exponent only to the height above the base, never to the absolute height.

## Open issues / notes
- Optional user action: update the Intel UHD driver (current 31.0.101.2125, 2023). Not required.
- Ask the ME-GIS / Arda authors for permission before publishing the film.
