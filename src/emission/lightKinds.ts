import { Color } from 'three/webgpu';
import { rand } from '../core/rng.ts';
import type { LightKind, LightRecord } from '../landmarks/records.ts';
import { gateCode as gateCodeOf } from '../materials/gates.ts';

/**
 * Per-kind emission rules (CPU side of EmissionSystem): default colours, physical size caps,
 * flicker defaults and the HDR scale. Everything here is static per record; the
 * time-of-day gates and flicker run in the shader (emissionMaterial.ts).
 *
 * Intensity semantics: `intensity` 1 is a lit window. The sprite's surface radiance is
 * HDR_PER_INTENSITY · intensity · colour (colour normalised to luminance 1), so a resolved light
 * peaks at 2× that in the HDR target — above the bloom threshold (2.2) at night for any
 * intensity ≥ ~0.6.
 */
export const HDR_PER_INTENSITY = 2.2;

/** intensity cap (S1-era declarations used ranges like 20–30 as light "strength") */
export const MAX_INTENSITY = 12;

/** sRGB defaults by kind (used when a record's colour is plain white / grey) */
export const DEFAULT_COLOR: Record<LightKind, number> = {
  window: 0xffb060,
  lamp: 0xdfe8ff,
  fire: 0xff9a3c,
  lava: 0xff5a1a,
  eye: 0xfcad4d,
  beacon: 0xffb45a,
  magic: 0x9cf0b4,
  ithildin: 0xdff3ff,
};

/**
 * Physical radius caps (km). `radiusKm` is the size of the glowing source; S1 declarations used it
 * as a light *range* (the Eye 40 km, lava 30 km) which would draw a sprite covering the frame.
 */
export const MAX_RADIUS_KM: Record<LightKind, number> = {
  window: 0.08,
  lamp: 0.12,
  fire: 0.4,
  lava: 0.6,
  eye: 0.5,
  beacon: 0.5,
  magic: 0.8,
  ithildin: 0.05,
};

/** default flicker depth when a record leaves it at 0 (fires breathe, lamps and windows are steady) */
export const DEFAULT_FLICKER: Partial<Record<LightKind, number>> = { fire: 0.28, lava: 0.12, beacon: 0.25, magic: 0.08, eye: 0.06 };

/**
 * Wide-shot gain cap by kind (0 = no gain): the sprites of these kinds gain brightness with distance,
 * so a town's windows sum into a visible cluster. Elven lamps are capped lower (a tight blue-white
 * spark, not a smudge over the whole wood).
 */
export const WIDE_CAP: Record<LightKind, number> = { window: 6, lamp: 3, fire: 6, lava: 6, eye: 6, beacon: 0, magic: 0, ithildin: 0 };

/**
 * Focal kinds (Mount Doom's lava, the Eye): their gain only starts far out (emissionMaterial.ts
 * FOCAL_KM), so hero shots keep their tuned glow while overviews keep Mordor's ember as a focal point.
 */
const FOCAL: Partial<Record<LightKind, true>> = { lava: true, eye: true };

/** wide-gain class packed into the shader (0 none, 1 cap 6, 2 cap 3, 3 focal: cap 6 from FOCAL_KM) */
function wideClass(kind: LightKind): number {
  const c = WIDE_CAP[kind];
  return c <= 0 ? 0 : FOCAL[kind] ? 3 : c > 4.5 ? 1 : 2;
}

/**
 * Soft halo by kind: [share of the energy, width in core σ]. Windows, lamps, fires and the Eye scatter a
 * quarter of their light into a 3.5× wider glow; the lava pool keeps a tight core with a faint, narrow
 * halo (a crater glow, never an orb floating over the summit).
 */
export const HALO: Record<LightKind, [number, number]> = {
  window: [0.25, 3.5],
  lamp: [0.25, 3.5],
  fire: [0.25, 3.5],
  lava: [0.1, 2],
  eye: [0.25, 3.5],
  beacon: [0.25, 3.5],
  magic: [0.2, 3],
  ithildin: [0.2, 3],
};

/** Group roles (emGrp.y): 0 standalone · 1 member of a settlement group · 2 the group's aggregate sprite. */
export const ROLE = { single: 0, member: 1, aggregate: 2 } as const;

/**
 * Shader gate code of a record (materials/gates.ts: 0 night · 1 nightDim (ithildin) · 2 dusk ·
 * 3 always · 4 + slot event, by the record's `event` channel or its kind's default).
 */
export function gateCode(r: Pick<LightRecord, 'kind' | 'gate' | 'event'>): number {
  return gateCodeOf(r.gate, r.kind, r.event);
}

/** Is the record's colour "plain" (white / grey) → use the kind default. */
function isPlain(c: [number, number, number]): boolean {
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  return mx <= 0 || (mx - mn) / mx < 0.02;
}

const _c = new Color();

/** Floats per instance in each of the four instance buffers. */
export const EMISSION_STRIDE = 4;

/** The four instance buffers of the sprite draw (see emissionMaterial.ts). */
export interface EmissionArrays {
  pos: Float32Array;
  col: Float32Array;
  aux: Float32Array;
  grp: Float32Array;
}

/** Does this record take part in settlement aggregation (a wide-gain kind that can ever be lit)? */
export function aggregates(r: LightRecord): boolean {
  return WIDE_CAP[r.kind] > 0 && r.intensity > 0;
}

/** Group key of an aggregating record: one aggregate per landmark and gate. */
export function groupKey(r: LightRecord): string {
  return `${r.landmark}|${gateCode(r)}|${wideClass(r.kind)}`;
}

/**
 * Pack one record into the four instance vectors (pos+radius, HDR colour+flicker, gate/ω/φ, group).
 * Returns false when the light never shows (zero intensity). `group` = [group radius km, role].
 */
export function packLight(r: LightRecord, a: EmissionArrays, o: number, group: [number, number] = [0, ROLE.single]): boolean {
  const { pos, col, aux, grp } = a;
  const s = r.seed >>> 0;
  // (the static lit fraction of windows is decided where they are recorded: kit `windows` keeps a
  // stable `on` share of its slots — default 0.7 — and records nothing for the unlit ones; a declared
  // single light is always lit)
  const intensity = Math.min(MAX_INTENSITY, Math.max(0, r.intensity));
  if (intensity <= 0) return false;
  // colour: the record's, or the kind default for plain white / grey, normalised to luminance 1
  let [cr, cg, cb] = r.color;
  if (isPlain(r.color)) {
    _c.setHex(DEFAULT_COLOR[r.kind]); // linear under ColorManagement
    cr = _c.r;
    cg = _c.g;
    cb = _c.b;
  }
  const lum = Math.max(1e-4, 0.2126 * cr + 0.7152 * cg + 0.0722 * cb);
  // per-light brightness variation (windows differ; lamps a little)
  const vary = r.kind === 'window' ? 0.7 + 0.6 * rand(s, 'vary', 0) : r.kind === 'lamp' ? 0.85 + 0.3 * rand(s, 'vary', 0) : 1;
  const k = (HDR_PER_INTENSITY * intensity * vary) / lum;
  pos[o] = r.p[0];
  pos[o + 1] = r.p[1];
  pos[o + 2] = r.p[2];
  pos[o + 3] = Math.min(Math.max(r.radiusKm, 0.005), MAX_RADIUS_KM[r.kind]);
  col[o] = cr * k;
  col[o + 1] = cg * k;
  col[o + 2] = cb * k;
  col[o + 3] = Math.min(1, Math.max(0, r.flicker > 0 ? r.flicker : (DEFAULT_FLICKER[r.kind] ?? 0)));
  aux[o] = gateCode(r) + 8 * wideClass(r.kind);
  // flicker: two incommensurate angular rates (rad / effect-second) and a phase, per light
  const fast = r.kind === 'fire' || r.kind === 'beacon' ? 1 : 0.35;
  aux[o + 1] = (5.1 + 4.3 * rand(s, 'w', 1)) * fast;
  aux[o + 2] = (1.7 + 2.9 * rand(s, 'w', 2)) * fast;
  aux[o + 3] = rand(s, 'phi', 0) * Math.PI * 2;
  grp[o] = group[0];
  grp[o + 1] = group[1];
  grp[o + 2] = HALO[r.kind][0];
  grp[o + 3] = HALO[r.kind][1];
  return true;
}

/**
 * The aggregate sprite of a settlement group (packed members at instance offsets `members`, all of one
 * landmark, gate and wide class): one light at the energy-weighted centroid whose energy (HDR luminance ×
 * radius²) is the members' sum, drawn instead of them once the whole group spans only a few pixels
 * (emissionMaterial.ts crossfade), with a visibility floor. Returns the group radius (km, centroid →
 * farthest member edge) written into the members' and the aggregate's `grp.x`.
 */
export function packAggregate(a: EmissionArrays, members: number[], o: number): number {
  const { pos, col, aux, grp } = a;
  let wsum = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const e = [0, 0, 0];
  for (const m of members) {
    const r2 = pos[m + 3] * pos[m + 3];
    const w = (0.2126 * col[m] + 0.7152 * col[m + 1] + 0.0722 * col[m + 2]) * r2;
    wsum += w;
    cx += pos[m] * w;
    cy += pos[m + 1] * w;
    cz += pos[m + 2] * w;
    e[0] += col[m] * r2;
    e[1] += col[m + 1] * r2;
    e[2] += col[m + 2] * r2;
  }
  const inv = 1 / Math.max(wsum, 1e-12);
  cx *= inv;
  cy *= inv;
  cz *= inv;
  let gr = 0;
  for (const m of members) gr = Math.max(gr, Math.hypot(pos[m] - cx, pos[m + 1] - cy, pos[m + 2] - cz) + pos[m + 3]);
  const first = members[0];
  pos[o] = cx;
  pos[o + 1] = cy;
  pos[o + 2] = cz;
  pos[o + 3] = AGGREGATE_RADIUS_KM;
  const k = 1 / (AGGREGATE_RADIUS_KM * AGGREGATE_RADIUS_KM);
  col[o] = e[0] * k;
  col[o + 1] = e[1] * k;
  col[o + 2] = e[2] * k;
  // many lights average out their flicker
  col[o + 3] = members.length > 3 ? 0 : col[first + 3];
  aux[o] = aux[first];
  aux[o + 1] = aux[first + 1];
  aux[o + 2] = aux[first + 2];
  aux[o + 3] = aux[first + 3];
  grp[o] = gr;
  grp[o + 1] = ROLE.aggregate;
  grp[o + 2] = grp[first + 2];
  grp[o + 3] = grp[first + 3];
  for (const m of members) grp[m] = gr;
  return gr;
}

/** physical radius of an aggregate sprite, km (a sub-pixel spark wherever it is drawn) */
const AGGREGATE_RADIUS_KM = 0.1;
