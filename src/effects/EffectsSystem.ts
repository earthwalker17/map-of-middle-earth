import { DynamicDrawUsage, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, Uint16BufferAttribute, Vector4, type BufferGeometry, type DataTexture, type NodeMaterial } from 'three/webgpu';
import type { FrameContext, InitContext, SceneState, System } from '../core/types.ts';
import { rand } from '../core/rng.ts';
import type { EmitterRecord, FallRecord, LightGate, LightKind, LightRecord, PoolRecord, V3 } from '../landmarks/records.ts';
import type { World } from '../world/World.ts';
import { atmosphere, type DeckSample } from '../materials/atmosphere.ts';
import { env } from '../materials/environment.ts';
import { GATE, gateCode, writeEvents } from '../materials/gates.ts';
import { spillArrays, spillU } from '../emission/spill.ts';
import { BEAM, EMBERS, MAX_PUFFS, MIST, SPARKS } from './presets.ts';

export { MAX_PUFFS };
import { derivedSeed, evalPuff, fxWind, makePuffEmitter, PO, PS, puffBounds, puffExtent, type FxWind, type PuffEmitter } from './particles.ts';
import { buildBeams, buildFalls, buildMist, type BeamDecl, type MistCard } from './geometry.ts';
import { createBeamMaterial, createFallsMaterial, createMistMaterial, createPuffMaterial } from './materials.ts';
import { createFxNoise, createPuffAtlas } from './textures.ts';

/**
 * render order of the puffs seen from under the ash deck (after it: the deck is behind them; and after the
 * emission sprites at 50, so a plume veils the crater's glow and the lights behind it) / from above it
 */
const ORDER_UNDER = 51;
const ORDER_ABOVE = 29;
/** gain on the emission spill the puffs take (× albedo / π, like the terrain), and its floor in the shade */
const SPILL_PUFF = 1.0;
/** share of the spill a plume keeps above its lower third */
const SPILL_TOP = 0.2;
/** sparks / embers: dynamic light records handed to the EmissionSystem (setDynamic) per frame */
const MAX_SPARKS = 160;

/** inputs: the landmarks' world-space effect records (landmarks/world.ts) and their lights (beacons) */
export interface EffectsInput {
  emitters: EmitterRecord[];
  falls: FallRecord[];
  lights: LightRecord[];
  /** landmark pools (the plunge foam of a fall into one floats on its surface) */
  pools?: PoolRecord[];
}

/** point in a closed XZ ring (even-odd) */
function inRing(r: readonly (readonly [number, number])[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** a source of additive points (crater sparks, beacon flames) realized as EmissionSystem dynamic lights */
interface SparkSource {
  landmark: string;
  mode: 'sparks' | 'embers';
  p: V3;
  scale: number;
  count: number;
  slot: number;
  seed: number;
  kind: LightKind;
  gate: LightGate;
  event?: string;
  color: V3;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const fract = (x: number): number => x - Math.floor(x);

/** env.events component of an emitter's channel (−1 = always on) */
function slotOf(event: string | undefined): number {
  return event === undefined ? -1 : gateCode('event', undefined, event) - GATE.event;
}

/**
 * EffectsSystem (S4 W3-E) — realizes the landmarks' `emitters` and `waterFeatures` (falls), and the beacon
 * lights' fires, with a few draws:
 *  1. puffs: ONE instanced billboard draw (premultiplied alpha, CPU-sorted back to front per frame — a pure
 *     function of the camera) for smoke, ash, steam and the falls' spray. Particles are stateless
 *     (particles.ts): a still is always in steady state, any tFx renders in isolation. Each emitter has a
 *     level of detail by its projected extent (nothing below a few px; fewer, bigger puffs when small).
 *     Lit on the CPU per puff by the emission spill (Doom's plume glows red from below), the deck shadow
 *     and a self-shadow side term; the fragment adds the key / hemisphere with the atlas normal.
 *  2. falls: static ribbons (a white core and a veil) + plunge-foam discs, streaks scrolled by env.tFx.
 *  3. mist cards: static stacked layers, drifting noise, time-of-day weighted.
 *  4. beams: additive axis billboards, event-gated (Minas Morgul's signal: `morgul-beam`).
 *  Crater sparks and beacon flames are EmissionSystem dynamic lights (`lights(state)`, wired in boot.ts):
 *  energy-normalised sparkles, gated by the same table.
 * No state is carried between frames; evaluate() rewrites everything from the frame.
 */
export class EffectsSystem implements System {
  readonly id = 'effects';
  readonly stats = { emitters: 0, puffEmitters: 0, drawnEmitters: 0, puffs: 0, falls: 0, mistCards: 0, beams: 0, sparkSources: 0, sparks: 0 };
  private puffEmitters: PuffEmitter[] = [];
  private sparkSources: SparkSource[] = [];
  private beams: BeamDecl[] = [];
  private beamSlots: number[] = [];
  private mistCards: MistCard[] = [];
  private fallRefs: { p: V3; w: number }[] = [];
  private puffMesh: Mesh | null = null;
  private puffGeo: InstancedBufferGeometry | null = null;
  private puffAttrs: { a: InstancedBufferAttribute; b: InstancedBufferAttribute; c: InstancedBufferAttribute; d: InstancedBufferAttribute } | null = null;
  private fallsMesh: Mesh | null = null;
  private mistMesh: Mesh | null = null;
  private beamMesh: Mesh | null = null;
  private readonly materials: NodeMaterial[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly textures: DataTexture[] = [];
  /** per-frame scratch (rewritten in full every frame) */
  private scratch = new Float64Array(MAX_PUFFS * PS);
  private depth = new Float64Array(MAX_PUFFS);
  private order: number[] = [];
  private emitterOf = new Int32Array(MAX_PUFFS);
  private readonly _b: [number, number, number, number] = [0, 0, 0, 0];
  private readonly _spill: [number, number, number, number] = [0, 0, 0, 0];
  private readonly sparkPool: LightRecord[] = [];
  private readonly _ev = new Vector4();

  constructor(
    private readonly world: World,
    private readonly input: EffectsInput,
  ) {}

  init(ctx: InitContext): void {
    const seed = this.world.spec.json.seeds.world + 313;
    const deck: DeckSample = { cover: 0, r: 0, g: 0, b: 0, height: 0, topOpacity: 0 };
    const deckAt = (x: number, z: number) => atmosphere.deckAt(x, z, deck);
    const heightAt = (x: number, z: number) => this.world.heights.sample(x, z);

    // ---- declared emitters
    for (const r of this.input.emitters) {
      switch (r.preset) {
        case 'smoke':
        case 'ash':
        case 'steam': {
          deckAt(r.p[0], r.p[2]);
          this.puffEmitters.push(makePuffEmitter({ landmark: r.landmark, preset: r.preset, p: r.p, ...(r.to ? { to: r.to } : {}), rate: r.rate, scale: r.scale, ...(r.color ? { color: r.color } : {}), slot: slotOf(r.event), seed: r.seed, cover: deck.cover, deckY: deck.height }));
          break;
        }
        case 'mist':
          this.mistCards.push({ at: r.p, ...(r.to ? { to: r.to } : {}), halfWidth: r.scale, opacity: r.rate, tint: r.color ?? [0.86, 0.89, 0.93], seed: r.seed });
          break;
        case 'beam': {
          const to: V3 = r.to ?? [r.p[0], r.p[1] + 25, r.p[2]];
          const c = r.color ?? BEAM.color;
          const k = BEAM.radiance * r.rate;
          const ev = r.event ?? 'morgul-beam';
          this.beams.push({ from: r.p, to, color: [c[0] * k, c[1] * k, c[2] * k], glow: BEAM.glow * r.scale, core: BEAM.core * r.scale, gate: gateCode('event', undefined, ev) });
          this.beamSlots.push(slotOf(ev));
          break;
        }
        case 'sparks':
          this.sparkSources.push({ landmark: r.landmark, mode: 'sparks', p: r.p, scale: r.scale, count: Math.max(3, Math.round(SPARKS.count * r.rate)), slot: slotOf(r.event), seed: r.seed, kind: 'lava', gate: r.event ? 'event' : 'always', ...(r.event ? { event: r.event } : {}), color: r.color ?? [1, 0.36, 0.08] });
          break;
        case 'embers':
          this.sparkSources.push({ landmark: r.landmark, mode: 'embers', p: r.p, scale: r.scale, count: Math.max(3, Math.round((EMBERS.flames + EMBERS.sparks) * r.rate)), slot: slotOf(r.event), seed: r.seed, kind: 'fire', gate: r.event ? 'event' : 'dusk', ...(r.event ? { event: r.event } : {}), color: r.color ?? [1, 0.45, 0.12] });
          break;
      }
    }
    // ---- beacon lights: a fire (embers) and a smoke column, switched with the light's channel
    for (const [i, l] of this.input.lights.entries()) {
      if (l.kind !== 'beacon') continue;
      const ev = l.event ?? 'beacons';
      const s = derivedSeed(l.seed, i);
      deckAt(l.p[0], l.p[2]);
      this.puffEmitters.push(makePuffEmitter({ landmark: l.landmark, preset: 'smoke', p: [l.p[0], l.p[1] + 0.04, l.p[2]], rate: 0.8, scale: 0.32, color: [0.13, 0.12, 0.11], slot: slotOf(ev), seed: s, cover: deck.cover, deckY: deck.height }));
      this.sparkSources.push({ landmark: l.landmark, mode: 'embers', p: l.p, scale: 1, count: EMBERS.flames + EMBERS.sparks, slot: slotOf(ev), seed: s ^ 0x2545f491, kind: 'beacon', gate: 'event', event: ev, color: [1, 0.55, 0.2] });
    }
    // ---- falls: ribbons + foam (static), spray (puffs)
    // the water over a fall's foot (landmark pools, lakes): the plunge foam floats on it
    const pools = this.input.pools ?? [];
    const waterAt = (x: number, z: number): number | null => {
      let lv: number | null = this.world.waterLevelAt(x, z);
      for (const p of pools) if (p.level > (lv ?? -1e9) && inRing(p.ring, x, z)) lv = p.level;
      return lv;
    };
    const falls = buildFalls(this.input.falls, heightAt, waterAt);
    for (const sp of falls.sprays) {
      deckAt(sp.p[0], sp.p[2]);
      this.puffEmitters.push(makePuffEmitter({ landmark: sp.landmark, preset: 'spray', p: sp.p, out: sp.out, rate: 1, scale: sp.scale, slot: -1, seed: sp.seed, cover: deck.cover, deckY: deck.height }));
      // a wide fall's mist column (Rauros' "smoke"): a tall, pale, dissolving steam plume over the foot
      if (sp.column > 0) this.puffEmitters.push(makePuffEmitter({ landmark: sp.landmark, preset: 'steam', p: sp.p, rate: 0.55, scale: sp.column, color: [0.72, 0.74, 0.77], slot: -1, seed: derivedSeed(sp.seed, 7), cover: deck.cover, deckY: deck.height }));
    }
    this.fallRefs = this.input.falls.map((f) => ({ p: f.path[f.path.length - 1], w: f.width }));
    this.stats.emitters = this.input.emitters.length;
    this.stats.puffEmitters = this.puffEmitters.length;
    this.stats.falls = this.fallRefs.length;
    this.stats.mistCards = this.mistCards.length;
    this.stats.beams = this.beams.length;
    this.stats.sparkSources = this.sparkSources.length;

    // ---- GPU
    const detail = ctx.quality.id !== 'preview';
    const atlas = createPuffAtlas(seed);
    const noise = createFxNoise(seed + 1);
    this.textures.push(atlas, noise);
    this.puffMesh = this.buildPuffMesh(atlas, noise, detail);
    ctx.scene.add(this.puffMesh);
    if (falls.geometry) {
      const m = createFallsMaterial(noise, { detail });
      this.fallsMesh = this.staticMesh('fx-falls', falls.geometry, m, 35);
      ctx.scene.add(this.fallsMesh);
    }
    const mist = buildMist(this.mistCards, heightAt);
    if (mist) {
      const m = createMistMaterial(noise, this.world.heights.texture, this.world.spec, { detail });
      this.mistMesh = this.staticMesh('fx-mist', mist, m, 34);
      ctx.scene.add(this.mistMesh);
    }
    const beams = buildBeams(this.beams);
    if (beams) {
      const m = createBeamMaterial(noise);
      this.beamMesh = this.staticMesh('fx-beam', beams, m, 52);
      this.beamMesh.frustumCulled = false; // the vertex stage widens the strip
      ctx.scene.add(this.beamMesh);
    }
  }

  private staticMesh(name: string, g: BufferGeometry, m: NodeMaterial, order: number): Mesh {
    this.geometries.push(g);
    this.materials.push(m);
    const mesh = new Mesh(g, m);
    mesh.name = name;
    mesh.renderOrder = order;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  private buildPuffMesh(atlas: DataTexture, noise: DataTexture, detail: boolean): Mesh {
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex(new Uint16BufferAttribute([0, 1, 2, 0, 2, 3], 1));
    const mk = () => {
      const a = new InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 4), 4);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    const attrs = { a: mk(), b: mk(), c: mk(), d: mk() };
    g.setAttribute('fxA', attrs.a);
    g.setAttribute('fxB', attrs.b);
    g.setAttribute('fxC', attrs.c);
    g.setAttribute('fxD', attrs.d);
    g.instanceCount = 0;
    this.puffGeo = g;
    this.puffAttrs = attrs;
    this.geometries.push(g);
    const m = createPuffMaterial(atlas, noise, { detail });
    this.materials.push(m);
    const mesh = new Mesh(g, m);
    mesh.name = 'fx-puffs';
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = ORDER_UNDER;
    mesh.visible = false;
    return mesh;
  }

  /** CPU mirror of spillIrradiance without the surface term: irradiance (rgb) and the vertical direction to the sources. */
  private spillAt(x: number, y: number, z: number): [number, number, number, number] {
    const out = this._spill;
    out[0] = out[1] = out[2] = 0;
    out[3] = 0;
    const n = spillU.count.value as number;
    if (n <= 0) return out;
    const { pos, col } = spillArrays();
    let wy = 0;
    let wt = 0;
    for (let i = 0; i < n; i++) {
      const a = pos[i];
      const dx = a.x - x;
      const dy = a.y - y;
      const dz = a.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const R2 = a.w * a.w;
      if (d2 >= R2) continue;
      const c = col[i];
      const x2 = d2 / R2;
      const win = (1 - x2 * x2) ** 2;
      const fall = 1 / (1 + d2 / Math.max(c.w * c.w, 1e-8));
      const e = win * fall;
      out[0] += c.x * e;
      out[1] += c.y * e;
      out[2] += c.z * e;
      const l = (0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z) * e;
      wy += (dy / Math.sqrt(Math.max(d2, 1e-8))) * l;
      wt += l;
    }
    out[3] = wt > 0 ? wy / wt : 0;
    return out;
  }

  evaluate(frame: FrameContext): void {
    const { camera, quality } = frame;
    const ev = env.events.value;
    const events = [ev.x, ev.y, ev.z, ev.w];
    const gateOf = (slot: number) => (slot < 0 ? 1 : Math.min(1, Math.max(0, events[slot] ?? 0)));
    const pxPerKm = frame.viewport.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const cam = camera.position;
    const camDist = (x: number, y: number, z: number) => Math.hypot(x - cam.x, y - cam.y, z - cam.z);

    // ---- beams: hidden while their channel is off
    if (this.beamMesh) this.beamMesh.visible = this.beamSlots.some((s) => gateOf(s) > 0);
    // ---- falls / mist: hidden when every one is below a pixel or two (overviews)
    if (this.fallsMesh) this.fallsMesh.visible = this.fallRefs.some((f) => (f.w * pxPerKm) / camDist(f.p[0], f.p[1], f.p[2]) > 0.8);
    if (this.mistMesh) this.mistMesh.visible = this.mistCards.some((c) => (2 * c.halfWidth * pxPerKm) / camDist(c.at[0], c.at[1], c.at[2]) > MIST.lodPx[0]);

    this.evaluatePuffs(frame, gateOf, pxPerKm, quality.density);
  }

  private evaluatePuffs(frame: FrameContext, gateOf: (slot: number) => number, pxPerKm: number, density: number): void {
    const mesh = this.puffMesh;
    const geo = this.puffGeo;
    const at = this.puffAttrs;
    if (!mesh || !geo || !at) return;
    const { state, camera } = frame;
    const w: FxWind = fxWind(state.weather.wind);
    const V = camera.matrixWorldInverse.elements;
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const tanH = tanV * camera.aspect;
    const secV = Math.hypot(1, tanV);
    const secH = Math.hypot(1, tanH);
    const cam = camera.position;
    const kd = env.keyDir.value;
    const kh = Math.hypot(kd.x, kd.z);
    const kx = kh > 1e-3 ? kd.x / kh : 0;
    const kz = kh > 1e-3 ? kd.z / kh : 0;
    const deckShadow = env.deckShadow.value as number;
    const tone = env.deckTone.value;
    const S = this.scratch;
    let n = 0;
    let drawn = 0;
    for (let ei = 0; ei < this.puffEmitters.length; ei++) {
      const e = this.puffEmitters[ei];
      const gate = gateOf(e.slot);
      if (gate <= 0) continue;
      // culling: the emitter's bounding sphere against the view cone
      const b = puffBounds(e, w, this._b);
      const vx = V[0] * b[0] + V[4] * b[1] + V[8] * b[2] + V[12];
      const vy = V[1] * b[0] + V[5] * b[1] + V[9] * b[2] + V[13];
      const vz = -(V[2] * b[0] + V[6] * b[1] + V[10] * b[2] + V[14]);
      if (vz < -b[3] || Math.abs(vx) > vz * tanH + b[3] * secH || Math.abs(vy) > vz * tanV + b[3] * secV) continue;
      // level of detail by the projected extent
      const dist = Math.max(1e-3, Math.hypot(b[0] - cam.x, b[1] - cam.y, b[2] - cam.z) - b[3] * 0.5);
      const px = (puffExtent(e) * pxPerKm) / dist;
      const [p0, p1] = e.P.lodPx;
      const vis = smooth(p0, p0 * 2, px) * gate;
      if (vis <= 0) continue;
      const want = Math.max(e.P.minCount, Math.round(e.count * density * Math.min(1, Math.max(0.3, px / p1))));
      const count = Math.min(e.count, want, MAX_PUFFS - n);
      if (count <= 0) break;
      // fewer puffs: each a little bigger and denser (the column keeps its body)
      const thin = e.count / count;
      const sizeK = Math.pow(thin, 0.3);
      const alphaK = Math.min(2, Math.pow(thin, 0.25)) * vis;
      drawn++;
      for (let k = 0; k < count; k++) {
        const o = n * PS;
        if (!evalPuff(e, k, state.tFx, w, S, o)) continue;
        S[o + PO.size] *= sizeK;
        S[o + PO.alpha] = Math.min(1, S[o + PO.alpha] * alphaK);
        const x = S[o];
        const y = S[o + 1];
        const z = S[o + 2];
        this.depth[n] = -(V[2] * x + V[6] * y + V[10] * z + V[14]);
        if (this.depth[n] < -S[o + PO.size]) continue; // behind the camera
        this.emitterOf[n] = ei;
        n++;
      }
      if (n >= MAX_PUFFS) break;
    }
    // back to front (far first); ties keep the evaluation order (a pure function of the frame)
    const order = this.order;
    order.length = n;
    for (let i = 0; i < n; i++) order[i] = i;
    const dpt = this.depth;
    order.sort((i, j) => dpt[j] - dpt[i] || i - j);

    const A = at.a.array as Float32Array;
    const B = at.b.array as Float32Array;
    const C = at.c.array as Float32Array;
    const D = at.d.array as Float32Array;
    for (let r = 0; r < n; r++) {
      const i = order[r];
      const o = i * PS;
      const e = this.puffEmitters[this.emitterOf[i]];
      const x = S[o];
      const y = S[o + 1];
      const z = S[o + 2];
      const q = r * 4;
      A[q] = x;
      A[q + 1] = y;
      A[q + 2] = z;
      A[q + 3] = S[o + PO.size];
      const mg = S[o + PO.merge];
      const ar = e.albedo[0] + (tone.r - e.albedo[0]) * mg;
      const ag = e.albedo[1] + (tone.g - e.albedo[1]) * mg;
      const ab = e.albedo[2] + (tone.b - e.albedo[2]) * mg;
      B[q] = ar;
      B[q + 1] = ag;
      B[q + 2] = ab;
      // opacity (0..1) + 2 × the deck cover in eighths (the shader adds the overcast's light under a deck)
      B[q + 3] = Math.min(1, S[o + PO.alpha]) + 2 * Math.round(8 * Math.min(1, Math.max(0, e.cover)));
      // spill (CPU mirror of the selected sources) × albedo / π, the preset's share
      const sp = this.spillAt(x, y, z);
      // a plume takes the glow of its source on its lower third; above, it stays dark (the film's ash column)
      const low = e.P.family === 'plume' ? SPILL_TOP + (1 - SPILL_TOP) * (1 - smooth(0.18, 0.5, S[o + PO.hf])) : 1;
      const k = ((SPILL_PUFF * e.P.spill) / Math.PI) * low;
      C[q] = sp[0] * ar * k;
      C[q + 1] = sp[1] * ag * k;
      C[q + 2] = sp[2] * ab * k;
      // key visibility: under the deck's shadow; the side of the column away from the key is in its shade
      const lx = S[o + PO.lx];
      const lz = S[o + PO.lz];
      const ll = Math.hypot(lx, lz);
      const side = ll > 1e-3 ? (lx * kx + lz * kz) / Math.max(ll, 1) : 0;
      C[q + 3] = (1 - e.cover * deckShadow) * (0.62 + 0.38 * (0.5 + 0.5 * side));
      D[q] = S[o + PO.rot];
      D[q + 1] = S[o + PO.frame] + 16 * (e.P.soft ?? 0);
      D[q + 2] = S[o + PO.sky];
      D[q + 3] = sp[3];
    }
    for (const attr of [at.a, at.b, at.c, at.d]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, Math.max(1, n * 4));
      attr.needsUpdate = true;
    }
    geo.instanceCount = n;
    mesh.visible = n > 0;
    // seen from under the ash deck the puffs are in front of it; from above, behind it
    const deck: DeckSample = { cover: 0, r: 0, g: 0, b: 0, height: 0, topOpacity: 0 };
    atmosphere.deckAt(cam.x, cam.z, deck);
    mesh.renderOrder = deck.cover > 0.05 && cam.y > deck.height ? ORDER_ABOVE : ORDER_UNDER;
    this.stats.drawnEmitters = drawn;
    this.stats.puffs = n;
  }

  /**
   * Crater sparks and beacon flames as EmissionSystem dynamic lights — a pure function of the state
   * (camera, tFx, events, wind). Wired in boot.ts: emission.setDynamic((s) => effects.lights(s)).
   */
  lights(state: SceneState): LightRecord[] {
    const out = this.sparkPool;
    let n = 0;
    const [cx, cy, cz] = state.camera.position;
    const pxPerKm = (env.viewportH.value as number) / (2 * Math.tan((state.camera.fov * Math.PI) / 360));
    const w = fxWind(state.weather.wind);
    const ev = writeEvents(state.events, this._ev);
    const evs = [ev.x, ev.y, ev.z, ev.w];
    const slotVal = (slot: number) => (slot < 0 ? 1 : Math.min(1, Math.max(0, evs[slot] ?? 0)));
    for (const s of this.sparkSources) {
      if (slotVal(s.slot) <= 0) continue;
      const P = s.mode === 'sparks' ? SPARKS : EMBERS;
      const reach = (s.mode === 'sparks' ? SPARKS.rise : EMBERS.rise * 3) * s.scale;
      const px = (reach * pxPerKm) / Math.max(1e-3, Math.hypot(s.p[0] - cx, s.p[1] - cy, s.p[2] - cz));
      const vis = smooth(P.lodPx[0], P.lodPx[1], px);
      if (vis <= 0) continue;
      for (let k = 0; k < s.count && n < MAX_SPARKS; k++) {
        const r = (out[n] ??= { landmark: '', p: [0, 0, 0], color: [0, 0, 0], intensity: 0, radiusKm: 0, kind: 'fire', gate: 'always', flicker: 0, seed: 0 });
        const h0 = rand(s.seed, k, 0);
        const life = P.life * (0.7 + 0.6 * rand(s.seed, k, 1));
        const a = fract(state.tFx / life + h0);
        const ang = rand(s.seed, k, 2) * Math.PI * 2;
        const u = rand(s.seed, k, 3);
        let x: number;
        let y: number;
        let z: number;
        let I: number;
        let rad: number;
        if (s.mode === 'sparks') {
          // ballistic: thrown out of the crater, arcing back down
          const apex = SPARKS.rise * s.scale * (0.35 + 0.65 * u);
          const hr = SPARKS.spread * s.scale * a * (0.3 + 0.7 * rand(s.seed, k, 4));
          x = s.p[0] + Math.cos(ang) * hr + w.dx * 0.2 * apex * a;
          z = s.p[2] + Math.sin(ang) * hr + w.dz * 0.2 * apex * a;
          y = s.p[1] + 4 * apex * a * (1 - a);
          I = SPARKS.intensity * Math.pow(1 - a, 1.5) * smooth(0, 0.05, a);
          rad = SPARKS.radiusKm * s.scale;
        } else if (k < EMBERS.flames) {
          // flame tongues licking up from the pile
          const rr = 0.25 * EMBERS.radiusKm * s.scale * Math.sqrt(u);
          x = s.p[0] + Math.cos(ang) * rr;
          z = s.p[2] + Math.sin(ang) * rr;
          y = s.p[1] + EMBERS.rise * s.scale * 0.4 * a;
          I = EMBERS.intensity * (1 - a) * smooth(0, 0.15, a);
          rad = EMBERS.radiusKm * s.scale * (1 - 0.5 * a);
        } else {
          // sparks rising out of the fire, carried downwind
          const up = EMBERS.rise * s.scale * 3 * a;
          x = s.p[0] + w.dx * up * 0.5 + Math.cos(ang) * 0.02 * s.scale * a;
          z = s.p[2] + w.dz * up * 0.5 + Math.sin(ang) * 0.02 * s.scale * a;
          y = s.p[1] + up;
          I = EMBERS.intensity * 0.35 * Math.pow(1 - a, 2);
          rad = EMBERS.radiusKm * s.scale * 0.25;
        }
        r.landmark = s.landmark;
        r.p[0] = x;
        r.p[1] = y;
        r.p[2] = z;
        r.color[0] = s.color[0];
        r.color[1] = s.color[1];
        r.color[2] = s.color[2];
        r.intensity = I * vis;
        r.radiusKm = rad;
        r.kind = s.kind;
        r.gate = s.gate;
        if (s.event !== undefined) r.event = s.event;
        else delete r.event;
        r.flicker = 0.3;
        r.seed = (s.seed + k * 7919) >>> 0;
        n++;
      }
    }
    this.stats.sparks = n;
    out.length = Math.max(out.length, n);
    return out.slice(0, n);
  }

  dispose(): void {
    for (const m of [this.puffMesh, this.fallsMesh, this.mistMesh, this.beamMesh]) m?.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
