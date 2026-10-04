/**
 * Film checks (S5, CPU), part of `pnpm check` — and a CLI for fast iteration:
 *
 *   node --import tsx tools/check/film.ts [--table] [--at t1,t2] [--cues out.json] [--no-built] [--sync-shotlist]
 *
 * --sync-shotlist writes data/tour/shotlist.json from the compiled film (film.seconds / beats; per segment its
 * seconds, tod and distance-class mix; per hold subject its tod and screenSeconds — see syncShotlist), keeping
 * the file's formatting; segment membership stays hand-edited.
 *
 * Structural (always, even without a bake / in CI) — errors:
 *  - data/tour/timeline.json v1 and route.json v2 shapes (unknown keys warn); beats alternate, start and end
 *    with a hold, unique ids; route legs / points (kebab ids and marks, offsetKm [east, north] numbers, a
 *    place or `at`); caption fades (as the compiler fills them: captionFades) fit their window; shot-list
 *    segment routes name route legs; references resolve: bookmarks (landmark definitions), shots (loadShots(); the
 *    page compiles with data/qa/shots.json only), places (places.json), caption landmarks, head marks (the
 *    route's marks), look ids (looks.json); event channels ∈ EVENT_SLOT; tod non-decreasing; total length
 *    within film.lengthS (when no move is `auto`; else on the compiled film)
 * On the baked world (checkBakedWorld) — the compiled film as the page compiles it (with the landmark build:
 * caption anchors at 0.6 × the built height; src/app/boot.ts passes `built` too, so the hashes agree):
 *  - errors: the compile throws (unknown rivers / lakes, …); compiling twice (the second time with a fresh
 *    water field) gives another hash; the compiled length leaves film.lengthS; a look id switches while its
 *    weight is not 0; data/tour/shotlist.json out of sync (film.seconds, segments = the beats in order, their
 *    seconds); a hero hold whose OWN framing needs the clearance lift (the rig's raw need > 0 inside it: the
 *    framing is wrong, not the rig)
 *  - the route: self-crossings, kinks, the drape's float above the surface under the line (> 0.3 km), height
 *    steps > 1 km classified as cliffs under the line or drape lifts
 *  - sampled (24 Hz; 8 Hz for the heavier ones) — warnings while the timeline is `draft`, errors once it is
 *    `locked` (picture lock):
 *     · clearance: the camera ≥ 0.03 km above the water-aware surface (5 taps); clearance lift (> 1 m)
 *       bleeding into a hero hold from a neighbouring move (that move or its other hold's framing dips)
 *     · tod exactly linear inside every hold (the keys' rates; > 1e-6 h off = a bent hold)
 *     · perceived speed V = hypot(|dT_xz| / w, |d ln w|) (frame widths / s): ≤ 0.15 in holds; moves warn
 *       above 1.6 (an error above 2.6 when locked)
 *     · view rotation ≤ 2 °/s in holds, ≤ 30 °/s in moves; jerk spikes (|d³P/dt³| / w far above the beat's
 *       own level: a C2 break)
 *     · the route head as the RouteSystem draws it (headPoint) on screen (|NDC| ≤ 0.9) for ≥ 90 % of a
 *       move's samples after its first 0.5 s, and also not behind terrain (layout.ts visibility ≥ 0.5; the
 *       x-ray Moria leg exempt) for ≥ 80 %
 *     · place / pass labels as the page draws them — the TitleSystem's own anchorPoint (the diamond moves
 *       onto the route head while it rests on the subject) and subjectVisible, with the page's inputs, laid
 *       out at the shutter's centre: opacity onScreen × subjectVisible ≥ 0.5 (else the page fades the label
 *       out: off frame / hidden), the diamond inside the label-safe zone (|x| ≤ 0.75, −0.7 ≤ y ≤ 0.55; a
 *       diamond on the route head down to −0.85: its label sits above it)
 *     · the board's edge in the top 15 % of a move's frame (visibleTopVoid > 5 %: void rays weighted by the
 *       sky's void darkness, 4 Hz) while the view is narrower than the board; moves to / from an overview
 *       hold exempt
 *     · the camera probe (tools/check/probe.ts) at hold middles: top void ≤ 1 %, void ≤ 3 % (overview holds
 *       exempt), the subject (the hold's label landmark) in frame, ≥ 40 px tall at 1600×900, ≥ 60 % visible,
 *       line of sight to the target ground; moves every 1 s: void ≤ 15 % (while the view is narrower than the
 *       board)
 *     · under a covering ash deck the camera stays 6 km below it (crossDeck moves and overviews exempt)
 *     · tod rate ≤ 0.03 h/s in holds, ≤ 0.25 h/s in moves
 *     · light per hold: share of 49 ground points within 3 km of the subject (the hold's label landmark,
 *       else its bookmark's, else its place) that see the key light (sun above −4°, else the moon; raycast) —
 *       < 40 % warns unless `light: 'shade' | 'silhouette'` (skipped under the ash deck); backlight: the sun
 *       within 20° of the view direction warns unless `silhouette`
 *     · landmark LOD (LandmarkSystem.selectLod at 1080 px with the film's lodBias and the landmark's real
 *       level count) changing inside a hold
 *  - a per-beat table (CLI --table): t0, dur, path length S, peak V, peak rotation, max D, min clearance,
 *    tod, lit %, findings
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ShotSpecInput } from '../../src/camera/shots.ts';
import type { CameraState, SceneState } from '../../src/core/types.ts';
import type { BuiltLandmark } from '../../src/landmarks/records.ts';
import type { LandmarkDefinition } from '../../src/landmarks/types.ts';
import type { World } from '../../src/world/World.ts';
import type { FilmProgram } from '../../src/tour/compile.ts';
import type { BeatJson, CaptionDef, CaptionJson, HoldJson, MoveJson, RouteJson, TimelineJson } from '../../src/tour/schema.ts';
import type { V3 } from '../../src/titles/layout.ts';
import type { CheckResult } from './world.ts';
import { loadShots } from '../capture/shotList.ts';
import { bakedDir, hasBake, loadLandmarks, loadWorld, ROOT } from './baked.ts';

const mod = (p: string) => pathToFileURL(join(ROOT, p)).href;
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T;

const HOLD_STYLES = ['open', 'hero', 'stop', 'end'];
const CAPTION_KINDS = ['title', 'place', 'pass', 'end', 'fade'];
const HOLD_KEYS = ['hold', 'style', 'dur', 'place', 'camera', 'drift', 'tod', 'head', 'routeGlow', 'events', 'look', 'lens', 'weather', 'captions', 'music', 'light', 'note'];
const MOVE_KEYS = ['move', 'dur', 'maxAltKm', 'rho', 'apexEl', 'crossDeck', 'captions', 'events', 'music', 'note'];
const SET_KEYS = ['distanceKm', 'elevationDeg', 'azimuthDeg', 'fov', 'lift', 'aimKm', 'roll'];
const DRIFT_KEYS = ['azDegPerS', 'pushPerS', 'alongKmPerS', 'elDegPerS'];
const CAPTION_KEYS = ['kind', 'landmark', 'text', 'sub', 'lines', 'in', 'out', 'fadeIn', 'fadeOut', 'side', 'anchorLiftKm', 'anchorOffsetKm'];
const LEG_KEYS = ['id', 'mode', 'river', 'lake', 'points', 'note'];
const POINT_KEYS = ['place', 'at', 'offsetKm', 'mark'];
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Sampled-check limits (see the header). */
export const FILM_LIMITS = {
  holdV: 0.15,
  moveVWarn: 1.6,
  moveVError: 2.6,
  holdRotDeg: 2,
  moveRotDeg: 30,
  /** a jerk sample this many times the beat's median (and above JERK_FLOOR) is a spike */
  jerkSpike: 6,
  jerkFloor: 4,
  headOnScreen: 0.9,
  headShare: 0.9,
  /**
   * the head on screen AND not behind terrain: the route runs through valleys and behind ridges — a head
   * hidden for under a fifth of a move reads as the line passing behind a hill and coming out again; the
   * Minas Tirith approach the critic flagged (1.5 s of 6 s behind the foothills) is over it
   */
  headVisibleShare: 0.8,
  safeX: 0.75,
  safeY: [-0.7, 0.55] as [number, number],
  /**
   * the bottom of the safe zone for a diamond that marks the route head (the TitleSystem moves it there while
   * the head rests on the subject): the head belongs on the ground at the subject's foot and its label block
   * sits above or beside it (layout.ts keeps the block inside the 90 % title-safe area), so the diamond may
   * go down to the 90 % action-safe line rather than the anchor zone's −0.7 (e.g. the Argonath: the head on
   * the river between the kings at −0.79)
   */
  headSafeYMin: -0.85,
  topVoid: 0.01,
  /**
   * moves: the visible void in the top 15 % of the frame (visibleTopVoid: void rays weighted by how dark the
   * sky draws them) — calibrated on stills: 15 % (to-argonath) and 31 % (to-black-gate) read as a dark band
   * over a straight board edge, ≤ 3 % as horizon haze
   */
  moveTopVoid: 0.05,
  holdVoid: 0.03,
  /** a hold's subject (its label's landmark) at the hold's middle: ≥ this many px tall at 1600×900, in frame */
  subjectPx: 40,
  subjectVisible: 0.6,
  moveVoid: 0.15,
  /** move probes stop counting void once the view is this wide (the whole board in frame), km */
  moveVoidMaxW: 500,
  holdTodRate: 0.03,
  moveTodRate: 0.25,
  minClearKm: 0.03,
  /** clearance lift / raw need inside a hero hold above this counts (km; the filters' numeric floor) */
  heroLiftKm: 1e-3,
  /** tod inside a hold this far from the linear keys = a bent hold (hours) */
  todLinearH: 1e-6,
  litShare: 0.4,
  backlightDeg: 20,
  deckTolKm: 0.05,
};

/**
 * The TitleSystem's off-frame fade (src/titles/TitleSystem.ts OFFSCREEN_FADE, not exported): a label fades out
 * over this × H beyond the frame edge.
 */
const LABEL_OFFSCREEN_FADE = 0.04;

/**
 * The TitleSystem's per-state label helpers (private, pure functions of the caption and the state): the
 * diamond's world point and its subject's visibility. The check calls the page's own code rather than a
 * copy (contract request: export them from src/titles/layout.ts as pure functions).
 */
interface TitleInternals {
  anchorPoint(def: CaptionDef, st: SceneState): V3;
  subjectVisible(def: CaptionDef, st: SceneState, anchor: V3): number;
}

const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ───────────────────────────── structural ─────────────────────────────

/** Structural checks on the JSON (no world needed). */
export async function checkFilmStructure(): Promise<CheckResult> {
  const out: CheckResult = { errors: [], warnings: [], info: [] };
  const E = (m: string) => out.errors.push(`film: ${m}`);
  const W = (m: string) => out.warnings.push(`film: ${m}`);
  let tl: TimelineJson;
  let route: RouteJson;
  try {
    tl = readJson<TimelineJson>('data/tour/timeline.json');
    route = readJson<RouteJson>('data/tour/route.json');
  } catch (e) {
    E(`timeline.json / route.json do not parse: ${(e as Error).message}`);
    return out;
  }
  const places = new Set(readJson<{ places: { id: string }[] }>('data/world/places.json').places.map((p) => p.id));
  const looks = new Set(Object.keys(readJson<{ regions: Record<string, unknown> }>('data/world/looks.json').regions));
  const { EVENT_SLOT } = (await import(mod('src/materials/gates.ts'))) as typeof import('../../src/materials/gates.ts');
  const { CAPTION_DEFAULTS, captionFades } = (await import(mod('src/tour/captions.ts'))) as typeof import('../../src/tour/captions.ts');
  const landmarks = await loadLandmarks();
  const lmIds = new Set(landmarks.map((d) => d.id));
  const bookmarks = new Map<string, { def: LandmarkDefinition; fStop?: number }>();
  for (const d of landmarks) for (const b of d.bookmarks ?? []) bookmarks.set(b.id, { def: d, fStop: b.fStop });
  const allShots = loadShots();
  const pageShots = new Set(readJson<{ shots: { id: string }[] }>('data/qa/shots.json').shots.map((s) => s.id));
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const unknownKeys = (o: object, keys: string[], where: string) => {
    for (const k of Object.keys(o)) if (!keys.includes(k)) W(`${where}: unknown key '${k}' (typo?)`);
  };

  // ---- route.json
  if (route.version !== 2) E(`route.json version ${route.version} (want 2)`);
  if (!(num(route.defaults?.spacingKm) && route.defaults.spacingKm > 0 && num(route.defaults.liftKm) && route.defaults.liftKm >= 0)) E('route.json defaults need spacingKm > 0 and liftKm ≥ 0');
  const marks = new Set<string>();
  const legIds = new Set<string>();
  for (const leg of route.legs ?? []) {
    unknownKeys(leg, LEG_KEYS, `route leg ${leg.id}`);
    if (typeof leg.id !== 'string' || !KEBAB.test(leg.id)) E(`route leg id '${leg.id}': ids are kebab-case`);
    if (legIds.has(leg.id)) E(`route leg id '${leg.id}' repeats`);
    legIds.add(leg.id);
    marks.add(`${leg.id}:start`).add(`${leg.id}:end`);
    const mode = leg.mode ?? 'foot';
    if (!['foot', 'boat', 'underground'].includes(mode)) E(`route leg ${leg.id}: mode '${mode}'`);
    if (mode === 'boat' && !!leg.river === !!leg.lake) E(`route leg ${leg.id}: a boat leg names one river or one lake`);
    if (mode !== 'boat' && (leg.river || leg.lake)) E(`route leg ${leg.id}: river / lake only on boat legs`);
    if (!Array.isArray(leg.points) || leg.points.length < 2) E(`route leg ${leg.id}: needs ≥ 2 points`);
    for (const p of leg.points ?? []) {
      unknownKeys(p, POINT_KEYS, `route leg ${leg.id} point`);
      if (p.mark !== undefined && !(typeof p.mark === 'string' && KEBAB.test(p.mark))) E(`route leg ${leg.id}: mark '${p.mark}' is not a kebab-case name`);
      if (p.place && p.at) E(`route leg ${leg.id}: a point has a place or at [x, y], not both`);
      if (p.place) {
        if (!places.has(p.place)) E(`route leg ${leg.id}: unknown place '${p.place}'`);
        // offsetKm [east, north] km: NaN would slip through the leg-chain test (a NaN distance is not > 1e-6)
        if (p.offsetKm !== undefined && !(Array.isArray(p.offsetKm) && p.offsetKm.length === 2 && p.offsetKm.every(num))) E(`route leg ${leg.id}: point ${p.place} offsetKm ${JSON.stringify(p.offsetKm)} is not [east, north] km`);
        marks.add(p.mark ?? p.place);
      } else if (Array.isArray(p.at) && p.at.length === 2 && p.at.every(num)) {
        if (p.offsetKm !== undefined) E(`route leg ${leg.id}: offsetKm only on place points`);
        if (p.mark) marks.add(p.mark);
      } else E(`route leg ${leg.id}: a point needs a place or at [x, y]`);
    }
  }
  if (!route.legs?.length) E('route.json has no legs');

  // ---- timeline.json: film + defaults
  if (tl.version !== 1) E(`timeline.json version ${tl.version} (want 1)`);
  if (tl.status !== 'draft' && tl.status !== 'locked') E(`timeline status '${tl.status}' (draft | locked)`);
  const f = tl.film;
  if (!f) {
    E('timeline.json has no film block');
    return out;
  }
  if (!(Number.isInteger(f.fps) && f.fps > 0)) E(`film.fps ${f.fps}`);
  if (!(num(f.shutter) && f.shutter >= 0 && f.shutter <= 1)) E(`film.shutter ${f.shutter} outside 0..1`);
  if (!(num(f.dayOfYear) && f.dayOfYear >= 0 && f.dayOfYear <= 366)) E(`film.dayOfYear ${f.dayOfYear}`);
  if (!(Array.isArray(f.lengthS) && f.lengthS.length === 2 && f.lengthS.every(num) && f.lengthS[0] < f.lengthS[1])) E('film.lengthS must be [min, max]');
  if (!(num(f.tFxScale) && f.tFxScale > 0)) E(`film.tFxScale ${f.tFxScale}`);
  if (!(f.weather && num(f.weather.cloudCoverage) && Array.isArray(f.weather.wind))) E('film.weather needs cloudCoverage and wind');
  if (f.lodBias !== undefined && !(num(f.lodBias) && f.lodBias > 0)) E(`film.lodBias ${f.lodBias}`);
  const dm = tl.defaults?.move;
  if (!(dm && dm.rho > 0 && dm.vTarget > 0 && dm.minS > 0 && dm.maxS >= dm.minS && num(dm.apexEl) && dm.headLeadS >= 0)) E('defaults.move needs rho, vTarget, minS ≤ maxS, apexEl, headLeadS');
  for (const s of HOLD_STYLES) {
    const d = (tl.defaults as unknown as Record<string, { drift?: object }>)?.[s];
    if (!d?.drift) E(`defaults.${s}.drift missing`);
    else unknownKeys(d.drift, DRIFT_KEYS, `defaults.${s}.drift`);
  }

  // ---- beats
  const beats = tl.beats ?? [];
  if (!beats.length) {
    E('timeline has no beats');
    return out;
  }
  const isHold = (b: BeatJson): b is HoldJson => 'hold' in b;
  if (!isHold(beats[0]) || !isHold(beats[beats.length - 1])) E('the timeline must start and end with a hold');
  const ids = new Set<string>();
  let lastTod = -Infinity;
  let autoMoves = 0;
  let total = 0;
  const checkCaption = (c: CaptionJson, where: string, dur: number | null) => {
    unknownKeys(c, CAPTION_KEYS, where);
    if (!CAPTION_KINDS.includes(c.kind)) E(`${where}: caption kind '${c.kind}'`);
    if ((c.kind === 'place' || c.kind === 'pass') && !(c.landmark && lmIds.has(c.landmark))) E(`${where}: ${c.kind} caption needs a known landmark (got '${c.landmark}')`);
    if ((c.kind === 'title' || c.kind === 'end') && !c.text) E(`${where}: ${c.kind} card needs text`);
    for (const k of ['in', 'out', 'fadeIn', 'fadeOut', 'anchorLiftKm'] as const) if (c[k] !== undefined && !num(c[k])) E(`${where}: caption ${k} is not a number`);
    if ((c.fadeIn ?? 0) < 0 || (c.fadeOut ?? 0) < 0) E(`${where}: negative caption fade`);
    if (c.side && !['left', 'right', 'above', 'below'].includes(c.side)) E(`${where}: caption side '${c.side}'`);
    if (c.anchorOffsetKm !== undefined && !(Array.isArray(c.anchorOffsetKm) && c.anchorOffsetKm.length === 2 && c.anchorOffsetKm.every(num) && Math.hypot(c.anchorOffsetKm[0], c.anchorOffsetKm[1]) <= 5)) E(`${where}: caption anchorOffsetKm ${JSON.stringify(c.anchorOffsetKm)} is not [east, north] km within 5 km of the landmark`);
    if (dur !== null) {
      const rel = (v: number | undefined, dflt: number, isOut: boolean) => {
        const x = v ?? dflt;
        return x < 0 || (isOut && Object.is(x, -0)) ? dur + x : x;
      };
      const D = CAPTION_DEFAULTS[c.kind] ?? [0, -0, 0, 0];
      const a = rel(c.in, D[0], false);
      const b = rel(c.out, D[1], true);
      if (!(a >= -1e-9 && b <= dur + 1e-9 && b > a)) E(`${where}: caption window [${fmt(a, 2)}, ${fmt(b, 2)}] s outside its ${fmt(dur, 2)} s beat`);
      else if (CAPTION_KINDS.includes(c.kind)) {
        // the fades the compiler gives it (authored, else the kind's default shrunk to its window) must fit
        // the window together: otherwise the reveal never reaches 1 and the in / out ramps overlap
        const [fi, fo] = captionFades(c.kind, b - a, c);
        if (fi + fo > b - a + 1e-9) E(`${where}: caption fades ${fmt(fi, 2)} + ${fmt(fo, 2)} s (${c.fadeIn === undefined ? 'default' : 'authored'} in, ${c.fadeOut === undefined ? 'default' : 'authored'} out) exceed its ${fmt(b - a, 2)} s window`);
      }
    }
  };
  const checkEvents = (ev: BeatJson['events'], where: string, dur: number | null) => {
    for (const [ch, ks] of Object.entries(ev ?? {})) {
      if (!(ch in EVENT_SLOT)) E(`${where}: event channel '${ch}' is not in EVENT_SLOT (${Object.keys(EVENT_SLOT).join(', ')})`);
      let prev = -Infinity;
      for (const k of ks) {
        if (!(Array.isArray(k) && k.length === 2 && num(k[0]) && num(k[1]))) {
          E(`${where}: event '${ch}' key ${JSON.stringify(k)} is not [t, value]`);
          continue;
        }
        if (k[1] < 0 || k[1] > 1) E(`${where}: event '${ch}' value ${k[1]} outside 0..1`);
        if (k[0] < prev) E(`${where}: event '${ch}' keys out of order`);
        if (k[0] < 0 || (dur !== null && k[0] > dur + 1e-9)) W(`${where}: event '${ch}' key at ${k[0]} s lies outside the beat`);
        prev = k[0];
      }
    }
  };
  const checkMusic = (m: BeatJson['music'], where: string) => {
    if (!m) return;
    if (!m.mood || typeof m.mood !== 'string') E(`${where}: music needs a mood`);
    if (!(num(m.intensity) && m.intensity >= 0 && m.intensity <= 1)) E(`${where}: music intensity ${m.intensity} outside 0..1`);
  };
  beats.forEach((b, i) => {
    const id = isHold(b) ? b.hold : (b as MoveJson).move;
    const where = `beat ${i} '${id}'`;
    if (typeof id !== 'string' || !KEBAB.test(id)) E(`${where}: ids are kebab-case`);
    if (ids.has(id)) E(`${where}: id repeats`);
    ids.add(id);
    if (i > 0 && isHold(b) === isHold(beats[i - 1])) E(`${where}: beats must alternate hold / move`);
    if (isHold(b)) {
      unknownKeys(b, HOLD_KEYS, where);
      if (!HOLD_STYLES.includes(b.style)) E(`${where}: style '${b.style}'`);
      if (!(num(b.dur) && b.dur > 0)) E(`${where}: dur ${b.dur}`);
      else total += b.dur;
      const cam = b.camera ?? {};
      const refs = [cam.bookmark, cam.shot, cam.orbit].filter((x) => x !== undefined).length;
      if (refs !== 1) E(`${where}: the camera needs exactly one of bookmark / shot / orbit`);
      if (cam.bookmark && !bookmarks.has(cam.bookmark)) E(`${where}: unknown bookmark '${cam.bookmark}'`);
      if (cam.shot) {
        const s = allShots.find((x) => x.id === cam.shot);
        if (!s) E(`${where}: unknown shot '${cam.shot}'`);
        else if (!('orbit' in s.camera)) E(`${where}: shot '${cam.shot}' is not an orbit shot`);
        else if (!pageShots.has(cam.shot)) E(`${where}: shot '${cam.shot}' lives in data/qa/shots.d — the page compiles the film with data/qa/shots.json only`);
      }
      if (cam.orbit && !cam.orbit.place && !cam.orbit.targetKm) E(`${where}: the orbit needs place or targetKm`);
      if (cam.orbit?.place && !places.has(cam.orbit.place)) E(`${where}: unknown place '${cam.orbit.place}'`);
      if (cam.set) unknownKeys(cam.set, SET_KEYS, `${where} camera.set`);
      if (b.drift) unknownKeys(b.drift, DRIFT_KEYS, `${where} drift`);
      if (b.place && !places.has(b.place)) E(`${where}: unknown place '${b.place}'`);
      if (b.head && !marks.has(b.head)) E(`${where}: head '${b.head}' is not a route mark`);
      if (!b.head && b.place && !marks.has(b.place) && b.style !== 'open' && b.style !== 'end') W(`${where}: place '${b.place}' is not a route mark — the head stays on the previous mark (set head)`);
      if (!(Array.isArray(b.tod) && b.tod.length === 2 && b.tod.every(num) && b.tod[0] <= b.tod[1] && b.tod[0] >= 0 && b.tod[1] < 24)) E(`${where}: tod ${JSON.stringify(b.tod)} must be [start ≤ end] hours`);
      else {
        if (b.tod[0] < lastTod - 1e-9) E(`${where}: tod ${b.tod[0]} runs backwards (previous hold ended at ${lastTod})`);
        lastTod = b.tod[1];
      }
      if (b.routeGlow !== undefined && !(num(b.routeGlow) && b.routeGlow >= 0 && b.routeGlow <= 1)) E(`${where}: routeGlow ${b.routeGlow}`);
      if (b.look) {
        if (!looks.has(b.look.id)) E(`${where}: unknown look '${b.look.id}'`);
        if (!(num(b.look.weight) && b.look.weight >= 0 && b.look.weight <= 1)) E(`${where}: look weight ${b.look.weight} outside 0..1`);
      }
      if (b.lens) {
        const fs = b.lens.fStop;
        if (fs === 'bookmark') {
          const fsOf = cam.bookmark ? bookmarks.get(cam.bookmark)?.fStop : cam.shot ? allShots.find((x) => x.id === cam.shot)?.fStop : undefined;
          if (fsOf === undefined) W(`${where}: lens 'bookmark' but the camera reference has no fStop (deep focus)`);
        } else if (!(num(fs) && fs > 0)) E(`${where}: lens fStop ${fs}`);
      }
      if (b.light && !['silhouette', 'shade'].includes(b.light)) E(`${where}: light '${b.light}'`);
      for (const c of b.captions ?? []) checkCaption(c, where, num(b.dur) ? b.dur : null);
      checkEvents(b.events, where, num(b.dur) ? b.dur : null);
      checkMusic(b.music, where);
    } else {
      const m = b as MoveJson;
      unknownKeys(m, MOVE_KEYS, where);
      if (m.dur === 'auto') autoMoves++;
      else if (!(num(m.dur) && m.dur > 0)) E(`${where}: dur ${m.dur} (seconds or 'auto')`);
      else total += m.dur;
      if (m.maxAltKm !== undefined && !(num(m.maxAltKm) && m.maxAltKm > 0)) E(`${where}: maxAltKm ${m.maxAltKm}`);
      if (m.rho !== undefined && !(num(m.rho) && m.rho > 0)) E(`${where}: rho ${m.rho}`);
      if (m.apexEl !== undefined && !(num(m.apexEl) && m.apexEl >= -10 && m.apexEl < 90)) E(`${where}: apexEl ${m.apexEl}`);
      if (m.crossDeck !== undefined && typeof m.crossDeck !== 'boolean') E(`${where}: crossDeck must be boolean`);
      for (const c of m.captions ?? []) checkCaption(c, where, num(m.dur) ? m.dur : null);
      checkEvents(m.events, where, num(m.dur) ? m.dur : null);
      checkMusic(m.music, where);
    }
  });
  if (!autoMoves && Array.isArray(f.lengthS) && (total < f.lengthS[0] || total > f.lengthS[1])) E(`the film runs ${fmt(total)} s, outside film.lengthS [${f.lengthS.join(', ')}]`);
  // ---- shotlist.json: a segment's route names a route leg (its beats are checked on the compiled film)
  try {
    const sl = readJson<{ segments: { id: string; route?: string | null }[] }>('data/tour/shotlist.json');
    for (const s of sl.segments ?? []) if (s.route !== null && s.route !== undefined && !legIds.has(s.route)) E(`data/tour/shotlist.json segment ${s.id}: route '${s.route}' is not a leg of route.json (${[...legIds].join(', ')})`);
  } catch (e) {
    E(`data/tour/shotlist.json does not parse: ${(e as Error).message}`);
  }
  out.info.push(`film: timeline v1 ${tl.status}, ${beats.length} beats, ${autoMoves ? `${autoMoves} auto move(s) (length on the compiled film)` : `${fmt(total)} s`}; route ${route.legs?.length ?? 0} legs, ${marks.size} marks`);
  return out;
}

// ───────────────────────────── on the baked world ─────────────────────────────

interface BeatStats {
  S: number;
  peakV: number;
  peakRot: number;
  maxD: number;
  minClear: number;
  lit: number | null;
  key: string;
  findings: string[];
}

export interface FilmCheckOptions {
  /** compile with the landmark build (caption anchors at 0.6 × the built height; the page's intended input) */
  built?: boolean;
  /** collect the per-beat table rows */
  table?: boolean;
}

export interface FilmCheckResult extends CheckResult {
  table: string[];
  program: FilmProgram | null;
  timeline: TimelineJson;
}

/** the sky's studio void: its blend from the horizon haze into the dark backdrop (src/environment/sky.ts voidFalloff) */
const VOID_FALLOFF = 0.3;

/**
 * The board's edge as the frame shows it: rays through the top 15 % of the frame (a cols × rows grid, the
 * top rows of it) that look down past the floating board into the studio void, each weighted by how dark
 * the sky shader draws that void — 1 − (1 − min(1, depression / VOID_FALLOFF))³ (sin of the depression):
 * a void just under the horizon is still the bright horizon haze (the far board edge melts into it), one
 * 10° down is the dark backdrop. Returns the weighted share of the top rows (0 = land or sky up there).
 */
export function visibleTopVoid(
  ctx: { world: World; H(x: number, z: number): number; WL(x: number, z: number): number },
  cam: CameraState,
  cols = 32,
  rows = 18,
): number {
  const spec = ctx.world.spec;
  const [px, py, pz] = cam.position;
  let fx = cam.target[0] - px;
  let fy = cam.target[1] - py;
  let fz = cam.target[2] - pz;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const tanV = Math.tan((cam.fov * Math.PI) / 360);
  const tanH = tanV * (16 / 9);
  const inside = (x: number, z: number) => x >= spec.xMin && x <= spec.xMax && z >= spec.zMin && z <= spec.zMax;
  let sum = 0;
  let n = 0;
  for (let j = 0; j < rows * 0.15; j++)
    for (let i = 0; i < cols; i++) {
      n++;
      const sx = ((i + 0.5) / cols) * 2 - 1;
      const sy = 1 - ((j + 0.5) / rows) * 2;
      let dx = fx + rx * sx * tanH + ux * sy * tanV;
      let dy = fy + uy * sy * tanV;
      let dz = fz + rz * sx * tanH + uz * sy * tanV;
      const dl = Math.hypot(dx, dy, dz);
      dx /= dl;
      dy /= dl;
      dz /= dl;
      if (dy >= 0) continue; // sky
      // march down to the ground (or out of the board): the probe's step rule
      let hit = false;
      for (let t = 0.05; ; t += Math.max(0.05, t * 0.008)) {
        const x = px + dx * t;
        const y = py + dy * t;
        const z = pz + dz * t;
        if (!inside(x, z) || y < -44.6) break;
        if (y < Math.max(ctx.H(x, z), ctx.WL(x, z))) {
          hit = true;
          break;
        }
      }
      if (hit) continue;
      const u = Math.min(1, -dy / VOID_FALLOFF);
      sum += 1 - (1 - u) ** 3;
    }
  return n ? sum / n : 0;
}

/** Vogel-spiral disk of n points of radius r around (0, 0). */
function vogel(n: number, r: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const rr = r * Math.sqrt((i + 0.5) / n);
    const th = i * 2.399963229728653;
    out.push([rr * Math.cos(th), rr * Math.sin(th)]);
  }
  return out;
}

export async function checkFilm(world: World, landmarks: LandmarkDefinition[], opts: FilmCheckOptions = {}): Promise<FilmCheckResult> {
  const tl = readJson<TimelineJson>('data/tour/timeline.json');
  const out: FilmCheckResult = { errors: [], warnings: [], info: [], table: [], program: null, timeline: tl };
  const E = (m: string) => out.errors.push(`film: ${m}`);
  const locked = tl.status === 'locked';
  const route = readJson<RouteJson>('data/tour/route.json');
  const shots = readJson<{ shots: ShotSpecInput[] }>('data/qa/shots.json').shots;
  const { compileFilm } = (await import(mod('src/tour/compile.ts'))) as typeof import('../../src/tour/compile.ts');
  const { forgetWaterField, routeReport, FLOAT_WARN_KM } = (await import(mod('src/tour/route.ts'))) as typeof import('../../src/tour/route.ts');
  const { projectToNdc, captionReveal } = (await import(mod('src/tour/captions.ts'))) as typeof import('../../src/tour/captions.ts');
  const { projectToScreen, visibility, onScreen } = (await import(mod('src/titles/layout.ts'))) as typeof import('../../src/titles/layout.ts');
  const { TitleSystem, titleSubjects } = (await import(mod('src/titles/TitleSystem.ts'))) as typeof import('../../src/titles/TitleSystem.ts');
  const { RouteSystem } = (await import(mod('src/route/RouteSystem.ts'))) as typeof import('../../src/route/RouteSystem.ts');
  const { pathModeAt } = (await import(mod('src/route/path.ts'))) as typeof import('../../src/route/path.ts');
  const { ROUTE_MODE } = (await import(mod('src/tour/schema.ts'))) as typeof import('../../src/tour/schema.ts');
  const { CLEAR, DECK_BELOW_KM, DECK_COVER } = (await import(mod('src/tour/rig.ts'))) as typeof import('../../src/tour/rig.ts');
  const { createProbeContext, probeCamera } = await import('./probe.ts');
  const { LandmarkSystem } = (await import(mod('src/landmarks/LandmarkSystem.ts'))) as typeof import('../../src/landmarks/LandmarkSystem.ts');
  const { buildLandmarks } = (await import(mod('src/landmarks/build.ts'))) as typeof import('../../src/landmarks/build.ts');
  const { MODEL_LODS } = (await import(mod('src/landmarks/model.ts'))) as typeof import('../../src/landmarks/model.ts');
  const TOD = (await import(mod('src/environment/timeOfDay.ts'))) as typeof import('../../src/environment/timeOfDay.ts');
  const { Vector3 } = await import('three/webgpu');

  const phase: [string, number][] = [];
  let tPhase = performance.now();
  const lap = (name: string) => {
    const now = performance.now();
    phase.push([name, now - tPhase]);
    tPhase = now;
  };
  const ctx = await createProbeContext(undefined, { world, landmarks, stamps: [] });
  lap('probe context');
  const built = opts.built === false ? undefined : ctx.built;

  // ---- compile twice (the second time with a fresh water field): same hash
  let program: FilmProgram;
  let ms: number;
  try {
    const c0 = performance.now();
    program = compileFilm({ world, landmarks, shots, route, timeline: tl, built });
    ms = performance.now() - c0;
    forgetWaterField(world);
    const again = compileFilm({ world, landmarks, shots, route, timeline: tl, built });
    if (again.film.hash !== program.film.hash) E(`compiling twice gives different hashes (${program.film.hash} vs ${again.film.hash})`);
  } catch (e) {
    E(`the film does not compile: ${(e as Error).message}`);
    return out;
  }
  out.program = program;
  lap('compile ×2');
  const { film, rig } = program;
  const beats = tl.beats;
  const isHold = (b: BeatJson): b is HoldJson => 'hold' in b;
  const beatId = (i: number) => (isHold(beats[i]) ? (beats[i] as HoldJson).hold : (beats[i] as MoveJson).move);
  if (film.duration < tl.film.lengthS[0] || film.duration > tl.film.lengthS[1]) E(`the compiled film runs ${fmt(film.duration)} s, outside film.lengthS [${tl.film.lengthS.join(', ')}]`);

  // ---- the route
  const R = film.route;
  const rr = routeReport(R, { surface: rig.water.surface, liftKm: route.defaults.liftKm });
  const jumpLegs = (cliff: boolean) => [...new Set(rr.jumps.filter((j) => !!j.cliff === cliff).map((j) => j.leg))].join(', ');
  const nCliff = rr.jumps.filter((j) => j.cliff).length;
  const fl = rr.float!;
  out.info.push(
    `film: route ${fmt(R.length)} km, ${R.count} samples, ${R.legs.length} legs, hash ${R.hash}; ${rr.crossings.length} self-crossings, ${rr.kinks.length} kinks > 120°; float above the surface under the line max ${fmt(fl.max, 3)} km (${fl.leg}, s ${fmt(fl.s)}), ${fl.over} samples > ${FLOAT_WARN_KM} km; ${rr.jumps.length} height steps > 1 km (largest ${fmt(rr.maxStep, 2)} km${nCliff ? `; ${nCliff} cliffs under the line: ${jumpLegs(true)}` : ''}${rr.jumps.length - nCliff ? `; ${rr.jumps.length - nCliff} drape lifts: ${jumpLegs(false)}` : ''})`,
  );
  const routeFinding = (msg: string) => (locked ? out.errors : out.warnings).push(`film: ${msg}`);
  if (fl.over)
    routeFinding(
      `the route line floats > ${FLOAT_WARN_KM} km above the ground under it at ${fl.over} samples (max ${fmt(fl.max, 2)} km at s ${fmt(fl.s)}; ${Object.entries(fl.overByLeg)
        .map(([l, c]) => `${l} ${c}`)
        .join(', ')})`,
    );
  const sampledFinding = (i: number, msg: string, hard = false) => {
    stats[i].findings.push(msg);
    (locked || hard ? out.errors : out.warnings).push(`film: ${beatId(i)}: ${msg}`);
  };
  const stats: BeatStats[] = beats.map(() => ({ S: NaN, peakV: 0, peakRot: 0, maxD: 0, minClear: Infinity, lit: null, key: '', findings: [] }));
  for (const c of rr.crossings) routeFinding(`the route crosses itself at s ${fmt(c[0])} / ${fmt(c[1])} km`);
  for (const k of rr.kinks) routeFinding(`the route kinks ${fmt(k.deg, 0)}° at s ${fmt(k.s)} km (${k.leg})`);

  // ---- 24 Hz samples of the rig
  const HZ = 24;
  const h = 1 / HZ;
  const K = Math.floor(film.duration * HZ);
  const poses = Array.from({ length: K + 1 }, (_, k) => rig.pose(k * h));
  const states = Array.from({ length: K + 1 }, (_, k) => program.evaluate(k * h));
  const beatOf = poses.map((p) => p.beat);
  const fwd = poses.map((p) => {
    const d = [p.tx - p.position[0], p.ty - p.position[1], p.tz - p.position[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  });
  const camOf = (k: number): CameraState => states[k].camera;
  const style = (i: number) => (isHold(beats[i]) ? (beats[i] as HoldJson).style : 'move');
  const moveOf = (i: number) => rig.moves[rig.moveOfBeat[i]];
  for (let i = 0; i < beats.length; i++) if (!isHold(beats[i])) stats[i].S = moveOf(i).path.S;

  // speed, rotation, distance, clearance, deck, tod rate
  const V = new Float64Array(K + 1);
  const J = new Float64Array(K + 1);
  const counts = beats.map(() => ({ vHold: 0, vWarn: 0, vErr: 0, rot: 0, clear: 0, dcHero: 0, dcMax: 0, dcAt: 0, deck: 0, deckMax: 0, tod: 0, todMax: 0, todDev: 0 }));
  for (let k = 0; k <= K; k++) {
    const i = beatOf[k];
    const p = poses[k];
    const st = stats[i];
    const c = counts[i];
    st.maxD = Math.max(st.maxD, p.dist);
    // clearance (5 taps, as the rig)
    const r = CLEAR.tapBase + CLEAR.tapPerD * p.dist;
    const P = p.position;
    const top = Math.max(rig.water.surface(P[0], P[2]), rig.water.surface(P[0] + r, P[2]), rig.water.surface(P[0] - r, P[2]), rig.water.surface(P[0], P[2] + r), rig.water.surface(P[0], P[2] - r));
    const clear = P[1] - top;
    st.minClear = Math.min(st.minClear, clear);
    if (clear < FILM_LIMITS.minClearKm) c.clear++;
    if (style(i) === 'hero' && p.dC > FILM_LIMITS.heroLiftKm) {
      c.dcHero++;
      if (p.dC > c.dcMax) {
        c.dcMax = p.dC;
        c.dcAt = k * h;
      }
    }
    // the deck
    if (!rig.deckExempt(i)) {
      const d = rig.deckAt(P[0], P[2]);
      if (d.cover >= DECK_COVER[1] && P[1] > d.height - DECK_BELOW_KM + FILM_LIMITS.deckTolKm) {
        c.deck++;
        c.deckMax = Math.max(c.deckMax, P[1] - (d.height - DECK_BELOW_KM));
      }
    }
    if (k > 0 && k < K) {
      // perceived speed (frame widths / s) and view rotation (° / s), central differences
      const a = poses[k - 1];
      const b = poses[k + 1];
      const v = Math.hypot(Math.hypot(b.tx - a.tx, b.tz - a.tz) / (2 * h) / p.w, (Math.log(b.w) - Math.log(a.w)) / (2 * h));
      V[k] = v;
      st.peakV = Math.max(st.peakV, v);
      const fa = fwd[k - 1];
      const fb = fwd[k + 1];
      const rot = (Math.acos(Math.min(1, fa[0] * fb[0] + fa[1] * fb[1] + fa[2] * fb[2])) * 180) / Math.PI / (2 * h);
      st.peakRot = Math.max(st.peakRot, rot);
      if (isHold(beats[i])) {
        if (v > FILM_LIMITS.holdV) c.vHold++;
        if (rot > FILM_LIMITS.holdRotDeg) c.rot++;
      } else {
        if (v > FILM_LIMITS.moveVError) c.vErr++;
        else if (v > FILM_LIMITS.moveVWarn) c.vWarn++;
        if (rot > FILM_LIMITS.moveRotDeg) c.rot++;
      }
    }
    if (k + 2 <= K && k >= 1) {
      const q = [poses[k - 1].position, poses[k].position, poses[k + 1].position, poses[k + 2].position];
      let j2 = 0;
      for (let a = 0; a < 3; a++) j2 += (q[3][a] - 3 * q[2][a] + 3 * q[1][a] - q[0][a]) ** 2;
      J[k] = Math.sqrt(j2) / h ** 3 / p.w;
    }
    // tod exactly linear inside a hold (at the frame time the slow channels use)
    if (isHold(beats[i])) {
      const hj = beats[i] as HoldJson;
      const tq = Math.min(film.duration, Math.floor(k * h * film.fps + 1e-6) / film.fps);
      const u = clamp01((tq - rig.t0s[i]) / rig.durs[i]);
      c.todDev = Math.max(c.todDev, Math.abs(states[k].tod - (hj.tod[0] + (hj.tod[1] - hj.tod[0]) * u)));
    }
    if (k < K) {
      const rate = Math.abs(states[k + 1].tod - states[k].tod) * HZ;
      const lim = isHold(beats[i]) ? FILM_LIMITS.holdTodRate : FILM_LIMITS.moveTodRate;
      if (rate > lim + 1e-9) {
        c.tod++;
        c.todMax = Math.max(c.todMax, rate);
      }
    }
  }
  // look ids switch only at weight 0
  for (let k = 1; k <= K; k++) {
    const a = states[k - 1];
    const b = states[k];
    if (a.lookOverride && b.lookOverride && a.lookOverride !== b.lookOverride) E(`the look switches ${a.lookOverride} → ${b.lookOverride} at ${fmt(k * h, 2)} s without passing weight 0`);
    else if (a.lookOverride !== b.lookOverride && Math.max(a.lookOverrideWeight ?? 0, b.lookOverrideWeight ?? 0) > 0.05) E(`the look ${a.lookOverride ?? 'none'} → ${b.lookOverride ?? 'none'} switches at weight ${fmt(Math.max(a.lookOverrideWeight ?? 0, b.lookOverrideWeight ?? 0), 2)} (${fmt(k * h, 2)} s)`);
  }
  // jerk spikes: far above the beat's own median
  for (let i = 0; i < beats.length; i++) {
    const js: number[] = [];
    for (let k = 1; k + 2 <= K; k++) if (beatOf[k] === i) js.push(J[k]);
    if (!js.length) continue;
    const sorted = [...js].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const peak = sorted[sorted.length - 1];
    if (peak > FILM_LIMITS.jerkFloor && peak > FILM_LIMITS.jerkSpike * Math.max(med, 0.05)) sampledFinding(i, `jerk spike ${fmt(peak, 1)} frame widths/s³ (median ${fmt(med, 2)})`);
  }
  counts.forEach((c, i) => {
    const hold = isHold(beats[i]);
    if (c.vHold) sampledFinding(i, `perceived speed ${fmt(stats[i].peakV, 2)} > ${FILM_LIMITS.holdV} frame widths/s in a hold (${c.vHold} samples)`);
    if (c.vErr) sampledFinding(i, `perceived speed ${fmt(stats[i].peakV, 2)} > ${FILM_LIMITS.moveVError} frame widths/s (${c.vErr} samples)`, locked);
    else if (c.vWarn) {
      stats[i].findings.push(`speed ${fmt(stats[i].peakV, 2)}`);
      out.warnings.push(`film: ${beatId(i)}: perceived speed ${fmt(stats[i].peakV, 2)} > ${FILM_LIMITS.moveVWarn} frame widths/s (${c.vWarn} samples)`);
    }
    if (c.rot) sampledFinding(i, `view rotation ${fmt(stats[i].peakRot, 1)} > ${hold ? FILM_LIMITS.holdRotDeg : FILM_LIMITS.moveRotDeg} °/s (${c.rot} samples)`);
    if (c.clear) sampledFinding(i, `camera within ${FILM_LIMITS.minClearKm} km of the ground / water (${c.clear} samples, min ${fmt(stats[i].minClear, 3)} km)`);
    if (style(i) === 'hero') {
      // the hold's own framing (the rig's raw need inside it) vs lift bleeding in from a neighbouring move
      const tr = rig.tracks.need;
      let need = 0;
      for (let j = Math.ceil(rig.t0s[i] * tr.hz); j <= Math.floor((rig.t0s[i] + rig.durs[i]) * tr.hz) && j < tr.v.length; j++) need = Math.max(need, tr.v[j]);
      if (need > FILM_LIMITS.heroLiftKm) E(`${beatId(i)}: the hero hold's own framing needs a clearance lift of ${fmt(need, 2)} km (the camera dips under the ground + margin) — the framing is wrong, not the rig`);
      else if (c.dcHero) {
        const from = c.dcAt > rig.t0s[i] + rig.durs[i] / 2 ? beatId(i + 1) : beatId(i - 1);
        sampledFinding(i, `clearance lift ${fmt(c.dcMax, 2)} km bleeds into the hero hold from ${from} (${c.dcHero} samples; the hold's own framing clears) — re-aim the far hold or reshape the move`);
      }
    }
    if (c.todDev > FILM_LIMITS.todLinearH) sampledFinding(i, `tod not linear inside the hold (${fmt(c.todDev * 3600, 1)} s of clock off the keys' line) — the neighbouring move keeps no tod change`);
    if (c.deck) sampledFinding(i, `camera up to ${fmt(c.deckMax, 2)} km above the ash deck − ${DECK_BELOW_KM} km (${c.deck} samples)`);
    if (c.tod) sampledFinding(i, `tod rate ${fmt(c.todMax, 3)} h/s > ${hold ? FILM_LIMITS.holdTodRate : FILM_LIMITS.moveTodRate} (${c.tod} samples)`);
  });

  lap('24 Hz samples');
  // ---- 8 Hz: route head on screen (moves), labels, LOD stability (holds) — judged with the page's own code:
  // the head as the RouteSystem draws it (headPoint: the near / far path at the head's depth), the labels
  // as the TitleSystem places them (anchorPoint: the diamond moves onto the route head while the head rests
  // on its subject; subjectVisible over the HeightField), laid out at the shutter's centre as in the film
  const ASPECT = 16 / 9;
  const LW = 1600;
  const LH = 900;
  const heightAt = (x: number, z: number) => world.heights.sample(x, z);
  const routeSys = new RouteSystem(world, R);
  const headOf = (st: SceneState): V3 | null => routeSys.headPoint(st, [0, 0, 0]);
  for (const m of rig.moves) {
    let n = 0;
    let on = 0;
    let hid = 0;
    for (let k = Math.ceil((m.t0 + 0.5) * HZ); k <= Math.floor(m.t1 * HZ) && k <= K; k += 3) {
      if ((states[k].routeGlow ?? 1) <= 0.01) continue;
      const hp = headOf(states[k]);
      if (!hp) continue;
      n++;
      const cam = camOf(k);
      const [x, y, d] = projectToNdc(cam, hp, ASPECT);
      if (!(d > 0 && Math.abs(x) <= FILM_LIMITS.headOnScreen && Math.abs(y) <= FILM_LIMITS.headOnScreen)) continue;
      // in frame AND not behind terrain (the head's last 0.6 km — its own ground — untested); under the
      // mountains (Moria) the line is drawn as x-ray dots through the rock: visible by design
      const under = pathModeAt(routeSys.path, clamp01(states[k].routeProgress) * R.length) === ROUTE_MODE.underground;
      if (under || visibility(cam.position as V3, hp, heightAt) >= 0.5) on++;
      else hid++;
    }
    // on screen (in frame) ≥ headShare; visible (in frame and not behind terrain) ≥ headVisibleShare
    if (n && (on + hid) / n < FILM_LIMITS.headShare) sampledFinding(m.beat, `route head on screen ${fmt((100 * (on + hid)) / n, 0)} % of the move (< ${100 * FILM_LIMITS.headShare} %)`);
    if (n && on / n < FILM_LIMITS.headVisibleShare) sampledFinding(m.beat, `route head visible ${fmt((100 * on) / n, 0)} % of the move (< ${100 * FILM_LIMITS.headVisibleShare} %; ${hid} samples in frame but behind terrain)`);
  }
  // labels: the TitleSystem itself (its pure per-state helpers) with the page's inputs (boot.ts): subjects
  // from the build (titleSubjects; no silhouette triangles in Node — they only steer the side choice), the
  // HeightField, the route head as drawn. Each sample = one film frame tF, laid out at the shutter's centre.
  const titles = new TitleSystem(film.captions, {
    fps: film.fps,
    shutter: film.shutter,
    stateAt: (t) => program.evaluate(t),
    heightAt,
    subjects: titleSubjects(ctx.built, heightAt),
    headAt: (st, o) => routeSys.headPoint(st, o),
  }) as unknown as TitleInternals;
  for (const fn of ['anchorPoint', 'subjectVisible'] as const)
    if (typeof titles[fn] !== 'function') throw new Error(`film check: TitleSystem.${fn} is gone — mirror the TitleSystem's label point / visibility here again`);
  const layoutAt = (tF: number): SceneState => program.evaluate(film.shutter > 0 ? tF + (0.5 * film.shutter) / film.fps : tF);
  for (const c of film.captions) {
    if (!c.anchor) continue;
    let n = 0;
    let bad = 0;
    let off = 0;
    let hidden = 0;
    let minVis = 1;
    let worst = '';
    for (let k = Math.ceil(c.t0 * HZ); k <= Math.floor(c.t1 * HZ) && k <= K; k += 3) {
      if (captionReveal(c, k * h) < 0.05) continue;
      n++;
      const ls = layoutAt(k * h);
      const P = titles.anchorPoint(c, ls);
      const A = projectToScreen(ls.camera, P, LW, LH);
      const os = A ? onScreen(A, LW, LH, LABEL_OFFSCREEN_FADE * LH) : 0;
      const sv = titles.subjectVisible(c, ls, P);
      // the page draws the label at opacity onScreen × subjectVisible (× reveal): below 0.5 it has faded
      if (!A || os * sv < 0.5) {
        if (!A || os < 0.5) off++;
        else {
          hidden++;
          minVis = Math.min(minVis, sv);
        }
        continue;
      }
      const x = (2 * A.x) / LW - 1;
      const y = 1 - (2 * A.y) / LH;
      // the diamond on the route head (blended more than half way toward it) may sit lower
      const hp = headOf(ls);
      const onHead = !!hp && Math.hypot(P[0] - hp[0], P[1] - hp[1], P[2] - hp[2]) < Math.hypot(P[0] - c.anchor[0], P[1] - c.anchor[1], P[2] - c.anchor[2]);
      const yMin = onHead ? FILM_LIMITS.headSafeYMin : FILM_LIMITS.safeY[0];
      if (!(Math.abs(x) <= FILM_LIMITS.safeX && y >= yMin && y <= FILM_LIMITS.safeY[1])) {
        bad++;
        worst = `(${fmt(x, 2)}, ${fmt(y, 2)})`;
      }
    }
    const beat = beats.findIndex((b) => (isHold(b) ? b.hold : (b as MoveJson).move) === c.id.split(':')[0]);
    if (off) sampledFinding(beat, `label ${c.id} off frame (its diamond outside the frame: the page fades it out) in ${off}/${n} samples`);
    if (bad) sampledFinding(beat, `label ${c.id}: its diamond (the anchor, or the route head resting on the subject) outside the safe zone in ${bad}/${n} samples (e.g. NDC ${worst})`);
    if (hidden) sampledFinding(beat, `label ${c.id} hidden (its subject behind terrain, visibility ${fmt(minVis, 2)}: the page fades it out) in ${hidden}/${n} samples`);
  }
  // the board's edge at the top of a move's frame (the dark studio void beyond the floating board where the
  // land should run to the horizon): visibleTopVoid at 4 Hz while the view is narrower than the board. Moves
  // to or from an overview hold (the opening descent, the closing pull-out) are exempt: they travel between
  // the land and the whole floating board, whose edge and the void round it are that shot's subject.
  const overviewMove = (m: (typeof rig.moves)[number]) => [m.a, m.b].some((j) => ['open', 'end'].includes(style(j)));
  for (const m of rig.moves) {
    if (overviewMove(m)) continue;
    let bad = 0;
    let worst = 0;
    let first = -1;
    let last = -1;
    for (let k = Math.ceil(m.t0 * HZ); k <= Math.floor(m.t1 * HZ) && k <= K; k += 6) {
      if (poses[k].w > FILM_LIMITS.moveVoidMaxW) continue;
      const v = visibleTopVoid(ctx, camOf(k));
      if (v > FILM_LIMITS.moveTopVoid) {
        bad++;
        worst = Math.max(worst, v);
        if (first < 0) first = k * h;
        last = k * h;
      }
    }
    if (bad) sampledFinding(m.beat, `the board's edge in the top of the frame (visible void up to ${fmt(100 * worst, 0)} % of the top rows > ${100 * FILM_LIMITS.moveTopVoid} %) at ${fmt(first, 2)}–${fmt(last, 2)} s (${bad} samples at 4 Hz)`);
  }
  const lodBias = tl.film.lodBias ?? 1;
  // the landmark's real LOD count (the page passes levels.length to selectLod): the Node build keeps no
  // geometry (lods: []), so a landmark that switches under the 3-level assumption is rebuilt with geometry
  // (lazily — usually never) and a GLB landmark has at least MODEL_LODS levels
  const lodLevels = new Map<string, number>();
  const levelsOf = async (b: BuiltLandmark): Promise<number> => {
    const known = lodLevels.get(b.id);
    if (known !== undefined) return known;
    const [full] = await buildLandmarks(world, [b.def], { ao: false });
    const n = Math.max(full.lods.length, b.def.model ? MODEL_LODS : 0);
    for (const lod of full.lods) for (const g of lod.values()) g.dispose();
    lodLevels.set(b.id, n);
    return n;
  };
  for (const key of rig.keys) {
    const changed: string[] = [];
    for (const b of ctx.built) {
      const seen: number[] = [];
      for (let k = Math.ceil(key.t0 * HZ); k <= Math.floor(key.t1 * HZ) && k <= K; k += 3) {
        const cam = camOf(k);
        const [x, y, d] = projectToNdc(cam, b.bounds.center, ASPECT);
        if (!(d > 0 && Math.abs(x) <= 1.2 && Math.abs(y) <= 1.2)) continue;
        seen.push(LandmarkSystem.selectLod(b, { x: cam.position[0], y: cam.position[1], z: cam.position[2] }, cam.fov, 1080, 3, lodBias));
      }
      if (new Set(seen).size < 2) continue;
      const top = (await levelsOf(b)) - 1;
      const real = new Set(seen.map((L) => Math.min(L, top)));
      if (real.size > 1) changed.push(`${b.id} ${[...real].sort().join('/')}`);
    }
    if (changed.length) sampledFinding(key.beat, `landmark LOD switches inside the hold: ${changed.join(', ')}`);
  }

  lap('head / anchors / LOD');
  // ---- the camera probe: hold middles; moves every 1 s
  for (const key of rig.keys) {
    if (key.style === 'open' || key.style === 'end') continue;
    const k = Math.round(key.tMid * HZ);
    // the hold's subject: its label's landmark, else the bookmark's
    const hj = beats[key.beat] as HoldJson;
    const subject = hj.captions?.find((c) => c.landmark)?.landmark ?? key.landmark;
    const r = probeCamera(ctx, key.id, camOf(k), { subject });
    if (r.topVoid > FILM_LIMITS.topVoid) sampledFinding(key.beat, `probe: top void ${fmt(100 * r.topVoid, 0)} % at the hold's middle`);
    if (r.void + r.edge > FILM_LIMITS.holdVoid) sampledFinding(key.beat, `probe: void ${fmt(100 * (r.void + r.edge), 0)} % at the hold's middle`);
    const s = r.subject;
    const onScreen = !!s && s.pxH >= FILM_LIMITS.subjectPx && s.topNdcY > -1 && s.bottomNdcY < 1 && Math.abs(s.centerNdcX) < 1;
    if (subject && (!onScreen || s!.visible < FILM_LIMITS.subjectVisible || r.losGround > 0))
      sampledFinding(key.beat, `probe: subject ${subject} not framed at the hold's middle (${s ? `${fmt(s.pxH, 0)} px, ${fmt(100 * s.visible, 0)} % visible, NDC x ${fmt(s.centerNdcX, 2)} y ${fmt(s.bottomNdcY, 2)}…${fmt(s.topNdcY, 2)}` : 'not measured'}, line of sight to the target ground ${r.losGround > 0 ? 'blocked' : 'clear'})`);
  }
  for (const m of rig.moves) {
    let worst = 0;
    let at = 0;
    for (let t = Math.ceil(m.t0); t < m.t1; t += 1) {
      const k = Math.round(t * HZ);
      if (k > K || poses[k].w > FILM_LIMITS.moveVoidMaxW) continue;
      const r = probeCamera(ctx, m.id, camOf(k), { grid: [24, 14] });
      if (r.void + r.edge > worst) {
        worst = r.void + r.edge;
        at = t;
      }
    }
    if (worst > FILM_LIMITS.moveVoid) sampledFinding(m.beat, `probe: void ${fmt(100 * worst, 0)} % at ${fmt(at, 0)} s`);
  }

  lap('probes');
  // ---- light per hold: the key light on the subject's ground, backlight
  const disk = vogel(49, 3);
  const o = new Vector3();
  const dir = new Vector3();
  const lmById = new Map(landmarks.map((d) => [d.id, d]));
  for (const key of rig.keys) {
    const hj = beats[key.beat] as HoldJson;
    // the subject's ground, as the probe's subject: the label's landmark, else the bookmark's, else the place
    const subject = hj.captions?.find((c) => c.landmark)?.landmark ?? key.landmark;
    const placeId = (subject ? lmById.get(subject)?.placeId : undefined) ?? hj.place;
    if (!placeId) continue;
    const p = world.place(placeId);
    const k = Math.round(key.tMid * HZ);
    const tod = states[k].tod;
    const sun = TOD.sunDirection(tod, tl.film.dayOfYear, new Vector3());
    const sunEl = (Math.asin(sun.y) * 180) / Math.PI;
    const keyIsMoon = sunEl <= -4;
    const keyDir = keyIsMoon ? TOD.moonDirection(tod, tl.film.dayOfYear, TOD.moonPhase(tl.film.dayOfYear, tod), new Vector3()) : sun;
    const deck = rig.deckAt(p.x, p.z);
    stats[key.beat].key = keyIsMoon ? 'moon' : 'sun';
    let lit = 0;
    if (keyDir.y > 0)
      for (const [dx, dz] of disk) {
        const x = p.x + dx;
        const z = p.z + dz;
        o.set(x, rig.water.surface(x, z) + 0.03, z);
        dir.copy(keyDir);
        if (world.heights.raycast(o, dir, 400) === null) lit++;
      }
    const share = lit / disk.length;
    stats[key.beat].lit = share;
    if (deck.cover >= DECK_COVER[1]) stats[key.beat].key += ' (deck)';
    else if (share < FILM_LIMITS.litShare && !hj.light) sampledFinding(key.beat, `light: ${fmt(100 * share, 0)} % of the subject's ground sees the ${keyIsMoon ? 'moon' : 'sun'} (< ${100 * FILM_LIMITS.litShare} %; mark light: 'shade' | 'silhouette' if intended)`);
    if (!keyIsMoon && sunEl > -2 && hj.light !== 'silhouette') {
      const f = fwd[k];
      const ang = (Math.acos(Math.min(1, f[0] * sun.x + f[1] * sun.y + f[2] * sun.z)) * 180) / Math.PI;
      if (ang < FILM_LIMITS.backlightDeg) sampledFinding(key.beat, `backlight: the sun ${fmt(ang, 0)}° from the view direction (mark light: 'silhouette' if intended)`);
    }
  }

  lap('light');
  // ---- shot-list sync (data/tour/shotlist.json mirrors the compiled film)
  const sl = readJson<{ film: { seconds: number }; segments: { id: string; seconds: number; beats?: string[] }[] }>('data/tour/shotlist.json');
  if (Math.abs(sl.film.seconds - film.duration) > 0.05) E(`data/tour/shotlist.json film.seconds ${sl.film.seconds} ≠ the compiled ${fmt(film.duration, 2)} s`);
  const order = sl.segments.flatMap((s) => s.beats ?? []);
  const want = beats.map((_, i) => beatId(i));
  if (order.join(',') !== want.join(',')) E(`data/tour/shotlist.json segments do not list the timeline's beats in order (${order.length} vs ${want.length} beats)`);
  else
    for (const s of sl.segments) {
      const secs = (s.beats ?? []).reduce((a, id) => a + rig.durs[want.indexOf(id)], 0);
      if (Math.abs(secs - s.seconds) > 0.05) E(`data/tour/shotlist.json segment ${s.id}: ${s.seconds} s ≠ its beats' ${fmt(secs, 2)} s`);
    }

  // ---- summary + table
  const nFind = stats.reduce((a, s) => a + s.findings.length, 0);
  out.info.push(`film: ${beats.length} beats, ${fmt(film.duration, 2)} s (${tl.status}), hash ${film.hash}${built ? ' with the landmark build' : ''} (compiled twice, the second time with a fresh water field: identical), compile ${fmt(ms, 0)} ms; ${rig.moves.filter((m) => m.auto).length} auto moves; ${film.captions.length} captions; ${nFind} sampled finding(s) (${locked ? 'errors' : 'warnings while draft'}); check ${phase.map(([n, v]) => `${n} ${fmt(v / 1000, 1)} s`).join(', ')}`);
  if (opts.table) {
    const pad = (s: string, n: number) => s.padEnd(n);
    const lp = (s: string, n: number) => s.padStart(n);
    out.table.push(`${pad('beat', 18)}${pad('kind', 6)}${lp('t0', 7)}${lp('dur', 6)}${lp('S', 6)}${lp('peakV', 7)}${lp('rot°/s', 8)}${lp('maxD', 7)}${lp('minClr', 8)}  ${pad('tod', 12)}${lp('lit', 5)} ${pad('key', 12)}findings`);
    beats.forEach((b, i) => {
      const s = stats[i];
      const tod = isHold(b) ? `${fmt(b.tod[0], 2)}→${fmt(b.tod[1], 2)}` : `${fmt(states[Math.min(K, Math.round(rig.t0s[i] * HZ))].tod, 2)}→${fmt(states[Math.min(K, Math.round((rig.t0s[i] + rig.durs[i]) * HZ))].tod, 2)}`;
      out.table.push(
        `${pad(beatId(i), 18)}${pad(isHold(b) ? b.style : 'move', 6)}${lp(fmt(rig.t0s[i], 2), 7)}${lp(fmt(rig.durs[i], 2), 6)}${lp(Number.isNaN(s.S) ? '' : fmt(s.S, 2), 6)}${lp(fmt(s.peakV, 2), 7)}${lp(fmt(s.peakRot, 1), 8)}${lp(fmt(s.maxD, 0), 7)}${lp(fmt(s.minClear, 2), 8)}  ${pad(tod, 12)}${lp(s.lit === null ? '' : `${fmt(100 * s.lit, 0)}%`, 5)} ${pad(s.key, 12)}${s.findings.join('; ')}`,
      );
    });
  }
  return out;
}

// ───────────────────────────── shot-list sync ─────────────────────────────

interface ShotListDoc {
  film: { seconds: number; beats: number };
  classes: Record<string, [number, number]>;
  segments: { id: string; seconds: number; tod: number | null; mix?: Record<string, number>; beats?: string[] }[];
  landmarks: Record<string, { tod: number | null; screenSeconds: number }>;
}

/**
 * data/tour/shotlist.json from the compiled film (`--sync-shotlist`): film.seconds and film.beats; per segment
 * its seconds (its beats' compiled durations), tod (the middle of its last hold) and mix (screen-time shares
 * by the camera's distance class, 24 Hz samples of the rig); per hold subject (the hold's label landmark) its
 * tod (hold middle) and screenSeconds (hold duration). Segment membership is edited by hand (the check
 * rejects segments that do not list the beats in order). The file's one-line-per-entry formatting is kept:
 * values are replaced in place and the result must parse to exactly the intended document.
 */
export function syncShotlist(text: string, program: FilmProgram, tl: TimelineJson): { text: string; changes: string[] } {
  const doc = JSON.parse(text) as ShotListDoc;
  const want = JSON.parse(text) as ShotListDoc;
  const { rig, film } = program;
  const beats = tl.beats;
  const isHold = (b: BeatJson): b is HoldJson => 'hold' in b;
  const ids = beats.map((b) => (isHold(b) ? b.hold : (b as MoveJson).move));
  const order = doc.segments.flatMap((s) => s.beats ?? []);
  if (order.join(',') !== ids.join(',')) throw new Error(`shotlist segments do not list the timeline's beats in order — edit segment membership by hand first (segments: ${order.join(', ')})`);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const changes: string[] = [];
  const note = (what: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push(`${what}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  };
  want.film.seconds = r2(film.duration);
  want.film.beats = beats.length;
  note('film.seconds', doc.film.seconds, want.film.seconds);
  note('film.beats', doc.film.beats, want.film.beats);
  // distance class of the rig's camera (slant distance to the target) at 24 Hz
  const classes = Object.entries(doc.classes).sort((a, b) => a[1][0] - b[1][0]);
  const classOf = (d: number) => (classes.find(([, [lo, hi]]) => d >= lo && d < hi) ?? (d < classes[0][1][0] ? classes[0] : classes[classes.length - 1]))[0];
  const HZ = 24;
  for (const [si, s] of want.segments.entries()) {
    const idx = (s.beats ?? []).map((id) => ids.indexOf(id));
    s.seconds = r2(idx.reduce((a, i) => a + rig.durs[i], 0));
    const lastHold = [...idx].reverse().find((i) => isHold(beats[i]));
    if (lastHold !== undefined) {
      const hj = beats[lastHold] as HoldJson;
      s.tod = r2((hj.tod[0] + hj.tod[1]) / 2);
    }
    if (s.mix) {
      const n: Record<string, number> = {};
      let total = 0;
      for (const i of idx)
        for (let k = Math.ceil(rig.t0s[i] * HZ); k < (rig.t0s[i] + rig.durs[i]) * HZ - 1e-9; k++) {
          const c = classOf(rig.pose(k / HZ).dist);
          n[c] = (n[c] ?? 0) + 1;
          total++;
        }
      // in the file's class order (wide → close)
      const mix: Record<string, number> = {};
      for (const c of Object.keys(doc.classes)) if (n[c]) mix[c] = r2(n[c] / total);
      s.mix = mix;
    }
    const d = doc.segments[si];
    note(`segment ${s.id}.seconds`, d.seconds, s.seconds);
    note(`segment ${s.id}.tod`, d.tod, s.tod);
    if (s.mix) note(`segment ${s.id}.mix`, d.mix, s.mix);
  }
  for (const i of beats.keys()) {
    const b = beats[i];
    if (!isHold(b) || b.style === 'open' || b.style === 'end') continue;
    const lm = b.captions?.find((c) => c.landmark)?.landmark;
    const L = lm ? want.landmarks[lm] : undefined;
    if (!lm || !L) continue;
    L.tod = r2((b.tod[0] + b.tod[1]) / 2);
    L.screenSeconds = r2(rig.durs[i]);
    note(`landmark ${lm}.tod`, doc.landmarks[lm].tod, L.tod);
    note(`landmark ${lm}.screenSeconds`, doc.landmarks[lm].screenSeconds, L.screenSeconds);
  }
  // landmarks passed inside a move (a pass caption while the head goes by): tod at the caption's middle,
  // screenSeconds = its visible window
  for (const c of film.captions) {
    const [beatId, kind, idx] = c.id.split(':');
    const bi = ids.indexOf(beatId);
    if (bi < 0 || isHold(beats[bi]) || (kind !== 'pass' && kind !== 'place')) continue;
    const lm = (beats[bi] as MoveJson).captions?.[Number(idx)]?.landmark;
    const L = lm ? want.landmarks[lm] : undefined;
    if (!lm || !L) continue;
    L.tod = r2(program.evaluate((c.t0 + c.t1) / 2).tod);
    L.screenSeconds = r2(c.t1 - c.t0);
    note(`landmark ${lm}.tod`, doc.landmarks[lm].tod, L.tod);
    note(`landmark ${lm}.screenSeconds`, doc.landmarks[lm].screenSeconds, L.screenSeconds);
  }
  // in-place edits on the one-line entries
  const num = (v: number | null) => (v === null ? 'null' : String(v));
  const setIn = (line: string, key: string, value: string): string => {
    const re = new RegExp(`("${key}":\\s*)(-?[0-9.eE+-]+|null)`);
    if (!re.test(line)) throw new Error(`shotlist: no "${key}" on the line ${line.trim().slice(0, 60)}…`);
    return line.replace(re, `$1${value}`);
  };
  const mixText = (m: Record<string, number>) => `{ ${Object.entries(m).map(([k, v]) => `"${k}": ${v}`).join(', ')} }`;
  const lines = text.split('\n');
  let section = '';
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    const sec = /^ {2}"(\w+)":/.exec(line);
    if (sec) section = sec[1];
    if (section === 'film' && sec) {
      line = setIn(line, 'seconds', num(want.film.seconds));
      line = setIn(line, 'beats', num(want.film.beats));
    } else if (section === 'segments') {
      const m = /^\s*\{ "id": "([^"]+)"/.exec(line);
      const s = m && want.segments.find((x) => x.id === m[1]);
      if (s) {
        line = setIn(line, 'seconds', num(s.seconds));
        line = setIn(line, 'tod', num(s.tod));
        if (s.mix) line = line.replace(/"mix":\s*\{[^}]*\}/, `"mix": ${mixText(s.mix)}`);
      }
    } else if (section === 'landmarks') {
      const m = /^ {4}"([a-z0-9-]+)": \{/.exec(line);
      const L = m && want.landmarks[m[1]];
      if (L) {
        line = setIn(line, 'tod', num(L.tod));
        line = setIn(line, 'screenSeconds', num(L.screenSeconds));
      }
    }
    lines[li] = line;
  }
  const out = lines.join('\n');
  if (JSON.stringify(JSON.parse(out)) !== JSON.stringify(want)) throw new Error('shotlist: the in-place edit does not reproduce the intended document (formatting the sync does not know?)');
  return { text: out, changes };
}

// ───────────────────────────── CLI ─────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (k: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const structure = await checkFilmStructure();
  const report = (r: CheckResult) => {
    for (const i of r.info) console.log(`[film] ${i}`);
    for (const w of r.warnings) console.warn(`  warn  ${w}`);
    for (const e of r.errors) console.error(`  ERROR ${e}`);
  };
  report(structure);
  let errors = structure.errors.length;
  const dir = bakedDir();
  if (!hasBake(dir)) {
    console.log(`[film] no bake at ${dir} — structural checks only`);
    process.exit(errors ? 1 : 0);
  }
  const { world, landmarks } = await loadWorld(dir);
  const r = await checkFilm(world, landmarks, { table: argv.includes('--table'), built: !argv.includes('--no-built') });
  if (argv.includes('--sync-shotlist') && r.program) {
    // write the shot list from the compiled film, then drop the sync findings the check made before it
    const file = join(ROOT, 'data/tour/shotlist.json');
    const { text, changes } = syncShotlist(readFileSync(file, 'utf8'), r.program, r.timeline);
    if (changes.length) writeFileSync(file, text);
    console.log(`[film] --sync-shotlist: ${changes.length ? `${changes.length} change(s) → data/tour/shotlist.json\n${changes.map((c) => `        ${c}`).join('\n')}` : 'data/tour/shotlist.json already in sync'}`);
    r.errors = r.errors.filter((e) => !e.includes('data/tour/shotlist.json'));
  }
  report(r);
  errors += r.errors.length;
  if (r.table.length) console.log(['', ...r.table].join('\n'));
  const prog = r.program;
  if (prog && arg('--at') !== undefined) {
    const { routeAt } = (await import(mod('src/tour/route.ts'))) as typeof import('../../src/tour/route.ts');
    for (const t of arg('--at')!.split(',').map(Number)) {
      const s = prog.evaluate(t);
      const p = prog.rig.pose(t);
      const head = prog.rig.head(t);
      console.log(`\n[film] t ${t} s · beat ${prog.film.beats[p.beat].id} (x ${fmt(p.x, 3)}) · tod ${fmt(s.tod, 3)} · head ${fmt(head, 1)} km ${JSON.stringify(routeAt(prog.film.route, head).map((v) => +v.toFixed(2)))} · glow ${fmt(s.routeGlow ?? 1, 2)}`);
      console.log(`       camera ${JSON.stringify(s.camera.position.map((v) => +v.toFixed(3)))} → ${JSON.stringify(s.camera.target.map((v) => +v.toFixed(3)))} fov ${fmt(s.camera.fov, 2)} · D ${fmt(p.dist, 2)} el ${fmt(p.el, 2)} az ${fmt(p.az, 2)} w ${fmt(p.w, 2)} s ${fmt(p.s, 1)} Z ${fmt(p.Z, 3)} · deck lnK ${fmt(p.lnK, 3)} · clearance lift ${fmt(p.dC, 3)} km`);
      console.log(`       look ${s.lookOverride ?? '—'} ${s.lookOverrideWeight !== undefined ? fmt(s.lookOverrideWeight, 2) : ''} · fStop ${fmt(s.lens.fStop, 2)} · events ${JSON.stringify(s.events)} · captions ${JSON.stringify(s.annotations.map((a) => `${a.id} ${a.reveal.toFixed(2)}`))}`);
    }
  }
  const cues = arg('--cues');
  if (prog && cues) {
    const { exportCues } = (await import(mod('src/tour/cues.ts'))) as typeof import('../../src/tour/cues.ts');
    const sheet = exportCues(prog.film, r.timeline);
    writeFileSync(cues, JSON.stringify(sheet, null, 2));
    console.log(`[film] cue sheet → ${cues} (${sheet.sections.length} sections, ${sheet.cues.length} cues, ${sheet.hits.length} hits)`);
  }
  console.log(errors ? `[film] FAILED (${errors} errors)` : '[film] OK');
  process.exit(errors ? 1 : 0);
}

// run as a CLI only (pnpm check imports the module)
if ((process.argv[1] ?? '').replace(/\\/g, '/').endsWith('tools/check/film.ts')) await main();
