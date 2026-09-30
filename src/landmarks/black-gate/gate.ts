import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';

/**
 * The Morannon's kit geometry (local: x east, z south, the gate at the origin). Iron #292b25, towers
 * #353730 (research §6 palette), all 'iron' family (metal that reads dark in shade, catches the light on
 * the plate edges).
 *
 *  - the wall: two ground-following halves from the gate to the ridge flanks, battered, a crest of iron
 *    stakes, and a rank of tall vertical plates with pointed tops on the north face (the film's spiked
 *    plates, hero range), squat spiked pylons every ~2.3 km;
 *  - the gate: two giant leaves (banded, ribbed) under a spiked lintel between two tall pylons;
 *  - the Towers of the Teeth: slender fin-bundle towers on shelves high on the flanking slopes, a
 *    buttressed foot, a waist collar, a flared lantern and a crown of spikes round a central spire, faint
 *    window slits;
 *  - eight braziers (fire, dusk gate) on the pylons, the wall walk and the towers' lanterns.
 */

/**
 * Paint: the research palette (#292b25 iron, #353730 towers) was sampled from an overcast still, where it is
 * the perceived value; the 'iron' family is 60 % metal (diffuse × 0.4), so at the palette value the wall
 * renders as a black cut-out — the paint is lifted until the diffuse albedo lands near the palette's
 * value (#686a60 → ≈ #3e403a diffuse) and the plates, girders and spikes read as dark iron.
 */
const IRON = 0x686a60;
const IRON_DARK = 0x505249;
const TOWER = 0x74766b;
const SPIKE = 0x6e7068;

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;

/** wall height (km, above the ground under it) and thickness */
export const WALL_H = 2.2;
const WALL_T = 0.46;

/** the west half, from the flank of the west ridge to the gate; the east half mirrors it */
const WEST: V2[] = [
  [-7.9, -1.1],
  [-6.8, -0.3],
  [-5.2, 0.08],
  [-3.2, 0.15],
  [-1.45, 0],
];
const EAST: V2[] = WEST.map(([x, z]) => [-x, z] as V2).reverse();

/** the Towers of the Teeth: shelf centres (local) — stamped shelves in index.ts */
export const TOWERS: V2[] = [
  [-8.6, -1.8],
  [8.6, -1.8],
];

/** fin-bundle section (see Barad-dûr): `n` flat-topped fins */
function finSection(n: number, rIn: number, rOut: number, w: number, phase = 0): V2[] {
  const pts: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU;
    const v = a - Math.PI / n;
    pts.push([Math.cos(v) * rIn, Math.sin(v) * rIn]);
    pts.push([Math.cos(a - w) * rOut, Math.sin(a - w) * rOut]);
    pts.push([Math.cos(a + w) * rOut, Math.sin(a + w) * rOut]);
  }
  return pts;
}

/** Euler (deg) tilting +y by `t` rad toward the horizontal direction at angle `phi` (x = cos, z = sin) */
function tilt(phi: number, t: number): V3 {
  const rz = -Math.asin(Math.sin(t) * Math.cos(phi));
  const rx = Math.atan2(Math.sin(t) * Math.sin(phi), Math.cos(t));
  return [rx * DEG, 0, rz * DEG];
}

/** arc-length sampler of a polyline: point + unit direction at distance t */
function sampler(path: V2[]): { len: number; at: (t: number) => { p: V2; d: V2 } } {
  const segs: { a: V2; b: V2; l: number; s: number }[] = [];
  let len = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const l = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
    segs.push({ a: path[i], b: path[i + 1], l, s: len });
    len += l;
  }
  return {
    len,
    at: (t: number) => {
      const sg = segs.find((q) => t <= q.s + q.l) ?? segs[segs.length - 1];
      const f = sg.l > 0 ? Math.min(1, Math.max(0, (t - sg.s) / sg.l)) : 0;
      const d: V2 = [(sg.b[0] - sg.a[0]) / (sg.l || 1), (sg.b[1] - sg.a[1]) / (sg.l || 1)];
      return { p: [sg.a[0] + (sg.b[0] - sg.a[0]) * f, sg.a[1] + (sg.b[1] - sg.a[1]) * f], d };
    },
  };
}

/** a brazier: an iron bowl on a short stem with a flame (dusk) and a fire light, base at (x, y, z) */
function brazier(k: ProxyKit, x: number, y: number, z: number): void {
  k.cylinder('iron', 0.03, 0.05, 0.14, { at: [x, y, z], seg: 6, color: IRON_DARK, lod: 0 });
  k.cylinder('iron', 0.13, 0.07, 0.08, { at: [x, y + 0.14, z], seg: 8, color: IRON_DARK, lod: 0 });
  k.cone('emissive', 0.09, 0.24, { at: [x, y + 0.2, z], seg: 6, color: 0xff8a2a, glow: { gate: 'dusk', strength: 2.2, flicker: 0.3 }, lod: 0 });
  k.light([x, y + 0.3, z], { kind: 'fire', color: 0xff9a3c, intensity: 1.6, radius: 0.08 });
}

/** a spiked crown: `n` spikes leaning out round radius r at height y, plus an optional central spire */
function spikeCrown(k: ProxyKit, x: number, z: number, y: number, r: number, n: number, h: number, spire: number): void {
  for (let j = 0; j < n; j++) {
    const a = (j / n) * TAU + 0.2;
    const big = j % 2 === 0;
    k.cone('iron', big ? 0.06 : 0.045, h * (big ? 1 : 0.65) * (0.9 + 0.2 * k.r()), { at: [x + Math.cos(a) * r, y - 0.05, z + Math.sin(a) * r], rot: tilt(a, big ? 0.22 : 0.4), seg: 4, color: SPIKE, lod: 0 });
  }
  if (spire > 0) k.cone('iron', r * 0.45, spire, { at: [x, y - 0.05, z], seg: 6, color: TOWER });
}

/** the highest ground under a ring of radius r round (x, z) */
function maxGround(k: ProxyKit, x: number, z: number, r: number): number {
  let m = k.ground(x, z);
  for (let j = 0; j < 12; j++) {
    const a = (j / 12) * TAU;
    m = Math.max(m, k.ground(x + Math.cos(a) * r, z + Math.sin(a) * r));
  }
  return m;
}

/** a Tower of the Teeth on its shelf at (x, z): foot, fin-bundle shaft, collar, flared lantern, crown */
function toothTower(k: ProxyKit, x: number, z: number, face: number): void {
  k.extrude('iron', finSection(8, 0.5, 0.82, 0.09, 0.2), 0.8, { at: [x, 0, z], followGround: true, taper: 0.28, color: TOWER });
  const y0 = maxGround(k, x, z, 0.82) + 0.8;
  const shaft = finSection(6, 0.34, 0.5, 0.1);
  k.loft(
    'iron',
    [
      { outline: shaft, y: 0, rotDeg: 0 },
      { outline: shaft, y: 2.1, rotDeg: 4, scale: 0.84 },
      { outline: shaft, y: 3.9, rotDeg: 8, scale: 0.74 },
    ],
    { at: [x, y0 - 0.15, z], color: TOWER },
  );
  k.cylinder('iron', 0.26, 0.34, 3.9, { at: [x, y0 - 0.15, z], seg: 8, color: IRON });
  const yc = y0 + 3.75;
  k.lathe(
    'iron',
    [
      [0.25, 0],
      [0.46, 0.14],
      [0.46, 0.24],
      [0.3, 0.3],
    ],
    { at: [x, yc, z], seg: 12, color: IRON },
  );
  const lantern = finSection(6, 0.28, 0.4, 0.12, 0.26);
  k.loft(
    'iron',
    [
      { outline: lantern, y: 0, rotDeg: 8 },
      { outline: lantern, y: 0.55, rotDeg: 10, scale: 1.15 },
      { outline: lantern, y: 0.95, rotDeg: 12, scale: 1.32 },
    ],
    { at: [x, yc + 0.28, z], color: TOWER },
  );
  const yt = yc + 0.28 + 0.95;
  spikeCrown(k, x, z, yt, 0.46, 10, 0.75, 1.35);
  // vertical ribs down the shaft (the fin tips' plated edges), hero range
  for (let j = 0; j < 6; j++) {
    const a = (j / 6) * TAU - (4 * Math.PI) / 180;
    k.box('iron', 0.05, 2.6, 0.05, { at: [x + Math.cos(a) * 0.46, y0 + 0.3, z + Math.sin(a) * 0.46], color: SPIKE, lod: 0 });
  }
  // thorns along the fin edges, leaning out and up (uneven), hero range
  for (let j = 0; j < 6; j++) {
    for (let m = 0; m < 4; m++) {
      const f = 0.15 + 0.2 * m + 0.08 * k.r();
      const a = (j / 6) * TAU - (f * 8 * Math.PI) / 180 + 0.1 * (k.r() - 0.5);
      const r = 0.5 * (1 - 0.26 * f);
      k.cone('iron', 0.035, 0.22 + 0.2 * k.r(), { at: [x + Math.cos(a) * r, y0 - 0.15 + f * 3.9, z + Math.sin(a) * r], rot: tilt(a, 0.9), seg: 4, color: SPIKE, lod: 0 });
    }
  }
  // faint window slits on the side facing the plain (north, −z), two of them lit (dusk)
  for (let j = 0; j < 3; j++) {
    const y = y0 + 0.9 + j * 1.05;
    const a = -Math.PI / 2 + face * 0.35 * (j - 1) - Math.PI / 6;
    const r = 0.36 * (1 - 0.3 * ((y - y0) / 3.9)) + 0.01;
    const p: V3 = [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
    k.box('emissive', 0.05, 0.2, 0.04, { at: p, rot: [0, -a * DEG + 90, 0], color: 0xd0702a, glow: { gate: 'dusk', strength: 1.4 }, lod: 0 });
    if (j > 0) k.light([p[0] + Math.cos(a) * 0.02, y + 0.1, p[2] + Math.sin(a) * 0.02], { kind: 'window', gate: 'dusk', color: 0xe08a3a, intensity: 0.7, radius: 0.03 });
  }
  brazier(k, x + Math.cos(-Math.PI / 2) * 0.2, yt - 0.02, z - 0.2);
}

/** a squat spiked pylon on the wall (a fin bundle from the ground to above the wall walk) */
function pylon(k: ProxyKit, x: number, z: number, h: number, r: number): number {
  const sec = finSection(4, r * 0.7, r, 0.16, Math.PI / 4);
  const g0 = Math.min(k.ground(x - r, z), k.ground(x + r, z), k.ground(x, z - r), k.ground(x, z + r)) - 0.02;
  k.loft(
    'iron',
    [
      { outline: sec, y: 0 },
      { outline: sec, y: h * 0.7, scale: 0.9 },
      { outline: sec, y: h, scale: 0.78 },
    ],
    { at: [x, g0, z], color: TOWER },
  );
  return g0 + h;
}

export function buildGate(k: ProxyKit): void {
  // ---- the wall: two halves following the ground from the ridge flanks to the gate pylons
  for (const path of [WEST, EAST]) {
    k.wallPath('iron', path, WALL_H, WALL_T, {
      followGround: true,
      batter: 0.2,
      color: IRON,
      shadeJitter: 0.06,
      crenel: { w: 0.1, h: 0.42, gap: 0.09, shape: 'point', lod: 0, color: SPIKE },
    });
  }
  // the rank of tall spiked plates on the north face (the film's vertical plates), and pylons
  for (const path of [WEST, EAST]) {
    const s = sampler(path);
    const n = Math.floor(s.len / 0.3);
    for (let i = 1; i < n; i++) {
      const { p, d } = s.at(i * 0.3 + 0.15);
      // north (left of the walking direction for the west half, right for the east half): the side with −z
      let nx = d[1];
      let nz = -d[0];
      if (nz > 0) {
        nx = -nx;
        nz = -nz;
      }
      const off = WALL_T / 2 + 0.04;
      const x = p[0] + nx * off;
      const z = p[1] + nz * off;
      const yaw = -Math.atan2(d[1], d[0]) * DEG;
      const tall = i % 4 === 0;
      const ph = WALL_H + (tall ? 0.55 : 0.28);
      k.box('iron', 0.1, ph, 0.1, { at: [x, 0, z], rot: [0, yaw, 0], seat: 'min', color: i % 3 ? IRON : IRON_DARK, lod: 0 });
      const base = Math.min(k.ground(x - 0.05, z - 0.05), k.ground(x + 0.05, z + 0.05), k.ground(x, z)) - 0.02;
      k.cone('iron', 0.065, tall ? 0.42 : 0.26, { at: [x, base + ph - 0.01, z], seg: 4, rot: [0, 45 + yaw, 0], color: SPIKE, lod: 0 });
    }
    // the back (Mordor) face: a lower rank of plates, seen from the pass and from Barad-dûr's side
    for (let i = 1; i < n; i++) {
      const { p, d } = s.at(i * 0.3 + 0.15);
      let nx = -d[1];
      let nz = d[0];
      if (nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      const off = WALL_T / 2 + 0.03;
      const yaw = -Math.atan2(d[1], d[0]) * DEG;
      k.box('iron', 0.1, WALL_H + 0.18, 0.08, { at: [p[0] + nx * off, 0, p[1] + nz * off], rot: [0, yaw, 0], seat: 'min', color: IRON_DARK, lod: 0 });
    }
    // two horizontal girders across the plates (hero range), one run per plate bay
    for (let i = 1; i + 1 < n; i++) {
      const { p, d } = s.at(i * 0.3 + 0.3);
      let nx = d[1];
      let nz = -d[0];
      if (nz > 0) {
        nx = -nx;
        nz = -nz;
      }
      const off = WALL_T / 2 + 0.02;
      const x = p[0] + nx * off;
      const z = p[1] + nz * off;
      const base = Math.min(k.ground(x - nx * 0.1, z - nz * 0.1), k.ground(x, z)) - 0.02;
      const yaw = -Math.atan2(d[1], d[0]) * DEG;
      for (const y of [0.55, 1.5]) k.box('iron', 0.3, 0.06, 0.05, { at: [x, base + y, z], rot: [0, yaw, 0], color: IRON_DARK, lod: 0 });
    }
    // pylons every ~2.3 km (not at the ends)
    for (let t = 2.2; t < s.len - 0.8; t += 2.3) {
      const { p } = s.at(t);
      const top = pylon(k, p[0], p[1] - 0.05, WALL_H + 0.9, 0.34);
      spikeCrown(k, p[0], p[1] - 0.05, top, 0.24, 6, 0.45, 0);
    }
  }

  // ---- the gate: two banded, ribbed leaves under a spiked lintel between two tall pylons
  const gy = Math.min(k.ground(-1.2, 0), k.ground(1.2, 0), k.ground(0, 0)) - 0.02;
  for (const s of [-1, 1]) {
    k.box('iron', 1.24, 2.5, 0.3, { at: [s * 0.635, gy, 0.02], color: IRON_DARK });
    for (const y of [0.35, 0.95, 1.55, 2.12]) k.box('iron', 1.18, 0.07, 0.38, { at: [s * 0.635, gy + y, 0.02], color: IRON, lod: 0 });
    for (const x of [0.2, 0.62, 1.04]) k.box('iron', 0.05, 2.46, 0.36, { at: [s * x, gy + 0.02, 0.02], color: SPIKE, lod: 0 });
  }
  k.box('iron', 3.3, 0.5, 0.62, { at: [0, gy + 2.48, 0.02], color: IRON });
  for (let j = 0; j < 9; j++) k.cone('iron', 0.06, j % 2 ? 0.34 : 0.55, { at: [-1.4 + j * 0.35, gy + 2.97, -0.1], seg: 4, color: SPIKE, lod: 0 });
  for (const s of [-1, 1]) {
    const top = pylon(k, s * 1.78, 0, 4.3, 0.52);
    spikeCrown(k, s * 1.78, 0, top, 0.36, 8, 0.6, 0.9);
    brazier(k, s * 1.78 + s * 0.05, top - 0.05, -0.34);
  }

  // ---- braziers on the wall walk either side of the gate
  for (const s of [-1, 1]) {
    for (const x of [2.9, 5.0]) {
      const z = 0.14;
      const top = Math.min(k.ground(s * x, z - WALL_T / 2), k.ground(s * x, z + WALL_T / 2)) + WALL_H;
      brazier(k, s * x, top - 0.02, z + 0.02);
    }
  }

  // ---- the Towers of the Teeth, high on the flanks
  toothTower(k, TOWERS[0][0], TOWERS[0][1], 1);
  toothTower(k, TOWERS[1][0], TOWERS[1][1], -1);
}
