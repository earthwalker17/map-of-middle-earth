/**
 * The film's camera rig (S5): a crane / helicopter move that is a PURE function of film time t (fractional
 * t for motion-blur sub-samples), compiled identically in Node and in the page.
 *
 * Keys — each hold's camera reference (landmark bookmark / QA shot / inline orbit + `set` overrides) in orbit
 * space: target T (place display position + aimKm), lift, distance D, elevation, azimuth (unwrapped across the
 * film, drift-aware), fov, roll; view width w = 2·D·tan(fov/2)·16/9. Each key also sits on the FINE rail:
 * s_k = projection of T (searched around the hold's route mark, forced non-decreasing), offset o_k = T − rail(s_k).
 * Overview holds (open / end) borrow s from their neighbouring route hold.
 *
 * Holds — the key at the hold's middle plus linear drift in (t − t_mid): azimuth, ln w (push), elevation and
 * the target's slide along the rail (style defaults ⊕ beat drift).
 *
 * Moves A → B over [t0, t1] (Δ, x = (t − t0)/Δ, E = smootherstep(x)) — the van Wijk–Nuij zoom / pan path
 * along the rail: pan length L = |s_B − s_A| + |o_B − o_A|, σ = S·E, pan progress p = u(σ)/L; s and o move with
 * p. While the path is zoomed out beyond the log-linear width (Z = smootherstep(ln(w(σ)/w_lin) / ln 6), C2 at
 * both clamps) the target leans from the fine to the coarse rail, the elevation rises toward apexEl (a soft
 * max) and tan(fov/2) relaxes toward tan 16°. Azimuth, lift, roll and tan(fov/2) (log) follow E.
 * `dur: "auto"` ⇒ Δ = clamp(1.875·S / vTarget, minS, maxS).
 * Drift continuity: each drift channel crosses the move as a quintic Hermite from (r_A·dur_A/2, r_A) to
 * (−r_B·dur_B/2, r_B) with zero end curvature, so the camera is C2 and never stops dead.
 *
 * Baked safety tracks (compile time, 96 Hz, Catmull-Rom reads):
 *  - target height G: holds keep the key's ground; moves G = lerp(G_A, G_B, E) + W(x)·(Ḡ − lerp(Ḡ_A, Ḡ_B, E)),
 *    W = (4x(1 − x))², Ḡ = mean water-aware surface over a 13-tap disk of radius 0.05·D (baked, then smoothed
 *    with a Gaussian of σ 0.3 s: 13 taps alias the relief when a fast pan slides the disk a valley per frame);
 *  - deck cap: under an ash deck (looks.json `deck`: height − 6 km) and under a move's `maxAltKm` the camera
 *    comes down by shrinking D (ln-scale, ±0.6 s running min, Gaussian σ 0.3 s). The EFFECT is weighted, not
 *    the cap: the deck's ln k by the cover (0 at 0.2 → 1 at 0.5, smootherstep), maxAltKm's by a smootherstep
 *    over the move's first / last 20 %, applied after the filter so it never leaks into the holds.
 *    `crossDeck` moves and overview holds are exempt (the final pull-out rises through the pall once);
 *  - clearance: need = max over 5 taps around the camera (radius 0.02·D + 0.2) of the surface + 0.12 + 0.015·D
 *    − P_y; Δc = Gaussian (σ 0.3 s) of the ±0.6 s running max of max(0, need); P_y += Δc.
 * Route head: holds rest on their mark; moves use the camera's own pan progress, shifted so the head arrives
 * τ = min(headLeadS, 0.25Δ) before the camera settles.
 */
import type { CameraState } from '../core/types.ts';
import type { OrbitSpec, ShotSpecInput } from '../camera/shots.ts';
import type { LandmarkDefinition } from '../landmarks/types.ts';
import type { World } from '../world/World.ts';
import { deckLook } from '../materials/looks.ts';
import { clamp, gaussianSmooth, hermite5Blend, lerp, runningMax, smootherstep, trackAt, unwrapNear, zoomPanPath, SMOOTHERSTEP_PEAK, type Track, type ZoomPanPath } from './curves.ts';
import { projectToRail, railAt, type Rails } from './rail.ts';
import { waterField, type WaterField } from './route.ts';
import { isHold, type CameraRefJson, type CompiledRoute, type HoldJson, type HoldStyle, type MoveJson, type TimelineJson } from './schema.ts';

/** frame aspect the rig composes for (view width = height × 16/9) */
export const ASPECT = 16 / 9;
/** bake rate of the safety tracks, Hz */
export const BAKE_HZ = 96;
/** tan of the half fov a zoomed-out move relaxes toward (fov 32°) */
const TAN_APEX = Math.tan((16 * Math.PI) / 180);
/** softness of the apex-elevation boost's max(0, ·), degrees */
const APEX_SOFT_DEG = 3;
/** zoom-out (ln of the vWN width over the log-linear one) at which Z = 1 */
const LN_ZOOM_FULL = Math.log(6);
/** search window around a hold's route mark when projecting its target onto the rail, km */
const PROJECT_WINDOW_KM = 150;
/** clearance: margin above the surface (km + share of D), tap radius (km + share of D) */
export const CLEAR = { base: 0.12, perD: 0.015, tapBase: 0.2, tapPerD: 0.02 } as const;
/** safety-track filters: running window and Gaussian σ, seconds */
const SAFE_WINDOW_S = 0.6;
const SAFE_SIGMA_S = 0.3;
/** the deck rule: stay this far below the ash deck where its cover reaches DECK_COVER[1] */
export const DECK_BELOW_KM = 6;
export const DECK_COVER = [0.2, 0.5] as const;
/** where no cap applies */
const NO_CAP = 1e4;

const D2R = Math.PI / 180;

// ───────────────────────────── camera references ─────────────────────────────

export interface CameraRefSources {
  landmarks: LandmarkDefinition[];
  /** shots that `camera.shot` may reference (data/qa/shots.json; orbit shots only) */
  shots: ShotSpecInput[];
}

/** The orbit (+ bookmark f-stop) a camera reference resolves to. */
export function resolveCameraRef(ref: CameraRefJson, inp: CameraRefSources): { orbit: OrbitSpec; fStop?: number; landmark?: LandmarkDefinition } {
  let orbit: OrbitSpec;
  let fStop: number | undefined;
  let landmark: LandmarkDefinition | undefined;
  if (ref.bookmark) {
    for (const def of inp.landmarks) {
      const b = def.bookmarks?.find((x) => x.id === ref.bookmark);
      if (!b) continue;
      const { id: _id, tod: _tod, dayOfYear: _d, weather: _w, fStop: f, events: _e, compare: _c, note: _n, expect: _x, ...o } = b;
      orbit = { place: def.placeId, ...o };
      fStop = f;
      landmark = def;
      break;
    }
    if (!orbit!) throw new Error(`film: unknown bookmark '${ref.bookmark}'`);
  } else if (ref.shot) {
    const s = inp.shots.find((x) => x.id === ref.shot);
    if (!s) throw new Error(`film: unknown shot '${ref.shot}'`);
    if (!('orbit' in s.camera)) throw new Error(`film: shot '${ref.shot}' is not an orbit shot`);
    orbit = { ...s.camera.orbit };
    fStop = s.fStop;
  } else if (ref.orbit) orbit = { ...ref.orbit };
  else throw new Error('film: camera needs bookmark, shot or orbit');
  return { orbit: { ...orbit, ...ref.set }, fStop, landmark };
}

// ───────────────────────────── rig data ─────────────────────────────

/** Drift rates of a hold (per second): azimuth °, ln w, elevation °, along-rail km. */
export interface DriftRates {
  az: number;
  lnw: number;
  el: number;
  s: number;
}

/** A hold's camera key in orbit / rail space. */
export interface RigKey {
  beat: number;
  id: string;
  style: HoldStyle;
  t0: number;
  t1: number;
  tMid: number;
  dur: number;
  /** target XZ (world units) and the ground it stands on (max(0, H), as orbitCamera) */
  tx: number;
  tz: number;
  ground: number;
  lift: number;
  dist: number;
  el: number;
  /** unwrapped azimuth (degrees) */
  az: number;
  fov: number;
  roll: number;
  tanHalf: number;
  /** ln of the view width (km) */
  lnW: number;
  /** rail coordinate, offset of the target from the fine rail, the fine rail point itself */
  s: number;
  ox: number;
  oz: number;
  rx: number;
  rz: number;
  /** distance of the target from the fine rail at s (diagnostics) */
  railDist: number;
  drift: DriftRates;
  /** route head mark (km of arc length) while the hold plays */
  head: number;
  fStop?: number;
  landmark?: string;
}

export interface RigMove {
  beat: number;
  id: string;
  /** beat indices of the holds before / after */
  a: number;
  b: number;
  t0: number;
  t1: number;
  dur: number;
  auto: boolean;
  path: ZoomPanPath;
  /** pan length (rail + offset), km */
  L: number;
  dS: number;
  dox: number;
  doz: number;
  apexEl: number;
  maxAlt: number | null;
  crossDeck: boolean;
  /** head lead (s) */
  tau: number;
}

/** The camera at one instant, in orbit space (after the baked tracks). */
export interface RigPose {
  beat: number;
  /** fraction through the beat */
  x: number;
  tx: number;
  ty: number;
  tz: number;
  dist: number;
  el: number;
  az: number;
  fov: number;
  roll: number;
  /** view width, km (at the final distance) */
  w: number;
  s: number;
  /** zoom-out amount 0..1 (moves) */
  Z: number;
  /** the safety tracks at t: ln of the distance factor (deck cap), clearance lift (km) */
  lnK: number;
  dC: number;
  position: [number, number, number];
}

export interface CameraRig {
  keys: RigKey[];
  moves: RigMove[];
  /** beat → key index / move index (−1 when the beat is the other kind) */
  keyOfBeat: Int32Array;
  moveOfBeat: Int32Array;
  t0s: number[];
  durs: number[];
  duration: number;
  /**
   * baked tracks (BAKE_HZ): the smoothed disk-mean ground Ḡ, ln of the deck-cap distance factor, clearance
   * lift Δc, and the raw clearance need before the filters (> 0 inside a hold = that hold's own framing sits
   * under the clearance margin; Δc > 0 with need 0 = lift bleeding in from a neighbouring move)
   */
  tracks: { gBar: Track; lnK: Track; dC: Track; need: Track };
  beatAt(t: number): number;
  pose(t: number): RigPose;
  camera(t: number): CameraState;
  /** route head (arc length, km) at t */
  head(t: number): number;
  /** a move's pan progress 0..1 at fraction x */
  panProgress(m: RigMove, x: number): number;
  /** the ash deck over (x, z): its full-strength cap, the rule's weight there, the cover and the deck height */
  deckAt(x: number, z: number): DeckAt;
  /** is beat i exempt from the deck rule (overview holds, crossDeck moves) */
  deckExempt(i: number): boolean;
  water: WaterField;
}

export interface RigInputs extends CameraRefSources {
  world: World;
  route: CompiledRoute;
  rails: Rails;
  timeline: TimelineJson;
}

const isOverview = (style: HoldStyle) => style === 'open' || style === 'end';

/** The ash deck over a point (CameraRig.deckAt). */
export interface DeckAt {
  /** the cap at full strength: deck height − DECK_BELOW_KM (NO_CAP where the cover is ≤ DECK_COVER[0]) */
  cap: number;
  /** the rule's weight: 0 at cover DECK_COVER[0] → 1 at DECK_COVER[1] (smootherstep); it scales ln k, not the cap */
  on: number;
  cover: number;
  height: number;
}

/** A drift channel across a move: quintic Hermite from A's end (r_A·dur_A/2, r_A) to B's start (−r_B·dur_B/2, r_B). */
function driftBlend(ra: number, rb: number, durA: number, durB: number, dur: number, x: number): number {
  return hermite5Blend((ra * durA) / 2, ra, (-rb * durB) / 2, rb, dur, x);
}

/** the 13-tap disk of Ḡ (unit radius): centre, 4 at ½, 8 at 1 */
const DISK13: readonly (readonly [number, number])[] = [
  [0, 0],
  ...[0, 1, 2, 3].map((k) => [0.5 * Math.cos((k * Math.PI) / 2), 0.5 * Math.sin((k * Math.PI) / 2)] as const),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)] as const),
];

/** The deck regions of the world's look layers (looks.json `deck`) and a closure-free sampler of their cover. */
interface DeckField {
  /** region layer indices with a deck, their cover and height */
  layers: number[];
  cover: number[];
  height: number[];
  img: { data: Uint8Array; width: number; height: number };
  regions: number;
}

/**
 * Deck cover and cover-weighted height at (x, z): Σ wᵣ·coverᵣ and Σ wᵣ·coverᵣ·hᵣ over the normalised region
 * weights (the same bilinear read and normalisation as looks.ts sampleRegionWeights).
 */
function deckSample(world: World, f: DeckField, x: number, z: number, out: [number, number]): [number, number] {
  const { data: d, width: W, height: H } = f.img;
  const [u, v] = world.spec.worldToUv(x, z);
  const fx = Math.min(W - 1, Math.max(0, u * W - 0.5));
  const fy = Math.min(H - 1, Math.max(0, v * H - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(W - 1, x0 + 1);
  const y1 = Math.min(H - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  let sum = 0;
  let cover = 0;
  let hsum = 0;
  let li = 0;
  for (let r = 0; r < f.regions; r++) {
    const base = (r >> 2) * H;
    const c = r & 3;
    const a00 = d[((base + y0) * W + x0) * 4 + c];
    const a10 = d[((base + y0) * W + x1) * 4 + c];
    const a01 = d[((base + y1) * W + x0) * 4 + c];
    const a11 = d[((base + y1) * W + x1) * 4 + c];
    const a = a00 + (a10 - a00) * tx;
    const b = a01 + (a11 - a01) * tx;
    const w = (a + (b - a) * ty) / 255;
    sum += w;
    if (li < f.layers.length && f.layers[li] === r) {
      cover += w * f.cover[li];
      hsum += w * f.cover[li] * f.height[li];
      li++;
    }
  }
  const n = sum > 1e-6 ? sum : 1;
  out[0] = cover / n;
  out[1] = hsum / n;
  return out;
}

// ───────────────────────────── build ─────────────────────────────

export function buildRig(inp: RigInputs): CameraRig {
  const { world, route, rails, timeline: tl } = inp;
  const beats = tl.beats;
  const water = waterField(world);
  const keyOfBeat = new Int32Array(beats.length).fill(-1);
  const moveOfBeat = new Int32Array(beats.length).fill(-1);
  const D = tl.defaults;

  // ---- keys (timing filled in once the move durations are known)
  const keys: RigKey[] = [];
  let lastHead = 0;
  let prevS = 0;
  let prevAzEnd: number | null = null;
  beats.forEach((b, i) => {
    if (!isHold(b)) return;
    const r = resolveCameraRef(b.camera, inp);
    const o = r.orbit;
    let tx: number;
    let tz: number;
    if (o.place) ({ x: tx, z: tz } = world.place(o.place));
    else if (o.targetKm) [tx, tz] = world.spec.kmToWorld(o.targetKm[0], o.targetKm[1]);
    else throw new Error(`film: hold ${b.hold}: orbit needs place or targetKm`);
    if (o.aimKm) {
      tx += o.aimKm[0];
      tz -= o.aimKm[1];
    }
    const fov = o.fov ?? 35;
    const tanHalf = Math.tan((fov * D2R) / 2);
    const dr = { ...D[b.style].drift, ...b.drift };
    const drift: DriftRates = { az: dr.azDegPerS ?? 0, lnw: dr.pushPerS ?? 0, el: dr.elDegPerS ?? 0, s: dr.alongKmPerS ?? 0 };
    const mark = b.head ?? b.place;
    if (mark !== undefined && route.marks[mark] !== undefined) lastHead = route.marks[mark];
    // azimuth: unwrapped so the camera turns the short way from the previous hold's end to this hold's start
    const half = b.dur / 2;
    const az = prevAzEnd === null ? o.azimuthDeg : unwrapNear(o.azimuthDeg - drift.az * half, prevAzEnd) + drift.az * half;
    prevAzEnd = az + drift.az * half;
    // rail coordinate: around the hold's mark, never backwards
    let s = 0;
    if (!isOverview(b.style)) {
      const m = mark !== undefined && route.marks[mark] !== undefined ? route.marks[mark] : lastHead;
      s = Math.max(prevS, projectToRail(rails, tx, tz, 'fine', m - PROJECT_WINDOW_KM, m + PROJECT_WINDOW_KM).s);
      prevS = s;
    }
    keyOfBeat[i] = keys.length;
    keys.push({
      beat: i,
      id: b.hold,
      style: b.style,
      t0: 0,
      t1: 0,
      tMid: 0,
      dur: b.dur,
      tx,
      tz,
      ground: Math.max(0, world.heights.sample(tx, tz)),
      lift: o.lift ?? 0,
      dist: o.distanceKm,
      el: o.elevationDeg,
      az,
      fov,
      roll: o.roll ?? 0,
      tanHalf,
      lnW: Math.log(2 * o.distanceKm * tanHalf * ASPECT),
      s,
      ox: 0,
      oz: 0,
      rx: 0,
      rz: 0,
      railDist: 0,
      drift,
      head: lastHead,
      fStop: r.fStop,
      landmark: r.landmark?.id,
    });
  });
  // overview holds borrow the rail coordinate of their nearest route hold (open → next, end → previous)
  keys.forEach((k, j) => {
    if (!isOverview(k.style)) return;
    const order = k.style === 'open' ? [...keys.slice(j + 1), ...keys.slice(0, j).reverse()] : [...keys.slice(0, j).reverse(), ...keys.slice(j + 1)];
    const ref = order.find((q) => !isOverview(q.style));
    k.s = ref ? ref.s : 0;
  });
  for (const k of keys) {
    const [rx, rz] = railAt(rails, k.s, 'fine');
    k.rx = rx;
    k.rz = rz;
    k.ox = k.tx - rx;
    k.oz = k.tz - rz;
    k.railDist = Math.hypot(k.ox, k.oz);
  }

  // ---- moves and timing
  const moves: RigMove[] = [];
  const t0s: number[] = [];
  const durs: number[] = [];
  let t = 0;
  beats.forEach((b, i) => {
    t0s.push(t);
    if (isHold(b)) {
      const k = keys[keyOfBeat[i]];
      k.t0 = t;
      k.t1 = t + b.dur;
      k.tMid = t + b.dur / 2;
      durs.push(b.dur);
      t += b.dur;
      return;
    }
    const mv = b as MoveJson;
    const A = keys[keyOfBeat[i - 1]];
    const B = keys[keyOfBeat[i + 1]];
    const dS = B.s - A.s;
    const dox = B.ox - A.ox;
    const doz = B.oz - A.oz;
    const L = Math.abs(dS) + Math.hypot(dox, doz);
    const path = zoomPanPath(Math.exp(A.lnW), Math.exp(B.lnW), L, mv.rho ?? D.move.rho);
    const auto = mv.dur === 'auto';
    const dur = auto ? clamp((SMOOTHERSTEP_PEAK * path.S) / D.move.vTarget, D.move.minS, D.move.maxS) : (mv.dur as number);
    moveOfBeat[i] = moves.length;
    moves.push({
      beat: i,
      id: mv.move,
      a: i - 1,
      b: i + 1,
      t0: t,
      t1: t + dur,
      dur,
      auto,
      path,
      L,
      dS,
      dox,
      doz,
      apexEl: mv.apexEl ?? D.move.apexEl,
      maxAlt: mv.maxAltKm ?? null,
      crossDeck: !!mv.crossDeck,
      tau: Math.min(D.move.headLeadS, 0.25 * dur),
    });
    durs.push(dur);
    t += dur;
  });
  const duration = t;

  const beatAt = (at: number): number => {
    let lo = 0;
    let hi = beats.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (t0s[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const panProgress = (m: RigMove, x: number): number => {
    const E = smootherstep(x);
    const P = m.path;
    if (P.degenerate) return E; // pure zoom: the (negligible) pan follows the eased progress
    return x >= 1 ? 1 : clamp(P.u(P.S * E) / P.L, 0, 1);
  };

  // ---- the analytic pose (no height, no safety tracks)
  interface Base {
    beat: number;
    x: number;
    tx: number;
    tz: number;
    dist: number;
    el: number;
    az: number;
    tanHalf: number;
    lift: number;
    roll: number;
    s: number;
    Z: number;
    /** the move's ease at x (moves) */
    E: number;
  }
  const rf: [number, number] = [0, 0];
  const rc: [number, number] = [0, 0];
  const base = (at: number, out: Base): Base => {
    const i = beatAt(at);
    out.beat = i;
    const kIdx = keyOfBeat[i];
    if (kIdx >= 0) {
      const k = keys[kIdx];
      const dt = at - k.tMid;
      const s = k.s + k.drift.s * dt;
      railAt(rails, s, 'fine', rf);
      out.x = clamp((at - k.t0) / Math.max(1e-9, k.dur), 0, 1);
      out.tx = k.tx + (rf[0] - k.rx);
      out.tz = k.tz + (rf[1] - k.rz);
      out.dist = k.dist * Math.exp(k.drift.lnw * dt);
      out.el = k.el + k.drift.el * dt;
      out.az = k.az + k.drift.az * dt;
      out.tanHalf = k.tanHalf;
      out.lift = k.lift;
      out.roll = k.roll;
      out.s = s;
      out.Z = 0;
      out.E = 0;
      return out;
    }
    const m = moves[moveOfBeat[i]];
    const A = keys[keyOfBeat[m.a]];
    const B = keys[keyOfBeat[m.b]];
    const x = clamp((at - m.t0) / m.dur, 0, 1);
    const E = smootherstep(x);
    const P = m.path;
    const sigma = P.S * E;
    const p = panProgress(m, x);
    const wv = x >= 1 ? P.w1 : x <= 0 ? P.w0 : P.w(sigma);
    const lnLin = lerp(A.lnW, B.lnW, E);
    // quintic (C2) at both clamps: a cubic smoothstep would break the camera's acceleration where Z saturates
    const Z = smootherstep((Math.log(wv) - lnLin) / LN_ZOOM_FULL);
    const s = A.s + m.dS * p + driftBlend(A.drift.s, B.drift.s, A.dur, B.dur, m.dur, x);
    railAt(rails, s, 'fine', rf);
    railAt(rails, s, 'coarse', rc);
    out.x = x;
    out.tx = lerp(rf[0], rc[0], Z) + A.ox + m.dox * p;
    out.tz = lerp(rf[1], rc[1], Z) + A.oz + m.doz * p;
    let el = lerp(A.el, B.el, E) + driftBlend(A.drift.el, B.drift.el, A.dur, B.dur, m.dur, x);
    // the boost toward the apex: a smooth max(0, apexEl − el) — a hard max kinks the tilt rate where a
    // descending move's elevation crosses apexEl while zoomed out
    const gap = m.apexEl - el;
    el += 0.5 * (gap + Math.sqrt(gap * gap + APEX_SOFT_DEG * APEX_SOFT_DEG)) * Z;
    out.el = el;
    out.az = A.az + (B.az - A.az) * E + driftBlend(A.drift.az, B.drift.az, A.dur, B.dur, m.dur, x);
    const lnT = lerp(Math.log(A.tanHalf), Math.log(B.tanHalf), E);
    out.tanHalf = Math.exp(lerp(lnT, Math.log(TAN_APEX), Z));
    out.dist = Math.exp(Math.log(wv) + driftBlend(A.drift.lnw, B.drift.lnw, A.dur, B.dur, m.dur, x)) / (2 * out.tanHalf * ASPECT);
    out.lift = lerp(A.lift, B.lift, E);
    out.roll = lerp(A.roll, B.roll, E);
    out.s = s;
    out.Z = Z;
    out.E = E;
    return out;
  };

  // ---- the deck rule
  const deckField: DeckField = { layers: [], cover: [], height: [], img: world.look.image as unknown as DeckField['img'], regions: world.lookRegions.length };
  world.lookRegions.forEach((id, r) => {
    const d = deckLook(id);
    if (d.cover <= 0) return;
    deckField.layers.push(r);
    deckField.cover.push(d.cover);
    deckField.height.push(d.height);
  });
  const ds: [number, number] = [0, 0];
  const deckAt = (x: number, z: number): DeckAt => {
    if (!deckField.layers.length || !world.spec.inFrame(x, z)) return { cap: NO_CAP, on: 0, cover: 0, height: 0 };
    const [cover, hsum] = deckSample(world, deckField, x, z, ds);
    if (cover <= DECK_COVER[0]) return { cap: NO_CAP, on: 0, cover, height: 0 };
    const height = hsum / cover;
    return { cap: height - DECK_BELOW_KM, on: smootherstep((cover - DECK_COVER[0]) / (DECK_COVER[1] - DECK_COVER[0])), cover, height };
  };
  const deckExempt = (i: number): boolean => {
    const kIdx = keyOfBeat[i];
    if (kIdx >= 0) return isOverview(keys[kIdx].style);
    return moves[moveOfBeat[i]].crossDeck;
  };

  // ---- bake: target height, deck cap, clearance
  const N = Math.max(2, Math.floor(duration * BAKE_HZ) + 2);
  const G = new Float64Array(N);
  const lnKraw = new Float64Array(N);
  const need = new Float64Array(N);
  const bases: Base[] = [];
  const win = Math.round(SAFE_WINDOW_S * BAKE_HZ);
  const sig = SAFE_SIGMA_S * BAKE_HZ;
  // Ḡ: the mean water-aware surface over a 13-tap disk of radius 0.05·D under the target, smoothed in time
  // (σ 0.3 s): a fast pan slides the disk over a whole valley per frame, and 13 taps alias the relief
  const gRaw = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const b = base(j / BAKE_HZ, {} as Base);
    bases.push(b);
    const r = 0.05 * b.dist;
    let acc = 0;
    for (const [ux, uz] of DISK13) acc += water.surface(b.tx + r * ux, b.tz + r * uz);
    gRaw[j] = acc / DISK13.length;
  }
  const gBar: Track = { hz: BAKE_HZ, v: gaussianSmooth(gRaw, sig) };
  // Ḡ at each move's ends (the W term vanishes there: G meets the holds' grounds exactly)
  const gEnds = moves.map((m) => [trackAt(gBar, m.t0), trackAt(gBar, m.t1)]);
  /** target ground at t: the hold's key ground, or the move's blend toward the terrain it crosses */
  const groundAt = (b: Base, at: number): number => {
    const kIdx = keyOfBeat[b.beat];
    if (kIdx >= 0) return keys[kIdx].ground;
    const mi = moveOfBeat[b.beat];
    const m = moves[mi];
    const A = keys[keyOfBeat[m.a]];
    const B = keys[keyOfBeat[m.b]];
    const W = (4 * b.x * (1 - b.x)) ** 2;
    return lerp(A.ground, B.ground, b.E) + W * (trackAt(gBar, at) - lerp(gEnds[mi][0], gEnds[mi][1], b.E));
  };
  for (let j = 0; j < N; j++) G[j] = groundAt(bases[j], j / BAKE_HZ);
  const dirY = (b: Base) => Math.sin(b.el * D2R);
  const posOf = (b: Base, ty: number, dist: number): [number, number, number] => {
    const el = b.el * D2R;
    const az = b.az * D2R;
    const hd = dist * Math.cos(el);
    return [b.tx + Math.sin(az) * hd, ty + dist * Math.sin(el), b.tz - Math.cos(az) * hd];
  };
  /** the weight of a move's maxAltKm at its fraction x: 0 at both ends, smootherstep (C2) over the first / last 20 % */
  const altWeight = (b: Base): number => {
    const mi = moveOfBeat[b.beat];
    if (mi < 0 || moves[mi].maxAlt === null) return 0;
    return smootherstep(b.x / 0.2) * smootherstep((1 - b.x) / 0.2);
  };
  /** ln of the distance factor that brings the camera (target height ty, rise per km of D sy) down to `cap` */
  const lnToCap = (b: Base, ty: number, sy: number, cap: number): number => {
    if (!(cap < NO_CAP && cap > ty) || ty + b.dist * sy <= cap) return 0;
    return Math.log(clamp((cap - ty) / (b.dist * sy), 0.02, 1));
  };
  // Each cap's EFFECT is blended (ln k scaled by its weight), never the cap height: a cap pushed up by
  // (1 − w)·NO_CAP would bite only once w ≈ 1, i.e. switch on hard. Two raw tracks: the deck alone
  // (cover-weighted, everywhere but the exempt beats) and min(deck, maxAltKm at full strength). Both are
  // filtered (±0.6 s running min, Gaussian σ 0.3 s); the maxAltKm part is weighted AFTER the filter, so it is
  // exactly zero outside its move (it never leaks into the holds): lnK = F_deck + w_alt·(F_both − F_deck).
  const lnDeckRaw = new Float64Array(N);
  const altW = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const b = bases[j];
    const ty = G[j] + b.lift;
    const sy = dirY(b);
    altW[j] = altWeight(b);
    if (sy <= 1e-3) continue;
    const mi = moveOfBeat[b.beat];
    const lnAlt = mi >= 0 && moves[mi].maxAlt !== null ? lnToCap(b, ty, sy, moves[mi].maxAlt!) : 0;
    let lnDeck = 0;
    if (!deckExempt(b.beat))
      // two passes: the deck under the lowered camera may differ from the deck under the first one
      for (let pass = 0; pass < 2; pass++) {
        const P = posOf(b, ty, b.dist * Math.exp(Math.min(lnDeck, altW[j] * lnAlt)));
        const d = deckAt(P[0], P[2]);
        lnDeck = d.on * lnToCap(b, ty, sy, d.cap);
      }
    lnDeckRaw[j] = lnDeck;
    lnKraw[j] = Math.min(lnDeck, lnAlt);
  }
  const smoothMin = (a: Float64Array) => {
    if (!a.some((v) => v < 0)) return a;
    const neg = a.map((v) => -v);
    return gaussianSmooth(runningMax(neg, win), sig).map((v) => -v);
  };
  const fDeck = smoothMin(lnDeckRaw);
  const fBoth = smoothMin(lnKraw);
  const lnK = new Float64Array(N);
  for (let j = 0; j < N; j++) lnK[j] = altW[j] > 0 ? fDeck[j] + altW[j] * (fBoth[j] - fDeck[j]) : fDeck[j];
  for (let j = 0; j < N; j++) {
    const b = bases[j];
    const dist = b.dist * Math.exp(lnK[j]);
    const P = posOf(b, G[j] + b.lift, dist);
    const r = CLEAR.tapBase + CLEAR.tapPerD * dist;
    let top = water.surface(P[0], P[2]);
    top = Math.max(top, water.surface(P[0] + r, P[2]), water.surface(P[0] - r, P[2]), water.surface(P[0], P[2] + r), water.surface(P[0], P[2] - r));
    need[j] = Math.max(0, top + CLEAR.base + CLEAR.perD * dist - P[1]);
  }
  const dC = need.some((v) => v > 0) ? gaussianSmooth(runningMax(need, win), sig) : need;
  const tracks = { gBar, lnK: { hz: BAKE_HZ, v: lnK }, dC: { hz: BAKE_HZ, v: dC }, need: { hz: BAKE_HZ, v: need } };

  // ---- evaluation
  const scratch = {} as Base;
  const pose = (tIn: number): RigPose => {
    const at = clamp(tIn, 0, duration);
    const b = base(at, scratch);
    const g = groundAt(b, at);
    const lnk = trackAt(tracks.lnK, at);
    const dc = trackAt(tracks.dC, at);
    const dist = lnk === 0 ? b.dist : b.dist * Math.exp(lnk);
    const ty = g + b.lift;
    const position = posOf(b, ty, dist);
    position[1] += dc;
    return {
      beat: b.beat,
      x: b.x,
      tx: b.tx,
      ty,
      tz: b.tz,
      dist,
      el: b.el,
      az: b.az,
      fov: (2 * Math.atan(b.tanHalf)) / D2R,
      roll: b.roll,
      w: 2 * dist * b.tanHalf * ASPECT,
      s: b.s,
      Z: b.Z,
      lnK: lnk,
      dC: dc,
      position,
    };
  };
  const camera = (tIn: number): CameraState => {
    const p = pose(tIn);
    const cam: CameraState = { position: p.position, target: [p.tx, p.ty, p.tz], fov: p.fov };
    if (p.roll) cam.roll = p.roll;
    return cam;
  };
  const head = (tIn: number): number => {
    const at = clamp(tIn, 0, duration);
    const i = beatAt(at);
    const kIdx = keyOfBeat[i];
    if (kIdx >= 0) return keys[kIdx].head;
    const m = moves[moveOfBeat[i]];
    const hA = keys[keyOfBeat[m.a]].head;
    const hB = keys[keyOfBeat[m.b]].head;
    if (hA === hB) return hA;
    const x = clamp((at - m.t0) / m.dur, 0, 1);
    const xh = Math.min(1, (x * m.dur) / Math.max(1e-9, m.dur - m.tau));
    return hA + (hB - hA) * panProgress(m, xh);
  };

  return { keys, moves, keyOfBeat, moveOfBeat, t0s, durs, duration, tracks, beatAt, pose, camera, head, panProgress, deckAt, deckExempt, water };
}
