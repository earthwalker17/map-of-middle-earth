import { Color } from 'three/webgpu';
import { rand } from '../core/rng.ts';
import type { LightKind, LightRecord } from '../landmarks/records.ts';
import { gateCPU, type GateEnv } from '../materials/gates.ts';
import { DEFAULT_COLOR, DEFAULT_FLICKER, HDR_PER_INTENSITY, MAX_INTENSITY, MAX_RADIUS_KM, aggregates, gateCode, groupKey } from './lightKinds.ts';
import { SPILL_MAX, spillArrays } from './spill.ts';

/**
 * Spill sources (CPU side of spill.ts): which lights throw light onto their surroundings, how strong,
 * how far — and the per-frame selection of the few that are uploaded (a pure function of the frame:
 * camera focus, gates from the env values, the effect clock for flicker).
 *
 *  - Strong single lights spill on their own, with a per-kind reach (`spillKm`, overridable per record;
 *    0 = no spill): lava 6 km, the Eye 4, magic 2, beacons 2, fires 0.8, ithildin 0.4.
 *  - Windows and lamps spill through their settlement aggregates (one source per landmark | gate | wide
 *    class at the energy-weighted centroid, reach max(1 km, group radius)).
 *  - `sprite: false` records are spill-only sources (no emission sprite): e.g. the Morgul wall wash.
 *
 * Power: a record's radiant intensity J = SPILL_GAIN[kind] · HDR_PER_INTENSITY · intensity · r² (the
 * sprite's energy, r = its radius clamped to [SPILL_R_MIN, the kind's cap]), coloured by the record's
 * colour (luminance 1). The uploaded near-field irradiance is c = J / r0², with the core radius
 * r0 = max(2 r, R / 10) (aggregates: max(0.5 · group radius, 0.2 km)).
 */
export interface SpillSource {
  /** merge key of singles: landmark | kind | gate | reach */
  key: string;
  p: [number, number, number];
  /** reach, km */
  R: number;
  /** core radius, km */
  r0: number;
  /** linear colour, luminance 1 */
  color: [number, number, number];
  /** radiant intensity (irradiance · km²) */
  J: number;
  /** gate code (materials/gates.ts) */
  gate: number;
  kind: LightKind;
  /** flicker: depth, ω₁, ω₂, φ (the sprite's, emissionMaterial.ts) */
  flicker: [number, number, number, number];
  halo: number;
  glint: number;
}

/**
 * default reach by kind (km); windows spill through their aggregates (max(1, group radius)); street and
 * elven lamps are singles with a short reach (pools of light on the walls and the ground round them)
 */
export const SPILL_KM: Record<LightKind, number> = { lava: 6, eye: 4, magic: 2, beacon: 2, fire: 0.8, ithildin: 0.4, lamp: 0.35, window: 0 };

/** spill gain by kind on the sprite energy (tuned on the s4-d shots) */
export const SPILL_GAIN: Record<LightKind, number> = { lava: 150, eye: 20, magic: 20, beacon: 15, fire: 8, ithildin: 1, window: 6, lamp: 5 };

/** smallest radius entering the power (km): tiny fire sprites still light their tower */
const SPILL_R_MIN: Partial<Record<LightKind, number>> = { fire: 0.04, beacon: 0.08, lamp: 0.02 };

/** halo gain by kind (spill.ts spillInScatter): lava, the Eye, magic and beacons glow in the air; the ithildin faintly (S4.5) */
export const HALO_GAIN: Record<LightKind, number> = { lava: 0.3, eye: 0.15, magic: 1, beacon: 1, fire: 0, ithildin: 0.3, window: 0, lamp: 0 };

/** glint gain by kind (spill.ts spillGlint on water) */
export const GLINT_GAIN: Record<LightKind, number> = { lava: 1, eye: 1, magic: 1.5, beacon: 1.5, fire: 3, ithildin: 1, window: 4, lamp: 4 };

/** preview uploads fewer sources (the explorer's per-fragment cost) */
export const SPILL_PREVIEW = 4;

const _c = new Color();

function isPlain(c: [number, number, number]): boolean {
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  return mx <= 0 || (mx - mn) / mx < 0.02;
}

/** linear colour with luminance 1 (the record's, or its kind's default for plain white / grey) */
function unitColor(r: LightRecord): [number, number, number] {
  let [cr, cg, cb] = r.color;
  if (isPlain(r.color)) {
    _c.setHex(DEFAULT_COLOR[r.kind]);
    cr = _c.r;
    cg = _c.g;
    cb = _c.b;
  }
  const lum = Math.max(1e-4, 0.2126 * cr + 0.7152 * cg + 0.0722 * cb);
  return [cr / lum, cg / lum, cb / lum];
}

function flickerOf(r: LightRecord): [number, number, number, number] {
  const s = r.seed >>> 0;
  const depth = Math.min(1, Math.max(0, r.flicker > 0 ? r.flicker : (DEFAULT_FLICKER[r.kind] ?? 0)));
  const fast = r.kind === 'fire' || r.kind === 'beacon' ? 1 : 0.35;
  return [depth, (5.1 + 4.3 * rand(s, 'w', 1)) * fast, (1.7 + 2.9 * rand(s, 'w', 2)) * fast, rand(s, 'phi', 0) * Math.PI * 2];
}

/**
 * Emitter radius of a record (km): the sprite's radius (clamped to the kind's cap); a spill-only source
 * (sprite: false) has no sprite to keep sane — its radius is the size of the glowing area it stands for.
 */
function radiusOf(r: LightRecord): number {
  const lo = SPILL_R_MIN[r.kind] ?? 0.005;
  return r.sprite === false ? Math.max(r.radiusKm, lo) : Math.min(Math.max(r.radiusKm, lo), MAX_RADIUS_KM[r.kind]);
}

/** radiant intensity of one record (before its colour) */
function powerOf(r: LightRecord): number {
  const I = Math.min(MAX_INTENSITY, Math.max(0, r.intensity));
  const rr = radiusOf(r);
  return SPILL_GAIN[r.kind] * HDR_PER_INTENSITY * I * rr * rr;
}

/**
 * The lit pall over a crater: the ash and fume above it glow red and light the slopes round it from
 * above (a light at the crater's rim only grazes a cone's flanks). A lava record whose emitter radius is
 * ≥ PALL.minRadius (a crater — not the small lights of a flow or a door) gets a spill-only companion
 * `lift`·R above it, reach `reach`·R, core `core`·R, power `power`·J and a faint halo of its own
 * (`halo` × the lava halo gain: the glow rises from the crater toward the ash above it); no glint.
 * Palls of one landmark merge (key landmark|lava-pall).
 */
const PALL = { minRadius: 0.4, lift: 0.5, reach: 2.2, core: 0.5, power: 2.5, halo: 0.5 };

/** singles of one landmark, kind, gate and reach closer than this × the reach merge into one source */
const MERGE_K = 0.25;

/**
 * Add a single source, merged into an earlier one of the same key within MERGE_K · R (energy-weighted
 * centroid and colour, summed power, the core widened to the spread): a lamp room's four lamps, the Eye's
 * two sparks or a wall of fires spill as one source and leave the other slots to other lights.
 */
function mergeOrPush(out: SpillSource[], s: SpillSource): void {
  const lim = MERGE_K * s.R;
  for (const o of out) {
    if (o.key !== s.key) continue;
    const d = Math.hypot(o.p[0] - s.p[0], o.p[1] - s.p[1], o.p[2] - s.p[2]);
    if (d > lim) continue;
    const J = o.J + s.J;
    const a = o.J / J;
    const b = s.J / J;
    for (let k = 0; k < 3; k++) {
      o.p[k] = o.p[k] * a + s.p[k] * b;
      o.color[k] = o.color[k] * a + s.color[k] * b;
    }
    o.r0 = Math.max(o.r0, s.r0, d * 0.5);
    o.J = J;
    // a merged group's flicker averages out
    o.flicker = [o.flicker[0] * 0.5, o.flicker[1], o.flicker[2], o.flicker[3]];
    return;
  }
  out.push(s);
}

/** The static spill sources of the landmark lights (order: singles in record order, then aggregates). */
export function buildSpillSources(records: LightRecord[]): SpillSource[] {
  const out: SpillSource[] = [];
  const groups = new Map<string, LightRecord[]>();
  const keys: string[] = [];
  for (const r of records) {
    const J = powerOf(r);
    if (J <= 0) continue;
    const explicit = r.spillKm;
    if (explicit === 0) continue;
    if (explicit === undefined && aggregates(r) && SPILL_KM[r.kind] === 0) {
      // windows / lamps: through their settlement aggregate
      const key = groupKey(r);
      let g = groups.get(key);
      if (!g) {
        g = [];
        groups.set(key, g);
        keys.push(key);
      }
      g.push(r);
      continue;
    }
    const R = explicit ?? SPILL_KM[r.kind];
    if (!(R > 0)) continue;
    const rr = radiusOf(r);
    const src: SpillSource = {
      key: `${r.landmark}|${r.kind}|${gateCode(r)}|${R}`,
      p: [r.p[0], r.p[1], r.p[2]],
      R,
      r0: Math.max(2 * rr, R / 10),
      color: unitColor(r),
      J,
      gate: gateCode(r),
      kind: r.kind,
      flicker: flickerOf(r),
      halo: HALO_GAIN[r.kind],
      glint: GLINT_GAIN[r.kind],
    };
    if (r.kind === 'lava' && rr >= PALL.minRadius) {
      const pall: SpillSource = {
        key: `${r.landmark}|lava-pall`,
        p: [r.p[0], r.p[1] + PALL.lift * R, r.p[2]],
        R: PALL.reach * R,
        r0: PALL.core * R,
        color: [src.color[0], src.color[1], src.color[2]],
        J: PALL.power * J,
        gate: src.gate,
        kind: 'lava',
        flicker: [src.flicker[0], src.flicker[1], src.flicker[2], src.flicker[3]],
        halo: PALL.halo * HALO_GAIN.lava,
        glint: 0,
      };
      mergeOrPush(out, src);
      mergeOrPush(out, pall);
    } else mergeOrPush(out, src);
  }
  for (const key of keys) {
    const g = groups.get(key)!;
    let J = 0;
    const p = [0, 0, 0];
    const col = [0, 0, 0];
    for (const r of g) {
      const j = powerOf(r);
      const c = unitColor(r);
      J += j;
      for (let k = 0; k < 3; k++) {
        p[k] += r.p[k] * j;
        col[k] += c[k] * j;
      }
    }
    if (J <= 0) continue;
    for (let k = 0; k < 3; k++) {
      p[k] /= J;
      col[k] /= J;
    }
    let gr = 0;
    for (const r of g) gr = Math.max(gr, Math.hypot(r.p[0] - p[0], r.p[1] - p[1], r.p[2] - p[2]));
    const first = g[0];
    out.push({
      key,
      p: [p[0], p[1], p[2]],
      R: Math.max(1, gr),
      r0: Math.max(0.5 * gr, 0.2),
      color: [col[0], col[1], col[2]],
      J,
      gate: gateCode(first),
      kind: first.kind,
      // many lights average out their flicker
      flicker: g.length > 3 ? [0, 0, 0, 0] : flickerOf(first),
      halo: HALO_GAIN[first.kind],
      glint: GLINT_GAIN[first.kind],
    });
  }
  return out;
}

export interface SpillFrame {
  /** camera focus (SceneState camera target), world km */
  focus: [number, number, number];
  /** camera → focus distance, km (halos fade out for whole-table views) */
  focusDist: number;
  gate: GateEnv;
  /** effect clock (env.tFx) */
  tFx: number;
  /** sources to upload (≤ SPILL_MAX) */
  n: number;
  /** halos on (review / final) */
  halos: boolean;
}

/** halos fade out for wide views (focus distance, km): whole-table shots stay a clean model */
const HALO_FOCUS_KM: [number, number] = [150, 420];

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** scratch for the selection (no per-frame allocation once warmed) */
const _score: number[] = [];
const _idx: number[] = [];
const _gate: number[] = [];
/** order of the candidates: score descending, ties by index (deterministic) */
const byScore = (a: number, b: number): number => _score[b] - _score[a] || a - b;

/**
 * How much of a source's spill can reach the frame: the visible ground round the focus spans about
 * FOCUS_SPAN × the focus distance; a source whose reach ends short of it lights nothing on screen and
 * keeps no slot for its spill (its halo, seen from afar, still counts — scaled by its halo gain).
 */
const FOCUS_SPAN = 0.5;

/**
 * Select and upload the frame's sources: score s = J · gate · R² / (d² + R²) · max(reach, halo)
 * (d = source → focus; reach = 1 − (max(0, d − FOCUS_SPAN · focusDist) / R)², clamped: 0 when the
 * source's light cannot reach the ground in view; halo = its halo gain when halos are on), the top n
 * (ties by index), each weighted w = clamp((s − s₍ₙ₊₁₎) / (0.25 s), 0, 1) so a source fades out before it
 * is replaced (no pop). Writes spill.ts's arrays (spillArrays()); returns the number of sources uploaded.
 */
export function selectSpill(sources: SpillSource[], f: SpillFrame): number {
  const { pos, col, aux } = spillArrays();
  _score.length = 0;
  _idx.length = 0;
  _gate.length = 0;
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const g = gateCPU(s.gate, f.gate);
    _gate.push(g);
    if (g <= 0) {
      _score.push(0);
      continue;
    }
    const dx = s.p[0] - f.focus[0];
    const dy = s.p[1] - f.focus[1];
    const dz = s.p[2] - f.focus[2];
    const R2 = s.R * s.R;
    const d2 = dx * dx + dy * dy + dz * dz;
    const beyond = Math.max(0, Math.sqrt(d2) - FOCUS_SPAN * f.focusDist) / s.R;
    const reach = Math.max(0, 1 - beyond * beyond);
    const sc = ((s.J * g * R2) / (d2 + R2)) * Math.max(reach, f.halos ? s.halo : 0);
    _score.push(sc);
    if (sc > 0) _idx.push(i);
  }
  _idx.sort(byScore);
  const n = Math.min(f.n, SPILL_MAX, _idx.length);
  const next = _idx.length > n ? _score[_idx[n]] : 0;
  const haloW = f.halos ? 1 - smooth(HALO_FOCUS_KM[0], HALO_FOCUS_KM[1], f.focusDist) : 0;
  let k = 0;
  for (let j = 0; j < n; j++) {
    const i = _idx[j];
    const s = sources[i];
    const sc = _score[i];
    const w = Math.min(1, Math.max(0, (sc - next) / (0.25 * sc)));
    if (w <= 0) continue;
    const [depth, w1, w2, phi] = s.flicker;
    const flick = depth > 0 ? Math.max(0, 1 + depth * Math.sin(f.tFx * w1 + phi) * Math.sin(f.tFx * w2 + phi * 1.7 + 1.3)) : 1;
    const e = (s.J / (s.r0 * s.r0)) * _gate[i] * w * flick;
    pos[k].set(s.p[0], s.p[1], s.p[2], s.R);
    col[k].set(s.color[0] * e, s.color[1] * e, s.color[2] * e, s.r0);
    aux[k].set(s.halo * haloW, s.glint, 0, 0);
    k++;
  }
  for (let j = k; j < SPILL_MAX; j++) {
    pos[j].set(0, -1e4, 0, 0);
    col[j].set(0, 0, 0, 1);
    aux[j].set(0, 0, 0, 0);
  }
  return k;
}
