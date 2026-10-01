import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';
import { defineLandmark } from '../types.ts';

/**
 * Dol Guldur (research §16): the ruined fortress of the Necromancer on a bare hill in southern Mirkwood —
 * an equilateral triangle of broken curtain walls with three great corner towers, a crown of splintered
 * towers rising from a massive inner keep, reached by a long stone bridge from a rocky knob to the
 * north-east across the saddle; rotted teal-grey stone (#152f2c / #305b54 / #5d877b — murky, not the
 * Morgul lime), a few faint green lights in the tower slits. The forest stops at the foot of the bare,
 * rocky hill.
 *
 * Local frame (x east, z south): the display point is the hilltop. The ground around is the flat
 * Mirkwood plateau (≈ 10.8, the base ground at the origin); the hill is a rough massif with three
 * spurs, its top levelled a little for the fortress; the knob is a smaller raise.
 */

const DEG = Math.PI / 180;
/** compass bearing (deg) and radius → local x, z */
const polar = (b: number, r: number, c: V2 = [0, 0]): V2 => [c[0] + Math.sin(b * DEG) * r, c[1] - Math.cos(b * DEG) * r];

/** circumradius of the fortress triangle, km; vertex bearings (the south vertex faces the valley) */
const R = 0.78;
const VERTS = [60, 180, 300];
/** the knob the bridge comes from */
const KNOB: V2 = polar(48, 2.7);

const WALL = [0x41524e, 0x3a4a46, 0x47595a, 0x3d4f4a];
const TOWER = [0x34443f, 0x2e3d39, 0x3a4b46, 0x2a3835];
const PALE = 0x5d776f;
const GLOW = 0x6fbf9a;

/**
 * A splintered tower: a tapering faceted shaft whose broken top is a ring of jagged wall fragments of
 * very different heights (some fallen), dead thorny spikes leaning out of it, dark slits down the shaft.
 * Returns the height of the broken rim (local y).
 */
function brokenTower(k: ProxyKit, x: number, z: number, r: number, h: number, sides: number, color: number, lod?: 0 | 1 | 2): number {
  const taper = 0.18 + k.r(1) * 0.12;
  const yaw0 = k.r(2) * 60;
  k.tower('weathered', r, h, { at: [x, 0, z], seat: 'min', sides, taper, roof: 'none', color, rot: [0, yaw0, 0], lod });
  // the seated base (seat 'min': the lowest ground under the shaft, sunk 0.02)
  let g = Infinity;
  for (let i = 0; i < 8; i++) g = Math.min(g, k.ground(x + Math.cos((i / 8) * Math.PI * 2) * r, z + Math.sin((i / 8) * Math.PI * 2) * r));
  g = Math.min(g, k.ground(x, z)) - 0.02;
  const top = g + h;
  const rt = r * (1 - taper);
  const edge = 2 * rt * Math.sin(Math.PI / sides);
  let tallest = 0;
  for (let i = 0; i < sides; i++) {
    if (k.r(3) < 0.22) continue;
    const a = ((i + 0.5) / sides) * 360 - yaw0;
    const fh = h * (0.06 + k.r(4) * k.r(5) * 0.55);
    tallest = Math.max(tallest, fh);
    k.box('weathered', edge * (0.6 + k.r(6) * 0.35), fh, rt * 0.3, {
      at: [x + Math.sin(a * DEG) * rt * 0.82, top - 0.015, z - Math.cos(a * DEG) * rt * 0.82],
      rot: [(k.r(7) - 0.5) * 10, 180 - a, (k.r(8) - 0.5) * 14],
      color,
      shade: 0.85 + k.r(9) * 0.25,
      lod: fh > h * 0.2 ? 1 : 0,
    });
  }
  // dead thorny spikes leaning out of the broken top
  for (let i = 0; i < 2; i++) {
    const a = k.r(10) * 360;
    k.cylinder('wood', 0.002, 0.007, h * (0.15 + k.r(11) * 0.15), {
      at: [x + Math.sin(a * DEG) * rt * 0.5, top - 0.01, z - Math.cos(a * DEG) * rt * 0.5],
      seg: 3,
      rot: [(k.r(12) - 0.5) * 50, 0, (k.r(13) - 0.5) * 50],
      color: 0x2a2620,
      lod: 0,
    });
  }
  // slits down the shaft
  const rows = Math.max(2, Math.round(h / 0.18));
  for (let j = 0; j < rows; j++) {
    const a = k.r(14) * 360;
    const y = g + h * (0.25 + (0.6 * j) / rows);
    const rr = r + (rt - r) * ((y - g) / h) + 0.003;
    k.box('darkStone', r * 0.22, h * 0.06, 0.01, { at: [x + Math.sin(a * DEG) * rr, y, z - Math.cos(a * DEG) * rr], rot: [0, 180 - a, 0], color: 0x0c1412, lod: 0 });
  }
  return top + tallest * 0.6;
}

function buildFortress(k: ProxyKit): void {
  const V = VERTS.map((b) => polar(b, R));
  // ---- the inner keep: a massive triangular core, battered, dark
  const inner = VERTS.map((b) => polar(b, R * 0.42));
  k.extrude('weathered', inner, 0.28, { followGround: true, taper: 0.06, color: TOWER[1] });

  // ---- the curtain walls: each side in three or four broken stretches with breaches between them
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
      k.wallPath('weathered', [p0, p1], 0.17 + k.r(4) * 0.14, 0.06, {
        followGround: true,
        step: 0.08,
        batter: 0.25,
        color: WALL[(s * 4 + c) % WALL.length],
        shadeJitter: 0.1,
        crenel: { w: 0.025, h: 0.03 + k.r(5) * 0.03, gap: 0.03, lod: 0 },
      });
    }
    // a bay tower in the middle of each side
    const m: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    brokenTower(k, m[0], m[1], 0.07, 0.42 + k.r(6) * 0.15, 6, TOWER[s % TOWER.length]);
  }
  // ---- the three great corner towers
  V.forEach(([x, z], i) => brokenTower(k, x, z, 0.12, 0.75 + i * 0.12 + k.r(1) * 0.1, 6, TOWER[(i + 1) % TOWER.length], 2));

  // ---- the crown: a cluster of splintered towers rising from the keep, tallest in the middle
  const crown: [number, number, number, number][] = [
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
  const tops: V3[] = [];
  crown.forEach(([x, z, r, h], i) => {
    const top = brokenTower(k, x, z, r, h, i % 3 === 0 ? 5 : i % 3 === 1 ? 6 : 4, TOWER[i % TOWER.length], i < 4 ? 2 : 1);
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
  // ---- faint green light in four high slits
  for (const i of [0, 1, 3, 7]) {
    const [x, , z] = tops[i];
    const r = crown[i][2];
    const g = k.ground(x, z);
    k.light([x + r * 0.6, g + crown[i][3] * 0.62, z + r * 0.6], { kind: 'magic', color: GLOW, intensity: 0.55, radius: 0.025, flicker: 0.2 });
  }

  // ---- the long bridge from the knob to the north-east vertex
  const gateV = V[0];
  const start: V2 = polar(48, R + 0.12);
  const end: V2 = polar(48, 2.2);
  const y0 = k.ground(start[0], start[1]) + 0.02;
  const y1 = k.ground(end[0], end[1]) + 0.02;
  k.bridge('weathered', [start[0], y0, start[1]], [end[0], y1, end[1]], { width: 0.07, arches: 9, deck: 0.05, color: WALL[2] });
  // the gatehouse at the bridge head and a watch tower on the knob
  brokenTower(k, gateV[0] + 0.05, gateV[1] - 0.02, 0.06, 0.32, 4, TOWER[2], 1);
  brokenTower(k, KNOB[0], KNOB[1], 0.07, 0.4, 5, TOWER[0], 1);
  // fallen blocks on the slopes below the breaches
  k.scatter(
    { annulus: { at: [0, 0], r0: R + 0.1, r1: R + 0.6, a0: 0, a1: 360 } },
    36,
    (_i, x, z, u) => k.rock('weathered', 0.035 + u * 0.04, { at: [x, 0, z], seat: true, squash: 0.65, lump: 0.35, detail: 1, color: WALL[1], lod: 0 }),
    { minSpacing: 0.1 },
  );
}

export default defineLandmark({
  id: 'dol-guldur',
  placeId: 'dol-guldur',
  tier: 'B',
  // the bare hill: a rough rocky massif with three spurs; its top eased into a low platform for the
  // fortress; the knob the bridge comes from, north-east across a saddle
  stamps: [
    {
      kind: 'massif',
      at: [0, 0],
      radius: 3.0,
      summit: 3.1,
      base: 0,
      exponent: 1.25,
      dome: 0.45,
      spurs: [
        { azimuthDeg: 140, lengthKm: 4.4, widthKm: 1.5, heightFrac: 0.36, rootFrac: 0.7 },
        { azimuthDeg: 215, lengthKm: 4.6, widthKm: 1.6, heightFrac: 0.4, rootFrac: 0.72 },
        { azimuthDeg: 300, lengthKm: 4.2, widthKm: 1.5, heightFrac: 0.36, rootFrac: 0.7 },
      ],
      flankSlope: 1.9,
      rough: { amp: 0.45, scaleKm: 2.0, ridged: true },
      surface: 'rock',
    },
    { kind: 'flatten', at: [0, 0], radius: 0.8, falloff: 0.5, height: 2.95, strength: 0.85 },
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
      distanceKm: 36,
      elevationDeg: 9,
      azimuthDeg: 200,
      fov: 18,
      lift: 1.2,
      tod: 15.0,
      note: 'afternoon under a sick grey sky from the south-south-west over the dark forest: the bare hill and the crown of splintered towers on its top, the long bridge to the knob on the right',
    },
  ],
});
