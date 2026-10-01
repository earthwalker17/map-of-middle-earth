import { valueNoise } from '../../core/rng.ts';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2 } from '../records.ts';
import { STONE, WALL, onProw } from './city.ts';
import { BEACON, C, CITADEL_Y, GATE_BEARING, PROW, PROW_YAW, RADII, TOWER, fromProw, polarC, tierY } from './layout.ts';

/** the prow's rock: pale weathered grey, rougher and a little cooler than the dressed stone */
const ROCK = 0x95928a;
const SLATE = 0x5d6064;
/** the White Tower: the palest stone of the city (highlight #d2c6b7), still not white */
const TOWER_STONE = 0xdcd9d0;

/**
 * The prow: a knife of rock from inside the citadel to its keel edge over the second tier, level with
 * the citadel on top (a paved terrace with a parapet round its edge, the court's lawn at its root).
 */
export function buildProw(k: ProxyKit): void {
  const y0 = tierY(1) - 0.1;
  const span = CITADEL_Y - y0;
  // the outline densified along both faces (root → tip → root), so the rock can bulge and crack
  const ring: V2[] = [];
  for (let e = 0; e < PROW.length - 1; e++) {
    const [a, b] = [PROW[e], PROW[e + 1]];
    const n = 6;
    for (let j = 0; j < n; j++) ring.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  ring.push(PROW[PROW.length - 1]);
  const tip = ring.findIndex(([d, p]) => d === PROW[5][0] && p === 0);
  // a faceted rock: eight sections, each face pushed in and out by smooth noise of (along, up) — broad
  // buttresses and gullies, finer cracks — battered at the foot; the keel edge and the top outline stay
  // clean (the top is the citadel's level: a crisp crest with the battlement)
  const secs = [0, 0.14, 0.3, 0.47, 0.64, 0.8, 0.94, 1].map((f) => {
    const outline = ring.map(([d, p], vi): V2 => {
      if (f === 1) return [d, p];
      const side = Math.sign(p) || 1;
      // vertical flutes (fissures running up the face, drifting slowly with height) over broad bulges
      const flute = 0.1 * (valueNoise(d * 5.5 + side * 7.1, f * 0.9, 9103) - 0.5) + 0.05 * (valueNoise(d * 13 + side * 3.3, f * 1.6, 9104) - 0.5);
      const broad = 0.09 * (valueNoise(d * 1.2 + side * 5.1, f * 2.5, 9101) - 0.5);
      const bulge = (flute + broad) * Math.sin(Math.min(1, f / 0.95) * Math.PI * 0.5 + 0.35);
      const batter = 0.1 * (1 - f);
      const edge = vi === tip ? 0.3 : 1;
      return [d - 0.05 * (1 - f) + (vi === tip ? 0.05 * (1 - f) : 0), p * (1 + batter) + side * bulge * edge];
    });
    return { outline, y: span * f };
  });
  k.loft('weathered', secs, { at: [C[0], y0, C[1]], rot: [0, PROW_YAW, 0], color: ROCK, grain: 0.55, lod: 2 });
  // the battlement along the crest (open at the root, where the prow joins the citadel)
  k.wallPath(
    'stone',
    PROW.map(([d, p]) => fromProw(d, p * 0.97)),
    0.05,
    0.03,
    { at: [0, CITADEL_Y, 0], color: WALL, lod: 1, crenel: { w: 0.035, h: 0.03, gap: 0.03, lod: 0 } },
  );
}

/**
 * The citadel on the seventh tier: the White Tower of Ecthelion (a slim shaft with banded storeys, a
 * gallery, a crown and a short spire — the top accent of the city), the Hall of the Kings before it, and
 * a ring of tall buildings round the citadel wall.
 */
export function buildCitadel(k: ProxyKit): void {
  const y = CITADEL_Y - 0.01;
  const [tx, tz] = TOWER.at;
  const { h, r } = TOWER;
  // the White Tower (lathe profile, base to spire tip)
  k.lathe(
    'stone',
    [
      [r * 1.35, 0],
      [r * 1.3, h * 0.08],
      [r * 1.05, h * 0.1],
      [r, h * 0.36],
      [r * 1.12, h * 0.37],
      [r * 1.12, h * 0.39],
      [r * 0.95, h * 0.4],
      [r * 0.88, h * 0.78],
      [r * 1.16, h * 0.8],
      [r * 1.16, h * 0.83],
      [r * 0.95, h * 0.84],
      [r * 0.95, h * 0.9],
      [r * 1.08, h * 0.91],
      [r * 1.08, h * 0.93],
      [r * 0.7, h * 0.935],
      [0.0, h * 1.08],
    ],
    { at: [tx, y, tz], color: TOWER_STONE, seg: 20, grain: 0.12 },
  );
  // the Hall of the Kings, east of the tower along the axis
  k.house('stone', 'slate', 0.62, 0.34, 0.3, { at: [C[0] + 0.12, y, C[1]], seat: false, roof: 'hip', pitch: 30, overhang: 0.012, color: 0xd0cdc4, roofColor: SLATE, lod: 1, windows: { count: 3, on: 0.67, sides: 2, size: 0.012 } });
  // the citadel's buildings in a ring along its wall (tall, facing out), clear of the prow and the tower
  const rr = RADII[6] - 0.24;
  let lot = 0;
  for (let b = -60; b < 240; b += 9 + k.r(1) * 5) {
    const [x, z] = polarC(b, rr);
    if (onProw(x, z, 0.2)) continue;
    if (Math.hypot(x - tx, z - tz) < r * 1.35 + 0.18) continue;
    const w = 0.16 + k.r(2) * 0.12;
    k.house('stone', 'slate', w, 0.2, 0.26 + k.r(3) * 0.3, {
      at: [x, y, z],
      rot: [0, 180 - b, 0],
      seat: false,
      roof: k.r(4) < 0.6 ? 'flat' : 'hip',
      pitch: 30,
      overhang: 0.008,
      color: STONE[lot % STONE.length],
      shade: 1.0 + k.r(5) * 0.06,
      roofColor: SLATE,
      lod: 0,
      ...(lot % 2 === 0 ? { windows: { count: 2, on: 0.7, sides: 1 as const, size: 0.011 } } : {}),
    });
    lot++;
  }
}

/** The Great Gate in the outer wall, facing east between two square towers. */
export function buildGate(k: ProxyKit): void {
  const R = RADII[0];
  const top = tierY(1);
  const half = 4.3; // deg either side of the gate axis
  for (const s of [-1, 1]) {
    const [x, z] = polarC(GATE_BEARING + s * half, R + 0.1);
    k.tower('stone', 0.26, top + 0.62, { at: [x, 0, z], seat: true, sides: 4, rot: [0, 45, 0], roof: 'crenel', color: WALL, shade: 1.04 });
    k.light([x + 0.2, 0.36, z - s * 0.05], { kind: 'lamp', color: 0xffb35c, intensity: 1.2, radius: 0.02 });
  }
  // the gate: dark iron leaves in a deep recess, a heavier band of stone over it
  const [gx, gz] = polarC(GATE_BEARING, R + 0.02);
  k.box('iron', 0.05, 0.46, 0.3, { at: [gx, 0, gz], seat: 'min', color: 0x2a2a28 });
  k.box('stone', 0.12, 0.14, 0.5, { at: [gx - 0.02, 0.48, gz], color: WALL, shade: 0.94 });
}

/**
 * The beacon crag on the cliff top above the city: a rock spire, a stone platform and the timber pile
 * (its `beacon` light is switched on by the S4 timeline).
 */
export function buildBeacon(k: ProxyKit): void {
  const [x, z] = BEACON;
  const g = k.ground(x, z);
  k.rock('weathered', 0.22, { at: [x, 0.05, z], seat: true, squash: 1.3, lump: 0.3, color: 0x5d5d5a, lod: 1 });
  const top = g + 0.24;
  k.cylinder('stone', 0.085, 0.1, 0.07, { at: [x, top - 0.04, z], seg: 10, color: 0x9d9686 });
  k.cone('wood', 0.07, 0.1, { at: [x, top + 0.03, z], seg: 8, color: 0x4a3828 });
  k.light([x, top + 0.12, z], { kind: 'beacon', color: 0xffa040, intensity: 4, radius: 0.08 });
}
