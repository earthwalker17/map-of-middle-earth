import { hash32, rand, valueNoise } from '../core/rng.ts';
import type { V3 } from '../landmarks/records.ts';
import { CAP_REACH, COUNT_EXP, DECK_CEILING_COVER, DECK_MARGIN, LIFE_EXP, PUFF, WISP_SCALE, type PuffKind, type PuffPreset } from './presets.ts';

/**
 * Stateless particles (S4 W3-E) — the CPU side of the billboard draw, pure and usable in Node.
 *
 * Puff k of an emitter has constants drawn ONCE from rand(seed, k, j) (phase, life jitter, place in the
 * column, rotation, atlas frame…); its age is `fract(tFx / life_k + phase_k)` and its position, size and
 * opacity are a closed-form trajectory of (age, constants, wind) — so any frame is a pure function of the
 * effect clock (random access, no pre-roll: a still is always in steady state). Turbulence is value noise
 * of the age (smooth as tFx advances).
 */

/** a puff emitter of the billboard draw, in world space (built once by the EffectsSystem) */
export interface PuffEmitter {
  landmark: string;
  preset: PuffKind;
  P: PuffPreset;
  /** world source (smoke / steam: the vent; ash: the plume it leaves; spray: the plunge point) */
  p: V3;
  /** ash: travel target (low sheets); absent = downwind */
  to?: V3;
  /** spray: horizontal unit vector away from the cliff (the spray billows out from the foot) */
  out?: [number, number];
  rate: number;
  /** km per preset unit (landmark design scale included) */
  scale: number;
  /** linear albedo */
  albedo: V3;
  /** env.events component that switches it (−1 = always on) */
  slot: number;
  seed: number;
  /** ash-deck cover and height over the source (atmosphere.deckAt) */
  cover: number;
  deckY: number;
  /** a ceiling caps the rise (the plume spreads under the deck) */
  capped: boolean;
  /** rise to the top of the column (km) */
  H: number;
  /** column radius at the source / top, umbrella radius (km) */
  r0: number;
  rTop: number;
  rU: number;
  /** puffs at density 1, life (s) */
  count: number;
  life: number;
  /** per-puff constants, NC floats each */
  consts: Float32Array;
}

/** floats of constants per puff */
export const NC = 12;

/**
 * One evaluated puff (EffectsSystem scratch, PS floats): world position, radius, opacity, rotation,
 * atlas frame, deck-tone share, height fraction (0 source → 1 top), side toward the key (−1..1, set by
 * the caller) and sky visibility.
 */
export const PS = 12;
export const PO = { x: 0, y: 1, z: 2, size: 3, alpha: 4, rot: 5, frame: 6, merge: 7, hf: 8, lx: 9, lz: 10, sky: 11 } as const;

/** wind as the emitters see it: unit direction and a strength (1 = the default weather) */
export interface FxWind {
  dx: number;
  dz: number;
  /** |weather.wind| / WIND_REF, clamped */
  s: number;
}

/** |weather.wind| of the default weather (km per effect-second) — the presets' bends are tuned at it */
export const WIND_REF = 0.854;

export function fxWind(w: readonly [number, number]): FxWind {
  const m = Math.hypot(w[0], w[1]);
  if (m < 1e-6) return { dx: 1, dz: 0, s: 0 };
  return { dx: w[0] / m, dz: w[1] / m, s: Math.min(2.5, m / WIND_REF) };
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const fract = (x: number): number => x - Math.floor(x);

/** Build a puff emitter's static shape (rise, radii, counts, constants) from its source and the deck over it. */
export function makePuffEmitter(o: {
  landmark: string;
  preset: 'smoke' | 'ash' | 'steam' | 'spray';
  p: V3;
  to?: V3;
  out?: [number, number];
  rate: number;
  scale: number;
  color?: V3;
  slot: number;
  seed: number;
  cover: number;
  deckY: number;
}): PuffEmitter {
  const s = Math.max(1e-3, o.scale);
  // a small declared smoke (a chimney) is a thin wisp, not a scaled-down column
  const kind: PuffKind = o.preset === 'smoke' && s < WISP_SCALE ? 'wisp' : o.preset;
  const P = PUFF[kind];
  const rs = s / (P.refScale ?? 1);
  const ceiling = o.deckY - DECK_MARGIN - o.p[1];
  // under an ash deck a strong plume reaches the pall (it rises to the inversion and spreads under it); a
  // small one (a forge, a beacon) rises its own height and dissolves below it
  const free = P.rise * s;
  const capped = P.family === 'plume' && o.cover > DECK_CEILING_COVER && ceiling > 0.2 && ceiling < free * CAP_REACH;
  const H = capped ? ceiling : Math.min(free, o.cover > DECK_CEILING_COVER ? Math.max(0.2, ceiling) : free);
  const count = Math.max(P.minCount, Math.round(P.count * Math.max(0.05, o.rate) * Math.pow(rs, COUNT_EXP)));
  const consts = new Float32Array(count * NC);
  for (let k = 0; k < count; k++) {
    const c = k * NC;
    for (let j = 0; j < NC; j++) consts[c + j] = rand(o.seed, k, j);
    consts[c + 1] = 0.8 + 0.4 * consts[c + 1];
    consts[c + 2] *= Math.PI * 2;
    consts[c + 5] *= Math.PI * 2;
    consts[c + 6] = consts[c + 6] * 2 - 1;
    consts[c + 7] = Math.floor(consts[c + 7] * 16) % 16;
    consts[c + 8] *= 97;
    consts[c + 9] = 0.75 + 0.5 * consts[c + 9];
    consts[c + 10] = 0.7 + 0.3 * consts[c + 10];
  }
  return {
    landmark: o.landmark,
    preset: kind,
    P,
    p: o.p,
    ...(o.to ? { to: o.to } : {}),
    ...(o.out ? { out: o.out } : {}),
    rate: o.rate,
    scale: s,
    albedo: o.color ?? P.albedo,
    slot: o.slot,
    seed: o.seed,
    cover: o.cover,
    deckY: o.deckY,
    capped,
    H,
    r0: P.r0 * s,
    rTop: P.r1 * s,
    rU: P.r1 * s * P.spread,
    count,
    life: P.life * Math.pow(rs, LIFE_EXP),
    consts,
  };
}

/** downwind drift of the column top / the umbrella end (km) for a wind */
function drifts(e: PuffEmitter, w: FxWind): [number, number] {
  const top = e.P.bend * e.H * w.s;
  return [top, top + e.P.drift * e.scale * Math.max(w.s, 0.25)];
}

/** Bounding sphere of an emitter's puffs for a wind (frustum culling; conservative). */
export function puffBounds(e: PuffEmitter, w: FxWind, out: [number, number, number, number]): [number, number, number, number] {
  const [, dU] = drifts(e, w);
  const size = e.P.size1 * e.scale * 2.2;
  if (e.P.family === 'ash') {
    const D = e.to ? Math.hypot(e.to[0] - e.p[0], e.to[2] - e.p[2]) : e.P.drift * e.scale * Math.max(w.s, 0.3);
    const dx = e.to ? (e.to[0] - e.p[0]) / Math.max(D, 1e-6) : w.dx;
    const dz = e.to ? (e.to[2] - e.p[2]) / Math.max(D, 1e-6) : w.dz;
    out[0] = e.p[0] + (dx * D) / 2;
    out[1] = e.p[1] + e.P.rise * e.scale * 0.5;
    out[2] = e.p[2] + (dz * D) / 2;
    out[3] = D / 2 + e.P.r1 * e.scale + size + e.P.rise * e.scale;
    return out;
  }
  out[0] = e.p[0] + (w.dx * dU) / 2;
  out[1] = e.p[1] + e.H / 2;
  out[2] = e.p[2] + (w.dz * dU) / 2;
  // (the umbrella is sheared downwind: up to 1.8 + 0.55 of its radius past the drift)
  out[3] = Math.hypot(e.H / 2, dU / 2) + Math.max(e.capped ? 2.4 * e.rU : e.rU, e.rTop) + size;
  return out;
}

/** Projected extent of an emitter (km) for its level of detail. */
export function puffExtent(e: PuffEmitter): number {
  if (e.P.family === 'ash') return e.P.drift * e.scale;
  return Math.max(e.H, 2 * Math.max(e.rTop, e.r0)) + e.P.size1 * e.scale;
}

/**
 * Evaluate puff k at effect time tFx into out[o … o+PS): a pure function of (emitter, k, tFx, wind).
 * Returns false for a puff with no opacity.
 */
export function evalPuff(e: PuffEmitter, k: number, tFx: number, w: FxWind, out: Float64Array, o: number): boolean {
  const c = e.consts;
  const q = k * NC;
  const P = e.P;
  const s = e.scale;
  const life = e.life * c[q + 1];
  const a = fract(tFx / life + c[q]);
  const ang = c[q + 2];
  const rr = Math.pow(c[q + 3], 0.7);
  const vj = c[q + 4] - 0.5;
  const nz = c[q + 8];
  const nseed = e.seed ^ 0x5bd1e995;
  // turbulence: smooth in the age (billowing), independent per puff
  const tx = valueNoise(a * 2.6 + nz, nz * 1.7, nseed) - 0.5;
  const tz = valueNoise(a * 2.6 + nz, nz * 1.7 + 31.3, nseed) - 0.5;
  const ty = valueNoise(a * 2.1 + nz, nz * 1.3 + 57.1, nseed) - 0.5;
  let x: number;
  let y: number;
  let z: number;
  let size: number;
  let alpha: number;
  let merge = 0;
  let hf = 1;
  let lx: number;
  let lz: number;
  let sky = 1;
  const fadeIn = smooth(0, 0.05, a);

  if (P.family === 'plume') {
    const [dTop, dU] = drifts(e, w);
    const aTop = e.capped ? 1 - P.umbrella : 1;
    let R: number;
    let drift: number;
    let umb = 0;
    if (a < aTop) {
      const t = a / aTop;
      hf = 1 - Math.pow(1 - t, 1.4);
      R = e.r0 + (e.rTop - e.r0) * Math.pow(hf, 0.6);
      // the column leans downwind from low down (shear grows with height), not a vertical stalk
      drift = dTop * Math.pow(hf, e.capped ? 1.25 : 1.3);
      y = e.p[1] + e.H * hf + vj * R * 0.6 + ty * R * 0.4;
    } else {
      umb = (a - aTop) / (1 - aTop);
      R = e.rTop + (e.rU - e.rTop) * Math.sqrt(umb);
      drift = dTop + (dU - dTop) * umb;
      y = e.p[1] + e.H + vj * R * 0.16 + ty * R * 0.06;
    }
    lx = rr * Math.cos(ang) + tx * 0.5;
    lz = rr * Math.sin(ang) + tz * 0.5;
    // the spread under the ceiling is sheared downwind (an anvil smeared into the pall, not a symmetric
    // mushroom cap): stretched and shifted along the wind, narrower across it
    const along = lx * w.dx + lz * w.dz;
    const across = lz * w.dx - lx * w.dz;
    const sh = umb * Math.min(1, w.s);
    const al = along * (1 + 0.8 * sh) + 0.4 * sh;
    const ac = across * (1 - 0.2 * sh);
    x = e.p[0] + w.dx * drift + (al * w.dx - ac * w.dz) * R;
    z = e.p[2] + w.dz * drift + (al * w.dz + ac * w.dx) * R;
    size = s * (P.size0 + (P.size1 - P.size0) * Math.pow(hf, 0.7)) * (1 + 0.9 * umb) * c[q + 9];
    // the umbrella is a thinner veil than the column (the pall and what lies behind it show through)
    alpha = fadeIn * (1 - P.dissolve * Math.pow(hf, 1.2)) * Math.pow(1 - umb, 1.3) * (1 - 0.35 * smooth(0, 0.25, umb));
    if (!e.capped) alpha *= 1 - smooth(0.75, 1, a); // a free plume dissolves at its top
    merge = e.capped ? 0.25 * smooth(0.6, 1, hf) + 0.75 * smooth(0, 0.7, umb) : 0;
    // the lower column sits under the umbrella: less of the overcast reaches it; the core of the column is
    // in its own shade, the puffs on its skin catch the light
    sky = (e.capped ? 0.55 + 0.45 * Math.max(Math.pow(hf, 2), umb) : 1) * (0.62 + 0.38 * rr);
  } else if (P.family === 'ash') {
    // ash: born in the upper column (or at the source for a sheet with a target), carried away and spread
    const born = e.to ? 0 : e.capped || e.cover > DECK_CEILING_COVER ? 0.35 + 0.55 * c[q + 11] : 0.5 * c[q + 11];
    const ceil = e.deckY - DECK_MARGIN;
    const rise = P.rise * s;
    let dx: number;
    let dz: number;
    let D: number;
    if (e.to) {
      D = Math.hypot(e.to[0] - e.p[0], e.to[2] - e.p[2]) * a;
      const L = Math.max(1e-6, Math.hypot(e.to[0] - e.p[0], e.to[2] - e.p[2]));
      dx = (e.to[0] - e.p[0]) / L;
      dz = (e.to[2] - e.p[2]) / L;
    } else {
      D = P.drift * s * Math.max(w.s, 0.3) * a;
      dx = w.dx;
      dz = w.dz;
    }
    const R = s * (P.r0 + (P.r1 - P.r0) * a);
    lx = rr * Math.cos(ang) + tx * 0.6;
    lz = rr * Math.sin(ang) + tz * 0.6;
    x = e.p[0] + dx * D + lx * R;
    z = e.p[2] + dz * D + lz * R;
    const y0 = e.to ? e.p[1] + (e.to[1] - e.p[1]) * a : e.p[1] + rise * (born + 0.15 * a);
    y = y0 + vj * R * 0.12 + ty * R * 0.08;
    if (e.cover > DECK_CEILING_COVER) y = Math.min(y, ceil);
    size = s * (P.size0 + (P.size1 - P.size0) * a) * c[q + 9];
    alpha = smooth(0, 0.12, a) * Math.pow(1 - a, 1.1);
    merge = e.to ? 0.3 : 0.6;
    hf = Math.min(1, (y - e.p[1]) / Math.max(rise, 1e-3));
  } else {
    // spray: billows up and out from the plunge point, drifts downwind, dissolves
    const R = s * (P.r0 + (P.r1 - P.r0) * Math.sqrt(a));
    const ox = e.out ? e.out[0] : 0;
    const oz = e.out ? e.out[1] : 0;
    const drift = P.bend * s * w.s * a;
    lx = rr * Math.cos(ang) + tx * 0.5;
    lz = rr * Math.sin(ang) + tz * 0.5;
    hf = 1 - Math.pow(1 - a, 2);
    x = e.p[0] + w.dx * drift + ox * 0.35 * s * hf + lx * R;
    z = e.p[2] + w.dz * drift + oz * 0.35 * s * hf + lz * R;
    y = e.p[1] + P.rise * s * hf + vj * R * 0.4 + ty * R * 0.3;
    size = s * (P.size0 + (P.size1 - P.size0) * Math.pow(a, 0.6)) * c[q + 9];
    alpha = smooth(0, 0.08, a) * Math.pow(1 - a, 1.4) * (1 - P.dissolve * hf * 0.5);
  }
  // puffs fade out as their centres near the deck (the deck writes no depth: a billboard reaching past its
  // plane is simply drawn over it from below — no plane intersection; the umbrella stays a thin veil that
  // carries on into the pall)
  if (e.cover > DECK_CEILING_COVER) alpha *= Math.min(1, Math.max(0, (e.deckY - 0.2 - y) / (0.35 * size)));
  alpha *= P.opacity * c[q + 10];
  if (!(alpha > 1e-3)) return false;
  // tone variation between puffs (some darker, some catching more light): billows, not a smooth smudge
  sky *= 0.78 + 0.44 * fract(nz * 3.7);
  out[o + PO.x] = x;
  out[o + PO.y] = y;
  out[o + PO.z] = z;
  out[o + PO.size] = size;
  out[o + PO.alpha] = alpha;
  out[o + PO.rot] = c[q + 5] + c[q + 6] * 1.4 * a;
  out[o + PO.frame] = c[q + 7];
  out[o + PO.merge] = merge;
  out[o + PO.hf] = hf;
  out[o + PO.lx] = lx;
  out[o + PO.lz] = lz;
  out[o + PO.sky] = sky;
  return true;
}

/** A stable per-emitter seed for derived emitters (falls' spray, beacons) — hash of a name and an index. */
export function derivedSeed(base: number, k: number): number {
  return hash32(base, k, 0x51);
}
