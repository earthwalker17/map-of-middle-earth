import type { Vector4 } from 'three/webgpu';
import type { LightGate, LightKind } from '../landmarks/records.ts';
import { tsl, type TslNode } from './tsl.ts';
import { env } from './environment.ts';

type N = TslNode;
const { abs, clamp, float, max, select, smoothstep } = tsl;

/**
 * Light gates (S4 W2-D) — ONE table and ONE formula for every emitter: the emission sprites
 * (emissionMaterial.ts, per instance), the glow family (families.ts, per fragment) and the spill
 * selection on the CPU (EmissionSystem → gateCPU). A gate is a pure function of the env uniforms
 * (night / twilight / golden, written by the EnvironmentSystem from the sun) and of the timeline's
 * event channels (env.events ← SceneState.events):
 *
 *  - night     windows, lamps: smoothstep(0.2, 0.7, night) + 0.4·twilight (clamped) — ramp in through
 *              blue hour, off by day and in golden hour
 *  - nightDim  ithildin sparks: smoothstep(0.35, 0.95, night) — awake only in deep night
 *  - dusk      fires: 0.25 + 0.75·max(night, golden) — dim by day, full from golden hour
 *  - always    lava, the Eye, Morgul magic: 1
 *  - event     beacons, signals: the value (0..1) of the light's SceneState.events channel
 *
 * Codes (float-encoded in the vertex / instance data): 0 night · 1 nightDim · 2 dusk · 3 always ·
 * 4 + slot event (slot = the channel's component of env.events, EVENT_SLOT).
 */
export const GATE = { night: 0, nightDim: 1, dusk: 2, always: 3, event: 4 } as const;

/** number of event channels (components of env.events) */
export const EVENT_SLOTS = 4;

/**
 * SceneState.events channel → component of env.events (x, y, z, w). Two named channels, two spare
 * (unknown channels are a `pnpm check` error — tools/check/gates.ts).
 */
export const EVENT_SLOT: Readonly<Record<string, number>> = { beacons: 0, 'morgul-beam': 1 };

/** the channel an event-gated light listens to when its record names none */
export const DEFAULT_EVENT: Partial<Record<LightKind, string>> = { beacon: 'beacons', magic: 'morgul-beam' };

/** largest code (event slot EVENT_SLOTS − 1) */
export const GATE_CODE_MAX = GATE.event + EVENT_SLOTS - 1;

/** Event slot of a channel name (−1 = unknown). */
export function eventSlot(channel: string | undefined): number {
  return channel !== undefined && channel in EVENT_SLOT ? EVENT_SLOT[channel] : -1;
}

/**
 * Gate code of a light. `kind` only refines the night gate (ithildin wakes in deep night only); the
 * glow family passes no kind (its ithildin skins keep the plain night gate). An event gate with an
 * unknown channel listens to the last spare slot, which nothing writes (always off).
 */
export function gateCode(gate: LightGate, kind?: LightKind, event?: string): number {
  switch (gate) {
    case 'night':
      return kind === 'ithildin' ? GATE.nightDim : GATE.night;
    case 'dusk':
      return GATE.dusk;
    case 'always':
      return GATE.always;
    case 'event': {
      const s = eventSlot(event ?? (kind ? DEFAULT_EVENT[kind] : undefined));
      return GATE.event + (s >= 0 ? s : EVENT_SLOTS - 1);
    }
  }
}

/**
 * The gate as a TSL node of a float `code` (exact small integers, or within ±0.5 of one) and the
 * event channels (vec4, default env.events). The select chain returns each gate's value exactly
 * (the S3 sprite and glow formulas, unchanged).
 */
export function gateNode(code: N, events: N = env.events): N {
  const isCode = (k: number): N => abs(code.sub(k)).lessThan(0.5);
  const night = clamp(smoothstep(0.2, 0.7, env.night).add(env.twilight.mul(0.4)), 0, 1);
  const dim = smoothstep(0.35, 0.95, env.night);
  const dusk = float(0.25).add(max(env.night, env.golden).mul(0.75));
  const ev = select(code.lessThan(GATE.event + 0.5), events.x, select(code.lessThan(GATE.event + 1.5), events.y, select(code.lessThan(GATE.event + 2.5), events.z, events.w)));
  const event = select(code.greaterThan(GATE.event - 0.5), clamp(ev, 0, 1), float(0));
  return select(isCode(GATE.night), night, select(isCode(GATE.nightDim), dim, select(isCode(GATE.dusk), dusk, select(isCode(GATE.always), float(1), event))));
}

/** The env values a gate reads (EnvironmentSystem writes them before the emission system evaluates). */
export interface GateEnv {
  night: number;
  twilight: number;
  golden: number;
  /** env.events components (EVENT_SLOTS) */
  events: ArrayLike<number>;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** CPU mirror of `gateNode` (the same formula, for the spill selection and the checks). */
export function gateCPU(code: number, e: GateEnv): number {
  const c = Math.round(code);
  if (c === GATE.night) return Math.min(1, Math.max(0, smooth(0.2, 0.7, e.night) + 0.4 * e.twilight));
  if (c === GATE.nightDim) return smooth(0.35, 0.95, e.night);
  if (c === GATE.dusk) return 0.25 + 0.75 * Math.max(e.night, e.golden);
  if (c === GATE.always) return 1;
  if (c >= GATE.event && c <= GATE_CODE_MAX) return Math.min(1, Math.max(0, e.events[c - GATE.event] ?? 0));
  return 0;
}

/** env.events from SceneState.events (unknown channels are ignored; missing ones are 0). */
export function writeEvents(events: Readonly<Record<string, number>> | undefined, out: Vector4): Vector4 {
  const v = [0, 0, 0, 0];
  for (const [k, x] of Object.entries(events ?? {})) {
    const s = eventSlot(k);
    if (s >= 0 && Number.isFinite(x)) v[s] = x;
  }
  return out.set(v[0], v[1], v[2], v[3]);
}
