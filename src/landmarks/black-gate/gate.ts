import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';

/**
 * The Morannon's kit geometry (local: x east, z south, the gate at the origin, the plain in front at −z).
 * Everything is dark, cool iron-grey on the rough 'weathered' family (the 60 %-metal 'iron' family
 * mirrored the warm ground and sky and read as tan timber); spikes on 'darkStone' keep a little sheen.
 *
 *  - the wall: two ground-following halves from the ridge flanks to the gate pylons, battered, faced
 *    with a CONTINUOUS rank of tall, flat-topped, overlapping plates (0.38 km wide every 0.3 km, two
 *    staggered layers, a raised rib down each — armoured iron, not pickets: pointed plate tops read as a
 *    timber palisade), two riveted girders and a heavy top rail across the whole face, a sparse row of
 *    thin needles on top (every other plate, every fourth tall), a lower rank on the back face, and squat
 *    spiked pylons every ~2.3 km;
 *  - the gate: two solid leaves (six vertical ribs, three heavy bands, spikes on the top edge and the
 *    band ends — no square grid) under a spiked lintel between two tall pylons crowned with spikes round
 *    a fire bowl;
 *  - the Towers of the Teeth: slender fin-bundle towers on shelves high on the flanking slopes — a
 *    buttressed foot, a twisting fin shaft with ribs and thorns, a collar, a flared lantern and a crown
 *    of spikes round a central spire, window slits in the fin valleys (lit at night);
 *  - crag shards: clusters of tall, narrow faceted rock spires on the ridge noses and crests (the
 *    0.4 km heightfield cannot hold the film's jagged crags);
 *  - eight braziers (fire, night gate — no fires by day): the gate pylons, the wall walk, the towers' lanterns.
 */

/**
 * Paint (sRGB): cool dark iron greys (the research palette #292b25 lifted to
 * read on a rough family; a cool bias so the warm low sun leaves them grey, not timber-brown). Plates and
 * ribs on 'darkStone' (roughness 0.5: a dull steel sheen), the wall body, girders and towers on 'weathered'.
 */
const IRON = 0x3e4245;
const IRON_DARK = 0x35393b;
const RUST = 0x3a3d3f;
const GIRDER = 0x2c2f31;
const TOWER = 0x3f4345;
const SPIKE = 0x2f3234;
const ROCK = 0x363634;

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
const SINK = 0.02;

/** wall height (km, above the ground under it) and thickness */
export const WALL_H = 2.2;
const WALL_T = 0.46;
/** plate pitch, width, thickness and the stagger of the two layers */
const PITCH = 0.3;
const PLATE_W = 0.38;
const PLATE_T = 0.05;
const STAGGER = 0.045;

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

/** the ridges' crest lines (local) — the stamps in index.ts; the crag shards follow them */
export const WEST_RIDGE: V2[] = [
  [-11.6, -4.8],
  [-11.2, -1],
  [-11.7, 4],
  [-13.8, 10],
  [-17.4, 17],
  [-21, 25],
];
export const EAST_RIDGE: V2[] = [
  [11.6, -4.8],
  [11.2, -1],
  [11.7, 4],
  [14.4, 9],
  [20.5, 12.5],
  [28, 14.5],
];

/** fin-bundle section (see Barad-dûr): `n` flat-topped fins, fin i's tip at angle phase + i·τ/n */
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

/** a rectangle outline w (along x) × t (along z), centred */
const rect = (w: number, t: number): V2[] => [
  [-w / 2, -t / 2],
  [w / 2, -t / 2],
  [w / 2, t / 2],
  [-w / 2, t / 2],
];

/**
 * a brazier: an iron bowl on a short stem with a flame and a fire light, base at (x, y, z). Night-gated
 * (off by day, kindling in the blue hour): the 'dusk' gate keeps a quarter of the fire burning in full
 * daylight, and the film shows no fires on the gate by day. Near-black paint at high strength: the glow
 * material's albedo is the paint × 0.25, so by day the flame is a dark ember, not a red cone.
 */
function brazier(k: ProxyKit, x: number, y: number, z: number): void {
  k.cylinder('weathered', 0.03, 0.05, 0.14, { at: [x, y, z], seg: 6, color: IRON_DARK, lod: 0 });
  k.cylinder('weathered', 0.13, 0.07, 0.08, { at: [x, y + 0.14, z], seg: 8, color: IRON_DARK, lod: 0 });
  k.cone('emissive', 0.09, 0.24, { at: [x, y + 0.2, z], seg: 6, color: 0x3a1004, glow: { gate: 'night', strength: 14, flicker: 0.3 }, lod: 0 });
  k.light([x, y + 0.3, z], { kind: 'fire', gate: 'night', color: 0xff9a3c, intensity: 1.6, radius: 0.08 });
}

/** a spiked crown: `n` spikes leaning out round radius r at height y, plus an optional central spire */
function spikeCrown(k: ProxyKit, x: number, z: number, y: number, r: number, n: number, h: number, spire: number): void {
  for (let j = 0; j < n; j++) {
    const a = (j / n) * TAU + 0.2;
    const big = j % 2 === 0;
    k.cone('darkStone', big ? 0.06 : 0.045, h * (big ? 1 : 0.65) * (0.9 + 0.2 * k.r()), { at: [x + Math.cos(a) * r, y - 0.05, z + Math.sin(a) * r], rot: tilt(a, big ? 0.22 : 0.4), seg: 4, color: SPIKE, lod: 0 });
  }
  if (spire > 0) k.cone('weathered', r * 0.45, spire, { at: [x, y - 0.05, z], seg: 6, color: TOWER });
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

/** the lowest ground under the four corners and the centre of a w × t footprint at (x, z) along direction d */
function minUnder(k: ProxyKit, x: number, z: number, d: V2, w: number, t: number): number {
  const nx = -d[1];
  const nz = d[0];
  let m = k.ground(x, z);
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ])
    m = Math.min(m, k.ground(x + d[0] * a * (w / 2) + nx * b * (t / 2), z + d[1] * a * (w / 2) + nz * b * (t / 2)));
  return m;
}

/** the tooth-tower shaft loft: [height above its base, twist deg, scale] */
const SHAFT: [number, number, number][] = [
  [0, 0, 1],
  [2.1, 4, 0.84],
  [3.9, 8, 0.74],
];
/** twist and scale of the shaft at height yy above its base (piecewise linear, as the loft) */
function shaftAt(yy: number): { rot: number; s: number } {
  for (let i = 0; i + 1 < SHAFT.length; i++) {
    const [y0, r0, s0] = SHAFT[i];
    const [y1, r1, s1] = SHAFT[i + 1];
    if (yy <= y1 || i + 2 === SHAFT.length) {
      const f = Math.min(1, Math.max(0, (yy - y0) / (y1 - y0)));
      return { rot: r0 + (r1 - r0) * f, s: s0 + (s1 - s0) * f };
    }
  }
  return { rot: 0, s: 1 };
}

/** a Tower of the Teeth on its shelf at (x, z): foot, fin-bundle shaft, collar, flared lantern, crown */
function toothTower(k: ProxyKit, x: number, z: number, face: number): void {
  k.extrude('weathered', finSection(8, 0.5, 0.82, 0.09, 0.2), 0.8, { at: [x, 0, z], followGround: true, taper: 0.28, color: TOWER });
  const y0 = maxGround(k, x, z, 0.82) + 0.8;
  const yb = y0 - 0.15;
  const shaft = finSection(6, 0.34, 0.5, 0.1);
  k.loft(
    'weathered',
    SHAFT.map(([y, rotDeg, scale]) => ({ outline: shaft, y, rotDeg, scale })),
    { at: [x, yb, z], color: TOWER },
  );
  const CORE0 = 0.34;
  const CORE1 = 0.26;
  k.cylinder('weathered', CORE1, CORE0, 3.9, { at: [x, yb, z], seg: 8, color: IRON_DARK });
  const yc = y0 + 3.75;
  k.lathe(
    'weathered',
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
    'weathered',
    [
      { outline: lantern, y: 0, rotDeg: 8 },
      { outline: lantern, y: 0.55, rotDeg: 10, scale: 1.15 },
      { outline: lantern, y: 0.95, rotDeg: 12, scale: 1.32 },
    ],
    { at: [x, yc + 0.28, z], color: TOWER },
  );
  const yt = yc + 0.28 + 0.95;
  spikeCrown(k, x, z, yt, 0.46, 10, 0.75, 1.35);
  // vertical ribs on the fin tips, lofted with the shaft's own twist and taper (they never stand off
  // the narrowing fins), hero range
  const RIB: [number, number] = [0.45, 3.2];
  for (let j = 0; j < 6; j++) {
    const a = (j / 6) * TAU;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const r = 0.5 + 0.02;
    const sq: V2[] = rect(0.05, 0.05).map(([u, v]) => [c * (r + v) - sn * u, sn * (r + v) + c * u] as V2);
    const secs = [RIB[0], 2.1, RIB[1]].map((yy) => ({ outline: sq, y: yy - RIB[0], rotDeg: shaftAt(yy).rot, scale: shaftAt(yy).s }));
    k.loft('darkStone', secs, { at: [x, yb + RIB[0], z], color: SPIKE, lod: 0 });
  }
  // thorns along the fin edges, leaning out and up (uneven), hero range
  for (let j = 0; j < 6; j++) {
    for (let m = 0; m < 4; m++) {
      const f = 0.15 + 0.2 * m + 0.08 * k.r();
      const { rot, s } = shaftAt(f * 3.9);
      const a = (j / 6) * TAU - (rot * Math.PI) / 180 + 0.1 * (k.r() - 0.5);
      const r = 0.5 * s;
      k.cone('darkStone', 0.035, 0.22 + 0.2 * k.r(), { at: [x + Math.cos(a) * r, yb + f * 3.9, z + Math.sin(a) * r], rot: tilt(a, 0.9), seg: 4, color: SPIKE, lod: 0 });
    }
  }
  // window slits in the fin valleys facing the plain (−z = 270°) and the gate side, with the shaft's
  // twist at their height; the core cylinder fills the valley floor, so each slit sits on whichever
  // surface is outermost there. Two of them lit (night).
  const valleys = [270, 270 + 60 * face, 270];
  for (let j = 0; j < 3; j++) {
    const yy = 1.05 + j * 1.05;
    const { rot, s } = shaftAt(yy);
    const a = ((valleys[j] - rot) * Math.PI) / 180;
    const rSurf = Math.max(0.34 * s, CORE0 + (CORE1 - CORE0) * (yy / 3.9)) + 0.005;
    const p: V3 = [x + Math.cos(a) * (rSurf - 0.01), yb + yy, z + Math.sin(a) * (rSurf - 0.01)];
    k.box('emissive', 0.05, 0.2, 0.04, { at: p, rot: [0, -a * DEG + 90, 0], color: 0x3a1206, glow: { gate: 'night', strength: 7 }, lod: 0 });
    if (j > 0) k.light([x + Math.cos(a) * (rSurf + 0.04), yb + yy + 0.1, z + Math.sin(a) * (rSurf + 0.04)], { kind: 'window', gate: 'night', color: 0xe08a3a, intensity: 0.7, radius: 0.03 });
  }
  // the brazier stands on a front fin of the lantern (fin tips at 2.9° + i·60° after the 12° twist;
  // 242.9° falls midway between two crown spikes, 302.9° would sit on one)
  const af = (242.9 * Math.PI) / 180;
  brazier(k, x + Math.cos(af) * 0.44, yt - 0.02, z + Math.sin(af) * 0.44);
}

/** a squat spiked pylon on the wall (a fin bundle from the ground to above the wall walk) */
function pylon(k: ProxyKit, x: number, z: number, h: number, r: number): number {
  const sec = finSection(4, r * 0.7, r, 0.16, Math.PI / 4);
  const g0 = Math.min(k.ground(x - r, z), k.ground(x + r, z), k.ground(x, z - r), k.ground(x, z + r)) - SINK;
  k.loft(
    'weathered',
    [
      { outline: sec, y: 0 },
      { outline: sec, y: h * 0.7, scale: 0.9 },
      { outline: sec, y: h, scale: 0.78 },
    ],
    { at: [x, g0, z], color: TOWER },
  );
  return g0 + h;
}

/**
 * A faceted rock shard: a tall, narrow, leaning spire (loft of irregular pentagons narrowing to a point),
 * its foot sunk below the lowest ground under it.
 */
function shard(k: ProxyKit, x: number, z: number, h: number, r: number, lean: number, leanDir: number): void {
  const n = 5;
  const base: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + k.r() * 0.6;
    const rr = r * (0.7 + 0.5 * k.r());
    base.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  const lx = Math.cos(leanDir) * lean * h;
  const lz = Math.sin(leanDir) * lean * h;
  const mid = base.map(([u, v]) => [u * 0.55 + lx * 0.5, v * 0.55 + lz * 0.5] as V2);
  const top = base.map(([u, v]) => [u * 0.07 + lx, v * 0.07 + lz] as V2);
  let g = k.ground(x, z);
  for (const [u, v] of base) g = Math.min(g, k.ground(x + u, z + v));
  k.loft(
    'weathered',
    [
      { outline: base, y: 0 },
      { outline: mid, y: h * (0.45 + 0.2 * k.r()) },
      { outline: top, y: h },
    ],
    { at: [x, g - 0.12 * h - SINK, z], color: ROCK, shade: 0.85 + 0.3 * k.r(), lod: 0 },
  );
}

/** clusters of shards along a ridge crest line, densest on the nose (the part facing the plain) */
function crags(k: ProxyKit, ridge: V2[], side: number): void {
  const s = sampler(ridge);
  const end = Math.min(s.len, 14);
  for (let t = 0.2; t < end; t += 0.9 + 0.9 * k.r() + t * 0.08) {
    const { p, d } = s.at(t);
    // the highest ground within ±1.6 km across the crest line (the stamped crest wanders with the noise)
    let best = p;
    let hb = -1e9;
    for (let q = -1.6; q <= 1.6; q += 0.4) {
      const c: V2 = [p[0] - d[1] * q, p[1] + d[0] * q];
      const h = k.ground(c[0], c[1]);
      if (h > hb) {
        hb = h;
        best = c;
      }
    }
    const count = 2 + Math.floor(k.r() * (t < 3 ? 4 : 3));
    for (let i = 0; i < count; i++) {
      const a = k.r() * TAU;
      const rr = 0.2 + 0.7 * k.r();
      const x = best[0] + Math.cos(a) * rr;
      const z = best[1] + Math.sin(a) * rr;
      const big = i === 0;
      const h = (big ? 0.55 : 0.3) + (big ? 0.35 : 0.3) * k.r();
      shard(k, x, z, h, h * (0.2 + 0.08 * k.r()), 0.12 + 0.12 * k.r(), Math.atan2(-side * d[0], side * d[1]) + (k.r() - 0.5));
    }
  }
}

export function buildGate(k: ProxyKit): void {
  // ---- the wall: two halves following the ground from the ridge flanks to the gate pylons
  for (const path of [WEST, EAST]) {
    k.wallPath('weathered', path, WALL_H, WALL_T, { followGround: true, batter: 0.2, color: IRON_DARK, shadeJitter: 0.05 });
  }
  for (const path of [WEST, EAST]) {
    const s = sampler(path);
    const n = Math.floor(s.len / PITCH);
    // the wall's own foot there (wallPath: the lower ground under its two faces, sunk)
    const wallFoot = (p: V2, d: V2) => Math.min(k.ground(p[0] - d[1] * WALL_T * 0.5, p[1] + d[0] * WALL_T * 0.5), k.ground(p[0] + d[1] * WALL_T * 0.5, p[1] - d[0] * WALL_T * 0.5)) - SINK;
    // the front (north) normal of the path direction: the side with −z
    const front = (d: V2): V2 => (d[0] > 0 ? [d[1], -d[0]] : [-d[1], d[0]]);
    for (let i = 0; i < n; i++) {
      const { p, d } = s.at(i * PITCH + PITCH / 2);
      const [nx, nz] = front(d);
      const yaw = -Math.atan2(d[1], d[0]) * DEG;
      const crown = wallFoot(p, d) + SINK + WALL_H;
      // the plated face: two staggered layers of tall flat-topped plates, overlapping (a continuous
      // armoured face, no pickets), each with a raised central rib; their tops run under the top rail
      const off = WALL_T / 2 + 0.03 + (i % 2) * STAGGER;
      const x = p[0] + nx * off;
      const z = p[1] + nz * off;
      const base = Math.min(minUnder(k, x, z, d, PLATE_W, PLATE_T), wallFoot(p, d)) - SINK;
      const ph = crown - 0.2 - base;
      const col = i % 7 === 3 ? RUST : i % 2 ? IRON : IRON_DARK;
      k.box('darkStone', PLATE_W, ph, PLATE_T, { at: [x, base, z], rot: [0, yaw, 0], color: col, shade: 0.94 + 0.12 * k.r(), lod: 0 });
      const ro = off + PLATE_T / 2 + 0.018;
      k.box('darkStone', 0.045, ph - 0.05, 0.04, { at: [p[0] + nx * ro, base + 0.03, p[1] + nz * ro], rot: [0, yaw, 0], color: IRON, lod: 0 });
      // needles on the wall top: every other plate, every fourth tall
      if (i % 2 === 0) {
        const tall = i % 4 === 0;
        k.cone('darkStone', 0.028, (tall ? 0.55 : 0.32) + 0.12 * k.r(), { at: [p[0] + nx * 0.1, crown - 0.03, p[1] + nz * 0.1], seg: 4, rot: [0, 45 + yaw, 0], color: SPIKE, lod: 0 });
      }
      // the back (Mordor) face: a lower rank of plates, seen from the pass and from Barad-dûr's side
      const bx = p[0] - nx * (WALL_T / 2 + 0.03);
      const bz = p[1] - nz * (WALL_T / 2 + 0.03);
      const bb = Math.min(minUnder(k, bx, bz, d, 0.26, 0.06), wallFoot(p, d)) - SINK;
      k.box('weathered', 0.26, WALL_H + 0.1, 0.06, { at: [bx, bb, bz], rot: [0, yaw, 0], color: IRON_DARK, lod: 0 });
    }
    // two riveted girders across the whole face and a heavy top rail with a cap back to the wall's
    // crown, in front of the plates and ribs (one run per plate bay, slightly overlapping)
    for (let i = 0; i < n; i++) {
      const { p, d } = s.at(i * PITCH + PITCH / 2);
      const [nx, nz] = front(d);
      const yaw = -Math.atan2(d[1], d[0]) * DEG;
      const off = WALL_T / 2 + 0.03 + STAGGER + PLATE_T / 2 + 0.04 + 0.03;
      const x = p[0] + nx * off;
      const z = p[1] + nz * off;
      const foot = wallFoot(p, d);
      const crown = foot + SINK + WALL_H;
      const base = Math.min(minUnder(k, x, z, d, PITCH, 0.06), foot);
      for (const y of [0.45, 1.22]) {
        k.box('weathered', PITCH + 0.02, 0.08, 0.06, { at: [x, base + y, z], rot: [0, yaw, 0], color: GIRDER, lod: 0 });
        for (const u of [-0.075, 0.075]) k.box('darkStone', 0.03, 0.03, 0.03, { at: [x + d[0] * u + nx * 0.03, base + y + 0.025, z + d[1] * u + nz * 0.03], rot: [0, yaw, 0], color: IRON, lod: 0 });
      }
      k.box('weathered', PITCH + 0.02, 0.26, 0.12, { at: [x, crown - 0.26, z], rot: [0, yaw, 0], color: GIRDER, lod: 0 });
      const co = (WALL_T * 0.8) / 2 - 0.02;
      k.box('weathered', PITCH + 0.02, 0.05, off - co + 0.06, { at: [p[0] + nx * ((off + co) / 2), crown - 0.05, p[1] + nz * ((off + co) / 2)], rot: [0, yaw, 0], color: IRON_DARK, lod: 0 });
    }
    // pylons every ~2.3 km (not at the ends)
    for (let t = 2.2; t < s.len - 0.8; t += 2.3) {
      const { p } = s.at(t);
      const top = pylon(k, p[0], p[1] - 0.05, WALL_H + 0.9, 0.34);
      spikeCrown(k, p[0], p[1] - 0.05, top, 0.24, 6, 0.45, 0);
    }
  }

  // ---- the gate: two solid leaves under a spiked lintel between two tall pylons
  const gy = Math.min(k.ground(-1.2, 0), k.ground(1.2, 0), k.ground(0, 0)) - SINK;
  for (const s of [-1, 1]) {
    const cx = s * 0.635;
    k.box('weathered', 1.24, 2.5, 0.3, { at: [cx, gy, 0.02], color: IRON_DARK });
    // six slender vertical ribs (the plate seams), full height
    for (let j = 0; j < 6; j++) k.box('weathered', 0.035, 2.44, 0.36, { at: [cx + (j - 2.5) * 0.19, gy + 0.03, 0.02], color: IRON, lod: 0 });
    // three heavy bands
    for (const y of [0.3, 1.18, 2.02]) k.box('weathered', 1.26, 0.16, 0.44, { at: [cx, gy + y, 0.02], color: GIRDER, lod: 0 });
    // spikes jutting forward from the band ends, down both edges of the leaf (the top edge is under
    // the lintel, which carries its own spikes)
    for (const y of [0.38, 1.26, 2.1])
      for (const e of [-0.58, 0.58]) k.cone('darkStone', 0.04, 0.26, { at: [cx + e, gy + y, -0.2], rot: tilt(-Math.PI / 2, 1.35), seg: 4, color: SPIKE, lod: 0 });
  }
  k.box('weathered', 3.3, 0.5, 0.62, { at: [0, gy + 2.48, 0.02], color: IRON });
  for (let j = 0; j < 9; j++) k.cone('darkStone', 0.06, j % 2 ? 0.34 : 0.55, { at: [-1.4 + j * 0.35, gy + 2.97, -0.1], seg: 4, color: SPIKE, lod: 0 });
  for (const s of [-1, 1]) {
    const top = pylon(k, s * 1.78, 0, 4.3, 0.52);
    // a crown of spikes round a fire bowl on the pylon's axis
    spikeCrown(k, s * 1.78, 0, top, 0.36, 8, 0.6, 0);
    brazier(k, s * 1.78, top - 0.05, 0);
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

  // ---- crag shards on the ridge noses and crests
  crags(k, WEST_RIDGE, -1);
  crags(k, EAST_RIDGE, 1);
}
