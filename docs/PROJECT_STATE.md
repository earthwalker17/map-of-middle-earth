# Project state — Map of Middle-Earth

_Rolling document: roadmap, current state, decisions, next steps. Keep it compact; replace stale detail
instead of appending logs._

**Last updated:** 2026-10-03 · end of Session 4.5 (static finalization + repo polish) — push and tag
`v0.5.0` pending user approval

## Where we are
**S1–S4.5 are complete; the static world is locked for V1 (`v0.5.0`, see below).** The world renders
deterministically on the Intel UHD iGPU with the S4 look: ash pall over Mordor, strata / crust / snow
terrain, vegetation archetypes, emission that lights its surroundings, water reflections, still effects
(plumes, falls, mist, beam, beacons), a filmic lens and grade, and all 24 landmarks at status s3. The repo
presents as an open-source project (README with showcase stills, MIT licence, CI). **S5 is the film.**

## Static world locked for V1 (S4.5)
- **Lock:** `data/qa/lock-v1.json` = pixel sha256 of the 12 `lock-v1` sentinels (overviews day / night, shire,
  mordor, erebor / hobbiton / rivendell / argonath / lake-town close, minas-tirith-night, minas-morgul-beam,
  s4e-doom-fx) at 1600×900 spp 4 review tier, Chrome 154.0.8037.95, Intel driver 31.0.101.2145, code
  91993b3 (`dirty` = uncommitted docs only). Written from the full `s4` run `renders/qa/20261003-225000`
  (57 shots, KEEP); a fresh-process re-render (`20261003-225208`) verified 12/12 IDENTICAL.
  Verify: `pnpm qa --set lock-v1 --w 1600 --h 900 --spp 4 --batch 13` → `pnpm lock --verify <run>` (exit 0
  identical · 1 changed · 2 Chrome / driver differ, hashes advisory · 3 other settings).
- **Review stills:** `review/v1/` (24 stills, 4 day / night pairs, 4 S4 → V1 sheets) from
  `renders/qa/20261003-230100` (final 1920×1080 spp 12, KEEP); 14 of 24 are pixel-identical to the S4 stills.
- **README stills:** `docs/images/` (15 JPEGs, 2.25 MB) by `pnpm showcase` from `data/qa/showcase.json`
  (the V1 review run + `renders/shots/20261003-231307`: the 2.4:1 golden-hour hero `pano-golden-sw`
  3072×1280 spp 16 and black-gate-wide; KEEP); provenance and render hashes in `docs/images/manifest.json`.
- **Change control:** S5+ film work (timeline, route line, title cards, camera moves, music) must leave
  locked frames bit-identical — run the lock verify after any change to shared systems (`src/` outside the
  new film modules). A look change happens only on the user's request, with before / after renders, and
  ends with a re-lock (`lock-v2`, new KEEP runs, README stills re-encoded). After a Chrome or driver update,
  re-render the set on the locked code and re-write the lock before judging code.
- **Accepted for V1** (no further world-building unless the user asks): far Doom plume dark over the Black
  Gate / a brown smear in anduin-gondor (puff lighting under the deck, not haze height — S4.5 measured);
  Hobbiton bank shelf / segmented lanes / bar hedges / no pond mirror; Lake-town close half hillside, lamps
  without facade spill; Black Gate wall short and box-like, smooth foreground butte; Doom flows thin at 50 km
  (the lane cap is the lever), straight flanks; Minas Tirith prow on the dark side, apron foreshortened;
  Minas Morgul city merging with its cliff, an edge-on mist card in the wide (the card is also the gate veil
  in the hero); Erebor a centred pyramid at 62 km; Rauros falls a pale block, Tol Brandir columnar; faceted
  foreground rock at Moria; the film-look gate (2.35 / 3.0) stays open by decision (V1 does not chase max
  detail).

**S4.5 log (2026-10-03):** Intel driver 31.0.101.2145 + pagefile active; smoke PASS, determinism
IDENTICAL, cross-process hashes 26/26 identical (`20261003-212112` vs `-212344`, reordered and rebatched),
`models --verify` IDENTICAL, no driver regressions (the S4 review stills re-render pixel-identical where the
code did not change). **Fixes (worktree `s45/look`, reviewed + blind-critiqued):** black-gate-wide reframed
(az 342, aim [4,-0.3], fov 23: the pale strip and green foothill are gone), Moria ithildin softer and bluer
(0x4a72c8, strength 1.0, halo 0.3, spill tinted), Minas Tirith prow lighter with blocks (clamped short of the
keel), Rauros plunge rocks flatter / darker; tried and reverted: far-plume haze height (no visible effect),
the Morgul mist card (it is also the hero's gate veil), wider Doom flows (only crust lanes). **Hygiene +
tooling (`s45/tools`):** latheGeo on-axis guard, seating bury floor = SINK, hero-camera copies synced,
obsolete shot files removed, stale notes; `pnpm lock`, `pnpm showcase`, `compose.ts` / `runs.ts`, camera
probe `ASPECT`. **Repo:** README, MIT LICENSE, CREDITS (published renders), `.nvmrc` / `.editorconfig`,
CI (typecheck + check, verified in a data-free worktree), package 0.5.0 metadata, research briefs marked
historical (download how-tos removed), `reference/README.md` + `manifest.json` untracked (a public index of
143 copyrighted image URLs, 34 with Fandom Referer workarounds; they stay local and remain in git history),
~2.2 GB of superseded renders removed (blind-test keys copied into the KEEP runs; the S4.5 battery perf
record is in `20261003-225000/`). README reviewed by 4 read-only agents (accuracy, newcomer setup,
licensing / IP, rendered layout at 1280 / 830 / 390 px).

**World and landmarks (S1–S3):** bake v2 geography and water; RegionLook grade, regional haze, cloud shadows,
studio backdrop; landmark platform (kit v2, families v2, stamps v2, EmissionSystem, landmark trees /
forests, pools, Blender GLB pipeline); shot list v0 (`data/tour/shotlist.json`, film draft 204 s); 34
bookmarks (24 `-close` + 10 `-wide`) meeting their probe framing gates.

**S4 (look + still effects; contracts in `docs/ARCHITECTURE.md`):**
- **W1 sky / atmosphere:** per-region ash deck (`deck` lines, `atmo2` field texture, `cloudLayer.ts`, Doom
  underglow following the cloud masses), visible cumulus (review / final), hazeRamp, the Mordor pall (gap
  fill, eye haze, sun hidden under the deck, line of sight to Doom), moon key + night grade, sparser stars,
  valley mist. **Terrain:** triplanar fix + 3D rock noise (no vertical smear), shared strata, grass breakup,
  Gorgoroth crust / cracks / basalt / fissure glow, snow v2 → v4, macro relief (far / near fade), ragged
  grass ↔ rock, fields with mow rows, lava flows continuing the Doom kit flows.
- **W2 vegetation:** six crown archetypes packed in `iB.w` (still 7 vertex buffers), copses, lognormal
  scale, landmark `treeCaps`, a canopy shell beyond ~30 km (texture 15/16, frozen). **Emission:** one gate
  table (`gates.ts`, `SceneState.events`), top-N spill (8 review / final, 4 preview) on terrain, structures,
  foliage and water, analytic halos, GGX glints on water.
- **W3 EffectsSystem** (stateless particles, `tFx`): plumes, smoke, steam, mist cards, sparks, falls with
  plunge foam, the Morgul beam, beacons (event-gated). **Lens / grade:** subtle DOF only at spp ≥ 8 and
  fStop < 22 (hero bookmarks), per-region split-tone, halation, deterministic grain (final tier);
  `tools/capture/review.ts` composes review folders.
- **W4 surfaces:** structure weathering (review / final only, `structureTier`), roof / carved classes,
  rivers as calm slicks with shallows, lake skirts, **reflection proxies** (GLB instances + declared
  `reflectors`, e.g. Tol Brandir), sprite ash extinction. C2 shared fixes: Shire grade, streaks, macro near
  fade, strata contrast, mist lit by the sky.
- **W5 hero polish (G1 / G2):** Hobbiton (low fronts in turf banks, grassy terraces, lanes, reframed low with
  the pond), Black Gate (iron piers, fang row, looming ridges, butte), Argonath (GLB: 1.4× coursed, battered
  pedestals; rubble; Tol Brandir one twisting pillar), Erebor (craggier, unequal spurs, south scarp), Moria
  (thin blue-silver ithildin, arched niche, hollies), Minas Morgul (dark stone, corpse-light at the foot and
  gate, arched statue bridge), Lake-town (piles, dark timber / slate, mist, reframed), Mount Doom (continuous
  flows with pools, `mount-doom/flows.ts` shared with `VOLCANIC.flows`, second plume column), Rivendell
  (pavilions, verdigris bell-cast roofs, varied falls), Minas Tirith (tier heights, great halls, prow keel,
  apron patches, from the south-east at 55 km).

**S4 validation** (final QA `renders/qa/20261003-005500` = set `s4`, 57 shots, 1600×900 spp 4; review
stills `renders/qa/20261003-010300` final tier 1920×1080 spp 12; `critic-s4-final.json` in both; critics on
anonymised images, keys decoded in code):
- **Blind paired S3 vs S4** (the S3 code at d69b6e0 rendering the exact S4 cameras, 22 pairs × 2 judges):
  S4 wins **75 %** (gate 70 % ✓), hero pauses **5/7** (Hobbiton tie; Argonath lost — judges preferred S3's
  rough rock plinths to the coursed pedestals). S3 also kept anduin-gondor (Doom's far plume as a brown
  smear), shire (S3's crisper patchwork) and overview-day (near-identical).
- **Film-look** (3 critics, 10 hero stills): mean **2.35 / 4** (S3 1.80, C2 2.29; gate 3.0 ✗), toy votes
  21/30 (✗), lowest Hobbiton 1.67, Lake-town 1.83. Best: Minas Tirith 2.83, Argonath 2.83, Rivendell 2.61,
  Doom 2.56. The critics agree the sky / light / grade now carry film qualities and the remaining toy reads
  are **kit architecture without secondary detail** (smial plaques, Rivendell gable boxes, the Morannon
  "toy fort", Lake-town blocks), **effects / emission built as clean strips** (lava tubes, fall ribbons,
  ithildin vectors), faceted foreground rock and blob trees.
- **Recognizability 24/24**, **wide locatability 14/14** (S3 10/14), **night emission 4/6** (Hobbiton windows
  and Lake-town lamps do not spill onto facades).
- **Perf** (preview 1280×720, rested interleaved A/B vs the S3 code, 2 rounds): 0.95–1.11× per view
  (minas-tirith-close +11 %, anduin-gondor +8 %), boot +2 s (11.0 vs 9.0 s). New baseline label **s4**:
  overview 57.1 / shire 48.8 / anduin-gondor 55.9 / minas-tirith-close 68.5 / mordor 48.2 /
  rivendell-close 51.5 ms (compile 1.9 s is a warm Dawn cache — re-baseline in S5).
- **Checks:** typecheck; `pnpm check` OK (24/24 status s3, 34/34 bookmarks, gates, effects random access);
  determinism IDENTICAL on Doom (`tFx` 37.25), Rivendell falls, the Morgul beam and the beacons (each effect
  shot first, repeated after another render); `pnpm models --verify` IDENTICAL; `pnpm build` OK.
- **Review stills for the user:** `review/s4/` (approved by the user for V1; superseded by `review/v1/`,
  rebuildable from `20261003-010300` with `data/qa/review-s4.json`).

**Baselines (KEEP):** `renders/qa/20260929-215504` (S1) · `20260930-092759` (S2) · `20261001-174844` (S3
final) · `20261002-211200` (S4 C2) · `20261003-005500` (S4 final) · `20261003-010300` (S4 review stills) ·
`20261001-181521` (S3 fix re-renders) · `20261003-212112` (S4 code on the new driver) · `20261003-225000` (V1 lock) · `20261003-225208` (lock
verify) · `20261003-230100` (V1 review stills) · `renders/shots/20261003-231307` (README hero) ·
`data/baked-s1`.

## Roadmap (6 sessions)
| # | Session | Scope | Status |
|---|---|---|---|
| 1 | Foundation & Geography | world, data, systems v1, proxies, capture/QA | ✅ |
| 2 | World look | host hygiene + bounded QA, bake v2, atmosphere + RegionLook, terrain look v2, vegetation look | ✅ |
| 3 | Landmarks (all 24) | shot list v0, kit v2 + families v2, stamps v2, emission, landmark trees / forests, Blender spike (GO: Argonath), all 24 rebuilt and gated | ✅ |
| 4 | Look + still effects | ash deck / atmosphere / night / mist, terrain material, vegetation archetypes + canopy shell, emission spill / gates / halos, water + reflection proxies, EffectsSystem, lens + grade, weathering, one hero-polish wave, review stills | ✅ (film-look gate open: 2.35 / 3.0) |
| 4.5 | Static finalization + repo polish | driver re-baseline, small fixes, V1 lock (`lock-v1.json`, `review/v1`), showcase stills, README / LICENSE / CI, cleanup | ✅ (`v0.5.0`) |
| 5 | Cinematic journey + music | tour timeline v0 + animatic from the shot list, route line, title cards, transitions; music spike → original score | **next** |
| 6 | Performance, final polish, render & release | Landmark build / AO in a worker, vegetation placement worker, compile time; final 1080p24 render (resumable, overnight, user-started); encode; film embed in the README; ME-GIS/Arda permission for the film | — |

## S5 priorities
1. **Perf re-baseline on mains power** (S4.5 ran on battery: the cold pass was 1.2–1.6× the S4 baseline,
   compile 3.6 s cold, so no baseline was saved): rested `pnpm perf` cold, then `--save-baseline v1-static`
   on the six S4 views; keep `s4` until then.
2. **Timeline v0 + animatic:** `Timeline.evaluate(t)` over the shot list's 16 segments (`data/tour/`), camera
   moves between bookmarks, events (beacons, beam) keyed in time, `tFx` from film time, low-res animatic.
3. **Route line + title cards** (canvas-2D textures on quads, OFL fonts), transitions; **music spike** →
   original score (no imitation of Howard Shore).
4. **Lock discipline:** film modules plug into the existing systems; `pnpm lock --verify` stays exit 0 after
   every merge (change control above).

## Decisions (stable)
- **Presentation and film:** floating diorama slab; film 3–4 min (shot-list draft 204 s), 16:9, 1080p24 with
  a 180° shutter; hero pauses Hobbiton, Rivendell, Moria, Argonath, Black Gate, Minas Morgul, Mount Doom;
  prologue Erebor / Lake-town / Dale; epilogue Grey Havens.
- **Rendering:** WebGPU + TSL (three 0.186.1), reversed-Z, deterministic `SceneState` (incl. `weather`,
  `events`, `tFx`); quality tiers preview / review / final — preview drops the review / final graph parts
  (`atmosphere.full`, terrain `preview`, `structureTier.full`, cumulus, halos, reflection proxies).
- **Geography:** ME-GIS canon vectors + Arda DEM; river centrelines snapped to the DEM thalweg; display
  offsets validator-checked. **The world frame stays.**
- **Look:** wide shots read as a crisp physical model; regional/mid shots carry aerial depth; Mordor is
  charcoal under an ash pall with red only near Doom; lens = subtle DOF on close heroes only (no tilt-shift).
- **Landmarks:** one fixed design scale each; readability from silhouette, contrast and emission; TS kit v2
  by default, Blender GLBs only where a blind A/B beats the kit (Argonath); landmarks declare (lights,
  emitters, falls, reflectors, treeCaps, flows), systems realize.
- **S4 scope (user, 2026-10-02):** look + still effects, one bounded hero wave, subtle filmic DOF; timeline /
  animatic / music moved to S5.
- **Repo:** public; push only after user approval; raw CC0 texture sources in `data/textures-src`
  (gitignored), derived layers in `public/textures/terrain` (gitignored, credited); GLBs in `public/models`
  are original, generated by `tools/blender` (credited); `review/` is gitignored.
- **Licence and stills (user, S4.5):** code and original models MIT (`LICENSE`, earthwalker17); the README
  shows the project's own renders (`docs/images/`: not MIT, no reuse licence granted; `docs/images/README.md`) with
  prominent ME-DEM / ME-GIS / Arda credit; source and baked data never committed; the user sends the data
  authors a heads-up / permission note, and permission is needed before the film or any derived data is
  published.

## Host and workflow (Surface Laptop Go, i5-1035G1, 7.6 GB RAM shared with the iGPU)
- **Session start:** `pnpm host --fix` (approved: stop windowless Edge / WPS / OneDrive / Teams / Phone Link /
  PC Manager, keep their autostart disabled). Idle ≈ 3.3–3.6 GB available.
- **Host:** Defender folder exclusions for the project, pnpm store, the app cache, ms-playwright,
  `%TEMP%\claude`, `%TEMP%\tsx-A` and `~/.claude/projects`; fixed pagefile 8–16 GB; Intel driver
  31.0.101.2145 (installed after S4; pixel-neutral for unchanged code). Windows Update was not paused.
- **One heavy job at a time; captures in the FOREGROUND** (≤ 10 min per call: split with `qa --only`; the
  background-shell reaper kills long background captures on low memory). The 57-shot `s4` set at 1600×900
  spp 4 takes ≈ 6.5 min (two calls of ~3 min), 24 final-tier stills at 1920×1080 spp 12 ≈ 7 min (two calls),
  a 3072×1280 spp 16 hero ≈ 1 min. Merged runs: copy the parts' shots + renumbered manifests into one stamped
  folder (`pnpm lock` / `pnpm showcase` read `manifest(-N).json`). In PowerShell quote `--only "a,b,c"`
  (an unquoted comma list becomes an array → "0/1 shots").
- **Perf:** the iGPU shares the package power with the CPU and the laptop has a slow and a fast regime
  (~1.7× apart; it can run on battery under load even when plugged in). `pnpm perf` waits for a quiet host
  and records `noise`; compare only rested (90 s) interleaved A/B runs against a frozen worktree of the
  other code, never against a baseline from another day.
- **Agents (S3 / S4 pattern):** one Workflow per wave, ≤ 2 implementation agents in pre-created worktrees
  (`source .claude/worktrees/s4-env.sh`), each followed by a read-only reviewer ‖ visual critic, then one
  fix round; the main agent views every render, merges `--no-ff` (sets.json conflicts via a line-key union),
  keeps `pnpm check` green. Briefs in `.claude/worktrees/briefs/`.
- **Cleanup:** `git worktree remove --force` leaves the folder on MSYS ("Directory not empty") — delete it
  from PowerShell `Remove-Item -LiteralPath <path> -Recurse -Force`; never `rm -rf` (pnpm junctions).

## Camera-distance census (seed of the shot list)
wide (> 300 km) ~15 % · regional (60–300 km) ~50 % · mid (15–60 km) ~30 % · close (< 15 km) ~5 % of screen
time. Landmark detail budgets target 15–60 km.

## Known residuals (accepted for V1 — hero list above; change only on the user's request)
**Heroes:** as listed under "Accepted for V1"; also Doom preview flow gaps, Mindolluin running out of the
minas-tirith-close frame, the Argonath GLB at ~76k of the 80k budget.
**Shared:** settlement windows outside the top-N spill set do not light facades; mist-card look (#20);
steep-face vertical smear on stamped walls (Morgulduin, Rivendell); Rivendell's occlusion gate is very
sensitive to scarp roughness; Shire field patchwork contrast (S3 preferred); daytime torch floor 0.25;
boot +2–3 s (landmark build + AO → worker in S6); the probe's subject box includes raising stamps. Copy
drift outside the synced heroes: `w3e-barad-night` lacks `lookOverride: mordor`, `s4e-riv-fx` lacks
`fStop: 8`, `w1a-doom-night` uses an old Doom camera (all outside `lock-v1`).
**Bake:** 98 torrent step cells (warning); stream-36 22 km source trim; Entwash / Forest River confluence
pools; marsh fills ≈ 271 km² > 0.5. A re-bake needs the user's explicit OK.

## Learned gotchas (r186 / this machine)
- **TSL:** `vec3(new Color())` silently yields black — use `color(c)`; an `int(x)` uniformArray index must be
  `.toVar()`; `meta` / `time` are reserved WGSL words; assign inside `If` blocks to `.toVar()` nodes only.
- **WebGPU:** at most 8 vertex buffers per draw (vegetation 7, emission 5, landmarks 4); the terrain samples
  15 of 16 textures (frozen).
- **No environment map:** metals and glossy dark stone go black in shade without the families' specular
  ambient; keep it if materials change.
- **Capture:** readback only; warm-up frame; NoColorSpace readback; Chrome honours only the last
  `--disable-features`; `shots --determinism` repeats the first job AFTER the batch — JSON shots sort before
  bookmarks, so pair an effect shot with a bookmark shot to test it.
- **Night shots:** check the moon (`moonPhase` / `moonDirection` for the shot's tod + dayOfYear) — a moon
  below the horizon gives a black frame (S4: lake-town-night, rivendell-night re-dated); dayOfYear only
  moves the sun / moon / sky.
- **Copies of hero cameras** (review / lens / night shots in `data/qa/shots.d`) go stale when a bookmark is
  reframed — regenerate them from the bookmarks after hero work (with the landmark's `lookOverride` and the
  bookmark `fStop`, which the bookmark path adds; a copy is proven equal by an identical pixel hash).
- **Hashes:** renders are bit-identical across processes, batch orders and batch sizes for fixed code +
  Chrome + driver + settings; a far geometry edit (e.g. Rauros rocks) changes a few pixels of the overviews,
  so sentinels catch it. `pnpm lock --compare <runA> <runB>` diffs two runs.
- **Tooling:** Bash heredocs can mangle backslashes — write code with the file tools; Python edits must use
  `newline=''`; tsx scripts outside the project need `.mts`; print UTF-8 with `PYTHONIOENCODING=utf-8`.
- **Worktrees / merges:** adjacent one-line entries in shotlist.json / looks.json / sets.json conflict —
  resolve by line key; agents can die on API errors after committing — check the branch, resume.
- **Bookmarks and stamps:** pass `OrbitSpec.lift` / `aimKm` through; cone / massif profiles apply to the
  height above the base; the river guard clamps stamps; the ±35 % contextKm gate limits wide distances.
- **Critics:** keep answer keys outside the folders critics read and decode verdicts in code; blind pairs
  via `tools/capture/pair.ts`, cameras via `tools/capture/exportCameras.ts` (prefix the ids, strip after);
  an agent's "no foliage change" claim needs a render check.
- **Data:** ME-DEM sea level = 16 grey levels; heights ship as raw u16; the Arda DEM has a straight submarine
  ridge west of the Gulf of Lune (`vertical.seaArtefacts`).

## Open issues / notes
- **User actions after S4.5:** upload `docs/images/social-preview.jpg` (Settings → Social preview); send the
  heads-up / permission note to the ME-GIS (jvangeld / andrewheiss), Arda (bburns) and ME-DEM (Outerra forum)
  authors; grant `gh` the `workflow` scope (`gh auth refresh -h github.com -s workflow`) so the CI file can be
  pushed.
- Permission from the ME-GIS / Arda / ME-DEM authors is needed before publishing the film.
- S5 proposal: move the checkout to `C:\dev\MAP` (shorter paths, outside Desktop / OneDrive churn) — ask.
