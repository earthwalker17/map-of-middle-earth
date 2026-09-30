import { type ProxyKit, SINK } from '../kit/ProxyKit.ts';
import type { TreeDecl, V2 } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { archBridge, DOORS, facing, fallLine, fence, hedge, hobbitHole, houseFloor, lane, OCHRE, TIMBER, WARM } from './parts.ts';

/**
 * Hobbiton (research §1, the Matamata set): the Hill — a broad, gently rounded green dome with Bag End's
 * green round door near the top under a big lone oak — rows of round painted doors (Bagshot Row) set into
 * its slopes along pale lanes, with gardens, hedges, fences and stubby brick chimneys on the turf; the mill
 * pond at its west foot with the mill and its waterwheel; the double-arched stone bridge over the Water;
 * the Green Dragon and the cottages of Bywater across the stream; the Party Tree on the Party Field at the
 * Hill's south-east foot; hedgerows round the patchwork.
 *
 * Local frame: x east, z south (heading 0), km around the display point (places.json: 2 km north of the
 * canon point), heights relative to the base ground there. The Water (baked, level −1.04, a broad reach
 * 0.8–1.0 km wide) runs west → east 1–2.5 km south; the baked Bywater Pool lies south-east (x 2.6–4.7).
 * Design scale: the Hill 6.4 km across and ~1 unit high, hobbit-hole fronts ~0.2 km, doors ~0.08 km — the
 * miniature's scale, readable as the Shire, never a model railway.
 */

/** the Hill's crown (local) */
const HILL: V2 = [0.05, -0.7];
/**
 * The mill pond at the Hill's west foot, outside its late-afternoon shadow: a level turf terrace (flatten,
 * 1.9 km across: the heightfield holds it) with a bowl cut into it (lowerOnly), so the water lies level
 * with the ground and the bank is a soft grassy lip — no dam. Heights relative to the base ground at the
 * display point: the terrace, the bed and the water (just below the lowest rim point; poolcheck survey).
 */
const POND: V2 = [-2.4, -0.9];
const TERRACE_REL = -0.06;
const BED_REL = TERRACE_REL - 0.24;
const POND_REL = TERRACE_REL - 0.08;
const WATER_REL = -1.041;
/**
 * composite ground at the display point relative to the base ground (the Hill's south flank after the
 * stamps; survey) — local y = 0 there, so relative heights become local by subtracting it. The proxy
 * checks it against the pond terrace and throws if a stamp change has made it stale.
 */
const ORIGIN_REL = 0.876;
/** the Hill's crown, flattened a little (lowerOnly): exactly this high relative to the base ground */
const CROWN_REL = 1.06;
const POND_LEVEL = POND_REL - ORIGIN_REL;
const WATER = WATER_REL - ORIGIN_REL;

/** compass bearing (deg) and radius (km) round the Hill's crown → local */
const polar = (b: number, r: number): V2 => [HILL[0] + Math.sin((b * Math.PI) / 180) * r, HILL[1] - Math.cos((b * Math.PI) / 180) * r];

/** Bag End: near the top of the south-west face, facing the camera side and the pond */
const BAG_END = polar(222, 0.72);

/** the Party Field and its tree at the Hill's south-east foot (its long shadow falls east, off the Hill) */
const PARTY_TREE: V2 = [2.15, 0.4];
const PARTY_FIELD: V2 = [1.85, 0.5];
/** the mill on the pond's north-east rim under the Hill's bank, its wheel in the pond on its south-west side */
const MILL: V2 = [-1.93, -1.35];
/** the bridge over the Water south-west of the pond, spanning its wet reach (0.8 km here) and no more */
const BRIDGE_X = -2.45;
const BRIDGE_Z: [number, number] = [0.8, 1.72];
const GREEN_DRAGON: V2 = [1.75, 3.45];

/** pond outline (local): on the terrace, round the bowl — dry ground ≥ the water all along it */
const POND_RING: V2[] = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  return [POND[0] + Math.cos(a) * 0.63, POND[1] + Math.sin(a) * 0.6] as V2;
});

/** the lane from the bridge past the pond and the mill, along the Hill's south foot to the Party Field */
const MAIN_LANE: V2[] = [
  [BRIDGE_X, BRIDGE_Z[0] - 0.02],
  [-2.4, 0.45],
  [-2.2, 0.12],
  [-1.85, 0.2],
  [-1.5, 0.4],
  [-1.15, 0.5],
  [-0.75, 0.46],
  [-0.2, 0.54],
  [0.45, 0.6],
  [1.1, 0.56],
  [1.55, 0.5],
];
/** the track from the main lane along the pond's east shore to the mill */
const MILL_TRACK: V2[] = [
  [-1.85, 0.2],
  [-1.62, -0.35],
  [-1.64, -0.95],
  [-1.8, -1.22],
];
/** the path from the lane up the south-west face to Bag End */
const BAG_END_PATH: V2[] = [
  [-0.75, 0.46],
  [-0.72, 0.22],
  [-0.6, 0.02],
  [BAG_END[0] - 0.05, BAG_END[1] + 0.1],
];

/** the rows of holes along the contours (radius round the crown, bearings) */
const ROWS: { r: number; from: number; to: number }[] = [
  { r: 0.98, from: 150, to: 300 },
  { r: 1.38, from: 138, to: 306 },
  { r: 1.78, from: 150, to: 296 },
];

/** the garden, hedge and lane trees (authored oaks: they win the vegetation LOD0 cap) */
const GARDEN_TREES: TreeDecl[] = (
  [
    // round the Hill's foot and along the lanes
    [-1.05, 0.72, 0.15],
    [-0.35, 0.78, 0.13],
    [-2.35, 0.45, 0.14],
    [0.25, 0.85, 0.16],
    [0.95, 0.8, 0.14],
    [1.3, 0.1, 0.18],
    [2.1, -0.6, 0.2],
    [2.3, -1.5, 0.17],
    [1.6, -2.55, 0.2],
    [-1.3, -2.6, 0.18],
    [-2.6, -2.1, 0.21],
    [-3.5, -1.5, 0.17],
    [-3.2, 0.3, 0.16],
    [-3.6, -0.5, 0.18],
    // gardens on the Hill (small, between the rows)
    [-1.2, -0.3, 0.11],
    [-1.45, -1.25, 0.12],
    [1.0, 0.05, 0.12],
    [1.4, -0.6, 0.1],
    [0.3, 0.12, 0.1],
    [-0.9, 0.15, 0.1],
    // Bywater across the Water
    [0.2, 3.25, 0.15],
    [1.2, 3.1, 0.13],
    [2.3, 3.05, 0.16],
    [3.1, 3.35, 0.18],
    [0.6, 4.05, 0.16],
    [2.0, 4.1, 0.15],
    // by the river banks
    [-2.25, 0.75, 0.13],
    [-3.1, 0.62, 0.15],
    [3.2, 1.05, 0.17],
  ] as [number, number, number][]
).map(([x, z, c], i) => ({ at: [x, z] as V2, kind: 'oak' as const, crownKm: c, heightKm: c * 1.65, yawDeg: (i * 137) % 360 }));

export default defineLandmark({
  id: 'hobbiton',
  placeId: 'hobbiton',
  tier: 'A',
  stamps: [
    // the Hill: a broad, gently rounded turf dome (never rough), its crown flattened a little
    { kind: 'raise', at: HILL, radius: 3.2, amount: 1.0, surface: 'turf' },
    { kind: 'flatten', at: HILL, radius: 0.55, falloff: 0.9, height: CROWN_REL, lowerOnly: true, surface: 'turf' },
    // the mill pond: a level turf terrace at the Hill's west foot and the bowl cut into it
    { kind: 'flatten', at: POND, radius: 0.95, falloff: 0.35, height: TERRACE_REL, surface: 'turf' },
    { kind: 'flatten', at: POND, radius: 0.24, falloff: 0.34, height: BED_REL, lowerOnly: true, surface: 'turf' },
    // the Party Field: a level green at the Hill's south-east foot
    { kind: 'flatten', at: PARTY_FIELD, radius: 0.45, falloff: 0.4, height: 'auto', lowerOnly: true, surface: 'turf' },
  ],
  // only the Hill, its gardens, the pond and the mill / bridge / inn are cleared: the hedgerow trees stay
  vegetationExclusion: [
    { at: HILL, r: 2.4 },
    { at: POND, r: 1.2 },
    { at: [BRIDGE_X, 1.25], r: 0.55 },
    { at: PARTY_FIELD, r: 0.6 },
    { at: [1.6, 3.5], r: 0.9 },
    // the hero view's foreground meadow across the Water (south-west of the bridge)
    { at: [-3.5, 2.5], r: 0.8 },
  ],
  trees: [
    // the Party Tree: very large, broad and full, on the Party Field
    { at: PARTY_TREE, kind: 'party', crownKm: 0.52, heightKm: 0.92, yawDeg: 30 },
    // the big lone oak on the crown of the Hill above Bag End
    { at: polar(212, 0.4), kind: 'oak', crownKm: 0.42, heightKm: 0.56, color: 0x4a6a26, yawDeg: 200 },
    ...GARDEN_TREES,
  ],
  waterFeatures: [{ kind: 'pool', ring: POND_RING, level: POND_LEVEL }],
  proxy: (k) => {
    // the survey constant behind the pond's level must still hold (the crown's flat top = CROWN_REL)
    const t = k.ground(HILL[0], HILL[1]);
    if (Math.abs(t - (CROWN_REL - ORIGIN_REL)) > 0.02) throw new Error(`hobbiton: ORIGIN_REL ${ORIGIN_REL} is stale (crown at ${(t + ORIGIN_REL).toFixed(3)} rel. base, expected ${CROWN_REL})`);
    buildHill(k);
    buildPond(k);
    buildMillAndBridge(k);
    buildBywater(k);
    buildPartyField(k);
    lane(k, MAIN_LANE, 0.038);
    lane(k, BAG_END_PATH, 0.026);
    lane(k, MILL_TRACK, 0.026);
    // a hedge along the main lane's downhill side past the pond and the mill
    hedge(
      k,
      MAIN_LANE.slice(1, 5).map(([x, z]) => [x, z + 0.06] as V2),
      0.032,
      0.03,
    );
  },
  annotation: { title: 'Hobbiton', subtitle: 'The Shire', blurb: 'Where the journey begins: Bag End, under the Hill, home of Bilbo and Frodo Baggins.' },
  bookmarks: [
    {
      id: 'hobbiton-close',
      distanceKm: 8.5,
      elevationDeg: 12,
      azimuthDeg: 228,
      fov: 35,
      lift: 0,
      aimKm: [-1.0, -0.05],
      tod: 17.8,
      compare: ['reference/film/hobbiton/hobbiton-wide-fotr.jpg', 'reference/photos/hobbiton/bag-end-hill-set.jpg', 'reference/photos/hobbiton/hobbiton-mill-bridge-set.jpg'],
      note: 'hero (close, 8.5 km): from the south-west in the golden late-afternoon sun (17.8: the lit south-west face of the Hill) — the broad Hill with Bag End under its oak and the rows of round doors along their lanes, the mill pond and the mill at its foot, the Water curving past in front with the double-arched bridge, the Party Tree to the right',
    },
    {
      id: 'hobbiton-wide',
      distanceKm: 60,
      elevationDeg: 26,
      azimuthDeg: 222,
      fov: 35,
      lift: 0.5,
      tod: 17.8,
      compare: ['reference/film/hobbiton/hobbiton-wide-fotr.jpg'],
      note: 'the Shire: Hobbiton’s Hill and the Water in the patchwork of hedged fields and woods, golden afternoon',
    },
  ],
});

/** Bag End, Bagshot Row and the rows of holes round the Hill's southern half, each row on its lane */
function buildHill(k: ProxyKit): void {
  // Bag End: the largest front, the green door, two windows, a hedged garden
  const be = hobbitHole(k, { at: BAG_END, w: 0.27, door: DOORS[0], doorR: 0.05, facade: 0xcfae6e, windows: 2, chimney: true, lit: true, spark: true, edge: 'hedge' });
  k.light([be[0], be[1] + 0.03, be[2]], { color: WARM, intensity: 0.9, radius: 0.014, kind: 'window' });
  let n = 0;
  ROWS.forEach((row, ri) => {
    // the row's lane just below its fronts, fenced on its downhill side on alternate rows
    const lanePts: V2[] = [];
    for (let b = row.from; b <= row.to + 1e-6; b += 6) lanePts.push(polar(b, row.r + 0.13));
    const dry = lanePts.filter(([x, z]) => Math.hypot(x - POND[0], z - POND[1]) > 0.8 && k.ground(x, z) > WATER + 0.25);
    if (dry.length > 2) {
      lane(k, dry, 0.03);
      if (ri % 2 === 0) fence(k, dry.map(([x, z]) => [x + (x - HILL[0]) * 0.03, z + (z - HILL[1]) * 0.03] as V2));
    }
    let b = row.from + k.r(1) * 12;
    while (b < row.to) {
      const r = row.r + (k.r(2) - 0.5) * 0.06;
      const at = polar(b, r);
      const nearPond = Math.hypot(at[0] - POND[0], at[1] - POND[1]) < 1.1;
      const skip = k.r(3) < 0.18 || nearPond || Math.hypot(at[0] - MILL[0], at[1] - MILL[1]) < 0.4 || Math.hypot(at[0] - BAG_END[0], at[1] - BAG_END[1]) < 0.4 || k.ground(at[0], at[1]) < WATER + 0.3 || fallLine(k, at[0], at[1]).slope > 1.4;
      if (!skip) {
        const i = n++;
        const face = (fallLine(k, at[0], at[1]).yaw + 360) % 360;
        const lit = i % 4 !== 3;
        hobbitHole(k, {
          at,
          w: 0.18 + k.r(4) * 0.05,
          door: DOORS[(i * 3 + ri) % DOORS.length],
          facade: OCHRE[i % OCHRE.length],
          windows: i % 3 === 0 ? 2 : 1,
          chimney: i % 2 === 0,
          lit,
          // a spark (EmissionSystem) only for fronts facing the south-west half, where the hero and night
          // cameras see them from the front — seen side-on a sprite would float beside the hood
          spark: lit && face > 150 && face < 300,
          edge: i % 3 === 0 ? 'fence' : 'hedge',
          turn: (k.r(5) - 0.5) * 14,
          shade: 0.92 + k.r(6) * 0.14,
        });
      }
      // along the row: fronts 0.34–0.52 km apart (cosy, with gardens between)
      b += (((0.34 + k.r(7) * 0.18) / r) * 180) / Math.PI;
    }
  });
  // the path up to Bag End is hedged on its west side
  hedge(
    k,
    BAG_END_PATH.map(([x, z]) => [x - 0.05, z] as V2),
    0.03,
    0.024,
  );
}

/** reeds round the pond's rim: tufts of three slender pale green-gold blades, except at the mill */
function buildPond(k: ProxyKit): void {
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + k.r(1) * 0.15;
    const r = 0.52 + k.r(2) * 0.07;
    const x = POND[0] + Math.cos(a) * r;
    const z = POND[1] + Math.sin(a) * r;
    if (Math.hypot(x - MILL[0], z - MILL[1]) < 0.3) continue;
    if (k.r(3) < 0.25) continue;
    const c = [0x8a9448, 0x7a8a3e, 0x9a9a52][i % 3];
    for (let j = 0; j < 3; j++) {
      const ox = (k.r(4) - 0.5) * 0.025;
      const oz = (k.r(5) - 0.5) * 0.025;
      k.cone('foliage', 0.005, 0.03 + k.r(6) * 0.02, { at: [x + ox, k.ground(x + ox, z + oz) - 0.01, z + oz], seg: 5, color: c, lod: 0 });
    }
  }
}

/** the mill on the pond's rim with its waterwheel in the pond, the double-arched bridge over the Water */
function buildMillAndBridge(k: ProxyKit): void {
  const [mx, mz] = MILL;
  const w = 0.34;
  const d = 0.17;
  const h = 0.13;
  // facing the pond (its +z toward the pond's centre)
  const yaw = (Math.atan2(POND[0] - mx, POND[1] - mz) * 180) / Math.PI;
  const [nx, nz] = facing(yaw);
  const rx = Math.cos((yaw * Math.PI) / 180);
  const rz = -Math.sin((yaw * Math.PI) / 180);
  const dig = 0.3;
  const floor = houseFloor(k, MILL, w, d, h, yaw, dig);
  // the half-timbered cream mill on a short stone base, under a heavy warm-straw thatch
  k.house('plaster', 'thatch', w, d, h, {
    at: [mx, 0, mz],
    rot: [0, yaw, 0],
    pitch: 50,
    overhang: 0.025,
    color: 0xdccb9c,
    roofColor: 0xa58a52,
    roofGrain: 0.6,
    dig,
    plinthFam: 'weathered',
    plinthColor: 0x857d6c,
    plinthGrow: 1.06,
    chimney: true,
    gableBoards: { color: 0x4a3a28, size: 0.008, horn: 0.012 },
    windows: { count: 2, on: 1, sides: 1, size: 0.012, color: WARM },
  });
  // timber framing on the pond side (dark posts and a rail)
  for (let i = -2; i <= 2; i++) {
    const u = (i * w) / 5;
    k.box('wood', 0.012, h * 0.95, 0.006, { at: [mx + rx * u + nx * (d / 2 + 0.002), floor + SINK, mz + rz * u + nz * (d / 2 + 0.002)], rot: [0, yaw, 0], color: 0x4a3a28, lod: 0 });
  }
  k.box('wood', w * 0.98, 0.01, 0.006, { at: [mx + nx * (d / 2 + 0.003), floor + SINK + h * 0.5, mz + nz * (d / 2 + 0.003)], rot: [0, yaw, 0], color: 0x4a3a28, lod: 0 });
  // the waterwheel on the pond side, its lower third in the water
  const wr = 0.1;
  const wx = mx + rx * w * 0.28 + nx * (d / 2 + 0.035);
  const wz = mz + rz * w * 0.28 + nz * (d / 2 + 0.035);
  const wy = POND_LEVEL + wr * 0.35;
  k.ring('wood', wr, 0.018, 0.035, { at: [wx - nx * 0.0175, wy, wz - nz * 0.0175], rot: [0, yaw + 90, 90], seg: 18, color: 0x4d3c2a, lod: 0 });
  for (let i = 0; i < 4; i++) k.box('wood', wr * 2, 0.01, 0.03, { at: [wx, wy - 0.005, wz], rot: [0, yaw, i * 45], color: 0x5a4632, lod: 0 });
  // a lit window by the door
  k.light([mx - rx * w * 0.2 + nx * (d / 2 + 0.01), floor + h * 0.55, mz - rz * w * 0.2 + nz * (d / 2 + 0.01)], { color: WARM, intensity: 1, radius: 0.012, kind: 'window' });
  // the bridge: two round arches over the Water, humped over the stream, weathered grey-brown stone
  archBridge(k, BRIDGE_X, BRIDGE_Z[0], BRIDGE_Z[1], { width: 0.11, arches: 2, water: WATER, crown: WATER + 0.34, rise: 0.22, color: 0x7a7064 });
}

/** the Green Dragon and the cottages of Bywater on the south bank */
function buildBywater(k: ProxyKit): void {
  const [gx, gz] = GREEN_DRAGON;
  // the inn: a long two-storey house with a slate-grey thatch, lit windows, facing the lane
  k.house('plaster', 'thatch', 0.4, 0.2, 0.14, {
    at: [gx, 0, gz],
    rot: [0, 10, 0],
    pitch: 48,
    overhang: 0.03,
    color: 0xd6c39a,
    roofColor: 0x7a6a48,
    roofGrain: 0.55,
    chimney: true,
    dig: 0.15,
    plinthFam: 'weathered',
    plinthColor: 0x857d6c,
    ridge: { color: 0x5a523c },
    gableBoards: { color: 0x3f3020, size: 0.01, horn: 0.015 },
    windows: { count: 4, on: 1, sides: 2, size: 0.013, color: WARM, intensity: 1.2 },
  });
  const [nx, nz] = facing(10);
  const floor = houseFloor(k, GREEN_DRAGON, 0.4, 0.2, 0.14, 10, 0.15);
  k.cylinder('wood', 0.04, 0.04, 0.005, { at: [gx + nx * 0.102, floor + 0.062, gz + nz * 0.102], rot: [0, 10 + 90, 90], seg: 12, color: DOORS[0], lod: 0 });
  k.light([gx + nx * 0.18, floor + 0.08, gz + nz * 0.18], { color: 0xffb060, intensity: 1.2, radius: 0.02, kind: 'lamp' });
  // cottages: stone plinths down to the ground, cream walls with dark half-timbering, warm straw thatch,
  // a round door and a warm window each
  const cottages: [number, number, number][] = [
    [0.35, 3.6, -8],
    [0.85, 3.78, 6],
    [2.45, 3.3, 14],
    [2.85, 3.62, -4],
    [1.35, 3.95, 2],
  ];
  cottages.forEach(([x, z, yaw], i) => {
    const w = 0.18 + (i % 3) * 0.02;
    const d = 0.13;
    const h = 0.08;
    k.house('plaster', 'thatch', w, d, h, {
      at: [x, 0, z],
      rot: [0, yaw, 0],
      pitch: 50,
      overhang: 0.02,
      color: [0xe0d2ae, 0xd8c8a0, 0xe4d8b8][i % 3],
      roofColor: [0xa58a52, 0x9a8048, 0xae9258][i % 3],
      roofGrain: 0.6,
      dig: 0.15,
      plinthFam: 'weathered',
      plinthColor: 0x857d6c,
      plinthGrow: 1.05,
      chimney: i % 2 === 0,
      windows: { count: 1, on: 1, sides: 1, size: 0.011, color: WARM },
    });
    const [cx, cz] = facing(yaw);
    const rx = Math.cos((yaw * Math.PI) / 180);
    const rz = -Math.sin((yaw * Math.PI) / 180);
    const f = houseFloor(k, [x, z], w, d, h, yaw, 0.15);
    k.cylinder('wood', 0.028, 0.028, 0.005, { at: [x + cx * (d / 2 + 0.002), f + 0.05, z + cz * (d / 2 + 0.002)], rot: [0, yaw + 90, 90], seg: 12, color: DOORS[(i + 1) % DOORS.length], lod: 0 });
    // half-timbering: dark posts across the front
    for (const u of [-0.42, -0.14, 0.14, 0.42]) {
      if (Math.abs(u * w) < 0.035) continue;
      k.box('wood', 0.008, h * 0.92, 0.004, { at: [x + rx * u * w + cx * (d / 2 + 0.002), f + SINK, z + rz * u * w + cz * (d / 2 + 0.002)], rot: [0, yaw, 0], color: 0x4a3a28, lod: 0 });
    }
  });
}

/** the Party Field: a pointed canvas tent and lanterns by the Party Tree, hedged along its south side */
function buildPartyField(k: ProxyKit): void {
  const [px, pz] = PARTY_FIELD;
  // the marquee: a steep ridge tent of cream canvas with a paler stripe along its ridge
  k.house('plaster', 'plaster', 0.15, 0.09, 0.018, { at: [px - 0.25, 0, pz + 0.18], rot: [0, 20, 0], pitch: 58, overhang: 0.008, color: 0xeee6d2, roofColor: 0xf2ead8, ridge: { fam: 'plaster', color: 0xfaf6ec, size: 0.012 }, gableFam: 'plaster', dig: 0.1, plinthColor: 0x5d7a2c });
  const lamps: V2[] = [
    [px - 0.05, pz - 0.2],
    [px + 0.3, pz + 0.15],
    [px - 0.45, pz - 0.05],
  ];
  for (const [x, z] of lamps) {
    k.cylinder('wood', 0.004, 0.005, 0.07, { at: [x, 0, z], seat: true, seg: 5, color: TIMBER, lod: 0 });
    k.light([x, k.ground(x, z) + 0.075, z], { color: 0xffc070, intensity: 0.9, radius: 0.012, kind: 'lamp' });
  }
  hedge(
    k,
    [
      [px - 0.6, pz + 0.42],
      [px - 0.1, pz + 0.5],
      [px + 0.45, pz + 0.42],
    ],
    0.032,
    0.028,
  );
}
