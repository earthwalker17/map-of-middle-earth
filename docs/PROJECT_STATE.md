# Project state — Map of Middle-Earth

_Rolling document: roadmap, current state, decisions, next steps. Keep it compact; replace stale detail
instead of appending logs._

**Last updated:** 2026-09-30 · end of Session 2 (World look) — push pending user approval

## Where we are
**S1 and S2 are complete.** The world renders deterministically on the Intel UHD iGPU with the S2 look.

**Geography and water (bake v2):**
- River DAG with monotone baked levels (declared falls only: Rauros), snapped to the DEM valley floors.
- Carve with a capped levee, lakes graded with deltas/lips (Long Lake is a real lake with Lake-town on it).
- Three-band relief "de-spike" (no knife-edge cone fields); the river guard makes rivers win over landmark stamps.
- Terrain mask (AO, valley, wetness, flow); organic region polygons.

**Atmosphere:**
- Distance-ramped aerial perspective with sun in-scatter; whole-table views stay crisp.
- RegionLook grade per camera focus; regional haze (Mordor gloom); deterministic cloud shadows.
- Studio backdrop; moonlit night.

**Terrain look:**
- Baked ground look with organic ecotones and distinct regional palettes: emerald Shire farmland, Rohan
  gold, ash-black Gorgoroth, pale-ash Dagorlad.
- Curvature/AO rock, snow v2 (aspect, per-region snowlines), stamp turf, Shire field patchwork.
- Wetlands, Gorgoroth fissures, valley mist, 6 CC0-derived detail layers per tier.

**Vegetation:**
- 7-sub-crown clusters with foam micro-structure (no toy balls) and per-instance LOD.
- Barren Mordor/Dagorlad, fieldWeight hedgerows, emergent mallorns. Preview strata variant.

**Validation (critics are vision agents; images anonymised; `renders/qa/20260930-092759/critic-s2.json`):**
- **Blind paired S1 vs S2** (left/right shuffled): S2 won **20/25 (80 %)**, above the 70 % gate. All 5 losses
  were whole-map overviews and misty-moria. After the whole-table haze fix, a re-check won **8/8**: the
  5 lost pairs plus Mordor, Black Gate and Barad-dûr as guards.
- **Blind recognizability:** 9/9 top-1 (S1: 9/9) and **117/124** verified map features (S1: 86/96).
- **Perf** (preview 1280×720, same session, S1 code on the frozen S1 bake):
  - S2 overview 51 ms, shire 46, anduin 45, compile 7.7 s.
  - S1 overview 52 ms, shire 47, anduin 42, compile 8.3 s.
  - So S2 is at parity despite the new look. Baseline `data/qa/perf-baseline.json` (label s2).
- **Checks:** typecheck, `pnpm check` (river/stamp/hydro gates as defect budgets), determinism IDENTICAL,
  build OK. The bake reproduces bit-identically from the agents' hashes.

**Baselines (KEEP):**
- `renders/qa/20260929-215504` — S1 final.
- `renders/qa/20260930-092759` — S2 final.
- `data/baked-s1` — frozen S1 bake for A/B.

## Roadmap (6 sessions)
| # | Session | Scope | Status |
|---|---|---|---|
| 1 | Foundation & Geography | world, data, systems v1, proxies, capture/QA | ✅ |
| 2 | World look | host hygiene + bounded QA, bake v2, atmosphere + RegionLook, terrain look v2, vegetation look | ✅ |
| 3 | **Landmarks** (all 24) | Shot list v0 first (route + hero distance per landmark → detail budget). Upgraded TS procedural kit by default; Blender GLBs only for 3–5 close-up heroes after a one-landmark spike. Landmark trees through VegetationSystem clusters. Lights → emission buffer. Readability policy: silhouette/emission/contrast instead of size | **next** |
| 4 | Previz, living world, polish | Tour timeline v0 + low-res animatic first; EffectsSystem (waterfalls, plumes, lava glow, Eye, beacons, Morgul light, mist), visible/animated clouds, water motion, luminous route line, labels, DOF/miniature lens, second shadow cascade; parallel CPU music-toolchain spike | — |
| 5 | Cinematic journey + music | Final camera work, title cards, transitions; lock timeline → original score | — |
| 6 | Performance, final polish, render & release | Vegetation placement worker, CPU mask drop, compile time; final 1080p24 render (resumable, overnight, user-started); encode; README/CREDITS; ME-GIS/Arda permission | — |

## Decisions (stable)
- **Presentation and film:**
  - floating diorama slab; film 3–4 min, 16:9, 1080p24 with a 180° shutter;
  - hero pauses: Hobbiton, Rivendell, Moria, Argonath, Black Gate, Minas Morgul, Mount Doom;
  - prologue Erebor/Lake-town.
- **Rendering:** WebGPU + TSL (three 0.186.1), reversed-Z, deterministic `SceneState`, which includes `weather`.
- **Geography:**
  - ME-GIS canon vectors + Arda DEM.
  - River centrelines are snapped to the DEM thalweg, at most ~4 km for great/major rivers.
  - Display offsets are validator-checked: Minas Tirith (−4, 9.5), Osgiliath (−4.44, 3.73), Edoras (2, 6.7),
    Erebor, Minas Morgul, Hobbiton, Henneth Annûn.
- **Look:**
  - wide shots read as a crisp physical model (haze relaxes with eye height);
  - regional/mid shots carry aerial depth;
  - Mordor is charcoal with red only near Doom (effects in S4).
- **Landmarks:** declarative `defineLandmark`; cone stamps relative to base ground; interim wide boost A 1.8 /
  B 1.5 (tallest 1.2) until S3's readability policy.
- **Repo:**
  - public, code only; push only after user approval;
  - raw CC0 texture sources in `data/textures-src` (gitignored); derived layers in `public/textures/terrain`
    (gitignored, generated by `pnpm data:fetch` → `tools/textures/prep.mjs`, credited).

## Host and workflow (Surface Laptop Go, 7.6 GB RAM shared with the iGPU)
- **Session start:** `pnpm host --fix`.
  - The user approved (2026-09-29) disabling autostart for Edge / WPS / OneDrive / Teams / Phone Link /
    PC Manager, and stopping them automatically while they have no window open.
  - Idle memory is about 3.6 GB available.
- **One heavy job at a time:**
  - capture, bake and build share the lock behind a free-RAM guard;
  - a capture batch costs about 1.3 GB;
  - iterate at 1280×720 spp 2; milestone QA at 1600×900 spp 4 (`pnpm qa --set s1 --batch 8`).
- **Agents:**
  - at most 2 concurrent implementation agents in worktrees, each followed by a read-only reviewer; the main
    agent verifies renders and merges;
  - worktrees reset to main first;
  - point `MOME_WORLD_DIR` / `MOME_SOURCE_DIR` at main;
  - copy `public/textures/terrain`;
  - share `MOME_CHROME_PROFILE`.
- **Cleanup:**
  - `pnpm host --prune` lists (then `--yes` deletes) regenerable outputs, keeping `KEEP` runs;
  - remove worktree folders with `cmd /c rmdir /s /q` (not `rm -rf`, which can follow pnpm junctions).

## Camera-distance census (seed of shot list v0)
| Class | Share of film screen time |
|---|---|
| wide (>300 km) | ~15 % |
| regional (60–300 km) | ~50 % |
| mid (15–60 km) | ~30 % |
| close (<15 km) | ~5 % |

Landmark detail budgets target 15–60 km. Ground detail matters for about 80 % of the film.

## S3 backlog (from the S2 critic synthesis and wave reviews)
**Shot list v0 first:**
- route waypoints plus a hero distance and framing per landmark;
- bookmark re-framing (misty-moria clips Orthanc; argonath line of sight blocked by hills; board edge or void
  at the top of some hero shots).

**Landmarks, rebuilt at hero distance:**
| Landmark | Needs |
|---|---|
| Erebor | a massif with spurs, not a clay cone |
| Mount Doom | isolated, with a volcanic silhouette, separated from Barad-dûr; Gorgoroth not one dome |
| Minas Tirith | Mindolluin part of the range, the prow, the Pelennor bench (stamp) |
| Osgiliath | ruins on both banks; the west bank is steep today |
| Edoras | a green hill before the mountains; still a truncated cone |
| Isengard | the ring in a flattened basin |
| Helm's Deep | the Deeping Wall |
| Black Gate | spanning the pass |
| Moria | the West-gate cliff + Sirannon pool; the gate is a proxy card |
| Rivendell | a gorge with falls |
| Argonath | the gorge set |
| Caras Galadhon, Hobbiton | route landmark trees through vegetation clusters (faceted proxies today); Hobbiton doors |
| Lake-town / Long Lake | read as a lake |

**Readability policy:** replace size boosts with silhouette/emission/contrast; small landmarks are specks in
wide shots.

**Open decision:** extend the frame about 80 km south, so Tolfalas and the south are not sliced. Conversion
plan (from T1r3):
- 6 explicit-camera shots;
- the constants in `cameras.ts` / `geometry.ts`;
- a DEM re-read and perf re-baseline;
- stray islands off Minhiriath.

## S4+ backlog
- **Mordor mood (S4):** ash ceiling, plume, red under-glow, bloomed lava/Eye.
- **Waterfalls:** they are flat strips today.
- **Clouds and weather:** visible clouds (shadows exist, weak); more regional-range depth where wanted.
- **Water:** sea specular/glint, river sheen/reflection; rivers read as levee-rimmed tubes up close.
- **Lens and light:** DOF/miniature lens cue; key/rim light and a contact shadow under the slab (S4 previz/S5).
- **Night and marshes:** night settlement and beacon lights; Dead Marshes mist.
- **Lowland drainage** reads as dark ink lines on the Rohan and Misty foothill plains (terrain polish slot).
- **Final grade (S5):** less olive/mustard overall.

## Known residuals in S2 systems (fix opportunistically)
**Bake:**
- 98 torrent step cells (warning only);
- stream-17 is not joined to the Celos, and stream-36 keeps a 22 km source trim;
- the Entwash / Forest River confluence pools (≤ 4.2 deep), and marsh fills of about 271 km² > 0.5;
- the geometry treeline band (23) no longer matches vegetation (22, thinning from 16).

**Look:**
- a grey-blue smear over the Brown Lands in overviews (much reduced) and a soft rectangular east edge on
  the Mordor gloom;
- sea banding at overview-top;
- marsh pools are stylised;
- the Minas Morgul grade is drab;
- backlit Mirkwood is very dark;
- close-range crowns are solid blobs (leaf cards if close-ups need them);
- the LOD0 cap is filled in chunk order, not by distance;
- vegetation fertility and RegionLook use unwarped region weights.

**Shaders and memory:**
- triplanar normal sign swizzle;
- a hard-layer seam possible at very close range;
- the valley mist y < 28 cutoff;
- about 100 MB transient init heap.

## Learned gotchas (r186 / this machine)
- **TSL:** `vec3(new Color())` silently yields black, so use `color(c)`. An `int(x)` index into a
  uniformArray must be `.toVar()`. `meta` is a reserved WGSL word.
- **WebGPU vertex buffers:** at most 8; vegetation uses all 8, so pack new attributes.
- **Capture:**
  - readback only; warm-up frame; the readback RT is NoColorSpace;
  - Chrome honours only the last `--disable-features`, so ours includes Playwright's list.
- **Host:**
  - Claude Code's background watchdog kills process trees on low RAM, and on Windows Chrome children
    survive as orphans. So: foreground batches, a guard before the lock, and a sweep while the lock is held.
  - Perf numbers are thermally noisy: interleave A/B runs in one session.
- **Worktrees:**
  - workflow worktrees may start at an old commit; reset to main first;
  - pnpm bake args go without `--`;
  - gitignored data needs env overrides or copies.
- **Bookmarks and stamps:**
  - `OrbitSpec.lift` must be passed through;
  - apply cone exponents to the height above the base;
  - the river guard clamps stamps to natural banks.
- **Critics:**
  - pass the real A/B key to the scoring code (a placeholder silently inverts half the pairs);
  - keep answer keys outside the folders critics read.
- **Data:**
  - the ME-DEM sea level is 16 grey levels;
  - heights ship as raw u16;
  - the Arda DEM has a straight submarine ridge west of the Gulf of Lune (`vertical.seaArtefacts`).

## Open issues / notes
- Optional user action: update the Intel UHD driver (current 31.0.101.2125, 2023). Not required.
- Ask the ME-GIS / Arda authors for permission before publishing the film.
