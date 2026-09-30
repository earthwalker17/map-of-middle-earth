import { hashString, rand } from '../../core/rng.ts';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { TreeDecl, V2 } from '../types.ts';
import { LEDGE_N, LEDGE_NE, LEDGE_S, LEDGE_SE } from './layout.ts';
import { archedBridge, hall, LAMP, spireTower, STONE, STONE2 } from './parts.ts';

/**
 * The halls, towers, court, colonnades, bridge, cliffs, lamps and autumn trees of Rivendell (local km,
 * heading 0). The main group — the Last Homely House, its wings and tower, the round Council court and a
 * colonnade along the ledge's lip — stands on the north ledge, facing the afternoon sun across the gorge;
 * a second group on the south ledge; single halls on stone terraces cut into both walls; a thin high
 * bridge joins the ledges. Everything is a pure function of the module constants and the kit's ground.
 */

const SEED = hashString('rivendell-halls');
/** warm grey-brown rock of the gorge (research §4 palette: #876950 / #634935 / #ada182, lit gold) */
const ROCK = 0x77746c;
/** autumn crowns (#b5702a / #d19a3a and between), a few still green-gold */
const AUTUMN = [0xb5702a, 0xd19a3a, 0xc4822f, 0xa8602a, 0xd6a646, 0x9c8a3a];

/** local point of the ledge frame: u east, v south from a ledge centre */
const onN = (u: number, v: number): V2 => [LEDGE_N.at[0] + u, LEDGE_N.at[1] + v];
const onS = (u: number, v: number): V2 => [LEDGE_S.at[0] + u, LEDGE_S.at[1] + v];

/** halls on the two up-valley shelves: position, yaw, width, lit window slots per side */
const SHELF_HALLS: { at: V2; yaw: number; w: number; lit: number }[] = [
  { at: [LEDGE_NE.at[0] - 0.12, LEDGE_NE.at[1] + 0.12], yaw: -15, w: 0.3, lit: 2 },
  { at: [LEDGE_SE.at[0] + 0.05, LEDGE_SE.at[1] - 0.1], yaw: 162, w: 0.3, lit: 2 },
  { at: [LEDGE_SE.at[0] - 0.22, LEDGE_SE.at[1] + 0.12], yaw: 170, w: 0.22, lit: 1 },
];


export function buildRivendell(k: ProxyKit): void {
  buildNorthLedge(k);
  buildSouthLedge(k);
  // the two up-valley shelves: their lips, halls, a tower and a pavilion each
  ledgeLip(k, LEDGE_NE, 120, 250, LEDGE_NE.r + 0.08);
  ledgeLip(k, LEDGE_SE, 290, 410, LEDGE_SE.r + 0.08);
  for (const h of SHELF_HALLS) hall(k, { at: h.at, yaw: h.yaw, w: h.w, d: 0.15, h: 0.1, windows: h.lit });
  gazebo(k, [LEDGE_NE.at[0] - 0.25, LEDGE_NE.at[1] + 0.3], 0.04, false);
  gazebo(k, [LEDGE_SE.at[0] - 0.05, LEDGE_SE.at[1] - 0.32], 0.04, false);
  spireTower(k, [LEDGE_NE.at[0] + 0.05, LEDGE_NE.at[1] - 0.25], 0.04, 0.34, { lit: 2 });
  spireTower(k, [LEDGE_SE.at[0] + 0.25, LEDGE_SE.at[1] + 0.05], 0.04, 0.26, { roof: 'dome', lit: 2 });
  // the thin high bridge from the north ledge's western lip across the gorge to the south ledge
  const a = onN(-0.62, 0.62);
  const b = onS(0.38, -0.42);
  archedBridge(k, [a[0], LEDGE_N.h + 0.01, a[1]], [b[0], LEDGE_S.h + 0.01, b[1]], { width: 0.05, rise: 0.55, camber: 0.1, color: 0xdccfae });
  for (const t of [0.25, 0.5, 0.75]) {
    const y = LEDGE_N.h + (LEDGE_S.h - LEDGE_N.h) * t + 0.1 * Math.sin(Math.PI * t) + 0.05;
    k.light([a[0] + (b[0] - a[0]) * t, y, a[1] + (b[1] - a[1]) * t], { color: LAMP, intensity: 1.1, radius: 0.015, kind: 'lamp' });
  }
}

/** a ledge: its centre, radius and level (layout.ts) */
type Ledge = { at: V2; r: number; h: number };

/** points on an arc round a ledge centre, clockwise from compass bearing `from` to `to`, radius `rim` */
function arc(l: Ledge, from: number, to: number, rim: number, n: number): V2[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const b = ((from + ((to - from) * i) / n) * Math.PI) / 180;
    return [l.at[0] + Math.sin(b) * rim, l.at[1] - Math.cos(b) * rim] as V2;
  });
}

/**
 * The rim rock of a ledge: a faceted band of grey rock, at most 0.4 km tall, along the upper edge of the
 * ledge's gorge-side slope up to its level (clockwise round the ledge, so the face looks outward) — a
 * crisp stone edge under the terraces; the terrain's steep face carries it on down to the gorge floor.
 */
function ledgeLip(k: ProxyKit, l: Ledge, from: number, to: number, rim: number): void {
  // an irregular rim (±12 %), so the lip reads as a rock outcrop rather than a drum
  const pts = arc(l, from, to, rim, 9).map(([x, z], i): V2 => {
    const f = 1 + 0.12 * Math.sin(i * 2.3 + l.at[0] * 7);
    return [l.at[0] + (x - l.at[0]) * f, l.at[1] + (z - l.at[1]) * f];
  });
  k.cliff(
    'weathered',
    pts,
    pts.map(([x, z]) => Math.min(0.4, Math.max(0.12, l.h + 0.03 - k.ground(x, z)))),
    { color: ROCK, rough: 0.5, strata: 0.5, depth: 0.25, soft: 0.35, taper: 0.12 },
  );
}

/** a balustrade along a ledge's rim (low pale wall with balusters, LOD0 only) with lanterns on it */
function balustrade(k: ProxyKit, l: Ledge, from: number, to: number, rim: number, lamps: number): void {
  const n = 10;
  const pts = arc(l, from, to, rim, n);
  k.wallPath('stone', pts, 0.03, 0.012, { followGround: true, step: 0.06, color: STONE, crenel: { w: 0.008, h: 0.012, gap: 0.012, lod: 0 }, lod: 0 });
  for (let i = 0; i < lamps; i++) {
    const [x, z] = pts[Math.round(((i + 0.5) / lamps) * n)];
    k.light([x, k.ground(x, z) + 0.05, z], { color: LAMP, intensity: 1.0, radius: 0.012, kind: 'lamp' });
  }
}

/** an open gazebo: slender pillars under a pale dome (the film's filigree pavilions), LOD0 detail */
function gazebo(k: ProxyKit, at: V2, r: number, lit: boolean): void {
  const y = k.ground(at[0], at[1]) - 0.005;
  k.lathe(
    'stone',
    [
      [r * 1.15, 0],
      [r * 1.15, 0.01],
    ],
    { at: [at[0], y, at[1]], seg: 12, color: STONE2, lod: 0 },
  );
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.cylinder('stone', 0.005, 0.006, r * 1.3, { at: [at[0] + Math.cos(a) * r, y + 0.01, at[1] + Math.sin(a) * r], seg: 5, color: STONE, lod: 0 });
  }
  k.tower('stone', r * 1.08, 0.01, { at: [at[0], y + 0.01 + r * 1.3, at[1]], sides: 12, roof: 'dome', roofFam: 'stone', roofColor: 0xe6dcc0, roofH: r, color: STONE, lod: 0 });
  if (lit) k.light([at[0], y + r * 0.8, at[1]], { color: LAMP, intensity: 1.1, radius: 0.014, kind: 'lamp' });
}

/** the Last Homely House and its court on the north ledge */
function buildNorthLedge(k: ProxyKit): void {
  const l = LEDGE_N;
  const y = l.h;
  ledgeLip(k, l, 100, 262, l.r + 0.08);
  // the house: a long main hall facing the gorge, two wings running back, a hall closing the court behind
  hall(k, { at: onN(-0.05, 0.22), yaw: 0, w: 0.52, d: 0.2, h: 0.14, pitch: 58, windows: 3 });
  hall(k, { at: onN(-0.42, -0.02), yaw: 90, w: 0.34, d: 0.16, h: 0.12, windows: 2 });
  hall(k, { at: onN(0.34, -0.04), yaw: 90, w: 0.32, d: 0.16, h: 0.12, windows: 2 });
  hall(k, { at: onN(-0.05, -0.28), yaw: 0, w: 0.4, d: 0.17, h: 0.12, roof: 'hip', pitch: 52, windows: 2 });
  spireTower(k, onN(0.12, -0.08), 0.05, 0.46, { lit: 3 });
  spireTower(k, onN(-0.55, -0.42), 0.045, 0.34, { roof: 'dome', lit: 2 });
  spireTower(k, onN(0.62, 0.1), 0.04, 0.3, { lit: 2 });
  // halls stepping round the back and east end of the ledge
  hall(k, { at: onN(0.55, -0.45), yaw: -8, w: 0.3, d: 0.15, h: 0.11, windows: 1 });
  hall(k, { at: onN(-0.25, -0.58), yaw: 6, w: 0.28, d: 0.14, h: 0.1, windows: 1 });
  hall(k, { at: onN(0.62, 0.36), yaw: -25, w: 0.26, d: 0.14, h: 0.1, roof: 'hip', pitch: 50, windows: 1 });
  hall(k, { at: onN(0.25, -0.62), yaw: 10, w: 0.24, d: 0.13, h: 0.1, windows: 1 });
  // the colonnade along the ledge's lip, open to the gorge, and a gazebo at its east end
  k.arcade('stone', onN(-0.35, 0.55), onN(0.4, 0.58), { count: 9, h: 0.075, archH: 0.055, pier: 0.012, depth: 0.03, deck: true, color: STONE, lod: 0 });
  gazebo(k, onN(0.52, 0.52), 0.045, true);
  // the round Council court on the ledge's western lip: a pale floor, a ring of slender pillars and their
  // ring beam, open to the sky
  const [cx, cz] = onN(-0.52, 0.42);
  k.lathe(
    'stone',
    [
      [0.14, 0],
      [0.14, 0.012],
    ],
    { at: [cx, y - 0.005, cz], seg: 20, color: STONE2 },
  );
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.cylinder('stone', 0.006, 0.007, 0.075, { at: [cx + Math.cos(a) * 0.12, y + 0.007, cz + Math.sin(a) * 0.12], seg: 6, color: STONE, lod: 0 });
  }
  k.ring('stone', 0.12, 0.014, 0.01, { at: [cx, y + 0.082, cz], seg: 24, color: STONE, lod: 0 });
  k.light([cx, y + 0.06, cz], { color: LAMP, intensity: 1.2, radius: 0.015, kind: 'lamp' });
  balustrade(k, l, 122, 255, l.r - 0.12, 5);
  // a long stair from the ledge's east end down to the gorge floor
  k.stairs('stone', [[onN(0.72, 0.42)[0], Number.NaN, onN(0.72, 0.42)[1]], [1.05, Number.NaN, -1.05], [1.3, Number.NaN, -0.72]], 0.035, { stepKm: 0.03, color: STONE2, lod: 0 });
}

/** the halls on the south ledge, across the gorge */
function buildSouthLedge(k: ProxyKit): void {
  const l = LEDGE_S;
  ledgeLip(k, l, 290, 420, l.r + 0.08);
  hall(k, { at: onS(0.05, -0.12), yaw: 180, w: 0.42, d: 0.18, h: 0.13, pitch: 57, windows: 2 });
  hall(k, { at: onS(-0.3, 0.14), yaw: 95, w: 0.3, d: 0.15, h: 0.11, windows: 1 });
  hall(k, { at: onS(0.3, 0.18), yaw: 85, w: 0.28, d: 0.15, h: 0.11, roof: 'hip', pitch: 50, windows: 1 });
  hall(k, { at: onS(-0.05, 0.36), yaw: 175, w: 0.26, d: 0.13, h: 0.1, windows: 1 });
  spireTower(k, onS(0.28, -0.3), 0.045, 0.4, { lit: 2 });
  spireTower(k, onS(-0.35, -0.25), 0.04, 0.28, { roof: 'dome', lit: 2 });
  gazebo(k, onS(-0.12, -0.42), 0.05, true);
  k.arcade('stone', onS(-0.45, -0.45), onS(0.35, -0.5), { count: 7, h: 0.07, archH: 0.05, pier: 0.012, depth: 0.03, deck: true, color: STONE, lod: 0 });
  balustrade(k, l, 290, 420, l.r - 0.12, 3);
}

interface TreeSpot {
  at: V2;
  r: number;
  n: number;
  crown: [number, number];
}

/**
 * ~110 autumn trees (VegetationSystem hero clusters): on both ledges between the halls, along the stream on
 * the gorge floor, on the lower wall faces and along the plateau rims — pure function of the seed.
 */
const SPOTS: TreeSpot[] = [
  // the north ledge, round the house
  { at: onN(0.0, 0.0), r: 0.7, n: 12, crown: [0.07, 0.11] },
  // the south ledge
  { at: onS(0.0, 0.0), r: 0.5, n: 8, crown: [0.07, 0.1] },
  // the up-valley shelves
  { at: LEDGE_NE.at, r: 0.4, n: 4, crown: [0.07, 0.1] },
  { at: LEDGE_SE.at, r: 0.38, n: 4, crown: [0.07, 0.1] },
  // the gorge floor, along the stream (the valley filled with autumn woods)
  { at: [3.2, -0.75], r: 0.7, n: 9, crown: [0.09, 0.15] },
  { at: [2.0, -0.2], r: 0.6, n: 8, crown: [0.1, 0.16] },
  { at: [0.9, 0.55], r: 0.55, n: 8, crown: [0.1, 0.16] },
  { at: [-0.3, 0.95], r: 0.5, n: 7, crown: [0.1, 0.15] },
  { at: [-1.5, 1.15], r: 0.55, n: 8, crown: [0.1, 0.15] },
  { at: [-1.2, -0.15], r: 0.5, n: 6, crown: [0.1, 0.15] },
  { at: [-2.8, 0.1], r: 0.6, n: 7, crown: [0.1, 0.15] },
  { at: [4.6, -1.75], r: 0.7, n: 8, crown: [0.1, 0.15] },
  // the plateau rims
  { at: [1.2, -3.1], r: 0.7, n: 6, crown: [0.12, 0.18] },
  { at: [0.8, 2.8], r: 0.7, n: 6, crown: [0.12, 0.18] },
  { at: [-2.6, 3.3], r: 0.6, n: 5, crown: [0.12, 0.17] },
];

/** keep-out circles: halls, towers, the court, the bridge's feet (trees never stand in a roof) */
const KEEP_OUT: { at: V2; r: number }[] = [
  { at: onN(-0.05, 0.1), r: 0.36 },
  { at: onN(-0.1, -0.35), r: 0.35 },
  { at: onN(0.5, -0.4), r: 0.2 },
  { at: onN(-0.52, 0.42), r: 0.17 },
  { at: onS(0.0, -0.05), r: 0.36 },
  ...SHELF_HALLS.map((h) => ({ at: h.at, r: 0.2 })),
];

export const TREES: TreeDecl[] = (() => {
  const out: TreeDecl[] = [];
  SPOTS.forEach((sp, si) => {
    let placed = 0;
    for (let t = 0; t < sp.n * 20 && placed < sp.n; t++) {
      const a = rand(SEED, si * 1000 + t, 0) * Math.PI * 2;
      const r = Math.sqrt(rand(SEED, si * 1000 + t, 1)) * sp.r;
      const at: V2 = [sp.at[0] + Math.cos(a) * r, sp.at[1] + Math.sin(a) * r];
      if (KEEP_OUT.some((c) => Math.hypot(at[0] - c.at[0], at[1] - c.at[1]) < c.r)) continue;
      if (out.some((q) => Math.hypot(q.at[0] - at[0], q.at[1] - at[1]) < 0.12)) continue;
      const c = sp.crown[0] + (sp.crown[1] - sp.crown[0]) * rand(SEED, si * 1000 + t, 2);
      out.push({ at, kind: 'autumn', crownKm: c, heightKm: c * 2.2, color: AUTUMN[Math.floor(rand(SEED, si * 1000 + t, 3) * AUTUMN.length) % AUTUMN.length], yawDeg: rand(SEED, si * 1000 + t, 4) * 360 });
      placed++;
    }
  });
  return out;
})();
