import { hashString, rand } from '../../core/rng.ts';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import { SINK } from '../kit/ProxyKit.ts';
import type { ForestDecl, TreeDecl, V2 } from '../types.ts';
import { FLOOR, LEDGE_N, LEDGE_NE, LEDGE_S, LEDGE_SE, PAVILION, RAVINE_X, STREAM_WE } from './layout.ts';
import { archedBridge, BRONZE, deck, elvenTower, gallery, hall, type HallOpts, LAMP, offsetPath, pavilion, STONE2, TRIM, VERDIGRIS, VERDIGRIS2, VERDIGRIS3 } from './parts.ts';

/**
 * The halls, towers, court, galleries, terraces, bridge, rock and trees of Rivendell (local km, heading
 * 0). The main group — the Last Homely House (S4 W5: ten pavilions on four terrace levels, the front row
 * open to the gorge in colonnades, under straight-pitched verdigris roofs with bell-cast eaves), its
 * back halls, slender towers with ogee caps, the domed Council court, arched galleries along the terrace
 * edge and two terraces cantilevered out over the gorge on slender columns — stands on the spur-like
 * north ledge above the stream; a second group on the south ledge; paired halls on the up-valley shelves;
 * a thin arched bridge leaps the ravine of a waterfall to a pavilion on a rock spur. The gorge walls are
 * the stamped scarps (dark wet gully ledges under the north wall's falls); muted autumn broadleaves,
 * birches and slender firs, all kept under ~0.6 of the pavilions' height near the halls, mass on the
 * ledges, the gorge floor and in stands on the moor above. Pure function of the module constants and
 * the kit's ground.
 */

const SEED = hashString('rivendell-halls');
/** grey rock of the gorge walls, a little warm (matches the terrain's rock; lit gold by the low sun) */
const ROCK = 0x5d605c;
/** the dark, wet rock of the gullies under the falls */
const ROCK_WET = 0x34383a;
/**
 * autumn crowns (S4 W5, C2 #8: S3's read as candy — saturated orange, pink and cream lollipops): muted
 * ochres, rusts and olive-golds, 35 % less saturated and darker, no pinks
 */
const AUTUMN = [0x8a6a2a, 0x7e6228, 0x7a4a26, 0x6e4424, 0x6a6430, 0x75682e, 0x84622c, 0x5f5a2c];
/** the broadleaves still green: dull, dark olive greens (≈ 30 % of the broadleaf crowns) */
const GREEN = [0x4f5a30, 0x56602f, 0x48532c, 0x5c6334];
/** the green broadleaves' share of every stand */
const GREEN_SHARE = 0.3;
/** feathery birches: a dull gold (no cream) */
const BIRCH = [0xa89048, 0x9c8644, 0xb09a52];
/** slender firs among them */
const CONIFER = [0x2e4628, 0x283f24, 0x34502e, 0x3a4f2c];

/** local point of the ledge frame: u east, v south from a ledge centre */
const onN = (u: number, v: number): V2 => [LEDGE_N.at[0] + u, LEDGE_N.at[1] + v];
const onS = (u: number, v: number): V2 => [LEDGE_S.at[0] + u, LEDGE_S.at[1] + v];

/**
 * halls on the two up-valley shelves: position, yaw, width, lit window slots per side, roof (one each: the
 * level part of each shelf holds one hall on its platform beside a tower and a pavilion)
 */
const SHELF_HALLS: { at: V2; yaw: number; w: number; lit: number; roof: number }[] = [
  // (S4 W5, C2 #4: each shelf's one 0.3 km hall read as a cottage on the cliff — two pavilions each)
  { at: [LEDGE_NE.at[0] - 0.14, LEDGE_NE.at[1] - 0.04], yaw: -15, w: 0.16, lit: 1, roof: VERDIGRIS },
  { at: [LEDGE_NE.at[0] + 0.08, LEDGE_NE.at[1] - 0.16], yaw: -4, w: 0.14, lit: 1, roof: VERDIGRIS3 },
  { at: [LEDGE_SE.at[0] + 0.16, LEDGE_SE.at[1] + 0.06], yaw: 162, w: 0.16, lit: 1, roof: BRONZE },
  { at: [LEDGE_SE.at[0] - 0.05, LEDGE_SE.at[1] + 0.18], yaw: 172, w: 0.14, lit: 1, roof: VERDIGRIS2 },
];
/** the shelves' towers and pavilions: position, radius (the shelf halls keep clear of them) */
const SHELF_TOWERS: { at: V2; r: number; h: number; lit: number; roof?: number }[] = [
  { at: [LEDGE_NE.at[0] + 0.2, LEDGE_NE.at[1] - 0.3], r: 0.034, h: 0.36, lit: 2, roof: VERDIGRIS },
  { at: [LEDGE_SE.at[0] - 0.13, LEDGE_SE.at[1] + 0.28], r: 0.032, h: 0.3, lit: 2 },
];
const SHELF_PAVILIONS: { at: V2; roof?: number }[] = [{ at: [LEDGE_NE.at[0] - 0.3, LEDGE_NE.at[1] + 0.05] }, { at: [LEDGE_SE.at[0] + 0.27, LEDGE_SE.at[1] - 0.07], roof: BRONZE }];

/**
 * The back terraces of the main ledge: (u, v) from its centre, size, yaw, roof. Each slides toward the
 * ledge's middle (to no less than SLIDE_MIN of the way out) until it stands where the wall has only begun
 * to rise (buildNorthLedge); KEEP_OUT covers the whole slide.
 */
const BACK_TERRACES = [
  { u: -0.36, v: -0.8, w: 0.5, d: 0.3, yaw: 4, roof: VERDIGRIS2 },
  { u: 0.42, v: -0.74, w: 0.44, d: 0.28, yaw: -10, roof: VERDIGRIS },
] as const;
const SLIDE_MIN = 0.55;

/**
 * The Last Homely House's pavilions on the main ledge (S4 W5, C2 #4): (u, v) from the ledge's centre (v
 * south, toward the gorge), size, yaw, terrace level (LEVEL_STEP km each, 0 at the gorge), open front share,
 * roof (verdigris, varied; one bronze), lit windows.
 */
const HOUSE: { u: number; v: number; w: number; d: number; h: number; yaw: number; level: number; open?: number; cross?: boolean; roof: number; lit: number }[] = [
  { u: -0.36, v: 0.2, w: 0.19, d: 0.15, h: 0.16, yaw: 2, level: 0, open: 0.45, roof: VERDIGRIS, lit: 1 },
  { u: -0.13, v: 0.28, w: 0.2, d: 0.16, h: 0.18, yaw: -4, level: 0, open: 0.45, cross: true, roof: VERDIGRIS2, lit: 2 },
  { u: 0.12, v: 0.2, w: 0.17, d: 0.15, h: 0.16, yaw: 6, level: 0, open: 0.45, roof: VERDIGRIS3, lit: 1 },
  { u: 0.64, v: 0.12, w: 0.18, d: 0.14, h: 0.14, yaw: -25, level: 0, open: 0.5, roof: VERDIGRIS, lit: 1 },
  { u: -0.3, v: 0.0, w: 0.2, d: 0.15, h: 0.18, yaw: 0, level: 1, roof: VERDIGRIS2, lit: 2 },
  { u: -0.02, v: 0.03, w: 0.18, d: 0.14, h: 0.17, yaw: 10, level: 1, roof: BRONZE, lit: 1 },
  { u: -0.55, v: -0.15, w: 0.19, d: 0.15, h: 0.17, yaw: 90, level: 2, roof: VERDIGRIS3, lit: 1 },
  { u: 0.36, v: -0.12, w: 0.18, d: 0.14, h: 0.16, yaw: 84, level: 2, roof: VERDIGRIS, lit: 1 },
  { u: -0.28, v: -0.4, w: 0.2, d: 0.16, h: 0.19, yaw: 0, level: 3, roof: VERDIGRIS, lit: 2 },
  { u: 0.02, v: -0.44, w: 0.18, d: 0.15, h: 0.18, yaw: -6, level: 3, roof: VERDIGRIS2, lit: 1 },
];
/** the rise of one terrace level, km */
const LEVEL_STEP = 0.035;

export function buildRivendell(k: ProxyKit): void {
  buildNorthLedge(k);
  buildSouthLedge(k);
  // the two up-valley shelves: their lips, halls, a tower and a pavilion each
  ledgeLip(k, LEDGE_NE, 120, 250, true);
  ledgeLip(k, LEDGE_SE, 290, 410, true);
  const taken: { at: V2; r: number }[] = [...SHELF_TOWERS.map((t) => ({ at: t.at, r: t.r + 0.02 })), ...SHELF_PAVILIONS.map((p) => ({ at: p.at, r: 0.06 }))];
  for (const h of SHELF_HALLS) terraceHall(k, h.at, { yaw: h.yaw, w: h.w, d: 0.13, h: 0.12, windows: h.lit, roof: h.roof }, taken);
  for (const p of SHELF_PAVILIONS) pavilion(k, p.at, 0.035, false, undefined, p.roof);
  for (const t of SHELF_TOWERS) elvenTower(k, t.at, t.r, t.h, { lit: t.lit, roof: t.roof });
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

/** the four corners of a w × d rectangle turned by `yaw` (deg), relative to its centre */
function corners(w: number, d: number, yaw: number): V2[] {
  const cy = Math.cos((yaw * Math.PI) / 180);
  const sy = Math.sin((yaw * Math.PI) / 180);
  const c = (a: number, b: number): V2 => [a * cy + b * sy, -a * sy + b * cy];
  return [c(-w / 2, -d / 2), c(w / 2, -d / 2), c(w / 2, d / 2), c(-w / 2, d / 2)];
}

/** the ground's relief (max − min) under an outline placed at `c` */
function relief(k: ProxyKit, c: V2, outline: V2[]): number {
  const gs = [...outline.map(([x, z]) => k.ground(c[0] + x, c[1] + z)), k.ground(c[0], c[1])];
  return Math.max(...gs) - Math.min(...gs);
}

/**
 * A hall on a built terrace: a low cream platform (its foot following the ground, its downhill face a
 * retaining wall) with the hall standing on its level top — never a turf wedge hanging down the slope.
 * The spot is searched within 0.25 km of `at` for the flattest ground (relief ≤ 0.12 under the platform),
 * clear of the `taken` circles (towers, pavilions, the halls placed before it — the hall's own circle is
 * added); where there is none the hall is left out rather than raised on a pedestal.
 */
function terraceHall(k: ProxyKit, at: V2, o: Omit<HallOpts, 'at' | 'floor'>, taken: { at: V2; r: number }[]): void {
  const outline = corners(o.w + 0.06, o.d + 0.06, o.yaw);
  const own = o.w / 2 + 0.03;
  let best: { c: V2; r: number } | null = null;
  for (const [ring, n] of [
    [0, 1],
    [0.08, 8],
    [0.16, 12],
    [0.25, 16],
  ] as const) {
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2;
      const c: V2 = [at[0] + Math.cos(a) * ring, at[1] + Math.sin(a) * ring];
      if (taken.some((t) => Math.hypot(c[0] - t.at[0], c[1] - t.at[1]) < t.r + own)) continue;
      const r = relief(k, c, outline);
      if (!best || r < best.r - 1e-6) best = { c, r };
    }
    if (best && best.r <= 0.05) break;
  }
  if (!best || best.r > 0.12) return;
  const c = best.c;
  const top = Math.max(...outline.map(([x, z]) => k.ground(c[0] + x, c[1] + z)), k.ground(c[0], c[1])) + 0.03;
  k.extrude('stone', outline, 0.03, { at: [c[0], 0, c[1]], followGround: true, color: STONE2 });
  hall(k, { ...o, at: c, floor: top });
  taken.push({ at: c, r: own });
}

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
function ledgeLip(k: ProxyKit, l: Ledge, from: number, to: number, closeOnly = false): void {
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
      // (S4 W5 fix round: the up-valley shelves' lips close range only — with the gorge's dry kit ledges
      // gone, LOD0 fell to ≈ 27k tris and LOD1 must stay ≤ 25 % of it; the main ledges keep theirs)
      { color: ROCK, rough: 0.35, strata: 0.3, depth: 0.2, soft: 0.5, taper: 0.1, ...(closeOnly ? { lod: 0 as const } : {}) },
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
}

/** the Last Homely House and its court on the north ledge */
function buildNorthLedge(k: ProxyKit): void {
  const l = LEDGE_N;
  ledgeLip(k, l, 100, 330);
  // the house (S4 W5, C2 #4: S3's one long block under huge gables read as a chalet): pavilions of at most
  // 0.2 km on built terraces stepping up the ledge from the gorge in four levels — the front row open to
  // the gorge in colonnades, the middle and back rows closing the court, the west and east wings
  for (const p of HOUSE) {
    const c = onN(p.u, p.v);
    const outline = corners(p.w + 0.05, p.d + 0.05, p.yaw);
    const top = Math.max(...outline.map(([x, z]) => k.ground(c[0] + x, c[1] + z)), k.ground(c[0], c[1])) + 0.02 + LEVEL_STEP * p.level;
    k.extrude('stone', outline, 0.02 + LEVEL_STEP * p.level, { at: [c[0], 0, c[1]], followGround: true, color: STONE2 });
    hall(k, { at: c, yaw: p.yaw, w: p.w, d: p.d, h: p.h, windows: p.lit, roof: p.roof, floor: top, ...(p.open ? { open: p.open } : {}), ...(p.cross ? { cross: true } : {}) });
  }
  // terraces stepping up the ledge's back where the wall begins to rise: platforms of cream masonry
  // (their downhill faces retaining walls) with halls on them
  for (const { u, v, w, d, yaw, roof } of BACK_TERRACES) {
    const outline = corners(w, d, yaw);
    // slide it toward the ledge's middle until it stands where the wall has only begun to rise (a
    // platform 0.05–0.2 above the ledge on its uphill side, never a tower up the cliff)
    let f = 1;
    while (f > SLIDE_MIN && relief(k, onN(u * f, v * f), outline) > 0.18) f -= 0.03;
    const c = onN(u * f, v * f);
    if (relief(k, c, outline) > 0.18) continue;
    const top = Math.max(...outline.map(([x, z]) => k.ground(c[0] + x, c[1] + z))) + 0.05;
    k.extrude('stone', outline, 0.05, { at: [c[0], 0, c[1]], followGround: true, color: STONE2 });
    // two pavilions side by side on it (S4 W5, C2 #4: never one hall wider than 0.2 km)
    const cyw = Math.cos((yaw * Math.PI) / 180);
    const syw = Math.sin((yaw * Math.PI) / 180);
    for (const sd of [-1, 1]) {
      const at: V2 = [c[0] + sd * w * 0.25 * cyw, c[1] - sd * w * 0.25 * syw];
      hall(k, { at, yaw: yaw + sd * 4, w: w * 0.4, d: d * 0.62, h: sd > 0 ? 0.17 : 0.15, windows: 1, roof: sd > 0 ? roof : VERDIGRIS3, floor: top });
    }
  }
  // slender towers with ogee caps (the group's silhouette)
  elvenTower(k, onN(0.28, 0.32), 0.05, 0.82, { lit: 3, roof: BRONZE });
  elvenTower(k, onN(-0.62, -0.32), 0.045, 0.56, { lit: 2, roof: VERDIGRIS });
  elvenTower(k, onN(0.8, -0.3), 0.042, 0.48, { lit: 1, roof: VERDIGRIS3 });
  // the round Council court on the ledge's western lip: a pale floor, eight slender columns, their ring
  // beam and a shallow verdigris dome over them (S4 W5, C2 #4: the open ring read as a flat white hoop)
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
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    k.cylinder('stone', 0.007, 0.009, 0.1, { at: [cx + Math.cos(a) * 0.125, y + 0.007, cz + Math.sin(a) * 0.125], seg: 6, color: TRIM, lod: 0 });
  }
  k.ring('stone', 0.13, 0.016, 0.014, { at: [cx, y + 0.105, cz], seg: 24, color: TRIM, lod: 0 });
  k.lathe(
    'slate',
    [
      [0.15, 0],
      [0.145, 0.018],
      [0.12, 0.05],
      [0.075, 0.078],
      [0.03, 0.092],
      [0.002, 0.096],
    ],
    { at: [cx, y + 0.117, cz], seg: 12, color: VERDIGRIS2 },
  );
  k.cylinder('gold', 0.002, 0.004, 0.03, { at: [cx, y + 0.21, cz], seg: 4, color: 0xc8a050, lod: 0 });
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
  hall(k, { at: onS(-0.3, 0.14), yaw: 95, w: 0.3, d: 0.15, h: 0.13, windows: 1, roof: VERDIGRIS3 });
  hall(k, { at: onS(0.3, 0.18), yaw: 85, w: 0.28, d: 0.15, h: 0.13, windows: 1 });
  hall(k, { at: onS(-0.05, 0.42), yaw: 175, w: 0.26, d: 0.13, h: 0.12, windows: 1, roof: VERDIGRIS2 });
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
 * Points of a west → east path between x = xa and x = xb (xa < xb), every ≤ `step` km along it, the two
 * ends interpolated exactly (the offset stream lines run monotonically east).
 */
function spanX(path: V2[], xa: number, xb: number, step: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const lo = Math.max(xa, Math.min(ax, bx));
    const hi = Math.min(xb, Math.max(ax, bx));
    if (hi <= lo || bx === ax) continue;
    const L = (Math.hypot(bx - ax, bz - az) * (hi - lo)) / Math.abs(bx - ax);
    const n = Math.max(1, Math.ceil(L / step));
    for (let j = 0; j <= n; j++) {
      const x = lo + ((hi - lo) * j) / n;
      const p: V2 = [x, az + ((bz - az) * (x - ax)) / (bx - ax)];
      const last = out[out.length - 1];
      if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-6) out.push(p);
    }
  }
  return out;
}

/** half width of the wet gully under a fall, km */
const GULLY = 0.08;
/** the wet gullies' kit rock at the walls' feet: low ledges only (km) */
const CLIFF_CAP = 0.2;
/**
 * the dry kit ledges between the gullies (S4 W5 fix round: OFF — capped at 0.25 km they still read as a
 * row of uniform stepped blocks, a crenellated parapet behind the halls, and as pale shards on the south
 * wall; the stamped scarps carry the dry faces)
 */
const DRY_LEDGES = false;

/**
 * The gorge walls' kit rock: the stamped scarps carry the faces (S4 W5, C2 #13: the tall kit faces read as
 * folded paper); at the foot of the north wall, under each of its falls, a dark, water-worn gully ledge set
 * 0.06 km back into the wall (the wet streak), 0.55 of the terrain's rise within 0.8 km behind its foot,
 * capped at CLIFF_CAP, its foot resampled every 0.05 km. The south wall's gully read as a pale faceted slab
 * in the hero (fix round) and is gone; DRY_LEDGES switches the dry ledges between the gullies back on.
 */
function gorgeCliffs(k: ProxyKit): void {
  const north = offsetPath(STREAM_WE, FLOOR + 0.12);
  const south = offsetPath(STREAM_WE, -(FLOOR + 0.12));
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
  // S4 W5 (C2 #13: the tall kit faces read as folded paper — large flat facets): capped as ledges ≤ CLIFF_CAP;
  // the stamped scarps (steeper, ridged roughness) carry the walls above them
  const heights = (pts: V2[], f: number) => pts.map((_, i) => Math.min(CLIFF_CAP, Math.max(0.12, rise(pts, i, 0.8) * f)));
  /** one wall between x0 and x1 (`east`: walking east, i.e. the north wall), broken by gullies at `falls` */
  const wall = (path: V2[], x0: number, x1: number, east: boolean, falls: number[]) => {
    const cuts = [x0, ...falls.flatMap((f) => [f - GULLY, f + GULLY]), x1];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const wet = i % 2 === 1;
      let pts = spanX(path, cuts[i], cuts[i + 1], wet ? 0.05 : 0.12);
      if (!east) pts = pts.reverse();
      if (pts.length < 2) continue;
      if (wet) {
        // the gully: set back into the wall, a little lower than its neighbours, dark and smoother
        if (!east) continue;
        const back = offsetPath(pts, 0.06);
        // (close range only, like the faces round them: LOD1 and beyond show the stamped walls)
        k.cliff('weathered', back, heights(back, 0.55), { color: ROCK_WET, rough: 0.3, strata: 0.5, depth: 1.0, soft: 0.7, taper: 0, lod: 0 });
      } else if (DRY_LEDGES) {
        // (close range only: at LOD1 and beyond the stamped faces carry the walls on their own)
        k.cliff('weathered', pts, heights(pts, 0.6), { color: ROCK, rough: 0.5, strata: 1.0, depth: 1.1, soft: 0.45, taper: 0.08, lod: 0 });
      }
    }
  };
  // north wall: walking east, the face looks right = south, toward the stream (falls at x 3.4, 4.6, 5.6)
  wall(north, 1.9, 6.6, true, [3.4, 4.6, 5.6]);
  // south wall: walking west, the face looks right = north (falls at x −0.3 and 3.05)
  wall(south, -3.8, -2.5, false, []);
  wall(south, -0.75, 0.85, false, [-0.3]);
  wall(south, 1.85, 6.6, false, [3.05]);
}

/** keep-out circles: halls, towers, the court, the pavilion (trees never stand in a roof) */
const KEEP_OUT: { at: V2; r: number }[] = [
  // the terraces themselves stay mostly open (a few ornamental trees from the ledge bands' inner edge)
  { at: LEDGE_N.at, r: LEDGE_N.r - 0.05 },
  { at: LEDGE_S.at, r: LEDGE_S.r - 0.1 },
  { at: PAVILION.at, r: 0.1 },
  // the shelf halls (their spot is searched within 0.25 km) and the back terraces' whole slide
  ...SHELF_HALLS.map((h) => ({ at: h.at, r: 0.42 })),
  ...BACK_TERRACES.map(({ u, v, w, d }) => {
    const fm = (1 + SLIDE_MIN) / 2;
    return { at: onN(u * fm, v * fm), r: ((1 - SLIDE_MIN) / 2) * Math.hypot(u, v) + Math.hypot(w, d) / 2 + 0.03 };
  }),
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
  /** steepest slope that carries trees (default 62°) */
  maxSlope?: number;
}

const FOOT_N = offsetPath(STREAM_WE, FLOOR * 0.75).filter(([x]) => x > -3.8 && x < 6.5);
const FOOT_S = offsetPath(STREAM_WE, -FLOOR * 0.75).filter(([x]) => x > -3.8 && x < 6.5);

/**
 * The woods on the moor over the rims (S4 W5, C2 #8: S3's continuous bands drew two wreaths of dots along
 * the lips in the wide): 3–5 irregular stands per side and row, set back 0.3–0.8 km behind the lip (the
 * near row) and further out on the moor (the far row) — blobs of 0.25–0.5 km with open moor between them.
 * Each row: [x range, side (+1 north), setback km beyond the lip, count].
 */
const LIP = FLOOR + 0.35;
const STAND_ROWS: [number, number, number, number, number][] = [
  [-0.4, 5.5, 1, 0.55, 5],
  [-3.2, 5.5, -1, 0.5, 5],
  [0.2, 5.0, 1, 1.6, 3],
  [-2.8, 5.0, -1, 1.5, 4],
];
const STANDS: V2[][] = STAND_ROWS.flatMap(([x0, x1, side, back, n], ri) =>
  Array.from({ length: n }, (_, j) => {
    // spaced along the row with a jitter, set back up to 0.25 km further or nearer at random
    const key = 500 + ri * 10 + j;
    const x = x0 + ((x1 - x0) * (j + 0.25 + 0.5 * rand(SEED, key, 0))) / n;
    const d = side * (LIP + back + (rand(SEED, key, 1) - 0.5) * 0.5);
    const line = offsetPath(STREAM_WE, d);
    const c = spanX(line, x - 0.01, x + 0.01, 1)[0] ?? line[0];
    const r = 0.25 + 0.25 * rand(SEED, key, 2);
    // an irregular blob: 9 points, radius ±35 %, drawn out along the valley
    return Array.from({ length: 9 }, (_, q): V2 => {
      const a = (q / 9) * Math.PI * 2;
      const rr = r * (0.65 + 0.7 * rand(SEED, 600 + ri * 100 + j * 10 + q, 3));
      return [c[0] + Math.cos(a) * rr * 1.4, c[1] + Math.sin(a) * rr];
    });
  }),
);

const BANDS: Band[] = [
  // the ledges: between and round the halls, and down their gorge-side slopes under the lips
  { path: arc(LEDGE_N, 95, 270, LEDGE_N.r + 0.1, 8), hw: 0.14, n: 13, conifer: 0.2, birch: 0.3, scale: [0.4, 0.7] },
  { path: arc(LEDGE_S, 280, 430, LEDGE_S.r + 0.08, 7), hw: 0.12, n: 10, conifer: 0.2, birch: 0.3, scale: [0.35, 0.6] },
  { path: arc(LEDGE_NE, 110, 260, LEDGE_NE.r + 0.08, 4), hw: 0.1, n: 3, conifer: 0.4, birch: 0.2, scale: [0.4, 0.65] },
  { path: arc(LEDGE_SE, 280, 420, LEDGE_SE.r + 0.08, 4), hw: 0.1, n: 3, conifer: 0.4, birch: 0.2, scale: [0.4, 0.65] },
  // the gorge floor along both wall feet: the valley filled with golden woods (S4 W5: ×1.5)
  { path: FOOT_N, hw: 0.2, n: 24, conifer: 0.3, birch: 0.2, scale: [0.6, 1.1] },
  // the main spur's slopes falling to the stream below the house: small golden trees and firs
  { path: arc(LEDGE_N, 115, 300, LEDGE_N.r + 0.38, 8), hw: 0.22, n: 26, conifer: 0.3, birch: 0.2, scale: [0.55, 1.05], maxSlope: 76 },
  { path: FOOT_S, hw: 0.2, n: 26, conifer: 0.3, birch: 0.2, scale: [0.6, 1.1] },
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
 * the species of a stand: muted autumn broadleaves, GREEN_SHARE dull-green ones, birches and firs; crowns
 * sized so the trees' heights spread over 0.5–1.0 of the valley's 0.28 km cap (S4 W5, C2 #8)
 */
const species = (conifer: number, birch: number, scale: [number, number]): ForestDecl['species'] => [
  { kind: 'autumn', share: 1 - conifer - birch - GREEN_SHARE, crownKm: [0.1 * scale[0], 0.1 * scale[1]], heightFactor: [2.1, 2.5], colors: AUTUMN },
  { kind: 'autumn', share: GREEN_SHARE, crownKm: [0.1 * scale[0], 0.1 * scale[1]], heightFactor: [2.1, 2.5], colors: GREEN },
  { kind: 'poplar', share: birch, crownKm: [0.06 * scale[0], 0.06 * scale[1]], heightFactor: [3.4, 4.2], colors: BIRCH },
  { kind: 'conifer', share: conifer, crownKm: [0.055 * scale[0], 0.055 * scale[1]], heightFactor: [4.2, 4.8], colors: CONIFER },
];

/**
 * The woods of the gorge floor and the rims as landmark forests (placed by the vegetation system:
 * chunked, LOD-capped, thinned with the quality density): muted autumn broadleaves (ochre, rust,
 * olive-gold) with a third dull-green, birches and slender firs (S4 W5, C2 #8), kept small near the halls
 * (heights over 0.5–1.0 of the 0.28 km cap, against the main hall's pavilions), dense and clumped into
 * broad stands by stand noise (crowns merging into masses, shadowed gaps between), never inside the
 * halls' keep-out circles; the rims carry irregular polygon stands (STANDS), not continuous bands. The
 * gorge faces are sheer stamped rock: no trees there.
 */
export const FORESTS: ForestDecl[] = [
  ...WOOD_BANDS.map(
    (b): ForestDecl => ({
      area: { band: { path: b.path, halfWidth: b.hw } },
      // dense enough that, clumped, the crowns touch into stands with shadowed gaps between them
      density: (b.n * 40) / Math.max(0.05, pathLength(b.path) * 2 * b.hw * 0.45),
      species: species(b.conifer, b.birch, b.scale),
      // (S4 W5: broad, hard-edged stands — the crowns merge into masses with shadowed gaps)
      clump: { scaleKm: 0.6, amount: 1.0 },
      edgeKm: 0.05,
      // the spur's slopes are steep (trees cling to them); elsewhere no trees on the sheer faces
      maxSlopeDeg: b.maxSlope ?? 62,
      avoid: KEEP_OUT,
    }),
  ),
  // the moor's stands over the rims: bigger crowns, massed colour from the wide
  ...STANDS.map(
    (poly): ForestDecl => ({
      area: { polygon: poly },
      density: 260,
      species: species(0.45, 0.1, [0.75, 1.15]),
      clump: { scaleKm: 0.6, amount: 0.8 },
      edgeKm: 0.08,
      maxSlopeDeg: 62,
      avoid: KEEP_OUT,
    }),
  ),
];

/**
 * ~95 authored trees (VegetationSystem hero clusters) along the ledge bands round the halls, in clumps of
 * 2–12 with a quarter of the spots lone trees (S4 W5, C2 #8): muted autumn broadleaves, birches and
 * slender firs of mixed sizes, every one under 0.27 km — pure function of the seed.
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
      // S4 W5 (C2 #8): clumps of 2–12 and more lone trees (a quarter of the spots), not even 3–7 clusters
      const u2 = rand(SEED, key, 2);
      const count = u2 < 0.25 ? 1 : 2 + Math.floor(((u2 - 0.25) / 0.75) ** 1.6 * 11);
      const cr = 0.03 + 0.03 * Math.sqrt(count) * (0.8 + 0.4 * rand(SEED, key, 3));
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
        // heights spread over 0.5–1.0 of the 0.27 km cap
        const hk = 0.27 * (0.5 + 0.5 * rand(SEED, r, 10));
        if (kind < b.conifer) out.push({ at, kind: 'conifer', crownKm: hk / 4.6, heightKm: hk, color: pickC(CONIFER), yawDeg });
        else if (kind < b.conifer + b.birch) out.push({ at, kind: 'poplar', crownKm: hk / 3.8, heightKm: hk, color: pickC(BIRCH), yawDeg });
        else out.push({ at, kind: 'autumn', crownKm: Math.max(crown, hk / 2.3), heightKm: hk, color: pickC(kind < b.conifer + b.birch + GREEN_SHARE ? GREEN : AUTUMN), yawDeg });
        if (out.filter((q) => Math.hypot(q.at[0] - centre[0], q.at[1] - centre[1]) <= cr + 1e-6).length >= count) break;
      }
    }
  });
  return out;
})();
