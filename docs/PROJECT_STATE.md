# Project state — Map of Middle-Earth

_Rolling document: roadmap, current state, decisions, next steps. Keep it compact; replace stale detail
instead of appending logs._

**Last updated:** 2026-10-03 · end of Session 4 (Look + still effects) — push pending user approval; the user
reviews `review/s4/` before S5

## Where we are
**S1–S4 are complete.** The world renders deterministically on the Intel UHD iGPU with the S4 look: ash pall
over Mordor, strata / crust / snow terrain, vegetation archetypes, emission that lights its surroundings,
water reflections, still effects (plumes, falls, mist, beam, beacons), a filmic lens and grade, and all 24
landmarks at status s3 (10 heroes polished in S4).

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
- **Review stills for the user:** `review/s4/` (24 stills, 4 day / night pairs, 8 S3 → S4 sheets, contact,
  README with what to look at and known issues, manifest with SHA-256).

**Baselines (KEEP):** `renders/qa/20260929-215504` (S1) · `20260930-092759` (S2) · `20261001-174844` (S3
final) · `20261002-211200` (S4 C2) · `20261003-005500` (S4 final) · `20261003-010300` (S4 review stills) ·
`data/baked-s1`.

## Roadmap (6 sessions)
| # | Session | Scope | Status |
|---|---|---|---|
| 1 | Foundation & Geography | world, data, systems v1, proxies, capture/QA | ✅ |
| 2 | World look | host hygiene + bounded QA, bake v2, atmosphere + RegionLook, terrain look v2, vegetation look | ✅ |
| 3 | Landmarks (all 24) | shot list v0, kit v2 + families v2, stamps v2, emission, landmark trees / forests, Blender spike (GO: Argonath), all 24 rebuilt and gated | ✅ |
| 4 | Look + still effects | ash deck / atmosphere / night / mist, terrain material, vegetation archetypes + canopy shell, emission spill / gates / halos, water + reflection proxies, EffectsSystem, lens + grade, weathering, one hero-polish wave, review stills | ✅ (film-look gate open: 2.35 / 3.0) |
| 5 | Cinematic journey + music | user review of `review/s4` first; re-baseline after the driver update; tour timeline v0 + animatic from the shot list, route line, title cards, transitions; music spike → original score | **next** |
| 6 | Performance, final polish, render & release | Landmark build / AO in a worker, vegetation placement worker, compile time; final 1080p24 render (resumable, overnight, user-started); encode; README/CREDITS; ME-GIS/Arda permission | — |

## S5 priorities
1. **The user's review of `review/s4/`** decides any look adjustments before the video work.
2. **Re-baseline after the Intel driver (31.0.101.2145) + pagefile reboot:** determinism on the effect shots
   and Argonath, a rested `pnpm perf --save-baseline s5` (cold and warm compile), one smoke QA.
3. **Timeline v0 + animatic** (moved from S4): `Timeline.evaluate(t)` over the shot list's 16 segments,
   events (beacons, beam) keyed in time, low-res animatic; the route line and title cards; music spike.
4. **Film-look backlog (only what the user prioritises; V1 does not chase max detail):** secondary detail on
   kit architecture (smial doors set in turf arches, Rivendell galleries / window tracery, the Morannon's
   height and buttresses, Lake-town facades and lit windows), effects that read as light (lava with crust
   and soft cores, softer fall ribbons, ithildin glow falloff), far plumes faded by distance / haze (the Doom
   plume over the Black Gate and anduin-gondor), settlement windows that spill (Hobbiton, Lake-town),
   foreground rock without facets (Moria), the Argonath pedestals (S3's rough plinths won the blind pair).

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
- **Repo:** public, code only; push only after user approval; raw CC0 texture sources in `data/textures-src`
  (gitignored), derived layers in `public/textures/terrain` (gitignored, credited); GLBs in `public/models`
  are original, generated by `tools/blender` (credited); `review/` is gitignored.

## Host and workflow (Surface Laptop Go, i5-1035G1, 7.6 GB RAM shared with the iGPU)
- **Session start:** `pnpm host --fix` (approved: stop windowless Edge / WPS / OneDrive / Teams / Phone Link /
  PC Manager, keep their autostart disabled). Idle ≈ 3.3–3.6 GB available.
- **S4 host changes:** Defender folder exclusions for the project, pnpm store, the app cache, ms-playwright,
  `%TEMP%\claude`, `%TEMP%\tsx-A` and `~/.claude/projects`; fixed pagefile 8–16 GB (active after the reboot);
  Intel driver 31.0.101.2145 downloaded to `Downloads\gfx_win_101.2145.exe` for the user to install at the
  end of S4. Windows Update was not paused.
- **One heavy job at a time; captures in the FOREGROUND** (≤ 10 min per call: split with `qa --only`; the
  background-shell reaper kills long background captures on low memory). In the fast power regime the
  57-shot `s4` set at 1600×900 spp 4 takes ≈ 6.5 min, 24 final-tier stills at 1920×1080 spp 12 ≈ 5.5 min.
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

## Known residuals (fix opportunistically)
**Heroes (S4 final critics):** Hobbiton fronts show a thin bank shelf, segmented lanes, bar hedges, no pond
reflection; Lake-town close is half shaded hillside (no Erebor / horizon), night lamps without facade
spill; Black Gate wall short and box-like, the foreground butte a smooth dome, black-gate-wide shows a pale
strip and green foothill at the right edge; Doom flows thin at 50 km, straight flanks, preview flow gaps;
Minas Tirith prow face a flat dark slab, Mindolluin runs out of the frame; Minas Morgul city merges with the
cliff (no value separation) and an edge-on mist card by the bridge in the wide; Erebor still a centred
pyramid at 62 km; Rauros falls a pale block with round boulders, Tol Brandir still columnar; Moria ithildin
hard-edged near-white, faceted foreground rock; Argonath GLB at ~76k of the 80k budget.
**Shared:** far plumes are barely hazed at altitude (Doom's plume over the Black Gate, a brown smear in
anduin-gondor); settlement windows outside the top-N spill set do not light facades; mist-card look
(#20); steep-face vertical smear on stamped walls (Morgulduin, Rivendell); the seating gate counts thin
ground decals (< 0.02 km) as buried; Rivendell's occlusion gate is very sensitive to scarp roughness;
`latheGeo` with an on-axis segment and partial `arcDeg` emits stray triangles; Shire field patchwork
contrast (S3 preferred). Older: daytime torch floor 0.25; boot +2–3 s (landmark build + AO → worker in S6);
the probe's subject box includes raising stamps.
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
  reframed — regenerate them from the bookmarks after hero work.
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
- **User action at the end of S4:** install the Intel driver (`Downloads\gfx_win_101.2145.exe`; it replaces
  the Surface OEM driver) and reboot (also applies the pagefile). S5 starts with the re-baseline.
- Ask the ME-GIS / Arda authors for permission before publishing the film.
- S5 proposal: move the checkout to `C:\dev\MAP` (shorter paths, outside Desktop / OneDrive churn) — ask.
