import { valueNoise } from '../../core/rng.ts';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';
import { defineLandmark } from '../types.ts';
import type { ForestDecl, LocalStamp } from '../types.ts';

/**
 * Rauros, Tol Brandir and the hills of the south end of Nen Hithoel (research §3; Tolkien's own sketch
 * "Rauros Falls & the Tindrock" and Nasmith's painting for the topology). Local frame: heading 0 (x east,
 * −z north); the origin is the lake's outlet, where the Anduin leaves Nen Hithoel (level 0.39 above the
 * origin ground; the baked lake is ≈ 11 km wide at the Tindrock); the river runs south 3.7 km to the lip of
 * the falls (a 2.2 drop, the bake's knickpoint) — the cataract itself is an S4 effect, the lip is kept
 * readable: low rock ledges on both banks, big rocks down both sides of the drop into the plunge pool (the
 * channel bed beside the sheet would show black) and three low rocks breaking the lip line.
 *
 * - **Tol Brandir** (the Tindrock), a sheer pinnacle standing out of the open lake above the outlet — the
 *   tallest thing at the south end (its crown clears both hills and the Argonath from the hero camera): one
 *   ragged fluted body (V flutes, flat vertical facets like columnar jointing) twisting and wandering up to
 *   a moss ledge a little over half-way up with a few conifers on it, an upper mass set off-centre on it and
 *   a broken crown of three blunt splintered stumps (≈ 12), a lesser stump beside it (S4 W5: the S3 stacked
 *   drums and needle read as a lighthouse / rocket). A plateau stamp (inside
 *   the 5 km onRiver footprint the lake keeps no guard) only seats the ledge's trees; terrain inside the
 *   lake mask renders as channel bed, so the rock hides all of it.
 * - **Amon Hen** (west) and **Amon Lhaw** (east): each a massif with an off-centre summit and a lower
 *   shoulder towards the lake (no witch-hat cones), set back from the shores — the river guard lets stamped
 *   ground rise only 2 units per km from a shore — forested on the lower and mid slopes by clumps of
 *   tapered conifers (two stacked crown tiers where silhouettes read: a broad lower crown and a narrow
 *   pointed top) over a dark forest floor (looks.json spots), thinning upwards to a bald rocky crown. On Amon Hen's summit the **Seat of Seeing**: a stone table on columns on
 *   a levelled dais, a dark crown-like finial (#232932).
 * Brightest summery light (tod 15); lake #5f6f71, stone #48463f.
 */
const LAKE_Y = 0.39;

const TOL: V2 = [0.6, -3.3];
/** Amon Hen: main summit (the Seat) and a lower shoulder towards the lake (NE) */
const HEN: V2 = [-8.3, 1.0];
const HEN_SHOULDER: V2 = [-6.6, -0.9];
/** Amon Lhaw: main summit and its shoulder towards the lake and the falls (SW) */
const LHAW: V2 = [12.1, -1.5];
const LHAW_SHOULDER: V2 = [10.2, 0.5];
/** the Seat of Seeing on Amon Hen's summit, its front facing the lake (NE: seat-frame +z, yaw 135°) */
const SEAT: V2 = [-8.3, 1.05];
const SEAT_YAW = 135;
/** height of Tol Brandir's tree ledge (local y) */
const LEDGE_Y = 7.45;

const STAMPS: LocalStamp[] = [
  {
    kind: 'massif',
    at: HEN,
    radius: 3.5,
    summit: 8.7,
    base: 3.5,
    exponent: 1.1,
    dome: 1,
    spurs: [
      { azimuthDeg: 335, lengthKm: 5, widthKm: 2.0, heightFrac: 0.55, rootFrac: 0.85 },
      { azimuthDeg: 150, lengthKm: 4.6, widthKm: 1.8, heightFrac: 0.38, rootFrac: 0.7 },
      { azimuthDeg: 215, lengthKm: 5.8, widthKm: 2.3, heightFrac: 0.5, rootFrac: 0.8 },
      { azimuthDeg: 270, lengthKm: 4.2, widthKm: 1.8, heightFrac: 0.32, rootFrac: 0.66 },
    ],
    flankSlope: 1.9,
    rough: { amp: 0.55, scaleKm: 2.0, ridged: true, seed: 11 },
    surface: 'auto',
  },
  {
    kind: 'massif',
    at: HEN_SHOULDER,
    radius: 2.0,
    summit: 7.0,
    base: 3.5,
    exponent: 1.25,
    dome: 0.5,
    spurs: [
      { azimuthDeg: 40, lengthKm: 2.8, widthKm: 1.6, heightFrac: 0.42, rootFrac: 0.75 },
      { azimuthDeg: 110, lengthKm: 2.4, widthKm: 1.4, heightFrac: 0.36, rootFrac: 0.7 },
    ],
    flankSlope: 2.1,
    rough: { amp: 0.4, scaleKm: 1.8, ridged: true, seed: 12 },
    surface: 'auto',
  },
  {
    kind: 'massif',
    at: LHAW,
    radius: 3.4,
    summit: 8.2,
    base: 3.5,
    exponent: 1.1,
    dome: 1,
    spurs: [
      { azimuthDeg: 10, lengthKm: 5, widthKm: 2.0, heightFrac: 0.5, rootFrac: 0.8 },
      { azimuthDeg: 100, lengthKm: 4.5, widthKm: 2.0, heightFrac: 0.4, rootFrac: 0.75 },
      { azimuthDeg: 175, lengthKm: 4.6, widthKm: 1.9, heightFrac: 0.44, rootFrac: 0.78 },
    ],
    flankSlope: 2.0,
    rough: { amp: 0.55, scaleKm: 2.0, ridged: true, seed: 13 },
    surface: 'auto',
  },
  {
    kind: 'massif',
    at: LHAW_SHOULDER,
    radius: 2.0,
    summit: 6.6,
    base: 3.5,
    exponent: 1.25,
    dome: 0.45,
    spurs: [
      { azimuthDeg: 235, lengthKm: 2.8, widthKm: 1.6, heightFrac: 0.4, rootFrac: 0.72 },
      { azimuthDeg: 300, lengthKm: 2.2, widthKm: 1.4, heightFrac: 0.34, rootFrac: 0.7 },
    ],
    flankSlope: 2.1,
    rough: { amp: 0.4, scaleKm: 1.8, ridged: true, seed: 14 },
    surface: 'auto',
  },
  // the Seat's dais: a small level clearing on the summit dome
  { kind: 'flatten', at: SEAT, radius: 0.3, falloff: 0.35, height: 'auto' },
  // Tol Brandir: the lake bed lifted into a column that seats the ledge's conifers; everything seen of it
  // is kit rock (terrain inside the lake mask renders as channel bed)
  { kind: 'plateau', at: TOL, radius: 0.6, height: LEDGE_Y, rim: 0.1 },
];

/** the film's stone (#48463f lit in shade; painted lighter, the family shades it), the Seat's dark finial */
const STONE = 0x86837a;
const ROCK = 0x7b7e78;
/**
 * (S4 W5: darker and grey — the S3 0x6a6c67 read as a pale turned column against the lake, a browner
 * 0x56574f as a wooden post under the warm sun)
 */
const TOL_ROCK = 0x5a5c59;
const FINIAL = 0x232932;
/** conifer crowns: lifted from near-black so they get form shading (the grade darkens them) */
const CONIFER = [0x26351f, 0x2b3a23, 0x223020, 0x2e3f27];

/**
 * Tol Brandir's section at height `y`: an irregular round (lobes wandering with height) of radius `R`, cut
 * by V flutes of seeded depth `fl` whose depth and rim wander with height too — jointed rock, not a turned
 * column. Worst case ≈ 0.62·R (a deep flute in a lobe's waist).
 */
function tolOutline(R: number, y: number, fl: number[], seed: number): V2[] {
  const out: V2[] = [];
  const n = 2 * fl.length;
  for (let j = 0; j < n; j++) {
    const a = (2 * Math.PI * j) / n;
    const shape = 1 + 0.08 * Math.cos(2 * (a - 0.6)) + 0.1 * (0.55 * Math.sin(2 * a + 0.9 + 0.11 * y) + 0.3 * Math.sin(3 * a + 2.1 - 0.08 * y) + 0.15 * Math.sin(5 * a + 0.4 + 0.17 * y));
    const jit = 1 + 0.1 * (valueNoise(j * 0.61, y * 0.45, seed) - 0.5);
    const groove = j % 2 === 0 ? 1 : 1 - fl[j >> 1] * (0.5 + valueNoise(j * 0.83, y * 0.6, seed + 1));
    const rr = R * shape * jit * groove;
    out.push([rr * Math.cos(a), rr * Math.sin(a)]);
  }
  return out;
}

/** a plain n-gon (the coarse cores of the LOD1/2 Tol) */
function ngon(R: number, n: number): V2[] {
  return Array.from({ length: n }, (_, j): V2 => [R * Math.cos((2 * Math.PI * j) / n), R * Math.sin((2 * Math.PI * j) / n)]);
}

/**
 * One Tol Brandir rock mass: a loft through fluted sections at the profile's heights [y, R], its axis
 * wandering ±`wander` km (the foot stays put) and each section's radius ±7 % — ragged edges and bulges, not a
 * turned column
 */
function tolLoft(k: ProxyKit, at: V3, rot: V3, prof: [number, number][], fl: number[], seed: number, shade: number, wander: number): void {
  const sections = prof.map(([y, R], i) => {
    const f = Math.min(1, i / 2);
    const wx = f * wander * (2 * valueNoise(i * 0.9, 0.3, seed + 5) - 1);
    const wz = f * wander * (2 * valueNoise(0.4, i * 0.9, seed + 6) - 1);
    const rr = R * (1 + 0.14 * (valueNoise(i * 1.3, 2.1, seed + 7) - 0.5));
    return { outline: tolOutline(rr, at[1] + y, fl, seed).map(([x, z]): V2 => [x + wx, z + wz]), y };
  });
  k.loft('weathered', sections, { at, rot, color: TOL_ROCK, shade, lod: 0 });
}

/**
 * A tapered conifer as two stacked authored crowns (the conifer recipe is one tall capsule: a broad lower
 * crown and a narrow pointed top half its radius, overlapping) — crown radius `c` km. The recipe's crown is
 * ≈ 3.8·radius tall, so the tree is ≈ 4.8·c + 0.05 tall.
 */
function conifer(k: ProxyKit, x: number, z: number, c: number, color: number): void {
  const h = 4.81 * c + 0.05;
  k.tree('conifer', x, z, { crownKm: c, heightKm: h - 1.04 * c, color });
  k.tree('conifer', x, z, { crownKm: 0.5 * c, heightKm: h, color });
}

/**
 * The conifer forests of Amon Hen and Amon Lhaw (landmark forests, placed by the vegetation system): the
 * lower and mid slopes within 4.2 km of each summit — 5.9 km down the long southern spurs, towards the falls
 * and the hero camera — in dense clumped stands (crowns packed closer than their diameter) with clearings,
 * a bald rocky crown round the summit (the Seat on Amon Hen) and none on the shore; tapered two-tier firs.
 */
function hillArea(hill: V2): V2[] {
  const out: V2[] = [];
  for (let a = 0; a < 360; a += 10) {
    const t = (a * Math.PI) / 180;
    // local z points south: the reach grows towards the south
    const reach = 4.2 + 1.7 * Math.max(0, Math.cos(t));
    out.push([hill[0] + Math.sin(t) * reach, hill[1] + Math.cos(t) * reach]);
  }
  return out;
}
const HILL_FORESTS: ForestDecl[] = [
  [HEN, HEN_SHOULDER],
  [LHAW, LHAW_SHOULDER],
].map(([hill, shoulder]) => ({
  area: { polygon: hillArea(hill) },
  // (S4 W5, C2 #23: half the S3 9.3 / km², heights spread ≈ 0.5–1.0 of the tallest, none on the steep
  // sides — the S3 hills were pincushions of identical cones; the grey rock shows through on the steeps)
  density: 5.5,
  species: [{ kind: 'conifer', share: 1, crownKm: [0.1, 0.257], heightFactor: [3.0, 4.9], colors: CONIFER }],
  clump: { scaleKm: 0.9, amount: 0.65 },
  edgeKm: 0.4,
  maxSlopeDeg: 64,
  avoid: [
    { at: hill, r: 0.45 },
    { at: shoulder, r: 0.3 },
  ],
  minY: LAKE_Y + 0.35,
}));

export default defineLandmark({
  id: 'rauros',
  placeId: 'rauros',
  tier: 'B',
  stamps: STAMPS,
  // Tol Brandir in the lake's reflection march (S4 C2): the body to the moss ledge, the upper mass and crown
  reflectors: [
    { at: TOL, r: 1.55, top: LEDGE_Y },
    { at: [TOL[0] + 0.35, TOL[1] - 0.3], r: 0.7, top: LEDGE_Y + 4.4 },
  ],
  proxy: (k) => {
    // ---- Tol Brandir (see the module doc)
    // (S4 W5: 28 shallow flutes, not 20 deep ones — the loft's flat facets showed the deep flutes as
    // full-height vertical bands, a fluted post)
    const flutes = Array.from({ length: 28 }, (_, i) => 0.008 + 0.03 * k.r(500 + i));
    // S4 W5 (C2 #23): ONE continuous body (the S3 three stacked, tilted drums read as a banded lighthouse):
    // sections every ≈ 0.6 km whose lobes twist ≈ 50° up the height (plus a wobble, so no facet runs straight
    // up the whole pillar) and whose axis wanders ±0.3 km, the radius swelling and pinching irregularly, the
    // foot flaring at the waterline (LAKE_Y ≈ 2.0 up the loft) — a sheer jointed pillar
    // (radii easing down smoothly, the swell and pinch and the wander smooth noise in height — per-section
    // jitter made horizontal rings at 0.6 km spacing)
    const body: [number, number][] = [[0, 1.95], [0.14, 1.95], [1.0, 1.9], [2.0, 1.76], [2.6, 1.68], [3.2, 1.64], [3.8, 1.6], [4.4, 1.57], [5.0, 1.54], [5.6, 1.51], [6.2, 1.48], [6.8, 1.45], [7.4, 1.42], [8.0, 1.39], [LEDGE_Y + 1.6 - 0.12, 1.34]];
    const bodySection = (i: number, scale = 1): V2[] => {
      const [y, R] = body[i];
      const f = Math.min(1, y / 2.6);
      const wx = f * 0.3 * (2 * valueNoise(y * 0.28, 0.3, 35) - 1);
      const wz = f * 0.3 * (2 * valueNoise(0.4, y * 0.28, 36) - 1);
      const rr = R * scale * (1 + 0.1 * (valueNoise(y * 0.3, 2.1, 37) - 0.5));
      const tw = (y / 9) * 0.87 + 0.22 * Math.sin(y * 1.3 + 0.5);
      return tolOutline(rr, y - 1.6, flutes, 31).map(([x, z]): V2 => [x * Math.cos(tw) - z * Math.sin(tw) + wx, x * Math.sin(tw) + z * Math.cos(tw) + wz]);
    };
    k.loft(
      'weathered',
      body.map(([y], i) => ({ outline: bodySection(i), y })),
      { at: [TOL[0], -1.6, TOL[1]], color: TOL_ROCK, shade: 0.97, lod: 0 },
    );
    // tumbled blocks round the foot at the waterline
    for (let i = 0; i < 12; i++) {
      const a = ((i + 0.6 * k.r(560 + i)) / 12) * Math.PI * 2;
      const r = 0.14 + 0.2 * k.r(580 + i);
      const d = 1.72 + 0.25 * k.r(600 + i) + 0.3 * r;
      k.rock('weathered', r, { at: [TOL[0] + Math.cos(a) * d, LAKE_Y - 0.25 * r, TOL[1] + Math.sin(a) * d], squash: 0.55, lump: 0.6, detail: 1, color: TOL_ROCK, shade: 0.85 + 0.15 * k.r(620 + i), lod: 0 });
    }
    // above the moss ledge: an upper mass set off to the north-east and a broken, ragged crown — three
    // blunt splintered stumps of different heights leaning apart (no needle point), a lesser stump beside it
    const UP_AT: V3 = [TOL[0] + 0.35, LEDGE_Y - 0.15, TOL[1] - 0.3];
    tolLoft(k, UP_AT, [2, 15, -2.5], [[0, 0.78], [0.6, 0.81], [1.3, 0.77], [2.0, 0.71], [2.6, 0.66], [3.0, 0.62]], flutes, 41, 1.0, 0.08);
    const crownTop = UP_AT[1] + 2.9;
    for (const [dx, dz, h, r, rot, sd] of [
      [0.12, -0.06, 1.6, 0.42, [-6, 25, -7], 42],
      [-0.28, 0.16, 1.05, 0.34, [8, 70, 5], 44],
      [0.3, 0.3, 0.7, 0.3, [4, 120, 9], 45],
    ] as [number, number, number, number, V3, number][])
      tolLoft(k, [UP_AT[0] + dx, crownTop, UP_AT[2] + dz], rot, [[0, r], [h * 0.45, r * 0.92], [h * 0.8, r * 0.78], [h, r * 0.6]], flutes.slice(0, 12), sd, 1.02, 0.05);
    tolLoft(k, [TOL[0] - 0.45, LEDGE_Y - 0.15, TOL[1] - 0.6], [5, 50, 6], [[0, 0.42], [0.6, 0.38], [1.1, 0.3], [1.4, 0.22]], flutes.slice(0, 8), 43, 0.97, 0.03);
    // coarse cores for LOD1/2 (hidden inside the fluted shells at LOD0)
    k.loft('weathered', [{ outline: ngon(1.35, 12), y: -1.6 }, { outline: ngon(1.15, 12), y: LEDGE_Y - 0.1 }], { at: [TOL[0], 0, TOL[1]], color: TOL_ROCK, lod: 2 });
    k.loft('weathered', [{ outline: ngon(0.66, 10), y: 0 }, { outline: ngon(0.5, 10), y: 2.9 }, { outline: ngon(0.25, 10), y: 4.3 }], { at: UP_AT, color: TOL_ROCK, lod: 2 });
    // the ledge: a low mossy mound over the body's top following its lobed edge (S4 W5: the round lathe disc
    // read as a flat green plate on a post), a few conifers on its south-west side (towards the falls)
    const top = body.length - 1;
    k.loft(
      'foliage',
      [
        { outline: bodySection(top, 0.985), y: LEDGE_Y - 0.15 },
        { outline: bodySection(top, 0.93), y: LEDGE_Y - 0.03 },
        { outline: bodySection(top, 0.72), y: LEDGE_Y + 0.06 },
        { outline: bodySection(top, 0.35), y: LEDGE_Y + 0.11 },
      ],
      { at: [TOL[0], 0, TOL[1]], color: 0x333d2a, shade: 0.95, lod: 1 },
    );
    k.scatter({ annulus: { at: TOL, r0: 0.36, r1: 0.62, a0: 180, a1: 290 } }, 7, (_i, x, z, u) => conifer(k, x, z, 0.05 + 0.03 * u, CONIFER[Math.floor(u * 4) % 4]), { minSpacing: 0.1 });

    // ---- the lip of the falls (the cataract is S4): low rock ledges on both banks facing downstream
    const lip = { at: [0, -0.4, 0] as V3, followGround: false, depth: 0.5, rough: 0.35, strata: 0.5, soft: 0.5, color: ROCK, lod: 0 as const };
    k.cliff('weathered', [[-3.3, 3.8], [-2.6, 3.72], [-1.95, 3.7]], [1.4, 1.9, 1.7], lip);
    k.cliff('weathered', [[3.45, 3.78], [4.1, 3.8], [4.8, 3.9]], [1.7, 1.9, 1.3], { ...lip, shade: 0.95 });
    // big rocks down both sides of the drop and in the plunge pool (the channel bed beside the sheet would
    // show black there), and three low rocks standing in the lip, breaking its straight line
    const plunge: [number, number, number, number][] = [
      [-1.25, -0.45, 3.72, 0.4], [-1.05, -1.15, 3.98, 0.38], [-1.3, -1.65, 4.35, 0.34], [-1.7, -1.0, 4.05, 0.36],
      [3.05, -0.5, 3.72, 0.38], [2.85, -1.25, 4.0, 0.34], [3.05, -1.7, 4.38, 0.3], [3.45, -1.0, 4.05, 0.34],
    ];
    for (const [x, y, z, r] of plunge) k.rock('weathered', r, { at: [x, y, z], squash: 0.85, lump: 0.32, color: ROCK, shade: 0.88, detail: 1, lod: 0 });
    const lipRocks: [number, number, number][] = [[-0.7, 3.66, 0.22], [0.95, 3.6, 0.3], [2.25, 3.7, 0.2]];
    for (const [x, z, r] of lipRocks)
      k.rock('weathered', r, { at: [x, LAKE_Y - 0.1, z], squash: 0.55, lump: 0.35, color: ROCK, shade: 0.85, detail: 1, lod: 0 });

    // ---- the Seat of Seeing: a dais, a stone table on four columns with a solid block under one end, the
    // dark crown-like finial of blade spires, steps up to it, a weathered beast on a plinth beside it. The
    // dais stands on the flattened clearing, its top a little above the highest ground under it
    const c = Math.cos((SEAT_YAW * Math.PI) / 180);
    const sn = Math.sin((SEAT_YAW * Math.PI) / 180);
    // seat frame (x along the table, z out of its front) → local, the kit's yaw convention (rot y)
    const S = (x: number, z: number): V2 => [SEAT[0] + x * c + z * sn, SEAT[1] - x * sn + z * c];
    const foot: V2[] = [[-0.2, -0.12], [0.2, -0.12], [-0.2, 0.12], [0.2, 0.12], [0, 0]];
    const g = Math.max(...foot.map(([x, z]) => k.ground(...S(x, z))));
    const P = (x: number, y: number, z: number): V3 => {
      const [lx, lz] = S(x, z);
      return [lx, g + y, lz];
    };
    const rot: V3 = [0, SEAT_YAW, 0];
    k.box('weathered', 0.4, 0.26, 0.24, { at: P(0, -0.2, 0), rot, color: STONE, shade: 0.92 });
    k.box('weathered', 0.34, 0.035, 0.14, { at: P(0, 0.15, -0.01), rot, color: STONE, shade: 1.05 });
    for (const [x, z] of [[-0.13, 0.05], [-0.04, 0.05], [0.05, 0.05], [-0.13, -0.05]] as V2[]) k.cylinder('weathered', 0.014, 0.017, 0.11, { at: P(x, 0.04, z), color: STONE, seg: 8 });
    k.box('weathered', 0.1, 0.11, 0.13, { at: P(0.11, 0.04, -0.01), rot, color: STONE, shade: 0.95 });
    k.cylinder('darkStone', 0.045, 0.05, 0.03, { at: P(0, 0.185, -0.01), color: FINIAL, seg: 10 });
    const spires: [number, number, number][] = [[0, -0.01, 0.13], [-0.03, -0.015, 0.09], [0.03, -0.005, 0.1], [-0.012, 0.02, 0.08], [0.015, -0.035, 0.085]];
    for (const [x, z, h] of spires) k.cone('darkStone', 0.017, h, { at: P(x, 0.215, z), color: FINIAL, seg: 6 });
    for (let i = 0; i < 3; i++) k.box('weathered', 0.12, 0.02, 0.03, { at: P(-0.04, 0.04 - 0.02 * (i + 1), 0.13 + 0.03 * i), rot, color: STONE, shade: 0.9 });
    k.box('weathered', 0.07, 0.05, 0.05, { at: P(-0.26, -0.02, 0.06), rot, color: STONE, shade: 0.9 });
    k.rock('weathered', 0.028, { at: P(-0.26, 0.055, 0.06), squash: 0.7, color: STONE, detail: 1 });
    // the bald rocky crown round the Seat: outcrops and boulders in the turf
    for (let i = 0; i < 9; i++) {
      const a = (2 * Math.PI * (i + 0.6 * k.r(700 + i))) / 9;
      const r = 0.22 + 0.2 * k.r(720 + i);
      k.rock('weathered', 0.035 + 0.04 * k.r(740 + i), { at: [SEAT[0] + Math.cos(a) * r, 0, SEAT[1] + Math.sin(a) * r], seat: true, squash: 0.6, color: ROCK, shade: 0.9, detail: 1, lod: 0 });
    }
  },
  forests: HILL_FORESTS,
  waterFeatures: [{ kind: 'waterfall', path: [[0.74, LAKE_Y, 3.7], [0.76, -1.81, 3.95]] as V3[], width: 5.2 }],
  annotation: { title: 'Rauros', subtitle: 'Falls of Rauros and Amon Hen', blurb: 'Where the Great River thunders over the falls, and the Fellowship was broken.' },
  bookmarks: [
    {
      id: 'rauros-close',
      distanceKm: 38,
      elevationDeg: 22,
      azimuthDeg: 195,
      fov: 38,
      lift: 5.5,
      aimKm: [0.6, 1.0],
      tod: 15,
      note: 'from the south, high over the lip of the falls: Tol Brandir towering out of the open lake between Amon Hen (left) and Amon Lhaw (right), its point clear of both hills and of the Argonath far up Nen Hithoel',
    },
  ],
});
