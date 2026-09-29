import { Mesh, type MeshStandardNodeMaterial } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import type { FrameContext, InitContext, System } from '../core/types.ts';
import type { World } from '../world/World.ts';
import { SLAB } from './slabSpec.ts';
import { createEdgeStrip, plinthProfile, sweepProfile } from './slabGeometry.ts';
import { createPlinthMaterial, createStrataMaterial, createWaterColumnMaterial, type SlabMaterialInputs } from './slabMaterials.ts';

const { vec2 } = tsl;

/**
 * The floating diorama slab: the map is a rectangular block cut out of the world.
 *  - strata faces: the four cut sides, following the terrain's exact edge profile down to the base,
 *    shaded as a geological cross-section (soil, folded sedimentary beds, darker with depth)
 *  - water column: where the cut crosses the sea, a translucent glassy cross-section of the water
 *    from the seabed up to sea level (the water system draws the surface itself)
 *  - plinth: a restrained dark-stone moulding (ledge, rounded bevel, face, recessed foot)
 * The atmospheric void around it is part of the environment's sky dome.
 * Static geometry; the only animation (light shafts in the water) runs on env.tFx. The strata
 * material is tier-aware (a cheaper preview variant), selected from `frame.quality`.
 */
export class DioramaSystem implements System {
  readonly id = 'diorama';
  strata!: Mesh;
  waterColumn!: Mesh;
  plinth!: Mesh;
  private inp!: SlabMaterialInputs;
  private strataMaterials = new Map<boolean, MeshStandardNodeMaterial>();

  constructor(private readonly world: World) {}

  private strataFor(tier: string): MeshStandardNodeMaterial {
    const preview = tier === 'preview';
    let m = this.strataMaterials.get(preview);
    if (!m) {
      m = createStrataMaterial(this.inp, { preview });
      this.strataMaterials.set(preview, m);
    }
    return m;
  }

  init(ctx: InitContext): void {
    const spec = this.world.spec;
    const hf = this.world.heights;
    const inp: SlabMaterialInputs = (this.inp = {
      heights: hf.texture,
      toUv: (xz: TslNode) => vec2(xz.x.sub(spec.xMin).div(spec.width), xz.y.sub(spec.zMin).div(spec.depth)),
    });
    if (Math.abs(spec.xMin - SLAB.xMin) > 1e-6 || Math.abs(spec.zMax - SLAB.zMax) > 1e-6) {
      throw new Error('DioramaSystem: slab frame does not match the world frame');
    }
    const strip = createEdgeStrip(hf.texel, hf.width, hf.height);

    this.strata = new Mesh(strip, this.strataFor(ctx.quality.id));
    this.strata.name = 'diorama-strata';
    this.strata.frustumCulled = false;
    this.strata.castShadow = true;
    this.strata.receiveShadow = true;

    this.waterColumn = new Mesh(strip, createWaterColumnMaterial(inp));
    this.waterColumn.name = 'diorama-water-column';
    this.waterColumn.frustumCulled = false;
    this.waterColumn.receiveShadow = true;
    this.waterColumn.renderOrder = 2;

    this.plinth = new Mesh(sweepProfile(plinthProfile()), createPlinthMaterial());
    this.plinth.name = 'diorama-plinth';
    this.plinth.receiveShadow = true;
    this.plinth.castShadow = false;

    ctx.scene.add(this.strata, this.waterColumn, this.plinth);
  }

  evaluate(frame: FrameContext): void {
    const m = this.strataFor(frame.quality.id);
    if (this.strata.material !== m) this.strata.material = m;
  }
}
