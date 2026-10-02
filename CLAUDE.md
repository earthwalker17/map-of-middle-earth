# Map of Middle-Earth — project constitution

A cinematic **floating miniature diorama of Middle-earth** (Three.js r186 WebGPU + TSL) with a realistic
fantasy look inspired by Peter Jackson's films — *not* a LEGO look. The final deliverable is an
offline-rendered ~3–4 min 16:9 film, **"Journey Through Middle-Earth"** (Frodo's route, luminous route line,
title cards, original score).

**Start every session with `pnpm host --fix`** (frees RAM: stops windowless approved background apps,
re-disables their autostart, sweeps orphans), **then read `docs/PROJECT_STATE.md`** (where we are, what's next), then
`docs/ARCHITECTURE.md` (contracts) as needed. Research briefs: `docs/research/`. References: `reference/`.

## Architectural principles
- **One world, shared systems.** Features plug into existing systems (terrain, water, vegetation,
  environment, landmarks, effects, camera, tour, render); no parallel one-off pipelines.
- **Single sources of truth:** `data/world/*.json` (frame, places, regions, looks), `data/tour/*` (route,
  timeline), the **HeightField** service (the only height API: base bake + TS stamp layer).
- **Determinism:** every frame is a pure function of `SceneState` (from `Timeline.evaluate(t)`).
  Systems implement `evaluate(frame)`; no `Math.random`, `Date.now`, `performance.now`, TSL `time`, or hidden
  accumulated state in anything that renders. Randomness = `rand(seed, id, k)` (src/core/rng.ts). Effects
  animate only from `SceneState.tFx`; event-driven lights / emitters / beams read `SceneState.events` through
  the one gate table (`src/materials/gates.ts`, TSL node + CPU mirror).
- **Landmarks declare, systems realize:** `defineLandmark` bundles stamps, kit proxy / model, lights
  (→ EmissionSystem sprites), trees and `forests` (→ VegetationSystem), pools, emitters, annotations,
  bookmarks, falls, reflectors, treeCaps. Landmarks never own materials, particle systems or render loops. All materials come from the
  shared **material families** (two uber materials: structure + glow). One fixed design scale per landmark —
  readability comes from silhouette, contrast and emission, never distance-dependent size.
- **Nothing DOM-based appears in captured frames.** Map labels = cartography layer; titles = canvas-2D
  textures on quads. DOM labels are debug-only.
- **Quality ceiling = offline pipeline.** Preview tier stays usable on the Intel UHD iGPU; stills/film use
  jittered accumulation (`final` tier). Never lower final quality to fit real-time. Graph parts that only
  review / final can afford are gated off in preview (`atmosphere.full`, the terrain `preview` flag,
  `structureTier.full`, cumulus, halos, reflection proxies). The terrain samples 15 of WebGPU's 16 textures —
  frozen: new looks reuse existing fetches. Lens: subtle DOF on close heroes only (bookmark `fStop`, active
  at spp ≥ 8), never tilt-shift.

## Workflow rules
- Visual work is not done until it has been **rendered, inspected and compared with references**:
  `pnpm shots --shot <id>` / `pnpm qa` (render-target readback — page screenshots of WebGPU are black).
- **One heavy job at a time** (7.6 GB RAM shared with the iGPU): captures, bake and build all take the
  machine-wide lock (`%LOCALAPPDATA%\map-of-middle-earth\gpu.lock`) behind a free-RAM guard. Captures run in
  bounded batches (`pnpm qa --batch 8`, fresh Chrome per batch), in the foreground, ≤ 10 min per call
  (split long sets with `qa --only a,b,…`; Claude Code's background shells are killed on low RAM); iterate at
  1280×720 spp 2, milestone QA at 1600×900 spp 4. Agents never run `pnpm build` or long-lived dev servers.
  Blender (`pnpm models`) runs headless under the same lock and guard.
- Max **2** parallel implementation agents on this host, each in its own worktree and module files; the
  main agent reviews and integrates — never accept subagent output unseen. `pnpm perf --gate` guards the
  preview tier against `data/qa/perf-baseline.json`; the laptop has slow / fast power regimes (~1.7×), so
  compare code only by rested, interleaved A/B runs against a frozen worktree, never across days.
- Commit at meaningful milestones; update `docs/PROJECT_STATE.md` at each milestone.
  **Push only at session end, after explicit user approval.**
- `CLAUDE.md` changes only when stable rules change; session logs go to `PROJECT_STATE.md`.

## Conventions
- Units: 1 world unit = 1 km of the ME-GIS grid; origin at map centre; X east, −Z north, Y up.
  Terrain heights are exaggerated (see `data/world/world.json`); landmark display positions may be
  offset from canonical ones (validator-checked).
- TypeScript strict, ES modules, pnpm. `three` pinned to 0.186.1 — upgrade deliberately.
- Ids are kebab-case and shared across data, folders, references and bookmarks (`minas-tirith`).
- Python bake lives in `tools/bake` (uv env). Landmarks: TS procedural kit v2 by default; Blender 4.5
  headless GLBs (`tools/blender`, `pnpm models`) only for close-up heroes where a blind A/B beats the kit
  (S3: the Argonath). A landmark is done when its shot-list entry is `status: s3` and `pnpm check` passes
  its budget, seating and bookmark-framing gates (`data/tour/shotlist.json`, camera probe v2).
  Worktrees point `MOME_WORLD_DIR` / `MOME_SOURCE_DIR` / `MOME_REFERENCE_DIR` at the main checkout's
  gitignored data instead of re-fetching or junctioning it.

## Licensing & IP (hard rules)
- Never commit `data/source/`, `data/baked/`, reference images or fetched textures (public repo).
  ME-GIS/Arda-derived data needs the authors' permission before any public release.
- Every shipped asset in `public/` must be listed in `CREDITS.md`.
- OFL fonts only; no Tengwar/Cirth, no film logos or film typography; no imitation of Howard Shore's music.

## Commands
`pnpm dev` · `pnpm typecheck` · `pnpm build` · `pnpm data:fetch` · `pnpm bake` · `pnpm shots --smoke|--shot <id>` ·
`pnpm qa [--set s4|s4-review|s4-heroes|s3|landmarks-s3|wides-s3|overview|regions] [--only a,b] [--batch 8] [--blind <set>]` · `pnpm perf [--gate]` ·
`pnpm check` · `pnpm models [--only id] [--verify]` · `node --import tsx tools/check/cameras.ts` (camera probe) ·
`pnpm review --from <qa run> [--before <run>]` (review stills folder) · `pnpm perf --save-baseline <label>`
