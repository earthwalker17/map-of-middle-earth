# Project state — Map of Middle-Earth

_Rolling document: roadmap, current state, decisions, next steps. Keep it compact; replace stale detail
instead of appending logs._

**Last updated:** 2026-10-01 · end of Session 3 (Landmarks) — push pending user approval

## Where we are
**S1, S2 and S3 are complete.** The world renders deterministically on the Intel UHD iGPU with the S2 look
and all 24 landmarks rebuilt for the film (S3).

**World (S1–S2):** bake v2 geography and water (river DAG with monotone levels snapped to the DEM valleys,
lakes with deltas/lips, three-band relief de-spike, river guard); distance-ramped aerial perspective,
RegionLook grade, regional haze, cloud shadows, studio backdrop, moonlit night; baked ground look with
organic ecotones, curvature/AO rock, snow v2, Shire fields, wetlands, CC0 detail layers; 7-sub-crown
vegetation clusters with per-instance LOD and a barren rule.

**Landmarks (S3):**
- **Platform:** one pure build run (`buildLandmarks` → geometry LODs, world-space lights / trees / forests /
  pools, contacts, bounds); kit v2 (house, wallPath, tower, lathe, extrude, loft, cliff, rock, scatter,
  arcade, bridge, stairs + light / windows / tree records, automatic LODs, seating); families v2 (two uber
  materials, packed per-vertex presets, vertex AO, specular ambient); projected-px LOD; stamps v2 (ridge,
  scarp, massif, basin, rough, surface, snow caps); EmissionSystem (one instanced sprite draw, gates,
  halos, settlement aggregation, focal embers, glowKeep); authored hero trees + landmark `forests`; pools;
  Blender GLB pipeline (`pnpm models`, used for the Argonath kings).
- **All 24 landmarks at shot-list status s3** (budgets, seating, framing gates strict): 504k LOD0 tris,
  40.8 MB, 917 lights, 246 authored trees, ≈11k forest tree records, 34 bookmarks (24 `-close` heroes +
  10 `-wide` contexts) all meeting their probe framing gates.
- **Shot list v0** (`data/tour/shotlist.json`): film draft 204 s in 16 segments, per landmark role, hero /
  context framing, tod and detail budget — the seed of the S4 timeline.

**S3 validation** (final QA `renders/qa/20261001-174844`, critic-s3-final.json; 1600×900 spp 4; vision
critics on anonymised images, keys decoded in code):
- **Blind paired S2 vs S3** (S2 code rendering the exact S3 cameras, 45 pairs × 3 judges): S3 wins
  **86.7 %** (gate 70 %), **7/7 hero pauses**. S2 kept anduin-gondor (Minas Tirith hidden — reframed after),
  moria-wide, shire (warm grade spot — neutralised after) and two overviews (S2's size-boosted Doom disc /
  white Minas Tirith disc were stronger focal points; S3 now adds focal lava / Eye embers).
- **Blind recognizability:** **24/24** landmarks top-1 by ≥ 2 of 3 critics (tier A 14/14, tier B 10/10).
- **Night emission** 5/6 read as lights; **wide locatability** 10/14 (Moria, Argonath, Minas Morgul,
  Barad-dûr not locatable in overviews — specks by policy).
- **Film-look** hero mean **1.8 / 4** (gate 3.0) with 15 toy votes — FAIL, driven by shared systems; the
  user decided S3 stays landmarks-only and these open S4 (ranked below).
- **Hero checkpoint** (after W3, `renders/qa/20261001-091745`): 21/21 blind top-1; no Blender follow-up
  triggered.
- **Perf** (preview 1280×720; same-session interleaved A/B with the S2 code; ±30 % thermal noise): frame
  time within ~10–15 % of S2, compile ~20 % faster (6.0 s quiet), boot +3 s (landmark build + AO). New
  baseline `data/qa/perf-baseline.json` label s3: overview 56.9 / shire 54.4 / anduin-gondor 61.4 (new
  camera) / minas-tirith-close 135.5 ms.
- **Checks:** typecheck; `pnpm check` (incl. landmark + bookmark gates) OK; determinism IDENTICAL on
  Lórien at night (emission + trees), Argonath (GLB) and Minas Tirith; `pnpm models --verify` identical;
  `pnpm build` OK.

**Baselines (KEEP):** `renders/qa/20260929-215504` (S1 final) · `renders/qa/20260930-092759` (S2 final) ·
`renders/qa/20261001-091745` (S3 hero checkpoint) · `renders/qa/20261001-174844` (S3 final) ·
`data/baked-s1` (frozen S1 bake).

## Roadmap (6 sessions)
| # | Session | Scope | Status |
|---|---|---|---|
| 1 | Foundation & Geography | world, data, systems v1, proxies, capture/QA | ✅ |
| 2 | World look | host hygiene + bounded QA, bake v2, atmosphere + RegionLook, terrain look v2, vegetation look | ✅ |
| 3 | Landmarks (all 24) | shot list v0, kit v2 + families v2, stamps v2, emission, landmark trees / forests, Blender spike (GO: Argonath), all 24 rebuilt and gated | ✅ |
| 4 | Previz, living world, polish | **First the S4 priorities below** (Mordor sky / ash deck, emission lighting surfaces, vegetation archetypes, terrain material, atmosphere / mist / night, water + effects). Then tour timeline v0 + low-res animatic from the shot list; EffectsSystem (waterfalls, plumes, lava glow, Eye, beacons via `EmissionSystem.setDynamic`, Morgul beam, mist), visible clouds, water motion, luminous route line, labels, DOF/miniature lens, second shadow cascade; parallel CPU music-toolchain spike | **next** |
| 5 | Cinematic journey + music | Final camera work, title cards, transitions; lock timeline → original score | — |
| 6 | Performance, final polish, render & release | Landmark build / AO in a worker, vegetation placement worker, CPU mask drop, compile time; final 1080p24 render (resumable, overnight, user-started); encode; README/CREDITS; ME-GIS/Arda permission | — |

## S4 priorities (from the S3 critics; shared systems, ranked)
1. **Mordor / Dagorlad sky and ash deck:** `env.skyTint` only multiplies the clear sky and fades out below
   ~14°; add a region-driven overcast ash deck (cloud coverage / colour per looks.json), red underglow toward
   Doom, heavier Mordor haze so the outer world disappears from the Doom / Gate frames.
2. **Emission lights its surroundings:** a deterministic surface-irradiance term from the brightest light
   records in the shared families + terrain (lava, Morgul wall-wash, windows, ithildin), volumetric halos in
   the in-scatter for strong kinds (no crater "sun disc"), emission reflected in water.
3. **Vegetation archetypes and scale:** asymmetric multi-lobed broadleaf, pointed conifer and holly crowns,
   hedgerows and copses, scale spread, a merged canopy shell beyond ~30 km (crowns read as lollipops at
   10–20× real size), per-landmark tree-height caps.
4. **Terrain material:** triplanar rock with strata on steep slopes (no vertical smear), grass breakup (no
   felt / clay), cracked ash crust + basalt instead of Mordor dune ripples; audit ground albedo (the mordor /
   dagorlad spots render as sand / beige).
5. **Atmosphere and night:** stronger aerial perspective beyond ~40 km, valley mist (Sirannon, Rivendell,
   Anduin, Morgul vale), cloud caps; a moon key light and fewer stars at night.
6. **Water and effects:** waterfalls (ribbons, plunge pools, spray), reflection-miss fallback (black holes by
   the Argonath plinths), banks without levee lips, readable plumes (Doom), the Morgul beam; Lake-town's
   Long Lake reads as a river in places.

## Decisions (stable)
- **Presentation and film:** floating diorama slab; film 3–4 min (shot-list draft 204 s), 16:9, 1080p24 with
  a 180° shutter; hero pauses Hobbiton, Rivendell, Moria, Argonath, Black Gate, Minas Morgul, Mount Doom;
  prologue Erebor / Lake-town / Dale; epilogue Grey Havens.
- **Rendering:** WebGPU + TSL (three 0.186.1), reversed-Z, deterministic `SceneState` (incl. `weather`).
- **Geography:** ME-GIS canon vectors + Arda DEM; river centrelines snapped to the DEM thalweg; display
  offsets validator-checked. **The world frame stays** (no south extension; closed at S3 start).
- **Look:** wide shots read as a crisp physical model; regional/mid shots carry aerial depth; Mordor is
  charcoal with red only near Doom.
- **Landmarks:** one fixed design scale each (no distance size boosts); readability from terrain silhouette,
  contrast and emission; TS kit v2 by default, Blender GLBs only where a blind A/B beats the kit (Argonath);
  masses of trees as `forests`, individuals as `trees`; landmark lights through EmissionSystem; a landmark is
  done at shot-list `status: s3` with its gates passing.
- **S3 scope (user, 2026-10-01):** landmarks only; shared-system look issues found by the S3 critics open S4.
- **Repo:** public, code only; push only after user approval; raw CC0 texture sources in `data/textures-src`
  (gitignored), derived layers in `public/textures/terrain` (gitignored, credited); GLBs in `public/models`
  are original, generated by `tools/blender` (credited).

## Host and workflow (Surface Laptop Go, 7.6 GB RAM shared with the iGPU)
- **Session start:** `pnpm host --fix` (the user approved stopping windowless Edge / WPS / OneDrive / Teams /
  Phone Link / PC Manager and keeping their autostart disabled). Idle ≈ 3.3–3.6 GB available.
- **One heavy job at a time:** capture, bake, build and Blender share the lock behind a free-RAM guard; a
  capture batch ≈ 1.3–1.8 GB; Node world loads (check / probe) wait for 1 GB. Iterate at 1280×720 spp 2;
  milestone QA `pnpm qa --set s3 --batch 8` (45 shots, 1600×900 spp 4, ≈ 40 min).
- **Agents (S3 pattern, worked well):** per wave one Workflow with ≤ 2 implementation agents in pre-created
  worktrees (`git worktree add -b s3/<slot> .claude/worktrees/s3-<slot> main`, `pnpm install --prefer-offline`,
  copy `public/textures/terrain`, `source .claude/worktrees/s3-env.sh` for MOME_WORLD_DIR / SOURCE_DIR /
  CHROME_PROFILE / REFERENCE_DIR), each followed by a read-only code reviewer and a visual critic, then one
  fix round; the main agent views every render, merges with `--no-ff`, keeps main's `pnpm check` green.
  Briefs live in `.claude/worktrees/briefs/` (common.md, platform.md + per-slot).
- **Cleanup:** `pnpm host --prune` lists (then `--yes` deletes) regenerable outputs, keeping KEEP runs; remove
  worktrees with `git worktree remove --force`, then from PowerShell `cmd /c rmdir /s /q <path>` (Git Bash
  mangles `/s /q`; never `rm -rf`, which can follow pnpm junctions).

## Camera-distance census (seed of the shot list)
wide (> 300 km) ~15 % · regional (60–300 km) ~50 % · mid (15–60 km) ~30 % · close (< 15 km) ~5 % of screen
time. Landmark detail budgets target 15–60 km.

## Known residuals (fix opportunistically)
**Landmarks (S3):**
- Edoras is small against the White Mountains in its hero frame; Cirith Ungol's night hero is very dark;
  Henneth Annûn reads weakly; Minas Morgul's green is too saturated by day (its hero is at night).
- Minas Tirith is still a fairly regular stepped cone (prow subtle); Erebor a steep "witch-hat" massif;
  Lake-town's hero is dark at dusk; Grey Havens' framing crags are heavy; Rauros' Tol Brandir columnar.
- Daytime torches: the fire / dusk gate keeps a 0.25 floor by day (Helm's Deep torches at 8:00).
- Boot +3 s: the landmark build + vertex AO (≈ 1.2–1.8 s) exceed the 0.4 s AO budget → worker in S6.
- The probe's subject box includes raising stamps (ridges) — visibility can read low for walled sites.
- Rivendell's shallow stream reads as a dry bed (shallow-water absorption); the hard-stepped water at the
  Bywater pool junction predates S3.

**Bake:** 98 torrent step cells (warning); stream-17 not joined to the Celos, stream-36 22 km source trim;
Entwash / Forest River confluence pools (≤ 4.2 deep); marsh fills ≈ 271 km² > 0.5; geometry treeline (23) vs
vegetation (22).

**Look / shaders:** grey-blue smear over the Brown Lands in overviews; sea banding at overview-top; backlit
Mirkwood very dark; triplanar normal sign swizzle; possible hard-layer seam very close; valley-mist y < 28
cutoff; ~100 MB transient init heap.

## Learned gotchas (r186 / this machine)
- **TSL:** `vec3(new Color())` silently yields black — use `color(c)` (a Color *uniform* in `vec3()` is
  fine); an `int(x)` uniformArray index must be `.toVar()`; `meta` / `time` are reserved WGSL words.
- **WebGPU:** at most 8 vertex buffers per draw (vegetation uses 7, emission 5, landmarks 4).
- **No environment map:** metals and glossy dark stone go black in shade without the families' specular
  ambient; keep it if materials change.
- **Capture:** readback only; warm-up frame; NoColorSpace readback; Chrome honours only the last
  `--disable-features`.
- **Host:** Claude Code's background watchdog kills process trees on low RAM (Chrome children orphan) —
  foreground batches, guard before the lock. Perf is thermally noisy (±30 %+ after long GPU work, and
  agents decoding images inflate it): interleave A/B and record baselines on a quiet machine.
- **Tooling:** Bash heredocs can mangle backslashes — write code with the file tools; Python edits must use
  `newline=''` (eol=lf); tsx scripts outside the project need `.mts` and `file:///` imports.
- **Worktrees / merges:** one line per landmark in shotlist.json / looks.json still conflicts when two agents
  edit adjacent lines — resolve by line key; workflow agents can die on API errors after committing — check
  the branch, merge main in, resume with a short brief.
- **Bookmarks and stamps:** pass `OrbitSpec.lift` / `aimKm` through; cone / massif profiles apply to the
  height above the base; the river guard clamps stamps to natural banks; the forest slope limit must allow
  steep flanks (relief ×12).
- **Critics:** keep answer keys outside the folders critics read and decode verdicts in code, not in an LLM
  synthesis; blind pairs via `tools/capture/pair.ts`, cameras via `tools/capture/exportCameras.ts`.
- **Data:** ME-DEM sea level = 16 grey levels; heights ship as raw u16; the Arda DEM has a straight submarine
  ridge west of the Gulf of Lune (`vertical.seaArtefacts`).

## Open issues / notes
- Optional user action: update the Intel UHD driver (current 31.0.101.2125, 2023). Not required.
- Ask the ME-GIS / Arda authors for permission before publishing the film.
