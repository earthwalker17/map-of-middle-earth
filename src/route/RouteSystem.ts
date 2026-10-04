import { BufferGeometry, Float32BufferAttribute, Mesh, Uint16BufferAttribute, Uint32BufferAttribute, type NodeMaterial } from 'three/webgpu';
import type { FrameContext, InitContext, SceneState, System } from '../core/types.ts';
import type { LightRecord, V3 } from '../landmarks/records.ts';
import type { World } from '../world/World.ts';
import type { CompiledRoute } from '../tour/schema.ts';
import { routeAt } from '../tour/route.ts';
import { createRouteCoreMaterial, createRouteUnderMaterial, createRouteUniforms, DASH_PX, PULL_PX, PULL_REL, QUAD_K, ROUTE_GOLD } from './routeMaterial.ts';

/** render orders: after the water (1–3), before the ash deck (30), mist (34), falls (35), sprites (50) */
const ORDER_UNDER = 20;
const ORDER_CORE = 21;
/** the drawn range reaches this far (1080p px at the head depth) beyond the head: the round cap and comet glow */
const CAP_REACH_PX = 60;
/**
 * Head light (the comet's heart): a gold 'magic' sprite of HEAD_PX (1080p px) radius at the head; its energy
 * is kept when the light's physical radius hits the kind's cap far out (intensity × (r / cap)², ≤ the cap).
 */
const HEAD_PX = 2.2;
const HEAD_INTENSITY = 0.3;
const HEAD_RADIUS_CAP = 0.8;
const HEAD_INTENSITY_CAP = 12;
const HEAD_COLOR: V3 = [ROUTE_GOLD[0], ROUTE_GOLD[1] * 1.1, ROUTE_GOLD[2] * 1.3];
/** the head light's seed (rand: flicker phase) */
const HEAD_SEED = 0x5f0a7e;

const _p: [number, number, number] = [0, 0, 0];

/** Camera basics of a state (pure): position, unit forward, px-per-km factor 1 / (2·tan(fov/2)). */
function viewOf(state: SceneState): { pos: V3; fwd: V3; k: number } {
  const [px, py, pz] = state.camera.position;
  const [tx, ty, tz] = state.camera.target;
  const l = Math.hypot(tx - px, ty - py, tz - pz) || 1;
  return { pos: [px, py, pz], fwd: [(tx - px) / l, (ty - py) / l, (tz - pz) / l], k: 1 / (2 * Math.tan((state.camera.fov * Math.PI) / 360)) };
}

/** Overall strength of the line in a state (absent routeGlow = 1 once the route has started). */
export function routeGlowOf(state: SceneState): number {
  return Math.min(1, Math.max(0, state.routeGlow ?? (state.routeProgress > 0 ? 1 : 0)));
}

/**
 * RouteSystem (S5 film only, `?film=1`): the journey's luminous route line over the miniature, drawn up to
 * the head (SceneState.routeProgress × length) with a comet and a gold head light. One static ribbon
 * (routeMaterial.ts) built once from the CompiledRoute; evaluate() writes four uniforms and the draw range —
 * a pure function of the state (no geometry rebuilds, nothing carried between frames).
 */
export class RouteSystem implements System {
  readonly id = 'route';
  readonly stats = { samples: 0, vertices: 0, drawnSegments: 0, headKm: 0, glow: 0 };
  private readonly u = createRouteUniforms();
  private geometry: BufferGeometry | null = null;
  private materials: NodeMaterial[] = [];
  private meshes: Mesh[] = [];
  private readonly spacing: number;
  private readonly head: LightRecord = { landmark: 'route', p: [0, 0, 0], color: HEAD_COLOR, intensity: HEAD_INTENSITY, radiusKm: 0.05, kind: 'magic', gate: 'always', flicker: 0.04, seed: HEAD_SEED };

  constructor(
    private readonly world: World,
    readonly route: CompiledRoute,
  ) {
    this.spacing = route.count > 1 ? route.length / (route.count - 1) : 1;
    this.stats.samples = route.count;
  }

  init(ctx: InitContext): void {
    void this.world;
    const r = this.route;
    const n = r.count;
    // vertex pairs: the start's extension (slid out by the shader), the n samples, the end's extension
    const pairs = n + 2;
    const pos = new Float32Array(pairs * 2 * 3);
    const tan = new Float32Array(pairs * 2 * 4);
    const sm = new Float32Array(pairs * 2 * 2);
    for (let q = 0; q < pairs; q++) {
      const k = Math.min(n - 1, Math.max(0, q - 1));
      const ext = q === 0 ? 4 : q === pairs - 1 ? 8 : 0;
      // 3D tangent from the neighbours (the drape's slope matters for the screen direction on steep ground)
      const a = Math.max(0, k - 1) * 4;
      const b = Math.min(n - 1, k + 1) * 4;
      let tx = r.pts[b] - r.pts[a];
      let ty = r.pts[b + 1] - r.pts[a + 1];
      let tz = r.pts[b + 2] - r.pts[a + 2];
      const l = Math.hypot(tx, ty, tz) || 1;
      tx /= l;
      ty /= l;
      tz /= l;
      for (let side = 0; side < 2; side++) {
        const v = q * 2 + side;
        pos[v * 3] = r.pts[k * 4];
        pos[v * 3 + 1] = r.pts[k * 4 + 1];
        pos[v * 3 + 2] = r.pts[k * 4 + 2];
        tan[v * 4] = tx;
        tan[v * 4 + 1] = ty;
        tan[v * 4 + 2] = tz;
        tan[v * 4 + 3] = side === 0 ? -1 : 1;
        sm[v * 2] = r.pts[k * 4 + 3];
        sm[v * 2 + 1] = r.mode[k] + ext;
      }
    }
    const segs = pairs - 1;
    const idx = pairs * 2 > 65535 ? new Uint32Array(segs * 6) : new Uint16Array(segs * 6);
    for (let k = 0; k < segs; k++) {
      const v = k * 2;
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], k * 6);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('routeT', new Float32BufferAttribute(tan, 4));
    g.setAttribute('routeS', new Float32BufferAttribute(sm, 2));
    g.setIndex(idx instanceof Uint32Array ? new Uint32BufferAttribute(idx, 1) : new Uint16BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.stats.vertices = pairs * 2;
    const under = createRouteUnderMaterial(this.u);
    const core = createRouteCoreMaterial(this.u);
    this.materials = [under, core];
    for (const [m, order, name] of [
      [under, ORDER_UNDER, 'route-under'],
      [core, ORDER_CORE, 'route-core'],
    ] as const) {
      const mesh = new Mesh(g, m);
      mesh.name = name;
      mesh.renderOrder = order;
      // always in the scene (the warm-up's compileAsync builds both pipelines); off = an empty draw range
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false;
      ctx.scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  evaluate(frame: FrameContext): void {
    const g = this.geometry;
    if (!g) return;
    const { state, viewport } = frame;
    const glow = routeGlowOf(state);
    const head = Math.min(1, Math.max(0, state.routeProgress)) * this.route.length;
    this.u.head.value = head;
    this.u.glow.value = glow;
    this.stats.headKm = head;
    this.stats.glow = glow;
    if (glow <= 0) {
      g.setDrawRange(0, 0);
      this.stats.drawnSegments = 0;
      return;
    }
    // km per render px at the head's view depth (dot period, drawn reach)
    const { pos, fwd, k } = viewOf(state);
    routeAt(this.route, head, _p);
    const zHead = Math.max(0.01, (_p[0] - pos[0]) * fwd[0] + (_p[1] - pos[1]) * fwd[1] + (_p[2] - pos[2]) * fwd[2]);
    const pxPerKm = viewport.height * k;
    const kmPerPx = zHead / pxPerKm;
    const scale = viewport.height / 1080;
    // underground dots: DASH_PX (1080p) at the head depth, in world octaves crossfaded (dots never crawl)
    const L = Math.log2(Math.max(1e-6, DASH_PX * scale * kmPerPx));
    const k0 = Math.floor(L);
    this.u.dashKm.value = 2 ** k0;
    this.u.dashMix.value = L - k0;
    // draw the start's extension and the samples up to the head + the cap's reach (+ the end's extension once
    // the head is there); the rest of the route is not drawn at all
    const reachKm = CAP_REACH_PX * scale * kmPerPx * QUAD_K;
    const kEnd = Math.min(this.route.count - 1, Math.ceil((head + reachKm) / this.spacing) + 1);
    const segs = Math.min(this.route.count + 1, kEnd + 2);
    g.setDrawRange(0, segs * 6);
    this.stats.drawnSegments = segs;
  }

  /**
   * The head light for the EmissionSystem's dynamic list (boot.ts composes it with the effects' lights):
   * one gold 'magic' sprite (gate 'always') at the head, a fixed HEAD_PX at 1080p at any distance, pulled
   * toward the camera like the line. Empty while the line is off. Pure function of the state (the one
   * record is rewritten in full on every call).
   */
  lights(state: SceneState): LightRecord[] {
    const glow = routeGlowOf(state);
    if (glow <= 0) return [];
    const head = Math.min(1, Math.max(0, state.routeProgress)) * this.route.length;
    routeAt(this.route, head, _p);
    const { pos, fwd, k } = viewOf(state);
    const dx = _p[0] - pos[0];
    const dy = _p[1] - pos[1];
    const dz = _p[2] - pos[2];
    const dist = Math.hypot(dx, dy, dz) || 1;
    const z = Math.max(0.01, dx * fwd[0] + dy * fwd[1] + dz * fwd[2]);
    // km per 1080p px at the head depth
    const kmPerPx = z / (1080 * k);
    const pull = Math.min(0.9, (PULL_PX * kmPerPx + PULL_REL * dist) / dist);
    const rWant = HEAD_PX * kmPerPx;
    const r = Math.min(rWant, HEAD_RADIUS_CAP);
    const rec = this.head;
    rec.p = [_p[0] - dx * pull, _p[1] - dy * pull, _p[2] - dz * pull];
    rec.radiusKm = r;
    rec.intensity = Math.min(HEAD_INTENSITY_CAP, HEAD_INTENSITY * (rWant / r) ** 2) * glow;
    return [rec];
  }

  dispose(): void {
    for (const m of this.meshes) m.removeFromParent();
    this.geometry?.dispose();
    for (const m of this.materials) m.dispose();
  }
}
