/**
 * Baked-world validators (no GPU), run by `pnpm check` when a bake exists (MOME_WORLD_DIR or data/baked):
 *  - rivers.json v2: per-point level/bed, levels monotone non-increasing downstream except at declared
 *    falls (tolerance 1e-3), `into` resolves to a line id or a lake key
 *  - "rivers win": no landmark stamp moves a river-channel or lake cell unless it lies in an onRiver
 *    allowlisted landmark's footprint (places.json)
 *  - stamp loss: per landmark, the share of its stamp volume the river guard takes back (error above
 *    LOSS_SHARE / LOSS_MIN: the landmark sits on the water — move it, reshape it or allowlist it)
 *  - hydro report (report.json from the bake): ground raised / lowered against the relief outside the
 *    channel cores (with the declared marsh / lake allowances), ribbon edges above the ground, new
 *    cliffs outside declared gorges / falls, confluence joins (see checkHydroReport)
 *  - onRiver only on landmark places
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LandmarkDefinition } from '../../src/landmarks/types.ts';
import type { LakePoly, RiverLine, World } from '../../src/world/World.ts';
import type { BakedManifest } from '../../src/world/WorldSpec.ts';
import { loadWorld, readManifest, readMaskChannel, ROOT } from './baked.ts';

export const LEVEL_TOL = 1e-3;

export interface CheckResult {
  errors: string[];
  warnings: string[];
  info: string[];
}

export function checkRiverLevels(rivers: RiverLine[], lakes: LakePoly[]): CheckResult {
  const r: CheckResult = { errors: [], warnings: [], info: [] };
  const ids = new Set(rivers.map((l) => l.id).filter(Boolean));
  const lakeKeys = new Set(lakes.map((l) => l.key));
  let v2 = 0;
  let rises = 0;
  let fallCount = 0;
  for (const l of rivers) {
    if (!l.level) continue;
    v2++;
    const name = l.id ?? l.name ?? 'river';
    if (l.level.length !== l.points.length || (l.bed && l.bed.length !== l.points.length)) {
      r.errors.push(`rivers: ${name} level/bed length ≠ points`);
      continue;
    }
    const falls = new Set((l.falls ?? []).map((f) => f.index));
    fallCount += falls.size;
    for (let i = 0; i + 1 < l.level.length; i++) {
      if (falls.has(i)) continue;
      if (l.level[i + 1] > l.level[i] + LEVEL_TOL) {
        rises++;
        if (rises <= 8) r.errors.push(`rivers: ${name} level rises downstream at point ${i} (${l.level[i].toFixed(4)} → ${l.level[i + 1].toFixed(4)})`);
      }
    }
    if (l.bed && l.bed.some((b, i) => b > l.level![i] + LEVEL_TOL)) r.errors.push(`rivers: ${name} bed above the water level`);
    if (l.into && !ids.has(l.into) && !lakeKeys.has(l.into)) r.errors.push(`rivers: ${name} drains into unknown '${l.into}'`);
  }
  if (rises > 8) r.errors.push(`rivers: … ${rises - 8} more rising points`);
  if (v2 === 0) r.warnings.push('rivers: v1 bake (no baked levels) — monotone check skipped');
  else r.info.push(`rivers: ${v2} lines with baked levels, monotone except at ${fallCount} declared fall(s)`);
  return r;
}

/**
 * Continuation nodes (a line carried on by the next one: Langwell → Anduin, Ciril-1 → Ciril-2): the main
 * feeder must end exactly where its continuation starts (≤ CONT_GAP_KM) and at its first level — one node,
 * never a stub of the continuation upstream of the junction. The topology comes from report.json
 * `continuations`; the gap and the level step are measured on rivers.json itself.
 */
export const CONT_GAP_KM = 0.05;

export function checkContinuations(dir: string, rivers: RiverLine[]): CheckResult {
  const r: CheckResult = { errors: [], warnings: [], info: [] };
  const m = readManifest(dir) as BakedManifest & { files: { report?: { file: string } } };
  const rep = m.files.report ? (JSON.parse(readFileSync(join(dir, m.files.report.file), 'utf8')) as { continuations?: { id: string; into: string }[] }) : {};
  if (!rep.continuations) {
    r.warnings.push('bake report has no continuations (continuation continuity unchecked — re-bake)');
    return r;
  }
  const byId = new Map(rivers.filter((l) => l.id).map((l) => [l.id!, l]));
  let worst = 0;
  for (const c of rep.continuations) {
    const a = byId.get(c.id);
    const b = byId.get(c.into);
    if (!a || !b) {
      r.errors.push(`rivers: continuation ${c.id} → ${c.into} not in rivers.json`);
      continue;
    }
    const pa = a.points[a.points.length - 1];
    const pb = b.points[0];
    const gap = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
    const dl = a.level && b.level ? a.level[a.level.length - 1] - b.level[0] : 0;
    worst = Math.max(worst, gap);
    if (gap > CONT_GAP_KM) r.errors.push(`rivers: ${c.id} ends ${gap.toFixed(2)} km from the start of its continuation ${c.into} (gate ${CONT_GAP_KM} km)`);
    if (Math.abs(dl) > LEVEL_TOL) r.errors.push(`rivers: ${c.id} → ${c.into}: level steps ${dl.toFixed(4)} at the continuation node`);
  }
  r.info.push(`rivers: ${rep.continuations.length} continuation nodes, largest gap ${worst.toFixed(3)} km (gate ${CONT_GAP_KM})`);
  return r;
}

/**
 * Per landmark: how much of its stamp volume the river guard takes back (composited alone). Beside
 * the water the guard only clamps a stamp to a natural bank, so a landmark losing a large share of its
 * shape sits on / over the water — move it (display offset), reshape its stamps, or allowlist it
 * (places.json onRiver). Error above LOSS_SHARE of the stamp volume and LOSS_MIN units·km².
 */
export const LOSS_SHARE = 0.15;
export const LOSS_MIN = 0.5;

export async function checkStampLoss(world: World, landmarks: LandmarkDefinition[]): Promise<CheckResult & { rows: { id: string; cells: number; share: number; lost: number; maxLost: number }[] }> {
  const r: CheckResult = { errors: [], warnings: [], info: [] };
  const { landmarkStamps } = (await import(pathToFileURL(join(ROOT, 'src/landmarks/world.ts')).href)) as typeof import('../../src/landmarks/world.ts');
  const rows: { id: string; cells: number; share: number; lost: number; maxLost: number }[] = [];
  for (const d of landmarks) {
    if (!d.stamps?.length) continue;
    const place = world.places.get(d.placeId);
    if (!place || place.onRiver) continue;
    const loss = world.heights.stampLoss(landmarkStamps(world, [d]));
    const share = loss.lostVolume / Math.max(loss.stampVolume, 1e-9);
    rows.push({ id: d.id, cells: loss.cells, share, lost: loss.lostVolume, maxLost: loss.maxLost });
    if (share > LOSS_SHARE && loss.lostVolume > LOSS_MIN) r.errors.push(`stamps: the river guard takes ${(100 * share).toFixed(0)} % of ${d.id}'s stamp volume (${loss.lostVolume.toFixed(2)} units·km², ${loss.cells} cells, max ${loss.maxLost.toFixed(2)})`);
  }
  const touched = rows.filter((x) => x.cells > 0).sort((a, b) => b.share - a.share);
  r.info.push(`stamps: river guard vs landmark stamps — ${touched.length ? touched.map((x) => `${x.id} ${(100 * x.share).toFixed(1)} % (${x.cells} cells, max ${x.maxLost.toFixed(2)})`).join(', ') : 'no landmark touched'}`);
  return { ...r, rows };
}

/**
 * Hydro gates from the bake's report.json (tools/bake/bake/hydro.py geometry_report). Everything is measured
 * against the relief before rivers and lakes (h_pre); outside the channel cores unless stated.
 *
 * Every limit is a budget for a VISIBLE defect, set from what the edit does to the picture — not from the
 * current bake. Scales: 1 unit of height ≈ 80 m of real relief (×12, γ 0.8); a 0.4 km texel; at the mid
 * distance (15–60 km, ~30 % of the film) a change of > 2 units reads as a landform, > 4 as a cliff or a
 * trench, > 6 as a gorge. Budgets are shares of the area the metric lives in (report.json coreKm2 = the
 * channel cores, nearKm2 = land within 1 km of a core, bandKm2 = 1–2 km from a core), so they do not drift
 * with the network:
 *  - undeclared raises: the carve's levee raise > 0.5 and any raise > 0.5 outside the declared allowances
 *    ≤ RAISE_KM2 (an embankment the design does not declare; a few isolated cells of tolerance);
 *  - FILL_DEPTH_MAX bounds every declared fill — a pool in a channel, a marsh beside it, a lake delta:
 *    water or a flat standing more than 4.5 units (≈ 360 m) above the DEM is a basin the map shows no water
 *    in. world.json rivers.marshMaxDepth / lakes.rimMaxRaise may not exceed it (they cannot relax the gate);
 *  - channel cores raised > 2 (a flooded DEM hollow the profile pools over instead of cutting its sill)
 *    ≤ CORE_POOL_SHARE of the core area: occasional pools, about one per 200 km of river;
 *  - marsh fills raised > 0.5 ≤ MARSH_SHARE of the land within 2 km of a core (flats at the water level;
 *    the map's marshes — Gladden Fields, Long Marshes, Nindalf and Wetwang, Swanfleet — are about that much);
 *  - lake rims / deltas raised > 0.5 ≤ LAKE_RIM_KM × the lake's perimeter (the lip is ~0.6 km wide, deltas
 *    only at inlets: a raised ring wider than that on average is an embankment);
 *  - lake shores graded down > 2 ≤ LAKE_GRADE_KM × the lake's perimeter (grading is the design, 1.5–5 km;
 *    wider on average and the lake reads as a pan dug into the plain);
 *  - carve lowering: within 1 km of a core it is the channel's own bank (the exaggerated widths need their
 *    floor where the DEM valley is a V) — > 4 there ≤ LOWER4_SHARE of that band, > 6 ≤ LOWER6_SHARE (a gorge
 *    the relief does not have, a few cells); 1–2 km from a core it is the eased valley wall of the great and
 *    major rivers — > 2 ≤ LOWER2_BAND_SHARE of that band (more reads as a trough along the river); beyond the
 *    class's declared easing zone (max(1 km, bankKm / 2), outside the declared gorges) any > 2 lowering is an
 *    excavation — ≤ LOWER2_BEYOND_SHARE of the 1–2 km band; beyond 2 km ≤ LOWER2_FAR_SHARE (only the great
 *    river's 8 km eased floodplain reaches that far);
 *  - ribbon edges more than 0.15 above the ground on ≤ EDGE_SHARE of the ribbon length (water hanging over
 *    its bank: about 1 km per 200 km of river);
 *  - new > 3-unit neighbour steps (a new 82° cliff) outside declared gorges / falls: no cluster larger than
 *    STEP_CLUSTER_CELLS (≈ 4 km², a wall at the mid distance), in total ≤ 1 cell per STEP_KM_PER_CELL km
 *    of ribbon (isolated notches in mountain torrents, visible only at close range);
 *  - confluence joins (end on the parent's core edge, at its level, not floating).
 * Source trims longer than world.json rivers.profile.trimSourceKm are listed as warnings (canon length kept).
 */
export const RAISE_KM2 = 5;
export const FILL_DEPTH_MAX = 4.5;
export const CORE_POOL_SHARE = 0.005;
export const MARSH_SHARE = 0.015;
export const LAKE_RIM_KM = 0.5;
export const LAKE_GRADE_KM = 2;
export const LOWER4_SHARE = 0.01;
export const LOWER6_SHARE = 0.0005;
export const LOWER2_BAND_SHARE = 0.05;
export const LOWER2_BEYOND_SHARE = 0.001;
export const LOWER2_FAR_SHARE = 0.005;
export const EDGE_SHARE = 0.005;
export const STEP_CLUSTER_CELLS = 25;
export const STEP_KM_PER_CELL = 50;
export const JOIN_OFF_KM = 0.5;
export const JOIN_LEVEL = 0.1;
export const JOIN_FLOAT = 0.15;

interface HydroReport {
  riverRaise: { over05Km2: number; over1Km2: number; max: number; at: number[] };
  riverLower?: { nearKm2?: number; bandKm2?: number; over2Km2: number; over2NearKm2: number; over2BandKm2?: number; over2FarKm2: number; over2BeyondEaseKm2?: number; worstBeyondEase?: { id: string; km2: number }[]; over4Km2: number; over6Km2: number; max: number; at: number[]; worst: { id: string; km2: number }[]; deep?: { km2: number; max: number; at: number[]; id: string | null }[] };
  coreRaise?: { coreKm2: number; over05Km2: number; over1Km2: number; over2Km2: number; over3Km2: number; max: number; at: number[]; pools: { km2: number; max: number; at: number[]; id: string | null }[] };
  marshFill: { over05Km2: number; filledKm2: number; max: number };
  terrain?: { raised05Km2: number; lowered2Km2: number; otherRaised05Km2: number; otherLowered2Km2: number; otherLowered4Km2: number; allowances: { marshRaised05Km2: number; lakeRaised05Km2: number; lakeLowered2Km2: number } };
  newSteps: { over3: number; cells?: number; undeclaredCells?: number; clusters?: number; at: number[][]; largest?: number[]; worst?: { id: string; km2: number }[] };
  joins: { id: string; into: string; offKm: number; dLevel: number; float: number }[];
  edgeFloat: { totalKm: number; lengthKm?: number; share?: number; lines: { id: string; km: number; max: number }[] };
  cuts: { id: string; max: number; over2Km: number }[];
  lakeRims: { key: string; perimeterKm?: number; over05Km2: number; max: number; lowered2Km2?: number; maxLower?: number }[];
  snap?: { byClass: Record<string, { lines: number; maxKm: number; meanKm: number }> };
  lengths?: { rawKm: number; km: number; trimKm: number; lines: { id: string; rawKm: number; km: number; trimKm: number }[] };
}

export function checkHydroReport(dir: string): CheckResult {
  const r: CheckResult = { errors: [], warnings: [], info: [] };
  const m = readManifest(dir) as BakedManifest & { files: { report?: { file: string } } };
  if (!m.files.report) {
    r.warnings.push('bake has no report.json (hydro geometry gates skipped)');
    return r;
  }
  const rep = JSON.parse(readFileSync(join(dir, m.files.report.file), 'utf8')) as HydroReport;
  const W = JSON.parse(readFileSync(join(ROOT, 'data/world/world.json'), 'utf8')) as { rivers: { marshMaxDepth?: number; profile?: { trimSourceKm?: number } }; lakes?: { rimMaxRaise?: number } };
  const f1 = (v: number) => v.toFixed(1);
  const t = rep.terrain;
  const rl = rep.riverLower;
  const cr = rep.coreRaise;
  if (!t || !rl || !cr || rl.nearKm2 === undefined || rl.bandKm2 === undefined || rl.over2BandKm2 === undefined || rl.over2BeyondEaseKm2 === undefined) {
    r.errors.push('hydro: report.json predates the terrain / riverLower / coreRaise gates — re-bake');
    return r;
  }
  // undeclared raises
  const rr = rep.riverRaise;
  if (rr.over05Km2 > RAISE_KM2) r.errors.push(`hydro: the carve raised ground > 0.5 outside the channel cores on ${rr.over05Km2} km² (gate ${RAISE_KM2}; max ${rr.max} at ${rr.at.join(',')} km)`);
  if (t.otherRaised05Km2 > RAISE_KM2) r.errors.push(`hydro: ground raised > 0.5 above the relief outside the cores and outside the declared allowances on ${t.otherRaised05Km2} km² (gate ${RAISE_KM2})`);
  // fill depth: pools, marshes, lake deltas — and the config bounds that feed them
  for (const [what, v] of [['world.json rivers.marshMaxDepth', W.rivers.marshMaxDepth], ['world.json lakes.rimMaxRaise', W.lakes?.rimMaxRaise]] as const)
    if (v === undefined || v > FILL_DEPTH_MAX) r.errors.push(`hydro: ${what} ${v ?? 'unset'} exceeds the fill-depth gate ${FILL_DEPTH_MAX}`);
  if (cr.max > FILL_DEPTH_MAX) r.errors.push(`hydro: a channel core is raised ${cr.max} above the relief at ${cr.at.join(',')} km (gate ${FILL_DEPTH_MAX})`);
  if (rep.marshFill.max > FILL_DEPTH_MAX) r.errors.push(`hydro: a marsh fill is ${rep.marshFill.max} deep (gate ${FILL_DEPTH_MAX})`);
  for (const l of rep.lakeRims) if (l.max > FILL_DEPTH_MAX + 1e-3) r.errors.push(`hydro: lake ${l.key} shore raised up to ${l.max} (gate ${FILL_DEPTH_MAX})`);
  // pools in the channel cores
  const poolGate = CORE_POOL_SHARE * cr.coreKm2;
  const pools = cr.pools.slice(0, 5).map((p) => `${p.id} ${p.km2} km² (max ${p.max}) at ${p.at.join(',')}`).join('; ');
  if (cr.over2Km2 > poolGate) r.errors.push(`hydro: channel cores raised > 2 above the relief on ${cr.over2Km2} km² (gate ${f1(poolGate)} = ${100 * CORE_POOL_SHARE} % of ${cr.coreKm2} km² of core): ${pools}`);
  // marshes
  const bands = rl.nearKm2 + rl.bandKm2;
  const marshGate = MARSH_SHARE * bands;
  if (t.allowances.marshRaised05Km2 > marshGate) r.errors.push(`hydro: marsh fills raise ground > 0.5 above the relief on ${t.allowances.marshRaised05Km2} km² (gate ${f1(marshGate)} = ${100 * MARSH_SHARE} % of the land within 2 km of a core)`);
  // lakes
  for (const l of rep.lakeRims) {
    if (l.perimeterKm === undefined) continue;
    if (l.over05Km2 > LAKE_RIM_KM * l.perimeterKm + 1) r.errors.push(`hydro: lake ${l.key} rim / deltas raised > 0.5 on ${l.over05Km2} km² (gate ${LAKE_RIM_KM} km × ${l.perimeterKm} km of shore)`);
    if ((l.lowered2Km2 ?? 0) > LAKE_GRADE_KM * l.perimeterKm + 1) r.errors.push(`hydro: lake ${l.key} shore graded down > 2 on ${l.lowered2Km2} km² (gate ${LAKE_GRADE_KM} km × ${l.perimeterKm} km of shore; max ${l.maxLower})`);
  }
  // carve lowering
  const lower: [string, number, number][] = [
    ['> 4 within 1 km of a core', rl.over4Km2, LOWER4_SHARE * rl.nearKm2],
    ['> 6', rl.over6Km2, LOWER6_SHARE * rl.nearKm2],
    ['> 2 between 1 and 2 km of a core', rl.over2BandKm2, LOWER2_BAND_SHARE * rl.bandKm2],
    ['> 2 beyond the declared easing zone', rl.over2BeyondEaseKm2, LOWER2_BEYOND_SHARE * rl.bandKm2],
    ['> 2 more than 2 km beyond a core', rl.over2FarKm2, LOWER2_FAR_SHARE * rl.bandKm2],
  ];
  const deep = (rl.deep ?? []).slice(0, 4).map((d) => `${d.id} ${d.km2} km² (max ${d.max}) at ${d.at.join(',')}`).join('; ');
  for (const [what, v, gate] of lower) if (v > gate) r.errors.push(`hydro: the carve lowered ground ${what} on ${v} km² (gate ${f1(gate)}; deepest ${deep}${what.includes('easing') ? `; ${(rl.worstBeyondEase ?? []).map((w) => `${w.id} ${w.km2}`).join(', ')}` : ''})`);
  // ribbon edges
  const share = rep.edgeFloat.share ?? rep.edgeFloat.totalKm / Math.max(1, rep.edgeFloat.lengthKm ?? 1);
  if (share > EDGE_SHARE) r.errors.push(`hydro: ribbon edges > 0.15 above the ground on ${rep.edgeFloat.totalKm} km = ${(100 * share).toFixed(2)} % of the ribbons (gate ${100 * EDGE_SHARE} %)`);
  // new cliffs
  const cells = rep.newSteps.undeclaredCells ?? rep.newSteps.over3;
  const stepGate = (rep.edgeFloat.lengthKm ?? 0) / STEP_KM_PER_CELL;
  const largest = rep.newSteps.largest?.[0] ?? 0;
  const steps = `${rep.newSteps.over3} neighbour pairs, ${cells} cells outside declared gorges / falls in ${rep.newSteps.clusters ?? '?'} clusters, largest ${largest} cells (worst ${(rep.newSteps.worst ?? []).slice(0, 3).map((w) => `${w.id} ${w.km2} km²`).join(', ')}; first at ${rep.newSteps.at.slice(0, 3).map((p) => p.join(',')).join('; ')} km)`;
  if (cells > stepGate || largest > STEP_CLUSTER_CELLS) r.errors.push(`hydro: new > 3-unit steps: ${steps} (gates ${f1(stepGate)} cells = 1 per ${STEP_KM_PER_CELL} km of ribbon, ${STEP_CLUSTER_CELLS} per cluster)`);
  else if (cells) r.warnings.push(`hydro: new > 3-unit steps (mountain torrents): ${steps}`);
  // joins
  const bad = rep.joins.filter((j) => j.offKm > JOIN_OFF_KM || Math.abs(j.dLevel) > JOIN_LEVEL || j.float > JOIN_FLOAT);
  for (const j of bad.slice(0, 8)) r.errors.push(`hydro: ${j.id} → ${j.into}: end ${j.offKm.toFixed(2)} km off the parent's core edge, Δlevel ${j.dLevel.toFixed(3)}, floats ${j.float.toFixed(2)} above its bed`);
  // source trims (canon length)
  const trimKm = W.rivers.profile?.trimSourceKm ?? 5;
  if (rep.lengths) {
    const long = rep.lengths.lines.filter((l) => l.trimKm > trimKm + 0.5);
    if (long.length) r.warnings.push(`hydro: source trims beyond ${trimKm} km (a hollow deeper than trimHollowCut below its sill): ${long.map((l) => `${l.id} ${l.trimKm} km`).join(', ')}`);
    r.info.push(`hydro: river length ${rep.lengths.rawKm} km raw → ${rep.lengths.km} km processed; source trims ${rep.lengths.trimKm} km`);
  }
  const worstCut = rep.cuts[0];
  const rimKm2 = rep.lakeRims.reduce((a, l) => a + l.over05Km2, 0);
  r.info.push(`hydro: vs the relief outside the cores — raised > 0.5 ${t.raised05Km2} km² (marsh ${t.allowances.marshRaised05Km2} / gate ${f1(marshGate)}, lakes ${t.allowances.lakeRaised05Km2}, other ${t.otherRaised05Km2}); carve lowered > 2 ${rl.over2Km2} km² (${rl.over2NearKm2} within 1 km of a core, ${rl.over2BandKm2} at 1–2 km / gate ${f1(LOWER2_BAND_SHARE * rl.bandKm2)}, ${rl.over2FarKm2} beyond 2 km, ${rl.over2BeyondEaseKm2} beyond the easing zones), > 4 ${rl.over4Km2} / ${f1(LOWER4_SHARE * rl.nearKm2)}, > 6 ${rl.over6Km2} / ${f1(LOWER6_SHARE * rl.nearKm2)}; lake shores graded > 2 ${t.allowances.lakeLowered2Km2} km²`);
  r.info.push(`hydro: channel cores raised > 0.5 ${cr.over05Km2} km², > 1 ${cr.over1Km2}, > 2 ${cr.over2Km2} / gate ${f1(poolGate)}, > 3 ${cr.over3Km2}, max ${cr.max} (${pools})`);
  r.info.push(`hydro: ${rep.joins.length - bad.length}/${rep.joins.length} joins OK, ribbon edges > 0.15 above the ground on ${rep.edgeFloat.totalKm} km (${(100 * share).toFixed(2)} %), deepest cut ${worstCut ? `${worstCut.id} ${worstCut.max}` : '—'}, marsh fills > 0.5 ${rep.marshFill.over05Km2} km² (max ${rep.marshFill.max}), lake rims > 0.5 ${rimKm2.toFixed(0)} km² (max ${Math.max(0, ...rep.lakeRims.map((l) => l.max)).toFixed(2)})`);
  if (rep.snap) r.info.push(`hydro: thalweg snap — ${Object.entries(rep.snap.byClass).map(([c, v]) => `${c} max ${v.maxKm} / mean ${v.meanKm} km`).join(', ')}`);
  return r;
}

/** Cells where the composited stamp layer differs from the baked base on river channels / lakes. */
export async function checkRiversWin(dir: string, world: World): Promise<CheckResult & { moved: number; maxLift: number }> {
  const r: CheckResult = { errors: [], warnings: [], info: [] };
  const hf = world.heights;
  const chan = readMaskChannel(dir, 'water', 0);
  const lake = readMaskChannel(dir, 'water', 1);
  const exempt = [...world.places.values()].filter((p) => p.onRiver).map((p) => ({ x: p.x, z: p.z, r: p.footprintKm ?? 5 }));
  const W = hf.width;
  let moved = 0;
  let maxLift = 0;
  let where = '';
  for (let i = 0; i < hf.data.length; i++) {
    if (chan.data[i] < 128 && lake.data[i] < 128) continue;
    const d = hf.data[i] - hf.base[i];
    if (Math.abs(d) < 1e-4) continue;
    const x = world.spec.xMin + ((i % W) + 0.5) * hf.texel;
    const z = world.spec.zMin + (Math.floor(i / W) + 0.5) * hf.texel;
    if (exempt.some((e) => Math.hypot(x - e.x, z - e.z) < e.r)) continue;
    moved++;
    if (d > maxLift) {
      maxLift = d;
      const [kx, ky] = world.spec.worldToKm(x, z);
      where = `${kx.toFixed(1)},${ky.toFixed(1)} km`;
    }
  }
  if (moved) r.errors.push(`rivers win: ${moved} river/lake cells moved by stamps (max lift ${maxLift.toFixed(3)} at ${where})`);
  else r.info.push(`rivers win: no stamp moves a river channel or lake cell (${hf.guardedCells} guarded cells restored; ${exempt.length} onRiver landmarks exempt)`);
  return { ...r, moved, maxLift };
}

export async function checkBakedWorld(dir: string): Promise<CheckResult> {
  const out: CheckResult = { errors: [], warnings: [], info: [] };
  const m = readManifest(dir);
  const rivers = JSON.parse(readFileSync(join(dir, m.files.rivers.file), 'utf8')) as RiverLine[];
  const lakes = JSON.parse(readFileSync(join(dir, m.files.lakes.file), 'utf8')) as LakePoly[];
  const { world, landmarks } = await loadWorld(dir);
  const { checkLandmarks } = await import('./landmarks.ts');
  const { checkBookmarks } = await import('./bookmarks.ts');
  for (const part of [
    checkRiverLevels(rivers, lakes),
    checkContinuations(dir, rivers),
    await checkRiversWin(dir, world),
    await checkStampLoss(world, landmarks),
    checkHydroReport(dir),
    await checkLandmarks(world, landmarks),
    await checkBookmarks(world, landmarks),
  ]) {
    out.errors.push(...part.errors);
    out.warnings.push(...part.warnings);
    out.info.push(...part.info);
  }
  const places = (JSON.parse(readFileSync(join(ROOT, 'data/world/places.json'), 'utf8')) as { places: { id: string; kind: string; onRiver?: boolean }[] }).places;
  for (const p of places) if (p.onRiver && p.kind !== 'landmark') out.errors.push(`places: ${p.id} has onRiver but is not a landmark`);
  if (!m.files.terrain) out.warnings.push('bake has no terrain.rgba8 (v1) — terrain mask unavailable');
  return out;
}
