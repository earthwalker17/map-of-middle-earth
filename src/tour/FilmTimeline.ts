import type { Timeline } from '../core/Timeline.ts';
import type { SceneState } from '../core/types.ts';
import type { FilmProgram } from './compile.ts';
import type { FilmMeta } from './schema.ts';

/** The journey film as a Timeline (id 'film'): a pure function of film time (src/tour/compile.ts). */
export class FilmTimeline implements Timeline {
  readonly id = 'film';
  constructor(readonly program: FilmProgram) {}
  get duration(): number {
    return this.program.film.duration;
  }
  evaluate(t: number): SceneState {
    return this.program.evaluate(t);
  }
  meta(): FilmMeta {
    const f = this.program.film;
    return { fps: f.fps, shutter: f.shutter, duration: f.duration, hash: f.hash, status: f.status, beats: f.beats };
  }
}
