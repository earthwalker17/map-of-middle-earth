import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { ForestDecl, V2, V3 } from '../types.ts';
import { defineLandmark } from '../types.ts';

/**
 * Bree (research §2; the Fellowship's night-and-rain stills, the gate and the Prancing Pony): a dense town
 * climbing the west slope of Bree-hill behind a tall ring of pointed timber stakes; the East Road comes in
 * from the west through the big double gate between two tall timber gate towers (a roofed gallery over the
 * gate, a lamp on each tower), runs through the town past the three-storey Prancing Pony and its yard just
 * inside the gate and the little market in the middle, and leaves by the smaller south-east gate. Steep,
 * crowded, dark roofs (slate and old thatch) over umber plaster and brown-grey stone, packed in rows up the
 * hill; small warm windows (#e2a452) at dusk, most of them on the fronts that look down the hill to the
 * west; the wooded crown of Bree-hill behind the town and hedgerows on its slopes. (The ditch outside the
 * palisade and the road surface wait for the kit's ground-draped ribbon: planks read as dark slabs.)
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
/** the ring's radius wobbles with the bearing (the dike follows the lie of the land, never a clean oval) */
const wob = (b: number): number => 1 + 0.07 * Math.sin(b * 3 * DEG + 0.6) + 0.045 * Math.sin(b * 5 * DEG + 2.1);
/** compass bearing → point on the palisade ellipse (scaled by `grow`) */
const ringAt = (b: number, grow = 1): V2 => [TOWN.at[0] + Math.sin(b * DEG) * TOWN.a * grow * wob(b), TOWN.at[1] - Math.cos(b * DEG) * TOWN.b * grow * wob(b)];
const inTown = (x: number, z: number, grow = 1): boolean => {
  const b = (Math.atan2(x - TOWN.at[0], -(z - TOWN.at[1])) / DEG + 360) % 360;
  return ((x - TOWN.at[0]) / (TOWN.a * grow * wob(b))) ** 2 + ((z - TOWN.at[1]) / (TOWN.b * grow * wob(b))) ** 2 <= 1;
};
/** the gates: the West-gate on the East Road (with the gate towers), the smaller south-east gate */
const WEST_GATE = 264;
const EAST_GATE = 118;
const GATE_GAP = 5.5; // half the gap in the palisade, degrees of bearing
/** the East Road through the town (local), from west of the West-gate out past the south-east gate */
const ROAD: V2[] = [[-3.6, -0.15], [-2.2, 0.0], ringAt(WEST_GATE, 1.25), ringAt(WEST_GATE), [-0.55, 0.18], [-0.2, 0.24], [0.2, 0.3], [0.58, 0.38], ringAt(EAST_GATE), ringAt(EAST_GATE, 1.3), [1.9, 0.62], [2.62, 0.07]];
/** the Prancing Pony just inside the West-gate (its front on the road), its yard behind it, the market */
const PONY: V2 = [-0.5, 0.06];
const PONY_YAW = 8; // +z (its front) faces the road, south
const YARD: V2 = [-0.47, -0.13];
const MARKET: V2 = [0.12, 0.06];
/** the hero looks at the town from this compass bearing (bree-close): lit windows face it */
const VIEW_FROM = 268;

/** umber / ochre plaster and brown-grey stone (dark and warm: the blue dusk never turns them navy) */
const WALLS = [0x8c7a5e, 0x96826a, 0x7f6e58, 0x9a8668, 0x86745c, 0x8f7c62];
const STONE = 0x6f675b;
/** dark slate and old dark thatch */
const SLATES = [0x35363a, 0x3c3b3b, 0x313236];
const THATCH = [0x4f4232, 0x5a4a36, 0x4a3e2e];
const TIMBER = 0x3b2e22;
/** window glass: warm, varied */
const GLASS = [0xe2a452, 0xf0b45a, 0xd8903e, 0xf2c070];
const WARM = 0xe2a452;
/** the palisade and gate towers: weathered timber, light enough to catch the sky */
const PALISADE = 0x7a6248;
const GATE_TIMBER = 0x7d6548;

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
    // (dusk-gated: Bree's lamps and windows are lit from sunset on, as in the hero's golden dusk)
    k.light(p, { kind, color: WARM, intensity, radius: size, gate: 'dusk' });
  };
  /** a small window: an emissive pane (night-gated) of varied warmth, set a hair proud of a wall */
  const pane = (x: number, y: number, z: number, yaw: number, u: number): void => {
    k.box('emissive', 0.011, 0.016, 0.003, {
      at: [x, y, z],
      rot: [0, yaw, 0],
      color: GLASS[Math.floor(u * GLASS.length) % GLASS.length],
      glow: { strength: 4 + u * 1.5, gate: 'dusk', flicker: 0.03 },
      lod: 0,
    });
  };
  const toView: V2 = [Math.sin(VIEW_FROM * DEG), -Math.cos(VIEW_FROM * DEG)];

  // ---------------------------------------------------------------- the palisade
  const arc = (b0: number, b1: number, grow = 1): V2[] => {
    const out: V2[] = [];
    let e = b1;
    while (e < b0) e += 360;
    for (let b = b0; b <= e + 1e-6; b += 3) out.push(ringAt(b, grow));
    return out;
  };
  const north = arc(WEST_GATE + GATE_GAP, EAST_GATE - GATE_GAP);
  const south = arc(EAST_GATE + GATE_GAP, WEST_GATE - GATE_GAP);
  // tall pointed stakes of weathered timber, their tips a broken saw-edge against the sky
  for (const path of [north, south])
    k.wallPath('wood', path, 0.075, 0.024, {
      followGround: true,
      step: 0.08,
      color: PALISADE,
      shadeJitter: 0.16,
      crenel: { w: 0.024, h: 0.042, gap: 0.006, shape: 'point', lod: 0 },
    });

  // ---------------------------------------------------------------- the West-gate: two tall gate towers, the gallery
  {
    const g = ringAt(WEST_GATE);
    const a = ringAt(WEST_GATE - GATE_GAP);
    const b = ringAt(WEST_GATE + GATE_GAP);
    const wy = (-Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI; // the wall's direction (box x along it)
    const gy = Math.min(k.ground(a[0], a[1]), k.ground(b[0], b[1]), k.ground(g[0], g[1]));
    // towers more than twice the palisade's height, square, under steep thatched caps
    for (const p of [a, b])
      k.tower('wood', 0.048, 0.27, {
        at: [p[0], 0, p[1]],
        seat: true,
        sides: 4,
        rot: [0, wy + 45, 0],
        roof: 'cone',
        roofFam: 'thatch',
        roofColor: 0x4a3e2e,
        roofH: 0.1,
        color: GATE_TIMBER,
        lod: 1,
      });
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // the roofed gallery over the gate between the towers
    k.house('wood', 'thatch', span, 0.07, 0.05, {
      at: [g[0], gy + 0.15, g[1]],
      seat: false,
      rot: [0, wy, 0],
      pitch: 50,
      overhang: 0.012,
      color: 0x6e5940,
      roofColor: 0x4a3e2e,
      lod: 1,
    });
    // the great double gate (closed at night), dark timber
    k.box('wood', span * 0.92, 0.15, 0.018, {
      at: [g[0], gy - 0.01, g[1]],
      rot: [0, wy, 0],
      color: 0x4a3c2c,
      lod: 1,
    });
    // the lamp pair on the towers' outer faces: the brightest lights in the frame
    const [ox, oz] = [Math.sin(WEST_GATE * DEG), -Math.cos(WEST_GATE * DEG)];
    for (const p of [a, b]) light([p[0] + ox * 0.05, gy + 0.16, p[1] + oz * 0.05], 'lamp', 4, 0.02);
  }
  // the south-east gate: two stout posts, a lamp
  {
    const a = ringAt(EAST_GATE - GATE_GAP);
    const b = ringAt(EAST_GATE + GATE_GAP);
    for (const p of [a, b])
      k.tower('wood', 0.032, 0.16, {
        at: [p[0], 0, p[1]],
        seat: true,
        sides: 4,
        roof: 'cone',
        roofFam: 'thatch',
        roofColor: 0x4a3e2e,
        roofH: 0.05,
        color: GATE_TIMBER,
        lod: 1,
      });
    const [ox, oz] = [Math.sin(EAST_GATE * DEG), -Math.cos(EAST_GATE * DEG)];
    light([a[0] + ox * 0.05, k.ground(a[0], a[1]) + 0.1, a[1] + oz * 0.05], 'lamp', 1.4, 0.014);
  }

  // ---------------------------------------------------------------- the Prancing Pony just inside the West-gate
  {
    const [x, z] = PONY;
    k.house('plaster', 'slate', 0.26, 0.15, 0.15, {
      at: [x, 0, z],
      rot: [0, PONY_YAW, 0],
      pitch: 52,
      overhang: 0.014,
      dig: 0.4,
      color: 0x9a8668,
      roofColor: 0x34353a,
      plinthFam: 'weathered',
      plinthColor: STONE,
      ridge: { fam: 'slate', color: 0x2e2f33, size: 0.012 },
      chimney: true,
      gableBoards: { color: TIMBER, size: 0.007, horn: 0.01 },
      lod: 2,
    });
    // the cross wing to the west with its gable on the road
    const c = Math.cos(PONY_YAW * DEG);
    const s = Math.sin(PONY_YAW * DEG);
    const wx = x - 0.14 * c;
    const wz = z + 0.14 * s;
    k.house('plaster', 'slate', 0.13, 0.2, 0.135, {
      at: [wx + 0.03 * s, 0, wz + 0.03 * c],
      rot: [0, PONY_YAW + 90, 0],
      pitch: 55,
      overhang: 0.012,
      dig: 0.4,
      color: 0x8c7a5e,
      roofColor: 0x34353a,
      plinthFam: 'weathered',
      plinthColor: STONE,
      gableBoards: { color: TIMBER, size: 0.007, horn: 0.01 },
      lod: 1,
    });
    // timber framing: dark posts and storey rails across the front
    const [nx, nz] = [s, c];
    const floor = Math.min(...[-0.13, 0.13].flatMap((u) => [-0.075, 0.075].map((v) => k.ground(x + u * c + v * s, z - u * s + v * c)))) - 0.02;
    for (const u of [-0.12, -0.06, 0, 0.06, 0.12])
      k.box('wood', 0.007, 0.15, 0.004, {
        at: [x + u * c + nx * 0.077, floor + 0.02, z - u * s + nz * 0.077],
        rot: [0, PONY_YAW, 0],
        color: TIMBER,
        lod: 0,
      });
    for (const yy of [0.065, 0.115])
      k.box('wood', 0.26, 0.006, 0.004, {
        at: [x + nx * 0.078, floor + 0.02 + yy, z + nz * 0.078],
        rot: [0, PONY_YAW, 0],
        color: TIMBER,
        lod: 0,
      });
    // the sign on its bracket over the road
    k.box('wood', 0.005, 0.005, 0.05, {
      at: [x + 0.09 * c + nx * 0.1, floor + 0.11, z - 0.09 * s + nz * 0.1],
      rot: [0, PONY_YAW, 0],
      color: TIMBER,
      lod: 0,
    });
    k.box('plaster', 0.032, 0.026, 0.004, {
      at: [x + 0.09 * c + nx * 0.12, floor + 0.08, z - 0.09 * s + nz * 0.12],
      rot: [0, PONY_YAW, 0],
      color: 0xd8d0bc,
      lod: 0,
    });
    // small warm windows on three storeys of the front, a lamp at the door
    let j = 0;
    for (const [u, yy] of [
      [-0.09, 0.04],
      [0.03, 0.04],
      [-0.03, 0.09],
      [0.09, 0.09],
      [-0.09, 0.135],
      [0.05, 0.135],
    ] as [number, number][])
      pane(x + u * c + nx * 0.077, floor + 0.012 + yy, z - u * s + nz * 0.077, PONY_YAW, (j++ * 0.37) % 1);
    light([x + nx * 0.1, floor + 0.06, z + nz * 0.1], 'lamp', 1.3, 0.012);
    light([x - 0.03 * c + nx * 0.082, floor + 0.11, z + 0.03 * s + nz * 0.082], 'window', 0.5, 0.008);
  }
  // the Pony's yard behind it: cobbles in a low stone wall, the long stable on its north side, a lamp
  {
    const [x, z] = YARD;
    const c = Math.cos(PONY_YAW * DEG);
    const s = Math.sin(PONY_YAW * DEG);
    const P = (u: number, v: number): V2 => [x + u * c + v * s, z - u * s + v * c];
    const ol = [P(-0.13, -0.08), P(0.13, -0.08), P(0.13, 0.07), P(-0.13, 0.07)];
    const high = Math.max(...ol.map(([px, pz]) => k.ground(px, pz)));
    k.extrude('weathered', ol, 0.004, {
      followGround: true,
      at: [0, -0.004 + 0.006, 0],
      color: 0x6b6256,
      grain: 0.7,
      lod: 0,
    });
    // the yard is a level terrace (its downhill side a low retaining face); the wall stands on its top
    k.wallPath('weathered', [P(-0.13, 0.07), P(-0.13, -0.08), P(0.13, -0.08), P(0.13, 0.07)], 0.022, 0.012, { at: [0, high + 0.002, 0], color: STONE, lod: 0 });
    const st = P(0, -0.05);
    k.house('wood', 'thatch', 0.2, 0.055, 0.045, {
      at: [st[0], high - 0.004, st[1]],
      seat: false,
      rot: [0, PONY_YAW, 0],
      pitch: 48,
      overhang: 0.01,
      color: 0x6b5640,
      roofColor: THATCH[1],
      lod: 0,
    });
    const lp = P(0.1, 0.03);
    light([lp[0], high + 0.03, lp[1]], 'lamp', 1.0, 0.01);
  }
  // the market in the middle of the town: a paved square, a well, stalls under cloth awnings
  {
    const [x, z] = MARKET;
    const ol: V2[] = [];
    for (let i = 0; i < 8; i++) ol.push([x + Math.cos((i / 8) * Math.PI * 2 + 0.3) * 0.13, z + Math.sin((i / 8) * Math.PI * 2 + 0.3) * 0.1]);
    k.extrude('weathered', ol, 0.004, {
      followGround: true,
      at: [0, 0.002, 0],
      color: 0x6b6256,
      grain: 0.7,
      lod: 0,
    });
    const top = Math.max(...ol.map(([px, pz]) => k.ground(px, pz))) + 0.006;
    k.cylinder('weathered', 0.014, 0.016, 0.014, {
      at: [x, top - 0.004, z],
      seg: 8,
      color: STONE,
      lod: 0,
    });
    const awnings = [0x7a4a3a, 0x5a6a4a, 0x8a7a52, 0x6a4a5a];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.9;
      const px = x + Math.cos(a) * 0.075;
      const pz = z + Math.sin(a) * 0.055;
      k.house('wood', 'plaster', 0.036, 0.026, 0.016, {
        at: [px, top - 0.004, pz],
        seat: false,
        rot: [0, (-a * 180) / Math.PI + 90, 0],
        pitch: 30,
        overhang: 0.006,
        color: 0x5a4a38,
        roofColor: awnings[i % awnings.length],
        lod: 0,
      });
    }
    light([x + 0.02, top + 0.03, z], 'lamp', 1.0, 0.01);
  }

  // ---------------------------------------------------------------- the town: rows of steep-roofed houses up the hill
  const slope = (x: number, z: number): [number, number] => {
    const e = 0.05;
    return [(k.ground(x + e, z) - k.ground(x - e, z)) / (2 * e), (k.ground(x, z + e) - k.ground(x, z - e)) / (2 * e)];
  };
  let n = 0;
  let sprites = 0;
  for (let gz = -1.0; gz <= 1.0; gz += 0.094) {
    for (let gx = -1.6; gx <= 1.6; gx += 0.102) {
      const x = gx + (k.r(1) - 0.5) * 0.04 + (Math.round(gz / 0.094) % 2) * 0.05;
      const z = gz + (k.r(2) - 0.5) * 0.035;
      // inside the palisade, or (fewer) the outskirts along the road beyond the gates
      const outskirts = !inTown(x, z, 1.05) && distTo(ROAD, x, z).d < 0.3 && inTown(x, z, 1.6);
      if ((!inTown(x, z, 0.9) && !outskirts) || k.r(3) < (outskirts ? 0.45 : 0.16)) continue;
      const road = distTo(ROAD, x, z);
      if (road.d < 0.065) continue;
      if (Math.hypot(x - PONY[0], z - PONY[1]) < 0.24 || Math.hypot(x - YARD[0], z - YARD[1]) < 0.19 || Math.hypot((x - MARKET[0]) / 1.3, z - MARKET[1]) < 0.15) continue;
      const [sx, sz] = slope(x, z);
      const gm = Math.hypot(sx, sz);
      if (gm > 1.5) continue;
      // along the road the houses front it (on gentle ground); up the hill their fronts look down the fall line
      let yaw = road.d < 0.17 && gm < 0.45 ? (Math.atan2(road.dir[0], road.dir[1]) * 180) / Math.PI + 90 : (Math.atan2(-sx, -sz) * 180) / Math.PI;
      yaw += (k.r(4) - 0.5) * 12;
      const w = 0.095 + k.r(5) * 0.07;
      let d = 0.07 + k.r(6) * 0.03;
      const h = 0.07 + k.r(7) * 0.055;
      const ny = yaw * DEG;
      const span = (dd: number) => {
        const cs = [-1, 1].flatMap((a) => [-1, 1].map((b) => k.ground(x + Math.cos(ny) * a * (w / 2) + Math.sin(ny) * b * (dd / 2), z - Math.sin(ny) * a * (w / 2) + Math.cos(ny) * b * (dd / 2))));
        return {
          span: Math.max(...cs, k.ground(x, z)) - Math.min(...cs, k.ground(x, z)),
          cs,
        };
      };
      const DIG = 0.45;
      // (a stone undercroft below the downhill side up to ≈ 0.06: a hill town stands on its foundations)
      if (span(d).span - DIG * h > 0.06) d = 0.055;
      if (span(d).span - DIG * h > 0.06) continue;
      const i = n++;
      const stone = i % 6 === 3;
      const thatch = i % 3 !== 0;
      k.house(stone ? 'weathered' : 'plaster', thatch ? 'thatch' : 'slate', w, d, h, {
        at: [x, 0, z],
        rot: [0, yaw, 0],
        roof: k.r(8) < 0.15 ? 'hip' : 'gable',
        pitch: 50 + k.r(9) * 10,
        overhang: 0.012,
        dig: DIG,
        color: stone ? STONE : WALLS[i % WALLS.length],
        shade: 0.9 + k.r(10) * 0.18,
        roofColor: thatch ? THATCH[(i * 5 + 1) % THATCH.length] : SLATES[(i * 7 + 2) % SLATES.length],
        roofGrain: 0.5,
        plinthFam: 'weathered',
        plinthColor: STONE,
        lod: i % 5 === 0 ? 2 : i % 5 === 2 ? 1 : 0,
        ...(i % 2 === 1 ? { chimney: true } : {}),
        ...(i % 4 === 0 ? { gableBoards: { color: TIMBER, size: 0.006, horn: 0.008 } } : {}),
      });
      // small warm windows on the wall that looks most towards the hero (west-south-west), where it stands free
      if (k.r(11) < 0.55) {
        const faces: [number, number, number, number, number][] = [
          [Math.sin(ny), Math.cos(ny), d / 2, w, yaw],
          [-Math.sin(ny), -Math.cos(ny), d / 2, w, yaw + 180],
          [Math.cos(ny), -Math.sin(ny), w / 2, d, yaw + 90],
          [-Math.cos(ny), Math.sin(ny), w / 2, d, yaw - 90],
        ];
        const [fx, fz, off, along, fyaw] = faces.reduce((a, b) => (b[0] * toView[0] + b[1] * toView[1] > a[0] * toView[0] + a[1] * toView[1] ? b : a));
        const { cs } = span(d);
        const floor = Math.max(Math.min(...cs, k.ground(x, z)), Math.max(...cs, k.ground(x, z)) - DIG * h) - 0.02;
        const [ax, az] = [Math.cos(fyaw * DEG), -Math.sin(fyaw * DEG)];
        const count = 1 + Math.floor(k.r(12) * Math.min(3, along / 0.045));
        for (let j = 0; j < count; j++) {
          const u = (j - (count - 1) / 2) * Math.min(0.04, (along * 0.7) / count);
          const wy = floor + 0.02 + h * (count > 1 && j % 2 ? 0.66 : 0.4);
          const wx = x + fx * (off + 0.002) + ax * u;
          const wz = z + fz * (off + 0.002) + az * u;
          if (k.ground(wx + fx * 0.01, wz + fz * 0.01) > wy - 0.012) continue;
          pane(wx, wy - 0.008, wz, fyaw, k.r(13));
          // a few faint sparks among them (the town's aggregate glow in overviews)
          if (j === 0 && sprites < 20 && i % 3 === 1) {
            sprites++;
            light([wx + fx * 0.004, wy, wz + fz * 0.004], 'window', 0.45, 0.007);
          }
        }
      }
      // a garden tree here and there
      if (k.r(14) < 0.05)
        k.tree('oak', x + (k.r(15) - 0.5) * 0.08, z + 0.07, {
          crownKm: 0.05 + k.r(16) * 0.03,
          heightKm: 0.11,
        });
    }
  }
  // lanterns on posts along the road through the town
  for (const t of [0.25, 0.5, 0.75]) {
    const i = Math.floor(t * 6) + 3;
    const [ax, az] = ROAD[Math.min(i, ROAD.length - 2)];
    const [bx, bz] = ROAD[Math.min(i + 1, ROAD.length - 1)];
    const x = (ax + bx) / 2 + 0.04;
    const z = (az + bz) / 2 - 0.04;
    k.cylinder('wood', 0.004, 0.005, 0.07, {
      at: [x, 0, z],
      seat: true,
      seg: 5,
      color: TIMBER,
      lod: 0,
    });
    light([x, k.ground(x, z) + 0.072, z], 'lamp', 1.0, 0.012);
  }
}

/** an arc of bearings b0 → b1 (clockwise) round the town at `grow` × the palisade ring */
const ringArc = (b0: number, b1: number, grow: number): V2[] => {
  const out: V2[] = [];
  for (let b = b0; b <= b1 + 1e-6; b += 6) out.push(ringAt(b, grow));
  return out;
};
/** hedgerow trees: small dense crowns in a narrow band */
const hedgerow = (path: V2[]): ForestDecl => ({
  area: { band: { path, halfWidth: 0.035 } },
  density: 700,
  species: [
    {
      kind: 'oak',
      share: 0.7,
      crownKm: [0.03, 0.055],
      colors: [0x3f5a2a, 0x4a6230, 0x3a5228],
    },
    {
      kind: 'scrub',
      share: 0.3,
      crownKm: [0.025, 0.04],
      colors: [0x445a2c, 0x4e5e30],
    },
  ],
  clump: { scaleKm: 0.25, amount: 0.35 },
  edgeKm: 0.01,
});
/** the woods on Bree-hill's crown and over its west shoulder above the town, hedgerows on its slopes */
const HILL_WOODS: ForestDecl[] = [
  {
    area: { circle: { at: [HILL[0] + 0.3, HILL[1] - 0.3], r: 2.4 } },
    density: 24,
    species: [
      {
        kind: 'oak',
        share: 0.7,
        crownKm: [0.07, 0.13],
        colors: [0x3f5a2a, 0x4a6230, 0x52602e],
      },
      {
        kind: 'scrub',
        share: 0.3,
        crownKm: [0.05, 0.08],
        colors: [0x3a5226, 0x445a2c],
      },
    ],
    clump: { scaleKm: 0.8, amount: 0.45 },
    edgeKm: 0.35,
    avoid: [{ at: TOWN.at, r: 1.45 }],
  },
  // hedgerows: field edges climbing the hill's slopes from the palisade, and one round its flank
  hedgerow([ringAt(300, 1.12), [-0.75, -1.5], [-0.55, -2.2]]),
  hedgerow([ringAt(20, 1.12), [0.75, -1.65], [1.0, -2.3]]),
  hedgerow([ringAt(62, 1.14), [1.55, -0.3], [2.4, -0.1]]),
  hedgerow([ringAt(150, 1.12), [1.25, 1.2], [1.6, 1.9]]),
  hedgerow(ringArc(318, 412, 1.42)),
  hedgerow([ringAt(200, 1.15), [-0.6, 1.5], [-0.9, 2.2]]),
  hedgerow([
    [-1.45, 0.75],
    [-2.2, 1.0],
    [-2.9, 1.15],
  ]),
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
        {
          azimuthDeg: 350,
          lengthKm: 3.6,
          widthKm: 1.6,
          heightFrac: 0.5,
          rootFrac: 0.85,
        },
        {
          azimuthDeg: 130,
          lengthKm: 2.4,
          widthKm: 1.4,
          heightFrac: 0.45,
          rootFrac: 0.8,
        },
      ],
      flankSlope: 0.9,
      rough: { amp: 0.1, scaleKm: 1.8 },
      surface: 'turf',
    },
  ],
  lodPx: [90, 30],
  // the natural vegetation (crowns many times a house) is cleared round the town and the hill and along
  // the hero's line of sight down the East Road; the hill's own woods and hedgerows (forests) carry it
  vegetationExclusion: [
    { at: TOWN.at, r: 3.6 },
    { at: HILL, r: 3.8 },
    ...[3.5, 6.5, 9.5].map((d) => ({
      at: [TOWN.at[0] + Math.sin(VIEW_FROM * DEG) * d, TOWN.at[1] - Math.cos(VIEW_FROM * DEG) * d] as V2,
      r: 2.6,
    })),
  ],
  forests: HILL_WOODS,
  proxy: buildBree,
  annotation: {
    title: 'Bree',
    subtitle: 'The Prancing Pony',
    blurb: 'Crossroads village of Men and Hobbits, where Strider waited in the corner.',
  },
  bookmarks: [
    {
      id: 'bree-close',
      distanceKm: 22,
      elevationDeg: 3,
      azimuthDeg: VIEW_FROM,
      fov: 8,
      lift: 0.4,
      aimKm: [0.4, 0.05],
      tod: 19.2,
      compare: ['reference/film/bree/bree-wide.webp', 'reference/film/bree/bree-gate-night.jpg'],
      note: 'hero (regional, 22 km, long lens, low): golden dusk (19.2: the low sun behind the camera gilding the west fronts and the stakes — later the town lies in the shadow of the land to the west — the windows and the gate lamps lit) from the west down the East Road — the palisade and the lit West-gate towers on the road, the steep roofs of the town climbing Bree-hill behind them, hedgerows and the hill’s wooded crest, Weathertop on the far horizon',
    },
  ],
});
