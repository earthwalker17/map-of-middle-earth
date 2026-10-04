/**
 * Film compiler (S5): data/tour/timeline.json v1 + route.json v2 → CompiledFilm + a pure evaluate(t).
 *
 * WAVE-0 STUB (main agent): beat timing, camera keys (bookmark / shot / orbit + overrides), a simple
 * orbit-space blend in moves (log distance with a zoom-out bump, shortest-arc azimuth), linear drift,
 * tod / events / look / lens / captions / route head. The tour agent replaces the camera rig
 * (van Wijk–Nuij moves along route rails, C2 drift blends, clearance, deck cap, auto durations)
 * behind the same `compileFilm` signature. Pure: no three.js, no DOM — Node and the page agree.
 */
import type { ShotSpecInput, OrbitSpec } from '../camera/shots.ts';
import { defaultSceneState, type AnnotationState, type SceneState } from '../core/types.ts';
import type { LandmarkDefinition } from '../landmarks/types.ts';
import type { World } from '../world/World.ts';
import { DEEP_FOCUS_FSTOP } from '../render/lens.ts';
import { fnv1a } from './hash.ts';
import { compileRoute } from './route.ts';
import {
  isHold,
  type BeatInfo,
  type CameraRefJson,
  type CaptionDef,
  type CaptionJson,
  type CompiledFilm,
  type HoldJson,
  type MoveJson,
  type RouteJson,
  type TimelineJson,
} from './schema.ts';

export const FILM_COMPILER = 'film-v0';

export interface FilmInputs {
  world: World;
  landmarks: LandmarkDefinition[];
  /** shots that `camera.shot` may reference (data/qa/shots.json; orbit shots only) */
  shots: ShotSpecInput[];
  route: RouteJson;
  timeline: TimelineJson;
}

export interface FilmProgram {
  film: CompiledFilm;
  /** the complete state at film time t (pure; fractional t for motion-blur sub-samples) */
  evaluate(t: number): SceneState;
}

/** A camera key in orbit space (world units / degrees). */
interface Key {
  x: number;
  z: number;
  lift: number;
  dist: number;
  el: number;
  az: number;
  fov: number;
  roll: number;
  fStop?: number;
}

const smooth01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const smoother01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (6 * x - 15) + 10));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** The orbit (+ bookmark f-stop) a camera reference resolves to. */
export function resolveCameraRef(ref: CameraRefJson, inp: Pick<FilmInputs, 'landmarks' | 'shots'>): { orbit: OrbitSpec; fStop?: number; landmark?: LandmarkDefinition } {
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

function keyOf(world: World, o: OrbitSpec, fStop?: number): Key {
  let x: number;
  let z: number;
  if (o.place) ({ x, z } = world.place(o.place));
  else if (o.targetKm) [x, z] = world.spec.kmToWorld(o.targetKm[0], o.targetKm[1]);
  else throw new Error('film: orbit needs place or targetKm');
  if (o.aimKm) {
    x += o.aimKm[0];
    z -= o.aimKm[1];
  }
  return { x, z, lift: o.lift ?? 0, dist: o.distanceKm, el: o.elevationDeg, az: o.azimuthDeg, fov: o.fov ?? 35, roll: o.roll ?? 0, fStop };
}

/** Caption defaults per kind: [in, out, fadeIn, fadeOut] (beat-relative; negative out = from the end). */
const CAPTION_DEFAULTS: Record<CaptionJson['kind'], [number, number, number, number]> = {
  title: [1.5, -1.5, 1.5, 1.2],
  place: [0.8, -0.6, 0.7, 0.6],
  pass: [0.4, -0.4, 0.5, 0.4],
  end: [1, -1, 1.2, 1.2],
  fade: [0, -0, 0, 0],
};

export function compileFilm(inp: FilmInputs): FilmProgram {
  const { world, timeline: tl } = inp;
  if (tl.version !== 1) throw new Error(`timeline.json: version ${tl.version} (want 1)`);
  const route = compileRoute(world, inp.route);
  const fps = tl.film.fps;
  const beats = tl.beats;
  if (!beats.length || !isHold(beats[0]) || !isHold(beats[beats.length - 1])) throw new Error('timeline: must start and end with a hold');
  for (let i = 1; i < beats.length; i++) if (isHold(beats[i]) === isHold(beats[i - 1])) throw new Error(`timeline: beats must alternate hold / move (at ${i})`);

  // ---- timing
  const AUTO_STUB_S = 6;
  const t0s: number[] = [];
  let t = 0;
  for (const b of beats) {
    t0s.push(t);
    t += isHold(b) ? b.dur : b.dur === 'auto' ? AUTO_STUB_S : b.dur;
  }
  const duration = t;
  const durOf = (i: number) => (i + 1 < beats.length ? t0s[i + 1] : duration) - t0s[i];

  // ---- holds: keys, head marks, glow, look, lens
  const holdIdx = beats.map((b, i) => (isHold(b) ? i : -1)).filter((i) => i >= 0);
  const keys = new Map<number, Key>();
  const heads = new Map<number, number>();
  const glows = new Map<number, number>();
  let lastHead = 0;
  let glow = 0;
  for (const i of holdIdx) {
    const h = beats[i] as HoldJson;
    const r = resolveCameraRef(h.camera, inp);
    keys.set(i, keyOf(world, r.orbit, r.fStop));
    const mark = h.head ?? h.place;
    if (mark !== undefined && route.marks[mark] !== undefined) lastHead = route.marks[mark];
    heads.set(i, lastHead);
    if (h.routeGlow !== undefined) glow = h.routeGlow;
    else if (i > 0) glow = 1;
    glows.set(i, glow);
  }
  const prevHold = (i: number) => (isHold(beats[i]) ? i : i - 1);
  const nextHold = (i: number) => (isHold(beats[i]) ? i : i + 1);
  const driftOf = (i: number) => {
    const h = beats[i] as HoldJson;
    return { ...tl.defaults[h.style].drift, ...h.drift };
  };

  /** the hold's key with its drift applied at film time t */
  const heldKey = (i: number, at: number): Key => {
    const k = keys.get(i)!;
    const d = driftOf(i);
    const dt = at - (t0s[i] + durOf(i) / 2);
    return { ...k, az: k.az + (d.azDegPerS ?? 0) * dt, dist: k.dist * Math.exp((d.pushPerS ?? 0) * dt), el: k.el + (d.elDegPerS ?? 0) * dt };
  };

  // ---- events: absolute keys per channel
  const evKeys = new Map<string, [number, number][]>();
  beats.forEach((b, i) => {
    for (const [ch, ks] of Object.entries(b.events ?? {})) {
      const list = evKeys.get(ch) ?? [];
      for (const [kt, v] of ks) list.push([t0s[i] + kt, v]);
      evKeys.set(ch, list);
    }
  });
  for (const l of evKeys.values()) l.sort((a, b) => a[0] - b[0]);
  const evalEvent = (ks: [number, number][], at: number): number => {
    if (at <= ks[0][0]) return ks[0][1];
    for (let k = 1; k < ks.length; k++) if (at <= ks[k][0]) return lerp(ks[k - 1][1], ks[k][1], smooth01((at - ks[k - 1][0]) / Math.max(1e-6, ks[k][0] - ks[k - 1][0])));
    return ks[ks.length - 1][1];
  };

  // ---- captions
  const captions: CaptionDef[] = [];
  beats.forEach((b, i) => {
    (b.captions ?? []).forEach((c, ci) => {
      const [din, dout, dfi, dfo] = CAPTION_DEFAULTS[c.kind];
      const bt0 = t0s[i];
      const bt1 = bt0 + durOf(i);
      // beat-relative seconds; negative = from the beat's end (an `out` default of -0 = the beat's end)
      const rel = (v: number | undefined, dflt: number, isOut: boolean) => {
        const x = v ?? dflt;
        return x < 0 || (isOut && Object.is(x, -0)) ? bt1 + x : bt0 + x;
      };
      const def: CaptionDef = { id: `${(b as HoldJson).hold ?? (b as MoveJson).move}:${c.kind}:${ci}`, kind: c.kind, t0: rel(c.in, din, false), t1: rel(c.out, dout, true), fadeIn: c.fadeIn ?? dfi, fadeOut: c.fadeOut ?? dfo };
      if (c.kind === 'place' || c.kind === 'pass') {
        const def0 = inp.landmarks.find((l) => l.id === c.landmark);
        if (!def0) throw new Error(`film: caption landmark '${c.landmark}' unknown`);
        const p = world.place(def0.placeId);
        def.title = c.text ?? def0.annotation.title;
        if (c.kind === 'place' && c.sub !== false) def.sub = c.sub ?? def0.annotation.subtitle;
        if (c.kind === 'pass' && typeof c.sub === 'string') def.sub = c.sub;
        def.anchor = [p.x, Math.max(0, world.heights.sample(p.x, p.z)) + (c.anchorLiftKm ?? 0.5), p.z];
        if (c.side) def.side = c.side;
      } else {
        if (c.text) def.title = c.text;
        if (typeof c.sub === 'string') def.sub = c.sub;
        if (c.lines) def.lines = c.lines;
      }
      captions.push(def);
    });
  });
  const reveal = (c: CaptionDef, at: number) => {
    if (at < c.t0 || at > c.t1) return 0;
    const a = c.fadeIn > 0 ? smooth01((at - c.t0) / c.fadeIn) : 1;
    const b = c.fadeOut > 0 ? 1 - smooth01((at - (c.t1 - c.fadeOut)) / c.fadeOut) : 1;
    return Math.min(a, b);
  };

  // ---- beat table
  const beatInfo: BeatInfo[] = beats.map((b, i) => {
    const pa = beats[prevHold(i)] as HoldJson;
    const nb = beats[nextHold(i)] as HoldJson;
    return isHold(b)
      ? { id: b.hold, kind: 'hold', style: b.style, t0: t0s[i], t1: t0s[i] + durOf(i), place: b.place, tod: b.tod, music: b.music }
      : { id: b.move, kind: 'move', t0: t0s[i], t1: t0s[i] + durOf(i), tod: [pa.tod[1], nb.tod[0]], music: b.music };
  });

  const film: CompiledFilm = {
    fps,
    shutter: tl.film.shutter,
    duration,
    dayOfYear: tl.film.dayOfYear,
    status: tl.status,
    beats: beatInfo,
    route,
    captions,
    hash: fnv1a(`${FILM_COMPILER}|${route.hash}|${JSON.stringify(tl)}`),
  };

  const beatAt = (at: number) => {
    let lo = 0;
    let hi = beats.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (t0s[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const evaluate = (tIn: number): SceneState => {
    const at = Math.min(duration, Math.max(0, tIn));
    // slow channels at the frame's own time (no per-sub-sample LUT rebuilds, exact per frame)
    const tq = Math.min(duration, Math.floor(at * fps + 1e-6) / fps);
    const i = beatAt(at);
    const iq = beatAt(tq);
    const b = beats[i];
    const x = Math.min(1, Math.max(0, (at - t0s[i]) / Math.max(1e-6, durOf(i))));
    const xq = Math.min(1, Math.max(0, (tq - t0s[iq]) / Math.max(1e-6, durOf(iq))));

    // ---- camera (orbit space)
    let k: Key;
    let routeS: number;
    if (isHold(b)) {
      k = heldKey(i, at);
      routeS = heads.get(i)!;
    } else {
      const A = heldKey(i - 1, t0s[i]);
      const B = heldKey(i + 1, t0s[i + 1]);
      const e = smoother01(x);
      const travel = Math.hypot(B.x - A.x, B.z - A.z);
      const bump = 1 + 0.6 * (travel / Math.max(A.dist, B.dist)) * Math.sin(Math.PI * x);
      const lead = Math.min(tl.defaults.move.headLeadS, 0.25 * durOf(i));
      const eh = smoother01(Math.min(1, ((at - t0s[i]) / Math.max(1e-6, durOf(i) - lead))));
      k = {
        x: lerp(A.x, B.x, e),
        z: lerp(A.z, B.z, e),
        lift: lerp(A.lift, B.lift, e),
        dist: Math.exp(lerp(Math.log(A.dist), Math.log(B.dist), e)) * bump,
        el: lerp(A.el, B.el, e),
        az: A.az + wrap180(B.az - A.az) * e,
        fov: lerp(A.fov, B.fov, e),
        roll: lerp(A.roll, B.roll, e),
      };
      const mv = b as MoveJson;
      if (mv.maxAltKm !== undefined) {
        const ty = Math.max(0, world.heights.sample(k.x, k.z)) + k.lift;
        const up = Math.sin((k.el * Math.PI) / 180);
        if (up > 0 && ty + k.dist * up > mv.maxAltKm) k.dist = Math.max(1, (mv.maxAltKm - ty) / up);
      }
      routeS = lerp(heads.get(i - 1)!, heads.get(i + 1)!, eh);
    }
    const ty = Math.max(0, world.heights.sample(k.x, k.z)) + k.lift;
    const el = (k.el * Math.PI) / 180;
    const az = (k.az * Math.PI) / 180;
    const hd = k.dist * Math.cos(el);
    const camera = { position: [k.x + Math.sin(az) * hd, ty + k.dist * Math.sin(el), k.z - Math.cos(az) * hd] as [number, number, number], target: [k.x, ty, k.z] as [number, number, number], fov: k.fov, ...(k.roll ? { roll: k.roll } : {}) };

    // ---- slow channels
    const bq = beats[iq];
    let tod: number;
    let glowNow: number;
    let look: { id: string; weight: number } | null = null;
    let fStop = DEEP_FOCUS_FSTOP;
    if (isHold(bq)) {
      tod = lerp(bq.tod[0], bq.tod[1], xq);
      glowNow = glows.get(iq)!;
      look = bq.look ?? null;
      const lens = bq.lens?.fStop;
      if (lens !== undefined) fStop = lens === 'bookmark' ? (keys.get(iq)!.fStop ?? DEEP_FOCUS_FSTOP) : lens;
    } else {
      const A = beats[iq - 1] as HoldJson;
      const B = beats[iq + 1] as HoldJson;
      tod = lerp(A.tod[1], B.tod[0], smooth01(xq));
      glowNow = lerp(glows.get(iq - 1)!, glows.get(iq + 1)!, smooth01(xq));
      // a look fades out in the first half of a move and the next one in over the second (ids switch at 0)
      if (xq < 0.5 && A.look) look = { id: A.look.id, weight: A.look.weight * (1 - smooth01(xq * 2)) };
      else if (xq >= 0.5 && B.look) look = { id: B.look.id, weight: B.look.weight * smooth01(xq * 2 - 1) };
    }
    const events: Record<string, number> = {};
    for (const [ch, ks] of evKeys) events[ch] = evalEvent(ks, tq);
    const annotations: AnnotationState[] = [];
    for (const c of captions) {
      const r = reveal(c, tq);
      if (r > 0) annotations.push({ id: c.id, reveal: r });
    }
    return defaultSceneState({
      t: at,
      tFx: at * tl.film.tFxScale,
      tod,
      dayOfYear: tl.film.dayOfYear,
      camera,
      lens: { fStop },
      routeProgress: route.length > 0 ? routeS / route.length : 0,
      annotations,
      lookOverride: look && look.weight > 0 ? look.id : null,
      ...(look && look.weight > 0 ? { lookOverrideWeight: look.weight } : {}),
      weather: { ...tl.film.weather },
      events,
      ...(tl.film.lodBias !== undefined ? { lodBias: tl.film.lodBias } : {}),
      routeGlow: glowNow,
    });
  };

  return { film, evaluate };
}
