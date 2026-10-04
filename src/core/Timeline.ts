import { defaultSceneState, type CameraState, type SceneState, type WeatherState } from './types.ts';
import type { QualityTierId } from './quality.ts';
import { DEEP_FOCUS_FSTOP } from '../render/lens.ts';

/**
 * A timeline maps time t (seconds) to a complete SceneState. Bookmarks and QA shots are
 * constant timelines; the journey film (S5) is a keyframed timeline authored in data/tour
 * (src/tour/FilmTimeline.ts).
 */
export interface Timeline {
  readonly id: string;
  readonly duration: number;
  evaluate(t: number): SceneState;
  /** optional metadata for the capture harness (the film: fps, beats, hash) */
  meta?(): unknown;
}

/** A shot description as stored in data/qa/shots.json or produced from a bookmark. */
export interface ShotSpec {
  id: string;
  camera: CameraState;
  tod: number;
  dayOfYear?: number;
  tFx?: number;
  fStop?: number;
  quality?: QualityTierId;
  lookOverride?: string | null;
  weather?: Partial<WeatherState>;
  /** SceneState.events channels (e.g. { beacons: 1 }) */
  events?: Record<string, number>;
  /** reference images (paths relative to project root) to compare against in QA sheets */
  compare?: string[];
  note?: string;
}

/** A single still: time does not move the camera; t and tFx advance so effects can be sampled. */
export class StaticTimeline implements Timeline {
  readonly duration = Number.POSITIVE_INFINITY;
  constructor(readonly spec: ShotSpec) {}
  get id(): string {
    return this.spec.id;
  }
  evaluate(t: number): SceneState {
    const base = defaultSceneState();
    return defaultSceneState({
      t,
      tFx: (this.spec.tFx ?? 0) + t,
      tod: this.spec.tod,
      dayOfYear: this.spec.dayOfYear ?? 200,
      camera: this.spec.camera,
      // deep focus (pinhole) unless the shot sets an f-stop: only the close heroes carry one (S4 lens)
      lens: { fStop: this.spec.fStop ?? DEEP_FOCUS_FSTOP },
      lookOverride: this.spec.lookOverride ?? null,
      weather: { ...base.weather, ...this.spec.weather },
      events: { ...this.spec.events },
      quality: this.spec.quality ?? 'review',
    });
  }
}
