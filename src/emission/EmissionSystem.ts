import { DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, Uint16BufferAttribute, Float32BufferAttribute, type NodeMaterial } from 'three/webgpu';
import type { FrameContext, InitContext, SceneState, System } from '../core/types.ts';
import type { LightRecord } from '../landmarks/records.ts';
import type { World } from '../world/World.ts';
import { createEmissionMaterial } from './emissionMaterial.ts';
import { aggregates, EMISSION_STRIDE, groupKey, packAggregate, packLight, ROLE, type EmissionArrays } from './lightKinds.ts';

/** instance capacity of the one sprite draw (static landmark lights + S4 dynamic ones) */
export const MAX_LIGHTS = 4096;

/**
 * Landmark lights (windows, lamps, fires, lava, the Eye, Morgul magic, ithildin) as ONE instanced,
 * additive, energy-normalised sprite draw in the main HDR target — readable as warm windows at dusk
 * and as stable sub-pixel sparkles in wide shots. Gates are pure functions of the env uniforms
 * (night / twilight / golden); flicker reads env.tFx. No per-light three.js lights.
 *
 * Records are static (built once by buildLandmarks) and packed at init (lightKinds.ts: colour
 * defaults, size caps, flicker rates, halo by kind); evaluate() does no per-frame CPU work
 * unless S4 dynamic lights are registered (a pure function of the state, re-packed per frame).
 *
 * Settlement aggregation: the windows / lamps / fires of one landmark (per gate) also get ONE aggregate
 * sprite at their energy-weighted centroid carrying their summed energy. The shader crossfades members →
 * aggregate as the group's projected diameter falls below ~12 → 6 px (a pure function of the camera), and
 * the aggregate has a visibility floor, so every lit settlement stays a small, stable spark in overviews
 * instead of a smudge of sub-threshold dots.
 */
export class EmissionSystem implements System {
  readonly id = 'emission';
  readonly stats = { count: 0, drawn: 0, dynamic: 0, aggregates: 0 };
  private dynamic: ((s: SceneState) => LightRecord[]) | null = null;
  private mesh: Mesh | null = null;
  private material: NodeMaterial | null = null;
  private attrs: { pos: InstancedBufferAttribute; col: InstancedBufferAttribute; aux: InstancedBufferAttribute; grp: InstancedBufferAttribute } | null = null;
  private geometry: InstancedBufferGeometry | null = null;
  private staticCount = 0;

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

  init(ctx: InitContext): void {
    void this.world;
    const g = new InstancedBufferGeometry();
    // unit quad (corners ±1); the vertex stage sizes it in pixels
    g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex(new Uint16BufferAttribute([0, 1, 2, 0, 2, 3], 1));
    const mk = () => {
      const a = new InstancedBufferAttribute(new Float32Array(MAX_LIGHTS * EMISSION_STRIDE), EMISSION_STRIDE);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    const attrs = { pos: mk(), col: mk(), aux: mk(), grp: mk() };
    g.setAttribute('emPos', attrs.pos);
    g.setAttribute('emCol', attrs.col);
    g.setAttribute('emAux', attrs.aux);
    g.setAttribute('emGrp', attrs.grp);
    this.attrs = attrs;
    this.geometry = g;
    this.staticCount = this.packStatic(this.records);
    g.instanceCount = this.staticCount;
    this.stats.drawn = this.staticCount;

    this.material = createEmissionMaterial();
    const mesh = new Mesh(g, this.material);
    mesh.name = 'emission';
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // after the opaque world and the water (transparent list, sorted by renderOrder first)
    mesh.renderOrder = 50;
    mesh.matrixAutoUpdate = false;
    mesh.visible = this.staticCount > 0;
    ctx.scene.add(mesh);
    this.mesh = mesh;
  }

  private arrays(): EmissionArrays {
    const a = this.attrs!;
    return { pos: a.pos.array as Float32Array, col: a.col.array as Float32Array, aux: a.aux.array as Float32Array, grp: a.grp.array as Float32Array };
  }

  /**
   * Static landmark lights: every record, grouped per (landmark, gate, wide class) for the aggregate
   * sprites (a group of one is its own aggregate: always drawn, with the visibility floor). Record order
   * is kept; aggregates follow the records. Returns the instance count.
   */
  private packStatic(records: LightRecord[]): number {
    const arr = this.arrays();
    const groups = new Map<string, number[]>();
    const keys: string[] = [];
    let n = 0;
    for (const r of records) {
      if (n >= MAX_LIGHTS) break;
      const o = n * EMISSION_STRIDE;
      if (!packLight(r, arr, o)) continue;
      n++;
      if (!aggregates(r)) continue;
      const key = groupKey(r);
      let g = groups.get(key);
      if (!g) {
        g = [];
        groups.set(key, g);
        keys.push(key);
      }
      g.push(o);
    }
    for (const key of keys) {
      const g = groups.get(key)!;
      if (g.length === 1) {
        arr.grp[g[0]] = 0;
        arr.grp[g[0] + 1] = ROLE.aggregate;
        continue;
      }
      if (n >= MAX_LIGHTS) break;
      for (const o of g) arr.grp[o + 1] = ROLE.member;
      packAggregate(arr, g, n * EMISSION_STRIDE);
      n++;
    }
    this.stats.aggregates = keys.length;
    this.flag(0, n);
    return n;
  }

  private flag(start: number, n: number): void {
    const a = this.attrs!;
    for (const attr of [a.pos, a.col, a.aux, a.grp]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(start * EMISSION_STRIDE, Math.max(1, (n - start) * EMISSION_STRIDE));
      attr.needsUpdate = true;
    }
  }

  /** Pack (dynamic, standalone) records from instance `start` on; returns the next free instance index. */
  private pack(records: LightRecord[], start: number): number {
    const arr = this.arrays();
    let n = start;
    for (const r of records) {
      if (n >= MAX_LIGHTS) break;
      if (packLight(r, arr, n * EMISSION_STRIDE)) n++;
    }
    this.flag(start, n);
    return n;
  }

  evaluate(frame: FrameContext): void {
    if (!this.mesh || !this.geometry) return;
    let n = this.staticCount;
    if (this.dynamic) {
      n = this.pack(this.dynamic(frame.state), this.staticCount);
      this.stats.dynamic = n - this.staticCount;
    }
    this.geometry.instanceCount = n;
    this.stats.drawn = n;
    this.mesh.visible = n > 0;
  }

  dispose(): void {
    this.mesh?.removeFromParent();
    this.geometry?.dispose();
    this.material?.dispose();
  }
}
