import type { FrameContext, InitContext, System } from '../core/types.ts';
import type { World } from '../world/World.ts';

/** The floating diorama slab: strata sides, sea cross-section, base, backdrop (stub — S1-E). */
export class DioramaSystem implements System {
  readonly id = 'diorama';
  constructor(private readonly world: World) {}
  init(_ctx: InitContext): void {
    void this.world;
  }
  evaluate(_frame: FrameContext): void {}
}
