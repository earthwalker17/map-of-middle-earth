import { Color } from 'three/webgpu';
import { tsl, type TslNode } from './tsl.ts';

const { float, int, texture, uniformArray, vec3 } = tsl;
import looksJson from '../../data/world/looks.json';
import type { World } from '../world/World.ts';

type N = TslNode;

/**
 * Region look data as GPU arrays, indexed like the baked look layers (manifest.look.regions).
 * `regionWeights(uv)` returns one weight node per region (they sum to 1).
 */
export class LookNodes {
  readonly count: number;
  readonly grass;
  readonly dry;
  readonly soil;

  constructor(readonly world: World) {
    const ids = world.lookRegions;
    this.count = ids.length;
    const col = (hex: string) => new Color(hex);
    const g = ids.map((id) => col(looksJson.regions[id].ground.grass));
    const d = ids.map((id) => col(looksJson.regions[id].ground.dry));
    const s = ids.map((id) => col(looksJson.regions[id].ground.soil));
    // palette colours are authored in sRGB; Color(hex) converts to linear working space
    this.grass = uniformArray(g, 'color');
    this.dry = uniformArray(d, 'color');
    this.soil = uniformArray(s, 'color');
  }

  index(id: string): number {
    return this.world.lookRegions.indexOf(id as never);
  }

  /** Per-region weights at map uv (one texture fetch per 4 regions). */
  regionWeights(uv: N): N[] {
    const layers = Math.ceil(this.count / 4);
    const w: N[] = [];
    for (let L = 0; L < layers; L++) {
      const s = texture(this.world.look, uv).depth(int(L));
      for (let c = 0; c < 4 && L * 4 + c < this.count; c++) w.push(s.element(int(c)) as N);
    }
    return w;
  }

  /** Weighted ground palette {grass, dry, soil} at the given weights. */
  palette(weights: N[]): { grass: N; dry: N; soil: N } {
    let grass: N = vec3(0);
    let dry: N = vec3(0);
    let soil: N = vec3(0);
    weights.forEach((w, i) => {
      grass = grass.add(this.grass.element(int(i)).mul(w));
      dry = dry.add(this.dry.element(int(i)).mul(w));
      soil = soil.add(this.soil.element(int(i)).mul(w));
    });
    return { grass, dry, soil };
  }

  weightOf(weights: N[], id: string): N {
    const i = this.index(id);
    return i >= 0 ? weights[i] : float(0);
  }
}
