/**
 * S5 film contracts: the authored JSON (data/tour/route.json v2, data/tour/timeline.json v1) and the
 * compiled, render-ready form shared by the page (FilmTimeline, RouteSystem, TitleSystem), the film
 * renderer (tools/capture/film.ts), the film checks (tools/check/film.ts) and the music cue sheet.
 *
 * Coordinates: authored points are ME-GIS km [x east, y north] or place ids (display positions);
 * compiled data is in world units (1 = 1 km, X east, −Z north, Y up). Time t is film seconds.
 * Everything here is plain data — no three.js, no DOM — so Node and the browser compile identically.
 */
import type { OrbitSpec } from '../camera/shots.ts';
import type { WeatherState } from '../core/types.ts';

// ───────────────────────────── route.json (v2) ─────────────────────────────

/** A route point: a place (display position, optional km offset) or explicit ME-GIS km. */
export interface RoutePointJson {
  place?: string;
  /** ME-GIS km [x, y] */
  at?: [number, number];
  /** ME-GIS km [east, north] added to a place's display position */
  offsetKm?: [number, number];
  /** name of the arc-length mark at this point (default: the place id; `at` points have none) */
  mark?: string;
}

/**
 * foot = smooth curve over the ground · boat = along a river centreline (`river` id) or straight over a
 * lake (`lake` key) at the water level · underground = drawn dotted and dim (Moria), heights still draped.
 */
export type RouteMode = 'foot' | 'boat' | 'underground';

export interface RouteLegJson {
  id: string;
  mode?: RouteMode;
  /** boat legs: RiverLine.id to follow between the leg's first and last point */
  river?: string;
  /** boat legs: LakePoly.key to cross at its level */
  lake?: string;
  /** legs chain: a leg's first point equals the previous leg's last point */
  points: RoutePointJson[];
  note?: string;
}

export interface RouteJson {
  version: 2;
  notes?: string;
  defaults: { spacingKm: number; liftKm: number };
  legs: RouteLegJson[];
}

/** Mode codes in CompiledRoute.mode */
export const ROUTE_MODE: Record<RouteMode, number> = { foot: 0, boat: 1, underground: 2 };

/** The densified, draped route (world units). */
export interface CompiledRoute {
  /** per sample: x, y (draped), z, s (cumulative XZ arc length, km) — stride 4 */
  pts: Float64Array;
  /** per sample: unit XZ tangent tx, tz — stride 2 */
  tan: Float32Array;
  /** per sample: ROUTE_MODE code */
  mode: Uint8Array;
  /** per sample: leg index */
  leg: Uint16Array;
  count: number;
  /** total arc length, km */
  length: number;
  /** named marks (place ids, explicit `mark`s, `<leg>:start` / `<leg>:end`) → arc length s */
  marks: Record<string, number>;
  legs: { id: string; mode: RouteMode; s0: number; s1: number }[];
  /** content hash (inputs + compiler version) */
  hash: string;
}

// ───────────────────────────── timeline.json (v1) ─────────────────────────────

/** Orbit fields a beat may override on its camera reference. */
export type OrbitOverride = Partial<Omit<OrbitSpec, 'place' | 'targetKm'>>;

/** Where a hold's camera key comes from: a landmark bookmark, a QA shot, or an inline orbit (+ overrides). */
export interface CameraRefJson {
  /** landmark bookmark id (`<landmark>-close` / `-wide`); its tod / dayOfYear / events are ignored */
  bookmark?: string;
  /** shot id from data/qa/shots.json (orbit shots only) */
  shot?: string;
  orbit?: OrbitSpec;
  /** applied on top of the reference in orbit space */
  set?: OrbitOverride;
}

/** Slow camera motion through a hold (pauses never stop dead). Rates are per second. */
export interface DriftJson {
  /** azimuth change, degrees / s (positive = clockwise seen from above) */
  azDegPerS?: number;
  /** relative distance change, 1 / s (negative = push in) */
  pushPerS?: number;
  /** target slide along the route, km / s */
  alongKmPerS?: number;
  /** elevation change, degrees / s */
  elDegPerS?: number;
}

export type CaptionKind = 'title' | 'place' | 'pass' | 'end' | 'fade';

export interface CaptionJson {
  kind: CaptionKind;
  /** place / pass: the landmark whose annotation (title, subtitle) and position are used */
  landmark?: string;
  /** overrides the landmark annotation title (place / pass) or sets the card text (title / end) */
  text?: string;
  /** subtitle line (title / place); `false` hides the landmark's subtitle */
  sub?: string | false;
  /** extra lines (end card credits) */
  lines?: string[];
  /** beat-relative start, s (default per kind) */
  in?: number;
  /** beat-relative end, s; negative = from the beat's end (default per kind) */
  out?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** label placement relative to its anchor (default: chosen by the compiler) */
  side?: 'left' | 'right' | 'above' | 'below';
  /** anchor height above the ground at the landmark, km (default from the landmark bounds) */
  anchorLiftKm?: number;
  /**
   * anchor offset from the landmark's display position, ME-GIS km [east, north] (e.g. onto the hall a label
   * names when the display point is the valley's centre); the height then follows the ground there
   */
  anchorOffsetKm?: [number, number];
}

export interface MusicCueJson {
  mood: string;
  /** 0..1 */
  intensity: number;
  /** a sync point at the beat start (e.g. 'arrive', 'reveal', 'beacon', 'beam') */
  hit?: string;
}

/** Event keys: beat-relative [t, value] pairs, smoothstep between keys, held after the last. */
export type EventKeysJson = Record<string, [number, number][]>;

export type HoldStyle = 'open' | 'hero' | 'stop' | 'end';

export interface HoldJson {
  hold: string;
  style: HoldStyle;
  /** seconds */
  dur: number;
  /** subject place (route head mark, captions, light checks) */
  place?: string;
  camera: CameraRefJson;
  drift?: DriftJson;
  /** time of day at the hold's start and end, hours */
  tod: [number, number];
  /** route head during the hold: a mark name (the head rests there) — default `place` or the previous */
  head?: string;
  /** overall route-line strength 0..1 (default 1 once the route has started, 0 before) */
  routeGlow?: number;
  events?: EventKeysJson;
  look?: { id: string; weight: number } | null;
  /** f-stop, or 'bookmark' = the referenced bookmark's fStop (DOF only at spp ≥ 8) */
  lens?: { fStop: number | 'bookmark' };
  weather?: Partial<WeatherState>;
  captions?: CaptionJson[];
  music?: MusicCueJson;
  /** light-check exemption ('silhouette' = a deliberately backlit framing) */
  light?: 'silhouette' | 'shade';
  note?: string;
}

export interface MoveJson {
  move: string;
  /** seconds, or 'auto' (from the van Wijk–Nuij path length at defaults.move.vTarget) */
  dur: number | 'auto';
  /** cap on the camera height during the move, world units (e.g. under an ash deck) */
  maxAltKm?: number;
  /** ρ of the zoom / pan path (default defaults.move.rho) */
  rho?: number;
  /** peak elevation while zoomed out, degrees */
  apexEl?: number;
  /**
   * the move may rise through an ash deck (the final pull-out out of Mordor): the rig's deck rule (stay
   * 6 km under a covering deck) does not apply to it, and the film check accepts the crossing
   */
  crossDeck?: boolean;
  captions?: CaptionJson[];
  events?: EventKeysJson;
  music?: MusicCueJson;
  note?: string;
}

export type BeatJson = HoldJson | MoveJson;

export interface TimelineJson {
  version: 1;
  /** draft = film-probe motion / light findings are warnings; locked = errors (picture lock) */
  status: 'draft' | 'locked';
  notes?: string;
  film: {
    fps: number;
    /** shutter as a fraction of the frame interval (0.5 = 180°) */
    shutter: number;
    dayOfYear: number;
    /** allowed total length, s */
    lengthS: [number, number];
    /** effect clock rate (tFx = t · tFxScale): slower smoke / water / clouds read larger */
    tFxScale: number;
    weather: WeatherState;
    /** film-wide landmark LOD bias (SceneState.lodBias) */
    lodBias?: number;
  };
  defaults: {
    move: { rho: number; vTarget: number; minS: number; maxS: number; apexEl: number; headLeadS: number };
    hero: { drift: DriftJson };
    stop: { drift: DriftJson };
    open: { drift: DriftJson };
    end: { drift: DriftJson };
  };
  beats: BeatJson[];
}

export const isHold = (b: BeatJson): b is HoldJson => 'hold' in b;

// ───────────────────────────── compiled film ─────────────────────────────

/** A caption ready for the TitleSystem: text, anchor and its visible window (film seconds). */
export interface CaptionDef {
  /** unique id; SceneState.annotations[] carries {id, reveal} for the visible ones */
  id: string;
  kind: CaptionKind;
  title?: string;
  sub?: string;
  lines?: string[];
  /** world-space anchor (place / pass labels) */
  anchor?: [number, number, number];
  side?: 'left' | 'right' | 'above' | 'below';
  /** visible window [t0, t1] (film seconds) and fade lengths */
  t0: number;
  t1: number;
  fadeIn: number;
  fadeOut: number;
}

export interface BeatInfo {
  id: string;
  kind: 'hold' | 'move';
  style?: HoldStyle;
  t0: number;
  t1: number;
  place?: string;
  tod: [number, number];
  music?: MusicCueJson;
}

/** Everything the page / tools need about the film, plus its timeline. */
export interface CompiledFilm {
  fps: number;
  shutter: number;
  duration: number;
  dayOfYear: number;
  status: 'draft' | 'locked';
  beats: BeatInfo[];
  route: CompiledRoute;
  captions: CaptionDef[];
  /** content hash of the compiled film (route + timeline + compiler version) */
  hash: string;
}

// ───────────────────────────── music cue sheet ─────────────────────────────

/** A run of consecutive beats with the same music mood. */
export interface CueSection {
  id: string;
  t0: number;
  t1: number;
  mood: string;
}

/** One beat as a music cue: its window, mood, intensity curve (film seconds, 0..1), subject and time of day. */
export interface CueBeat {
  id: string;
  kind: 'hold' | 'move';
  /** hold style (hero / stop / open / end); moves: 'move' */
  style: string;
  t0: number;
  t1: number;
  mood: string;
  /** [t, value] keys: the intensity ramps from the previous beat's over the first second (moves: across the move) */
  intensity: [number, number][];
  place: string | null;
  /** time of day at the beat's start and end, hours */
  tod: [number, number];
}

/** A sync point the score should land on. */
export interface CueHit {
  t: number;
  /** beat hits: the beat's `music.hit` ('arrive', 'reveal', 'beacon', …); events: `event:<channel>` */
  type: string;
  beat: string;
}

/** The music cue sheet (tools/check/film.ts --cues; tools/music reads it). */
export interface CueSheet {
  version: 1;
  film: { duration: number; fps: number; hash: string };
  tempoHint: { bpm: number };
  sections: CueSection[];
  cues: CueBeat[];
  hits: CueHit[];
}

/** Metadata the film timeline reports to the capture harness (Timeline.meta). */
export interface FilmMeta {
  fps: number;
  shutter: number;
  duration: number;
  hash: string;
  status: 'draft' | 'locked';
  beats: BeatInfo[];
}
