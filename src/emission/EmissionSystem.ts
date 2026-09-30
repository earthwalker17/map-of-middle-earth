import type { FrameContext, InitContext, SceneState, System } from '../core/types.ts';
import type { LightRecord } from '../landmarks/records.ts';
import type { World } from '../world/World.ts';

/**
 * Landmark lights (windows, lamps, fires, lava, the Eye, Morgul magic, ithildin) as ONE instanced,
 * additive, energy-normalised sprite draw in the main HDR target — readable as warm windows at dusk
 * and as stable sub-pixel sparkles in wide shots. Gates are pure functions of the env uniforms
 * (night / twilight / golden); flicker reads env.tFx. No per-light three.js lights.
 *
 * W0a stub: records are stored and counted; W1 implements the sprite pass.
 */
export class EmissionSystem implements System {
  readonly id = 'emission';
  readonly stats = { count: 0 };
  private dynamic: ((s: SceneState) => LightRecord[]) | null = null;

  constructor(
    private readonly world: World,
    readonly records: LightRecord[],
  ) {
    this.stats.count = records.length;
  }

  /** S4: timeline-driven lights (beacons, signals) — must be a pure function of the state. */
  setDynamic(fn: (s: SceneState) => LightRecord[]): void {
    this.dynamic = fn;
  }

  init(_ctx: InitContext): void {
    void this.world;
    void this.dynamic;
  }

  evaluate(_frame: FrameContext): void {}
}
