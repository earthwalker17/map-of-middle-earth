import type { PerspectiveCamera, Scene } from 'three/webgpu';
import type { QualityTier, QualityTierId } from './quality.ts';

/** A camera pose in world units (1 unit = 1 km of the ME-GIS grid; X east, -Z north, Y up). */
export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  /** vertical field of view, degrees */
  fov: number;
  /** roll around the view axis, degrees */
  roll?: number;
}

/** Physical-ish lens description (interpreted at table scale by the lens model). */
export interface LensState {
  fStop: number;
  /** focus distance in world units; defaults to |target - position| */
  focusDistance?: number;
}

/** Weather that shaders read through the env uniforms (clouds, wind) — part of the frame's state. */
export interface WeatherState {
  /** 0..1 fraction of sky covered by clouds (drives cloud shadows / cloud layer) */
  cloudCoverage: number;
  /** wind vector in world XZ, km per effect-second (cloud drift, foliage sway, waves) */
  wind: [number, number];
}

export interface AnnotationState {
  id: string;
  /** 0..1 reveal amount */
  reveal: number;
}

/**
 * The complete, explicit description of what a frame shows. Every system derives its output
 * from this (plus static world data) — never from wall-clock time or accumulated state.
 */
export interface SceneState {
  /** timeline time, seconds (camera, tour, annotations) */
  t: number;
  /** effect time, seconds (motion-scaled clock for smoke, water, clouds, flicker) */
  tFx: number;
  /** time of day, hours in [0, 24) */
  tod: number;
  /** day of year 0..365 (sun declination, moon phase) */
  dayOfYear: number;
  camera: CameraState;
  lens: LensState;
  /** 0..1 progress of the journey route reveal */
  routeProgress: number;
  annotations: AnnotationState[];
  /** force a region look (id from looks.json) instead of the spatial blend */
  lookOverride: string | null;
  weather: WeatherState;
  /**
   * Named event channels, 0..1 (S4): timeline-driven switches such as 'beacons' (Minas Tirith beacon
   * fires) or 'morgul-beam' — read by the gate 'event' lights and event-bound effects. Absent = 0.
   */
  events: Record<string, number>;
  quality: QualityTierId;
}

export interface FrameContext {
  readonly state: SceneState;
  readonly camera: PerspectiveCamera;
  readonly scene: Scene;
  readonly quality: QualityTier;
  readonly viewport: { width: number; height: number };
}

export interface System {
  readonly id: string;
  /** one-time setup (load data, build meshes/materials, add to scene) */
  init?(ctx: InitContext): Promise<void> | void;
  /**
   * Update GPU uniforms / visibility for the given frame. Must be a pure function of
   * `frame.state` (+ static data): calling it for frame K without having seen frames < K
   * must give the same result as sequential playback.
   */
  evaluate(frame: FrameContext): void;
  dispose?(): void;
}

export interface InitContext {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly quality: QualityTier;
}

export function defaultSceneState(partial: Partial<SceneState> = {}): SceneState {
  return {
    t: 0,
    tFx: 0,
    tod: 10,
    dayOfYear: 200,
    camera: { position: [0, 900, 900], target: [0, 0, 0], fov: 35 },
    lens: { fStop: 11 },
    routeProgress: 0,
    annotations: [],
    lookOverride: null,
    weather: { cloudCoverage: 0.35, wind: [0.8, 0.3] },
    events: {},
    quality: 'review',
    ...partial,
  };
}
