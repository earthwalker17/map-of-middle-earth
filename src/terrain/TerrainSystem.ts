import { DynamicDrawUsage, InstancedBufferAttribute, Mesh } from 'three/webgpu';
import type { FrameContext, InitContext, System } from '../core/types.ts';
import type { World } from '../world/World.ts';
import { Cdlod } from './cdlod.ts';
import { groundMaps } from './groundMaps.ts';
import { createPatchGeometry } from './patchGeometry.ts';
import { createTerrainMaterial } from './terrainMaterial.ts';
import { loadTerrainDetail } from './terrainTextures.ts';
import { releaseLookField } from '../materials/looks.ts';

const MAX_PATCHES = 4096;

/** Renders the whole map heightfield as one instanced CDLOD draw. */
export class TerrainSystem implements System {
  readonly id = 'terrain';
  mesh!: Mesh;
  cdlod!: Cdlod;
  private patchData = new Float32Array(MAX_PATCHES * 4);
  private patchAttr = new InstancedBufferAttribute(this.patchData, 4);
  patchCount = 0;

  constructor(private readonly world: World) {}

  async init(ctx: InitContext): Promise<void> {
    const q = ctx.quality.terrain;
    this.cdlod = new Cdlod(this.world.spec, this.world.heights, { rootSize: 320, levels: 8, rangeK: q.lodRangeK });
    this.patchAttr.setUsage(DynamicDrawUsage);
    const geometry = createPatchGeometry(q.patchGrid);
    geometry.setAttribute('patch', this.patchAttr);
    // the ground masks read the composited stamp layer (boot composites stamps before any system)
    const maps = groundMaps(this.world);
    const detail = await loadTerrainDetail(ctx.quality);
    const material = createTerrainMaterial(this.world, this.cdlod, this.patchAttr, q.patchGrid, { quality: ctx.quality, maps, detail });
    // the region-weight field's consumers are built (regional haze, field mask, ground look)
    releaseLookField(this.world);
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'terrain';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    ctx.scene.add(this.mesh);
  }

  evaluate(frame: FrameContext): void {
    this.patchCount = this.cdlod.select(frame.camera.position, this.patchData);
    this.patchAttr.needsUpdate = true;
    (this.mesh.geometry as unknown as { instanceCount: number }).instanceCount = this.patchCount;
  }
}
