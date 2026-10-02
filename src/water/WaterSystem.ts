import { Mesh, PlaneGeometry, type DataTexture } from 'three/webgpu';
import type { FrameContext, InitContext, System } from '../core/types.ts';
import type { World } from '../world/World.ts';
import type { PoolRecord, ReflectorRecord } from '../landmarks/records.ts';
import { createNoiseTexture, createWaveSlopeTexture } from './waveTexture.ts';
import { createWaterMaterial, waterDebug } from './waterMaterial.ts';
import { buildLakeGeometry, lakeInfos, poolInfos, type LakeInfo } from './lakes.ts';
import { buildRiverGeometry, type RiverStats } from './rivers.ts';
import { LAKE, RIVER, SEA } from './presets.ts';

/**
 * Water v1 — sea, lakes and rivers from one material family (waterMaterial.ts), three draws:
 *  - sea: one plane at sea level (0) over the whole frame; the terrain hides it on land;
 *  - lakes: earcut-triangulated polygons from world.lakes at their manifest levels;
 *  - rivers: one merged ribbon mesh following the carved channels (rivers.ts) — on bake v2 exactly the
 *    baked centrelines at their baked, monotone levels (the bake carved the channel and built the banks;
 *    the HeightField guard keeps landmark stamps off them), on v1 bakes a runtime level estimate.
 * Everything animated reads env.tFx / env.wind in the shader, so evaluate() is stateless.
 */
export class WaterSystem implements System {
  readonly id = 'water';
  sea!: Mesh;
  lakes!: Mesh;
  rivers!: Mesh;
  waveTex!: DataTexture;
  noiseTex!: DataTexture;
  lakeList: LakeInfo[] = [];
  riverStats!: RiverStats;
  /** debug view selector (0 = beauty), see waterMaterial.ts */
  readonly debug = waterDebug;
  private includeStreams = true;
  private heightsVersion = -1;

  private pools: PoolRecord[] = [];
  private reflectors: ReflectorRecord[] = [];

  constructor(private readonly world: World) {}

  /**
   * Landmark still-water pools (world space, from landmarkPools): the Sirannon pool at Moria, the
   * Water at Hobbiton, Henneth Annûn's basin. Call before init. They are triangulated into the lake
   * mesh (earcut at `level`, LAKE preset) — no extra draw; the rivers never see them (they are not
   * lakes of the hydrology).
   */
  setPools(pools: PoolRecord[]): void {
    this.pools = pools.map((p) => ({ ...p, ring: p.ring.map((q) => [q[0], q[1]] as [number, number]) }));
  }

  /**
   * Upright reflection proxies (world space, from landmarkReflectors): statues and rock spires standing in
   * the water, which the reflection march's HeightField cannot see. Call before init (baked into the lake and
   * river shaders as constants).
   */
  setReflectors(reflectors: ReflectorRecord[]): void {
    this.reflectors = reflectors.map((r) => ({ ...r }));
  }

  getPools(): readonly PoolRecord[] {
    return this.pools;
  }

  init(ctx: InitContext): void {
    const { world } = this;
    const spec = world.spec;
    const quality = ctx.quality;
    this.waveTex = createWaveSlopeTexture();
    this.noiseTex = createNoiseTexture();
    const mat = (params: typeof SEA) => createWaterMaterial({ world, waveTex: this.waveTex, noiseTex: this.noiseTex, quality, params, reflectors: this.reflectors });

    const seaGeo = new PlaneGeometry(spec.width, spec.depth, 32, 20);
    seaGeo.rotateX(-Math.PI / 2);
    seaGeo.translate((spec.xMin + spec.xMax) / 2, 0, (spec.zMin + spec.zMax) / 2);
    this.sea = new Mesh(seaGeo, mat(SEA));
    this.sea.name = 'water-sea';
    this.sea.renderOrder = 1;

    this.lakeList = lakeInfos(world);
    this.lakes = new Mesh(buildLakeGeometry([...this.lakeList, ...poolInfos(this.pools)]), mat(LAKE));
    this.lakes.name = 'water-lakes';
    this.lakes.renderOrder = 2;

    this.includeStreams = quality.density >= 0.5;
    this.rivers = new Mesh(this.buildRivers(), mat(RIVER));
    this.rivers.name = 'water-rivers';
    this.rivers.renderOrder = 3;

    for (const m of [this.sea, this.lakes, this.rivers]) {
      m.castShadow = false;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      ctx.scene.add(m);
    }
  }

  private buildRivers() {
    const r = buildRiverGeometry(this.world, this.lakeList, { includeStreams: this.includeStreams, widthScale: this.world.spec.json.rivers.ribbonScale, marginKm: this.world.spec.json.rivers.ribbonMarginKm });
    this.riverStats = r.stats;
    this.heightsVersion = this.world.heights.texture.version;
    return r.geometry;
  }

  /**
   * Nothing animates on the CPU (waves/flow/foam read env.tFx in the shaders). The only work is a
   * one-off rebuild of the river ribbons when the HeightField stamp layer changed after init
   * (landmark stamps): the ribbons are a pure function of the baked river data and the composite
   * heights, so this stays deterministic and order-independent.
   */
  evaluate(_frame: FrameContext): void {
    if (this.world.heights.texture.version !== this.heightsVersion) {
      const old = this.rivers.geometry;
      this.rivers.geometry = this.buildRivers();
      old.dispose();
    }
  }

  dispose(): void {
    for (const m of [this.sea, this.lakes, this.rivers]) {
      m?.removeFromParent();
      m?.geometry.dispose();
      (m?.material as { dispose?: () => void } | undefined)?.dispose?.();
    }
    this.waveTex?.dispose();
    this.noiseTex?.dispose();
  }
}
