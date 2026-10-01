import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { ForestDecl, V2, V3 } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { decal } from '../hobbiton/parts.ts';

/**
 * Bree (research §2; the Fellowship's night-and-rain stills, the gate and the Prancing Pony): a dense town
 * climbing the west slope of Bree-hill behind a tall ring of timber palisade, a dark ditch outside
 * it; the East Road comes in from the west through the big double gate under its gatehouse (two square
 * timber towers joined by a roofed gallery, lamps on both sides), runs through the town past the
 * three-storey Prancing Pony just inside the gate and leaves by the smaller south-east gate. Steep,
 * crowded, wet-dark roofs (slate and old thatch) over Tudor plaster and timber walls, packed in rows up
 * the hill along the contours; warm windows (#e2a452) at night, most of them on the fronts that look down
 * the hill to the west; the wooded crown of Bree-hill behind the town.
 *
 * Local frame: x east, z south (heading 0), km round the display point (places.json, on the East Road
 * where the Greenway crosses it), heights relative to the ground there. The plain is nearly level here
 * (falling gently north); Bree-hill is a stamp: a broad dome whose top stands ≈ 1.5 above the plain
 * 1.9 km north-east of the town's centre, a long low spur running north and a shorter one south-east, so
 * the town stands on its lower west and south-west slopes and the hill closes the view behind it.
 */

const DEG = Math.PI / 180;
/** Bree-hill's top (local) */
const HILL: V2 = [1.75, -0.95];
/** the palisade ring: an ellipse round the town (centre, half-axes east-west / north-south, km) */
const TOWN = { at: [0.1, 0.05] as V2, a: 1.0, b: 0.82 };
/** compass bearing → point on the palisade ellipse (scaled by `grow`) */
/** the ring's radius wobbles with the bearing (the dike follows the lie of the land, never a clean oval) */
const wob = (b: number): number => 1 + 0.07 * Math.sin(b * 3 * DEG + 0.6) + 0.045 * Math.sin(b * 5 * DEG + 2.1);
const ringAt = (b: number, grow = 1): V2 => [TOWN.at[0] + Math.sin(b * DEG) * TOWN.a * grow * wob(b), TOWN.at[1] - Math.cos(b * DEG) * TOWN.b * grow * wob(b)];
const inTown = (x: number, z: number, grow = 1): boolean => {
  const b = (Math.atan2(x - TOWN.at[0], -(z - TOWN.at[1])) / DEG + 360) % 360;
  return ((x - TOWN.at[0]) / (TOWN.a * grow * wob(b))) ** 2 + ((z - TOWN.at[1]) / (TOWN.b * grow * wob(b))) ** 2 <= 1;
};
/** the gates: the West-gate on the East Road (with the gatehouse), the smaller south-east gate */
const WEST_GATE = 264;
const EAST_GATE = 118;
const GATE_GAP = 5.5; // half the gap in the palisade, degrees of bearing
/** the East Road through the town (local), from far west of the West-gate out past the south-east gate */
const ROAD: V2[] = [[-3.6, -0.15], [-2.2, 0.0], ringAt(WEST_GATE, 1.25), ringAt(WEST_GATE), [-0.55, 0.18], [-0.2, 0.24], [0.2, 0.3], [0.58, 0.38], ringAt(EAST_GATE), ringAt(EAST_GATE, 1.3), [1.9, 0.62], [2.62, 0.07]];
/** the hero looks at the town from this compass bearing (bree-close): lit windows face it */
const VIEW_FROM = 250;

const WALLS = [0xa89a80, 0xb4a68c, 0x9c8f78, 0xbcae94, 0xa29680, 0xb0a288];
const STONE = 0x7d776c;
const ROOFS = [0x4a4237, 0x3f3a33, 0x564b3c, 0x3d3e40, 0x46474a, 0x50463b];
const TIMBER = 0x3b2e22;
const WARM = 0xe2a452;
const PALISADE = 0x5e5040;

/** distance from (x, z) to a polyline */
function distTo(path: V2[], x: number, z: number): { d: number; dir: V2 } {
  let best = { d: Infinity, dir: [1, 0] as V2 };
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const l = Math.hypot(ex, ez) || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / (l * l)));
    const d = Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t);
    if (d < best.d) best = { d, dir: [ex / l, ez / l] };
  }
  return best;
}

function buildBree(k: ProxyKit): void {
  let lights = 0;
  const light = (p: V3, kind: 'window' | 'lamp', intensity = 1, size = 0.012): void => {
    if (lights >= 60) return;
    lights++;
    k.light(p, { kind, color: WARM, intensity, radius: size });
  };
  const toView: V2 = [Math.sin(VIEW_FROM * DEG), -Math.cos(VIEW_FROM * DEG)];

  // ---------------------------------------------------------------- the palisade, the ditch
  const arc = (b0: number, b1: number, grow = 1): V2[] => {
    const out: V2[] = [];
    let e = b1;
    while (e < b0) e += 360;
    for (let b = b0; b <= e + 1e-6; b += 3) out.push(ringAt(b, grow));
    return out;
  };
  const north = arc(WEST_GATE + GATE_GAP, EAST_GATE - GATE_GAP);
  const south = arc(EAST_GATE + GATE_GAP, WEST_GATE - GATE_GAP);
  // the palisade: tall pointed stakes of dark weathered timber
  for (const path of [north, south]) k.wallPath('wood', path, 0.08, 0.02, { followGround: true, step: 0.08, color: PALISADE, shadeJitter: 0.12, crenel: { w: 0.017, h: 0.028, gap: 0.005, shape: 'point', lod: 0 } });

  // ---------------------------------------------------------------- the West-gate and its gatehouse
  {
    const g = ringAt(WEST_GATE);
    const a = ringAt(WEST_GATE - GATE_GAP);
    const b = ringAt(WEST_GATE + GATE_GAP);
    const wy = (-Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI; // the wall's direction (box x along it)
    const gy = Math.min(k.ground(a[0], a[1]), k.ground(b[0], b[1]), k.ground(g[0], g[1]));
    for (const p of [a, b]) k.tower('wood', 0.05, 0.19, { at: [p[0], 0, p[1]], seat: true, sides: 4, rot: [0, wy + 45, 0], roof: 'cone', roofFam: 'thatch', roofColor: 0x3f3a33, roofH: 0.08, color: 0x5a4a38 });
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // the roofed gallery over the gate between the towers
    k.house('wood', 'thatch', span, 0.07, 0.045, { at: [g[0], gy + 0.11, g[1]], seat: false, rot: [0, wy, 0], pitch: 50, overhang: 0.012, color: 0x54463a, roofColor: 0x3f3a33, lod: 1 });
    // the great double gate (closed at night), timber
    k.box('wood', span * 0.92, 0.11, 0.018, { at: [g[0], gy - 0.01, g[1]], rot: [0, wy, 0], color: 0x4a3c2c, lod: 1 });
    const [ox, oz] = [Math.sin(WEST_GATE * DEG), -Math.cos(WEST_GATE * DEG)];
    for (const p of [a, b]) light([p[0] + ox * 0.06, gy + 0.1, p[1] + oz * 0.06], 'lamp', 1.2, 0.014);
  }
  // the south-east gate: two stout posts, a lamp
  {
    const a = ringAt(EAST_GATE - GATE_GAP);
    const b = ringAt(EAST_GATE + GATE_GAP);
    for (const p of [a, b]) k.tower('wood', 0.03, 0.13, { at: [p[0], 0, p[1]], seat: true, sides: 4, roof: 'cone', roofFam: 'thatch', roofColor: 0x3f3a33, roofH: 0.04, color: 0x5a4a38, lod: 1 });
    const [ox, oz] = [Math.sin(EAST_GATE * DEG), -Math.cos(EAST_GATE * DEG)];
    light([a[0] + ox * 0.05, k.ground(a[0], a[1]) + 0.08, a[1] + oz * 0.05], 'lamp', 1.1, 0.012);
  }
  // the East Road: worn mud lying in the ground
  decal(k, ROAD, 0.05, { color: 0x5a4c3a, step: 0.06, gaps: 0.03, grain: 0.4 });

  // ---------------------------------------------------------------- the Prancing Pony just inside the West-gate
  const PONY: V2 = [-0.5, 0.06];
  const PONY_YAW = 8; // +z (its front) faces the road, south
  {
    const [x, z] = PONY;
    k.house('plaster', 'slate', 0.26, 0.15, 0.15, { at: [x, 0, z], rot: [0, PONY_YAW, 0], pitch: 52, overhang: 0.014, dig: 0.4, color: 0xa89a80, roofColor: 0x3d3e40, plinthFam: 'weathered', plinthColor: STONE, ridge: { fam: 'slate', color: 0x34353a, size: 0.012 }, chimney: true, gableBoards: { color: TIMBER, size: 0.007, horn: 0.01 }, lod: 2 });
    // the cross wing to the west with its gable on the road
    const c = Math.cos(PONY_YAW * DEG);
    const s = Math.sin(PONY_YAW * DEG);
    const wx = x - 0.14 * c;
    const wz = z + 0.14 * s;
    k.house('plaster', 'slate', 0.13, 0.2, 0.135, { at: [wx + 0.03 * s, 0, wz + 0.03 * c], rot: [0, PONY_YAW + 90, 0], pitch: 55, overhang: 0.012, dig: 0.4, color: 0x9c8f78, roofColor: 0x3a3b3e, plinthFam: 'weathered', plinthColor: STONE, gableBoards: { color: TIMBER, size: 0.007, horn: 0.01 }, lod: 1 });
    // timber framing: dark posts and storey rails across the front
    const [nx, nz] = [s, c];
    const floor = Math.min(...[-0.13, 0.13].flatMap((u) => [-0.075, 0.075].map((v) => k.ground(x + u * c + v * s, z - u * s + v * c)))) - 0.02;
    for (const u of [-0.12, -0.06, 0, 0.06, 0.12]) k.box('wood', 0.007, 0.15, 0.004, { at: [x + u * c + nx * 0.077, floor + 0.02, z - u * s + nz * 0.077], rot: [0, PONY_YAW, 0], color: TIMBER, lod: 0 });
    for (const yy of [0.065, 0.115]) k.box('wood', 0.26, 0.006, 0.004, { at: [x + nx * 0.078, floor + 0.02 + yy, z + nz * 0.078], rot: [0, PONY_YAW, 0], color: TIMBER, lod: 0 });
    // the sign on its bracket over the road
    k.box('wood', 0.005, 0.005, 0.05, { at: [x + 0.09 * c + nx * 0.1, floor + 0.11, z - 0.09 * s + nz * 0.1], rot: [0, PONY_YAW, 0], color: TIMBER, lod: 0 });
    k.box('plaster', 0.032, 0.026, 0.004, { at: [x + 0.09 * c + nx * 0.12, floor + 0.08, z - 0.09 * s + nz * 0.12], rot: [0, PONY_YAW, 0], color: 0xe8e2d0, lod: 0 });
    // warm windows on three storeys of the front, a lamp at the door
    for (const [u, yy] of [
      [-0.09, 0.04],
      [0.03, 0.04],
      [-0.03, 0.09],
      [0.09, 0.09],
      [-0.09, 0.135],
      [0.05, 0.135],
    ] as [number, number][])
      light([x + u * c + nx * 0.082, floor + 0.02 + yy, z - u * s + nz * 0.082], 'window', 1.2, 0.013);
    light([x + nx * 0.1, floor + 0.06, z + nz * 0.1], 'lamp', 1.1, 0.012);
  }

  // ---------------------------------------------------------------- the town: rows of steep-roofed houses up the hill
  const slope = (x: number, z: number): [number, number] => {
    const e = 0.05;
    return [(k.ground(x + e, z) - k.ground(x - e, z)) / (2 * e), (k.ground(x, z + e) - k.ground(x, z - e)) / (2 * e)];
  };
  let n = 0;
  let lit = 0;
  for (let gz = -1.0; gz <= 1.0; gz += 0.094) {
    for (let gx = -1.6; gx <= 1.6; gx += 0.102) {
      const x = gx + (k.r(1) - 0.5) * 0.04 + (Math.round(gz / 0.094) % 2) * 0.05;
      const z = gz + (k.r(2) - 0.5) * 0.035;
      // inside the palisade, or (fewer) the outskirts along the road beyond the gates
      const outskirts = !inTown(x, z, 1.05) && distTo(ROAD, x, z).d < 0.3 && inTown(x, z, 1.6);
      if ((!inTown(x, z, 0.9) && !outskirts) || k.r(3) < (outskirts ? 0.45 : 0.22)) continue;
      const road = distTo(ROAD, x, z);
      if (road.d < 0.07) continue;
      if (Math.hypot(x - PONY[0], z - PONY[1]) < 0.24) continue;
      const [sx, sz] = slope(x, z);
      const gm = Math.hypot(sx, sz);
      if (gm > 1.5) continue;
      // along the road the houses front it; up the hill their fronts look down the fall line
      let yaw = road.d < 0.17 ? (Math.atan2(road.dir[0], road.dir[1]) * 180) / Math.PI + 90 : (Math.atan2(-sx, -sz) * 180) / Math.PI;
      yaw += (k.r(4) - 0.5) * 12;
      const w = 0.095 + k.r(5) * 0.07;
      let d = 0.07 + k.r(6) * 0.03;
      const h = 0.07 + k.r(7) * 0.055;
      const ny = yaw * DEG;
      const span = (dd: number) => {
        const cs = [-1, 1].flatMap((a) => [-1, 1].map((b) => k.ground(x + Math.cos(ny) * a * (w / 2) + Math.sin(ny) * b * (dd / 2), z - Math.sin(ny) * a * (w / 2) + Math.cos(ny) * b * (dd / 2))));
        return { span: Math.max(...cs, k.ground(x, z)) - Math.min(...cs, k.ground(x, z)), cs };
      };
      const DIG = 0.4;
      if (span(d).span - DIG * h > 0.026) d = 0.055;
      if (span(d).span - DIG * h > 0.026) continue;
      const i = n++;
      const stone = i % 7 === 3;
      k.house(stone ? 'weathered' : 'plaster', i % 3 === 0 ? 'slate' : 'thatch', w, d, h, {
        at: [x, 0, z],
        rot: [0, yaw, 0],
        roof: k.r(8) < 0.15 ? 'hip' : 'gable',
        pitch: 50 + k.r(9) * 10,
        overhang: 0.012,
        dig: DIG,
        color: stone ? STONE : WALLS[i % WALLS.length],
        shade: 0.88 + k.r(10) * 0.2,
        roofColor: ROOFS[(i * 5 + 1) % ROOFS.length],
        roofGrain: 0.5,
        plinthFam: 'weathered',
        plinthColor: STONE,
        lod: i % 5 === 0 ? 2 : i % 5 === 2 ? 1 : 0,
        ...(i % 2 === 1 ? { chimney: true } : {}),
        ...(i % 4 === 0 ? { gableBoards: { color: TIMBER, size: 0.006, horn: 0.008 } } : {}),
      });
      // a warm window on the wall that looks most towards the hero (west-south-west), where it stands free
      if (lit < 44 && k.r(11) < 0.36) {
        const faces: [number, number, number][] = [
          [Math.sin(ny), Math.cos(ny), d / 2],
          [-Math.sin(ny), -Math.cos(ny), d / 2],
          [Math.cos(ny), -Math.sin(ny), w / 2],
          [-Math.cos(ny), Math.sin(ny), w / 2],
        ];
        const [fx, fz, off] = faces.reduce((a, b) => (b[0] * toView[0] + b[1] * toView[1] > a[0] * toView[0] + a[1] * toView[1] ? b : a));
        const { cs } = span(d);
        const floor = Math.max(Math.min(...cs, k.ground(x, z)), Math.max(...cs, k.ground(x, z)) - DIG * h) - 0.02;
        const wy = floor + h * 0.62;
        const wx = x + fx * (off + 0.004);
        const wz = z + fz * (off + 0.004);
        if (k.ground(wx + fx * 0.01, wz + fz * 0.01) < wy - 0.015) {
          light([wx, wy, wz], 'window', 0.8 + k.r(12) * 0.6, 0.014);
          lit++;
        }
      }
      // a garden tree here and there
      if (k.r(13) < 0.05) k.tree('oak', x + (k.r(14) - 0.5) * 0.08, z + 0.07, { crownKm: 0.05 + k.r(15) * 0.03, heightKm: 0.11 });
    }
  }
  // lanterns on posts along the road
  for (const t of [0.25, 0.5, 0.75]) {
    const i = Math.floor(t * 6) + 3;
    const [ax, az] = ROAD[Math.min(i, ROAD.length - 2)];
    const [bx, bz] = ROAD[Math.min(i + 1, ROAD.length - 1)];
    const x = (ax + bx) / 2 + 0.04;
    const z = (az + bz) / 2 - 0.04;
    k.cylinder('wood', 0.004, 0.005, 0.07, { at: [x, 0, z], seat: true, seg: 5, color: TIMBER, lod: 0 });
    light([x, k.ground(x, z) + 0.072, z], 'lamp', 1.0, 0.012);
  }
}

/** the woods on Bree-hill's crown and its eastern slopes (the town's slopes and the plain stay open) */
const HILL_WOODS: ForestDecl[] = [
  {
    area: { circle: { at: [HILL[0] + 0.7, HILL[1] - 0.6], r: 1.9 } },
    density: 6,
    species: [
      { kind: 'oak', share: 0.7, crownKm: [0.07, 0.13], colors: [0x3f5a2a, 0x4a6230, 0x52602e] },
      { kind: 'conifer', share: 0.3, crownKm: [0.06, 0.1], colors: [0x2f4426, 0x37492a] },
    ],
    clump: { scaleKm: 0.8, amount: 0.5 },
    edgeKm: 0.4,
    avoid: [{ at: TOWN.at, r: 1.9 }],
  },
];

export default defineLandmark({
  id: 'bree',
  placeId: 'bree',
  tier: 'B',
  // Bree-hill: a broad dome ≈ 1.5 above the plain north-east of the town, a long low spur north and a
  // shorter one south-east (the west slope, where the town climbs, stays even); never lowers
  stamps: [
    {
      kind: 'massif',
      at: HILL,
      radius: 2.8,
      summit: 1.5,
      base: -0.05,
      exponent: 1.2,
      dome: 0.6,
      spurs: [
        { azimuthDeg: 350, lengthKm: 3.6, widthKm: 1.6, heightFrac: 0.5, rootFrac: 0.85 },
        { azimuthDeg: 130, lengthKm: 2.4, widthKm: 1.4, heightFrac: 0.45, rootFrac: 0.8 },
      ],
      flankSlope: 0.9,
      rough: { amp: 0.1, scaleKm: 1.8 },
      surface: 'turf',
    },
  ],
  lodPx: [90, 30],
  vegetationExclusion: [
    { at: TOWN.at, r: 1.25 },
    { at: [-1.6, 0.05], r: 0.5 },
  ],
  forests: HILL_WOODS,
  proxy: buildBree,
  annotation: { title: 'Bree', subtitle: 'The Prancing Pony', blurb: 'Crossroads village of Men and Hobbits, where Strider waited in the corner.' },
  bookmarks: [
    {
      id: 'bree-close',
      distanceKm: 28,
      elevationDeg: 14,
      azimuthDeg: VIEW_FROM,
      fov: 9.5,
      lift: 0.3,
      aimKm: [0.4, 0.1],
      tod: 20.4,
      compare: ['reference/film/bree/bree-wide.webp', 'reference/film/bree/bree-gate-night.jpg'],
      note: 'hero (regional, 28 km, long lens): blue dusk (20.4: the windows lit, the hill and the roofs still reading) from the west-south-west down the East Road — the palisade and the gatehouse on the road, the dark roofs of the town climbing Bree-hill behind them, warm windows coming on, the wooded crown of the hill above',
    },
  ],
});
