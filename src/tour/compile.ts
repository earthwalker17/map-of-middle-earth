/**
 * Film compiler (S5): data/tour/timeline.json v1 + route.json v2 → CompiledFilm + a pure evaluate(t).
 *
 *  - route.ts compiles the draped route, rail.ts its camera rails, rig.ts the camera (keys, van Wijk–Nuij
 *    moves, C2 drift blends, baked target height / deck cap / clearance, `dur: "auto"`) and the route head;
 *  - captions.ts compiles the captions (anchors from the landmark build when `built` is given, side chosen
 *    from the anchor's projection);
 *  - slow channels are evaluated at the frame's own time t_q = ⌊t·fps⌋/fps (one value per frame, so the sky
 *    LUT is not rebuilt per motion-blur sub-sample): tod (a monotone cubic through the holds' start / end
 *    keys with the holds' rates as knot slopes, exactly linear inside each hold), events, look (ids switch
 *    only at weight 0), lens (aperture eased across moves), captions, route glow, weather. Camera, tFx and
 *    the route head use the exact t.
 * Pure: no three.js render objects, no DOM — Node and the page compile identical films (same hash).
 */
import type { ShotSpecInput } from '../camera/shots.ts';
import { defaultSceneState, type AnnotationState, type SceneState, type WeatherState } from '../core/types.ts';
import type { BuiltLandmark } from '../landmarks/records.ts';
import type { LandmarkDefinition } from '../landmarks/types.ts';
import type { World } from '../world/World.ts';
import { DEEP_FOCUS_FSTOP } from '../render/lens.ts';
import { captionReveal, compileCaptions } from './captions.ts';
import { clamp, lerp, monotoneHermite, pchipAt, smootherstep } from './curves.ts';
import { fnv1a } from './hash.ts';
import { buildRails, type Rails } from './rail.ts';
import { buildRig, type CameraRig } from './rig.ts';
import { compileRoute, hashFloats } from './route.ts';
import { isHold, type BeatInfo, type CaptionDef, type CompiledFilm, type HoldJson, type RouteJson, type TimelineJson } from './schema.ts';

export { resolveCameraRef } from './rig.ts';

export const FILM_COMPILER = 'film-v1';

export interface FilmInputs {
  world: World;
  landmarks: LandmarkDefinition[];
  /** shots that `camera.shot` may reference (data/qa/shots.json; orbit shots only) */
  shots: ShotSpecInput[];
  route: RouteJson;
  timeline: TimelineJson;
  /** the landmark build (caption anchors at 0.6 × the built height); absent → ground + 0.5 km */
  built?: BuiltLandmark[];
}

export interface FilmProgram {
  film: CompiledFilm;
  /** the complete state at film time t (pure; fractional t for motion-blur sub-samples) */
  evaluate(t: number): SceneState;
  /** the camera rig (keys, moves, baked tracks, pose / head at t) — diagnostics for the film checks */
  rig: CameraRig;
  rails: Rails;
}

interface LookKey {
  id: string;
  weight: number;
}

export function compileFilm(inp: FilmInputs): FilmProgram {
  const { world, timeline: tl } = inp;
  if (tl.version !== 1) throw new Error(`timeline.json: version ${tl.version} (want 1)`);
  const beats = tl.beats;
  if (!beats.length || !isHold(beats[0]) || !isHold(beats[beats.length - 1])) throw new Error('timeline: must start and end with a hold');
  for (let i = 1; i < beats.length; i++) if (isHold(beats[i]) === isHold(beats[i - 1])) throw new Error(`timeline: beats must alternate hold / move (at ${i})`);
  const fps = tl.film.fps;

  const route = compileRoute(world, inp.route);
  const rails = buildRails(route);
  const rig = buildRig({ world, landmarks: inp.landmarks, shots: inp.shots, route, rails, timeline: tl });
  const { t0s, durs, duration } = rig;

  // ---- per-hold slow channels
  const holdIdx = beats.map((b, i) => (isHold(b) ? i : -1)).filter((i) => i >= 0);
  const glows = new Map<number, number>();
  const looks = new Map<number, LookKey | null>();
  const apertures = new Map<number, number>();
  const weathers = new Map<number, WeatherState>();
  let glow = 0;
  for (const i of holdIdx) {
    const h = beats[i] as HoldJson;
    if (h.routeGlow !== undefined) glow = h.routeGlow;
    else if (i > 0) glow = 1;
    glows.set(i, glow);
    looks.set(i, h.look && h.look.weight > 0 ? { id: h.look.id, weight: h.look.weight } : null);
    const lens = h.lens?.fStop;
    const fStop = lens === undefined ? DEEP_FOCUS_FSTOP : lens === 'bookmark' ? (rig.keys[rig.keyOfBeat[i]].fStop ?? DEEP_FOCUS_FSTOP) : lens;
    apertures.set(i, 1 / Math.min(DEEP_FOCUS_FSTOP, fStop));
    weathers.set(i, { ...tl.film.weather, ...h.weather, wind: [...(h.weather?.wind ?? tl.film.weather.wind)] as [number, number] });
  }

  // ---- time of day: a monotone cubic through every hold's start and end keys whose knot slopes are the
  // holds' own rates (kept: a move too short in hours for them gets interior knots, see monotoneHermite): a
  // hold drifts linearly (the light steady while its text is read), a move eases from one hold's rate to the
  // next one's (C1, no kinks at the hold boundaries). Only a move with no tod change between two moving holds
  // bends their ends (the film check flags any hold whose tod is not linear).
  const todX: number[] = [];
  const todY: number[] = [];
  const todM: number[] = [];
  for (const i of holdIdx) {
    const h = beats[i] as HoldJson;
    const rate = (h.tod[1] - h.tod[0]) / durs[i];
    todX.push(t0s[i], t0s[i] + durs[i]);
    todY.push(h.tod[0], h.tod[1]);
    todM.push(rate, rate);
  }
  const todTrack = monotoneHermite(todX, todY, todM);

  // ---- events: absolute keys per channel (smoothstep between keys, held after the last)
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
    for (let k = 1; k < ks.length; k++) {
      if (at > ks[k][0]) continue;
      const u = (at - ks[k - 1][0]) / Math.max(1e-6, ks[k][0] - ks[k - 1][0]);
      return lerp(ks[k - 1][1], ks[k][1], u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
    }
    return ks[ks.length - 1][1];
  };

  // ---- captions (anchors from the build when given; the side only where authored)
  const captions: CaptionDef[] = compileCaptions({ world, landmarks: inp.landmarks, built: inp.built, beats, t0s, durs });

  // ---- beat table
  const beatInfo: BeatInfo[] = beats.map((b, i) => {
    if (isHold(b)) return { id: b.hold, kind: 'hold', style: b.style, t0: t0s[i], t1: t0s[i] + durs[i], place: b.place, tod: b.tod, music: b.music };
    const pa = beats[i - 1] as HoldJson;
    const nb = beats[i + 1] as HoldJson;
    return { id: b.move, kind: 'move', t0: t0s[i], t1: t0s[i] + durs[i], tod: [pa.tod[1], nb.tod[0]], music: b.music };
  });

  // ---- content hash: inputs + the compiled numbers (Node and the page must agree)
  let h = Number.parseInt(fnv1a(`${FILM_COMPILER}|${route.hash}|${JSON.stringify(tl)}|${JSON.stringify(captions)}`), 16);
  h = hashFloats(h, t0s);
  for (const k of rig.keys) h = hashFloats(h, [k.tx, k.tz, k.ground, k.s, k.ox, k.oz, k.dist, k.el, k.az, k.lnW, k.head]);
  for (const m of rig.moves) h = hashFloats(h, [m.dur, m.L, m.path.S]);
  h = hashFloats(hashFloats(hashFloats(h, rig.tracks.gBar.v), rig.tracks.lnK.v), rig.tracks.dC.v);
  const film: CompiledFilm = {
    fps,
    shutter: tl.film.shutter,
    duration,
    dayOfYear: tl.film.dayOfYear,
    status: tl.status,
    beats: beatInfo,
    route,
    captions,
    hash: h.toString(16).padStart(8, '0'),
  };

  const evaluate = (tIn: number): SceneState => {
    const at = clamp(tIn, 0, duration);
    // slow channels at the frame's own time (no per-sub-sample LUT rebuilds, exact per frame)
    const tq = Math.min(duration, Math.floor(at * fps + 1e-6) / fps);
    const iq = rig.beatAt(tq);
    const bq = beats[iq];
    const xq = clamp((tq - t0s[iq]) / Math.max(1e-9, durs[iq]), 0, 1);

    let glowNow: number;
    let look: LookKey | null;
    let aperture: number;
    let weather: WeatherState;
    if (isHold(bq)) {
      glowNow = glows.get(iq)!;
      look = looks.get(iq)!;
      aperture = apertures.get(iq)!;
      const w = weathers.get(iq)!;
      weather = { cloudCoverage: w.cloudCoverage, wind: [w.wind[0], w.wind[1]] };
    } else {
      const E = smootherstep(xq);
      glowNow = lerp(glows.get(iq - 1)!, glows.get(iq + 1)!, E);
      const la = looks.get(iq - 1)!;
      const lb = looks.get(iq + 1)!;
      // the same look on both sides glides between the weights; otherwise it fades out over the first
      // half of the move and the next one in over the second (the id switches only at weight 0)
      if (la && lb && la.id === lb.id) look = { id: la.id, weight: lerp(la.weight, lb.weight, E) };
      else if (xq < 0.5) look = la ? { id: la.id, weight: la.weight * (1 - smootherstep(xq * 2)) } : null;
      else look = lb ? { id: lb.id, weight: lb.weight * smootherstep(xq * 2 - 1) } : null;
      const aa = apertures.get(iq - 1)!;
      const ab = apertures.get(iq + 1)!;
      aperture = aa === ab ? aa : lerp(aa, ab, E);
      const wa = weathers.get(iq - 1)!;
      const wb = weathers.get(iq + 1)!;
      weather = { cloudCoverage: lerp(wa.cloudCoverage, wb.cloudCoverage, E), wind: [lerp(wa.wind[0], wb.wind[0], E), lerp(wa.wind[1], wb.wind[1], E)] };
    }
    // aperture 1/N eased across moves; at (or within rounding of) deep focus the lens stays a pinhole
    const fStop = aperture <= 1 / DEEP_FOCUS_FSTOP + 1e-12 ? DEEP_FOCUS_FSTOP : 1 / aperture;
    const events: Record<string, number> = {};
    for (const [ch, ks] of evKeys) events[ch] = evalEvent(ks, tq);
    const annotations: AnnotationState[] = [];
    for (const c of captions) {
      const r = captionReveal(c, tq);
      if (r > 0) annotations.push({ id: c.id, reveal: r });
    }
    const head = rig.head(at);
    return defaultSceneState({
      t: at,
      tFx: at * tl.film.tFxScale,
      tod: pchipAt(todTrack, tq),
      dayOfYear: tl.film.dayOfYear,
      camera: rig.camera(at),
      lens: { fStop },
      routeProgress: route.length > 0 ? head / route.length : 0,
      annotations,
      lookOverride: look && look.weight > 0 ? look.id : null,
      ...(look && look.weight > 0 ? { lookOverrideWeight: look.weight } : {}),
      weather,
      events,
      ...(tl.film.lodBias !== undefined ? { lodBias: tl.film.lodBias } : {}),
      routeGlow: glowNow,
    });
  };

  return { film, evaluate, rig, rails };
}
