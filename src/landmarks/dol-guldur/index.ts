import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { LocalStamp, V2, V3 } from '../types.ts';
import { defineLandmark } from '../types.ts';

/**
 * Dol Guldur (research §16): the ruined fortress of the Necromancer on a bare hill in southern Mirkwood —
 * an equilateral triangle of broken curtain walls (merlons fallen, breaches) with three great corner
 * towers, a crown of splintered towers rising from a massive inner keep — ribbed shafts thinning upwards,
 * their broken tops splaying outwards like thorns — reached by a long stone bridge from a rocky knob to
 * the north-east across the saddle; rotted teal-grey stone (#55665f, the darker #34443f only in the
 * recesses — murky, not the Morgul lime), a few faint green lights in the tower slits. The forest stops
 * at the foot of the bare hill, which breaks out in dark cliff bands under the walls.
 *
 * Local frame (x east, z south): the display point is the hilltop. The ground around is the flat
 * Mirkwood plateau (≈ 10.8, the base ground at the origin); the hill is a rough massif with three
 * spurs, its top levelled a little for the fortress, stepped by three scarps (cliff bands) below the
 * walls; the knob is a smaller raise.
 */

const DEG = Math.PI / 180;
/** compass bearing (deg) and radius → local x, z */
const polar = (b: number, r: number, c: V2 = [0, 0]): V2 => [c[0] + Math.sin(b * DEG) * r, c[1] - Math.cos(b * DEG) * r];

/** circumradius of the fortress triangle, km; vertex bearings (the south vertex faces the valley) */
const R = 1.0;
/** design scale of the towers and walls (the ruin crowns the whole hilltop) */
const SC = 1.3;
const VERTS = [60, 180, 300];
/** the knob the bridge comes from */
const KNOB: V2 = polar(48, 2.7);

const WALL = [0x5d6e68, 0x566761, 0x627370, 0x52635d];
const TOWER = [0x55665f, 0x4e5f58, 0x5b6c65, 0x4a5a54];
/** the recesses: slits, the keep's battered core */
const RECESS = 0x34443f;
const SLIT = 0x101816;
const PALE = 0x6d8780;
const GLOW = 0x6fbf9a;
const CRAG = 0x3a403e;

/** a rectangle outline centred at (cx, cz), `e` along the tangent (ux, uz), `th` along the normal (nx, nz) */
function panel(cx: number, cz: number, nx: number, nz: number, e: number, th: number): V2[] {
  const ux = -nz;
  const uz = nx;
  return [
    [cx - ux * e - nx * th, cz - uz * e - nz * th],
    [cx + ux * e - nx * th, cz + uz * e - nz * th],
    [cx + ux * e + nx * th, cz + uz * e + nz * th],
    [cx - ux * e + nx * th, cz - uz * e + nz * th],
  ];
}

/**
 * A splintered tower: a tapering faceted shaft with vertical ribs running up its faces, its broken top a
 * ring of jagged wall fragments of very different heights (some fallen) that thin and splay outwards like
 * thorns, a dark slit or two. Returns the height of the broken rim (local y).
 */
function brokenTower(k: ProxyKit, x: number, z: number, r: number, h: number, sides: number, color: number, lod?: 0 | 1 | 2, ribs = true): number {
  const taper = 0.2 + k.r(1) * 0.12;
  const yaw0 = k.r(2) * 60;
  k.tower('weathered', r, h, { at: [x, 0, z], seat: 'min', sides, taper, roof: 'none', color, rot: [0, yaw0, 0], lod });
  // the seated base (seat 'min': the lowest ground under the shaft, sunk 0.02)
  let g = Infinity;
  for (let i = 0; i < 8; i++) g = Math.min(g, k.ground(x + Math.cos((i / 8) * Math.PI * 2) * r, z + Math.sin((i / 8) * Math.PI * 2) * r));
  g = Math.min(g, k.ground(x, z)) - 0.02;
  const top = g + h;
  const rt = r * (1 - taper);
  const edge = 2 * rt * Math.sin(Math.PI / sides);
  // ribs: one up every face, following the taper (LOD0)
  if (ribs)
    for (let i = 0; i < sides; i++) {
      const a = ((i + 0.5) / sides) * 360 - yaw0;
      const [nx, nz] = [Math.sin(a * DEG), -Math.cos(a * DEG)];
      const w = r * 0.13;
      k.loft(
        'weathered',
        [
          { outline: panel(nx * (r * 0.94), nz * (r * 0.94), nx, nz, w, r * 0.1), y: 0 },
          { outline: panel(nx * (rt * 0.96), nz * (rt * 0.96), nx, nz, w * 0.6, rt * 0.08), y: h * 0.96 },
        ],
        { at: [x, g, z], color, shade: 1.08, lod: 0 },
      );
    }
  let tallest = 0;
  for (let i = 0; i < sides; i++) {
    if (k.r(3) < 0.22) continue;
    const a = ((i + 0.5) / sides) * 360 - yaw0;
    const fh = h * (0.08 + k.r(4) * k.r(5) * 0.6);
    tallest = Math.max(tallest, fh);
    const [nx, nz] = [Math.sin(a * DEG), -Math.cos(a * DEG)];
    const e = (edge * (0.6 + k.r(6) * 0.35)) / 2;
    const th = rt * 0.15;
    // the fragment thins and leans outwards (a thorn), by up to a quarter of its height; the tall ones of
    // the great towers stay in the mid LOD (the silhouette's thorns)
    const splay = fh * (0.1 + k.r(7) * 0.18);
    const c0 = rt * 0.82;
    k.loft(
      'weathered',
      [
        { outline: panel(nx * c0, nz * c0, nx, nz, e, th), y: 0 },
        { outline: panel(nx * (c0 + splay * 0.45), nz * (c0 + splay * 0.45), nx, nz, e * 0.7, th * 0.75), y: fh * 0.55 },
        { outline: panel(nx * (c0 + splay), nz * (c0 + splay), nx, nz, e * 0.22, th * 0.35), y: fh },
      ],
      { at: [x, top - 0.015, z], color, shade: 0.85 + k.r(9) * 0.25, lod: fh > h * 0.3 && lod === 2 ? 1 : 0 },
    );
  }
  // slits down the shaft (dark)
  const rows = Math.max(1, Math.round(h / 0.3));
  for (let j = 0; j < rows; j++) {
    const a = k.r(14) * 360;
    const y = g + h * (0.3 + (0.55 * j) / rows);
    const rr = r + (rt - r) * ((y - g) / h) + 0.003;
    k.box('darkStone', r * 0.22, h * 0.07, 0.01, { at: [x + Math.sin(a * DEG) * rr, y, z - Math.cos(a * DEG) * rr], rot: [0, 180 - a, 0], color: SLIT, lod: 0 });
  }
  return top + tallest * 0.6;
}

function buildFortress(k: ProxyKit): void {
  const V = VERTS.map((b) => polar(b, R));
  // ---- the inner keep: a massive triangular core, battered, dark (the recess tone)
  const inner = VERTS.map((b) => polar(b, R * 0.42));
  k.extrude('weathered', inner, 0.36, { followGround: true, taper: 0.06, color: RECESS });

  // ---- the curtain walls: each side in three or four broken stretches with breaches between them;
  // merlons along the top with two in five fallen and the rest uneven (no toy-castle crenels)
  for (let s = 0; s < 3; s++) {
    const a = V[s];
    const b = V[(s + 1) % 3];
    const cuts = [0.08, 0.3 + k.r(1) * 0.08, 0.52 + k.r(2) * 0.08, 0.74 + k.r(3) * 0.06, 0.92];
    for (let c = 0; c + 1 < cuts.length; c++) {
      if (c === 1 && s === 2) continue; // a wide breach in the west side
      const t0 = cuts[c] + 0.015;
      const t1 = cuts[c + 1] - 0.015;
      const p0: V2 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
      const p1: V2 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      const wh = (0.17 + k.r(4) * 0.14) * SC;
      const th = 0.075;
      const color = WALL[(s * 4 + c) % WALL.length];
      k.wallPath('weathered', [p0, p1], wh, th, { followGround: true, step: 0.08, batter: 0.25, color, shadeJitter: 0.1 });
      const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const [dx, dz] = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L];
      const yaw = (-Math.atan2(dz, dx) * 180) / Math.PI;
      for (let q = 0.03; q < L - 0.02; q += 0.06) {
        if (k.r(5) < 0.4) continue;
        const mx = p0[0] + dx * q;
        const mz = p0[1] + dz * q;
        // the wall's top there: its bottom follows the lowest ground under both faces, sunk 0.02
        const gb = Math.min(k.ground(mx - dz * th * 0.5, mz + dx * th * 0.5), k.ground(mx + dz * th * 0.5, mz - dx * th * 0.5)) - 0.02;
        const mh = 0.03 + k.r(6) * 0.03;
        k.box('weathered', 0.026, mh, th * (1 - 0.25) * 0.9, { at: [mx, gb + wh - 0.004, mz], rot: [(k.r(7) - 0.5) * 8, yaw, (k.r(8) - 0.5) * 12], color, lod: 0 });
      }
    }
    // a bay tower in the middle of each side
    const m: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    brokenTower(k, m[0], m[1], 0.07 * SC, (0.42 + k.r(6) * 0.15) * SC, 6, TOWER[s % TOWER.length], 1, false);
  }
  // ---- the three great corner towers
  V.forEach(([x, z], i) => brokenTower(k, x, z, 0.12 * SC, (0.75 + i * 0.12 + k.r(1) * 0.1) * SC, 6, TOWER[(i + 1) % TOWER.length], 2));

  // ---- the crown: a cluster of splintered towers rising from the keep, tallest in the middle
  const CROWN: [number, number, number, number][] = [
    [0, 0.05, 0.095, 1.25],
    [0.13, -0.08, 0.07, 1.0],
    [-0.14, -0.06, 0.065, 0.92],
    [0.05, 0.2, 0.06, 0.85],
    [-0.1, 0.17, 0.05, 0.74],
    [0.2, 0.12, 0.05, 0.66],
    [0.24, -0.22, 0.045, 0.62],
    [-0.25, -0.2, 0.05, 0.7],
    [-0.27, 0.05, 0.04, 0.55],
    [0.02, -0.25, 0.05, 0.78],
    [0.3, 0.0, 0.035, 0.5],
    [-0.05, 0.33, 0.04, 0.5],
  ];
  const crown = CROWN.map(([x, z, r, h]) => [x * SC, z * SC, r * SC, h * SC]);
  const tops: V3[] = [];
  crown.forEach(([x, z, r, h], i) => {
    const top = brokenTower(k, x, z, r, h, i % 3 === 0 ? 5 : i % 3 === 1 ? 6 : 4, TOWER[i % TOWER.length], i < 4 ? 2 : i < 8 ? 1 : 0, i < 8);
    tops.push([x, top, z]);
  });
  // flying arches between the tallest towers (broken bridges of stone)
  for (const [a, b] of [
    [0, 1],
    [0, 2],
    [3, 4],
  ] as const) {
    const pa = tops[a];
    const pb = tops[b];
    const y = Math.min(pa[1], pb[1]) - 0.18;
    const len = Math.hypot(pb[0] - pa[0], pb[2] - pa[2]);
    const yaw = (-Math.atan2(pb[2] - pa[2], pb[0] - pa[0]) * 180) / Math.PI;
    k.box('weathered', len, 0.035, 0.03, { at: [(pa[0] + pb[0]) / 2, y, (pa[2] + pb[2]) / 2], rot: [0, yaw, 0], color: PALE, shade: 0.8, lod: 1 });
  }
  // ---- faint green light in four high slits (fire gate: a quarter by day, full from golden hour)
  for (const i of [0, 1, 3, 7]) {
    const [x, , z] = tops[i];
    const r = crown[i][2];
    const g = k.ground(x, z);
    k.light([x + r * 0.6, g + crown[i][3] * 0.62, z + r * 0.6], { kind: 'magic', color: GLOW, intensity: 0.5, radius: 0.025, flicker: 0.2, gate: 'dusk' });
  }

  // ---- the crag under the walls: broken bands of dark rock round the upper hill (gaps for the bridge
  // and the western breach), faces looking out and down the slope, their ends buried
  for (const [b0, b1, hs] of [
    [20, -75, [0.25, 0.55, 0.7, 0.5, 0.25]],
    [-95, -190, [0.3, 0.6, 0.75, 0.55, 0.3]],
    [-210, -290, [0.25, 0.5, 0.6, 0.3]],
  ] as [number, number, number[]][]) {
    const path: V2[] = hs.map((_h, i) => polar(b0 + ((b1 - b0) * i) / (hs.length - 1), 1.3 + 0.07 * Math.sin(i * 2.1)));
    k.cliff('weathered', path, hs, { color: CRAG, rough: 0.6, strata: 0.4, soft: 0.45, depth: 0.5, taper: 0.3, lod: 1 });
  }
  // crag shards along the lip of the summit (LOD0)
  for (let b = 75; b < 400; b += 37) {
    if (b % 360 > 30 && b % 360 < 70) continue;
    const [x, z] = polar(b + k.r(1) * 12, 1.12 + k.r(2) * 0.12);
    k.rock('weathered', 0.08 + k.r(3) * 0.06, { at: [x, 0, z], seat: true, squash: 1.5, lump: 0.45, detail: 0, color: CRAG, lod: 0 });
  }

  // ---- the long bridge from the knob to the north-east vertex
  const gateV = V[0];
  const start: V2 = polar(48, R + 0.12);
  const end: V2 = polar(48, 2.2);
  const y0 = k.ground(start[0], start[1]) + 0.02;
  const y1 = k.ground(end[0], end[1]) + 0.02;
  k.bridge('weathered', [start[0], y0, start[1]], [end[0], y1, end[1]], { width: 0.07, arches: 9, deck: 0.05, color: WALL[2] });
  // the gatehouse at the bridge head and a watch tower on the knob
  brokenTower(k, gateV[0] + 0.05, gateV[1] - 0.02, 0.06, 0.32, 4, TOWER[2], 1, false);
  brokenTower(k, KNOB[0], KNOB[1], 0.07, 0.4, 5, TOWER[0], 1, false);
  // fallen blocks on the slopes below the breaches
  k.scatter(
    { annulus: { at: [0, 0], r0: R + 0.1, r1: R + 0.6, a0: 0, a1: 360 } },
    16,
    (_i, x, z, u) => k.rock('weathered', 0.035 + u * 0.04, { at: [x, 0, z], seat: true, squash: 0.65, lump: 0.35, detail: 0, color: WALL[1], lod: 0 }),
    { minSpacing: 0.12 },
  );
}

/** a cliff band (scarp) round the hill at radius `r` from bearing b0 to b1 (clockwise): the inner side raised */
const band = (b0: number, b1: number, r: number, height: number): LocalStamp => ({
  kind: 'scarp',
  path: Array.from({ length: 7 }, (_, i) => polar(b0 + ((b1 - b0) * i) / 6, r * (1 + 0.05 * Math.sin(i * 1.7)))),
  height,
  run: 0.4,
  side: 'right',
  plateauKm: 0.35,
  falloff: 0.7,
  rough: { amp: 0.12, scaleKm: 1.8, ridged: true, seed: 5 },
  surface: 'rock',
});

export default defineLandmark({
  id: 'dol-guldur',
  placeId: 'dol-guldur',
  tier: 'B',
  // the bare hill: a rough rocky massif with three spurs; its top eased into a low platform for the
  // fortress; three cliff bands stepping its upper flanks (gaps for the bridge's saddle); the knob the
  // bridge comes from, north-east across a saddle
  stamps: [
    {
      kind: 'massif',
      at: [0, 0],
      radius: 3.0,
      summit: 3.3,
      base: 0,
      exponent: 1.25,
      dome: 0.45,
      spurs: [
        { azimuthDeg: 140, lengthKm: 4.4, widthKm: 1.5, heightFrac: 0.36, rootFrac: 0.7 },
        { azimuthDeg: 215, lengthKm: 4.6, widthKm: 1.6, heightFrac: 0.4, rootFrac: 0.72 },
        { azimuthDeg: 300, lengthKm: 4.2, widthKm: 1.5, heightFrac: 0.36, rootFrac: 0.7 },
      ],
      flankSlope: 1.9,
      rough: { amp: 0.8, scaleKm: 1.8, ridged: true },
      surface: 'rock',
    },
    { kind: 'flatten', at: [0, 0], radius: 1.05, falloff: 0.5, height: 3.1, strength: 0.85 },
    band(75, 165, 1.75, 0.45),
    band(180, 280, 1.85, 0.5),
    band(295, 380, 1.7, 0.4),
    { kind: 'raise', at: KNOB, radius: 1.1, amount: 1.9, rough: { amp: 0.25, scaleKm: 1.8 }, surface: 'rock' },
  ],
  lodPx: [60, 20],
  vegetationExclusion: [
    { at: [0, 0], r: 2.6 },
    { at: KNOB, r: 0.9 },
  ],
  proxy: buildFortress,
  annotation: { title: 'Dol Guldur', subtitle: 'Hill of Sorcery', blurb: 'Ruined fortress in southern Mirkwood, lair of the Necromancer.' },
  bookmarks: [
    {
      id: 'dol-guldur-close',
      distanceKm: 29,
      elevationDeg: 12,
      azimuthDeg: 100,
      fov: 14.5,
      // the aim point drops to mid-hill: the whole hill (foot to the crown of towers) in frame
      lift: -0.9,
      tod: 15.0,
      note: 'afternoon under a sick grey sky from the east, the low sun beyond the ruin: the bare stepped hill rising out of the dark forest, the crown of splintered towers on its top, the long bridge from the knob in three-quarter profile on the right',
    },
  ],
});
