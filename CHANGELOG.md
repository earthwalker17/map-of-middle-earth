# Changelog

Notable changes to *Map of Middle-Earth*, newest first ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
[Semantic Versioning](https://semver.org)). Session logs: `docs/PROJECT_STATE.md`; contracts: `docs/ARCHITECTURE.md`.

## [1.0.0] — 2026-10-06 — the film

*Journey Through Middle-Earth*: 227.75 s at 24 fps (5466 frames), a west → east grand tour via Rohan loosely on
Frodo's road, one day of light (dawn in the Shire → moonlit Mordor), picture-locked (`data/tour/timeline.json`
`status: locked`, film hash `1c3edf71`). The static world is unchanged: lock-v1 12/12 identical, last on the
pinned Chrome (`renders/qa/20261005-180343`). The film and its score stay local and are **not attached to this
release**: publishing needs the ME-DEM / ME-GIS / Arda authors' permission (see `CREDITS.md`, Film).

### Added
- **Tour compiler + camera rig** (`src/tour`, pure: Node and the page run the same code): `compileFilm` of
  `data/tour/timeline.json` (33 beats: 17 holds, 16 moves) and `route.json` v2 (1730.9 km), zoom / pan moves,
  hold drift, ground clearance and ash-deck caps, captions and the music cue sheet; `FilmTimeline` (`'film'`).
- **Route line** (`RouteSystem`): a gold ribbon of screen-space width revealed to the route head, depth and
  canopy pulls, underground legs as an x-ray of dots; it keeps its gold through the grade (`enableRouteKeep`).
- **Titles** (`TitleSystem`): a post overlay of OFL-font cards (title, place / pass labels, end card with
  credits) laid out off their landmark's silhouette; never in still pages.
- **Film-only behaviour** from optional `SceneState` fields and the `?film=1` boot block (stills stay
  bit-identical): smooth key-shadow fit, one-sided LOD dissolve across the shutter sub-samples, 2× supersampled
  labels, `shutterCentre`.
- **Film gates** (`tools/check/film.ts`, in `pnpm check`): structure and route report; once `locked`, errors for
  clearance, speed, rotation, jerk, labels, voids and LOD changes in holds (the picture lock passes with 0
  errors); `--cues`, `--sync-shotlist`.
- **`pnpm film`**: stills, chunked resumable sequences streamed to ffmpeg, an adaptive motion-blur spp ladder,
  `--verify-resume`, `--assemble` (H.264 / AAC 320k mp4).
- **Original score** (`pnpm music`, `tools/music`): the score as code (`journey.py`), VSCO 2 CE samples (CC0)
  rendered with sfizz, the project's own hall / glue / limiter master; v4 fits the locked cues (−16.02 LUFS,
  −1.79 dBTP). No imitation of Howard Shore's music.
- **Unattended rendering (S6)**: `MOME_CHROME` (a private copy of the locked Chrome 154.0.8037.95), `keepAwake()`,
  resume refusals with exit 2 (another Chrome or film hash, a dirty tree, a commit that changes the render inputs),
  the 25-min session cap after ≥ 1 chunk, `--verify-resume --sample N` (middle frames, the run's Chrome),
  `--assemble --master` (the ProRes + 24-bit PCM master first, then the mp4), `tools/capture/film-overnight.ps1`.
- **The final 1080p render** (commit `0f0aa5b`): final tier at 1920×1080, base spp 12 + ladder up to 48 on fast
  moves, 180° shutter, subtle DOF on the four close hero holds (Hobbiton, Rivendell, the Argonath, Mount Doom),
  film grain; 114 ProRes 422 HQ chunks, 68,328 sub-samples, 11.1 h wall in one unattended run,
  `--verify-resume --sample 12` 12/12 IDENTICAL. Outputs in the gitignored `final/`: the H.264 mp4, the
  ProRes master and `ABOUT.txt` (provenance).

### Changed
- Version 1.0.0; `CREDITS.md` gains a Film section and the x264 credit. The 720p review cut was approved without
  picture rework; its polish candidates, the landmark-build / vegetation workers, compile time and the TitleSystem
  layout export move to V2.

### Removed
- `data/qa/review-s4.json` (the S4 review manifest; its S3 "before" run was deleted in S6): `pnpm review` now
  defaults to `data/qa/review-v1.json` → `review/v1`.

## [0.5.0] — 2026-10-03 — the static world, locked

### Added
- **S1 foundation and geography**: the Python bake of the ME-GIS vectors and the Arda DEM (`tools/bake`, uv),
  the World and the HeightField (the only height API, with a TypeScript stamp layer), CDLOD terrain, day /
  night sky, void backdrop and soft shadows, the diorama slab, water, vegetation and 24 landmark blockouts; the
  capture / QA harness (render-target readback).
- **S2 world look**: host hygiene and bounded QA (`pnpm host`, batches, heavy-job lock, perf gate); bake v2
  (monotone river DAG, thalweg snap, lakes, relief de-spike, river guard, defect-budget gates), aerial
  perspective with the RegionLook grade, regional haze, cloud shadows and the studio backdrop, terrain look v2
  (baked ground look, CC0 detail layers, Shire fields), vegetation look.
- **S3 landmarks (all 24)**: shot list v0, kit v2 and families v2 (two uber materials), stamps v2, vertex AO,
  projected-px LOD, the EmissionSystem, landmark trees / forests / pools, the Blender GLB pipeline (`pnpm
  models`: the Argonath), 34 bookmarks gated by camera probe v2.
- **S4 look and still effects**: the ash deck, cumulus, the Mordor pall, night, valley mist; strata, volcanic
  crust, snow v4, lava flows; crown archetypes and the far canopy shell; one gate table, emission spill, halos
  and glints; the EffectsSystem (stateless plumes, falls, mist, the Morgul beam, beacons); lens DOF and the film
  grade; weathering; reflection proxies; one hero-polish wave. Recognizability 24/24; the film-look gate
  (2.35 / 3.0) stays open by decision.
- **S4.5 static finalization**: Intel driver re-baseline and small fixes; the V1 pixel-hash lock (`pnpm lock`,
  `data/qa/lock-v1.json`: 12 sentinels at 1600×900 spp 4, Chrome 154.0.8037.95, Intel driver 31.0.101.2145);
  review stills `review/v1`; README with showcase stills (`pnpm showcase`), MIT `LICENSE` for the code and
  original models, publication credits in `CREDITS.md`, CI (typecheck + check).

[1.0.0]: https://github.com/earthwalker17/map-of-middle-earth/compare/v0.5.0...v1.0.0
[0.5.0]: https://github.com/earthwalker17/map-of-middle-earth/releases/tag/v0.5.0
