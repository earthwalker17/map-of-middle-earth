import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2 } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { archOutline, planeRot } from '../hobbiton/parts.ts';

/**
 * Weathertop / Amon Sûl (research §3; the Fellowship still, Alan Lee, John Howe): a lone, steep hill at
 * the southern end of the Weather Hills, standing high over the lower hills and the East Road — a tor of
 * stacked, bedded grey cliffs (#7a7a70) round its upper third, broken into steps and gaps, among
 * slate-teal moss and scree, under a flat crown whose thick rim of rock overhangs a little; on the crown
 * the ring of the ruined watchtower — broken piers with wedge-cut tops, a few arches still standing on the
 * far side against the sky, a tall fragment of the tower wall with empty windows, rubble gaps, pillar
 * stumps and fallen blocks; one campfire on the crown at its southern edge by a breach in the rim rock
 * (inside the ring it would be hidden behind the rim from every low view).
 *
 * Local frame: x east, z south (heading 0), km round the display point; local y = 0 is the crown (the
 * stamped ground there). The plain falls gently to the south-east, the Weather Hills rise to the
 * north-west. The hill is a stamp: a steep massif ≈ 3.5 above the plain with rough, asymmetric shoulders
 * (a broad one to the south-south-west, a saddle north-west into the Weather Hills), its crown levelled
 * for the ruin; the cliffs, ledges, the rim rock, boulders and the ruin are kit geometry seated on it.
 */

const DEG = Math.PI / 180;
/** the summit (local) and the crown's level (relative to the base ground at the origin) */
const TOP: V2 = [0, 0];
const SUMMIT = 3.45;
/** the crown: a level plateau this high (rel. base) and this wide, held by a steep rim */
const CROWN = 3.05;
const CROWN_R = 0.62;
/** the ring of the watchtower: radius, km */
const RING_R = 0.42;
/** the breach in the rim rock (compass bearings), where the campfire burns */
const BREACH: [number, number] = [150, 176];
/** compass bearing and radius round the summit → local */
const polar = (b: number, r: number): V2 => [TOP[0] + Math.sin(b * DEG) * r, TOP[1] - Math.cos(b * DEG) * r];

const STONE = 0x7a7a70;
const STONE2 = 0x6e6f66;
const ROCK = 0x6a6c64;
const LEDGE = 0x74756b;
/**
 * the family of the natural rock (tor courses, the rim rock, ledges, boulders): the 'foliage' preset's
 * blotchy grain and sun-lit tops painted grey read as lichened, weathered rock — the stone families draw
 * masonry coursing on vertical faces (right for the ruin, wrong for bedded rock)
 */
const TOR = 'foliage' as const;

function buildWeathertop(k: ProxyKit): void {
  /** the radius where the ground falls to local height y along bearing b */
  const levelR = (y: number, b: number): number => {
    const [dx, dz] = [Math.sin(b * DEG), -Math.cos(b * DEG)];
    let r = 0.3;
    while (r < 3.2 && k.ground(TOP[0] + dx * r, TOP[1] + dz * r) > y) r += 0.01;
    return r;
  };
  /** a smooth wobble of a ring's radius with the bearing (seeded per ring) */
  const wobble = (b: number, s: number): number => 0.035 * Math.sin(b * DEG * 3 + s) + 0.022 * Math.sin(b * DEG * 7 + 2 * s) + 0.012 * Math.sin(b * DEG * 17 + s * 3);

  // ---------------------------------------------------------------- the crown's rim rock: thick bedded prisms
  // a lower course (its outer face down to the ground) and an upper slab overhanging it a little, both with
  // flat tops (the slab's just under the crown's turf), round the plateau's edge except at the breach
  {
    const b0 = BREACH[1];
    const b1 = BREACH[0] + 360;
    const outerA: V2[] = [];
    const outerB: V2[] = [];
    const innerA: V2[] = [];
    for (let b = b0; b <= b1 + 1e-6; b += 6) {
      const ro = CROWN_R + 0.06 + wobble(b, 0.4);
      outerA.push(polar(b, ro));
      outerB.push(polar(b, ro + 0.035 + 0.015 * Math.sin(b * DEG * 11)));
      innerA.push(polar(b, CROWN_R - 0.16));
    }
    const lower = [...outerA, ...[...innerA].reverse()];
    const highA = Math.max(...lower.map(([x, z]) => k.ground(x, z)));
    k.extrude(TOR, lower, 0.004, { followGround: true, at: [0, -0.085 - 0.004 - highA, 0], color: ROCK, grain: 0.95, lod: 0 });
    const upper = [...outerB, ...[...innerA].reverse()];
    k.extrude(TOR, upper, 0.075, { at: [0, -0.085, 0], color: LEDGE, grain: 0.95, lod: 1 });
  }

  // ---------------------------------------------------------------- the tor: bands of bedded rock round the upper
  // third — each band a stack of courses (flat-topped prisms), every course set back a little behind the one
  // below (horizontal ledges between them: strata); gaps and steps between the bands' arcs; lower ledges and
  // boulders on the flanks
  const feet: { b: number; r: number }[] = [];
  /** one course: from bearing b0 to b1 (rising), its outer edge `out` km beyond where the ground falls to `y0`, its top at `top` */
  const course = (y0: number, top: number, b0: number, b1: number, out: (b: number) => number, color: number, lod: 0 | 1 = 0): void => {
    // broken into blocks of 18–40° (each its own top, ± 0.045, and its own step out or back, ± 0.03), now
    // and then a narrow cleft between two blocks: an irregular skyline, never a smooth ring
    let a = b0;
    while (a < b1 - 4) {
      const e = Math.min(b1, a + 18 + k.r(3) * 22);
      const t = top + (k.r(4) - 0.5) * 0.09;
      const dOut = (k.r(5) - 0.5) * 0.06;
      const o: V2[] = [];
      const inn: V2[] = [];
      const step = (e - a) / Math.max(2, Math.round((e - a) / 5));
      for (let b = a; b <= e + 1e-6; b += step) {
        // a sharp jag on every vertex on top of the smooth wander
        o.push(polar(b, levelR(y0, b) + out(b) + dOut + (k.r(6) - 0.5) * 0.035));
        inn.push(polar(b, Math.max(0.05, levelR(t + 0.06, b) - 0.05)));
      }
      const ol = [...o, ...inn.reverse()];
      const high = Math.max(...ol.map(([x, z]) => k.ground(x, z)));
      k.extrude(TOR, ol, 0.004, { followGround: true, at: [0, t - 0.004 - high, 0], color, shade: 0.86 + k.r(2) * 0.22, grain: 0.95, lod });
      // the next block starts a little before this one ends (no seam) or after a narrow cleft
      a = k.r(7) < 0.25 ? e + 3 + k.r(8) * 3 : e - 1.5;
    }
  };
  // (each band: the level it rises from, its height, its arcs [from, to] in rising bearing, a seed)
  for (const [y, hh, arcs, s] of [
    [
      -0.44,
      0.36,
      [
        [178, 292],
        [334, 508],
      ],
      1.1,
    ],
    [
      -0.98,
      0.42,
      [
        [98, 204],
        [224, 318],
        [352, 438],
      ],
      2.3,
    ],
  ] as [number, number, [number, number][], number][]) {
    const n = 3;
    for (const [from, to] of arcs) {
      for (let j = 0; j < n; j++) {
        const top = y + (hh * (j + 1)) / n;
        // set back course by course (≈ 0.03 each, wandering): ledges between the layers
        const back = -0.03 * j;
        const sj = s + j * 1.7;
        course(y, top, from, to, (b) => back + wobble(b, sj) + 0.012 * Math.sin(b * DEG * 23 + sj * 5), j % 2 ? LEDGE : ROCK);
      }
      for (let b = from; b <= to; b += 20) feet.push({ b, r: levelR(y, b) + wobble(b, s) });
    }
  }
  // lower ledges stepping down the flanks
  for (const [y, h, b0, b1, s] of [
    [-1.38, 0.18, 140, 232, 5.3],
    [-1.5, 0.15, 258, 300, 6.4],
    [-1.3, 0.14, 40, 84, 7.5],
  ] as [number, number, number, number, number][]) {
    course(y, y + h, b0, b1, (b) => wobble(b, s), LEDGE);
    for (let b = b0; b <= b1; b += 18) feet.push({ b, r: levelR(y, b) + wobble(b, s) });
  }
  // boulders: angular, taller than wide, half-buried, in clusters at the feet of the cliffs and ledges
  feet.forEach(({ b, r }, i) => {
    if (i % 2 === 1) return;
    const n = 2 + Math.floor(k.r(4) * 3);
    for (let j = 0; j < n; j++) {
      const bb = b + (k.r(5) - 0.5) * 7;
      const [x, z] = polar(bb, r + 0.03 + k.r(6) * 0.09);
      const rr = 0.025 + k.r(7) * 0.025;
      const ol: V2[] = [];
      const sides = 5 + Math.floor(k.r(8) * 2);
      for (let q = 0; q < sides; q++) {
        const a = (q / sides) * Math.PI * 2 + k.r(9);
        ol.push([Math.cos(a) * rr * (0.7 + 0.5 * k.r(10)), Math.sin(a) * rr * (0.7 + 0.5 * k.r(10))]);
      }
      const hgt = rr * (1.6 + k.r(11) * 1.4);
      // half-buried: its base below the lowest ground under it (placed, not seated: on a flank this steep a
      // seated block would read as floating on one side and buried on the other)
      const low = Math.min(k.ground(x, z), ...ol.map(([u, v]) => k.ground(x + u, z + v)));
      k.extrude(TOR, ol, hgt, {
        at: [x, low - 0.25 * hgt, z],
        rot: [0, k.r(12) * 360, 0],
        taper: 0.3 + k.r(13) * 0.3,
        color: ROCK,
        shade: 0.85 + k.r(14) * 0.25,
        grain: 0.9,
        lod: 0,
      });
    }
  });

  // ---------------------------------------------------------------- the ruin on the crown
  const gy = (x: number, z: number) => k.ground(x, z);
  /** a pier: a chunk of the ring wall in its plane (facing out along bearing b), its top broken off on a slant */
  const pier = (b: number, h: number, w: number, depth: number, color: number): void => {
    const p = polar(b, RING_R);
    const yaw = 180 - b;
    const [nx, nz] = [Math.sin(yaw * DEG), Math.cos(yaw * DEG)];
    const a = k.r(15);
    const ol: V2[] = [
      [-w / 2, 0.03],
      [w / 2, 0.03],
      [w / 2, -h * (0.72 + 0.28 * a)],
      [w * (0.15 - 0.3 * a), -h],
      [-w / 2, -h * (0.95 - 0.35 * a)],
    ];
    k.extrude('weathered', ol, depth, {
      at: [p[0] - (nx * depth) / 2, gy(p[0], p[1]) - 0.02, p[1] - (nz * depth) / 2],
      rot: planeRot(yaw),
      color,
      grain: 0.85,
      lod: 1,
    });
  };
  const N = 16;
  const piers: { b: number; h: number }[] = [];
  for (let i = 0; i < N; i++) {
    const b = (i / N) * 360 + 8 + (k.r(16) - 0.5) * 6;
    // tall on the west and the far (north-west) side against the hero's sky, broken low elsewhere
    const tall = Math.max(Math.cos((b - 250) * DEG), Math.cos((b - 330) * DEG));
    const h = Math.min(0.46, Math.max(0.15, 0.2 + 0.16 * tall + 0.12 * (k.r(17) - 0.5)));
    piers.push({ b, h });
  }
  /** the spans still carrying their arch (on the far side: arches read against the sky) */
  const ARCHED = new Set([12, 13, 14, 15]);
  /** fallen sections: a low rubble course only, their piers gone */
  const FALLEN = new Set([3, 7]);
  for (let i = 0; i < N; i++) {
    const a = piers[i];
    const c = piers[(i + 1) % N];
    const pa = polar(a.b, RING_R);
    const pc = polar(c.b, RING_R);
    const mid: V2 = [(pa[0] + pc[0]) / 2, (pa[1] + pc[1]) / 2];
    const len = Math.hypot(pc[0] - pa[0], pc[1] - pa[1]);
    if (FALLEN.has(i)) {
      const yaw = (-Math.atan2(pc[1] - pa[1], pc[0] - pa[0]) * 180) / Math.PI;
      k.box('weathered', len * 0.9, 0.02 + k.r(18) * 0.015, 0.045, {
        at: [mid[0], gy(mid[0], mid[1]) - 0.015, mid[1]],
        rot: [0, yaw, 0],
        color: STONE2,
        lod: 0,
      });
      continue;
    }
    if (!FALLEN.has((i + N - 1) % N) || k.r(19) < 0.5) pier(a.b, a.h, 0.05, 0.065, i % 2 ? STONE : STONE2);
    if (ARCHED.has(i)) {
      // an arch on its piers: the wall panel between them with a round-headed opening, its top broken
      const h = Math.min(a.h, c.h) + 0.03;
      const wyaw = (Math.atan2(pc[0] - pa[0], pc[1] - pa[1]) * 180) / Math.PI - 90;
      const [nx, nz] = [Math.sin(wyaw * DEG), Math.cos(wyaw * DEG)];
      const L = len + 0.05;
      const r = k.r(20);
      const ol: V2[] = [
        [-L / 2, 0.03],
        [L / 2, 0.03],
        [L / 2, -h * (0.9 + 0.1 * r)],
        [L * (0.1 - 0.2 * r), -h * (1.05 - 0.1 * r)],
        [-L / 2, -h * (0.95 - 0.08 * r)],
      ];
      const hole = archOutline(len - 0.05, h * 0.5, h * 0.78, -0.03, 8);
      const t = 0.058;
      k.extrude('weathered', ol, t, {
        at: [mid[0] - (nx * t) / 2, Math.min(gy(pa[0], pa[1]), gy(pc[0], pc[1])) - 0.02, mid[1] - (nz * t) / 2],
        rot: planeRot(wyaw),
        holes: [hole],
        color: STONE,
        grain: 0.85,
        lod: 1,
      });
    }
  }
  // a tall broken fragment of the tower wall on the south-west, two empty windows
  {
    const p0 = polar(205, RING_R + 0.03);
    const p1 = polar(240, RING_R + 0.03);
    const wyaw = (Math.atan2(p1[0] - p0[0], p1[1] - p0[1]) * 180) / Math.PI - 90;
    const [nx, nz] = [Math.sin(wyaw * DEG), Math.cos(wyaw * DEG)];
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const ol: V2[] = [
      [-L / 2, 0.03],
      [L / 2, 0.03],
      [L / 2, -0.3],
      [L * 0.28, -0.4],
      [L * 0.05, -0.46],
      [-L * 0.2, -0.38],
      [-L / 2, -0.42],
    ];
    const holes = [-0.25, 0.22].map((u) => archOutline(0.06, 0.2, 0.3, -0.12, 8).map(([x, v]) => [x + u * L, v] as V2));
    const t = 0.07;
    const c: V2 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    k.extrude('weathered', ol, t, {
      at: [c[0] - (nx * t) / 2, Math.min(gy(p0[0], p0[1]), gy(p1[0], p1[1])) - 0.02, c[1] - (nz * t) / 2],
      rot: planeRot(wyaw),
      holes,
      color: STONE,
      grain: 0.85,
      lod: 1,
    });
  }
  // pillar stumps inside the ring and fallen blocks round it
  for (let i = 0; i < 7; i++) {
    const b = i * 51 + 25 + k.r(21) * 15;
    const [x, z] = polar(b, RING_R * 0.6);
    k.cylinder('weathered', 0.022, 0.025, 0.07 + k.r(22) * 0.09, {
      at: [x, 0, z],
      seat: true,
      seg: 7,
      color: STONE,
      lod: 0,
    });
  }
  k.scatter(
    { annulus: { at: TOP, r0: RING_R * 0.7, r1: RING_R * 1.25 } },
    14,
    (_i, x, z, u) =>
      k.box('weathered', 0.035 + u * 0.03, 0.022 + u * 0.012, 0.026 + u * 0.016, {
        at: [x, 0.02, z],
        rot: [u * 20, u * 360, u * 15],
        seat: true,
        color: u > 0.5 ? STONE : STONE2,
        lod: 0,
      }),
    { minSpacing: 0.06 },
  );
  // the campfire at the crown's southern edge by the breach (seen from the south-south-east): a ring of
  // stones, a few low tongues of flame, a small warm light
  const fire = polar((BREACH[0] + BREACH[1]) / 2, CROWN_R - 0.07);
  const fy = gy(fire[0], fire[1]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.box('weathered', 0.008, 0.006, 0.006, {
      at: [fire[0] + Math.cos(a) * 0.014, fy - 0.003, fire[1] + Math.sin(a) * 0.014],
      rot: [0, (a * 180) / Math.PI, 0],
      color: 0x4a443c,
      lod: 0,
    });
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    k.cone('emissive', 0.004, 0.012 + i * 0.004, {
      at: [fire[0] + Math.cos(a) * 0.004, fy - 0.002, fire[1] + Math.sin(a) * 0.004],
      seg: 5,
      color: 0xff8a30,
      glow: { strength: 9, gate: 'dusk', flicker: 0.4 },
      lod: 0,
    });
  }
  k.light([fire[0], fy + 0.012, fire[1]], {
    kind: 'fire',
    color: 0xff9a40,
    intensity: 1.3,
    radius: 0.012,
    flicker: 0.35,
  });
}

export default defineLandmark({
  id: 'weathertop',
  placeId: 'weathertop',
  tier: 'B',
  stamps: [
    // the hill: a steep massif, rough and asymmetric — a broad shoulder to the south-south-west, a saddle
    // north-west into the Weather Hills, short spurs east and north-east
    {
      kind: 'massif',
      at: TOP,
      radius: 3.0,
      summit: SUMMIT,
      base: -0.3,
      exponent: 1.35,
      dome: 0.55,
      spurs: [
        {
          azimuthDeg: 325,
          lengthKm: 2.6,
          widthKm: 1.0,
          heightFrac: 0.3,
          rootFrac: 0.62,
        },
        {
          azimuthDeg: 115,
          lengthKm: 2.0,
          widthKm: 0.9,
          heightFrac: 0.24,
          rootFrac: 0.6,
        },
        {
          azimuthDeg: 205,
          lengthKm: 2.4,
          widthKm: 1.2,
          heightFrac: 0.42,
          rootFrac: 0.7,
        },
        {
          azimuthDeg: 40,
          lengthKm: 1.7,
          widthKm: 0.8,
          heightFrac: 0.2,
          rootFrac: 0.55,
        },
        // a high shoulder on the west-south-west: the outline steps out on the left of the hero view
        { azimuthDeg: 248, lengthKm: 2.2, widthKm: 1.1, heightFrac: 0.55, rootFrac: 0.72 },
      ],
      flankSlope: 2.0,
      rough: { amp: 0.42, scaleKm: 1.6, ridged: true },
      surface: 'rock',
    },
    // the crown: a level plateau for the ruin, held by a steep rim (raised where the body falls short,
    // cut where it stands higher)
    { kind: 'plateau', at: TOP, radius: CROWN_R, height: CROWN, rim: 0.35 },
    {
      kind: 'flatten',
      at: TOP,
      radius: CROWN_R,
      falloff: 0.3,
      height: CROWN,
      lowerOnly: true,
    },
  ],
  lodPx: [70, 24],
  vegetationExclusion: [{ at: TOP, r: 2.2 }],
  proxy: buildWeathertop,
  annotation: {
    title: 'Weathertop',
    subtitle: 'Amon Sûl',
    blurb: 'Ruined watchtower of the old kingdom, where the Ringwraiths found Frodo.',
  },
  bookmarks: [
    {
      id: 'weathertop-close',
      distanceKm: 28,
      elevationDeg: -4,
      azimuthDeg: 150,
      fov: 12,
      lift: -0.4,
      // the camera stands below the crown so the ruin breaks the skyline: a silhouette shot with more sky
      expect: { sky: [0.2, 0.6] },
      tod: 19.6,
      compare: ['reference/film/weathertop/weathertop-ruin-fotr.png', 'reference/concept-art/weathertop/weathertop-alan-lee.jpg', 'reference/concept-art/weathertop/weathertop-horizon-john-howe.jpg'],
      note: 'hero (regional, 28 km): from the south-south-east, low below the crown, at dusk (19.6: the sun setting to the west-north-west, rim-lighting the hill’s west face) — the lone steep tor with its stacked rock bands standing clear above the lower Weather Hills, the broken ring of the watchtower and its arches jagged against the sky, the campfire spark on the crown',
    },
  ],
});
