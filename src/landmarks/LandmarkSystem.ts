import { Group, Mesh } from 'three/webgpu';
import type { FrameContext, InitContext, System } from '../core/types.ts';
import { materialFor, structureTier } from '../materials/families.ts';
import type { World } from '../world/World.ts';
import type { BuiltLandmark } from './records.ts';

/**
 * S5 film LOD dissolve: width (octaves of projected size) of the band BELOW each landmark LOD threshold that
 * the sub-samples spread it over (SceneState.lodDither): a sub-sample with phase d uses the threshold
 * × 2^(−LOD_DITHER_OCT·d), so with 4 sub-samples the finer LOD fades in four steps of 25 % across thresholds
 * × 0.55 … 0.92 (≈ 10 frames of a 5 %/frame zoom) instead of popping in one frame. One-sided: at or above a
 * threshold every sub-sample draws the finer LOD (the LOD design's guarantee, as every still); below it a
 * share of the sub-samples still draws the finer one — never a coarser LOD than the stills would.
 */
export const LOD_DITHER_OCT = 1;

/**
 * Realizes built landmarks (build.ts) as meshes with the shared family materials (two uber materials:
 * 'structure' casts and receives shadows, 'glow' neither). Each landmark has ONE fixed design scale
 * (S3 readability policy: silhouette / emission / contrast, never size boosts).
 *
 * LOD: per landmark, the projected bounding radius in px at the viewport height —
 * `rad · (H / (2·tan(fov/2))) / max(1, |camera − bounds.center|)` with rad = hypot(bounds.r, bounds.h/2)
 * (the bounding sphere, so tall towers are not undersized) — picks LOD0 if ≥ lodPx[0], LOD1 if ≥ lodPx[1],
 * else the coarsest. Exactly one LOD is visible; a pure function of the camera (no hysteresis), so it is
 * safe per accumulation sub-sample.
 */
export class LandmarkSystem implements System {
  readonly id = 'landmarks';
  readonly root = new Group();
  readonly groups = new Map<string, Group>();
  /** diagnostics: selected LOD per landmark and the visible triangle count */
  readonly stats: { lod: Record<string, number>; tris: number } = { lod: {}, tris: 0 };
  private readonly lodGroups = new Map<string, Group[]>();
  private readonly lodTris = new Map<string, number[]>();

  constructor(
    private readonly world: World,
    readonly built: BuiltLandmark[],
  ) {}

  init(ctx: InitContext): void {
    this.root.name = 'landmarks';
    // before the first materialFor(): the singleton structure material is built for this tier
    structureTier.full = ctx.quality.id !== 'preview';
    for (const b of this.built) {
      const g = new Group();
      g.name = `landmark:${b.id}`;
      const levels: Group[] = [];
      const tris: number[] = [];
      b.lods.forEach((lod, L) => {
        const lg = new Group();
        lg.name = `${b.id}:lod${L}`;
        let t = 0;
        for (const [key, geo] of lod) {
          const mesh = new Mesh(geo, materialFor(key));
          const glow = key === 'glow';
          mesh.castShadow = !glow;
          mesh.receiveShadow = !glow;
          mesh.name = `${b.id}:${key}:lod${L}`;
          lg.add(mesh);
          t += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
        }
        lg.visible = L === 0;
        g.add(lg);
        levels.push(lg);
        tris.push(t);
      });
      g.scale.setScalar(b.scale);
      g.rotation.y = (-b.headingDeg * Math.PI) / 180;
      g.position.set(...b.origin);
      g.updateMatrixWorld(true);
      this.root.add(g);
      this.groups.set(b.id, g);
      this.lodGroups.set(b.id, levels);
      this.lodTris.set(b.id, tris);
    }
    void this.world;
    ctx.scene.add(this.root);
  }

  /**
   * LOD index for a landmark seen from `cam` (pure: camera position, vertical fov, viewport height). S5 film:
   * `bias` (SceneState.lodBias, < 1 keeps the finer LODs longer) and `dither` (SceneState.lodDither, the
   * sub-sample's phase: the thresholds × 2^(−LOD_DITHER_OCT·dither), so across a frame's sub-samples the
   * switch is a stratified dissolve over the band of LOD_DITHER_OCT octaves below each threshold). Stills pass
   * neither (exact).
   */
  static selectLod(b: BuiltLandmark, cam: { x: number; y: number; z: number }, fovDeg: number, viewportH: number, levels: number, bias = 1, dither?: number): number {
    if (levels <= 1) return 0;
    const [cx, cy, cz] = b.bounds.center;
    const d = Math.max(1, Math.hypot(cam.x - cx, cam.y - cy, cam.z - cz));
    const rad = Math.hypot(b.bounds.r, b.bounds.h / 2);
    const px = (rad * (viewportH / (2 * Math.tan((fovDeg * Math.PI) / 360)))) / d;
    const k = dither === undefined ? bias : bias * 2 ** (-LOD_DITHER_OCT * dither);
    const L = px >= b.lodPx[0] * k ? 0 : px >= b.lodPx[1] * k ? 1 : 2;
    return Math.min(L, levels - 1);
  }

  evaluate(frame: FrameContext): void {
    const cam = frame.camera;
    let tris = 0;
    for (const b of this.built) {
      const levels = this.lodGroups.get(b.id);
      if (!levels?.length) continue;
      const L = LandmarkSystem.selectLod(b, cam.position, cam.fov, frame.viewport.height, levels.length, frame.state.lodBias ?? 1, frame.state.lodDither);
      for (let k = 0; k < levels.length; k++) levels[k].visible = k === L;
      this.stats.lod[b.id] = L;
      tris += this.lodTris.get(b.id)![L];
    }
    this.stats.tris = tris;
  }
}
