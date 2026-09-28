import type { FrameContext, InitContext, System } from '../core/types.ts';
import type { World } from '../world/World.ts';

/** Forests and scatter (stub — implemented by the vegetation module in S1-E). */
export class VegetationSystem implements System {
  readonly id = 'vegetation';
  constructor(private readonly world: World) {}
  init(_ctx: InitContext): void {
    void this.world;
  }
  evaluate(_frame: FrameContext): void {}
}
