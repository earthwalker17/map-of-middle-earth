# Project state — Map of Middle-Earth

_Rolling document: roadmap, current state, decisions, next steps. Keep it compact; replace stale detail
instead of appending logs._

**Last updated:** 2026-09-29 · Session 1 (in progress)

## Where we are
Session 1 — Foundation & Geography. Tooling and the rendering foundation are in place and verified
(WebGPU on Intel gen-11, readback capture harness, reversed-Z, float textures). Next: contracts + bake.

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
- [ ] Reference + data acquisition (background agents) → reference/README.md, manifest, CREDITS
- [ ] Contracts + docs (ARCHITECTURE.md), data seeds (world/places/regions/looks/route/shots)
- [ ] Bake v1 + overlay check
- [ ] Terrain v1 → first beauty wide shot (world v0 commit)
- [ ] Water / vegetation / environment v1 (worktree agents)
- [ ] Landmark proxies + scale budget + overlap validator
- [ ] QA loop (scripted checks + 2 critics)

## Next session
_(filled at the end of Session 1)_

## Open issues / notes
- Optional user action: update Intel UHD driver (current 31.0.101.2125, 2023). Not required.
- Ask ME-GIS / Arda authors for permission before publishing the film.
