import { hexToLinear } from '../../materials/families.ts';

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
    const e = e0 * (1 - tm) ** 0.9;
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
    const e = e0 * (floor + (1 - floor) * (1 - tm) ** 0.9);
    return { ...b, s: Math.min(15, e / LUM_G) };
  });
}

/** foot emission of the wash (linear green) */
export const E0 = 0.35;
