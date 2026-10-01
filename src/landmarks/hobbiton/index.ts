import { type ProxyKit, SINK } from '../kit/ProxyKit.ts';
import type { TreeDecl, V2 } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { archBridge, cottage, DOORS, facing, fallLine, faceRot, hedge, hobbitHole, houseFloor, lane, OCHRE, TIMBER, WARM, type Hole } from './parts.ts';

/**
 * Hobbiton (research §1, the Matamata set): the Hill — a broad, gently rounded green dome — with Bag End
 * near the top under its great spreading oak, its big round green door on a terrace; below it, rows of
 * hobbit-holes along the contours of the south-west face (Bagshot Row and the rows below), each dug into
 * the slope behind its own LEVEL garden terrace (dry-stone retaining face, lawn, vegetable and flower
 * beds, a picket fence or a hedge, a chimney poking out of the turf, round windows in yellow frames), the
 * rows strung on lanes of worn soil that lie in the grass; the mill pond at the Hill's west foot with the
 * stone-and-timber mill and its waterwheel; the double-arched rubble-stone bridge over the Water; the Green
 * Dragon and the cottages of Bywater across the stream; the Party Field with its own great tree at the
 * Hill's south-east foot; hedgerows round the patchwork.
 *
 * Local frame: x east, z south (heading 0), km around the display point (places.json: 2 km north of the
 * canon point), heights relative to the base ground there. The Water (baked, level −1.04, a broad reach
 * 0.8–1.0 km wide) runs west → east 1–2.5 km south; the baked Bywater Pool lies south-east (x 2.6–4.7).
 * Design scale: the Hill 6.4 km across and ~1 unit high, hobbit-hole fronts ~0.25 km, doors ~0.08 km — the
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
const ORIGIN_REL = 1.404;
/** the Hill's crown, flattened a little (lowerOnly): exactly this high relative to the base ground */
const CROWN_REL = 1.06;
/**
 * Bag Hill: a rounded knoll raised on the Hill's broad crown at its south-west corner, so the face the
 * hero sees rises evenly from the main lane to a top ≈ 1 unit above it — room for the rows of terraced
 * holes, Bag End near the top and the great oak on it (applied after the crown flatten and before the
 * pond terrace, which keeps its level)
 */
const KNOLL: V2 = [-0.35, -0.7];
const KNOLL_R = 2.2;
const KNOLL_AMOUNT = 0.75;
const POND_LEVEL = POND_REL - ORIGIN_REL;
const WATER = WATER_REL - ORIGIN_REL;

const DEG = Math.PI / 180;
/** compass bearing (deg) → unit vector (x, z) */
const dirOf = (b: number): V2 => [Math.sin(b * DEG), -Math.cos(b * DEG)];
/** compass bearing (deg) and radius (km) round the Hill's crown → local */
const polar = (b: number, r: number): V2 => [HILL[0] + Math.sin(b * DEG) * r, HILL[1] - Math.cos(b * DEG) * r];

/** the top of Bag Hill (local; the knoll on the crown, ≈ 0.36) — the rows' contours are marched from it */
const TOP: V2 = [-0.4, -0.9];
/** Bag End: near the top of the south-west face (on the 0.25 contour), facing the hero camera and the pond */
const BAG_END_BEARING = 218;
const BAG_END_LEVEL = 0.25;

/** the Party Field and its tree at the Hill's south-east foot (its long shadow falls east, off the Hill) */
const PARTY_TREE: V2 = [2.15, 0.4];
const PARTY_FIELD: V2 = [1.85, 0.5];
/** the mill on the pond's north-east rim under the Hill's bank, its wheel well out in the water on its
 * south-west side (the open water reaches ≈ 0.42 km from the pond's centre; survey) */
const MILL: V2 = [-2.06, -1.24];
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
  [-1.86, -1.2],
];
/** the lane from the bridge's south end up the far bank to Bywater (clear of the Water's flood plain) */
const BYWATER_LANE: V2[] = [
  [BRIDGE_X, BRIDGE_Z[1] + 0.03],
  [-2.3, 2.6],
  [-1.6, 3.0],
  [-0.6, 3.25],
  [0.3, 3.35],
  [1.1, 3.4],
  [1.55, 3.42],
];

/** the rows of holes: contour levels (local y) down the south-west face, the bearing range of each row */
const ROWS: { level: number; from: number; to: number }[] = [
  { level: 0.15, from: 110, to: 290 },
  { level: -0.06, from: 105, to: 290 },
  { level: -0.25, from: 105, to: 290 },
  { level: -0.42, from: 150, to: 290 },
];

/** the trees round the Hill's foot, along the lanes, at Bywater and by the river (authored oaks) */
const FOOT_TREES: TreeDecl[] = (
  [
    [-1.05, 0.74, 0.15],
    [-0.35, 0.8, 0.13],
    [-2.32, 0.42, 0.14],
    [0.25, 0.86, 0.16],
    [0.95, 0.82, 0.14],
    [1.3, 0.12, 0.18],
    [2.1, -0.6, 0.2],
    [2.3, -1.5, 0.17],
    [1.6, -2.55, 0.2],
    [-1.3, -2.6, 0.18],
    [-2.6, -2.1, 0.21],
    [-3.5, -1.5, 0.17],
    [-3.2, 0.3, 0.16],
    [-3.6, -0.5, 0.18],
    // Bywater across the Water
    [0.2, 3.1, 0.15],
    [1.2, 3.0, 0.13],
    [2.3, 3.05, 0.16],
    [3.1, 3.35, 0.18],
    [0.6, 4.05, 0.16],
    [2.0, 4.1, 0.15],
    // by the river banks (willows lean over the water)
    [-2.25, 0.75, 0.13],
    [-3.1, 0.62, 0.15],
    [3.2, 1.05, 0.17],
  ] as [number, number, number][]
).map(([x, z, c], i) => ({ at: [x, z] as V2, kind: (i >= 20 ? 'willow' : 'oak') as TreeDecl['kind'], crownKm: c, heightKm: c * 1.6, yawDeg: (i * 137) % 360 }));

/** distance from (x, z) to a polyline and the nearest point on it */
function nearest(path: V2[], x: number, z: number): { d: number; p: V2 } {
  let best = { d: Infinity, p: path[0] };
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez || 1)));
    const p: V2 = [a[0] + ex * t, a[1] + ez * t];
    const d = Math.hypot(x - p[0], z - p[1]);
    if (d < best.d) best = { d, p };
  }
  return best;
}

/** the contour at local height `level` round Bag Hill's top, marched outward along bearings b0..b1 (step 2°) */
function contour(k: ProxyKit, level: number, b0: number, b1: number): { b: number; p: V2 }[] {
  const out: { b: number; p: V2 }[] = [];
  for (let b = b0; b <= b1 + 1e-6; b += 2) {
    const [dx, dz] = dirOf(b);
    let r = 0.1;
    while (r < 3.4 && k.ground(TOP[0] + dx * r, TOP[1] + dz * r) > level) r += 0.01;
    out.push({ b, p: [TOP[0] + dx * r, TOP[1] + dz * r] });
  }
  // smooth a little (no saw teeth from the march)
  return out.map((q, i) => {
    const a = out[Math.max(0, i - 1)].p;
    const c = out[Math.min(out.length - 1, i + 1)].p;
    return { b: q.b, p: [(a[0] + 2 * q.p[0] + c[0]) / 4, (a[1] + 2 * q.p[1] + c[1]) / 4] as V2 };
  });
}

/** Bag End's front on the BAG_END_LEVEL contour */
function bagEndAt(k: ProxyKit): V2 {
  return contour(k, BAG_END_LEVEL, BAG_END_BEARING, BAG_END_BEARING)[0].p;
}

export default defineLandmark({
  id: 'hobbiton',
  placeId: 'hobbiton',
  tier: 'A',
  stamps: [
    // the Hill: a broad, gently rounded turf dome (never rough), its crown flattened a little
    { kind: 'raise', at: HILL, radius: 3.2, amount: 1.0, surface: 'turf' },
    { kind: 'flatten', at: HILL, radius: 0.55, falloff: 0.9, height: CROWN_REL, lowerOnly: true, surface: 'turf' },
    // Bag Hill, the knoll on the crown's south-west corner
    { kind: 'raise', at: KNOLL, radius: KNOLL_R, amount: KNOLL_AMOUNT, surface: 'turf' },
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
    { at: PARTY_TREE, kind: 'party', crownKm: 0.55, heightKm: 0.95, yawDeg: 30 },
    ...FOOT_TREES,
  ],
  // S4 tree-height caps: the great oak over Bag End (≈ twice the garden trees, never dwarfing the Hill) and
  // the Party Tree stay at a believable size beside the 0.25 km hobbit-hole fronts
  treeCaps: [
    { at: TOP, r: 0.8, maxHeightKm: 0.42 },
    { at: PARTY_TREE, r: 0.4, maxHeightKm: 0.6 },
  ],
  waterFeatures: [{ kind: 'pool', ring: POND_RING, level: POND_LEVEL }],
  proxy: (k) => {
    // the survey constant behind the pond's level must still hold (the pond terrace's level ring = TERRACE_REL)
    const t = k.ground(POND[0] + 0.75, POND[1]);
    if (Math.abs(t - (TERRACE_REL - ORIGIN_REL)) > 0.01) throw new Error(`hobbiton: ORIGIN_REL ${ORIGIN_REL} is stale (pond terrace at ${(t + ORIGIN_REL).toFixed(3)} rel. base, expected ${TERRACE_REL})`);
    buildHill(k);
    buildMill(k);
    // the bridge: two round arches over the Water, humped over the stream, weathered rubble stone
    archBridge(k, BRIDGE_X, BRIDGE_Z[0], BRIDGE_Z[1], { width: 0.11, arches: 2, water: WATER, crown: WATER + 0.34, rise: 0.22, color: 0x857a6a });
    buildBywater(k);
    buildPartyField(k);
    lane(k, MAIN_LANE, 0.042);
    lane(k, MILL_TRACK, 0.03);
    lane(k, BYWATER_LANE, 0.038);
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
      distanceKm: 7,
      elevationDeg: 9,
      azimuthDeg: 205,
      fov: 17,
      lift: 0.15,
      aimKm: [-0.25, 0.35],
      tod: 17.8,
      compare: ['reference/film/hobbiton/hobbiton-wide-fotr.jpg', 'reference/photos/hobbiton/bag-end-hill-set.jpg', 'reference/photos/hobbiton/hobbiton-mill-bridge-set.jpg'],
      note: 'hero (close, 7 km, fov 17): low from the south-south-west in the golden late-afternoon sun (17.8: the lit south-west face of the Hill) — Bag Hill filling the frame: Bag End near the top under its great oak, the rows of round doors on their terraces with gardens, hedges and lanes below them (the mill, the bridge and the Party Field are outside this tight frame: w5i-hobbiton-mill and hobbiton-wide show them)',
    },
    {
      id: 'hobbiton-wide',
      distanceKm: 40,
      elevationDeg: 22,
      azimuthDeg: 255,
      fov: 34,
      lift: 0,
      aimKm: [3, -4],
      tod: 17.8,
      compare: ['reference/film/hobbiton/hobbiton-wide-fotr.jpg'],
      note: 'the Shire (context, 40 km — at 55 km the S3 final critics lost the Hill —, pitch 22°): Hobbiton’s Hill on the left third with Bag End’s oak, the Water leading in from the west through the patchwork of hedged fields and woods to the far downs (the pitch keeps the snowy ranges beyond the frame), golden afternoon',
    },
  ],
});

/**
 * Bag End, Bagshot Row and the rows of holes on the Hill's south face: the fronts strung along the
 * contours, each behind its terrace, the row's lane just below the terraces; short ramps join the rows'
 * lanes at their ends and the lowest row to the main lane, and Bag End's gate to the top row.
 */
function buildHill(k: ProxyKit): void {
  const placed: V2[] = [];
  const be = bagEndAt(k);
  const { yaw: beYaw } = fallLine(k, be[0], be[1]);
  const [bnx, bnz] = facing(beYaw);

  // ---- Bag End: the largest front, the big green door, a window either side, a lamp by the gate
  const bag = hobbitHole(k, { at: be, w: 0.4, door: DOORS[0], doorR: 0.074, facade: 0xcfae6e, windows: 2, chimney: true, lit: true, spark: true, edge: 'picket', terrace: 0.12, terraceW: 1.05, clump: 1 });
  k.light([bag.gate[0] + bag.r[0] * 0.05, bag.ty + 0.05, bag.gate[1] + bag.r[1] * 0.05], { color: 0xffc070, intensity: 1.0, radius: 0.012, kind: 'lamp' });
  k.cylinder('wood', 0.003, 0.004, 0.05, { at: [bag.gate[0] + bag.r[0] * 0.05, bag.ty - 0.004, bag.gate[1] + bag.r[1] * 0.05], seg: 5, color: TIMBER, lod: 0 });
  placed.push(be);
  // the great oak on the Hill above Bag End: about twice any other tree, a broad spreading crown
  k.tree('oak', be[0] - bnx * 0.34 + bag.r[0] * 0.06, be[1] - bnz * 0.34 + bag.r[1] * 0.06, { crownKm: 0.52, heightKm: 0.66, color: 0x4a6a26, yawDeg: 200 });
  // the gate stair down Bag End's bank to the lane below
  {
    const run = Math.max(0.05, (bag.ty - k.ground(bag.gate[0] + bag.n[0] * 0.08, bag.gate[1] + bag.n[1] * 0.08)) * 1.4);
    const foot: V2 = [bag.gate[0] + bag.n[0] * run, bag.gate[1] + bag.n[1] * run];
    k.stairs(
      'weathered',
      [
        [bag.gate[0] - bag.n[0] * 0.004, bag.ty - 0.002, bag.gate[1] - bag.n[1] * 0.004],
        [foot[0], k.ground(foot[0], foot[1]) + 0.002, foot[1]],
      ],
      0.03,
      { stepKm: 0.012, color: 0x857d6c },
    );
  }

  // ---- the rows (each row's lane runs, east → west)
  const rowLanes: V2[][][] = [];
  let n = 0;
  let sparks = 0;
  ROWS.forEach((row, ri) => {
    const line = contour(k, row.level, row.from, row.to);
    // arc length along the contour
    const cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i].p[0] - line[i - 1].p[0], line[i].p[1] - line[i - 1].p[1]));
    const at = (s: number): V2 => {
      let i = 1;
      while (i < line.length - 1 && cum[i] < s) i++;
      const f = Math.max(0, Math.min(1, (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])));
      return [line[i - 1].p[0] + (line[i].p[0] - line[i - 1].p[0]) * f, line[i - 1].p[1] + (line[i].p[1] - line[i - 1].p[1]) * f];
    };
    const fronts: { s: number; hole: Hole }[] = [];
    // stagger the rows against each other
    let s = 0.08 + (ri % 2) * 0.17 + k.r(1) * 0.06;
    while (s < cum[cum.length - 1] - 0.1) {
      const p = at(s);
      const w = 0.2 + k.r(4) * 0.06;
      const lane0 = nearest(MAIN_LANE, p[0], p[1]);
      const { slope } = fallLine(k, p[0], p[1]);
      const skip =
        k.r(3) < 0.06 ||
        Math.hypot(p[0] - POND[0], p[1] - POND[1]) < 0.98 ||
        Math.hypot(p[0] - MILL[0], p[1] - MILL[1]) < 0.42 ||
        lane0.d < 0.17 ||
        k.ground(p[0], p[1]) < k.ground(lane0.p[0], lane0.p[1]) + 0.05 ||
        placed.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < (q === be ? 0.4 : 0.25)) ||
        k.ground(p[0], p[1]) < WATER + 0.4 ||
        slope > 1.6;
      if (!skip) {
        const i = n++;
        // compass bearing the front faces (house yaw 0 faces +z = south)
        const face = (180 - fallLine(k, p[0], p[1]).yaw + 720) % 360;
        const lit = i % 4 !== 3;
        // a spark (EmissionSystem) only for fronts facing the south-west half, where the hero and night
        // cameras see them from the front — seen side-on a sprite would float beside the hood
        const spark = lit && face > 150 && face < 300 && sparks < 20;
        if (spark) sparks++;
        const hole = hobbitHole(k, {
          at: p,
          w,
          door: DOORS[(i * 3 + ri) % DOORS.length],
          facade: OCHRE[i % OCHRE.length],
          windows: i % 3 === 0 ? 1 : 2,
          chimney: i % 3 !== 1,
          lit,
          spark,
          edge: i % 3 === 2 ? 'hedge' : 'picket',
          turn: (k.r(5) - 0.5) * 12,
          shade: 0.92 + k.r(6) * 0.14,
          clump: i % 4 === 1 ? 1 : i % 4 === 3 ? -1 : 0,
        });
        fronts.push({ s, hole });
        placed.push(p);
        // a small garden tree beside some terraces
        if (k.r(7) < 0.3) {
          const side = k.r(8) < 0.5 ? -1 : 1;
          const tx = p[0] + hole.r[0] * side * (hole.hw + 0.07) + hole.n[0] * 0.05;
          const tz = p[1] + hole.r[1] * side * (hole.hw + 0.07) + hole.n[1] * 0.05;
          const crown = 0.08 + k.r(9) * 0.03;
          k.tree('oak', tx, tz, { crownKm: crown, heightKm: crown * (1.2 + k.r(10) * 0.2), yawDeg: k.r(11) * 360 });
        }
      }
      // along the row: fronts 0.3–0.42 km apart (gardens, hedges and trees between)
      s += 0.3 + k.r(2) * 0.12;
    }
    const runs: V2[][] = [];
    rowLanes.push(runs);
    if (fronts.length < 2) return;
    // the row's lane just below the terraces, from a little before the first front to after the last
    const s0 = Math.max(0, fronts[0].s - 0.18);
    const s1 = Math.min(cum[cum.length - 1], fronts[fronts.length - 1].s + 0.18);
    let run: V2[] = [];
    const flush = () => {
      if (run.length >= 3) {
        lane(k, run, 0.034);
        runs.push(run);
      }
      run = [];
    };
    for (let ss = s0; ss <= s1 + 1e-6; ss += 0.06) {
      const c = at(Math.min(ss, s1));
      const { yaw, slope } = fallLine(k, c[0], c[1]);
      const [fx, fz] = facing(yaw);
      const off = Math.min(0.15, 0.085 / Math.max(0.2, slope)) + 0.05;
      const p: V2 = [c[0] + fx * off, c[1] + fz * off];
      // split where the lane would leave the Hill (near the pond, below the main lane)
      const l0 = nearest(MAIN_LANE, p[0], p[1]);
      const ok = Math.hypot(p[0] - POND[0], p[1] - POND[1]) > 0.8 && (l0.d > 0.08 || k.ground(p[0], p[1]) > k.ground(l0.p[0], l0.p[1])) && k.ground(p[0], p[1]) > WATER + 0.35;
      if (ok) run.push(p);
      else flush();
    }
    flush();
  });
  // hedgerows along the downhill side of the rows' lanes (broken by gaps), a low broad tree here and there
  // in them — the face between the rows is not left as open lawn dotted with shrubs
  rowLanes.forEach((runs) =>
    runs.forEach((run) => {
      const off = run.map(([x, z]) => {
        const [fx, fz] = facing(fallLine(k, x, z).yaw);
        return [x + fx * 0.035, z + fz * 0.035] as V2;
      });
      let piece: V2[] = [];
      off.forEach((p, i) => {
        const gap = k.r(41) < 0.22 || placed.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.09);
        if (!gap) piece.push(p);
        if ((gap || i === off.length - 1) && piece.length >= 2) {
          hedge(k, piece, 0.026 + k.r(42) * 0.01, 0.034);
          if (k.r(43) < 0.35) {
            const [tx, tz] = piece[Math.floor(piece.length / 2)];
            const crown = 0.08 + k.r(44) * 0.04;
            k.tree('oak', tx, tz, { crownKm: crown, heightKm: crown * 1.25, yawDeg: k.r(45) * 360 });
          }
        }
        if (gap) piece = [];
      });
    }),
  );
  // ramps joining the rows' lanes at both ends, the lowest row to the main lane, Bag End to the top row
  const ends = rowLanes.filter((r) => r.length).map((r) => ({ east: r[0][0], west: r[r.length - 1][r[r.length - 1].length - 1] }));
  for (let i = 0; i + 1 < ends.length; i++) {
    lane(k, [ends[i].east, ends[i + 1].east], 0.03);
    lane(k, [ends[i].west, ends[i + 1].west], 0.03);
  }
  if (ends.length) {
    const last = ends[ends.length - 1];
    for (const p of [last.east, last.west]) {
      const l0 = nearest(MAIN_LANE, p[0], p[1]);
      if (l0.d < 0.6) lane(k, [p, l0.p], 0.03);
    }
    const top = rowLanes.find((r) => r.length);
    if (top) {
      let best = { d: Infinity, p: top[0][0] };
      for (const r of top) {
        const q = nearest(r, bag.gate[0], bag.gate[1]);
        if (q.d < best.d) best = q;
      }
      if (best.d < 0.5) lane(k, [bag.gate, best.p], 0.03);
    }
  }
}

/**
 * The mill on the pond's rim: a rubble-stone ground floor dug into the bank, a jettied timber-and-plaster
 * upper storey (dark posts and rails on cream plaster) under a deep overhanging straw thatch with a ridge
 * roll, a brick chimney; the waterwheel on the pond side (a timber rim, spokes, a hub, its lower third in
 * the water); a warm window.
 */
function buildMill(k: ProxyKit): void {
  const [mx, mz] = MILL;
  const w = 0.32;
  const d = 0.17;
  const h1 = 0.068;
  const h2 = 0.072;
  // facing the pond (its +z toward the pond's centre)
  const yaw = (Math.atan2(POND[0] - mx, POND[1] - mz) * 180) / Math.PI;
  const [nx, nz] = facing(yaw);
  const rx = Math.cos(yaw * DEG);
  const rz = -Math.sin(yaw * DEG);
  const dig = 0.35;
  k.house('weathered', 'weathered', w, d, h1, { at: [mx, 0, mz], rot: [0, yaw, 0], roof: 'flat', overhang: 0.004, color: 0x8c8474, roofColor: 0x6e675b, grain: 0.85, dig, plinthFam: 'weathered', plinthColor: 0x7d7566 });
  const floor = houseFloor(k, MILL, w, d, h1, yaw, dig);
  const up = floor + SINK + h1 + Math.min(w, d) * 0.06;
  const W2 = w * 1.06;
  const D2 = d * 1.12;
  k.house('plaster', 'thatch', W2, D2, h2, {
    at: [mx, up, mz],
    seat: false,
    rot: [0, yaw, 0],
    pitch: 58,
    overhang: 0.045,
    color: 0xd2c194,
    roofColor: 0x7d6a48,
    roofGrain: 0.65,
    chimney: true,
    ridge: { color: 0x5e4e34, size: 0.018 },
    gableBoards: { color: 0x4a3a28, size: 0.008, horn: 0.012 },
    windows: { count: 2, on: 1, sides: 1, size: 0.012, color: WARM },
  });
  // timber framing on the pond side of the upper storey (dark posts, a sill and a mid rail)
  for (let i = -3; i <= 3; i++) {
    const u = (i * W2) / 7;
    k.box('wood', 0.008, h2 * 0.98, 0.004, { at: [mx + rx * u + nx * (D2 / 2 + 0.002), up, mz + rz * u + nz * (D2 / 2 + 0.002)], rot: [0, yaw, 0], color: 0x4a3a28, lod: 0 });
  }
  for (const yy of [0.004, h2 * 0.5]) k.box('wood', W2, 0.008, 0.005, { at: [mx + nx * (D2 / 2 + 0.003), up + yy, mz + nz * (D2 / 2 + 0.003)], rot: [0, yaw, 0], color: 0x4a3a28, lod: 0 });
  // the waterwheel on the pond side, its lower third in the water: a timber rim, six spokes, a hub
  const wr = 0.1;
  const wx = mx + rx * w * 0.24 + nx * (d / 2 + 0.035);
  const wz = mz + rz * w * 0.24 + nz * (d / 2 + 0.035);
  const wy = POND_LEVEL + wr * 0.35;
  k.ring('wood', wr, 0.016, 0.036, { at: [wx - nx * 0.018, wy, wz - nz * 0.018], rot: faceRot(yaw), seg: 20, color: 0x4d3c2a, lod: 0 });
  k.ring('wood', wr * 0.86, 0.008, 0.03, { at: [wx - nx * 0.015, wy, wz - nz * 0.015], rot: faceRot(yaw), seg: 16, color: 0x5a4632, lod: 0 });
  for (let i = 0; i < 3; i++) k.box('wood', wr * 1.9, 0.009, 0.01, { at: [wx, wy - 0.0045, wz], rot: [0, yaw, i * 60], color: 0x5a4632, lod: 0 });
  k.cylinder('wood', 0.016, 0.016, 0.05, { at: [wx - nx * 0.03, wy, wz - nz * 0.03], rot: faceRot(yaw), seg: 8, color: 0x3a2e22, lod: 0 });
  // a lit window by the door
  k.light([mx - rx * W2 * 0.2 + nx * (D2 / 2 + 0.01), up + h2 * 0.55, mz - rz * W2 * 0.2 + nz * (D2 / 2 + 0.01)], { color: WARM, intensity: 1, radius: 0.012, kind: 'window' });
}

/** the Green Dragon and the cottages of Bywater on the south bank */
function buildBywater(k: ProxyKit): void {
  const [gx, gz] = GREEN_DRAGON;
  // the inn: a long two-storey house (ochre plaster, dark timbering) under a deep thatch, a green round
  // door, lit windows, a lamp and the sign on its post by the lane
  const floor = cottage(k, GREEN_DRAGON, 10, { w: 0.42, d: 0.2, h: 0.13, wall: 0xc9ad78, roof: 0x8a7444, door: DOORS[0], chimney: true, windows: 4, lights: 4, storeys: 1 });
  const [nx, nz] = facing(10);
  const rx = Math.cos(10 * DEG);
  const rz = -Math.sin(10 * DEG);
  // a cross wing at the east end
  cottage(k, [gx + rx * 0.24 - nx * 0.02, gz + rz * 0.24 - nz * 0.02], 100, { w: 0.2, d: 0.16, h: 0.11, wall: 0xc4a874, roof: 0x8a7444, door: DOORS[1], chimney: false, windows: 1 });
  k.light([gx + nx * 0.18 - rx * 0.12, floor + 0.08, gz + nz * 0.18 - rz * 0.12], { color: 0xffb060, intensity: 1.2, radius: 0.02, kind: 'lamp' });
  const [sx, sz] = [gx + nx * 0.17 + rx * 0.08, gz + nz * 0.17 + rz * 0.08];
  k.cylinder('wood', 0.004, 0.005, 0.08, { at: [sx, 0, sz], seat: true, seg: 5, color: 0x4a3a28, lod: 0 });
  k.box('wood', 0.04, 0.026, 0.004, { at: [sx + rx * 0.02, k.ground(sx, sz) + 0.04, sz + rz * 0.02], rot: [0, 10, 0], color: 0x2f5d3a, lod: 0 });
  // cottages: stone plinths, ochre / cream walls with dark half-timbering, deep straw thatch, round doors
  const cottages: [number, number, number][] = [
    [0.35, 3.62, -8],
    [0.85, 3.8, 6],
    [2.45, 3.3, 14],
    [2.85, 3.64, -4],
    [1.35, 3.97, 2],
    [-0.2, 3.55, 18],
  ];
  const walls = [0xd4bf92, 0xc8ab78, 0xdccaa0, 0xbfa070, 0xd0b888, 0xc6aa7c];
  const roofs = [0x9a8048, 0x8e7442, 0xa58a52, 0x86703e, 0x9c8450, 0x907846];
  cottages.forEach(([x, z, yaw], i) => {
    cottage(k, [x, z], yaw, { w: 0.17 + (i % 3) * 0.025, d: 0.12, h: 0.065, wall: walls[i], roof: roofs[i], door: DOORS[(i + 1) % DOORS.length], chimney: i % 2 === 0, windows: 2, lights: i < 5 ? 1 : 0 });
  });
}

/** the Party Field: a pointed canvas marquee and lanterns by the Party Tree, hedged along its south side */
function buildPartyField(k: ProxyKit): void {
  const [px, pz] = PARTY_FIELD;
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
