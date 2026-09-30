import { Group, Mesh } from 'three/webgpu';
import type { FrameContext, InitContext, System } from '../core/types.ts';
import { materialFor } from '../materials/families.ts';
import type { World } from '../world/World.ts';
import type { BuiltLandmark } from './records.ts';

/**
 * Realizes built landmarks (build.ts) as meshes with shared family materials. Each landmark has ONE
 * fixed design scale (S3 readability policy: silhouette / emission / contrast, never size boosts).
 * LOD selection is a pure function of the camera (projected bounding radius in px, no hysteresis).
 */
export class LandmarkSystem implements System {
  readonly id = 'landmarks';
  readonly root = new Group();
  readonly groups = new Map<string, Group>();

  constructor(
    private readonly world: World,
    readonly built: BuiltLandmark[],
  ) {}

  init(ctx: InitContext): void {
    this.root.name = 'landmarks';
    for (const b of this.built) {
      const g = new Group();
      g.name = `landmark:${b.id}`;
      const lod0 = b.lods[0];
      if (lod0)
        for (const [key, geo] of lod0) {
          const mesh = new Mesh(geo, materialFor(key));
          mesh.castShadow = !key.startsWith('emissive') && key !== 'lava';
          mesh.receiveShadow = true;
          mesh.name = `${b.id}:${key}`;
          g.add(mesh);
        }
      g.scale.setScalar(b.scale);
      g.rotation.y = (-b.headingDeg * Math.PI) / 180;
      g.position.set(...b.origin);
      g.updateMatrixWorld(true);
      this.root.add(g);
      this.groups.set(b.id, g);
    }
    void this.world;
    ctx.scene.add(this.root);
  }

  evaluate(_frame: FrameContext): void {
    // fixed design scale; projected-px LOD selection arrives with kit v2 (W1)
  }
}
