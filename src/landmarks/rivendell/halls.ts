import { hashString, rand } from '../../core/rng.ts';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import { SINK } from '../kit/ProxyKit.ts';
import type { ForestDecl, TreeDecl, V2 } from '../types.ts';
import { FLOOR, LEDGE_N, LEDGE_NE, LEDGE_S, LEDGE_SE, PAVILION, RAVINE_X, STREAM_WE } from './layout.ts';
import { archedBridge, BRONZE, deck, elvenTower, gallery, hall, LAMP, offsetPath, pavilion, STONE2, TRIM, VERDIGRIS } from './parts.ts';

/**
 * The halls, towers, court, galleries, terraces, bridge, rock and trees of Rivendell (local km, heading
 * 0). The main group — the Last Homely House (a long hall with a cross wing and a loggia under a swept
 * verdigris roof), its bronze-roofed wings and back halls, slender towers with ogee caps, the round
 * Council court, arched galleries along the terrace edge and two terraces cantilevered out over the gorge
 * on slender columns — stands on the spur-like north ledge above the stream; a second group on the south
 * ledge; single halls on the up-valley shelves; a thin arched bridge leaps the ravine of a waterfall to a
 * pavilion on a rock spur. The gorge walls are sheer faceted rock (kit cliffs over the stamped scarps);
 * golden broadleaves, pale-gold birches and slender firs, all kept under ~0.6 of the main hall's height
 * near the halls, mass on the ledges, the gorge floor and the moor above. Pure function of the module
 * constants and the kit's ground.
 */

const SEED = hashString('rivendell-halls');
/** grey rock of the gorge walls, a little warm (matches the terrain's rock; lit gold by the low sun) */
const ROCK = 0x5d605c;
/** autumn crowns: varied golden ochres, a few still green-gold */
const AUTUMN = [0xc9a040, 0xd4ae4c, 0xb8922f, 0xc69838, 0xa8862e, 0xdcbc5c, 0x9c963e];
/** feathery birches: pale gold */
const BIRCH = [0xd8c060, 0xe0c86a, 0xcdb24e];
/** slender firs among them */
const CONIFER = [0x2e4628, 0x283f24, 0x34502e, 0x3a4f2c];

/** local point of the ledge frame: u east, v south from a ledge centre */
const onN = (u: number, v: number): V2 => [LEDGE_N.at[0] + u, LEDGE_N.at[1] + v];
const onS = (u: number, v: number): V2 => [LEDGE_S.at[0] + u, LEDGE_S.at[1] + v];

/** halls on the two up-valley shelves: position, yaw, width, lit window slots per side, roof */
const SHELF_HALLS: { at: V2; yaw: number; w: number; lit: number; roof: number }[] = [
  { at: [LEDGE_NE.at[0] - 0.12, LEDGE_NE.at[1] + 0.12], yaw: -15, w: 0.3, lit: 2, roof: VERDIGRIS },
  { at: [LEDGE_SE.at[0] + 0.05, LEDGE_SE.at[1] - 0.1], yaw: 162, w: 0.3, lit: 2, roof: BRONZE },
  { at: [LEDGE_SE.at[0] - 0.22, LEDGE_SE.at[1] + 0.12], yaw: 170, w: 0.22, lit: 1, roof: VERDIGRIS },
];

export function buildRivendell(k: ProxyKit): void {
  buildNorthLedge(k);
  buildSouthLedge(k);
  // the two up-valley shelves: their lips, halls, a tower and a pavilion each
  ledgeLip(k, LEDGE_NE, 120, 250);
  ledgeLip(k, LEDGE_SE, 290, 410);
  for (const h of SHELF_HALLS) hall(k, { at: h.at, yaw: h.yaw, w: h.w, d: 0.15, h: 0.12, windows: h.lit, roof: h.roof });
  pavilion(k, [LEDGE_NE.at[0] - 0.25, LEDGE_NE.at[1] + 0.3], 0.035, false);
  pavilion(k, [LEDGE_SE.at[0] - 0.05, LEDGE_SE.at[1] - 0.32], 0.035, false, undefined, BRONZE);
  elvenTower(k, [LEDGE_NE.at[0] + 0.05, LEDGE_NE.at[1] - 0.25], 0.034, 0.36, { lit: 2, roof: VERDIGRIS });
  elvenTower(k, [LEDGE_SE.at[0] + 0.25, LEDGE_SE.at[1] + 0.05], 0.032, 0.3, { lit: 2 });
  // the pavilion on its rock spur and the thin, level bridge to it across the waterfall's ravine
  const y = PAVILION.h;
  pavilion(k, PAVILION.at, 0.045, true, Math.max(y, k.ground(PAVILION.at[0], PAVILION.at[1])) - 0.005);
  // its ends where the ravine's slopes rise to within 0.15 of the deck (≤ 0.5 km apart), each on a slim
  // tapered stone pier down to the rock
  const z = PAVILION.at[1];
  let ax = RAVINE_X;
  while (ax > LEDGE_N.at[0] && k.ground(ax, z) < y - 0.15) ax -= 0.01;
  let bx = RAVINE_X;
  while (bx < PAVILION.at[0] && k.ground(bx, z) < y - 0.15) bx += 0.01;
  const a: V2 = [ax, z];
  const b: V2 = [bx, z];
  archedBridge(k, [a[0], y + 0.005, a[1]], [b[0], y + 0.005, b[1]], { width: 0.04, rise: 0.3, camber: 0.03, color: TRIM });
  for (const [x, zz] of [a, b]) {
    const g = k.ground(x, zz) - SINK;
    k.cylinder('stone', 0.018, 0.026, y + 0.01 - g, { at: [x, g, zz], seg: 8, color: STONE2 });
  }
  k.light([(a[0] + b[0]) / 2, y + 0.06, a[1]], { color: LAMP, intensity: 1.1, radius: 0.015, kind: 'lamp' });
  gorgeCliffs(k);
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

/** the real rim of a ledge along compass bearing `bDeg`: the radius where the ground first drops 0.05 below
 * the terrace (null where the ground rises into the wall first) */
function rimRadius(k: ProxyKit, l: Ledge, bDeg: number): number | null {
  const b = (bDeg * Math.PI) / 180;
  const dx = Math.sin(b);
  const dz = -Math.cos(b);
  for (let r = 0.25; r < l.r + 0.3; r += 0.02) {
    const g = k.ground(l.at[0] + dx * r, l.at[1] + dz * r);
    if (g < l.h - 0.05) return r;
    if (g > l.h + 0.08) return null;
  }
  return null;
}
/** a point at bearing `bDeg`, `r` km from the ledge centre */
const atBearing = (l: Ledge, bDeg: number, r: number): V2 => [l.at[0] + Math.sin((bDeg * Math.PI) / 180) * r, l.at[1] - Math.cos((bDeg * Math.PI) / 180) * r];

/**
 * The rim rock of a ledge: a low band of the gorge's rock (≤ 0.14 km) along the upper edge of the ledge's
 * gorge-side slope, facing out (the kit cliff faces the right of its walking direction: counter-
 * clockwise). Its foot follows the slope, its top meets the terrace.
 */
function ledgeLip(k: ProxyKit, l: Ledge, from: number, to: number): void {
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
 * Points round a ledge (clockwise from bearing `from` to `to`) on its real edge, moved `inset` km inward;
 * bearings where the ground rises into a wall instead are left out, splitting the result into runs.
 */
function rimRuns(k: ProxyKit, l: Ledge, from: number, to: number, n: number, inset: number): V2[][] {
  const runs: V2[][] = [];
  let run: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const bd = from + ((to - from) * i) / n;
    const r = rimRadius(k, l, bd);
    if (r !== null) run.push(atBearing(l, bd, r - inset));
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
  const runs = rimRuns(k, l, from, to, 12, 0.1);
  for (const pts of runs) k.wallPath('stone', pts, 0.03, 0.008, { followGround: true, step: 0.06, color: TRIM, crenel: { w: 0.006, h: 0.01, gap: 0.01, lod: 0 }, lod: 0 });
  const all = runs.flat();
  for (let i = 0; i < lamps && all.length; i++) {
    const [x, z] = all[Math.min(all.length - 1, Math.round(((i + 0.5) / lamps) * (all.length - 1)))];
    k.light([x, k.ground(x, z) + 0.045, z], { color: LAMP, intensity: 1.0, radius: 0.012, kind: 'lamp' });
  }
}

/**
 * Two terraces cantilevered over the gorge from a ledge's rim between bearings b0 and b1: an upper deck at
 * the terrace level reaching `out` km beyond the rim, a lower one `drop` km below reaching further — thin
 * cream slabs with balustrades on their outer edges, on slender columns standing on the slope below.
 */
function cantilevers(k: ProxyKit, l: Ledge, b0: number, b1: number, out: number, drop: number): void {
  const r0 = rimRadius(k, l, b0);
  const r1 = rimRadius(k, l, b1);
  if (r0 === null || r1 === null) return;
  const bm = (b0 + b1) / 2;
  const rm = rimRadius(k, l, bm) ?? (r0 + r1) / 2;
  // the upper deck
  const up: V2[] = [atBearing(l, b0, r0 - 0.03), atBearing(l, b0, r0 + out), atBearing(l, bm, rm + out * 1.1), atBearing(l, b1, r1 + out), atBearing(l, b1, r1 - 0.03)];
  const cols = [atBearing(l, b0, r0 + out - 0.015), atBearing(l, bm, rm + out * 1.1 - 0.015), atBearing(l, b1, r1 + out - 0.015), atBearing(l, (b0 + bm) / 2, (r0 + rm) / 2 + out - 0.02), atBearing(l, (bm + b1) / 2, (rm + r1) / 2 + out - 0.02)];
  deck(k, up, l.h + 0.012, [0, 1, 2, 3], cols);
  // the lower deck, stepped down and further out (it starts where the slope reaches its level)
  const reach = (bd: number, r: number): number => {
    let rr = r;
    while (rr < r + 0.6 && k.ground(atBearing(l, bd, rr)[0], atBearing(l, bd, rr)[1]) > l.h - drop + 0.01) rr += 0.01;
    return rr;
  };
  const q0 = reach(b0 + 6, r0);
  const q1 = reach(b1 + 6, r1);
  const lo: V2[] = [atBearing(l, b0 + 6, q0 - 0.03), atBearing(l, b0 + 6, q0 + out * 1.3), atBearing(l, b1 + 6, q1 + out * 1.3), atBearing(l, b1 + 6, q1 - 0.03)];
  const cols2 = [0.25, 0.5, 0.75, 1].map((f) => {
    const bd = b0 + 6 + (b1 - b0) * f;
    return atBearing(l, bd, q0 + (q1 - q0) * f + out * 1.3 - 0.015);
  });
  cols2.push(atBearing(l, b0 + 6, q0 + out * 1.3 - 0.015));
  deck(k, lo, l.h - drop + 0.012, [0, 1, 2], cols2);
  return;
}

/** the Last Homely House and its court on the north ledge */
function buildNorthLedge(k: ProxyKit): void {
  const l = LEDGE_N;
  ledgeLip(k, l, 100, 330);
  // the house: a long hall with a cross wing and a loggia facing the gorge, two bronze wings running
  // back, a tall hall closing the court behind, a small hall on the east lip
  hall(k, { at: onN(-0.12, 0.14), yaw: 0, w: 0.74, d: 0.28, h: 0.22, rise: 0.27, windows: 4, cross: true, loggia: true });
  hall(k, { at: onN(-0.5, -0.12), yaw: 90, w: 0.4, d: 0.21, h: 0.19, rise: 0.2, windows: 2, roof: BRONZE });
  hall(k, { at: onN(0.38, -0.12), yaw: 90, w: 0.38, d: 0.2, h: 0.19, rise: 0.2, windows: 2, roof: BRONZE });
  hall(k, { at: onN(-0.1, -0.42), yaw: 0, w: 0.56, d: 0.22, h: 0.24, rise: 0.24, windows: 3 });
  hall(k, { at: onN(0.66, 0.12), yaw: -25, w: 0.3, d: 0.17, h: 0.15, windows: 1, loggia: true });
  // terraces stepping up the ledge's back where the wall begins to rise: platforms of cream masonry
  // (their downhill faces retaining walls) with halls on them
  for (const [u, v, w, d, yaw, roof] of [
    [-0.36, -0.8, 0.5, 0.3, 4, VERDIGRIS],
    [0.42, -0.74, 0.44, 0.28, -10, BRONZE],
  ] as const) {
    const cy = Math.cos((yaw * Math.PI) / 180);
    const sy = Math.sin((yaw * Math.PI) / 180);
    const corner = (a: number, b: number): V2 => [a * cy + b * sy, -a * sy + b * cy];
    const outline = [corner(-w / 2, -d / 2), corner(w / 2, -d / 2), corner(w / 2, d / 2), corner(-w / 2, d / 2)];
    // slide it toward the ledge's middle until it stands where the wall has only begun to rise (a
    // platform 0.05–0.2 above the ledge on its uphill side, never a tower up the cliff)
    let f = 1;
    const relief = (c: V2) => {
      const gs = [...outline.map(([x, z]) => k.ground(c[0] + x, c[1] + z)), k.ground(c[0], c[1])];
      return Math.max(...gs) - Math.min(...gs);
    };
    while (f > 0.55 && relief(onN(u * f, v * f)) > 0.18) f -= 0.03;
    const c = onN(u * f, v * f);
    if (relief(c) > 0.18) continue;
    const top = Math.max(...outline.map(([x, z]) => k.ground(c[0] + x, c[1] + z))) + 0.05;
    k.extrude('stone', outline, 0.05, { at: [c[0], 0, c[1]], followGround: true, color: STONE2 });
    hall(k, { at: c, yaw, w: w * 0.8, d: d * 0.66, h: 0.17, rise: 0.19, windows: 2, roof, floor: top });
  }
  // slender towers with ogee caps (the group's silhouette)
  elvenTower(k, onN(0.28, 0.32), 0.05, 0.82, { lit: 3, roof: BRONZE });
  elvenTower(k, onN(-0.62, -0.32), 0.045, 0.56, { lit: 2, roof: VERDIGRIS });
  elvenTower(k, onN(0.8, -0.3), 0.042, 0.48, { lit: 1 });
  // the round Council court on the ledge's western lip: a pale floor, a ring of slender columns and their
  // ring beam, open to the sky
  const [cx, cz] = onN(-0.62, 0.4);
  const y = Math.min(k.ground(cx, cz), l.h);
  k.lathe(
    'stone',
    [
      [0.16, 0],
      [0.16, 0.012],
    ],
    { at: [cx, y - 0.005, cz], seg: 20, color: TRIM },
  );
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    k.cylinder('stone', 0.006, 0.007, 0.09, { at: [cx + Math.cos(a) * 0.135, y + 0.007, cz + Math.sin(a) * 0.135], seg: 6, color: TRIM, lod: 0 });
  }
  k.ring('stone', 0.135, 0.014, 0.012, { at: [cx, y + 0.097, cz], seg: 24, color: TRIM, lod: 0 });
  k.light([cx, y + 0.05, cz], { color: LAMP, intensity: 1.2, radius: 0.015, kind: 'lamp' });
  // arched galleries along the terrace's gorge edge, a pavilion at its east end
  const runs = rimRuns(k, l, 150, 235, 10, 0.14);
  for (const run of runs) {
    for (let i = 0; i + 1 < run.length; i += 2) {
      const a = run[i];
      const b = run[Math.min(run.length - 1, i + 2)];
      if (Math.hypot(a[0] - cx, a[1] - cz) < 0.2 || Math.hypot(b[0] - cx, b[1] - cz) < 0.2) continue;
      const gy = Math.min(k.ground(a[0], a[1]), k.ground(b[0], b[1])) - SINK;
      gallery(k, a, b, gy, 0.075, Math.max(3, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.04)));
    }
  }
  pavilion(k, onN(0.6, 0.36), 0.05, true);
  // terraces cantilevered over the gorge on the south-east rim
  cantilevers(k, l, 128, 152, 0.16, 0.16);
  balustrade(k, l, 100, 125, 2);
  balustrade(k, l, 236, 300, 2);
}

/** the halls on the south ledge, across the gorge */
function buildSouthLedge(k: ProxyKit): void {
  const l = LEDGE_S;
  ledgeLip(k, l, 290, 420);
  hall(k, { at: onS(0.05, 0.0), yaw: 180, w: 0.42, d: 0.18, h: 0.15, rise: 0.17, windows: 2, cross: true, loggia: true });
  hall(k, { at: onS(-0.3, 0.14), yaw: 95, w: 0.3, d: 0.15, h: 0.13, windows: 1, roof: BRONZE });
  hall(k, { at: onS(0.3, 0.18), yaw: 85, w: 0.28, d: 0.15, h: 0.13, windows: 1 });
  hall(k, { at: onS(-0.05, 0.42), yaw: 175, w: 0.26, d: 0.13, h: 0.12, windows: 1, roof: BRONZE });
  elvenTower(k, onS(0.28, -0.3), 0.038, 0.48, { lit: 2, roof: VERDIGRIS });
  elvenTower(k, onS(-0.35, -0.25), 0.034, 0.32, { lit: 2 });
  pavilion(k, onS(-0.5, -0.2), 0.045, true);
  const runs = rimRuns(k, l, 300, 410, 10, 0.12);
  for (const run of runs)
    for (let i = 0; i + 2 < run.length; i += 3) {
      const a = run[i];
      const b = run[i + 2];
      const gy = Math.min(k.ground(a[0], a[1]), k.ground(b[0], b[1])) - SINK;
      gallery(k, a, b, gy, 0.07, Math.max(3, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.04)));
    }
  cantilevers(k, l, 318, 340, 0.13, 0.14);
}

/**
 * The gorge's sheer walls: faceted rock faces (kit cliffs) seated at the foot of the stamped scarps on
 * both sides (the wall behind the main ledge is the terrain's own rock), each about as tall as the terrain rises within 0.8 km behind its
 * foot (so the face meets the slope above and never stands proud as a fin), strata, buttresses and
 * gullies; gaps where the ledges and the ravine break the walls.
 */
function gorgeCliffs(k: ProxyKit): void {
  const north = offsetPath(STREAM_WE, FLOOR + 0.12);
  const south = offsetPath(STREAM_WE, -(FLOOR + 0.12));
  const pick = (path: V2[], x0: number, x1: number): V2[] => {
    // resample the offset line every ≤ 0.25 km between x0 and x1
    const out: V2[] = [];
    for (let i = 0; i + 1 < path.length; i++) {
      const [ax, az] = path[i];
      const [bx, bz] = path[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
      for (let j = 0; j < n; j++) {
        const t = j / n;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        if (x >= x0 && x <= x1) out.push([x, z]);
      }
    }
    return out;
  };
  /** the terrain's rise within `d` km behind the foot (into the wall: the left of the walking direction) */
  const rise = (pts: V2[], i: number, d: number): number => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = (b[1] - a[1]) / l;
    const nz = -(b[0] - a[0]) / l;
    const [x, z] = pts[i];
    return k.ground(x + nx * d, z + nz * d) - k.ground(x, z);
  };
  const face = (pts: V2[], wet: number[]) => {
    if (pts.length < 3) return;
    // as tall as the wall rises within 0.8 km (its top meets the rim), less a little for the jagged skyline
    const hs = pts.map((_, i) => Math.min(3.4, Math.max(0.25, rise(pts, i, 0.8) * 0.74)));
    k.cliff('weathered', pts, hs, { color: ROCK, rough: 0.32, strata: 0.6, depth: 1.1, soft: 0.6, taper: 0.4 });
    // the falls' wet rock is the S4 waterfalls' own halo (a separate dark strip here stood proud of the
    // face's jagged skyline as an obelisk)
    void wet;
  };
  // north wall: walking east, the face looks right = south, toward the stream
  face(pick(north, 1.9, 6.6), [3.4]);
  // south wall: walking west, the face looks right = north, toward the stream
  face(pick(south, -3.8, -2.5).reverse(), []);
  face(pick(south, -0.75, 0.85).reverse(), [-0.3]);
  face(pick(south, 1.85, 6.6).reverse(), [3.05]);
}

/** keep-out circles: halls, towers, the court, the pavilion (trees never stand in a roof) */
const KEEP_OUT: { at: V2; r: number }[] = [
  // the terraces themselves stay mostly open (a few ornamental trees from the ledge bands' inner edge)
  { at: LEDGE_N.at, r: LEDGE_N.r - 0.05 },
  { at: LEDGE_S.at, r: LEDGE_S.r - 0.1 },
  { at: PAVILION.at, r: 0.1 },
  ...SHELF_HALLS.map((h) => ({ at: h.at, r: 0.22 })),
];

/** Wooded bands (local polylines). `conifer` / `birch`: shares; `scale`: crown size factor range. */
interface Band {
  path: V2[];
  /** half width of the band, km */
  hw: number;
  n: number;
  conifer: number;
  birch: number;
  scale: [number, number];
}

const FOOT_N = offsetPath(STREAM_WE, FLOOR * 0.75).filter(([x]) => x > -3.8 && x < 6.5);
const FOOT_S = offsetPath(STREAM_WE, -FLOOR * 0.75).filter(([x]) => x > -3.8 && x < 6.5);
const RIM_N = offsetPath(STREAM_WE, FLOOR + 1.5).filter(([x]) => x > -0.4 && x < 5.5);
const RIM_S = offsetPath(STREAM_WE, -(FLOOR + 1.4)).filter(([x]) => x > -3.2 && x < 5.5);
const RIM_N2 = offsetPath(STREAM_WE, FLOOR + 2.4).filter(([x]) => x > 0.2 && x < 5.0);
const RIM_S2 = offsetPath(STREAM_WE, -(FLOOR + 2.3)).filter(([x]) => x > -2.8 && x < 5.0);

const BANDS: Band[] = [
  // the ledges: between and round the halls, and down their gorge-side slopes under the lips
  { path: arc(LEDGE_N, 95, 270, LEDGE_N.r + 0.1, 8), hw: 0.14, n: 13, conifer: 0.2, birch: 0.3, scale: [0.4, 0.7] },
  { path: arc(LEDGE_S, 280, 430, LEDGE_S.r + 0.08, 7), hw: 0.12, n: 10, conifer: 0.2, birch: 0.3, scale: [0.35, 0.6] },
  { path: arc(LEDGE_NE, 110, 260, LEDGE_NE.r + 0.08, 4), hw: 0.1, n: 3, conifer: 0.4, birch: 0.2, scale: [0.4, 0.65] },
  { path: arc(LEDGE_SE, 280, 420, LEDGE_SE.r + 0.08, 4), hw: 0.1, n: 3, conifer: 0.4, birch: 0.2, scale: [0.4, 0.65] },
  // the gorge floor along both wall feet: the valley filled with golden woods
  { path: FOOT_N, hw: 0.2, n: 16, conifer: 0.3, birch: 0.25, scale: [0.45, 0.75] },
  { path: FOOT_S, hw: 0.2, n: 17, conifer: 0.3, birch: 0.25, scale: [0.45, 0.75] },
  // the woods on the moor over the gorge's rims
  { path: RIM_N, hw: 0.6, n: 16, conifer: 0.5, birch: 0.15, scale: [0.4, 0.7] },
  { path: RIM_S, hw: 0.6, n: 18, conifer: 0.5, birch: 0.15, scale: [0.4, 0.7] },
  { path: RIM_N2, hw: 0.5, n: 6, conifer: 0.55, birch: 0.1, scale: [0.4, 0.7] },
  { path: RIM_S2, hw: 0.5, n: 7, conifer: 0.55, birch: 0.1, scale: [0.4, 0.7] },
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

/** the ledge bands (round the halls: characterful individuals, always drawn) vs the woods (forests) */
const LEDGE_BANDS = BANDS.slice(0, 4);
const WOOD_BANDS = BANDS.slice(4);

const pathLength = (p: V2[]) => p.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);

/**
 * The woods of the gorge floor and the rims as landmark forests (placed by the vegetation system:
 * chunked, LOD-capped, thinned with the quality density): golden ochre broadleaves, pale-gold birches and
 * slender firs, kept small (≤ ~0.25 km, against the main hall 0.49 high), dense, clumped by stand noise, never
 * inside the halls' keep-out circles. The gorge faces are sheer rock (kit cliffs): no trees there.
 */
export const FORESTS: ForestDecl[] = WOOD_BANDS.map((b) => ({
  area: { band: { path: b.path, halfWidth: b.hw } },
  density: (b.n * 16) / Math.max(0.05, pathLength(b.path) * 2 * b.hw * 0.45),
  species: [
    { kind: 'autumn', share: 1 - b.conifer - b.birch, crownKm: [0.1 * b.scale[0], 0.1 * b.scale[1]], heightFactor: [2.0, 2.4], colors: AUTUMN },
    { kind: 'poplar', share: b.birch, crownKm: [0.06 * b.scale[0], 0.06 * b.scale[1]], heightFactor: [3.2, 3.8], colors: BIRCH },
    { kind: 'conifer', share: b.conifer, crownKm: [0.06 * b.scale[0], 0.06 * b.scale[1]], heightFactor: [4.0, 4.6], colors: CONIFER },
  ],
  clump: { scaleKm: 0.25, amount: 0.7 },
  edgeKm: 0.05,
  maxSlopeDeg: 62,
  avoid: KEEP_OUT,
}));

/**
 * ~120 authored trees (VegetationSystem hero clusters) in clumps of 3–7 along the ledge bands round the
 * halls: golden ochre broadleaves, pale-gold birches and slender firs of mixed sizes, every one under
 * 0.27 km (≤ 0.6 of the Last Homely House, 0.49 to its ridge) — pure function of the seed.
 */
export const TREES: TreeDecl[] = (() => {
  const out: TreeDecl[] = [];
  let id = 0;
  LEDGE_BANDS.forEach((b, bi) => {
    for (let c = 0; c < b.n; c++) {
      const key = bi * 100 + c;
      const { p, n } = along(b.path, (c + 0.25 + 0.5 * rand(SEED, key, 0)) / b.n);
      const off = (rand(SEED, key, 1) - 0.5) * 2 * b.hw;
      const centre: V2 = [p[0] + n[0] * off, p[1] + n[1] * off];
      const count = 3 + Math.floor(rand(SEED, key, 2) * 5);
      const cr = 0.08 + 0.06 * rand(SEED, key, 3);
      for (let t = 0; t < count * 6 && count > 0; t++) {
        const r = id++;
        const a = rand(SEED, r, 4) * Math.PI * 2;
        const d = Math.sqrt(rand(SEED, r, 5)) * cr;
        const at: V2 = [centre[0] + Math.cos(a) * d, centre[1] + Math.sin(a) * d];
        if (KEEP_OUT.some((q) => Math.hypot(at[0] - q.at[0], at[1] - q.at[1]) < q.r)) continue;
        if (out.some((q) => Math.hypot(q.at[0] - at[0], q.at[1] - at[1]) < 0.04)) continue;
        const scale = b.scale[0] + (b.scale[1] - b.scale[0]) * rand(SEED, r, 6);
        const crown = 0.1 * scale;
        const yawDeg = rand(SEED, r, 7) * 360;
        const kind = rand(SEED, r, 8);
        const pickC = (pal: number[]) => pal[Math.floor(rand(SEED, r, 9) * pal.length) % pal.length];
        if (kind < b.conifer) out.push({ at, kind: 'conifer', crownKm: crown * 0.5, heightKm: Math.min(0.27, crown * 2.4), color: pickC(CONIFER), yawDeg });
        else if (kind < b.conifer + b.birch) out.push({ at, kind: 'poplar', crownKm: crown * 0.55, heightKm: Math.min(0.27, crown * 2.1), color: pickC(BIRCH), yawDeg });
        else out.push({ at, kind: 'autumn', crownKm: crown, heightKm: Math.min(0.27, crown * 2.2), color: pickC(AUTUMN), yawDeg });
        if (out.filter((q) => Math.hypot(q.at[0] - centre[0], q.at[1] - centre[1]) <= cr + 1e-6).length >= count) break;
      }
    }
  });
  return out;
})();
