import { BufferGeometry, Float32BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute, Mesh, Uint16BufferAttribute, Uint32BufferAttribute, type NodeMaterial } from 'three/webgpu';
import type { FrameContext, InitContext, SceneState, System } from '../core/types.ts';
import type { LightRecord, V3 } from '../landmarks/records.ts';
import type { World } from '../world/World.ts';
import type { CompiledRoute } from '../tour/schema.ts';
import { pathAt, ribbonPath, type RibbonPath } from './path.ts';
import { cameraBasis, projectWith } from '../titles/layout.ts';
import { CANOPY_SIN_MIN, CANOPY_STEPS, CANOPY_TOL_KM, createRouteCoreMaterial, createRouteUnderMaterial, createRouteUniforms, createRouteXrayMaterial, DASH_PX, HALF_KM, HALF_MAX, HALF_MIN, MORPH, PULL_CORE, PULL_PX, PULL_REL, QUAD_K, ROUTE_GOLD, type RouteGround } from './routeMaterial.ts';

/** render orders: after the water (1–3), before the ash deck (30), mist (34), falls (35), sprites (50) */
const ORDER_UNDER = 20;
const ORDER_CORE = 21;
const ORDER_XRAY = 22;
/** the drawn range reaches this far (1080p px at the head depth) beyond the head: the round cap and comet glow */
const CAP_REACH_PX = 60;
/** neighbour stencil (samples) of the near / far path: the chord tangent and the screen curvature */
const STENCIL_NEAR = 2;
const STENCIL_FAR = 4;
/** indices per segment (two quads across) */
const IDX = 12;
/**
 * Head light (the comet's heart): a gold 'magic' sprite of HEAD_PX (1080p px) radius at the head; its energy
 * is kept when the light's physical radius hits the kind's cap far out (intensity × (r / cap)², ≤ the cap).
 */
const HEAD_PX = 1.6;
const HEAD_INTENSITY = 0.2;
const HEAD_RADIUS_CAP = 0.8;
const HEAD_INTENSITY_CAP = 8;
const HEAD_COLOR: V3 = [ROUTE_GOLD[0], ROUTE_GOLD[1] * 1.15, 0.12];
/** the head light's seed (rand: flicker phase) */
const HEAD_SEED = 0x5f0a7e;
/**
 * canopy over the line (the shader's canopy pull): crowns reaching within CANOPY_REACH_KM of a sample count
 * (the ribbon's glow and the crowns just beside it), and each sample takes the highest canopy within
 * ±CANOPY_SPREAD_KM along the route (no pull gaps between crowns, a ramp at the forest edge)
 */
const CANOPY_REACH_KM = 0.5;
const CANOPY_SPREAD_KM = 0.5;

const _p: [number, number, number] = [0, 0, 0];
const _q: [number, number, number] = [0, 0, 0];

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

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * RouteSystem (S5 film only, `?film=1`): the journey's luminous route line over the miniature, drawn up to
 * the head (SceneState.routeProgress × length) with a comet and a gold head light. One static ribbon
 * (routeMaterial.ts) built once from the route's render path (path.ts: near / far heights, the Moria leg
 * through the mountain); evaluate() writes four uniforms and two draw ranges — a pure function of the state
 * (no geometry rebuilds, nothing carried between frames).
 */
export class RouteSystem implements System {
  readonly id = 'route';
  readonly stats = { samples: 0, vertices: 0, drawnSegments: 0, xraySegments: 0, headKm: 0, glow: 0 };
  readonly path: RibbonPath;
  private readonly u = createRouteUniforms();
  private geometry: BufferGeometry | null = null;
  private xray: BufferGeometry | null = null;
  /** ascending segment indices (row q → q + 1) of the x-ray geometry */
  private xraySegs: Uint32Array = new Uint32Array(0);
  private materials: NodeMaterial[] = [];
  private meshes: Mesh[] = [];
  private readonly spacing: number;
  private readonly head: LightRecord = { landmark: 'route', p: [0, 0, 0], color: HEAD_COLOR, intensity: HEAD_INTENSITY, radiusKm: 0.05, kind: 'magic', gate: 'always', flicker: 0.04, seed: HEAD_SEED };
  /** per path sample: the canopy's height over the line, km (0 without a canopy provider) */
  private canopy: Float32Array = new Float32Array(0);

  constructor(
    private readonly world: World,
    readonly route: CompiledRoute,
    /**
     * the crowns over the line (VegetationSystem.canopyAlong — called in init, after the vegetation's init:
     * register the route after it); absent = no canopy pull
     */
    private readonly canopyAt?: (xyz: Float64Array, reachKm: number) => Float32Array,
  ) {
    this.spacing = route.count > 1 ? route.length / (route.count - 1) : 1;
    this.stats.samples = route.count;
    this.path = ribbonPath(route);
  }

  init(ctx: InitContext): void {
    const P = this.path;
    const n = P.count;
    // the canopy over each sample (its highest within ±CANOPY_SPREAD_KM along the route)
    const raw = this.canopyAt ? this.canopyAt(P.p, CANOPY_REACH_KM) : new Float32Array(n);
    const spread = Math.max(0, Math.round(CANOPY_SPREAD_KM / this.spacing));
    this.canopy = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      let m = 0;
      for (let j = Math.max(0, k - spread); j <= Math.min(n - 1, k + spread); j++) m = Math.max(m, raw[j]);
      this.canopy[k] = m;
    }
    // vertex triples across (edge −1, centre, edge +1): the start's extension (slid out by the shader), the n
    // samples, the end's extension
    const rows = n + 2;
    const pos = new Float32Array(rows * 3 * 3);
    // interleaved: An(3) Bn(3) Pf(3) Af(3) Bf(3) S(4) C(1)
    const STRIDE = 20;
    const il = new Float32Array(rows * 3 * STRIDE);
    const put = (o: number, src: Float64Array, k: number) => {
      il[o] = src[k * 3];
      il[o + 1] = src[k * 3 + 1];
      il[o + 2] = src[k * 3 + 2];
    };
    const segMode = new Uint8Array(rows);
    for (let q = 0; q < rows; q++) {
      const k = Math.min(n - 1, Math.max(0, q - 1));
      const ext = q === 0 ? 4 : q === rows - 1 ? 8 : 0;
      const an = Math.max(0, k - STENCIL_NEAR);
      const bn = Math.min(n - 1, k + STENCIL_NEAR);
      const af = Math.max(0, k - STENCIL_FAR);
      const bf = Math.min(n - 1, k + STENCIL_FAR);
      // one chord span ds (the near stencil's) serves both levels: the far neighbours are pulled toward the
      // far centre to span ds of s, so (B − A) / ds is dP/ds on both (the far turn angle is unchanged; its
      // radius estimate halves — a conservative inner reach)
      const dsN = Math.max(1e-6, P.s[bn] - P.s[an]);
      const dsF = Math.max(1e-6, P.s[bf] - P.s[af]);
      segMode[q] = P.mode[k];
      for (let side = 0; side < 3; side++) {
        const v = q * 3 + side;
        pos[v * 3] = P.p[k * 3];
        pos[v * 3 + 1] = P.p[k * 3 + 1];
        pos[v * 3 + 2] = P.p[k * 3 + 2];
        const o = v * STRIDE;
        put(o, P.p, an);
        put(o + 3, P.p, bn);
        put(o + 6, P.pc, k);
        const r = dsN / dsF;
        for (let c = 0; c < 3; c++) {
          const ctr = P.pc[k * 3 + c];
          il[o + 9 + c] = ctr + (P.pc[af * 3 + c] - ctr) * r;
          il[o + 12 + c] = ctr + (P.pc[bf * 3 + c] - ctr) * r;
        }
        il[o + 15] = P.s[k];
        il[o + 16] = side - 1;
        il[o + 17] = P.mode[k] + ext;
        il[o + 18] = dsN;
        il[o + 19] = this.canopy[k];
      }
    }
    const segs = rows - 1;
    const big = rows * 3 > 65535;
    const idx = big ? new Uint32Array(segs * IDX) : new Uint16Array(segs * IDX);
    // two quads per segment: edge −1 ↔ centre, centre ↔ edge +1
    const quadAt = (k: number, out: Uint16Array | Uint32Array, at: number) => {
      const a = k * 3;
      const b = a + 3;
      out.set([a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1], at);
    };
    for (let k = 0; k < segs; k++) quadAt(k, idx, k * IDX);
    // the x-ray: the segments touching an underground sample
    const xs: number[] = [];
    for (let k = 0; k < segs; k++) if (segMode[k] === 2 || segMode[k + 1] === 2) xs.push(k);
    this.xraySegs = Uint32Array.from(xs);
    const xidx = big ? new Uint32Array(Math.max(1, xs.length) * IDX) : new Uint16Array(Math.max(1, xs.length) * IDX);
    xs.forEach((k, i) => quadAt(k, xidx, i * IDX));

    const ib = new InterleavedBuffer(il, STRIDE);
    const attrs: [string, number, number][] = [
      ['routeAn', 3, 0],
      ['routeBn', 3, 3],
      ['routePf', 3, 6],
      ['routeAf', 3, 9],
      ['routeBf', 3, 12],
      ['routeS', 4, 15],
      ['routeC', 1, 19],
    ];
    const position = new Float32BufferAttribute(pos, 3);
    const make = (index: Uint16Array | Uint32Array): BufferGeometry => {
      const g = new BufferGeometry();
      g.setAttribute('position', position);
      for (const [name, size, offset] of attrs) g.setAttribute(name, new InterleavedBufferAttribute(ib, size, offset));
      g.setIndex(index instanceof Uint32Array ? new Uint32BufferAttribute(index, 1) : new Uint16BufferAttribute(index, 1));
      g.setDrawRange(0, 0);
      return g;
    };
    this.geometry = make(idx);
    this.xray = make(xidx);
    this.stats.vertices = rows * 3;
    const sp = this.world.spec;
    const ground: RouteGround = { texture: this.world.heights.texture, xMin: sp.xMin, zMin: sp.zMin, width: sp.width, depth: sp.depth };
    const under = createRouteUnderMaterial(this.u, ground);
    const core = createRouteCoreMaterial(this.u, ground);
    const xray = createRouteXrayMaterial(this.u, ground);
    this.materials = [under, core, xray];
    for (const [g, m, order, name] of [
      [this.geometry, under, ORDER_UNDER, 'route-under'],
      [this.geometry, core, ORDER_CORE, 'route-core'],
      [this.xray, xray, ORDER_XRAY, 'route-xray'],
    ] as const) {
      const mesh = new Mesh(g, m);
      mesh.name = name;
      mesh.renderOrder = order;
      // always in the scene (the warm-up's compileAsync builds the pipelines); off = an empty draw range
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
    const gx = this.xray;
    if (!g || !gx) return;
    const { state, viewport } = frame;
    const glow = routeGlowOf(state);
    const head = Math.min(1, Math.max(0, state.routeProgress)) * this.route.length;
    this.u.head.value = head;
    this.u.glow.value = glow;
    this.stats.headKm = head;
    this.stats.glow = glow;
    if (glow <= 0) {
      g.setDrawRange(0, 0);
      gx.setDrawRange(0, 0);
      this.stats.drawnSegments = 0;
      this.stats.xraySegments = 0;
      return;
    }
    // km per render px at the head's view depth (dot period, drawn reach)
    const { pos, fwd, k } = viewOf(state);
    pathAt(this.path, head, 1, _p);
    const zHead = Math.max(0.01, (_p[0] - pos[0]) * fwd[0] + (_p[1] - pos[1]) * fwd[1] + (_p[2] - pos[2]) * fwd[2]);
    const pxPerKm = viewport.height * k;
    const kmPerPx = zHead / pxPerKm;
    const scale = viewport.height / 1080;
    // underground dots: DASH_PX (1080p) along the line as it is foreshortened at the head (a leg receding
    // from the camera keeps visible dots), in world octaves crossfaded (dots never crawl)
    const alongKmPerPx = Math.min(5 * kmPerPx, this.kmPerPxAlong(state, head, viewport.width, viewport.height) ?? kmPerPx);
    const L = Math.log2(Math.max(1e-6, DASH_PX * scale * alongKmPerPx));
    const k0 = Math.floor(L);
    this.u.dashKm.value = 2 ** k0;
    this.u.dashMix.value = L - k0;
    // draw the start's extension and the samples up to the head + the cap's reach (+ the end's extension once
    // the head is there); the rest of the route is not drawn at all
    const reachKm = CAP_REACH_PX * scale * kmPerPx * QUAD_K;
    const kEnd = Math.min(this.route.count - 1, Math.ceil((head + reachKm) / this.spacing) + 1);
    const segs = Math.min(this.route.count + 1, kEnd + 2);
    g.setDrawRange(0, segs * IDX);
    this.stats.drawnSegments = segs;
    // x-ray: its segments below `segs` (ascending list → binary search)
    let lo = 0;
    let hi = this.xraySegs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.xraySegs[mid] < segs) lo = mid + 1;
      else hi = mid;
    }
    gx.setDrawRange(0, lo * IDX);
    this.stats.xraySegments = lo;
  }

  /** km of route per render px along the projected line at arc length s (±0.5 km chord), null if behind */
  private kmPerPxAlong(state: SceneState, s: number, W: number, H: number): number | null {
    const b = cameraBasis(state.camera);
    const a = projectWith(b, pathAt(this.path, Math.max(0, s - 0.5), 1, _q), W, H);
    const c = projectWith(b, pathAt(this.path, Math.min(this.route.length, s + 0.5), 1, _q), W, H);
    if (!a || !c) return null;
    const px = Math.hypot(c.x - a.x, c.y - a.y);
    const ds = Math.min(this.route.length, s + 0.5) - Math.max(0, s - 0.5);
    return px > 1e-6 && ds > 1e-6 ? ds / px : null;
  }

  /**
   * The head's world position as the line draws it (the near / far morph at its depth, as the shader), or
   * null while the line is off. Pure function of the state.
   */
  headPoint(state: SceneState, out: [number, number, number] = [0, 0, 0]): [number, number, number] | null {
    if (routeGlowOf(state) <= 0) return null;
    const head = Math.min(1, Math.max(0, state.routeProgress)) * this.route.length;
    pathAt(this.path, head, 1, out);
    const { pos, fwd, k } = viewOf(state);
    const z = Math.max(0.01, (out[0] - pos[0]) * fwd[0] + (out[1] - pos[1]) * fwd[1] + (out[2] - pos[2]) * fwd[2]);
    // resolution independent: iso / quad in 1080p px
    const iso = (1080 * k) / z;
    const h = Math.min(HALF_MAX, Math.max(HALF_MIN, iso * HALF_KM));
    const wN = smooth(MORPH[0], MORPH[1], iso / (h * QUAD_K));
    return pathAt(this.path, head, wN, out);
  }

  /**
   * The head light for the EmissionSystem's dynamic list (boot.ts composes it with the effects' lights):
   * one gold 'magic' sprite (gate 'always') at the head, a fixed HEAD_PX at 1080p at any distance, pulled
   * toward the camera like the line. Empty while the line is off. Pure function of the state (the one
   * record is rewritten in full on every call).
   */
  lights(state: SceneState): LightRecord[] {
    const glow = routeGlowOf(state);
    if (glow <= 0 || !this.headPoint(state, _p)) return [];
    const { pos, fwd, k } = viewOf(state);
    const dx = _p[0] - pos[0];
    const dy = _p[1] - pos[1];
    const dz = _p[2] - pos[2];
    const dist = Math.hypot(dx, dy, dz) || 1;
    const z = Math.max(0.01, dx * fwd[0] + dy * fwd[1] + dz * fwd[2]);
    // km per 1080p px at the head depth; the line centre's pull there (PULL_PX + PULL_CORE core half-widths)
    const kmPerPx = z / (1080 * k);
    const h = Math.min(HALF_MAX, Math.max(HALF_MIN, HALF_KM / kmPerPx));
    const head = Math.min(1, Math.max(0, state.routeProgress)) * this.route.length;
    const pull = Math.min(0.9, ((PULL_PX + PULL_CORE * h) * kmPerPx + PULL_REL * dist + this.canopyPull(head, _p, pos)) / dist);
    const rWant = HEAD_PX * kmPerPx;
    const r = Math.min(rWant, HEAD_RADIUS_CAP);
    const rec = this.head;
    rec.p = [_p[0] - dx * pull, _p[1] - dy * pull, _p[2] - dz * pull];
    rec.radiusKm = r;
    rec.intensity = Math.min(HEAD_INTENSITY_CAP, HEAD_INTENSITY * (rWant / r) ** 2) * glow;
    return [rec];
  }

  /**
   * The shader's canopy pull at arc length s (CPU mirror for the head light): the canopy (interpolated between
   * samples) over the sine of the ray's elevation, at most half way to the camera, cut short where the ray
   * toward the camera first dips under the HeightField.
   */
  private canopyPull(s: number, c: readonly number[], eye: readonly number[]): number {
    const n = this.canopy.length;
    if (!n) return 0;
    const f = Math.min(n - 1, Math.max(0, s / this.spacing));
    const k = Math.min(n - 2, Math.floor(f));
    const canopy = n > 1 ? this.canopy[k] + (this.canopy[k + 1] - this.canopy[k]) * (f - k) : this.canopy[0];
    if (!(canopy > 1e-4)) return 0;
    const dx = eye[0] - c[0];
    const dy = eye[1] - c[1];
    const dz = eye[2] - c[2];
    const d = Math.max(1e-3, Math.hypot(dx, dy, dz));
    const want = Math.min(canopy / Math.max(dy / d, CANOPY_SIN_MIN), d * 0.5);
    const spec = this.world.spec;
    for (let j = 1; j <= CANOPY_STEPS; j++) {
      const u = (want * j) / CANOPY_STEPS / d;
      const qx = c[0] + dx * u;
      const qy = c[1] + dy * u;
      const qz = c[2] + dz * u;
      if (spec.inFrame(qx, qz) && qy + CANOPY_TOL_KM <= this.world.heights.sample(qx, qz)) return (want * (j - 1)) / CANOPY_STEPS;
    }
    return want;
  }

  dispose(): void {
    for (const m of this.meshes) m.removeFromParent();
    this.geometry?.dispose();
    this.xray?.dispose();
    for (const m of this.materials) m.dispose();
  }
}
