import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { ForestDecl, V2, V3 } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { archOutline, planeRot } from '../hobbiton/parts.ts';

/**
 * The Grey Havens / Mithlond (research §17; the Return of the King still, Alan Lee's film concept): a
 * sheltered harbour at the head of the Gulf of Lune between two rocky headlands — a crag rising out of
 * the sea on the north side of the mouth (its arm closing the harbour's north side) and a crag on the point
 * to the south — pale stone quays round the basin with stairs down into the water, long arcades of tall
 * round arches along the waterfront, slender towers with spires and domes at the quay ends and on the
 * crags, a breakwater with a light at its head reaching across the mouth, pale halls with domes and hipped
 * slate roofs climbing the low amphitheatre of land behind the quays; the white swan-prowed ship at the
 * south quay; warm lamps along the quays. The hero looks west over the town and the basin, out through the
 * mouth between the crags, into the low sun shining on the gulf.
 *
 * Local frame: x east, z south (heading 0), km round the display point; `anchor: 'water'`: local y = 0 is
 * the sea surface (the basin is carved over the display point). Stamp heights are relative to the base
 * ground at the origin (BASE above the sea). The coast here rises steeply inland (≈ 0.9 per km), which
 * would hide the harbour from any view out to the west: the stamps lower a broad low amphitheatre round it
 * (lowerOnly), cut a level quay terrace round the basin just above the sea, sink the basin (the sea plane
 * fills it) and raise the two crags out of the sea.
 */

const DEG = Math.PI / 180;
/** height of the base ground at the origin above the sea (the stamps' reference) */
const BASE = 1.611;
/** the harbour basin's centre and radius; the quay level */
const H: V2 = [0.0, -1.3];
const BASIN_R = 1.2;
const QUAY_Y = 0.08;
/** the low amphitheatre behind the quays (east of the basin) */
const AMPHI: V2 = [2.6, -1.2];
/** the crags: north (out of the sea), south (on the point) */
const NORTH: V2 = [-1.9, -3.3];
const SOUTH: V2 = [-2.2, 0.6];

const PALE = 0xe8e6e0;
const PALE2 = 0xdcd8cc;
const PALE3 = 0xd2ccbc;
const ROOF = 0x9aa4aa;
const LAMP = 0xffc878;

/** compass bearing and radius round a centre (default: the basin's) → local */
const polar = (b: number, r: number, c: V2 = H): V2 => [c[0] + Math.sin(b * DEG) * r, c[1] - Math.cos(b * DEG) * r];

function buildHavens(k: ProxyKit): void {
  let lamps = 0;
  const lamp = (p: V3, intensity = 1): void => {
    if (lamps >= 20) return;
    lamps++;
    k.light(p, { kind: 'lamp', color: LAMP, intensity, radius: 0.012 });
  };
  const slope = (x: number, z: number): number => {
    const e = 0.05;
    return Math.hypot(k.ground(x + e, z) - k.ground(x - e, z), k.ground(x, z + e) - k.ground(x, z - e)) / (2 * e);
  };

  // ---------------------------------------------------------------- the quays round the basin
  // the quay edge: a pale stone wall standing in the water along the shore from the north-east round the
  // east and south to the point; its top a little above the quay terrace
  const quay: V2[] = [];
  for (let b = 20; b <= 250; b += 4) quay.push(polar(b, BASIN_R + 0.03));
  k.wallPath('stone', quay, QUAY_Y + 0.32, 0.07, { at: [0, -0.3, 0], color: PALE2, shadeJitter: 0.04 });
  // the pale paved quay apron on the terrace (followGround: its top a hair above the level terrace)
  {
    const outer: V2[] = [];
    const inner: V2[] = [];
    for (let b = 22; b <= 248; b += 6) {
      outer.push(polar(b, BASIN_R + 0.5));
      inner.push(polar(b, BASIN_R + 0.04));
    }
    k.extrude('stone', [...outer, ...inner.reverse()], 0.004, { followGround: true, color: PALE3, shade: 0.95, grain: 0.3, lod: 1 });
  }
  // stairs down into the water at intervals along the quay
  for (const b of [60, 115, 170, 215]) {
    const top = polar(b, BASIN_R + 0.02);
    const bot = polar(b, BASIN_R - 0.1);
    const [rx, rz] = [Math.cos(b * DEG), Math.sin(b * DEG)];
    k.stairs('stone', [[top[0] + rx * 0.05, QUAY_Y, top[1] + rz * 0.05], [bot[0] + rx * 0.05, -0.05, bot[1] + rz * 0.05]], 0.05, { stepKm: 0.02, color: PALE });
  }
  // lamps on posts along the quay
  for (const b of [35, 75, 100, 135, 155, 190, 230]) {
    const [x, z] = polar(b, BASIN_R + 0.07);
    k.cylinder('stone', 0.004, 0.006, 0.06, { at: [x, k.ground(x, z) - 0.005, z], seg: 6, color: PALE, lod: 0 });
    lamp([x, k.ground(x, z) + 0.06, z], 1.0);
  }

  // ---------------------------------------------------------------- arcades of tall round arches along the waterfront
  /** a wall of `count` round-headed arches from a to b standing at y (a plane extrusion with holes) */
  const arcade = (a: V2, b: V2, count: number, hgt: number, y: number): void => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // the wall plane's normal: perpendicular to a→b (its u axis runs along a→b)
    const yaw = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI - 90;
    const pitch = L / count;
    const aw = pitch * 0.62;
    const holes: V2[][] = [];
    for (let i = 0; i < count; i++) {
      const u = -L / 2 + pitch * (i + 0.5);
      holes.push(archOutline(aw, hgt * 0.5, hgt * 0.8, -0.014, 8).map(([x, v]) => [x + u, v] as V2));
    }
    const outline: V2[] = [
      [-L / 2, 0],
      [L / 2, 0],
      [L / 2, -hgt],
      [-L / 2, -hgt],
    ];
    const t = 0.03;
    const c: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const [nx, nz] = [Math.sin(yaw * DEG), Math.cos(yaw * DEG)];
    k.extrude('stone', outline, t, { at: [c[0] - (nx * t) / 2, y, c[1] - (nz * t) / 2], rot: planeRot(yaw), holes, color: PALE, grain: 0.15, lod: 0 });
    // a cornice along the top, a plinth under it
    k.box('stone', L + 0.01, 0.012, t * 1.6, { at: [c[0], y + hgt, c[1]], rot: [0, yaw, 0], color: PALE3, lod: 0 });
    k.box('stone', L, 0.02, t * 1.3, { at: [c[0], y - 0.012, c[1]], rot: [0, yaw, 0], color: PALE3, lod: 0 });
  };
  for (const [b0, b1, n, hgt] of [
    [30, 70, 8, 0.24],
    [80, 125, 9, 0.22],
    [140, 185, 9, 0.26],
    [195, 235, 8, 0.22],
  ] as [number, number, number, number][]) {
    for (let s = 0; s < 2; s++) {
      const p0 = polar(b0 + ((b1 - b0) * s) / 2, BASIN_R + 0.16);
      const p1 = polar(b0 + ((b1 - b0) * (s + 1)) / 2, BASIN_R + 0.16);
      arcade(p0, p1, Math.round(n / 2), hgt, QUAY_Y - 0.004);
    }
  }

  // ---------------------------------------------------------------- slender towers
  const tower = (p: V2, r: number, h: number, roof: 'spire' | 'dome', y?: number, lod: 0 | 1 | 2 = 1): number => {
    const base = y ?? k.ground(p[0], p[1]) - 0.02;
    k.tower('stone', r, h, { at: [p[0], base, p[1]], sides: 12, taper: 0.14, roof, roofFam: 'slate', roofColor: ROOF, roofH: roof === 'spire' ? r * 3.8 : r * 1.1, color: PALE, lod });
    // a ring of balcony at two-thirds
    k.cylinder('stone', r * 1.35, r * 1.35, 0.012, { at: [p[0], base + h * 0.68, p[1]], seg: 12, color: PALE2, lod: 0 });
    return base;
  };
  for (const [b, r, h, roof] of [
    [26, 0.05, 0.46, 'spire'],
    [76, 0.045, 0.38, 'dome'],
    [132, 0.055, 0.55, 'spire'],
    [190, 0.05, 0.42, 'dome'],
    [242, 0.05, 0.48, 'spire'],
  ] as [number, number, number, 'spire' | 'dome'][]) {
    const p = polar(b, BASIN_R + 0.26);
    const base = tower(p, r, h, roof);
    const [ox, oz] = [Math.sin(100 * DEG), -Math.cos(100 * DEG)];
    lamp([p[0] + ox * (r + 0.01), base + h * 0.7, p[1] + oz * (r + 0.01)], 1.2);
  }

  // ---------------------------------------------------------------- the breakwater: a long mole from the south crag's
  // foot north across the mouth, a light tower at its head
  {
    const pts: V2[] = [polar(250, BASIN_R + 0.2), polar(275, BASIN_R + 0.75), polar(300, BASIN_R + 0.85)];
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const yaw = (Math.atan2(q[0] - p[0], q[1] - p[1]) * 180) / Math.PI;
      k.box('stone', 0.08, 0.56, L + 0.07, { at: [(p[0] + q[0]) / 2, -0.5, (p[1] + q[1]) / 2], rot: [0, yaw, 0], color: PALE2, lod: 1 });
    }
    const c = pts[pts.length - 1];
    const base = tower(c, 0.05, 0.34, 'dome', 0.05);
    lamp([c[0], base + 0.34 + 0.035, c[1]], 1.4);
  }

  // ---------------------------------------------------------------- the crags: a tower on each top, rock faces
  for (const [c, r, h] of [
    [NORTH, 0.06, 0.6],
    [SOUTH, 0.055, 0.5],
  ] as [V2, number, number][]) {
    let best: V2 = c;
    for (let i = 0; i < 36; i++) {
      const p = polar(i * 10, 0.1 + (i % 4) * 0.12, c);
      if (k.ground(p[0], p[1]) > k.ground(best[0], best[1])) best = p;
    }
    tower(best, r, h, 'spire', undefined, 2);
    // faceted pale rock faces on the seaward side, tapering into the stamp
    for (const [r0, b0, b1, hh] of [
      [0.5, 340, 200, 0.32],
      [0.5, 150, 40, 0.3],
    ] as [number, number, number, number][]) {
      const face: V2[] = [];
      for (let b = b0; b >= b1; b -= 10) face.push(polar(b, r0, c));
      k.cliff('weathered', face, hh, { color: 0x9a948a, rough: 0.6, strata: 0.5, soft: 0.5, depth: 0.22, lod: 0 });
    }
  }

  // ---------------------------------------------------------------- pale halls climbing the amphitheatre behind the quays
  // dense along the waterfront, thinning up the slope; long fronts look to the harbour
  let n = 0;
  let lit = 0;
  const rings: [number, number, number][] = [
    [BASIN_R + 0.42, 5, 0.12],
    [BASIN_R + 0.62, 5.5, 0.18],
    [BASIN_R + 0.84, 6, 0.25],
    [BASIN_R + 1.1, 7, 0.35],
    [BASIN_R + 1.4, 8.5, 0.5],
    [BASIN_R + 1.75, 10, 0.62],
  ];
  for (const [r, step, skip] of rings) {
    for (let b = 18; b <= 242; b += step) {
      const bb = b + (k.r(1) - 0.5) * step * 0.5;
      const p = polar(bb, r + (k.r(2) - 0.5) * 0.08);
      if (k.r(3) < skip) continue;
      const g = k.ground(p[0], p[1]);
      if (g < QUAY_Y - 0.03 || slope(p[0], p[1]) > 0.42) continue;
      if (Math.hypot(p[0] - SOUTH[0], p[1] - SOUTH[1]) < 0.9 || Math.hypot(p[0] - NORTH[0], p[1] - NORTH[1]) < 1.0) continue;
      const i = n++;
      const big = i % 7 === 3;
      const w = big ? 0.2 + k.r(4) * 0.06 : 0.09 + k.r(4) * 0.07;
      const d = big ? 0.11 : 0.07 + k.r(5) * 0.04;
      const h = big ? 0.16 : 0.08 + k.r(6) * 0.08;
      // fronts look to the harbour: compass bb + 180 → house yaw −bb
      const yawH = -bb + (k.r(7) - 0.5) * 8;
      const roof = big ? 'dome' : i % 3 === 2 ? 'gable' : 'hip';
      const litHere = lit < 6 && i % 7 === 1;
      if (litHere) lit++;
      k.house('stone', roof === 'dome' ? 'stone' : 'slate', w, d, h, {
        at: [p[0], 0, p[1]],
        rot: [0, yawH, 0],
        roof,
        pitch: 30,
        overhang: 0.01,
        dig: 0.35,
        color: [PALE, PALE2, PALE3][i % 3],
        roofColor: roof === 'dome' ? 0xe0dcd2 : ROOF,
        plinthFam: 'stone',
        plinthColor: PALE3,
        lod: big || i % 4 === 0 ? 2 : i % 4 === 2 ? 1 : 0,
        ...(litHere ? { windows: { count: 1, on: 1, sides: 1 as const, size: 0.012, color: LAMP, kind: 'window' as const } } : {}),
      });
      // a slender tower among the halls here and there
      if (i % 10 === 4) tower([p[0] + 0.09, p[1] + 0.05], 0.034, 0.28 + k.r(8) * 0.14, k.r(9) < 0.5 ? 'spire' : 'dome', undefined, 1);
    }
  }

  // ---------------------------------------------------------------- the white swan-ship at the south quay
  {
    const b = 160;
    const along = (b + 90) * DEG; // the ship lies along the quay
    const p = polar(b, BASIN_R - 0.1);
    const ax: V2 = [Math.sin(along), -Math.cos(along)];
    const L = 0.38;
    const sec = (w: number, len: number): V2[] => {
      const out: V2[] = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const c = Math.cos(a);
        // a slim ellipse, finer towards bow and stern
        out.push([Math.sin(a) * w * (1 - 0.35 * Math.abs(c)), c * len]);
      }
      return out;
    };
    const yawShip = (Math.atan2(ax[0], ax[1]) * 180) / Math.PI;
    k.loft(
      'plaster',
      [
        { outline: sec(0.012, L * 0.4), y: -0.02 },
        { outline: sec(0.032, L * 0.48), y: 0.015 },
        { outline: sec(0.038, L * 0.5), y: 0.04 },
      ],
      { at: [p[0], 0, p[1]], rot: [0, yawShip, 0], color: 0xf2f0ea },
    );
    // the swan's neck rising from the prow, curving forward and bowing its head
    const prow: V2 = [p[0] + ax[0] * L * 0.5, p[1] + ax[1] * L * 0.5];
    k.loft(
      'plaster',
      [0, 1, 2, 3, 4, 5].map((i) => {
        const t = i / 5;
        const r = 0.01 * (1 - t * 0.4);
        const ring: V2[] = Array.from({ length: 6 }, (_, j) => [Math.cos((j / 6) * Math.PI * 2) * r, Math.sin((j / 6) * Math.PI * 2) * r + Math.sin(t * Math.PI * 0.9) * 0.03 + t * 0.014]);
        return { outline: ring, y: 0.035 + t * 0.08 };
      }),
      { at: [prow[0], 0, prow[1]], rot: [0, yawShip, 0], color: 0xf6f4ee, lod: 0 },
    );
    // the mast and a pale sail
    k.cylinder('wood', 0.003, 0.004, 0.22, { at: [p[0], 0.03, p[1]], seg: 6, color: 0xd8cfb8, lod: 0 });
    k.box('plaster', 0.004, 0.14, 0.13, { at: [p[0] - ax[0] * 0.015, 0.075, p[1] - ax[1] * 0.015], rot: [0, yawShip, 0], color: 0xf4f0e4, lod: 0 });
    lamp([prow[0], 0.09, prow[1]], 0.9);
  }
  // trees on the slopes behind the town (pines and beeches of Lindon)
  for (const [b, r] of [
    [40, 3.2],
    [70, 3.3],
    [100, 3.1],
    [125, 3.4],
    [160, 3.2],
    [185, 3.0],
    [215, 2.8],
  ] as [number, number][]) {
    const p = polar(b, r);
    k.tree(b % 2 ? 'conifer' : 'oak', p[0], p[1], { crownKm: 0.08 + (b % 3) * 0.02, heightKm: b % 2 ? 0.3 : 0.18 });
  }
}

/** the woods of Lindon on the rising land round the town (pines and beeches), clear of the halls */
const WOODS: ForestDecl[] = [
  {
    // a band round the east side (bearings 0–215 from the basin), 2–6.5 km beyond the quays
    area: {
      polygon: [
        ...Array.from({ length: 23 }, (_, i) => polar(i * (215 / 22), BASIN_R + 6.5)),
        ...Array.from({ length: 23 }, (_, i) => polar(215 - i * (215 / 22), BASIN_R + 2.0)),
      ],
    },
    density: 12,
    species: [
      { kind: 'conifer', share: 0.55, crownKm: [0.06, 0.1], colors: [0x2f4a2c, 0x35512f, 0x2b4428] },
      { kind: 'oak', share: 0.45, crownKm: [0.07, 0.12], colors: [0x4a6a32, 0x557236, 0x5e7a3a] },
    ],
    clump: { scaleKm: 0.9, amount: 0.5 },
    edgeKm: 0.5,
    maxSlopeDeg: 75,
    minY: 0.15,
  },
];

export default defineLandmark({
  id: 'grey-havens',
  placeId: 'grey-havens',
  tier: 'B',
  anchor: 'water',
  // heights relative to the base ground at the origin (BASE above the sea)
  stamps: [
    // the low amphitheatre behind the quays (lowerOnly: the gulf stays)
    { kind: 'flatten', at: AMPHI, radius: 2.4, falloff: 2.6, height: 0.42 - BASE, lowerOnly: true },
    // the quay terrace cut round the harbour, just above the sea
    { kind: 'flatten', at: H, radius: BASIN_R + 0.55, falloff: 0.5, height: QUAY_Y - BASE, lowerOnly: true },
    // the basin: the sea plane fills it
    { kind: 'basin', at: H, radius: BASIN_R, floor: -0.4 - BASE, falloff: 0.2 },
    // the north crag out of the sea, its arm east closing the harbour's north side
    {
      kind: 'massif',
      at: NORTH,
      radius: 1.0,
      summit: 0.6,
      base: -2.75,
      exponent: 1.05,
      dome: 0.3,
      spurs: [
        { azimuthDeg: 100, lengthKm: 3.2, widthKm: 0.8, heightFrac: 0.6, rootFrac: 0.8 },
        { azimuthDeg: 300, lengthKm: 1.0, widthKm: 0.6, heightFrac: 0.5, rootFrac: 0.8 },
      ],
      flankSlope: 2.4,
      rough: { amp: 0.18, scaleKm: 1.6, ridged: true },
      surface: 'rock',
    },
    // the south crag on the point
    {
      kind: 'massif',
      at: SOUTH,
      radius: 0.95,
      summit: 0.45,
      base: -2.4,
      exponent: 1.05,
      dome: 0.3,
      spurs: [{ azimuthDeg: 140, lengthKm: 1.6, widthKm: 0.8, heightFrac: 0.5, rootFrac: 0.8 }],
      flankSlope: 2.4,
      rough: { amp: 0.16, scaleKm: 1.6, ridged: true },
      surface: 'rock',
    },
  ],
  lodPx: [80, 26],
  vegetationExclusion: [
    { at: H, r: 2.4 },
    { at: AMPHI, r: 1.6 },
    { at: NORTH, r: 0.9 },
    { at: SOUTH, r: 0.9 },
  ],
  forests: WOODS,
  proxy: buildHavens,
  annotation: { title: 'The Grey Havens', subtitle: 'Mithlond', blurb: 'Harbour of the Elves upon the Gulf of Lune, whence the last ships sail into the West.' },
  bookmarks: [
    {
      id: 'grey-havens-close',
      distanceKm: 30,
      elevationDeg: 32,
      azimuthDeg: 100,
      fov: 13,
      lift: 0.3,
      aimKm: [-1.0, 1.4],
      tod: 18.3,
      compare: ['reference/film/grey-havens/grey-havens-rotk.jpg', 'reference/film/grey-havens/grey-havens-wide.webp', 'reference/concept-art/grey-havens/grey-havens-alan-lee-concept.jpg'],
      note: 'hero (regional, 30 km, the film’s last shot): golden-hour backlight (18.3, the sun low in the west-north-west) from high over the land to the east — the pale town on its low amphitheatre, the quays, arcades and slender towers round the basin, the white swan-ship at the south quay, the breakwater light, and beyond the mouth between the two crags the gulf shining under the sun. The coast rises too steeply inland for a low eye-level view west (any camera east of the havens below ≈ 25° sees only the coastal rise)',
    },
  ],
});
