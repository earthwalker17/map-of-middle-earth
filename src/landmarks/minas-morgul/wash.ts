import { hexToLinear } from '../../materials/families.ts';
import type { LightDecl, V3 } from '../types.ts';

/**
 * The corpse-light that washes up Minas Morgul's walls (city.ts, tower.ts): thin night-gated
 * `emissiveGreen` skins in fine bands from a face's foot to ≈ 45 % of its height. Every band has the SAME
 * saturated emerald paint — the hue never drifts toward white (a pale band emits near-white light, which
 * the night grade and AgX turn mint) — and only the strength falls, smoothly, as (1 − t)^0.9 over the
 * washed zone. Enough bands that no step shows at the hero distance.
 *
 * By day a glow skin's albedo is a quarter of its paint, so the washed feet read as dark, damp green stone
 * until the glow material can keep the base stone's albedo by day (contract request: families.ts).
 */

/** the wash's one paint: a saturated emerald (low red and blue, so the green survives the night grade) */
export const GLOW = 0x0a7a2e;
/** hotter green for the gate mouth, the window slits and the statues' eyes */
export const GLOW_HOT = 0x2ee87a;

/** a glow band up a face: from f0 to f1 (fractions of the face height), paint, strength */
export interface Band {
  f0: number;
  f1: number;
  color: number;
  s: number;
}

const LUM_G = hexToLinear(GLOW)[1];

/**
 * The wash: `n` bands from the foot up to `top` (fraction of the height), emitting `e0`·(1 − t)^0.9 in
 * linear green at fraction t of the washed zone (t at the band's middle); paint constant (GLOW).
 */
export function wash(n: number, top: number, e0: number): Band[] {
  return Array.from({ length: n }, (_, i) => {
    const tm = (i + 0.5) / n;
    const e = e0 * (WASH_FLOOR + (1 - WASH_FLOOR) * (1 - tm) ** 0.9);
    return { f0: (top * i) / n, f1: (top * (i + 1)) / n, color: GLOW, s: Math.min(15, e / LUM_G) };
  });
}

/**
 * A full-height wash for the tier walls (their feet stand behind the wall in front of them: from the
 * hero only their upper parts show): `n` bands over the whole face, the strength falling from `e0` at
 * the foot to `floor`·e0 at the top, (1 − t)^0.9 in between.
 */
export function washFull(n: number, e0: number, floor: number): Band[] {
  return wash(n, 1, e0).map((b, i) => {
    const tm = (i + 0.5) / n;
    const f = Math.max(floor, WASH_FLOOR);
    const e = e0 * (f + (1 - f) * (1 - tm) ** 0.9);
    return { ...b, s: Math.min(15, e / LUM_G) };
  });
}

/**
 * S4 W2-D: the corpse-light as LIGHT — spill-only sources (no sprite) at the walls' feet, in front of the
 * gate and up the tiers (WASH_LIGHTS), so the green falls off over each face and across the stone and the
 * ground round it (EmissionSystem spill; the halo of the lamp room greens the vale air). With the sources
 * wired into the landmark (index.ts `lights: WASH_LIGHTS` — a contract request of W2-D) the painted bands
 * drop to WASH_PAINT of their S3 strength: a faint emissive skin that keeps the hue, the light does the rest.
 */
export const WASH_SPILL = false;
/** the painted bands' share of their S3 strength once the spill lights the walls */
export const WASH_PAINT = 0.35;
/**
 * with the spill, the paint no longer falls to nothing up a washed zone: it keeps this share of its foot
 * strength at the zone's top (the hue stays on the stone; never a black cap over a lit foot)
 */
const WASH_FLOOR = WASH_SPILL ? 0.3 : 0;

/** foot emission of the wash (linear green) */
export const E0 = 0.35 * (WASH_SPILL ? WASH_PAINT : 1);

/** the light of the wash (sRGB): a saturated emerald, a little hotter than the paint */
const WASH_LIGHT = 0x14b85a;

/**
 * The wash sources (local km; the shelf is at y ≈ −0.4, the second tier's top 1.3, the keep terrace's
 * 2.1 — layout.ts): [x, y, z], intensity, reach — 0.2 km off the walls' feet: before the gate (the
 * strongest: the opening burns), off the west / south-west curtain (one source for both: six sources, so
 * the gate's and the lamp room's own lights keep their spill slots) and the south-east one, before the second
 * tier's face over the curtain, before the keep terrace and the Tower's keep. 'magic' at the night gate;
 * r = 0.12 → the core r0 = 0.24 km, so each face is brightest at its foot and dims up it and along it.
 */
const WASH_SRC: [V3, number, number][] = [
  [[0.2, -0.2, 3.15], 1.0, 1.4],
  [[-1.3, -0.25, 1.92], 0.95, 1.5],
  [[1.42, -0.25, 2.72], 0.7, 1.3],
  [[0.42, 0.5, 2.36], 0.6, 1.1],
  [[0.52, 1.4, 2.0], 0.56, 1.0],
  [[0.52, 2.25, 1.85], 0.45, 0.9],
];

export const WASH_LIGHTS: LightDecl[] = WASH_SRC.map(([at, intensity, spillKm]) => ({ at, color: WASH_LIGHT, intensity, radius: 0.12, kind: 'magic', gate: 'night', spillKm, sprite: false }));
