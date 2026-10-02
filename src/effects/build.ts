import type { BufferGeometry } from 'three/webgpu';
import type { EmitterRecord, FallRecord, LightGate, LightKind, LightRecord, PoolRecord, V3 } from '../landmarks/records.ts';
import type { DeckSample } from '../materials/atmosphere.ts';
import { GATE, gateCode } from '../materials/gates.ts';
import { buildSpillSources, type SpillSource } from '../emission/spillSources.ts';
import { BEAM, EMBERS, SPARKS } from './presets.ts';
import { derivedSeed, makePuffEmitter, puffBounds, type PuffEmitter } from './particles.ts';
import { buildFalls, type BeamDecl, type FallSpray, type MistCard } from './geometry.ts';

/**
 * The EffectsSystem's init-time layout (S4 W3-E) — one pure function of the world records, shared by the
 * system and `tools/check/effects.ts` (the check evaluates exactly the emitters the renderer draws):
 * declared emitters, the beacon lights' fires and smoke, the falls' ribbons, spray and mist columns, mist
 * cards, beams, and per puff emitter the few spill sources that can reach it.
 */

/** inputs: the landmarks' world-space effect records (landmarks/world.ts) and their lights (beacons) */
export interface EffectsInput {
  emitters: EmitterRecord[];
  falls: FallRecord[];
  lights: LightRecord[];
  /** landmark pools (the plunge foam of a fall into one floats on its surface) */
  pools?: PoolRecord[];
}

/** what the layout needs of the world: the HeightField, the water surfaces and the ash deck */
export interface EffectsWorld {
  heightAt: (x: number, z: number) => number;
  /** lake / river level at a point (World.waterLevelAt), null = dry */
  waterLevelAt: (x: number, z: number) => number | null;
  deckAt: (x: number, z: number, out: DeckSample) => DeckSample;
}

/** a source of additive points (crater sparks, beacon flames) realized as EmissionSystem dynamic lights */
export interface SparkSource {
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

export interface EffectsLayout {
  puffEmitters: PuffEmitter[];
  /** per puff emitter: indices into `spill` of the sources that can reach it (≤ SPILL_PER_EMITTER) */
  emitterSpill: number[][];
  /** the landmark lights' spill sources (emission/spillSources.ts buildSpillSources) */
  spill: SpillSource[];
  sparkSources: SparkSource[];
  beams: BeamDecl[];
  beamSlots: number[];
  mistCards: MistCard[];
  fallsGeometry: BufferGeometry | null;
  sprays: FallSpray[];
  /** per fall (index = the ribbon's fall index): the key-visibility sample points lip, middle, foot */
  fallRefs: { p: V3; w: number; samples: [V3, V3, V3] }[];
}

/** spill sources one puff emitter keeps (its own: Doom's lava, a beacon's fire — never another landmark's) */
export const SPILL_PER_EMITTER = 4;

/** env.events component of an emitter's channel (−1 = always on) */
export function slotOf(event: string | undefined): number {
  return event === undefined ? -1 : gateCode('event', undefined, event) - GATE.event;
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

/**
 * The spill sources that can light an emitter's puffs: those whose reach overlaps the emitter's bounds
 * (at the strongest wind), the strongest first by J·R²/(d² + R²), at most SPILL_PER_EMITTER. Static: the
 * frame only scales them by their gate and flicker (no camera-focus selection — a plume keeps its own
 * crater's light whatever the camera looks at).
 */
function nearSources(e: PuffEmitter, spill: SpillSource[]): number[] {
  const b: [number, number, number, number] = [0, 0, 0, 0];
  const cand: { i: number; s: number }[] = [];
  // the bounds at the strongest wind, in each of four directions (a conservative union)
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    puffBounds(e, { dx, dz, s: 2.5 }, b);
    for (const [i, s] of spill.entries()) {
      const d = Math.hypot(s.p[0] - b[0], s.p[1] - b[1], s.p[2] - b[2]);
      if (d >= s.R + b[3]) continue;
      const dc = Math.hypot(s.p[0] - e.p[0], s.p[1] - e.p[1], s.p[2] - e.p[2]);
      const sc = (s.J * s.R * s.R) / (dc * dc + s.R * s.R);
      const prev = cand.find((c) => c.i === i);
      if (prev) prev.s = Math.max(prev.s, sc);
      else cand.push({ i, s: sc });
    }
  }
  cand.sort((a, c) => c.s - a.s || a.i - c.i);
  return cand.slice(0, SPILL_PER_EMITTER).map((c) => c.i);
}

/** Build the effects' layout from the world records (pure; three's BufferGeometry for the falls only). */
export function buildEffects(input: EffectsInput, w: EffectsWorld): EffectsLayout {
  const deck: DeckSample = { cover: 0, r: 0, g: 0, b: 0, height: 0, topOpacity: 0 };
  const deckAt = (x: number, z: number) => w.deckAt(x, z, deck);
  const puffEmitters: PuffEmitter[] = [];
  const sparkSources: SparkSource[] = [];
  const beams: BeamDecl[] = [];
  const beamSlots: number[] = [];
  const mistCards: MistCard[] = [];

  // ---- declared emitters
  for (const r of input.emitters) {
    switch (r.preset) {
      case 'smoke':
      case 'ash':
      case 'steam': {
        deckAt(r.p[0], r.p[2]);
        puffEmitters.push(makePuffEmitter({ landmark: r.landmark, preset: r.preset, p: r.p, ...(r.to ? { to: r.to } : {}), rate: r.rate, scale: r.scale, ...(r.color ? { color: r.color } : {}), slot: slotOf(r.event), seed: r.seed, cover: deck.cover, deckY: deck.height }));
        break;
      }
      case 'mist':
        mistCards.push({ at: r.p, ...(r.to ? { to: r.to } : {}), halfWidth: r.scale, opacity: r.rate, tint: r.color ?? [0.86, 0.89, 0.93], seed: r.seed });
        break;
      case 'beam': {
        const to: V3 = r.to ?? [r.p[0], r.p[1] + 25, r.p[2]];
        const c = r.color ?? BEAM.color;
        const k = BEAM.radiance * r.rate;
        const ev = r.event ?? 'morgul-beam';
        beams.push({ from: r.p, to, color: [c[0] * k, c[1] * k, c[2] * k], glow: BEAM.glow * r.scale, core: BEAM.core * r.scale, gate: gateCode('event', undefined, ev) });
        beamSlots.push(slotOf(ev));
        break;
      }
      case 'sparks':
        sparkSources.push({ landmark: r.landmark, mode: 'sparks', p: r.p, scale: r.scale, count: Math.max(3, Math.round(SPARKS.count * r.rate)), slot: slotOf(r.event), seed: r.seed, kind: 'lava', gate: r.event ? 'event' : 'always', ...(r.event ? { event: r.event } : {}), color: r.color ?? [1, 0.36, 0.08] });
        break;
      case 'embers':
        sparkSources.push({ landmark: r.landmark, mode: 'embers', p: r.p, scale: r.scale, count: Math.max(3, Math.round((EMBERS.flames + EMBERS.sparks) * r.rate)), slot: slotOf(r.event), seed: r.seed, kind: 'fire', gate: r.event ? 'event' : 'dusk', ...(r.event ? { event: r.event } : {}), color: r.color ?? [1, 0.45, 0.12] });
        break;
    }
  }
  // ---- beacon lights: a fire (embers) and a smoke column, switched with the light's channel; the smoke is
  // born a little above the fire (the flame sprites stay clear of it) and fades in as it rises
  for (const [i, l] of input.lights.entries()) {
    if (l.kind !== 'beacon') continue;
    const ev = l.event ?? 'beacons';
    const s = derivedSeed(l.seed, i);
    deckAt(l.p[0], l.p[2]);
    puffEmitters.push(makePuffEmitter({ landmark: l.landmark, preset: 'smoke', p: [l.p[0], l.p[1] + 0.1, l.p[2]], rate: 0.8, scale: 0.32, color: [0.13, 0.12, 0.11], slot: slotOf(ev), seed: s, cover: deck.cover, deckY: deck.height }));
    sparkSources.push({ landmark: l.landmark, mode: 'embers', p: l.p, scale: 1, count: EMBERS.flames + EMBERS.sparks, slot: slotOf(ev), seed: s ^ 0x2545f491, kind: 'beacon', gate: 'event', event: ev, color: [1, 0.55, 0.2] });
  }
  // ---- falls: ribbons + foam (static), spray and a wide fall's mist column (puffs)
  const pools = input.pools ?? [];
  const waterAt = (x: number, z: number): number | null => {
    let lv: number | null = w.waterLevelAt(x, z);
    for (const p of pools) if (p.level > (lv ?? -1e9) && inRing(p.ring, x, z)) lv = p.level;
    return lv;
  };
  const falls = buildFalls(input.falls, w.heightAt, waterAt);
  for (const sp of falls.sprays) {
    deckAt(sp.p[0], sp.p[2]);
    puffEmitters.push(makePuffEmitter({ landmark: sp.landmark, preset: 'spray', p: sp.p, out: sp.out, rate: 1, scale: sp.scale, slot: -1, seed: sp.seed, cover: deck.cover, deckY: deck.height }));
    if (sp.column > 0) puffEmitters.push(makePuffEmitter({ landmark: sp.landmark, preset: 'steam', p: sp.p, rate: 0.55, scale: sp.column, color: [0.72, 0.74, 0.77], slot: -1, seed: derivedSeed(sp.seed, 7), cover: deck.cover, deckY: deck.height }));
  }
  const fallRefs = input.falls
    .filter((f) => f.path.length >= 2 && f.width > 0)
    .map((f) => {
      const lip = f.path[0];
      const foot = f.path[f.path.length - 1];
      const mid: V3 = f.path.length === 2 ? [(lip[0] + foot[0]) / 2, (lip[1] + foot[1]) / 2, (lip[2] + foot[2]) / 2] : f.path[Math.floor((f.path.length - 1) / 2)];
      return { p: foot, w: f.width, samples: [lip, mid, foot] as [V3, V3, V3] };
    });

  const spill = buildSpillSources(input.lights);
  const emitterSpill = puffEmitters.map((e) => nearSources(e, spill));
  return { puffEmitters, emitterSpill, spill, sparkSources, beams, beamSlots, mistCards, fallsGeometry: falls.geometry, sprays: falls.sprays, fallRefs };
}

/**
 * Key-light visibility of a point over the HeightField (0 shadowed … 1 lit): a march toward the key
 * (geometric steps out to ≈ 19 km) keeping the steepest terrain rise over the ray, with a soft penumbra.
 * Pure (heights, point, key direction): smoke, spray, curtains and mist in a gorge's shade take no sun.
 */
export function keyVisibility(heightAt: (x: number, z: number) => number, x: number, y: number, z: number, kx: number, ky: number, kz: number): number {
  if (ky < -0.02) return 0;
  let occ = -1;
  let t = 0.06;
  for (let i = 0; i < 14; i++) {
    const h = heightAt(x + kx * t, z + kz * t);
    occ = Math.max(occ, (h - (y + ky * t)) / t);
    t *= 1.55;
  }
  const s = Math.min(1, Math.max(0, (occ + 0.012) / 0.05));
  return 1 - s * s * (3 - 2 * s);
}
