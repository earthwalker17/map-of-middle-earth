# Map of Middle-Earth — project constitution

A cinematic **floating miniature diorama of Middle-earth** (Three.js r186 WebGPU + TSL) with a realistic
fantasy look inspired by Peter Jackson's films — *not* a LEGO look. The final deliverable is an
offline-rendered ~3–4 min 16:9 film, **"Journey Through Middle-Earth"** (Frodo's route, luminous route line,
title cards, original score).

**Start every session by reading `docs/PROJECT_STATE.md`** (where we are, what's next), then
`docs/ARCHITECTURE.md` (contracts) as needed. Research briefs: `docs/research/`. References: `reference/`.

## Architectural principles
- **One world, shared systems.** Features plug into existing systems (terrain, water, vegetation,
  environment, landmarks, effects, camera, tour, render); no parallel one-off pipelines.
- **Single sources of truth:** `data/world/*.json` (frame, places, regions, looks), `data/tour/*` (route,
  timeline), the **HeightField** service (the only height API: base bake + TS stamp layer).
- **Determinism:** every frame is a pure function of `SceneState` (from `Timeline.evaluate(t)`).
  Systems implement `evaluate(frame)`; no `Math.random`, `Date.now`, `performance.now`, TSL `time`, or hidden
  accumulated state in anything that renders. Randomness = `rand(seed, id, k)` (src/core/rng.ts).
- **Landmarks declare, systems realize:** `defineLandmark` bundles stamps, model, lights (→ emission
  buffer), emitters, water features, annotations, bookmarks. Landmarks never own materials, particle
  systems or render loops. All materials come from the shared **material families**.
- **Nothing DOM-based appears in captured frames.** Map labels = cartography layer; titles = canvas-2D
  textures on quads. DOM labels are debug-only.
- **Quality ceiling = offline pipeline.** Preview tier stays usable on the Intel UHD iGPU; stills/film use
  jittered accumulation (`final` tier). Never lower final quality to fit real-time.

## Workflow rules
- Visual work is not done until it has been **rendered, inspected and compared with references**:
  `pnpm shots --shot <id>` / `pnpm qa` (render-target readback — page screenshots of WebGPU are black).
- One GPU at a time: every capture tool takes `.cache/gpu.lock`. Max 3 parallel agents, each in its own
  worktree and module folder; the main agent reviews and integrates — never accept subagent output unseen.
- Commit at meaningful milestones; update `docs/PROJECT_STATE.md` at each milestone.
  **Push only at session end, after explicit user approval.**
- `CLAUDE.md` changes only when stable rules change; session logs go to `PROJECT_STATE.md`.

## Conventions
- Units: 1 world unit = 1 km of the ME-GIS grid; origin at map centre; X east, −Z north, Y up.
  Terrain heights are exaggerated (see `data/world/world.json`); landmark display positions may be
  offset from canonical ones (validator-checked).
- TypeScript strict, ES modules, pnpm. `three` pinned to 0.186.1 — upgrade deliberately.
- Ids are kebab-case and shared across data, folders, references and bookmarks (`minas-tirith`).
- Python bake lives in `tools/bake` (uv env). Blender 4.5 headless for landmark GLBs (from Session 4).

## Licensing & IP (hard rules)
- Never commit `data/source/`, `data/baked/`, reference images or fetched textures (public repo).
  ME-GIS/Arda-derived data needs the authors' permission before any public release.
- Every shipped asset in `public/` must be listed in `CREDITS.md`.
- OFL fonts only; no Tengwar/Cirth, no film logos or film typography; no imitation of Howard Shore's music.

## Commands
`pnpm dev` · `pnpm typecheck` · `pnpm build` · `pnpm data:fetch` · `pnpm bake` · `pnpm shots --smoke|--shot <id>|--all` · `pnpm qa` · `pnpm check`
