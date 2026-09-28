# Project state — Map of Middle-Earth

_Rolling document: roadmap, current state, decisions, next steps. Keep it compact; replace stale detail
instead of appending logs._

**Last updated:** 2026-09-29 · end of Session 1 (pending final QA critic pass + push approval)

## Where we are
Session 1 (Foundation & Geography) is essentially complete. The whole world exists and renders
deterministically on the Intel UHD iGPU through the capture harness:
- **Geography:** Arda 32k DEM + canon ME-GIS vectors baked into heights/masks. Verified against Christopher
  Tolkien's 1980 map (45 control points, TPS overlay): the bake matches ME-GIS within 0.1–0.4 km; the
  remaining offsets are ME-GIS vs CT drawing differences.
- **World modules:** CDLOD terrain; water v1 (sea, lakes, river ribbons); vegetation v1 (clump-foliage forests,
  Shire hedgerows); environment v1 (own TSL sky, twilight/night/stars/moon, void backdrop, soft fitted
  shadows); diorama slab (strata sides, glassy sea section, plinth).
- **Landmarks:** 24 proxies (14 Tier A, 10 Tier B) placed via the `defineLandmark` contract, with a distance
  readability boost for wide shots.
- **Last full QA render:** `renders/qa/20260928-194612` (24 shots, before the final landmark fixes). The
  re-render after commit `1a80b98` was stopped by host memory pressure.

## Roadmap (≈11 sessions incl. buffer)
| # | Session | Status |
|---|---|---|
| 1 | Foundation & Geography | ✅ (final critic pass pending) |
| 2 | Terrain, Water & Vegetation realism | **next** |
| 3 | Sky, Atmosphere, Day/Night, Regions + **Previz v0** (animatic → timeline durations, shot list) | — |
| 4 | Landmarks A (Mordor, Gondor, Anduin) + Blender asset pipeline | — |
| 5 | Landmarks B (West & North) + Tier-B set dressing | — |
| 6 | Living World: effects & animation | — |
| 7 | Polish pass 1: look-dev + cartography/typography kit | — |
| 8 | Cinematic Journey (dedicated) | — |
| 9 | Music (dedicated; hybrid code-composed + samples + synth) | — |
| 10 | Polish pass 2 + final render + release | — |
| +1 | Buffer | — |

## Decisions (stable)
- **Presentation and film:** floating diorama slab; film ~3–4 min, 16:9, 1080p24 with a 180° shutter.
- **Tour structure:** prologue (Erebor/Lake-town), then Frodo's film route with side glances (Isengard/Helm's Deep, Minas Tirith beacons).
- **Rendering:** WebGPURenderer + TSL (three 0.186.1 pinned), reversed-Z. Deterministic `SceneState` evaluation: verified bit-identical, and jump-to-frame equals sequential.
- **Geography source:** bburns/Arda 32k DEM + ME-GIS canon vectors. The ME-DEM sea level is 304.8 m. ME-GIS is the geometric truth; the CT 1980 map is a dev overlay only.
- **Landmarks:** declarative `defineLandmark` bundles. Stamps are TypeScript data composited into the HeightField. Wide-shot readability comes from a distance boost, which is a pure function of the camera.
- **Repo:** public, code only. Gitignored: `data/source`, `data/baked`, reference binaries, fetched textures. Commits use the global git identity; push only after user approval.
- **Music:** hybrid (code-composed → CC0/CC sample libraries + synth layers).

## Next session (S2 — Terrain, Water & Vegetation realism) — concrete backlog
**Terrain**
- CC0 ground textures (`public/textures`, already fetched) blended per region, with triplanar rock.
- Baked AO/curvature.
- Detail patches or stronger micro-relief for close-ups, which currently look soft and plastic.
- Erosion pass in the bake.
- Soften the steep lake-shore walls left by lake flattening (e.g. Long Lake).

**Rivers (bake)**
- Carve channels with a monotone downhill bed. This fixes the false cascade into Nen Hithoel by the Argonath and the step near Osgiliath.
- Keep landmark footprints clear of rivers: a stream runs under Minas Tirith.
- Add minor streams from flow accumulation.

**Water**
- Retune the sea against the haze.
- Add reflections of landmarks (optional).
- The white-water threshold is now 0.3–0.75; review it in motion.

**Vegetation**
- Field colouring under the hedgerow grid (the hedges still read a little like a net).
- Darker forest floor.
- Silver mallorn trunks.
- Move placement (1–1.5 s on the main thread) to a worker.
- Watch the foliage shader compile time.

**Slab and performance**
- A cheaper strata shader for the preview tier.
- Two shadow cascades for low shots over the whole map (possibly S3).

**Landmark notes for S4/S5**
- Erebor is a smooth grey cone.
- The Deeping Wall doesn't read yet at Helm's Deep.
- Mordor ground should be dark ash (RegionLook, S3).

**QA**
- Re-run `pnpm qa` (24-shot set) at the start of S2 to baseline the current state.
- Run the critic pass: blind recognizability test, geography/composition vs CT + LEGO, film-look vs references.
- Keep other apps closed. QA runs spawn Vite + Chrome (~1–1.5 GB), and the host has only 7.6 GB.

## Session 1 checklist
- [x] Environment inspected; WebGPU hardware adapter verified headless; smoke test PASS
- [x] Repo, pnpm/Vite 8/TS 6, Python bake env (uv, 3.12); CLAUDE.md, ARCHITECTURE.md, this doc; memory notes
- [x] References (143) + data (1 GB DEM, vectors) + CC0 textures + OFL fonts; manifests, fetch scripts, CREDITS
- [x] Bake v1 + CT-1980 overlay check (Forochel sea fixed)
- [x] World v0 → water / vegetation / environment+diorama v1 (3 worktree agents, reviewed and merged)
- [x] Landmark contract + 24 proxies, stamps, validator, readability boost, `kit.ground()`
- [x] Scripted checks: typecheck, build, `pnpm check`, determinism (identical and jump == sequential), no console errors
- [ ] LLM critic pass on a fresh QA render: moved to the start of S2 (host memory pressure)

## Learned gotchas (r186 / this machine)
- **TSL:** `vec3(new Color())` silently yields black, so use `color(c)`. An `int(x)` index into a uniformArray must be `.toVar()`.
- **Sky:** SkyMesh pins depth to 1, which is wrong with reversed-Z (now replaced by our own sky). SkyMesh clouds use wall-clock `time`.
- **Capture:** WebGPU canvas screenshots are black in headless, so use readback only. The first frame after boot differs, hence the warm-up frame.
- **Readback colour:** the readback RT must be NoColorSpace. An sRGB RGBA8 target double-encodes: the old "milky" look.
- **Grade:** saturation > 1 can push saturated HDR emissives negative, so clamp before `pow`. Accumulation takes the first sample verbatim, so NaN history can't poison a frame.
- **Data:** the ME-DEM sea level is 16 grey levels (304.8 m); the DEM encodes shelves and enclosed seas above 0. Seas only connected outside the frame (Forochel) need explicit seeds.
- **Height data:** browsers decode 16-bit PNG to 8-bit, so heights ship as raw u16 and masks as raw RGBA8.
- **Tooling:** never import a CLI module that runs `main()` on import. Harness waits have hard timeouts, because a hung page would hold the machine-wide GPU lock.

## Open issues / notes
- Optional user action: update the Intel UHD driver (current 31.0.101.2125, 2023). Not required.
- Ask the ME-GIS / Arda authors for permission before publishing the film.
