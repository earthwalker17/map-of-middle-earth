import { hashString, rand } from '../../core/rng.ts';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { TreeDecl, V2 } from '../types.ts';
import { FALLS, FLOOR, LEDGE_N, LEDGE_NE, LEDGE_S, LEDGE_SE, PAVILION, RAVINE_X, STREAM_WE } from './layout.ts';
import { archedBridge, fallStreak, hall, LAMP, offsetPath, spireTower, STONE, STONE2 } from './parts.ts';

/**
 * The halls, towers, court, colonnades, bridge, rim rock, lamps, waterfall streaks and trees of Rivendell
 * (local km, heading 0). The main group — the Last Homely House (cross-gabled, dormered, a tall slender
 * spire beside it), its wings, the round Council court and a colonnade along the ledge's lip — stands on
 * the north ledge, facing the afternoon sun across the gorge; a second group on the south ledge; single
 * halls on the up-valley shelves; a thin, level arched bridge leaps from the main ledge across the
 * ravine of a waterfall to a pavilion on a rock pillar. Woods of autumn broadleaves and dark conifers
 * mass along the ledges, the wall feet and the wall faces. Everything is a pure function of the module
 * constants and the kit's ground.
 */

const SEED = hashString('rivendell-halls');
/** warm grey-brown rock of the gorge walls (research §4 palette: #876950 / #634935 / #ada182, lit gold) */
const ROCK = 0x6b6559;
/** autumn crowns (#b5702a / #d19a3a and between), a few still green-gold */
const AUTUMN = [0xb5702a, 0xd19a3a, 0xc4822f, 0xa8602a, 0xd6a646, 0x9c8a3a];
/** dark conifers among them */
const CONIFER = [0x2a4226, 0x233a22, 0x2f4a2b, 0x31472a];

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
  ledgeLip(k, LEDGE_NE, 120, 250);
  ledgeLip(k, LEDGE_SE, 290, 410);
  for (const h of SHELF_HALLS) hall(k, { at: h.at, yaw: h.yaw, w: h.w, d: 0.15, h: 0.1, windows: h.lit, dormers: 1 });
  gazebo(k, [LEDGE_NE.at[0] - 0.25, LEDGE_NE.at[1] + 0.3], 0.04, false);
  gazebo(k, [LEDGE_SE.at[0] - 0.05, LEDGE_SE.at[1] - 0.32], 0.04, false);
  spireTower(k, [LEDGE_NE.at[0] + 0.05, LEDGE_NE.at[1] - 0.25], 0.04, 0.34, { lit: 2 });
  spireTower(k, [LEDGE_SE.at[0] + 0.25, LEDGE_SE.at[1] + 0.05], 0.04, 0.26, { roof: 'dome', lit: 2 });
  // the pavilion on its rock spur and the thin, level bridge to it across the waterfall's ravine
  const y = PAVILION.h;
  gazebo(k, PAVILION.at, 0.05, true, Math.max(y, k.ground(PAVILION.at[0], PAVILION.at[1])) - 0.005);
  // its ends where the ravine's slopes rise to within 0.15 of the deck (≤ 0.5 km apart), each on a short
  // stone abutment down to the ground
  const z = PAVILION.at[1];
  let ax = RAVINE_X;
  while (ax > LEDGE_N.at[0] && k.ground(ax, z) < y - 0.15) ax -= 0.01;
  let bx = RAVINE_X;
  while (bx < PAVILION.at[0] && k.ground(bx, z) < y - 0.15) bx += 0.01;
  const a: V2 = [ax, z];
  const b: V2 = [bx, z];
  archedBridge(k, [a[0], y + 0.005, a[1]], [b[0], y + 0.005, b[1]], { width: 0.045, rise: 0.3, camber: 0.03, color: 0xe2d8c2 });
  for (const [x, zz] of [a, b]) {
    const g = k.ground(x, zz);
    k.box('stone', 0.05, y + 0.01 - g + 0.03, 0.06, { at: [x, g - 0.03, zz], color: STONE2 });
  }
  k.light([(a[0] + b[0]) / 2, y + 0.06, a[1]], { color: LAMP, intensity: 1.1, radius: 0.015, kind: 'lamp' });
  // the S4 waterfalls' static placeholders: pale streaks down the walls and the stream's falls
  for (const f of FALLS) fallStreak(k, [f.path[0][0], f.path[0][2]], [f.path[1][0], f.path[1][2]], f.width * 0.55);
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
 * The rim rock of a ledge: a low band of the gorge's rock (≤ 0.14 km, so the jagged skyline stays under
 * ~0.18) along the upper edge of the ledge's gorge-side slope. `arc` walks clockwise (bearing
 * increasing) and the kit cliff faces the RIGHT of its walking direction, which on a clockwise circle is
 * the centre — so the path is reversed (counter-clockwise) and the face looks out over the gorge. Its
 * foot follows the slope, its top meets the terrace: a natural stone edge under the halls and trees; the
 * terrain's steep face carries it on down to the gorge floor.
 */
function ledgeLip(k: ProxyKit, l: Ledge, from: number, to: number): void {
  // along each bearing, the terrace's real edge (the 0.4 km heightfield rounds the flattened disc off
  // well inside its nominal radius), with an irregular jitter (±0.04) so the lip reads as rock
  for (const run of rimRuns(k, l, from, to, 12, 0)) {
    const pts = run
      .map(([x, z], i): V2 => {
        const f = 1 + (0.04 * Math.sin(i * 2.3 + l.at[0] * 7)) / Math.max(0.2, Math.hypot(x - l.at[0], z - l.at[1]));
        return [l.at[0] + (x - l.at[0]) * f, l.at[1] + (z - l.at[1]) * f];
      })
      .reverse();
    k.cliff(
      'weathered',
      pts,
      pts.map(([x, z]) => Math.min(0.14, Math.max(0.05, l.h + 0.02 - k.ground(x, z)))),
      { color: ROCK, rough: 0.35, strata: 0.3, depth: 0.2, soft: 0.5, taper: 0.1 },
    );
  }
}

/**
 * Points round a ledge (clockwise from bearing `from` to `to`) on its real edge — where the ground first
 * drops 0.05 below the terrace — moved `inset` km inward; bearings where the ground rises into a wall
 * instead (the ledge's back) are left out, splitting the result into runs.
 */
function rimRuns(k: ProxyKit, l: Ledge, from: number, to: number, n: number, inset: number): V2[][] {
  const runs: V2[][] = [];
  let run: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const b = ((from + ((to - from) * i) / n) * Math.PI) / 180;
    const dx = Math.sin(b);
    const dz = -Math.cos(b);
    let r = 0.25;
    let edge = false;
    while (r < l.r + 0.3) {
      const g = k.ground(l.at[0] + dx * r, l.at[1] + dz * r);
      if (g < l.h - 0.05) {
        edge = true;
        break;
      }
      if (g > l.h + 0.08) break;
      r += 0.02;
    }
    if (edge) run.push([l.at[0] + dx * (r - inset), l.at[1] + dz * (r - inset)]);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs.filter((q) => q.length >= 3);
}

/** a balustrade along a ledge's rim (low pale wall with balusters, LOD0 only) with lanterns on it */
function balustrade(k: ProxyKit, l: Ledge, from: number, to: number, lamps: number): void {
  const runs = rimRuns(k, l, from, to, 12, 0.12);
  for (const pts of runs) k.wallPath('stone', pts, 0.034, 0.01, { followGround: true, step: 0.06, color: STONE, crenel: { w: 0.008, h: 0.012, gap: 0.012, lod: 0 }, lod: 0 });
  const all = runs.flat();
  for (let i = 0; i < lamps && all.length; i++) {
    const [x, z] = all[Math.min(all.length - 1, Math.round(((i + 0.5) / lamps) * (all.length - 1)))];
    k.light([x, k.ground(x, z) + 0.05, z], { color: LAMP, intensity: 1.0, radius: 0.012, kind: 'lamp' });
  }
}

/** an open gazebo: slender pillars under a pale dome (the film's filigree pavilions), LOD0 detail; `y` = its floor (default: the ground) */
function gazebo(k: ProxyKit, at: V2, r: number, lit: boolean, y = k.ground(at[0], at[1]) - 0.005): void {
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
  ledgeLip(k, l, 100, 262);
  // the house: a long cross-gabled main hall facing the gorge, two wings running back, a hall closing the
  // court behind, and the tall slender spire beside the main hall (the group's silhouette)
  hall(k, { at: onN(-0.15, 0.2), yaw: 0, w: 0.52, d: 0.2, h: 0.14, pitch: 52, windows: 3, cross: true, dormers: 2 });
  hall(k, { at: onN(-0.42, -0.02), yaw: 90, w: 0.34, d: 0.16, h: 0.12, windows: 2, dormers: 1 });
  hall(k, { at: onN(0.34, -0.04), yaw: 90, w: 0.32, d: 0.16, h: 0.12, windows: 2, dormers: 1 });
  hall(k, { at: onN(-0.05, -0.3), yaw: 0, w: 0.4, d: 0.17, h: 0.12, windows: 2, cross: true });
  spireTower(k, onN(0.22, 0.24), 0.042, 0.62, { lit: 3, spire: 5.5 });
  spireTower(k, onN(-0.55, -0.42), 0.045, 0.34, { roof: 'dome', lit: 2 });
  spireTower(k, onN(0.62, 0.1), 0.038, 0.3, { lit: 1 });
  // halls stepping round the back and east end of the ledge
  hall(k, { at: onN(0.55, -0.45), yaw: -8, w: 0.3, d: 0.15, h: 0.11, windows: 1, dormers: 1 });
  hall(k, { at: onN(-0.25, -0.58), yaw: 6, w: 0.28, d: 0.14, h: 0.1, windows: 1, dormers: 1 });
  hall(k, { at: onN(0.55, 0.12), yaw: -25, w: 0.26, d: 0.14, h: 0.1, windows: 1, dormers: 1 });
  hall(k, { at: onN(0.25, -0.62), yaw: 10, w: 0.24, d: 0.13, h: 0.1, windows: 1 });
  // the colonnade along the ledge's lip, open to the gorge, and a gazebo at its east end
  k.arcade('stone', onN(-0.6, 0.52), onN(-0.12, 0.54), { count: 9, h: 0.075, archH: 0.055, pier: 0.012, depth: 0.03, deck: true, color: STONE, lod: 0 });
  gazebo(k, onN(0.45, 0.15), 0.045, true);
  // the round Council court on the ledge's western lip: a pale floor, a ring of slender pillars and their
  // ring beam, open to the sky
  const [cx, cz] = onN(-0.52, 0.3);
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
  balustrade(k, l, 122, 255, 5);
}

/** the halls on the south ledge, across the gorge */
function buildSouthLedge(k: ProxyKit): void {
  const l = LEDGE_S;
  ledgeLip(k, l, 290, 420);
  hall(k, { at: onS(0.05, -0.12), yaw: 180, w: 0.42, d: 0.18, h: 0.13, pitch: 52, windows: 2, cross: true, dormers: 2 });
  hall(k, { at: onS(-0.3, 0.14), yaw: 95, w: 0.3, d: 0.15, h: 0.11, windows: 1, dormers: 1 });
  hall(k, { at: onS(0.3, 0.18), yaw: 85, w: 0.28, d: 0.15, h: 0.11, windows: 1 });
  hall(k, { at: onS(-0.05, 0.36), yaw: 175, w: 0.26, d: 0.13, h: 0.1, windows: 1, dormers: 1 });
  spireTower(k, onS(0.28, -0.3), 0.045, 0.44, { lit: 2, spire: 4.5 });
  spireTower(k, onS(-0.35, -0.25), 0.04, 0.28, { roof: 'dome', lit: 2 });
  gazebo(k, onS(-0.5, -0.2), 0.05, true);
  k.arcade('stone', onS(-0.4, -0.38), onS(0.3, -0.42), { count: 7, h: 0.07, archH: 0.05, pier: 0.012, depth: 0.03, deck: true, color: STONE, lod: 0 });
  balustrade(k, l, 290, 420, 3);
}

/** keep-out circles: halls, towers, the court, the pavilion (trees never stand in a roof) */
const KEEP_OUT: { at: V2; r: number }[] = [
  // the terraces themselves stay open (a few ornamental trees come from the ledge bands' inner edge)
  { at: LEDGE_N.at, r: LEDGE_N.r - 0.1 },
  { at: LEDGE_S.at, r: LEDGE_S.r - 0.1 },
  { at: onN(-0.15, 0.1), r: 0.38 },
  { at: onN(-0.1, -0.35), r: 0.35 },
  { at: onN(0.5, -0.4), r: 0.2 },
  { at: onN(0.22, 0.24), r: 0.08 },
  { at: onN(0.5, 0.14), r: 0.2 },
  { at: onN(-0.52, 0.3), r: 0.17 },
  { at: onS(0.0, -0.05), r: 0.38 },
  { at: PAVILION.at, r: 0.1 },
  ...SHELF_HALLS.map((h) => ({ at: h.at, r: 0.2 })),
];

/**
 * Wooded bands (local polylines): trees mass in overlapping clumps along them. `conifer`: the share of
 * dark conifers; `scale`: the crowns' size factor range (× 0.1 km); `n`: clumps.
 */
interface Band {
  path: V2[];
  /** half width of the band, km */
  hw: number;
  n: number;
  conifer: number;
  scale: [number, number];
}

const FOOT_N = offsetPath(STREAM_WE, FLOOR * 0.85).filter(([x]) => x > -3.8 && x < 6.5);
const FOOT_S = offsetPath(STREAM_WE, -FLOOR * 0.85).filter(([x]) => x > -3.8 && x < 6.5);
const FACE_N = offsetPath(STREAM_WE, FLOOR + 0.45).filter(([x]) => x > -0.6 && x < 6.5);
const FACE_S = offsetPath(STREAM_WE, -(FLOOR + 0.45)).filter(([x]) => x > -3.6 && x < 6.5);
const RIM_N = offsetPath(STREAM_WE, FLOOR + 1.2).filter(([x]) => x > -0.4 && x < 5.5);
const RIM_S = offsetPath(STREAM_WE, -(FLOOR + 1.1)).filter(([x]) => x > -3.2 && x < 5.5);
const RIM_N2 = offsetPath(STREAM_WE, FLOOR + 2.2).filter(([x]) => x > 0.2 && x < 5.0);
const RIM_S2 = offsetPath(STREAM_WE, -(FLOOR + 2.1)).filter(([x]) => x > -2.8 && x < 5.0);

const BANDS: Band[] = [
  // the ledges: between and round the halls, and down their gorge-side slopes under the lips
  { path: arc(LEDGE_N, 95, 270, LEDGE_N.r + 0.12, 8), hw: 0.14, n: 12, conifer: 0.15, scale: [0.5, 1.0] },
  { path: arc(LEDGE_S, 280, 430, LEDGE_S.r + 0.1, 7), hw: 0.12, n: 9, conifer: 0.15, scale: [0.5, 1.0] },
  { path: arc(LEDGE_NE, 110, 260, LEDGE_NE.r + 0.08, 4), hw: 0.1, n: 3, conifer: 0.4, scale: [0.6, 1.2] },
  { path: arc(LEDGE_SE, 280, 420, LEDGE_SE.r + 0.08, 4), hw: 0.1, n: 3, conifer: 0.4, scale: [0.6, 1.2] },
  // the gorge floor along both wall feet: the valley filled with autumn woods
  { path: FOOT_N, hw: 0.16, n: 14, conifer: 0.35, scale: [0.9, 1.6] },
  { path: FOOT_S, hw: 0.16, n: 15, conifer: 0.35, scale: [0.9, 1.6] },
  // the wall faces: dark conifers clinging to the rock, a few gold broadleaves
  { path: FACE_N, hw: 0.3, n: 15, conifer: 0.6, scale: [0.8, 1.4] },
  { path: FACE_S, hw: 0.3, n: 17, conifer: 0.6, scale: [0.8, 1.4] },
  // the woods on the moor over the gorge's rims
  { path: RIM_N, hw: 0.6, n: 16, conifer: 0.5, scale: [1.0, 1.6] },
  { path: RIM_S, hw: 0.6, n: 18, conifer: 0.5, scale: [1.0, 1.6] },
  { path: RIM_N2, hw: 0.5, n: 6, conifer: 0.55, scale: [0.9, 1.5] },
  { path: RIM_S2, hw: 0.5, n: 7, conifer: 0.55, scale: [0.9, 1.5] },
];

/** a point `t` (0..1) of the way along a polyline, and the unit normal there */
function along(path: V2[], t: number): { p: V2; n: V2 } {
  const seg = path.slice(1).map((q, i) => Math.hypot(q[0] - path[i][0], q[1] - path[i][1]));
  let s = t * seg.reduce((a, b) => a + b, 0);
  let i = 0;
  while (i < seg.length - 1 && s > seg[i]) s -= seg[i++];
  const f = Math.min(1, s / (seg[i] || 1));
  const a = path[i];
  const b = path[i + 1];
  const dx = (b[0] - a[0]) / (seg[i] || 1);
  const dz = (b[1] - a[1]) / (seg[i] || 1);
  return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], n: [dz, -dx] };
}

/**
 * ~550 authored trees (VegetationSystem hero clusters) massed in overlapping clumps of 3–7 along the
 * wooded bands: autumn broadleaves (#b5702a / #d19a3a and between) with ~40 % dark conifers, crowns
 * 0.06–0.16 km — pure function of the seed.
 */
export const TREES: TreeDecl[] = (() => {
  const out: TreeDecl[] = [];
  let id = 0;
  BANDS.forEach((b, bi) => {
    for (let c = 0; c < b.n; c++) {
      const key = bi * 100 + c;
      const { p, n } = along(b.path, (c + 0.25 + 0.5 * rand(SEED, key, 0)) / b.n);
      const off = (rand(SEED, key, 1) - 0.5) * 2 * b.hw;
      const centre: V2 = [p[0] + n[0] * off, p[1] + n[1] * off];
      const count = 3 + Math.floor(rand(SEED, key, 2) * 5);
      const cr = 0.1 + 0.08 * rand(SEED, key, 3);
      for (let t = 0; t < count * 6 && count > 0; t++) {
        const r = id++;
        const a = rand(SEED, r, 4) * Math.PI * 2;
        const d = Math.sqrt(rand(SEED, r, 5)) * cr;
        const at: V2 = [centre[0] + Math.cos(a) * d, centre[1] + Math.sin(a) * d];
        if (KEEP_OUT.some((q) => Math.hypot(at[0] - q.at[0], at[1] - q.at[1]) < q.r)) continue;
        if (out.some((q) => Math.hypot(q.at[0] - at[0], q.at[1] - at[1]) < 0.055)) continue;
        const scale = b.scale[0] + (b.scale[1] - b.scale[0]) * rand(SEED, r, 6);
        const crown = 0.1 * scale;
        const yawDeg = rand(SEED, r, 7) * 360;
        if (rand(SEED, r, 8) < b.conifer) {
          out.push({ at, kind: 'conifer', crownKm: crown * 0.8, heightKm: crown * 3.0, color: CONIFER[Math.floor(rand(SEED, r, 9) * CONIFER.length) % CONIFER.length], yawDeg });
        } else {
          out.push({ at, kind: 'autumn', crownKm: crown, heightKm: crown * 2.1, color: AUTUMN[Math.floor(rand(SEED, r, 9) * AUTUMN.length) % AUTUMN.length], yawDeg });
        }
        if (out.filter((q) => Math.hypot(q.at[0] - centre[0], q.at[1] - centre[1]) <= cr + 1e-6).length >= count) break;
      }
    }
  });
  return out;
})();
