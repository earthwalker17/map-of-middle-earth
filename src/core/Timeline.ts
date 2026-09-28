import { defaultSceneState, type CameraState, type SceneState } from './types.ts';
import type { QualityTierId } from './quality.ts';

/**
 * A timeline maps time t (seconds) to a complete SceneState. Bookmarks and QA shots are
 * constant timelines; the journey film (S8) is a keyframed timeline authored in data/tour.
 */
export interface Timeline {
  readonly id: string;
  readonly duration: number;
  evaluate(t: number): SceneState;
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
    return defaultSceneState({
      t,
      tFx: (this.spec.tFx ?? 0) + t,
      tod: this.spec.tod,
      dayOfYear: this.spec.dayOfYear ?? 200,
      camera: this.spec.camera,
      lens: { fStop: this.spec.fStop ?? 11 },
      lookOverride: this.spec.lookOverride ?? null,
      quality: this.spec.quality ?? 'review',
    });
  }
}
