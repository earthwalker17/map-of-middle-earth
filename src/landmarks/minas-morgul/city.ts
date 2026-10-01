import { hexToLinear, linearToSrgbBytes } from '../../materials/families.ts';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import { SINK } from '../kit/ProxyKit.ts';
import { elevation } from '../osgiliath/elev.ts';
import type { V2, V3 } from '../records.ts';
import { BRIDGE_END, C, GATE, GATE_OUT, PAD_C, T2, T2_TOP, T3, T3_TOP, TOWER, WALL } from './layout.ts';

/**
 * The stone and the corpse-light (the RotK gate still, Nasmith's Tower of the Moon): PALE, ghostly stone
 * (albedo ≈ 0.3–0.4: moonlit it reads bone-grey, by day a pale grey-green) washed from below by a green
 * light. Every outer face — curtain, terrace faces, towers, gate blades, keep blocks, houses — carries
 * thin night-gated `emissiveGreen` skins in fine bands from its foot to ≈ 40 % of its height, the light
 * strongest at the foot and falling smoothly (∝ (1 − t)^1.7) to nothing, the paint drifting from a clear
 * emerald to a pale white-green so the upper bands' daytime albedo (¼ of the paint) nears the stone's;
 * the light pools on the ground at every wall foot (flat glow strips: the halo at the base) and spills
 * down the retaining plinths. Windows are few, small, dim slits; the gate mouth burns; the Tower's lamp
 * room is the one strong light (tower.ts).
 */
const STONE = 0xaeb2ab;
const STONE_HI = 0xbabeb7;
const STONE_LO = 0x9a9f98;
const RIB = 0xb6bab3;
const PLINTH = 0x7e837d;
const ROCK = 0x5d625e;
const ROOF = [0x4f5652, 0x5a605c, 0x474d4a];
const GATE_STONE = 0x939891;
const BRIDGE_STONE = 0x8e928c;
const STATUE = 0x5f6560;
/**
 * The wash's paints, foot → top: a dark emerald (strong green light at night, a dark damp foot by day —
 * a glow skin's daytime albedo is ¼ of its paint) drifting to a near-white green whose daytime albedo
 * nears the pale stone's (so by day the walls darken toward their feet like weathered stone; at night
 * the strengths make the green light fade up the wall).
 */
export const GLOW = 0x0a6a32;
const GLOW_PALE = 0xe4eee6;
/** hotter green for the gate mouth and the window slits */
const GLOW_HOT = 0x2ee87a;

const DEG = 180 / Math.PI;

/** linear-space mix of two sRGB hex colours, back to hex */
function mixHex(a: number, b: number, t: number): number {
  const la = hexToLinear(a);
  const lb = hexToLinear(b);
  const [r, g, bl] = linearToSrgbBytes([la[0] + (lb[0] - la[0]) * t, la[1] + (lb[1] - la[1]) * t, la[2] + (lb[2] - la[2]) * t]);
  return (r << 16) | (g << 8) | bl;
}
const lumG = (hex: number): number => hexToLinear(hex)[1];

/** a glow band up a face: from f0 to f1 (fractions of the face height, or km — see the caller), paint, strength */
interface Band {
  f0: number;
  f1: number;
  color: number;
  s: number;
}
/**
 * The wash: `n` bands from the foot up to `top` (fraction of the height), emitting `e0`·(1 − t)^0.5 in
 * green (linear) at fraction t of the washed zone; the paint drifts from the emerald toward a grey green
 * (the hue holds — no white — and the upper bands' daytime albedo comes nearer the pale stone's).
 */
function wash(n: number, top: number, e0: number): Band[] {
  return Array.from({ length: n }, (_, i) => {
    const tm = (i + 0.5) / n;
    const color = mixHex(GLOW, GLOW_PALE, tm ** 2.5);
    const e = e0 * (1 - tm) ** 0.5;
    return { f0: (top * i) / n, f1: (top * (i + 1)) / n, color, s: Math.min(15, e / lumG(color)) };
  });
}
/** foot emission of the wash (linear green) */
const E0 = 0.085;
const WALL_WASH = wash(14, 0.45, E0);
const TIER_WASH = wash(10, 0.45, E0 * 0.9);
const TOWER_WASH = wash(8, 0.42, E0 * 0.9);
const SMALL_WASH = wash(4, 0.4, E0 * 0.7);
const RIB_WASH = wash(5, 0.42, E0 * 0.8);

/** outward unit direction from a centre */
function outward(p: V2, c: V2 = C): V2 {
  const dx = p[0] - c[0];
  const dz = p[1] - c[1];
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

const rectO = (x0: number, x1: number, z0: number, z1: number): V2[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];

interface SegOpts {
  /** wall height above its base */
  h: number;
  /** thickness at the foot / at the top */
  t: number;
  tt: number;
  shade: number;
  /** the side away from this point is the outer face */
  centre: V2;
  glow: Band[];
  ribs?: boolean;
  /** retaining plinth depth under the outer face (where the shelf falls away) */
  plinth?: number;
  /** base (local y); default: the lowest ground under it − SINK */
  base?: number;
  color?: number;
  /** flat glow strips on the ground along the outer foot (the halo); needs level ground there */
  halo?: boolean;
}

/**
 * A battered wall segment a → b: pale stone, ends run on by t/2 to close the corners; pilaster ribs up the
 * outer face (LOD0), the wash on the outer face (and the ribs' fronts), an optional retaining plinth with
 * the light spilling down it, an optional halo of light on the ground at its foot. Returns its base.
 */
function wallSeg(k: ProxyKit, a: V2, b: V2, o: SegOpts): number {
  const { h, t, tt } = o;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L = Math.hypot(dx, dz);
  const ux = dx / L;
  const uz = dz / L;
  const yaw = -Math.atan2(dz, dx) * DEG;
  const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const hl = L / 2 + t / 2;
  const nx = -uz;
  const nz = ux;
  // the loft's local +z is (nx, nz); out = +1 when that is the outer side
  const out = nx * (mid[0] - o.centre[0]) + nz * (mid[1] - o.centre[1]) > 0 ? 1 : -1;
  const corners: V2[] = [
    [mid[0] - ux * hl - nx * (t / 2), mid[1] - uz * hl - nz * (t / 2)],
    [mid[0] + ux * hl - nx * (t / 2), mid[1] + uz * hl - nz * (t / 2)],
    [mid[0] + ux * hl + nx * (t / 2), mid[1] + uz * hl + nz * (t / 2)],
    [mid[0] - ux * hl + nx * (t / 2), mid[1] - uz * hl + nz * (t / 2)],
    mid,
  ];
  const base = o.base ?? Math.min(...corners.map(([x, z]) => k.ground(x, z))) - SINK;
  const at: V3 = [mid[0], base, mid[1]];
  const rot: V3 = [0, yaw, 0];
  k.loft(
    'weathered',
    [
      { outline: rectO(-hl, hl, -t / 2, t / 2), y: 0 },
      { outline: rectO(-hl, hl, -tt / 2, tt / 2), y: h },
    ],
    { at, rot, color: o.color ?? STONE, shade: o.shade },
  );
  // a thin coping course along the top
  k.loft('weathered', [{ outline: rectO(-hl, hl, -tt / 2 - 0.012, tt / 2 + 0.012), y: h }, { outline: rectO(-hl, hl, -tt / 2 - 0.012, tt / 2 + 0.012), y: h + 0.025 }], {
    at,
    rot,
    color: STONE_LO,
    lod: 0,
  });
  // the face's offset from the wall line at height y (battered)
  const face = (y: number) => t / 2 + ((tt - t) / 2) * (y / h);
  const skin = (y: number, w0: number, w1: number): V2[] => (out > 0 ? rectO(w0, w1, face(y) + 0.001, face(y) + 0.004) : rectO(w0, w1, -face(y) - 0.004, -face(y) - 0.001));
  for (const g of o.glow) {
    const y0 = g.f0 * h;
    const y1 = g.f1 * h;
    k.loft(
      'emissiveGreen',
      [
        { outline: skin(y0, -L / 2, L / 2), y: y0 },
        { outline: skin(y1, -L / 2, L / 2), y: y1 },
      ],
      { at, rot, color: g.color, glow: { strength: g.s, gate: 'night' }, lod: g.f0 > 0.12 ? 0 : 1 },
    );
  }
  // the retaining plinth: a battered talus of masonry under the outer face where the shelf falls away,
  // the light spilling down its upper part
  if (o.plinth && o.plinth > 0) {
    const zIn = out > 0 ? -t / 2 : t / 2;
    const zOut = (w: number) => (out > 0 ? t / 2 + w : -t / 2 - w);
    const pr = (w: number): V2[] => (out > 0 ? rectO(-hl - w, hl + w, zIn, zOut(w)) : rectO(-hl - w, hl + w, zOut(w), zIn));
    const P = o.plinth;
    const wAt = (y: number) => 0.03 + (0.16 - 0.03) * (-y / P);
    k.loft(
      'weathered',
      [
        { outline: pr(0.16), y: -P },
        { outline: pr(0.03), y: 0.02 },
      ],
      { at, rot, color: PLINTH, shade: o.shade },
    );
    // the spill: three bands down the plinth's top quarter
    for (let i = 0; i < 3; i++) {
      const ya = -(i / 3) * P * 0.3;
      const yb = -((i + 1) / 3) * P * 0.3;
      const sk = (y: number): V2[] => {
        const w = wAt(y);
        return out > 0 ? rectO(-L / 2, L / 2, t / 2 + w + 0.001, t / 2 + w + 0.004) : rectO(-L / 2, L / 2, -t / 2 - w - 0.004, -t / 2 - w - 0.001);
      };
      const g = o.glow[Math.min(o.glow.length - 1, i)];
      k.loft(
        'emissiveGreen',
        [
          { outline: sk(yb), y: yb },
          { outline: sk(ya), y: ya },
        ],
        { at, rot, color: g.color, glow: { strength: g.s * (0.75 - 0.2 * i), gate: 'night' }, lod: 0 },
      );
    }
  }
  // the halo: the light pooling on level ground at the foot (two strips fading outward)
  if (o.halo) {
    for (const [w0, w1, f] of [
      [0.004, 0.06, 0.55],
      [0.06, 0.14, 0.25],
    ] as const) {
      const g = o.glow[0];
      const strip = out > 0 ? rectO(-L / 2, L / 2, t / 2 + w0, t / 2 + w1) : rectO(-L / 2, L / 2, -t / 2 - w1, -t / 2 - w0);
      k.loft(
        'emissiveGreen',
        [
          { outline: strip, y: SINK - 0.004 },
          { outline: strip, y: SINK + 0.003 },
        ],
        { at, rot, color: g.color, glow: { strength: g.s * f, gate: 'night' }, lod: 0 },
      );
    }
  }
  // pilaster ribs up the outer face (the film's vertically ribbed walls), following the batter, their
  // fronts washed too (no barcode of pale ribs in a green face)
  if (o.ribs) {
    const n = Math.floor(L / 0.14);
    const rw = 0.035;
    for (let i = 0; i < n; i++) {
      const s = ((i + 0.5) / n - 0.5) * L;
      const rib = (f0: number, f1: number): V2[] => rectO(s - rw / 2, s + rw / 2, out > 0 ? f0 : -f1, out > 0 ? f1 : -f0);
      k.loft(
        'weathered',
        [
          { outline: rib(t / 2 - 0.01, t / 2 + 0.045), y: 0 },
          { outline: rib(tt / 2 - 0.01, tt / 2 + 0.018), y: h * 0.97 },
        ],
        { at, rot, color: RIB, shade: o.shade, lod: 0 },
      );
      const front = (y: number) => t / 2 + 0.045 + ((tt / 2 + 0.018 - t / 2 - 0.045) * y) / (h * 0.97);
      for (const g of RIB_WASH) {
        const y0 = g.f0 * h;
        const y1 = g.f1 * h;
        const sk = (y: number): V2[] => rectO(s - rw / 2 - 0.001, s + rw / 2 + 0.001, out > 0 ? front(y) + 0.001 : -front(y) - 0.004, out > 0 ? front(y) + 0.004 : -front(y) - 0.001);
        k.loft(
          'emissiveGreen',
          [
            { outline: sk(y0), y: y0 },
            { outline: sk(y1), y: y1 },
          ],
          { at, rot, color: g.color, glow: { strength: g.s, gate: 'night' }, lod: 0 },
        );
      }
    }
  }
  return base;
}

/**
 * A bastion: a battered six-sided tower with a flat top and a low parapet, the wash round its foot;
 * `cap` > 0: a short faceted pyramid roof instead (the tall towers against the mountain).
 */
function bastion(k: ProxyKit, p: V2, r: number, h: number, cap: number, base?: number, lod?: 0 | 1 | 2): void {
  const pts: V2[] = Array.from({ length: 8 }, (_, j): V2 => [p[0] + Math.cos((j / 8) * Math.PI * 2) * r, p[1] + Math.sin((j / 8) * Math.PI * 2) * r]);
  const b0 = base ?? Math.min(...[...pts, p].map(([x, z]) => k.ground(x, z))) - SINK;
  const rr = (y: number) => r * (1 - 0.12 * (y / h));
  k.lathe(
    'weathered',
    [
      [r, 0],
      [rr(h), h],
      [rr(h) * 1.1, h],
      [rr(h) * 1.1, h + 0.05],
      [rr(h) * 0.9, h + 0.05],
      [rr(h) * 0.9, h + 0.02],
      [0, h + 0.02],
    ],
    { at: [p[0], b0, p[1]], seg: 6, color: STONE_HI, shade: 0.97, lod },
  );
  for (const g of TOWER_WASH)
    k.lathe(
      'emissiveGreen',
      [
        [rr(g.f0 * h) + 0.004, g.f0 * h],
        [rr(g.f1 * h) + 0.004, g.f1 * h],
      ],
      { at: [p[0], b0, p[1]], seg: 6, color: g.color, glow: { strength: g.s, gate: 'night' }, lod: 0 },
    );
  if (cap > 0) k.cone('weathered', rr(h) * 1.05, cap, { at: [p[0], b0 + h + 0.02, p[1]], seg: 4, rot: [0, 45, 0], color: ROOF[0], faceted: true, lod });
}

/** a box block (keep hall, gate tower): pale, its wash as slightly larger shells round its lower part */
function block(k: ProxyKit, p: V2, w: number, d: number, h: number, yawDeg: number, y0: number, o: { roof?: 'flat' | 'gable'; color?: number; washBands?: Band[] } = {}): void {
  if (o.roof === 'gable')
    k.house('weathered', 'slate', w, d, h, { at: [p[0], y0, p[1]], rot: [0, yawDeg, 0], seat: false, roof: 'gable', pitch: 58, overhang: 0.008, color: o.color ?? STONE, roofColor: ROOF[1] });
  else {
    k.box('weathered', w, h, d, { at: [p[0], y0, p[1]], rot: [0, yawDeg, 0], color: o.color ?? STONE });
    k.box('weathered', w + 0.03, 0.03, d + 0.03, { at: [p[0], y0 + h, p[1]], rot: [0, yawDeg, 0], color: STONE_LO, lod: 0 });
  }
  for (const g of o.washBands ?? SMALL_WASH)
    k.box('emissiveGreen', w + 0.006, (g.f1 - g.f0) * h, d + 0.006, { at: [p[0], y0 + g.f0 * h, p[1]], rot: [0, yawDeg, 0], color: g.color, glow: { strength: g.s, gate: 'night' }, lod: 0 });
}

/**
 * A fin blade (the film's great blades flanking the gate): a thin pale blade `t` thick, `len` long at its
 * foot (from the wall outwards along `dir`), rising to a point `h` above its foot; the wash on both flanks.
 */
export function fin(k: ProxyKit, at: V2, dir: V2, len: number, h: number, t: number, shade = 1): void {
  const yaw = -Math.atan2(dir[1], dir[0]) * DEG;
  const sec = (l0: number, l1: number, y: number, z0 = -t / 2, z1 = t / 2) => ({ outline: rectO(l0, l1, z0, z1), y });
  const ends: V2[] = [-0.08, len].flatMap((l): V2[] => [-t / 2, t / 2].map((w): V2 => [at[0] + dir[0] * l - dir[1] * w, at[1] + dir[1] * l + dir[0] * w]));
  const base = Math.min(...[...ends, at].map(([x, z]) => k.ground(x, z))) - SINK;
  k.loft('weathered', [sec(-0.08, len, 0), sec(-0.08, len * 0.45, h * 0.55), sec(-0.06, len * 0.08, h * 0.92), sec(-0.05, -0.02, h)], { at: [at[0], base, at[1]], rot: [0, yaw, 0], color: STONE_HI, shade });
  // the blade's outer edge at height y (on the first loft span, y ≤ 0.55 h)
  const l1 = (y: number) => len - (len * 0.55 * y) / (h * 0.55);
  for (const g of TOWER_WASH) {
    const y0 = g.f0 * h * 0.8;
    const y1 = g.f1 * h * 0.8;
    for (const s of [-1, 1]) {
      const z0 = s > 0 ? t / 2 + 0.001 : -t / 2 - 0.004;
      const z1 = s > 0 ? t / 2 + 0.004 : -t / 2 - 0.001;
      k.loft('emissiveGreen', [sec(-0.07, l1(y0), y0, z0, z1), sec(-0.07, l1(y1), y1, z0, z1)], {
        at: [at[0], base, at[1]],
        rot: [0, yaw, 0],
        color: g.color,
        glow: { strength: g.s, gate: 'night' },
        lod: 0,
      });
    }
  }
}

/** a small, dim window slit on a face (local centre, outward normal), night-gated */
function slit(k: ProxyKit, p: V3, n: V2, w = 0.012, h = 0.04, strength = 0.9): void {
  const yaw = -Math.atan2(n[1], n[0]) * DEG;
  k.box('emissiveGreen', 0.005, h, w, { at: [p[0] + n[0] * 0.002, p[1], p[2] + n[1] * 0.002], rot: [0, yaw, 0], color: GLOW_HOT, glow: { strength, gate: 'night' }, lod: 0 });
}

/** a closed polygon's segments, with the polygon's centroid */
function ringSegs(poly: V2[]): { a: V2; b: V2 }[] {
  return poly.map((a, i) => ({ a, b: poly[(i + 1) % poly.length] }));
}

/**
 * A raised terrace (tier): its battered retaining wall round the polygon (pale, washed, a halo on the
 * level ground at its foot), its level top a pale infill slab; top at local y = `top`.
 */
function terrace(k: ProxyKit, poly: V2[], centre: V2, top: number, parapet: number, seed: number): void {
  // the infill: a slab of the polygon (shrunk a little inside the wall line), from the ground to the top
  const inner = poly.map((p): V2 => {
    const d = outward(p, centre);
    return [p[0] - d[0] * 0.05, p[1] - d[1] * 0.05];
  });
  const g0 = Math.min(...poly.map(([x, z]) => k.ground(x, z))) - SINK;
  k.extrude('weathered', inner.map(([x, z]): V2 => [x - centre[0], z - centre[1]]), top - g0, { at: [centre[0], g0, centre[1]], color: STONE_LO });
  for (const [i, { a, b }] of ringSegs(poly).entries()) {
    const ga = Math.min(k.ground(a[0], a[1]), k.ground(b[0], b[1]));
    const base = ga - SINK;
    wallSeg(k, a, b, { h: top + parapet - base, t: 0.12, tt: 0.07, shade: 0.94 + 0.12 * k.r(seed + i), centre, glow: TIER_WASH, base, halo: true });
  }
}

/** a closed polygon round `c`: `n` points at radius r·(1 + wobble), phase-shifted */
function polar(c: V2, r: number, n: number, wobble: number, phase: number): V2[] {
  return Array.from({ length: n }, (_, j): V2 => {
    const a = (j / n) * Math.PI * 2 + phase;
    const rr = r * (1 + wobble * Math.sin(3 * a + 0.7) + 0.5 * wobble * Math.cos(5 * a));
    return [c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr];
  });
}

/**
 * The walled city, tiered up against the mountain: the outer curtain on the shelf (battered, ribbed,
 * walls of uneven height between round bastions and two tall capped towers against the mountain, on a
 * retaining plinth where the shelf falls away, the rock spur under it); a second terrace ring stacked up
 * toward the north-east; the keep terrace round the Tower with its heavy blocks; the gate between the two
 * great blades and two gate towers; pale houses with dark roofs packed between the tiers. Fins only at
 * the gate (the crown is the Tower's).
 */
export function buildCity(k: ProxyKit): void {
  // ---- tier 1: the outer curtain (open at the gate), walls of uneven height, the front higher
  for (let i = 0; i + 1 < WALL.length; i++) {
    const front = (WALL[i][1] + WALL[i + 1][1]) / 2 > C[1] + 0.6;
    const h = (front ? 0.95 : 0.78) + 0.12 * k.r(40 + i);
    wallSeg(k, WALL[i], WALL[i + 1], { h, t: 0.2, tt: 0.11, shade: 0.94 + 0.12 * k.r(50 + i), centre: C, glow: WALL_WASH, ribs: true, plinth: 0.5 });
  }
  WALL.forEach((p, i) => {
    if (i === 0 || i === WALL.length - 1) return;
    // two tall capped towers against the mountain (north-east), round bastions elsewhere
    const north = p[1] < C[1] - 0.6 && p[0] > C[0] - 0.4;
    if (north) bastion(k, p, 0.17, 1.6 + 0.3 * k.r(60 + i), 0.45);
    else if (i % 2) bastion(k, p, 0.17, 1.15 + 0.15 * k.r(70 + i), 0);
  });

  // ---- tier 2 and the keep terrace (tier 3), stacked toward the mountain
  terrace(k, T2, [T2.reduce((s, p) => s + p[0], 0) / T2.length, T2.reduce((s, p) => s + p[1], 0) / T2.length], T2_TOP, 0.14, 100);
  terrace(k, T3, TOWER, T3_TOP, 0.16, 200);
  // bastions on the terraces' corners (varied heights)
  T2.forEach((p, i) => {
    if (i % 3 !== 1) return;
    bastion(k, p, 0.12, T2_TOP + 0.55 + 0.25 * k.r(110 + i), 0, undefined, 0);
  });
  T3.forEach((p, i) => {
    if (i % 4 !== 2) return;
    bastion(k, p, 0.11, T3_TOP + 0.6 + 0.3 * k.r(210 + i), 0, undefined, 0);
  });
  // keep blocks on the keep terrace round the Tower: heavy halls of uneven height
  for (let j = 0; j < 7; j++) {
    const a = (j / 7) * Math.PI * 2 + 0.4 + 0.25 * (k.r(300 + j) - 0.5);
    const rr = 0.8 + 0.05 * k.r(310 + j);
    const p: V2 = [TOWER[0] + Math.cos(a) * rr, TOWER[1] + Math.sin(a) * rr];
    const yawDeg = -a * DEG + 90;
    const h = 0.32 + 0.38 * k.r(320 + j);
    block(k, p, 0.24 + 0.12 * k.r(330 + j), 0.16, h, yawDeg, T3_TOP - SINK, { roof: j % 3 === 1 ? 'gable' : 'flat', color: j % 2 ? STONE : STONE_HI });
    if (k.r(340 + j) < 0.5) slit(k, [p[0] + Math.cos(a) * 0.082, T3_TOP + h * 0.6, p[1] + Math.sin(a) * 0.082], [Math.cos(a), Math.sin(a)]);
  }

  // ---- the gate: two great blades flanking a tall gatehouse with a fanged, burning mouth; two gate
  // towers of different heights behind them
  const side: V2 = [GATE_OUT[1], -GATE_OUT[0]];
  for (const s of [-1, 1]) {
    const at: V2 = [GATE[0] + side[0] * s * 0.19, GATE[1] + side[1] * s * 0.19];
    fin(k, at, GATE_OUT, 0.6, 2.4, 0.08, 1.05);
    const tp: V2 = [GATE[0] + side[0] * s * 0.34 - GATE_OUT[0] * 0.12, GATE[1] + side[1] * s * 0.34 - GATE_OUT[1] * 0.12];
    block(k, tp, 0.22, 0.24, s > 0 ? 1.55 : 1.3, -Math.atan2(side[1], side[0]) * DEG, k.ground(tp[0], tp[1]) - SINK, { color: STONE_HI, washBands: TOWER_WASH });
  }
  const gy = k.ground(GATE[0], GATE[1]);
  const gyaw = -Math.atan2(side[1], side[0]) * DEG;
  k.house('weathered', 'slate', 0.3, 0.2, 0.95, { at: [GATE[0], 0, GATE[1]], rot: [0, gyaw, 0], roof: 'gable', pitch: 62, overhang: 0.01, color: GATE_STONE, roofColor: ROOF[0] });
  for (const g of TOWER_WASH)
    k.box('emissiveGreen', 0.306, (g.f1 - g.f0) * 0.95, 0.206, { at: [GATE[0], gy - SINK + g.f0 * 0.95, GATE[1]], rot: [0, gyaw, 0], color: g.color, glow: { strength: g.s, gate: 'night' }, lod: 0 });
  const mouth: V3 = [GATE[0] + GATE_OUT[0] * 0.105, gy, GATE[1] + GATE_OUT[1] * 0.105];
  k.box('darkStone', 0.14, 0.42, 0.01, { at: mouth, rot: [0, gyaw, 0], color: 0x0b100e });
  k.box('emissiveGreen', 0.11, 0.32, 0.004, { at: [mouth[0] + GATE_OUT[0] * 0.006, gy, mouth[2] + GATE_OUT[1] * 0.006], rot: [0, gyaw, 0], color: GLOW_HOT, glow: { strength: 2.2, gate: 'night' } });
  for (const s of [-1, 0, 1]) k.cone('darkStone', 0.012, s ? 0.07 : 0.05, { at: [mouth[0] + GATE_OUT[0] * 0.01 + side[0] * s * 0.04, gy + 0.42, mouth[2] + GATE_OUT[1] * 0.01 + side[1] * s * 0.04], rot: [180, 0, 0], seg: 4, color: 0x59625d });
  k.light([mouth[0] + GATE_OUT[0] * 0.012, gy + 0.1, mouth[2] + GATE_OUT[1] * 0.012], { color: 0x1fe070, intensity: 0.45, radius: 0.016, kind: 'magic', gate: 'night' });

  // ---- houses: pale, dark-roofed, packed between the curtain and the terraces (on the shelf) and on the
  // second terrace's ring; the street from the gate kept clear; a few dim slits
  const street: V2[] = [
    [GATE[0] - 0.07, GATE[1] - 0.1],
    [GATE[0] + 0.07, GATE[1] - 0.1],
    [TOWER[0] + 0.08, TOWER[1] + 0.9],
    [TOWER[0] - 0.08, TOWER[1] + 0.9],
  ];
  const inset = WALL.map((p): V2 => {
    const d = outward(p);
    return [p[0] - d[0] * 0.2, p[1] - d[1] * 0.2];
  });
  const t2out = T2.map((p): V2 => {
    const d = outward(p, TOWER);
    return [p[0] + d[0] * 0.1, p[1] + d[1] * 0.1];
  });
  const t3out = T3.map((p): V2 => {
    const d = outward(p, TOWER);
    return [p[0] + d[0] * 0.08, p[1] + d[1] * 0.08];
  });
  const t2in = T2.map((p): V2 => {
    const d = outward(p, TOWER);
    return [p[0] - d[0] * 0.08, p[1] - d[1] * 0.08];
  });
  const house = (i: number, x: number, z: number, u: number, y: number | null, lift: number) => {
    const w = 0.09 + 0.09 * u;
    const d = 0.07 + 0.05 * k.r(100 + i);
    const h = 0.16 + 0.16 * k.r(200 + i) + lift;
    const yaw = -Math.atan2(z - C[1], x - C[0]) * DEG + 90 + (k.r(300 + i) - 0.5) * 24;
    const flat = k.r(350 + i) < 0.35;
    k.house('weathered', 'slate', w, d, h, {
      at: [x, y ?? 0, z],
      rot: [0, yaw, 0],
      ...(y === null ? { dig: 0.3 } : { seat: false }),
      roof: flat ? 'flat' : u < 0.3 ? 'hip' : 'gable',
      pitch: 52 + 8 * k.r(400 + i),
      overhang: 0.008,
      color: [STONE, STONE_HI, STONE_LO][i % 3],
      shade: 0.9 + 0.2 * k.r(500 + i),
      roofColor: ROOF[i % ROOF.length],
      lod: 0,
    });
    const y0 = (y ?? k.ground(x, z)) - SINK;
    k.box('emissiveGreen', w + 0.005, h * 0.3, d + 0.005, { at: [x, y0, z], rot: [0, yaw, 0], color: SMALL_WASH[0].color, glow: { strength: SMALL_WASH[0].s * 0.7, gate: 'night' }, lod: 0 });
    if (k.r(600 + i) < 0.18) {
      const yr = (yaw * Math.PI) / 180;
      const n: V2 = [Math.sin(yr), Math.cos(yr)];
      slit(k, [x + n[0] * (d / 2), y0 + h * (0.5 + 0.15 * k.r(700 + i)), z + n[1] * (d / 2)], n, 0.011, Math.min(0.045, h * 0.22), 0.7 + 0.5 * u);
    }
  };
  k.scatter({ polygon: inset }, 130, (i, x, z, u) => house(i, x, z, u, null, 0), { minSpacing: 0.13, avoid: [street, t2out, { at: GATE, r: 0.48 }] });
  k.scatter({ polygon: t2in }, 60, (i, x, z, u) => house(1000 + i, x, z, u, T2_TOP - SINK, 0.08), { minSpacing: 0.12, avoid: [street, t3out] });

  // ---- the rock spur: the shelf's fall on the west and south, broken rock under the plinths, leaving the
  // bridge's line clear
  rockSpur(k);
}

/**
 * Sheer rock under the city's shelf: a kit cliff on an arc round the shelf's west and south rims (face
 * out), tall enough to reach the plinths, with a gap where the bridge leaves the gate.
 */
function rockSpur(k: ProxyKit): void {
  const runs: [number, number][] = [
    [325, 200],
    [176, 120],
  ];
  for (const [from, to] of runs) {
    const n = Math.max(4, Math.round((from - to) / 7));
    const pts: V2[] = [];
    for (let i = 0; i <= n; i++) {
      // counter-clockwise (bearing decreasing): the face looks out
      const b = ((from + ((to - from) * i) / n) * Math.PI) / 180;
      const r = 2.0 + 0.12 * Math.sin(i * 1.9);
      pts.push([PAD_C[0] + Math.sin(b) * r, PAD_C[1] - Math.cos(b) * r]);
    }
    const hs = pts.map(([x, z]) => Math.min(2.6, Math.max(0.4, -0.15 - k.ground(x, z))));
    k.cliff('weathered', pts, hs, { color: ROCK, rough: 0.6, strata: 0.5, depth: 0.8, soft: 0.25 });
  }
}

/**
 * The bridge over the Morgulduin from the gate to the road on the south bank: a broad stone deck on
 * round arches and heavy piers (one elevation-drawn slab: the deck line falling gently from the gate, the
 * arches' intrados and the pier feet following the ground), lined on both parapets with hunched statues
 * on plinths, their heads catching the corpse-light.
 */
export function buildBridge(k: ProxyKit, padY: number): void {
  const a: V2 = [GATE[0] + GATE_OUT[0] * 0.115, GATE[1] + GATE_OUT[1] * 0.115];
  const b: V2 = BRIDGE_END;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dir: V2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const yA = padY + 0.05;
  const yB = k.ground(b[0], b[1]) + 0.05;
  const deckY = (u: number) => yA + ((yB - yA) * u) / L;
  const width = 0.4;
  const deck = 0.1;
  const ground = (u: number) => Math.min(...[-0.45, 0, 0.45].map((s) => k.ground(a[0] + dir[0] * u - dir[1] * s * width, a[1] + dir[1] * u + dir[0] * s * width))) - 0.06;
  const n = 7;
  const span = L / n;
  const pier = 0.18;
  const rA = (span - pier) / 2;
  const outline: V2[] = [
    [0, deckY(0)],
    [L, deckY(L)],
  ];
  const under: V2[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const u0 = i * span;
    const u1 = (i + 1) * span;
    const uc = (u0 + u1) / 2;
    const p0 = Math.min(L, u1 + pier / 2);
    const p1 = u1 - pier / 2;
    under.push([p0, Math.min(ground(p0), deckY(p0) - deck)], [p1, Math.min(ground(p1), deckY(p1) - deck)]);
    const spring = deckY(uc) - deck - rA * 1.05;
    if (spring > Math.max(ground(p1), ground(u0 + pier / 2)) + 0.03) {
      under.push([p1, spring]);
      for (let j = 1; j < 10; j++) {
        const t = (j / 10) * Math.PI;
        under.push([uc + Math.cos(t) * rA, spring + Math.sin(t) * rA]);
      }
      under.push([u0 + pier / 2, spring]);
    }
    under.push([u0 + pier / 2, Math.min(ground(u0 + pier / 2), deckY(u0 + pier / 2) - deck)]);
  }
  under.push([0, Math.min(ground(0), deckY(0) - deck)]);
  const clean: V2[] = [];
  for (const q of under) {
    const last = clean[clean.length - 1];
    if (last && Math.abs(last[0] - q[0]) < 1e-4 && Math.abs(last[1] - q[1]) < 1e-4) continue;
    clean.push(q);
  }
  elevation(k, 'weathered', a, b, [...outline, ...clean], width, { color: BRIDGE_STONE, shade: 0.95 });
  // parapet kerbs, their inner faces lit green from below (the light of the river and the gate)
  for (const s of [-1, 1]) {
    const off = (width / 2 - 0.014) * s;
    const pa: V2 = [a[0] - dir[1] * off, a[1] + dir[0] * off];
    const pb: V2 = [b[0] - dir[1] * off, b[1] + dir[0] * off];
    elevation(
      k,
      'weathered',
      pa,
      pb,
      [
        [0, deckY(0) - 0.01],
        [L, deckY(L) - 0.01],
        [L, deckY(L) + 0.028],
        [0, deckY(0) + 0.028],
      ],
      0.026,
      { color: BRIDGE_STONE, shade: 0.88, lod: 0 },
    );
  }
  // statues along both parapets: plinth, a hunched cloaked body leaning in over the road, a hooded
  // head; a dim green glint under the hood (LOD0)
  const ns = Math.floor(L / 0.3);
  for (let i = 1; i < ns; i++) {
    const u = (i / ns) * L;
    const y = deckY(u);
    for (const s of [-1, 1]) {
      const off = (width / 2 - 0.04) * s;
      const px = a[0] + dir[0] * u - dir[1] * off;
      const pz = a[1] + dir[1] * u + dir[0] * off;
      const yaw = -Math.atan2(dir[1], dir[0]) * DEG;
      k.box('weathered', 0.06, 0.03, 0.06, { at: [px, y, pz], rot: [0, yaw, 0], color: PLINTH, lod: 0 });
      // the body: a tapering hunched cloak (a 5-sided cone, leaning toward the road)
      const lean: V3 = [8 * dir[0] * s, 0, -8 * dir[1] * s];
      k.cylinder('weathered', 0.012, 0.03, 0.085, { at: [px, y + 0.03, pz], rot: lean, seg: 5, color: STATUE, lod: 0 });
      k.cone('weathered', 0.02, 0.04, { at: [px + dir[1] * s * 0.008, y + 0.11, pz - dir[0] * s * 0.008], seg: 5, color: STATUE, lod: 0 });
      k.box('emissiveGreen', 0.012, 0.006, 0.012, { at: [px + dir[1] * s * 0.014, y + 0.118, pz - dir[0] * s * 0.014], color: GLOW_HOT, glow: { strength: 1.0, gate: 'night' }, lod: 0 });
    }
  }
}
