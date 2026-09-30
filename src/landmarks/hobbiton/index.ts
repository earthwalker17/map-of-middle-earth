import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { TreeDecl, V2 } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { archBridge, DOORS, facing, fallLine, hobbitHole, houseFloor, OCHRE, TIMBER, WARM } from './parts.ts';

/**
 * Hobbiton (research §1, the Matamata set): the Hill — a rounded green dome with Bag End's green round door
 * near the top under a big lone oak — terraces of round painted doors (Bagshot Row) set into its slopes
 * with gardens, fences and brick chimneys poking out of the turf; the mill pond at its foot, the mill with
 * its waterwheel and the double-arched stone bridge over the Water, the Green Dragon and the cottages of
 * Bywater across the stream; the Party Tree on the Party Field; hedgerows round the patchwork.
 *
 * Local frame: x east, z south (heading 0), km around the display point (places.json: 2 km north of the
 * canon point), heights relative to the base ground there. The Water (baked, level −1.04) runs west → east
 * 1.9–2.3 km south; the baked Bywater Pool lies south-east (x 2.6–4.7). Design scale: the Hill 4.8 km
 * across, hobbit-hole fronts ~0.2 km, doors ~0.08 km (≥ 12 px at the 9 km hero distance) — the
 * miniature's scale, readable as the Shire, never a model railway.
 */

/** the Hill's crown (local) */
const HILL: V2 = [0.05, -0.55];
/** the mill pond at the Hill's south foot (between Bagshot Row and the Water) */
const POND: V2 = [-0.58, 0.62];
const POND_R = 0.42;
/**
 * pond level and the Water's level relative to the base ground at the display point: the mill pond stands
 * 0.34 above the stream on the Hill's foot, held on the south by a low turf dam (kit geometry: the
 * 0.4 km heightfield cannot hold a bank that narrow) with the mill at its outfall
 */
const POND_REL = -0.7;
const WATER_REL = -1.041;
/**
 * composite ground at the display point relative to the base ground (the Hill's south flank after the
 * stamps; survey) — local y = 0 there, so relative heights become local by subtracting it
 */
const ORIGIN_REL = 1.18;
const POND_LEVEL = POND_REL - ORIGIN_REL;
const WATER = WATER_REL - ORIGIN_REL;

/** compass bearing (deg) and radius (km) round the Hill's crown → local */
const polar = (b: number, r: number): V2 => [HILL[0] + Math.sin((b * Math.PI) / 180) * r, HILL[1] - Math.cos((b * Math.PI) / 180) * r];

/** Bag End: high on the south-west face, facing the camera side and the Party Field */
const BAG_END = polar(218, 0.46);

/** the Party Field and its tree at the Hill's south-west foot */
const PARTY_TREE: V2 = [-2.3, -0.2];
/** the mill and the bridge over the Water; the Green Dragon across it */
const MILL: V2 = [0.3, 1.16];
const BRIDGE_X = 0.98;
const GREEN_DRAGON: V2 = [1.75, 3.45];

/** pond outline: the waterline on the Hill's slope to the north, west and east; the dam line on the south */
const POND_RING: V2[] = [
  [-1.3, 0.62],
  [-1.18, 0.2],
  [-0.82, -0.02],
  [-0.34, -0.02],
  [0.02, 0.2],
  [0.12, 0.66],
  [-0.02, 0.99],
  [-0.6, 1.02],
  [-1.14, 0.96],
];
/** the dam along the pond's south edge (local polyline, west → east) */
const DAM: V2[] = [
  [-1.2, 0.95],
  [-0.6, 1.02],
  [0.0, 0.99],
];

/** the garden, hedge and lane trees (authored oaks: they win the vegetation LOD0 cap) */
const GARDEN_TREES: TreeDecl[] = (
  [
    // round the Hill's foot and along the lanes
    [-1.2, 1.2, 0.17],
    [-0.9, 1.35, 0.13],
    [0.55, 1.28, 0.15],
    [1.35, 1.1, 0.19],
    [1.9, 0.6, 0.16],
    [2.25, -0.2, 0.2],
    [2.3, -1.2, 0.17],
    [1.6, -2.35, 0.2],
    [-1.4, -2.4, 0.18],
    [-2.3, -1.4, 0.21],
    [-2.55, -0.4, 0.17],
    [-1.55, 1.0, 0.14],
    [-2.7, 0.8, 0.16],
    [-3.0, 0.1, 0.18],
    // gardens on the Hill (small, between the rows)
    [-0.95, -0.15, 0.11],
    [-1.35, -0.75, 0.12],
    [0.95, 0.3, 0.12],
    [1.3, -0.35, 0.1],
    [-0.35, 0.05, 0.09],
    [0.55, -0.05, 0.1],
    // Bywater across the Water
    [0.2, 3.25, 0.15],
    [1.2, 3.1, 0.13],
    [2.3, 3.05, 0.16],
    [3.1, 3.35, 0.18],
    [0.6, 4.05, 0.16],
    [2.0, 4.1, 0.15],
    // by the river banks
    [-0.4, 1.35, 0.12],
    [1.5, 1.35, 0.13],
    [-2.0, 2.9, 0.18],
    [3.2, 1.05, 0.17],
  ] as [number, number, number][]
).map(([x, z, c], i) => ({ at: [x, z] as V2, kind: 'oak' as const, crownKm: c, heightKm: c * 1.65, yawDeg: (i * 137) % 360 }));

/** the lane along the Hill's foot from the bridge to the Party Field, hedged on its south side */
const LANE_HEDGE: V2[] = [
  [0.75, 1.24],
  [0.0, 1.3],
  [-0.95, 1.22],
  [-1.6, 1.02],
  [-2.4, 0.76],
];

export default defineLandmark({
  id: 'hobbiton',
  placeId: 'hobbiton',
  tier: 'A',
  stamps: [
    // the Hill: a rounded turf dome, never rough
    { kind: 'raise', at: HILL, radius: 2.5, amount: 1.55, surface: 'turf' },
    // the mill pond's bed cut into the Hill's foot (lowerOnly)
    { kind: 'flatten', at: POND, radius: 0.45, falloff: 0.3, height: POND_REL - 0.25, lowerOnly: true, surface: 'turf' },
    { kind: 'flatten', at: [POND[0], POND[1] - 0.1], radius: 0.22, falloff: 0.2, height: POND_REL - 0.55, lowerOnly: true, surface: 'turf' },
    // the Party Field: a level green at the Hill's south-west foot
    { kind: 'flatten', at: [-2.0, -0.2], radius: 0.5, falloff: 0.45, height: -0.05, lowerOnly: true, surface: 'turf' },
  ],
  // only the Hill, its gardens and the mill / bridge / inn are cleared: the hedgerow trees stay
  vegetationExclusion: [
    { at: HILL, r: 2.3 },
    { at: [0.5, 1.3], r: 0.8 },
    { at: [-2.0, -0.05], r: 0.65 },
    { at: [1.6, 3.5], r: 0.9 },
  ],
  trees: [
    // the Party Tree: very large, broad and full, on the Party Field
    { at: PARTY_TREE, kind: 'party', crownKm: 0.52, heightKm: 0.92, yawDeg: 30 },
    // the big lone oak over Bag End on the crown of the Hill
    { at: polar(40, 0.08), kind: 'oak', crownKm: 0.44, heightKm: 0.56, color: 0x4f6428, yawDeg: 200 },
    ...GARDEN_TREES,
  ],
  waterFeatures: [{ kind: 'pool', ring: POND_RING, level: POND_LEVEL }],
  proxy: (k) => {
    buildDam(k);
    // a hedge along the dam's crest (the pond's south bank)
    buildHedge(k, DAM, 0.075);
    buildHill(k);
    buildMillAndBridge(k);
    buildBywater(k);
    buildPartyField(k);
    buildHedge(k, LANE_HEDGE, 0.09);
  },
  annotation: { title: 'Hobbiton', subtitle: 'The Shire', blurb: 'Where the journey begins: Bag End, under the Hill, home of Bilbo and Frodo Baggins.' },
  bookmarks: [
    {
      id: 'hobbiton-close',
      distanceKm: 7.5,
      elevationDeg: 5,
      azimuthDeg: 218,
      fov: 35,
      lift: 0,
      aimKm: [0.4, -0.5],
      tod: 17.0,
      compare: ['reference/film/hobbiton/hobbiton-wide-fotr.jpg', 'reference/photos/hobbiton/bag-end-hill-set.jpg', 'reference/photos/hobbiton/hobbiton-mill-bridge-set.jpg'],
      note: 'hero (close, 7.5 km): low from the south-west in the late-afternoon sun (17.0: the south-west face of the Hill lit from the west; by 18.2, when the light turns golden, that face is in shadow) — the Hill with Bag End and the rows of round doors over the mill pond, the Party Tree on the left, the mill and the double-arched bridge over the Water in front',
    },
    {
      id: 'hobbiton-wide',
      distanceKm: 60,
      elevationDeg: 26,
      azimuthDeg: 215,
      fov: 35,
      lift: 0.5,
      tod: 17.0,
      compare: ['reference/film/hobbiton/hobbiton-wide-fotr.jpg'],
      note: 'the Shire: Hobbiton’s Hill and the Water in the patchwork of hedged fields and woods, golden afternoon',
    },
  ],
});

/** Bag End, Bagshot Row and the rows of holes round the Hill's southern half */
function buildHill(k: ProxyKit): void {
  // Bag End: the largest front, the green door, two windows, a gate and fence
  const be = hobbitHole(k, { at: BAG_END, w: 0.27, door: DOORS[0], doorR: 0.05, facade: 0xcfae6e, windows: 2, chimney: true, lit: true, fence: true });
  k.light([be[0], be[1] + 0.03, be[2]], { color: WARM, intensity: 0.9, radius: 0.014, kind: 'window' });
  // rows along the contours, facing down the fall line: from the crown's shoulder to the foot
  const rows: { r: number; from: number; to: number }[] = [
    { r: 0.85, from: 150, to: 285 },
    { r: 1.25, from: 128, to: 300 },
    { r: 1.65, from: 118, to: 312 },
    { r: 2.02, from: 138, to: 262 },
  ];
  let n = 0;
  rows.forEach((row, ri) => {
    let b = row.from + k.r(1) * 12;
    while (b < row.to) {
      const r = row.r + (k.r(2) - 0.5) * 0.08;
      const at = polar(b, r);
      const skip = k.r(3) < 0.2 || Math.hypot(at[0] - POND[0], at[1] - POND[1]) < POND_R + 0.28 || Math.hypot(at[0] - BAG_END[0], at[1] - BAG_END[1]) < 0.45 || fallLine(k, at[0], at[1]).slope > 1.25;
      if (!skip) {
        const i = n++;
        hobbitHole(k, {
          at,
          w: 0.17 + k.r(4) * 0.05,
          door: DOORS[(i * 3 + ri) % DOORS.length],
          facade: OCHRE[i % OCHRE.length],
          windows: i % 3 === 0 ? 2 : 1,
          chimney: i % 2 === 0,
          lit: i % 4 !== 3,
          fence: i % 3 !== 2,
          turn: (k.r(5) - 0.5) * 16,
          shade: 0.92 + k.r(6) * 0.14,
        });
      }
      // along the row: fronts 0.35–0.55 km apart (cosy, with gardens between)
      b += (((0.36 + k.r(7) * 0.2) / r) * 180) / Math.PI;
    }
  });
}

/**
 * The mill pond's turf dam: a strip along DAM whose flat top stands just above the water (extrude with
 * followGround: the top sits `height` above the highest ground under it, so it is offset down to the level)
 */
function buildDam(k: ProxyKit): void {
  for (let i = 0; i + 1 < DAM.length; i++) {
    const a = DAM[i];
    const b = DAM[i + 1];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz);
    const nx = (-dz / l) * 0.09;
    const nz = (dx / l) * 0.09;
    // overlap the segments a little at the joints
    const ex = (dx / l) * 0.03;
    const ez = (dz / l) * 0.03;
    const outline: V2[] = [
      [a[0] - ex + nx, a[1] - ez + nz],
      [b[0] + ex + nx, b[1] + ez + nz],
      [b[0] + ex - nx, b[1] + ez - nz],
      [a[0] - ex - nx, a[1] - ez - nz],
    ];
    const gMax = Math.max(...outline.map(([x, z]) => k.ground(x, z)));
    // the crest a hair above the water: from the low camera the pond shows over it
    const top = POND_LEVEL + 0.012;
    k.extrude('foliage', outline, 0.01, { followGround: true, at: [0, top - gMax - 0.01, 0], taper: 0.45, color: 0x5d712e, lod: 0 });
  }
}

/** the mill with its waterwheel at the pond's outfall, the double-arched bridge over the Water */
function buildMillAndBridge(k: ProxyKit): void {
  const [mx, mz] = MILL;
  const w = 0.36;
  const d = 0.17;
  const h = 0.14;
  // a stone footing on the water side, the half-timbered cream mill with a heavy thatch
  const floor = houseFloor(k, MILL, w, d, h, 0, 0.85);
  k.house('plaster', 'thatch', w, d, h, {
    at: [mx, 0, mz],
    pitch: 50,
    overhang: 0.025,
    color: 0xd8c79a,
    roofColor: 0x8d7442,
    roofGrain: 0.6,
    dig: 0.85,
    plinthFam: 'weathered',
    plinthColor: 0x857d6c,
    plinthGrow: 1.06,
    chimney: true,
    gableBoards: { color: 0x4a3a28, size: 0.008, horn: 0.012 },
    windows: { count: 2, on: 1, sides: 1, size: 0.012, color: WARM },
  });
  // timber framing on the long south side (dark posts)
  for (let i = -2; i <= 2; i++) k.box('wood', 0.012, h * 0.95, 0.006, { at: [mx + (i * w) / 5, floor + 0.02, mz + d / 2 + 0.002], color: 0x4a3a28, lod: 0 });
  // the waterwheel on the south wall, its foot in the race
  const wr = 0.1;
  const wx = mx + w * 0.3;
  const wz = mz + d / 2 + 0.03;
  const wy = Math.max(floor + 0.02, WATER + 0.06) + wr * 0.35;
  k.ring('wood', wr, 0.018, 0.035, { at: [wx, wy, wz - 0.0175], rot: [90, 0, 0], seg: 18, color: 0x4d3c2a, lod: 0 });
  for (let i = 0; i < 4; i++) k.box('wood', wr * 2, 0.01, 0.03, { at: [wx, wy - 0.005, wz - 0.015], rot: [0, 0, i * 45], color: 0x5a4632, lod: 0 });
  // a lit window by the door
  k.light([mx - w * 0.2, floor + h * 0.55, mz + d / 2 + 0.01], { color: WARM, intensity: 1, radius: 0.012, kind: 'window' });
  // the bridge: two round arches over the Water, humped over the stream, pale grey stone
  archBridge(k, BRIDGE_X, 1.2, 3.22, { width: 0.11, arches: 2, water: WATER, crown: WATER + 0.5, rise: 0.36, color: 0x958e80 });
}

/** the Green Dragon and the cottages of Bywater on the south bank */
function buildBywater(k: ProxyKit): void {
  const [gx, gz] = GREEN_DRAGON;
  // the inn: a long two-storey house with a slate-grey thatch, round-headed windows lit warm, facing the lane
  k.house('plaster', 'thatch', 0.4, 0.2, 0.14, {
    at: [gx, 0, gz],
    rot: [0, 10, 0],
    pitch: 48,
    overhang: 0.03,
    color: 0xd6c39a,
    roofColor: 0x6f6448,
    roofGrain: 0.55,
    chimney: true,
    ridge: { color: 0x5a523c },
    gableBoards: { color: 0x3f3020, size: 0.01, horn: 0.015 },
    windows: { count: 4, on: 1, sides: 2, size: 0.013, color: WARM, intensity: 1.2 },
  });
  const [nx, nz] = facing(10);
  const floor = houseFloor(k, GREEN_DRAGON, 0.4, 0.2, 0.14, 10, 0.5);
  k.cylinder('wood', 0.04, 0.04, 0.005, { at: [gx + nx * 0.102, floor + 0.062, gz + nz * 0.102], rot: [0, 10 + 90, 90], seg: 12, color: DOORS[0], lod: 0 });
  k.light([gx + nx * 0.18, floor + 0.08, gz + nz * 0.18], { color: 0xffb060, intensity: 1.2, radius: 0.02, kind: 'lamp' });
  // cottages: round doors, thatched roofs, a warm window each
  const cottages: [number, number, number][] = [
    [0.35, 3.6, -8],
    [0.85, 3.78, 6],
    [2.45, 3.3, 14],
    [2.85, 3.62, -4],
    [1.35, 3.95, 2],
  ];
  cottages.forEach(([x, z, yaw], i) => {
    const w = 0.18 + (i % 3) * 0.02;
    k.house('plaster', 'thatch', w, 0.13, 0.08, {
      at: [x, 0, z],
      rot: [0, yaw, 0],
      pitch: 50,
      overhang: 0.02,
      color: OCHRE[(i + 1) % OCHRE.length],
      roofColor: [0x8a7446, 0x7d6a42, 0x92804e][i % 3],
      roofGrain: 0.6,
      chimney: i % 2 === 0,
      windows: { count: 1, on: 1, sides: 1, size: 0.011, color: WARM },
    });
    const [cx, cz] = facing(yaw);
    const f = houseFloor(k, [x, z], w, 0.13, 0.08, yaw, 0.5);
    k.cylinder('wood', 0.028, 0.028, 0.005, { at: [x + cx * 0.067, f + 0.05, z + cz * 0.067], rot: [0, yaw + 90, 90], seg: 12, color: DOORS[(i + 1) % DOORS.length], lod: 0 });
  });
}

/** a hedge: a row of small leafy clumps along a polyline, `step` km apart */
function buildHedge(k: ProxyKit, path: V2[], step: number): void {
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n;
      const x = a[0] + (b[0] - a[0]) * t + (k.r(1) - 0.5) * 0.02;
      const z = a[1] + (b[1] - a[1]) * t + (k.r(2) - 0.5) * 0.02;
      k.rock('foliage', 0.045 + k.r(3) * 0.015, { at: [x, 0, z], seat: true, squash: 0.85, detail: 1, color: [0x44602a, 0x3e5826, 0x4b6630][j % 3], lod: 0 });
    }
  }
}

/** the Party Field: a pale marquee and lanterns by the Party Tree */
function buildPartyField(k: ProxyKit): void {
  // the marquee: low white walls under a tall white canvas roof
  k.house('plaster', 'plaster', 0.26, 0.15, 0.022, { at: [-1.72, 0, 0.02], rot: [0, 25, 0], pitch: 44, overhang: 0.012, color: 0xe8e2d4, roofColor: 0xf4f0e6, gableFam: 'plaster', plinthColor: 0x6a7a34 });
  const lamps: V2[] = [
    [-1.95, -0.25],
    [-1.85, 0.25],
    [-2.55, 0.15],
  ];
  for (const [x, z] of lamps) {
    k.cylinder('wood', 0.004, 0.005, 0.07, { at: [x, 0, z], seat: true, seg: 5, color: TIMBER, lod: 0 });
    k.light([x, k.ground(x, z) + 0.075, z], { color: 0xffc070, intensity: 0.9, radius: 0.012, kind: 'lamp' });
  }
  // the lane's picket fence along the Party Field
  const fence: V2[] = [
    [-2.55, 0.95],
    [-1.95, 1.08],
    [-1.35, 1.02],
  ];
  k.wallPath('wood', fence, 0.03, 0.004, { followGround: true, step: 0.05, color: 0xa08a68, crenel: { w: 0.004, h: 0.01, gap: 0.01, shape: 'point', lod: 0 }, lod: 0 });
}
