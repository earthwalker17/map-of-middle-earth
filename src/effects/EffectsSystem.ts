import { DynamicDrawUsage, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, Uint16BufferAttribute, Vector4, type BufferGeometry, type DataTexture, type NodeMaterial } from 'three/webgpu';
import type { FrameContext, InitContext, SceneState, System } from '../core/types.ts';
import { rand } from '../core/rng.ts';
import type { LightRecord, V3 } from '../landmarks/records.ts';
import type { World } from '../world/World.ts';
import { atmosphere } from '../materials/atmosphere.ts';
import { env } from '../materials/environment.ts';
import { gateCPU, writeEvents, type GateEnv } from '../materials/gates.ts';
import type { SpillSource } from '../emission/spillSources.ts';
import { DECK_CEILING_COVER, EMBERS, FX_VIS_SLOTS, MAX_PUFFS, MIST, SPARKS } from './presets.ts';
import { evalPuff, fxWind, PO, PS, puffBounds, puffExtent, type FxWind, type PuffEmitter } from './particles.ts';
import { buildBeams, buildMist, type MistCard } from './geometry.ts';
import { buildEffects, keyVisibility, type EffectsInput, type SparkSource } from './build.ts';
import { createBeamMaterial, createFallsMaterial, createMistMaterial, createPuffMaterial, fxVisU } from './materials.ts';
import { createFxNoise, createPuffAtlas } from './textures.ts';

export { MAX_PUFFS };
export type { EffectsInput };

/**
 * render order of the puffs seen from under the ash deck (after it: the deck is behind them; and after the
 * emission sprites at 50, so a plume veils the crater's glow and the lights behind it — also any sprite
 * inside or behind a plume: crater sparks, a window glow seen through smoke; the beacon smoke is born above
 * its fire so the flames stay clear) / from above it
 */
const ORDER_UNDER = 51;
const ORDER_ABOVE = 29;
/** gain on the emission spill the puffs take (× albedo / π, like the terrain) */
const SPILL_PUFF = 1.0;
/** share of the spill a plume keeps above its lower third (the lit pall's glow on the upper column) */
const SPILL_TOP = 0.35;
/** sparks / embers: dynamic light records handed to the EmissionSystem (setDynamic) per frame */
const MAX_SPARKS = 160;

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const fract = (x: number): number => x - Math.floor(x);

/**
 * EffectsSystem (S4 W3-E) — realizes the landmarks' `emitters` and `waterFeatures` (falls), and the beacon
 * lights' fires, with a few draws:
 *  1. puffs: ONE instanced billboard draw (premultiplied alpha, CPU-sorted back to front per frame — a pure
 *     function of the camera) for smoke, ash, steam and the falls' spray. Particles are stateless
 *     (particles.ts): a still is always in steady state, any tFx renders in isolation. Each emitter has a
 *     level of detail by its projected extent (nothing below a few px; fewer, bigger puffs when small; the
 *     count is fractional — the last puff fades — so a moving camera never pops a puff).
 *     Lit on the CPU per puff by its OWN spill sources (the landmark lights that can reach the emitter,
 *     gated and flickered per frame — never displaced by another landmark's lights round the camera focus),
 *     the key's visibility over the HeightField (a gorge's shade), the deck shadow and a self-shadow side
 *     term; the fragment adds the key / hemisphere with the atlas normal.
 *  2. falls: static ribbons (a white core and a veil) + plunge-foam discs, streaks scrolled by env.tFx.
 *  3. mist cards: static stacked layers, drifting noise, time-of-day weighted.
 *  4. beams: additive axis billboards, event-gated (Minas Morgul's signal: `morgul-beam`).
 *  Falls and mist take a per-frame key visibility per fall / card (fxVisU, HeightField march on the CPU).
 *  Crater sparks and beacon flames are EmissionSystem dynamic lights (`lights(state)`, wired in boot.ts):
 *  energy-normalised sparkles, gated by the same table.
 * Render orders: mist 34, falls 35, puffs 51 under an ash deck (after the deck at 30 and the emission
 * sprites at 50: a plume veils the crater's glow) / 29 when the camera is above the deck of a drawn plume,
 * beam 52 (additive). Every mesh stays in the scene (compiled by the warm-up's compileAsync); an effect is
 * switched off by an empty draw range / instance count, never by visibility.
 * No state is carried between frames; evaluate() rewrites everything from the frame.
 */
export class EffectsSystem implements System {
  readonly id = 'effects';
  readonly stats = { emitters: 0, puffEmitters: 0, drawnEmitters: 0, puffs: 0, falls: 0, mistCards: 0, beams: 0, sparkSources: 0, sparks: 0 };
  private puffEmitters: PuffEmitter[] = [];
  private emitterSpill: number[][] = [];
  private spill: SpillSource[] = [];
  private sparkSources: SparkSource[] = [];
  private beamSlots: number[] = [];
  private mistCards: MistCard[] = [];
  private fallRefs: { p: V3; w: number; samples: [V3, V3, V3] }[] = [];
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
  /** per drawn emitter: key visibility at its source and its top */
  private visOf = new Float64Array(0);
  /** per spill source: this frame's near-field irradiance factor (J / r0² · gate · flicker) */
  private srcE = new Float64Array(0);
  private readonly _b: [number, number, number, number] = [0, 0, 0, 0];
  private readonly _spill: [number, number, number, number] = [0, 0, 0, 0];
  private readonly _gate: GateEnv = { night: 0, twilight: 0, golden: 0, events: [0, 0, 0, 0] };
  private readonly sparkPool: LightRecord[] = [];
  private readonly sparkOut: LightRecord[] = [];
  private readonly _ev = new Vector4();
  private readonly _evs = [0, 0, 0, 0];

  constructor(
    private readonly world: World,
    private readonly input: EffectsInput,
  ) {}

  init(ctx: InitContext): void {
    const seed = this.world.spec.json.seeds.world + 313;
    const heightAt = (x: number, z: number) => this.world.heights.sample(x, z);
    const L = buildEffects(this.input, { heightAt, waterLevelAt: (x, z) => this.world.waterLevelAt(x, z), deckAt: (x, z, o) => atmosphere.deckAt(x, z, o) });
    this.puffEmitters = L.puffEmitters;
    this.emitterSpill = L.emitterSpill;
    this.spill = L.spill;
    this.sparkSources = L.sparkSources;
    this.beamSlots = L.beamSlots;
    this.mistCards = L.mistCards;
    this.fallRefs = L.fallRefs;
    this.visOf = new Float64Array(this.puffEmitters.length * 2);
    this.srcE = new Float64Array(this.spill.length);
    this.stats.emitters = this.input.emitters.length;
    this.stats.puffEmitters = this.puffEmitters.length;
    this.stats.falls = this.fallRefs.length;
    this.stats.mistCards = this.mistCards.length;
    this.stats.beams = L.beams.length;
    this.stats.sparkSources = this.sparkSources.length;

    // ---- GPU
    const detail = ctx.quality.id !== 'preview';
    const atlas = createPuffAtlas(seed);
    const noise = createFxNoise(seed + 1);
    this.textures.push(atlas, noise);
    this.puffMesh = this.buildPuffMesh(atlas, noise, detail);
    ctx.scene.add(this.puffMesh);
    if (L.fallsGeometry) {
      const m = createFallsMaterial(noise, { detail });
      this.fallsMesh = this.staticMesh('fx-falls', L.fallsGeometry, m, 35);
      ctx.scene.add(this.fallsMesh);
    }
    const mist = buildMist(this.mistCards, heightAt);
    if (mist) {
      const m = createMistMaterial(noise, this.world.heights.texture, this.world.spec, { detail });
      this.mistMesh = this.staticMesh('fx-mist', mist, m, 34);
      ctx.scene.add(this.mistMesh);
    }
    const beams = buildBeams(L.beams);
    if (beams) {
      const m = createBeamMaterial(noise);
      this.beamMesh = this.staticMesh('fx-beam', beams, m, 52);
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
    // always in the scene and never frustum-culled by three: the warm-up's compileAsync builds every effect
    // pipeline whatever the first shot sees (no compile hitch when an effect first appears); evaluate()
    // switches a mesh off with an empty draw range (show())
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Draw a static effect mesh or nothing (an empty draw range: three skips the draw, the pipeline stays). */
  private show(mesh: Mesh | null, on: boolean): void {
    if (mesh) mesh.geometry.setDrawRange(0, on ? Infinity : 0);
  }

  /** A world-space bounding sphere against the camera's view cone (conservative). */
  private inView(frame: FrameContext, s: { center: { x: number; y: number; z: number }; radius: number } | null): boolean {
    if (!s) return true;
    const { camera } = frame;
    const V = camera.matrixWorldInverse.elements;
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const tanH = tanV * camera.aspect;
    const { x, y, z } = s.center;
    const r = s.radius;
    const vx = V[0] * x + V[4] * y + V[8] * z + V[12];
    const vy = V[1] * x + V[5] * y + V[9] * z + V[13];
    const vz = -(V[2] * x + V[6] * y + V[10] * z + V[14]);
    return !(vz < -r || Math.abs(vx) > vz * tanH + r * Math.hypot(1, tanH) || Math.abs(vy) > vz * tanV + r * Math.hypot(1, tanV));
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
    // always visible (compiled at warm-up); an instance count of 0 draws nothing
    return mesh;
  }

  /**
   * This frame's strength of every spill source the puffs may use (the EmissionSystem's gate and flicker
   * formulas, spillSources.ts selectSpill — without its focus selection weight).
   */
  private updateSources(tFx: number): void {
    const g = this._gate;
    g.night = env.night.value as number;
    g.twilight = env.twilight.value as number;
    g.golden = env.golden.value as number;
    const ev = env.events.value;
    const evs = g.events as number[];
    evs[0] = ev.x;
    evs[1] = ev.y;
    evs[2] = ev.z;
    evs[3] = ev.w;
    for (let i = 0; i < this.spill.length; i++) {
      const s = this.spill[i];
      const gate = gateCPU(s.gate, g);
      if (gate <= 0) {
        this.srcE[i] = 0;
        continue;
      }
      const [depth, w1, w2, phi] = s.flicker;
      const flick = depth > 0 ? Math.max(0, 1 + depth * Math.sin(tFx * w1 + phi) * Math.sin(tFx * w2 + phi * 1.7 + 1.3)) : 1;
      this.srcE[i] = (s.J / (s.r0 * s.r0)) * gate * flick;
    }
  }

  /**
   * Irradiance (rgb) at a puff from its emitter's own spill sources (CPU mirror of spillIrradiance without
   * the surface term) and the vertical direction to them.
   */
  private spillAt(ei: number, x: number, y: number, z: number): [number, number, number, number] {
    const out = this._spill;
    out[0] = out[1] = out[2] = out[3] = 0;
    const list = this.emitterSpill[ei];
    let wy = 0;
    let wt = 0;
    for (let j = 0; j < list.length; j++) {
      const i = list[j];
      const k = this.srcE[i];
      if (k <= 0) continue;
      const s = this.spill[i];
      const dx = s.p[0] - x;
      const dy = s.p[1] - y;
      const dz = s.p[2] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const R2 = s.R * s.R;
      if (d2 >= R2) continue;
      const x2 = d2 / R2;
      const win = (1 - x2 * x2) ** 2;
      const fall = 1 / (1 + d2 / Math.max(s.r0 * s.r0, 1e-8));
      const e = k * win * fall;
      out[0] += s.color[0] * e;
      out[1] += s.color[1] * e;
      out[2] += s.color[2] * e;
      const l = (0.2126 * s.color[0] + 0.7152 * s.color[1] + 0.0722 * s.color[2]) * e;
      wy += (dy / Math.sqrt(Math.max(d2, 1e-8))) * l;
      wt += l;
    }
    out[3] = wt > 0 ? wy / wt : 0;
    return out;
  }

  evaluate(frame: FrameContext): void {
    const { camera, quality } = frame;
    const ev = env.events.value;
    const events = this._evs;
    events[0] = ev.x;
    events[1] = ev.y;
    events[2] = ev.z;
    events[3] = ev.w;
    const gateOf = (slot: number) => (slot < 0 ? 1 : Math.min(1, Math.max(0, events[slot] ?? 0)));
    const pxPerKm = frame.viewport.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const cam = camera.position;
    const camDist = (x: number, y: number, z: number) => Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    const kd = env.keyDir.value;
    const kl = Math.max(1e-6, Math.hypot(kd.x, kd.y, kd.z));
    const kx = kd.x / kl;
    const ky = kd.y / kl;
    const kz = kd.z / kl;
    const heightAt = (x: number, z: number) => this.world.heights.sample(x, z);

    // ---- beams: drawn only while their channel is on
    this.show(this.beamMesh, this.beamSlots.some((s) => gateOf(s) > 0));
    // ---- falls / mist: drawn only when one is in view and above a pixel or so (the falls' and the cards'
    // bounding spheres span the map, so the projected-size test carries the culling); key visibility per
    // fall (lip, middle, foot) and per card (its two ends and middle), over the HeightField
    if (this.fallsMesh) {
      const on = this.inView(frame, this.fallsMesh.geometry.boundingSphere) && this.fallRefs.some((f) => (f.w * pxPerKm) / camDist(f.p[0], f.p[1], f.p[2]) > 0.8);
      this.show(this.fallsMesh, on);
      if (on) {
        const arr = fxVisU.falls.array as Vector4[];
        for (let i = 0; i < Math.min(this.fallRefs.length, FX_VIS_SLOTS); i++) {
          const [a, b, c] = this.fallRefs[i].samples;
          const v = (p: V3) => keyVisibility(heightAt, p[0], p[1] + 0.03, p[2], kx, ky, kz);
          arr[i].set(v(a), v(b), v(c), 1);
        }
      }
    }
    if (this.mistMesh) {
      const on = this.inView(frame, this.mistMesh.geometry.boundingSphere) && this.mistCards.some((c) => (2 * c.halfWidth * pxPerKm) / camDist(c.at[0], c.at[1], c.at[2]) > MIST.lodPx[0]);
      this.show(this.mistMesh, on);
      if (on) {
        const arr = fxVisU.mist.array as Vector4[];
        for (let i = 0; i < Math.min(this.mistCards.length, FX_VIS_SLOTS); i++) {
          const c = this.mistCards[i];
          const to = c.to ?? c.at;
          const up = Math.min(MIST.maxSpacing, MIST.spacing * c.halfWidth);
          const v = (x: number, y: number, z: number) => keyVisibility(heightAt, x, y + up, z, kx, ky, kz);
          arr[i].set(v(c.at[0], c.at[1], c.at[2]), v((c.at[0] + to[0]) / 2, (c.at[1] + to[1]) / 2, (c.at[2] + to[2]) / 2), v(to[0], to[1], to[2]), 1);
        }
      }
    }

    this.evaluatePuffs(frame, gateOf, pxPerKm, quality.density, [kx, ky, kz]);
  }

  private evaluatePuffs(frame: FrameContext, gateOf: (slot: number) => number, pxPerKm: number, density: number, key: [number, number, number]): void {
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
    const [kx, ky, kz] = key;
    const kh = Math.hypot(kx, kz);
    const khx = kh > 1e-3 ? kx / kh : 0;
    const khz = kh > 1e-3 ? kz / kh : 0;
    const heightAt = (x: number, z: number) => this.world.heights.sample(x, z);
    const deckShadow = env.deckShadow.value as number;
    const tone = env.deckTone.value;
    this.updateSources(state.tFx);
    const S = this.scratch;
    let n = 0;
    let drawn = 0;
    // the highest deck over a drawn plume (0 = none): a camera above it sees the plumes under the pall
    let underDeckY = 0;
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
      // a fractional count: puffs come and go continuously with the projected size (the last one fades)
      const wantF = Math.min(e.count, Math.max(e.P.minCount, e.count * density * Math.min(1, Math.max(0.3, px / p1))));
      const full = Math.ceil(wantF - 1e-9);
      const count = Math.min(full, MAX_PUFFS - n);
      if (count <= 0) break;
      const lastA = count === full ? wantF - (full - 1) : 1;
      // fewer puffs: each a little bigger and denser (the column keeps its body); a spray cloud keeps its
      // puff size (bigger diffuse puffs would swell the cloud into a smear — it only thickens)
      const thin = e.count / wantF;
      const sizeK = Math.pow(thin, e.P.family === 'spray' ? 0.1 : 0.3);
      const alphaK = Math.min(2, Math.pow(thin, 0.25)) * vis;
      if (e.cover > DECK_CEILING_COVER) underDeckY = Math.max(underDeckY, e.deckY);
      // key visibility over the HeightField at the source and the top of the column
      const top = e.P.family === 'ash' ? e.P.rise * e.scale : e.H;
      this.visOf[ei * 2] = keyVisibility(heightAt, e.p[0], e.p[1] + 0.02, e.p[2], kx, ky, kz);
      this.visOf[ei * 2 + 1] = keyVisibility(heightAt, e.p[0], e.p[1] + top, e.p[2], kx, ky, kz);
      drawn++;
      for (let k = 0; k < count; k++) {
        const o = n * PS;
        if (!evalPuff(e, k, state.tFx, w, S, o)) continue;
        S[o + PO.size] *= sizeK;
        S[o + PO.alpha] = Math.min(1, S[o + PO.alpha] * alphaK) * (k === count - 1 ? lastA : 1);
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
      const ei = this.emitterOf[i];
      const e = this.puffEmitters[ei];
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
      // spill (the emitter's own sources) × albedo / π, the preset's share
      const sp = this.spillAt(ei, x, y, z);
      // a plume takes the glow of its source on its lower third; above, it stays dark (the film's ash column)
      const hf = S[o + PO.hf];
      const low = e.P.family === 'plume' ? SPILL_TOP + (1 - SPILL_TOP) * (1 - smooth(0.18, 0.5, hf)) : 1;
      const k = ((SPILL_PUFF * e.P.spill) / Math.PI) * low;
      C[q] = sp[0] * ar * k;
      C[q + 1] = sp[1] * ag * k;
      C[q + 2] = sp[2] * ab * k;
      // key visibility: the terrain's shade (source → top), the deck's shadow; the side of the column away
      // from the key is in its own shade
      const lx = S[o + PO.lx];
      const lz = S[o + PO.lz];
      const ll = Math.hypot(lx, lz);
      const side = ll > 1e-3 ? (lx * khx + lz * khz) / Math.max(ll, 1) : 0;
      const tv = this.visOf[ei * 2] + (this.visOf[ei * 2 + 1] - this.visOf[ei * 2]) * Math.min(1, Math.max(0, hf));
      C[q + 3] = tv * (1 - e.cover * deckShadow) * (0.62 + 0.38 * (0.5 + 0.5 * side));
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
    // seen from under the ash deck the puffs are in front of it; from above (height only: a camera beside
    // the deck's footprint but above its height still looks down on the pall), behind it
    mesh.renderOrder = underDeckY > 0 && cam.y > underDeckY ? ORDER_ABOVE : ORDER_UNDER;
    this.stats.drawnEmitters = drawn;
    this.stats.puffs = n;
  }

  /**
   * Crater sparks and beacon flames as EmissionSystem dynamic lights — a pure function of the state
   * (camera, tFx, events, wind). Wired in boot.ts: emission.setDynamic((s) => effects.lights(s)).
   * Returns a reused array (valid until the next call).
   */
  lights(state: SceneState): LightRecord[] {
    const pool = this.sparkPool;
    let n = 0;
    const [cx, cy, cz] = state.camera.position;
    const pxPerKm = (env.viewportH.value as number) / (2 * Math.tan((state.camera.fov * Math.PI) / 360));
    const w = fxWind(state.weather.wind);
    const ev = writeEvents(state.events, this._ev);
    const evs = this._evs;
    evs[0] = ev.x;
    evs[1] = ev.y;
    evs[2] = ev.z;
    evs[3] = ev.w;
    const slotVal = (slot: number) => (slot < 0 ? 1 : Math.min(1, Math.max(0, evs[slot] ?? 0)));
    for (const s of this.sparkSources) {
      if (slotVal(s.slot) <= 0) continue;
      const P = s.mode === 'sparks' ? SPARKS : EMBERS;
      const reach = (s.mode === 'sparks' ? SPARKS.rise : EMBERS.rise * 3) * s.scale;
      const px = (reach * pxPerKm) / Math.max(1e-3, Math.hypot(s.p[0] - cx, s.p[1] - cy, s.p[2] - cz));
      const vis = smooth(P.lodPx[0], P.lodPx[1], px);
      if (vis <= 0) continue;
      for (let k = 0; k < s.count && n < MAX_SPARKS; k++) {
        const r = (pool[n] ??= { landmark: '', p: [0, 0, 0], color: [0, 0, 0], intensity: 0, radiusKm: 0, kind: 'fire', gate: 'always', flicker: 0, seed: 0 });
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
    const out = this.sparkOut;
    out.length = n;
    for (let i = 0; i < n; i++) out[i] = pool[i];
    return out;
  }

  dispose(): void {
    for (const m of [this.puffMesh, this.fallsMesh, this.mistMesh, this.beamMesh]) m?.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
