import type { V2 } from '../records.ts';

/**
 * Minas Tirith layout (local km, heading 0: x east, z south). The display point (places.json offset
 * (−4, 9.5)) is at the eastern foot of Mindolluin: the mountain front is a steep N–S face about 2 km
 * west of it (base ground +5 at x ≈ −2, +10 at x ≈ −4, a plateau of +11…+14 behind, the summit +17 at
 * x ≈ −20), the Pelennor falls gently east to the Anduin (17 km east, 13 km south).
 *
 * The stamps cut the foot slope east of the face down to ONE bench level (the Pelennor at the city's
 * foot: local y = 0 — the origin lies on it) and a shelf for the keep behind the citadel; the city is
 * seven concentric terrace bodies centred on the cliff foot (`C`), each a near-semicircle against the
 * mountain (closed by a chord buried in the face), stepping up `STEP` km per tier — a broad fan, wider
 * than tall, the upper tiers wide (never a stepped cone). The prow — a keel of rock — runs from the
 * citadel east-south-east over the Great Gate to the second tier, level with the citadel on top.
 */

/** centre of the concentric tiers: on the cliff foot */
export const C: V2 = [-2.0, 0];
/** number of walled tiers (the seventh is the citadel) */
export const TIERS = 7;
/** mean height step between tiers, km */
export const STEP = 0.82;
/**
 * the height step of tier 1…7 (S4 W5, C2 #10: seven equal rings read as a wedding cake): the two lower
 * walls 40 % taller than the middle ones, rings 5–6 15 % lower, normalised so the citadel keeps its level
 * (7 · STEP)
 */
const STEP_SHAPE = [1.4, 1.4, 1, 1, 0.85, 0.85, 1];
export const STEPS: number[] = STEP_SHAPE.map((f) => (f * STEP * 7) / STEP_SHAPE.reduce((a, b) => a + b, 0));
/** the height step (wall height) of tier `i` (1…7) */
export const stepOf = (i: number): number => STEPS[Math.max(1, Math.min(7, i)) - 1];
/** outer radius of tier 1…7 (index 0 = the lowest, outermost wall) */
export const RADII = [6.3, 5.7, 5.1, 4.5, 3.9, 3.3, 2.6];
/** terrace top of tier `i` (0 = the bench, 7 = the citadel), local y */
export const tierY = (i: number): number => STEPS.slice(0, Math.max(0, Math.min(7, i))).reduce((a, b) => a + b, 0);
/** the citadel level */
export const CITADEL_Y = tierY(TIERS);

/** stamp heights relative to the base ground at the origin: the bench (Pelennor at the city's foot) */
export const BENCH_REL = -3.0;

/** the White Tower: base centre (on the citadel), shaft height, base radius */
export const TOWER = { at: [C[0] - 0.45, 0] as V2, h: 3.4, r: 0.21 };

/**
 * The prow (plan in its own frame: d along its axis from C, p across it), from inside the citadel to its
 * keel edge over the second tier wall above the Great Gate, slightly convex sides narrowing to the edge.
 * Top level with the citadel. The axis (bearing PROW_BEARING) points at the hero camera
 * (minas-tirith-close, azimuth 110), so the keel edge points at the lens and both faces show equally —
 * the northern one lit by the dawn sun (azimuth ≈ 80), the southern one in shade.
 */
export const PROW: V2[] = [
  [0.65, -0.86],
  [1.6, -0.79],
  [2.6, -0.65],
  [3.6, -0.47],
  [4.6, -0.25],
  [5.55, 0],
  [4.6, 0.25],
  [3.6, 0.47],
  [2.6, 0.65],
  [1.6, 0.79],
  [0.65, 0.86],
];
/** compass bearing of the prow's axis */
export const PROW_BEARING = 110;
const PA: V2 = [Math.sin((PROW_BEARING * Math.PI) / 180), -Math.cos((PROW_BEARING * Math.PI) / 180)];
/** the prow frame's +p direction (local x, z): the axis turned 90° clockwise */
const PP: V2 = [-PA[1], PA[0]];
/** prow frame (d, p) → local (x, z) */
export function fromProw(d: number, p: number): V2 {
  return [C[0] + d * PA[0] + p * PP[0], C[1] + d * PA[1] + p * PP[1]];
}
/** local (x, z) → prow frame (d, p) */
export function toProw(x: number, z: number): V2 {
  const dx = x - C[0];
  const dz = z - C[1];
  return [dx * PA[0] + dz * PA[1], dx * PP[0] + dz * PP[1]];
}
/** yaw (deg, the kit's +yaw turns x towards −z) that turns the prow frame's +d (local +x) onto the axis */
export const PROW_YAW = 90 - PROW_BEARING;

/** half width of the prow at distance `d` along its axis from C (0 outside it) */
export function prowHalf(d: number): number {
  if (d < PROW[0][0] || d > PROW[5][0]) return 0;
  for (let k = 0; k < 5; k++) {
    const a = PROW[k];
    const b = PROW[k + 1];
    if (d >= a[0] && d <= b[0]) return -(a[1] + ((b[1] - a[1]) * (d - a[0])) / (b[0] - a[0]));
  }
  return 0;
}

/** compass bearing (deg, clockwise from north) of the Great Gate from C: east, under the prow's keel */
export const GATE_BEARING = 108;

/** local point at compass bearing `b` (deg) and radius `r` from C */
export function polarC(b: number, r: number): V2 {
  const t = (b * Math.PI) / 180;
  return [C[0] + Math.sin(t) * r, C[1] - Math.cos(t) * r];
}

/** the beacon crag on the cliff top above the city (north-west of the citadel) */
export const BEACON: V2 = [-5.4, -1.6];
