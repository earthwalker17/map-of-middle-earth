import { Mesh, MeshStandardNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { Fn, float, mix, positionWorld, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import type { FrameContext, InitContext, System } from '../core/types.ts';
import type { World } from '../world/World.ts';

/**
 * Water v0 (placeholder, to be replaced by the water module in S1-E): one sea plane at sea level,
 * depth-tinted from the HeightField so shelves read through the surface.
 */
export class WaterSystem implements System {
  readonly id = 'water';
  sea!: Mesh;

  constructor(private readonly world: World) {}

  init(ctx: InitContext): void {
    const spec = this.world.spec;
    const geo = new PlaneGeometry(spec.width, spec.depth, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshStandardNodeMaterial({ transparent: true, roughness: 0.08, metalness: 0 });
    const hTex = this.world.heights.texture;
    const depth = Fn(() => {
      const uv = vec2(positionWorld.x.sub(spec.xMin).div(spec.width), positionWorld.z.sub(spec.zMin).div(spec.depth));
      return float(0).sub(texture(hTex, uv).r);
    })();
    mat.colorNode = mix(vec3(0.16, 0.42, 0.44), vec3(0.015, 0.06, 0.12), smoothstep(0.2, 5.5, depth));
    mat.opacityNode = mix(float(0.35), float(0.94), smoothstep(0.0, 2.0, depth));
    this.sea = new Mesh(geo, mat);
    this.sea.name = 'sea';
    this.sea.receiveShadow = true;
    this.sea.renderOrder = 1;
    ctx.scene.add(this.sea);
  }

  evaluate(_frame: FrameContext): void {}
}
