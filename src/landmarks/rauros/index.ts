import type { V2, V3 } from '../records.ts';
import { defineLandmark } from '../types.ts';
import type { LocalStamp } from '../types.ts';

/**
 * Rauros, Tol Brandir and the hills of the south end of Nen Hithoel (research §3; Tolkien's own sketch
 * "Rauros Falls & the Tindrock" for the topology). Local frame: heading 0 (x east, −z north); the origin
 * is the lake's outlet, where the Anduin leaves Nen Hithoel (level 0.39 above the origin ground); the river
 * runs south 3.7 km to the lip of the falls (a 2.2 drop, the bake's knickpoint) — the cataract itself is an
 * S4 effect, the lip is kept clear and framed by low rock ledges on both banks.
 *
 * - **Tol Brandir** (the Tindrock), a sheer pinnacle island splitting the lake above the outlet: three stepped
 *   rings of kit rock faces from under the water, a wooded cap and conifers on top; a small plateau stamp
 *   (inside the 5 km onRiver footprint the lake keeps no guard) only seats the conifers — terrain inside
 *   the lake mask renders as channel bed, so none of it is left visible.
 * - **Amon Hen** (west) and **Amon Lhaw** (east): two rough massifs on the high ground either side of the
 *   south end, set back ≥ 3.5 km from the water — the river guard lets stamped ground rise only 2 units
 *   per km from a shore — conifer-forested (authored trees) on their upper slopes. On Amon Hen's summit
 *   the **Seat of Seeing**: a stone table on columns with a dark crown-like finial (#232932).
 * Brightest summery light (tod 15); lake #5f6f71, stone #48463f.
 */
const LAKE_Y = 0.39;

const TOL: V2 = [0.6, -3.3];
const HEN: V2 = [-8.0, 0.8];
const LHAW: V2 = [11.8, -1.2];

const STAMPS: LocalStamp[] = [
  {
    kind: 'massif',
    at: HEN,
    radius: 3.4,
    summit: 9.0,
    base: 3.5,
    exponent: 1.35,
    dome: 0.6,
    spurs: [
      { azimuthDeg: 350, lengthKm: 5, widthKm: 2.0, heightFrac: 0.5, rootFrac: 0.82 },
      { azimuthDeg: 55, lengthKm: 3.2, widthKm: 1.6, heightFrac: 0.4, rootFrac: 0.75 },
      { azimuthDeg: 150, lengthKm: 4.2, widthKm: 1.8, heightFrac: 0.42, rootFrac: 0.78 },
      { azimuthDeg: 210, lengthKm: 5.5, widthKm: 2.2, heightFrac: 0.48, rootFrac: 0.8 },
      { azimuthDeg: 280, lengthKm: 5, widthKm: 2.0, heightFrac: 0.38, rootFrac: 0.78 },
    ],
    flankSlope: 2.0,
    rough: { amp: 0.5, scaleKm: 2.0, ridged: true, seed: 11 },
  },
  {
    kind: 'massif',
    at: LHAW,
    radius: 3.4,
    summit: 8.6,
    base: 3.5,
    exponent: 1.35,
    dome: 0.55,
    spurs: [
      { azimuthDeg: 15, lengthKm: 5, widthKm: 2.0, heightFrac: 0.48, rootFrac: 0.8 },
      { azimuthDeg: 95, lengthKm: 4.5, widthKm: 2.0, heightFrac: 0.42, rootFrac: 0.78 },
      { azimuthDeg: 165, lengthKm: 5, widthKm: 2.0, heightFrac: 0.4, rootFrac: 0.78 },
      { azimuthDeg: 250, lengthKm: 3.0, widthKm: 1.6, heightFrac: 0.36, rootFrac: 0.72 },
    ],
    flankSlope: 2.0,
    rough: { amp: 0.5, scaleKm: 2.0, ridged: true, seed: 13 },
  },
  // Tol Brandir: the lake bed lifted into a small steep core that seats the crown's conifers; everything
  // seen of it is kit rock (terrain inside the lake mask renders as channel bed)
  { kind: 'plateau', at: TOL, radius: 0.22, height: 5.6, rim: 0.25 },
];

/** the film's stone (#48463f lit in shade; painted lighter, the family shades it), the Seat's dark finial */
const STONE = 0x86837a;
const ROCK = 0x7b7e78;
const FINIAL = 0x232932;
/** the Seat of Seeing on Amon Hen's summit, its front facing the lake (NE: seat-frame +z, yaw 135°) */
const SEAT: V2 = [-8.0, 0.85];
const SEAT_YAW = 135;

/** a closed ring path round `c` (radius wobbling by `wob`), walked so its cliff faces look OUTWARD */
function ring(c: V2, r: number, n: number, wob: number, ph: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * (i % n)) / n;
    const rr = r * (1 + wob * (0.6 * Math.sin(3 * a + ph) + 0.4 * Math.sin(5 * a + 2 * ph)));
    // counter-clockwise seen from above (north up): N → W → S → E, so the right-hand side is outside
    out.push([c[0] - rr * Math.sin(a), c[1] - rr * Math.cos(a)]);
  }
  return out;
}

export default defineLandmark({
  id: 'rauros',
  placeId: 'rauros',
  tier: 'B',
  stamps: STAMPS,
  proxy: (k) => {
    // ---- Tol Brandir: three stepped rings of sheer faceted rock tapering into a spire (an apron from under
    // the lake, a tower set back on it, a narrower crown), a wooded cap inside the crown's teeth, conifers
    const tiers: { r: number; base: number; h: number; ph: number }[] = [
      { r: 1.1, base: -0.8, h: 2.9, ph: 0.7 },
      { r: 0.85, base: 1.3, h: 3.0, ph: 2.1 },
      { r: 0.6, base: 3.3, h: 2.5, ph: 4.0 },
    ];
    for (const [t, tr] of tiers.entries()) {
      const path = ring(TOL, tr.r, 30 - 6 * t, 0.12, tr.ph);
      const hs = path.map((_, i) => tr.h * (1 + 0.1 * Math.sin(i * 0.9 + tr.ph)));
      k.cliff('weathered', path, hs, { at: [0, tr.base, 0], followGround: false, taper: 0, depth: 0.5 - 0.1 * t, overhang: 0.1, rough: 0.3, strata: 0.45, soft: 0.4, color: ROCK, shade: 1 + 0.04 * t });
    }
    k.lathe('foliage', [[0.46, 5.05], [0.36, 5.44], [0.2, 5.62], [0.001, 5.66]], { at: [TOL[0], 0, TOL[1]], seg: 16, color: 0x2e3d29, lod: 1 });
    k.scatter({ circle: { at: TOL, r: 0.2 } }, 6, (_i, x, z, u) => k.tree('conifer', x, z, { crownKm: 0.055 + 0.025 * u, heightKm: 0.28 + 0.1 * u }), { minSpacing: 0.09 });

    // ---- the lip of the falls: low rock ledges on both banks, facing downstream (the cataract is S4)
    const lip = { at: [0, -0.4, 0] as V3, followGround: false, depth: 0.5, rough: 0.35, strata: 0.5, soft: 0.45, color: ROCK, lod: 0 as const };
    k.cliff('weathered', [[-3.3, 3.8], [-2.6, 3.72], [-1.95, 3.7]], [1.4, 1.9, 1.7], lip);
    k.cliff('weathered', [[3.45, 3.78], [4.1, 3.8], [4.8, 3.9]], [1.7, 1.9, 1.3], { ...lip, shade: 0.95 });

    // ---- the Seat of Seeing: a dais, a stone table on four columns with a solid block under one end, the
    // dark crown-like finial of blade spires, steps up to it, a weathered beast on a plinth beside it
    const g = Math.min(...[[-0.2, -0.12], [0.2, -0.12], [-0.2, 0.12], [0.2, 0.12], [0, 0]].map(([dx, dz]) => k.ground(SEAT[0] + dx, SEAT[1] + dz)));
    const c = Math.cos((SEAT_YAW * Math.PI) / 180);
    const sn = Math.sin((SEAT_YAW * Math.PI) / 180);
    // seat frame (x along the table, z out of its front) → local, the kit's yaw convention (rot y)
    const P = (x: number, y: number, z: number): V3 => [SEAT[0] + x * c + z * sn, g + y, SEAT[1] - x * sn + z * c];
    const rot: V3 = [0, SEAT_YAW, 0];
    k.box('weathered', 0.4, 0.2, 0.24, { at: P(0, -0.16, 0), rot, color: STONE, shade: 0.92 });
    k.box('weathered', 0.34, 0.035, 0.14, { at: P(0, 0.15, -0.01), rot, color: STONE, shade: 1.05 });
    for (const [x, z] of [[-0.13, 0.05], [-0.04, 0.05], [0.05, 0.05], [-0.13, -0.05]] as V2[]) k.cylinder('weathered', 0.014, 0.017, 0.11, { at: P(x, 0.04, z), color: STONE, seg: 8 });
    k.box('weathered', 0.1, 0.11, 0.13, { at: P(0.11, 0.04, -0.01), rot, color: STONE, shade: 0.95 });
    k.cylinder('darkStone', 0.045, 0.05, 0.03, { at: P(0, 0.185, -0.01), color: FINIAL, seg: 10 });
    for (const [x, z, h] of [[0, -0.01, 0.13], [-0.03, -0.015, 0.09], [0.03, -0.005, 0.1], [-0.012, 0.02, 0.08], [0.015, -0.035, 0.085]] as V3[])
      k.cone('darkStone', 0.017, h, { at: P(x, 0.215, z), color: FINIAL, seg: 6 });
    for (let i = 0; i < 3; i++) k.box('weathered', 0.12, 0.02, 0.03, { at: P(-0.04, 0.04 - 0.02 * (i + 1), 0.13 + 0.03 * i), rot, color: STONE, shade: 0.9 });
    k.box('weathered', 0.07, 0.05, 0.05, { at: P(-0.26, -0.02, 0.06), rot, color: STONE, shade: 0.9 });
    k.rock('weathered', 0.028, { at: P(-0.26, 0.055, 0.06), squash: 0.7, color: STONE, detail: 1 });

    // ---- conifers: the two hills forested all over — a dense crown round the summit, thinning down the
    // lower slopes (dark film foliage, #151713 in the grade)
    const conifer = (_i: number, x: number, z: number, u: number) =>
      k.tree('conifer', x, z, { crownKm: 0.09 + 0.05 * u, heightKm: 0.38 + 0.18 * u, color: u < 0.5 ? 0x21321f : 0x1b2a1a });
    for (const [c, n0, n1] of [[HEN, 420, 230], [LHAW, 330, 190]] as [V2, number, number][]) {
      k.scatter({ annulus: { at: c, r0: c === HEN ? 0.45 : 0, r1: 2.8 } }, n0, conifer, { minSpacing: 0.2 });
      k.scatter({ annulus: { at: c, r0: 2.8, r1: 4.4 } }, n1, conifer, { minSpacing: 0.27 });
    }
  },
  waterFeatures: [{ kind: 'waterfall', path: [[0.74, LAKE_Y, 3.7], [0.76, -1.81, 3.95]] as V3[], width: 5.2 }],
  annotation: { title: 'Rauros', subtitle: 'Falls of Rauros and Amon Hen', blurb: 'Where the Great River thunders over the falls, and the Fellowship was broken.' },
  bookmarks: [
    { id: 'rauros-close', distanceKm: 30, elevationDeg: 16, azimuthDeg: 195, fov: 35, lift: 2, tod: 15, note: 'from the south over the lip of the falls: Tol Brandir in the lake between Amon Hen (left) and Amon Lhaw (right), Nen Hithoel beyond' },
  ],
});
