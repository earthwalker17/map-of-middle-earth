import { Color } from 'three/webgpu';
import { rand } from '../core/rng.ts';
import type { LightGate, LightKind, LightRecord } from '../landmarks/records.ts';

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
const DEFAULT_FLICKER: Partial<Record<LightKind, number>> = { fire: 0.28, lava: 0.12, beacon: 0.25, magic: 0.08, eye: 0.06 };

/** kinds whose sprites gain brightness with distance, so a town's windows sum into a visible cluster */
const WIDE_GAIN = new Set<LightKind>(['window', 'lamp', 'fire']);

/**
 * Shader gate codes (emissionMaterial.ts):
 *  0 night (windows, lamps)  1 night-dim (ithildin)  2 dusk (fires)  3 always  4 event (off in S3)
 */
export function gateCode(kind: LightKind, gate: LightGate): number {
  switch (gate) {
    case 'night':
      return kind === 'ithildin' ? 1 : 0;
    case 'dusk':
      return 2;
    case 'always':
      return 3;
    case 'event':
      return 4;
  }
}

/** Is the record's colour "plain" (white / grey) → use the kind default. */
function isPlain(c: [number, number, number]): boolean {
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  return mx <= 0 || (mx - mn) / mx < 0.02;
}

const _c = new Color();

/** Floats per instance in each of the three instance buffers. */
export const EMISSION_STRIDE = 4;

/**
 * Pack one record into the three instance vectors (pos+radius, HDR colour+flicker, gate/ω/φ).
 * Returns false when the light never shows (zero intensity).
 */
export function packLight(r: LightRecord, pos: Float32Array, col: Float32Array, aux: Float32Array, o: number): boolean {
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
  aux[o] = gateCode(r.kind, r.gate) + (WIDE_GAIN.has(r.kind) ? 8 : 0);
  // flicker: two incommensurate angular rates (rad / effect-second) and a phase, per light
  const fast = r.kind === 'fire' || r.kind === 'beacon' ? 1 : 0.35;
  aux[o + 1] = (5.1 + 4.3 * rand(s, 'w', 1)) * fast;
  aux[o + 2] = (1.7 + 2.9 * rand(s, 'w', 2)) * fast;
  aux[o + 3] = rand(s, 'phi', 0) * Math.PI * 2;
  return true;
}
