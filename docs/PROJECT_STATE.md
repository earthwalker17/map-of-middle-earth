# Project state — Map of Middle-Earth

_Rolling document: roadmap, current state, decisions, next steps. Keep it compact; replace stale detail
instead of appending logs._

**Last updated:** 2026-10-06 · end of Session 6 — V1 complete (`v1.0.0`); not pushed yet (asks the user)

## Where we are
**S1–S6 are complete: V1 is done.** V1 = the static world locked in S4.5 (`v0.5.0`, below) + the film
**"Journey Through Middle-Earth"**: 227.75 s at 24 fps, picture-locked (`data/tour/timeline.json` `status:
locked`, film hash 1c3edf71), a west → east grand tour via Rohan with a gold route line, floating labels, title /
end cards, one day of light (dawn in the Shire → moonlit Mordor) and an original orchestral score. The user
approved the 720p review cut with no picture rework (S6). Next is V2 (not scheduled; see "V2 candidates").

**The deliverable — the final film** (`final/` is gitignored, local only; not published until the data authors
give permission):
- `final/journey-through-middle-earth-1080p.mp4` (`C:\Users\A\Desktop\MAP\final\` on the dev laptop) — H.264 High 1080p24 BT.709, AAC 320k
  48 kHz, 5466 frames = 227.75 s, faststart, −16.0 LUFS; 492.7 MB (17.3 Mb/s), sha256 dafdaaee…94d777de.
- `final/journey-through-middle-earth-1080p-master.mov` — ProRes 422 HQ 10-bit + 24-bit PCM 48 kHz, 5.28 GB
  (185.5 Mb/s), sha256 4a0368f0…05cf7252: the mezzanine for any later upload or re-encode. `final/ABOUT.txt` =
  provenance (commit, film hash, settings, score, credits, publication status).
- **Picture:** `renders/film/final-1920x1080-20261005-184304-final-1080p` (run.json: tier final, 1920×1080, base
  spp 12 + motion ladder `36:16,48:24,72:32,96:48` (px at 1080p, dilate 2), shutter 0.5 (180°), 24 fps, ProRes
  422 HQ 10-bit 4:2:2 chunks of 48 frames → 114 chunks, frames 0–5465, film hash 1c3edf71 (locked, 227.75 s),
  commit 0f0aa5b, dirty false, Chrome 154.0.8037.95 pinned). The designed final tier: subtle lens DOF on the 4
  close hero holds (Hobbiton f/11, Rivendell f/8, Argonath f/4, Mount Doom f/4, eased through the neighbouring
  moves: ≈ 97 s with a partly open lens, 36.5 s at full aperture in the holds), film grain, vegetation density 1,
  the finer terrain LOD. The approved review cut (review tier, spp 4) had no DOF.
- **Score:** v4 `renders/music/20261005-042554-v4-lock/master.wav` (48 kHz 24-bit stereo, exactly 227.750 s,
  −16.02 LUFS integrated, −1.79 dBTP), cue sheet `renders/music/cues-v2.json` (film hash 1c3edf71).
- **Reproduce:** cues `node --import tsx tools/check/film.ts --cues renders/music/cues-v2.json` → score `pnpm
  music --cues renders/music/cues-v2.json --label v4-lock` (uv; `data/music-src` ≈ 1.5 GB, fetched by `uv run
  --project tools/music python tools/music/fetch.py`) → picture: the `film-overnight.ps1` launch (Host and
  workflow) → `pnpm film --verify-resume --run <dir>` (with `MOME_CHROME` set) → `pnpm film --assemble --run
  <dir> --audio renders/music/20261005-042554-v4-lock/master.wav --mp4 <abs>.mp4 --master <abs>.mov`. Needs
  FFmpeg 8.x full build on PATH (or `MOME_FFMPEG` / `MOME_FFPROBE`) and ≈ 5 GB of ProRes chunks + 5 GB master +
  ≈ 0.5 GB mp4 of free disk, plus a temporary concat copy of the chunks while assembling.

## Static world locked for V1 (S4.5)
- **Lock:** `data/qa/lock-v1.json` = pixel sha256 of the 12 `lock-v1` sentinels (overviews day / night, shire,
  mordor, erebor / hobbiton / rivendell / argonath / lake-town close, minas-tirith-night, minas-morgul-beam,
  s4e-doom-fx) at 1600×900 spp 4 review tier, Chrome 154.0.8037.95, Intel driver 31.0.101.2145, code
  91993b3 (`dirty` = uncommitted docs only). Written from the full `s4` run `renders/qa/20261003-225000`
  (57 shots, KEEP); a fresh-process re-render (`20261003-225208`) verified 12/12 IDENTICAL; S6 on the pinned
  Chrome copy (`MOME_CHROME`): `renders/qa/20261005-180343` 12/12 IDENTICAL.
  Verify (with `MOME_CHROME` = the pinned copy, see Host and workflow — the installed Chrome is 154.0.8037.98
  since 2026-10-06): `pnpm qa --set lock-v1 --w 1600 --h 900 --spp 4 --batch 13` → `pnpm lock --verify <run>` (exit 0
  identical · 1 changed · 2 Chrome / driver differ, hashes advisory · 3 other settings).
- **Review stills:** `review/v1/` (24 stills, 4 day / night pairs, 4 S4 → V1 sheets) from
  `renders/qa/20261003-230100` (final 1920×1080 spp 12, KEEP); 14 of 24 are pixel-identical to the S4 stills.
- **README stills:** `docs/images/` (15 JPEGs, ≈ 2.3 MB) by `pnpm showcase` from `data/qa/showcase.json`. The
  hero `hero-golden-hour.jpg` is `overview-golden` (the day / night pair's overview camera at 18:20, 16:9; since
  S5) from the V1 review run, like the tiles and pairs; `renders/shots/20261003-231307` (KEEP) feeds
  `black-gate-wide`, the banner `film-placeholder.jpg` (weathertop-close) and `social-preview.jpg` (the 2.4:1
  `pano-golden-sw`, 3072×1280 spp 16, cropped to 2:1 and scaled to 1280×640); provenance and render hashes in
  `docs/images/manifest.json`.
- **Change control:** film or other work must leave locked frames bit-identical — run the lock verify after
  any change to shared systems (`src/` outside the film modules). A look change happens only on the user's
  request, with before / after renders, and ends with a re-lock (`lock-v2`, new KEEP runs, README stills
  re-encoded). After a Chrome or driver update, re-render the set on the locked code and re-write the lock
  before judging code. How a V2 starts: under "V2 candidates".
- **Accepted for V1:** the residuals under "V2 candidates" (no world-building unless the user asks).

## S6 log (2026-10-05 → 06) — final render and release
- **Inspection (read-only workflow):** agents audited release completeness, tracked-file hygiene and the local
  disk / host inventory without changing project files: the repo is lean (no dead tracked code, no doc path to a
  missing file); the findings fed the cleanup, the docs and the V2 list.
- **User decisions:** the 720p review cut is approved — no picture rework; all S6 polish candidates move to
  V2. Not done in V1 (no benefit to the film, risk to the lock): landmark build / AO in a worker, vegetation
  placement worker, compile-time work, the TitleSystem `anchorPoint` / `subjectVisible` export.
- **Cleanup (user-approved, done):** S5 iteration stills, the pre-lock animatic, the review cut's duplicate
  `video.mkv`, intermediate S5 lock-verify runs, the 30 score stem WAVs (regenerable; MIDI kept), Python caches,
  the S1–S4 historical QA baselines (`renders/qa` 20260929-215504, 20260930-092759, 20261001-174844,
  20261001-181521, 20261002-211200, 20261003-005500, 20261003-212112), host temp (loose agent scratch in
  `%TEMP%`, a stale VS Code installer, Remote Desktop diag logs, app crash dumps, `uv cache prune` 579 MB).
  C: free 28.3 → 31.1 GiB. After the release (user-approved): the final run's 114 ProRes chunks (5.2 GB, the
  master's video stream, verified by stream hash; their per-frame JSONs stay), the unused IM Fell fonts
  (`public/fonts`, CREDITS / README / `_manifest.json`), the 8 unused Poly Haven sources (folders, 40 manifest
  items, CREDITS rows) and the 218 direct image-file links in the two research briefs (article sources kept). The review cut's videos go once the final is verified (its `run.json` + per-frame
  `chunks/*.json` stay as provenance) — done after the final checked out, with the final-tier test stills.
- **Host prep:** Windows Update paused until 2026-10-12 (elevated, user-approved); power mode "Best
  performance" for the render, Balanced restored after the assemble; no sleep-setting change (the render holds a
  keep-awake request); the render runs in its own window (`film-overnight.ps1`), not in a Claude Code shell.
- **Tooling (0f0aa5b, unattended final render; contracts in ARCHITECTURE):** `MOME_CHROME` = a private copy of
  the locked Chrome 154.0.8037.95 (528 MB), so an auto-update cannot change pixels mid-render; `keepAwake()`;
  a resume refuses another Chrome, another film hash, a dirty tree or a commit that changes the render inputs
  (src, data, public, index.html, vite.config.ts, package.json, pnpm-lock.yaml, tools/capture; docs-only commits
  are fine), refusals exit 2; `--verify-resume --sample N`; `--assemble --mp4 --master` (master first, then the
  H.264 mp4, ≈ 33 min at 1080p); `film-overnight.ps1` (retries, keep-awake across attempts, `render.log`).
  Reviewed by two lenses + skeptics (13 confirmed findings fixed); end-to-end test on 2 s of film at the final
  tier (ProRes chunk, verify IDENTICAL, master, mp4).
- **Lock verify on the pinned Chrome:** `renders/qa/20261005-180343` 12/12 IDENTICAL.
- **Final-tier A/B:** 10 final-tier stills (deleted after the render: bit-identical to their film frames) vs
  the cut's frames: same framing, titles, route line and grade; slightly denser vegetation, smoother motion blur
  on the 0.5 s cliff rush (48 spp), only a subtle background softening. The user chose the designed final tier.
- **Render:** started 2026-10-05 18:43; ≈ 0.65 s per sub-sample at the test chunk (≈ 2.5× the review cut's 0.26 s:
  1080p, density 1, finer LOD, DOF, grain), ≈ 68.3 k sub-samples planned → ≈ 12–13 h estimated. Finished
  2026-10-06 05:48: wall 39,909 s = 11.1 h in one attempt (exit 0), 32 Chrome restarts (25-min cap), 68,328
  sub-samples (avg spp 12.50:
  12 × 5068 frames, 16 × 291, 24 × 93, 32 × 3, 48 × 11), 10.35 h of render time = 0.545 s per sub-sample (Best
  performance); 5.22 GB of ProRes chunks; the only near-black frames are the 15 of the fade-in / fade-out.
- **Verify / assemble:** `pnpm film --verify-resume --run <final run> --sample 12` 12/12 IDENTICAL (on the
  pinned Chrome); one Chrome version (154.0.8037.95) across all 114 chunks; the 10 final-tier test stills are
  bit-identical to their film frames (what was inspected is what the film holds); the assemble (own window,
  05:50 → 06:25: master < 1 min, x264 slow 32 min, the mp4 frame-count probe ≈ 2 min) checked 5466 frames in both files (ffprobe), 227.750 s video
  and audio; one frame per beat decoded from the mp4 looks right (contact sheet).
- **Perf:** `pnpm perf --gate` after the render (Balanced, AC): frame times within budget (overview 56.5 / shire
  47.1 / anduin-gondor 55.2 ms vs 56.1 / 45.8 / 52.7), compile OVER (5.5 s cold after the render, 2.1 s warm vs
  1.15 s). A rested interleaved A/B against a worktree of the baseline commit 7567962 (2 rounds each, same
  profile and world): base 61.2 / 48.5 / 54.1 ms, boot 22.8 s, compile 3.15 s · HEAD 58.9 / 52.2 / 54.2 ms, boot
  22.4 s, compile 2.10 s — no code regression (no `src/` change since the S5 lock anyway); the boot / compile
  excess is host state (the baseline commit measures 19–27 s / 2.2–4.1 s today). Baseline not re-saved:
  re-baseline rested on a fresh day in V2.
- **Release:** package.json 0.5.0 → 1.0.0 and `CHANGELOG.md` (new: v0.5.0 2026-10-03 "the static world,
  locked"; v1.0.0 2026-10-06 "the film") after the render (package.json is a render input); the README banner's
  subtitle (`data/qa/showcase.json` `film-placeholder`) via `pnpm showcase`; tag `v1.0.0` + GitHub release only
  after the user approves the push; the release attaches neither the film nor the score.

## Earlier sessions (condensed; contracts in `docs/ARCHITECTURE.md`)
**S5 (2026-10-04 → 05) — cinematic journey + music.**
- Built: the tour compiler + camera rig + film checks; RouteSystem + TitleSystem; film-only SceneState fields
  and the `?film=1` boot block; `pnpm film` (stills, chunked resumable sequences, adaptive motion-blur spp
  ladder, assemble); `tools/music` (uv; VSCO 2 CE CC0 samples + sfizz 1.2.3 render-time only, never shipped; the
  score as code in `journey.py`, original motifs, no imitation of Howard Shore; a GPL-free master). One compile
  path: the page passes the landmark build, so `pnpm check` gates the page's film.
- Decisions: the route line keeps its gold outside the grade (HDR-alpha coverage + `enableRouteKeep`; it went
  cream-white under Mordor at night); a one-sided LOD dissolve across the sub-samples (`lodBias` stays unset);
  picture lock with 0 errors; lock-v1 stayed 12/12 identical after every shared-code change.
- Film at picture lock: 33 beats, 227.75 s, route 1730.9 km; holds Hobbiton · Bree · Weathertop · Rivendell ·
  Moria · Lothlórien · Isengard · Helm's Deep · Edoras · Argonath · Black Gate · Henneth Annûn · Minas Tirith ·
  Minas Morgul · Mount Doom; tod 5.85 → 19.6 on dayOfYear 78.
- Review cut (approved in S6) `renders/film/review-1280x720-20261005-042737-review-cut`: 1280×720 review tier
  spp 4 + ladder `12:8,24:12,36:16`, 180° shutter, x264 crf 14, 57 chunks, commit e35a9ad, 18 calls of ≤ 9 min
  (≈ 2.4 h); 17 frames rendered as isolated stills match the cut bit for bit.
- Perf baseline `v1-static` (7567962, mains, preview 1280×720, median ms): overview-day 56.1 · shire 45.8 ·
  anduin-gondor 52.7 · minas-tirith-close 68.1 · mordor 48.3 · rivendell-close 51.5; boot 9.8 s (landmark
  build ≈ 3.1 s, vegetation init ≈ 1.1 s), compile 1.15 s. The S5-end compile 10–11 s was host state (the
  baseline commit measured 9.7 s in the same state: slow power regime + a churned shader cache).

**S4 / S4.5 (2026-10-01 → 03) — look + still effects, V1 static lock.**
- Built: ash deck / atmosphere / night / mist, terrain material, six vegetation archetypes + canopy shell,
  emission spill / gates / halos, water + reflection proxies, EffectsSystem (`tFx`), lens + grade, weathering,
  one hero-polish wave (G1 / G2); S4.5: driver re-baseline, small fixes, the lock, showcase stills, README /
  MIT LICENSE / CREDITS / CI (typecheck + check, data-free), `reference/` index untracked (143 copyrighted image
  URLs stay local and remain in git history), `v0.5.0` tagged and released.
- Numbers (the V2 baseline; the other S1–S4 run folders were deleted in S6, `critic-s4-final.json` survives
  in the KEEP run `renders/qa/20261003-010300`): blind paired S3 vs S4 **75 %** (gate 70 %), hero pauses 5/7
  (the Argonath lost: judges preferred S3's rough rock plinths); film-look **2.35 / 4** (S3 1.80; gate 3.0 ✗),
  toy votes 21/30, lowest Hobbiton 1.67 / Lake-town 1.83, best Minas Tirith / Argonath 2.83; recognizability
  24/24; wide locatability 14/14; night emission 4/6. Intel driver 31.0.101.2145 was pixel-neutral for
  unchanged code; cross-process hashes 26/26 identical (reordered, rebatched). S4.5 tried and reverted:
  far-plume haze height (no visible effect), the Morgul mist card (it is also the hero's gate veil), wider Doom
  flows.

**S1–S3:** bake v2 geography and water; RegionLook grade, regional haze, cloud shadows, studio backdrop;
landmark platform (kit v2, families v2, stamps v2, EmissionSystem, landmark trees / forests, pools, Blender GLB
pipeline: the Argonath); shot list v0; 34 bookmarks (24 `-close` + 10 `-wide`) meeting their probe gates.

## Baselines (KEEP)
`renders/qa/20261003-225000` (V1 lock, set `s4`, 57 shots) · `20261003-225208` (lock fresh-process verify) ·
`20261003-230100` (V1 review stills, final 1920×1080 spp 12; source of `review/v1` and `docs/images`) ·
`20261003-010300` (S4 review stills = the "before" of `data/qa/review-v1.json`) · `renders/qa/20261005-180343`
(S6 lock verify on the pinned Chrome: 12/12 IDENTICAL) · `renders/shots/20261003-231307` (showcase "hero" run:
black-gate-wide, the banner, the social preview) · `review/v1` · `renders/music/20261005-042554-v4-lock`
(master.wav, report.json, spectrogram.png, stems/*.mid) +
`renders/music/cues-v2.json` (the cue sheet of film hash 1c3edf71) · the final run folder
`renders/film/final-1920x1080-20261005-184304-final-1080p` (run.json, render.log, assemble.log, per-frame chunk
JSONs; its ProRes chunks were deleted after the assemble — the master holds the same stream) · the review cut's
`run.json` +
`chunks/*.json` (per-frame sha256 / ms / spp / motion) · `data/baked-s1` · all source data.

## Roadmap (6 sessions)
| # | Session | Scope | Status |
|---|---|---|---|
| 1 | Foundation & Geography | world, data, systems v1, proxies, capture/QA | ✅ |
| 2 | World look | host hygiene + bounded QA, bake v2, atmosphere + RegionLook, terrain look v2, vegetation look | ✅ |
| 3 | Landmarks (all 24) | shot list v0, kit v2 + families v2, stamps v2, emission, landmark trees / forests, Blender spike (GO: Argonath), all 24 rebuilt and gated | ✅ |
| 4 | Look + still effects | ash deck / atmosphere / night / mist, terrain material, vegetation archetypes + canopy shell, emission spill / gates / halos, water + reflection proxies, EffectsSystem, lens + grade, weathering, one hero-polish wave, review stills | ✅ (film-look gate open: 2.35 / 3.0) |
| 4.5 | Static finalization + repo polish | driver re-baseline, small fixes, V1 lock (`lock-v1.json`, `review/v1`), showcase stills, README / LICENSE / CI, cleanup | ✅ (`v0.5.0`) |
| 5 | Cinematic journey + music | tour compiler + rig, route v2 + route line, titles, `pnpm film` (stills, chunked sequences, adaptive motion blur), motion fixes, picture lock, original score (`pnpm music`), 720p review cut | ✅ |
| 6 | Final render & release | review cut approved, cleanup, unattended render tooling (pinned Chrome, keep-awake, overnight wrapper), final-tier 1080p24 render (ProRes master + H.264), score mux, `v1.0.0` | ✅ (perf workers and the film's publication → V2) |

## V2 candidates (not scheduled)
**How a V2 starts:** unlock under change control. Static world: a look change only on the user's request, with
before / after renders, ending in `lock-v2` (new KEEP runs, README stills re-encoded). Picture: unlock =
`data/tour/timeline.json` `status: draft` (any timeline edit, its notes included, changes the film hash), then
re-export the cue sheet, re-render the score and re-render the film. Re-baseline perf rested on the day.
- **Film polish (S5 critics; deferred when the user approved the cut):** fade the travelled route with distance
  behind the head (far stripes at Minas Tirith / to-minas-morgul), cap the near-path width (~10–12 px), midday
  line legibility; the Minas Tirith hold darker than the old az-128 keeper; the Helm's Deep / Rivendell hairpins
  and the overview zig-zag; the first ~1.5 s of to-minas-tirith nearly static; Mount Doom dark (luma 19); the
  brightness drop entering Mordor; the 0.5 s cliff rush before the Argonath (accepted); a smoothed shadow reach
  (`shadowFocus`) for the descent's far-hill fade; the Argonath water-edge flicker (also in stills); LOD dissolve
  steps in a few holds (Bree); export TitleSystem `anchorPoint` / `subjectVisible` as pure layout functions (the
  check reaches the private methods through a cast).
- **Perf:** landmark build / AO in a worker (`buildLandmarks()` runs on the main thread at boot, ≈ 3.1 s of the
  9.8 s; the same build runs in Node for the gates, and a change to vertex order or float accumulation breaks the
  lock), vegetation placement in a worker (≈ 1.1 s), compile time. Gains the explorer's preview boot only, not
  the offline film; prove with rested interleaved A/B runs against a frozen worktree.
- **Film look:** the film-look gate (2.35 / 3.0) stays open. Toy reads: kit architecture without secondary
  detail (smial plaques, Rivendell gable boxes, the Morannon "toy fort", Lake-town blocks), effects / emission
  built as clean strips (lava tubes, fall ribbons, ithildin vectors), faceted foreground rock, blob trees.
- **Accepted residuals (V1; change only on the user's request).** Heroes: far Doom plume dark over the Black
  Gate / a brown smear in anduin-gondor (puff lighting under the deck, not haze height); Hobbiton bank shelf,
  segmented lanes, bar hedges, no pond mirror; Lake-town close half hillside, lamps without facade spill; Black
  Gate wall short and box-like, smooth foreground butte; Doom flows thin at 50 km (the lane cap is the lever),
  straight flanks, preview flow gaps; Minas Tirith prow on the dark side, apron foreshortened, Mindolluin out of
  the close frame; Minas Morgul merging with its cliff, an edge-on mist card in the wide (also the hero's gate
  veil); Erebor a centred pyramid at 62 km; Rauros a pale block, Tol Brandir columnar; faceted rock at Moria; the
  Argonath GLB at ~76k of the 80k budget. Shared: settlement windows outside the top-N spill set do not light
  facades; mist-card look (#20); steep-face vertical smear on stamped walls (Morgulduin, Rivendell); Rivendell's
  occlusion gate is very sensitive to scarp roughness; Shire field patchwork contrast (S3 preferred); daytime
  torch floor 0.25; the probe's subject box includes raising stamps. Bake (a re-bake needs the user's explicit
  OK): 98 torrent step cells (warning); stream-36 22 km source trim; Entwash / Forest River confluence pools;
  marsh fills ≈ 271 km² > 0.5.
- **Publishing:** the film once the ME-GIS / Arda / ME-DEM authors give permission (README embed: the film
  block's comment in `README.md`; upload from the ProRes master).
- **Host:** move the checkout to `C:\dev\MAP` (shorter paths, outside Desktop / OneDrive churn) — ask.
- **Repo hygiene (S6 tracked-files audit; none affects the film or lock-v1):**
  - Cinzel Decorative and EB Garamond italic are registered by `src/titles/fonts.ts` but never drawn by the
    film (the unused IM Fell fonts were removed in S6).
  - `data/tour/timeline.json` notes still say "(S5 draft)" — editing them changes the film hash (only with a
    picture unlock).
  - Hero-camera copy drift in `data/qa/shots.d` (QA-only; fix with a pixel-hash proof): `w1a-doom-night` uses the
    synced mount-doom-close camera but lacks `lookOverride: mordor` and `fStop: 4`; `g2-doom-night` lacks
    `lookOverride: mordor`; `s4e-riv-fx` lacks `fStop: 8`; the `lm-w3e` / `lm-w5j` copies (`w3e-barad-night`,
    `w5j-bg-night`, `w5j-mm-day`, `w5j-riv-dusk`) are in no set and lack their bookmark's look / fStop — fix or
    drop.
  - `data/textures-src` keeps the `rough` / `ao` maps of the six used Poly Haven sources although
    `tools/textures/prep.mjs` reads only `diffuse` / `nor_gl` / `disp` (the 8 unused sources were removed in S6).
  - `.claude/worktrees` (gitignored): `s5-env.sh` (exports `MOME_CHROME` since S6) + `briefs/s5-*.md` are the
    agent template; the S4 / S4.5 briefs are kept as the only written visual-critic / blind A/B / hero-polish
    protocols (for a V2 look wave); `s4-env.sh` / `s45-env.sh` are older copies of `s5-env.sh`.

## Decisions (stable)
- **Presentation and film:** floating diorama slab; film 3–4 min (picture lock 227.75 s), 16:9, 1080p24 with a
  180° shutter; a west → east grand tour via Rohan loosely on Frodo's road (user, S5), one day of light
  (dawn in the Shire → moonlit Mordor), gold route line, floating labels, title / end cards; review cut 720p
  in S5 (approved, S6), final 1080p24 in S6 at the designed final tier (subtle DOF on the 4 close hero holds,
  grain; user, S6). Score: orchestral samples (CC0), original, rendered by `pnpm music`.
- **Rendering:** WebGPU + TSL (three 0.186.1), reversed-Z, deterministic `SceneState` (incl. `weather`,
  `events`, `tFx`); quality tiers preview / review / final — preview drops the review / final graph parts
  (`atmosphere.full`, terrain `preview`, `structureTier.full`, cumulus, halos, reflection proxies).
- **Geography:** ME-GIS canon vectors + Arda DEM; river centrelines snapped to the DEM thalweg; display
  offsets validator-checked. **The world frame stays.**
- **Look:** wide shots read as a crisp physical model; regional/mid shots carry aerial depth; Mordor is
  charcoal under an ash pall with red only near Doom; lens = subtle DOF on close heroes only (no tilt-shift).
- **Landmarks:** one fixed design scale each; readability from silhouette, contrast and emission; TS kit v2
  by default, Blender GLBs only where a blind A/B beats the kit (Argonath); landmarks declare (lights,
  emitters, falls, reflectors, treeCaps, flows), systems realize. Detail budgets target the 15–60 km mid band
  (the film's screen-time mix lives in `data/tour/shotlist.json`).
- **Repo:** public; push only after user approval; raw CC0 texture sources in `data/textures-src`
  (gitignored), derived layers in `public/textures/terrain` (gitignored, credited); GLBs in `public/models`
  are original, generated by `tools/blender` (credited); `review/`, `renders/` and `final/` are gitignored.
- **Licence and stills (user, S4.5):** code and original models MIT (`LICENSE`, earthwalker17); the README
  shows the project's own renders (`docs/images/`: not MIT, no reuse licence granted; `docs/images/README.md`) with
  prominent ME-DEM / ME-GIS / Arda credit; source and baked data never committed; permission from the data
  authors is needed before the film or any derived data is published.
- **Film files (user, S6):** the film and its score stay local (`final/`, the score run); the README keeps the
  film placeholder and releases attach neither until permission arrives.

## Host and workflow (Surface Laptop Go, i5-1035G1, 7.6 GB RAM shared with the iGPU)
- **Session start:** `pnpm host --fix` (approved: stop windowless Edge / WPS / OneDrive / Teams / Phone Link /
  PC Manager, keep their autostart disabled). Idle ≈ 3.3–3.6 GB available.
- **Host:** Defender folder exclusions for the project, pnpm store, the app cache, ms-playwright,
  `%TEMP%\claude`, `%TEMP%\tsx-A` and `~/.claude/projects`; fixed pagefile 8–16 GB; Intel driver
  31.0.101.2145 (installed after S4; pixel-neutral for unchanged code). Windows Update paused until 2026-10-12
  (S6, for the render). Power mode "Best performance" for long renders, Balanced otherwise and for perf runs; no
  sleep-setting changes — `pnpm film --render` holds a keep-awake request (closing the lid still sleeps).
- **Pinned Chrome:** `%LOCALAPPDATA%\map-of-middle-earth\chrome-154.0.8037.95\` is the locked Chrome; set
  `MOME_CHROME` to its `chrome.exe` for film renders, resumes, verifies and lock checks (the installed Chrome
  auto-updated to 154.0.8037.98 on 2026-10-06 05:58, ten minutes after the render: without `MOME_CHROME` a lock
  check reports exit 2 "Chrome differs" and a film resume refuses).
- **One heavy job at a time; captures in the FOREGROUND** (≤ 10 min per call: split with `qa --only`). The
  background-shell reaper kills Claude Code's background shells when RAM is low (also during a render): watch
  long jobs with short foreground polls. The 57-shot `s4` set at 1600×900 spp 4 takes ≈ 6.5 min (two calls of
  ~3 min), 24 final-tier stills at 1920×1080 spp 12 ≈ 7 min (two calls), a 3072×1280 spp 16 hero ≈ 1 min.
  Merged runs: copy the parts' shots + renumbered manifests into one stamped folder (`pnpm lock` / `pnpm
  showcase` read `manifest(-N).json`). In PowerShell quote `--only "a,b,c"` (an unquoted comma list becomes an
  array → "0/1 shots").
- **Long renders (hours) run in their own window** via `tools/capture/film-overnight.ps1`, never in a Claude
  Code shell:
  `Start-Process pwsh -ArgumentList '-NoExit','-File','tools\capture\film-overnight.ps1','-Run','renders\film\<dir>','-Chrome',"$env:LOCALAPPDATA\map-of-middle-earth\chrome-154.0.8037.95\chrome.exe",'-FilmArgs:"--tier final --spp 12 --spp-ladder 36:16,48:24,72:32,96:48 --shutter 0.5 --label final-1080p"'`
  (`-FilmArgs` only matters for a new run: on resume `run.json` wins). Commit nothing that touches the render
  inputs until the run is assembled.
- **Perf:** the iGPU shares the package power with the CPU and the laptop has a slow and a fast regime
  (~1.7× apart; it can run on battery under load even when plugged in). `pnpm perf` waits for a quiet host
  and records `noise`; compare only rested (90 s) interleaved A/B runs against a frozen worktree of the
  other code, never against a baseline from another day.
- **Agents (S3–S5 pattern):** one Workflow per wave, ≤ 2 implementation agents in pre-created worktrees
  (`source .claude/worktrees/s5-env.sh`; protocol `briefs/s5-common.md`), each followed by a read-only reviewer
  ‖ visual critic, then one fix round; the main agent views every render, merges `--no-ff` (sets.json conflicts
  via a line-key union), keeps `pnpm check` green.
- **Cleanup:** `git worktree remove --force` leaves the folder on MSYS ("Directory not empty") — delete it
  from PowerShell `Remove-Item -LiteralPath <path> -Recurse -Force`; never `rm -rf` (pnpm junctions).
  `pnpm host --prune` lists only `dist/` and old `renders/qa` / `renders/shots` runs (it keeps the newest and
  any folder with a `KEEP` file; `--yes` deletes) and never touches `renders/film` or `renders/music`: bigger
  cleanups need explicit per-path deletes.

## Learned gotchas (r186 / this machine)
- **TSL:** `vec3(new Color())` silently yields black — use `color(c)`; an `int(x)` uniformArray index must be
  `.toVar()`; `meta` / `time` are reserved WGSL words; assign inside `If` blocks to `.toVar()` nodes only.
- **TSL (S5):** `select()` in a vertex graph builds shared sub-expressions inside its first branch only — use
  step / mix in vertex stages. Additive blending in three's WebGPU backend ADDS alpha (One, One); opaque node
  materials force alpha 1 — a film-only mask in the HDR alpha needs a `min` alpha blend (route keep).
- **Film (S5):** the grade is non-linear in hue (warm / red / glow masks): no pre-compensation keeps a graphic
  colour through every region look — keep it out of the grade instead. `pnpm film` budgets over-plan high-spp
  chunks (per-frame overhead counted per sub-sample): expect 2–3 chunks per 9-min call at 720p. The music
  cue loader reads moves too (`hold` or `move` ids) and pass captions inside moves.
- **Film (S6):** the final tier costs ≈ 2× the review tier per sub-sample at 1080p (0.545 vs 0.257 s averaged over
  the two films' chunk JSONs, ≈ 0.65 s on the first test chunk: resolution,
  vegetation density 1, finer LOD, DOF, grain). DOF needs a base spp ≥ 8 (`LENS_MIN_SPP`), so base spp 4 renders
  the review cut's pinhole; `--spp` must sit below every ladder step. The "(nearly) black" warnings on frames 0–7
  and 5459–5465 are the fade-in / fade-out.
- **PowerShell / Windows (S6):** PowerShell reads `0x80000001` as a negative Int32 — pass
  `SetThreadExecutionState` flags as a decimal (2147483649); `Start-Process` joins `-ArgumentList` unquoted —
  colon-bind a multi-word argument (`-FilmArgs:"…"`); `"$var:"` inside a string is a drive-qualified variable —
  write `${var}`; pass a commit message via a file (`git commit -F <file>`), not a here-string argument.
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

## Open issues / notes (user actions)
- **Permission notes** to the ME-GIS (jvangeld / andrewheiss), Arda (bburns, tetrakai1) and ME-DEM (Outerra
  forum) authors; then **publishing the film** after permission (README embed, see V2 candidates).
- **Social preview:** upload `docs/images/social-preview.jpg` in GitHub Settings → Social preview (still unset).
- **Back up the film:** `final/` (5.8 GB) and the score master (`renders/music/20261005-042554-v4-lock/master.wav`
  + `renders/music/cues-v2.json`) exist only on this laptop — copy them to private storage (not public).
- **Windows Update** is paused until 2026-10-12 (for the render); resume it any time. After an Intel driver
  update, re-render lock-v1 (with `MOME_CHROME`) on the locked code and re-write the lock before judging code.
- **Approve the push / tag / release** (`v1.0.0`; the release attaches neither the film nor the score). The `gh`
  token lacks the `workflow` scope, but git's stored credential has it: workflow-file pushes work; `gh` cannot
  edit workflows.
