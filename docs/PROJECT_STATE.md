# Project state — Map of Middle-Earth

_Rolling document: roadmap, current state, decisions, next steps. Keep it compact; replace stale detail
instead of appending logs._

**Last updated:** 2026-09-29 · Session 1 (in progress)

## Where we are
Session 1 — Foundation & Geography. Tooling, rendering foundation, geography bake, world v0 (CDLOD
terrain, environment, capture QA), landmark contract + 24 proxies are committed. Water / vegetation /
environment+diorama v1 are being built by worktree agents; QA loop follows.

## Roadmap (≈11 sessions incl. buffer)
| # | Session | Status |
|---|---|---|
| 1 | Foundation & Geography: tooling, refs, docs, contracts, bake v1, terrain v1, water/veg/env v1, landmark proxies, QA harness | in progress |
| 2 | Terrain, Water & Vegetation realism (erosion, detail patches, CC0 materials, river ribbons, waterfalls, forest LOD, slab craft) | — |
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
- Floating diorama slab; film ~3–4 min, 16:9, 1080p24, 180° shutter; prologue (Erebor/Lake-town) → Frodo's
  film route with side glances (Isengard/Helm's Deep, Minas Tirith beacons).
- WebGPURenderer + TSL (three 0.186.1 pinned), reversed-Z; deterministic `SceneState` evaluation.
- Geography: bburns/Arda 32k DEM + ME-GIS canon vectors; Christopher Tolkien 1980 map as dev overlay.
- Public repo, code only: `data/source`, `data/baked`, reference binaries, fetched textures are gitignored.
- Commits as global git identity; push only after user approval at session end.
- Music: hybrid (code-composed → CC0/CC sample libraries + synth layers).

## Session 1 checklist
- [x] Environment inspected; WebGPU hardware adapter verified headless
- [x] Repo, pnpm/Vite 8/TS 6, Python bake env (uv, 3.12)
- [x] Smoke: hardware WebGPU, RT readback, reversed-Z, float vertex textures (`pnpm shots --smoke` PASS)
- [x] Reference + data acquisition (143 refs, 1 GB DEM + vectors, 14 CC0 texture sets, 6 OFL fonts) → reference/README.md, manifests, fetch scripts, CREDITS
- [x] Contracts + docs (ARCHITECTURE.md), data seeds (world/places/regions/looks/route/shots)
- [x] Bake v1 (DEM tone-curve inversion, ME-DEM sea-level datum 304.8 m, coastline flood fill, DEM shelf bathymetry, canon rivers/lakes/forests/wetlands/vulcanism/roads, scale-split exaggeration, region look weights)
- [ ] Overlay check vs Christopher Tolkien 1980 map (TPS control points) — pending (QA critic)
- [x] Terrain v1 → world v0 commit (bit-identical determinism verified)
- [ ] Water / vegetation / environment+diorama v1 (worktree agents) — in progress
- [x] Landmark contract + 24 proxies (14 Tier A, 10 Tier B), stamps, `pnpm check` overlap validator, distance readability boost
- [ ] QA loop (scripted checks + 2 critics)

## Next session
_(filled at the end of Session 1)_

## Learned gotchas (r186 / this machine)
- TSL `vec3(new Color())` silently yields black → use `color(c)`; `int(x)` index into uniformArray must be `.toVar()`.
- SkyMesh pins depth to 1 → wrong with reversed-Z (patched in EnvironmentSystem).
- WebGPU canvas screenshots are black in headless → readback only. First frame after boot differs → warm-up frame.
- Grade saturation > 1 can push saturated HDR emissives negative → clamp before pow.
- ME-DEM sea level = 16 grey levels (304.8 m); DEM encodes shelves/enclosed seas above 0.
- Browsers decode 16-bit PNG to 8-bit → heights ship as raw u16; masks as raw RGBA8.

## Open issues / notes
- Optional user action: update Intel UHD driver (current 31.0.101.2125, 2023). Not required.
- Ask ME-GIS / Arda authors for permission before publishing the film.
