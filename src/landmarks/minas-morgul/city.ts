import { hexToLinear, linearToSrgbBytes } from '../../materials/families.ts';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import { SINK } from '../kit/ProxyKit.ts';
import { elevation } from '../osgiliath/elev.ts';
import type { V2, V3 } from '../records.ts';
import { BRIDGE_END, C, GATE, GATE_OUT, TOWER, WALL } from './layout.ts';

/**
 * The stone and the corpse-light (the RotK gate still: near-black weathered stone lit green from below
 * and from within, dark tops). Every wall, rib, fin and tower body is opaque structure stone, near-black
 * grey-green (saturation ≤ 0.2), so it shades with the moon and reads the same by day. The light is a
 * set of thin night-gated `emissiveGreen` skins laid on the outer faces in eight fine bands — strongest at
 * the foot, falling smoothly to almost nothing by 60 % of the height (the ribs standing through them, so
 * the glow lies in the recesses). Their paint is a dark pure emerald drifting a little towards the
 * stone's grey higher up: a glow skin's daytime albedo is ¼ of its paint, so by day the lower walls read
 * as dark damp stone, never emerald; at night a moderate strength keeps the green (the night grade keeps
 * about half the saturation and AgX whitens bright greens, so brighter = paler). The parapet spikes keep
 * a thin glow line; windows are small glowing slits on the houses and the inner ring (no point lights);
 * the gate mouth burns. Only the Tower's lantern burns by day.
 */
const WALL_STONE = 0x3b413e;
const RIB_STONE = 0x444a47;
const FIN_STONE = 0x343a37;
const HOUSE = [0x4c534f, 0x545b57, 0x474e4a, 0x5a605c];
const ROOF = [0x232927, 0x282e2c, 0x202624];
const SLATE = 0x232927;
const GATE_STONE = 0x2f3633;
const BRIDGE_STONE = 0x7a7f7a;
const STATUE = 0x1f2422;
const PLINTH = 0x343b38;
/** the corpse-light at the foot of the walls: a dark pure emerald (no red, almost no blue — the haze and
 * the night tint add blue), near-black by day */
export const GLOW = 0x00450d;
/** brighter emerald for the spikes, slits and the gate mouth */
const GLOW_HOT = 0x006c2c;

const DEG = 180 / Math.PI;

/** linear-space mix of two sRGB hex colours, back to hex */
function mixHex(a: number, b: number, t: number): number {
  const la = hexToLinear(a);
  const lb = hexToLinear(b);
  const [r, g, bl] = linearToSrgbBytes([la[0] + (lb[0] - la[0]) * t, la[1] + (lb[1] - la[1]) * t, la[2] + (lb[2] - la[2]) * t]);
  return (r << 16) | (g << 8) | bl;
}
/** a glow paint whose daytime albedo (¼ of the paint) equals the stone's */
function stoneGlow(stone: number): number {
  const [r, g, b] = linearToSrgbBytes(hexToLinear(stone).map((v) => Math.min(1, v * 4)) as [number, number, number]);
  return (r << 16) | (g << 8) | b;
}
const lum = (hex: number): number => {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** a glow band up a face: from y0 to y1 (fractions of the height, or km — see the caller), paint, strength */
interface Band {
  f0: number;
  f1: number;
  color: number;
  s: number;
}
/**
 * `n` bands from 0 up to `top`: the emitted light falls as exp(−3.2·i/n) (the strength is normalised by
 * each band's paint luminance), the paint drifts from the emerald towards the stone's grey by `drift` at
 * the top band (its daytime albedo then nears the stone's).
 */
function bands(stone: number, n: number, top: number, drift = 0.5, foot = 1): Band[] {
  const grey = stoneGlow(stone);
  return Array.from({ length: n }, (_, i) => {
    const color = mixHex(GLOW, grey, (drift * i) / Math.max(1, n - 1));
    const f = foot * Math.exp((-3.2 * i) / n);
    return { f0: (top * i) / n, f1: (top * (i + 1)) / n, color, s: (f * lum(GLOW)) / lum(color) };
  });
}
/** the curtain wall: twelve bands to 60 % of its height */
const WALL_BANDS = bands(WALL_STONE, 12, 0.6);
const INNER_BANDS = bands(WALL_STONE, 8, 0.55, 0.5, 0.8);
/** fins and blades: absolute heights (km) — the great gate blades must not carry giant panels */
const FIN_BANDS = bands(FIN_STONE, 5, 0.3, 0.4, 0.9);
const TOWER_BANDS = bands(WALL_STONE, 5, 0.5, 0.5, 0.9);
/** glow strength of the foot band (emission = linear paint × strength) */
const SKIN = 2.3;

/** outward unit direction from the city centre */
function outward(p: V2): V2 {
  const dx = p[0] - C[0];
  const dz = p[1] - C[1];
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

/**
 * A battered wall segment a → b: dark stone `h` tall, `t` thick at the foot and `tt` at the top, its
 * ends run on by t/2 to close the corners, seated on the lowest ground under it; pilaster ribs up the
 * outer face (LOD0), glow skins in bands on the outer face between them, a row of lit spikes along its
 * top (LOD0). The outer side is the one away from `centre`. Returns the wall's base (local y).
 */
function wallSeg(k: ProxyKit, a: V2, b: V2, h: number, t: number, tt: number, shade: number, centre: V2, glow: Band[], ribs: boolean, plinth = 0): number {
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
  // the loft's local +z is (nx, nz) (its yaw turns local z onto the right-hand normal)
  const out = nx * (mid[0] - centre[0]) + nz * (mid[1] - centre[1]) > 0 ? 1 : -1;
  const corners: V2[] = [
    [mid[0] - ux * hl - nx * (t / 2), mid[1] - uz * hl - nz * (t / 2)],
    [mid[0] + ux * hl - nx * (t / 2), mid[1] + uz * hl - nz * (t / 2)],
    [mid[0] + ux * hl + nx * (t / 2), mid[1] + uz * hl + nz * (t / 2)],
    [mid[0] - ux * hl + nx * (t / 2), mid[1] - uz * hl + nz * (t / 2)],
    mid,
  ];
  const base = Math.min(...corners.map(([x, z]) => k.ground(x, z))) - SINK;
  const rect = (x0: number, x1: number, z0: number, z1: number): V2[] => [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  const at: V3 = [mid[0], base, mid[1]];
  const rot: V3 = [0, yaw, 0];
  k.loft(
    'weathered',
    [
      { outline: rect(-hl, hl, -t / 2, t / 2), y: 0 },
      { outline: rect(-hl, hl, -tt / 2, tt / 2), y: h },
    ],
    { at, rot, color: WALL_STONE, shade },
  );
  // the retaining plinth: a battered talus of dark masonry `plinth` deep under the outer face, so where
  // the shelf falls away the wall stands on a built terrace edge, not on a ragged rim of bare rock
  if (plinth > 0) {
    const zIn = out > 0 ? -t / 2 : t / 2;
    const zOut = (w: number) => (out > 0 ? t / 2 + w : -t / 2 - w);
    const pr = (w: number): V2[] => (out > 0 ? rect(-hl - w, hl + w, zIn, zOut(w)) : rect(-hl - w, hl + w, zOut(w), zIn));
    k.loft(
      'weathered',
      [
        { outline: pr(0.16), y: -plinth },
        { outline: pr(0.03), y: 0.02 },
      ],
      { at, rot, color: PLINTH, shade },
    );
  }
  // the face's offset from the wall line at height y (battered)
  const face = (y: number) => t / 2 + ((tt - t) / 2) * (y / h);
  for (const g of glow) {
    const y0 = g.f0 * h;
    const y1 = g.f1 * h;
    const sk = (y: number): V2[] => (out > 0 ? rect(-L / 2, L / 2, face(y) + 0.001, face(y) + 0.004) : rect(-L / 2, L / 2, -face(y) - 0.004, -face(y) - 0.001));
    k.loft(
      'emissiveGreen',
      [
        { outline: sk(y0), y: y0 },
        { outline: sk(y1), y: y1 },
      ],
      { at, rot, color: g.color, glow: { strength: SKIN * g.s, gate: 'night' }, lod: g.f0 > 0.15 ? 0 : undefined },
    );
  }
  // pilaster ribs up the outer face (the film's vertically ribbed walls), following the batter (LOD0)
  if (ribs) {
    const n = Math.floor(L / 0.13);
    const rw = 0.035;
    for (let i = 0; i < n; i++) {
      const s = ((i + 0.5) / n - 0.5) * L;
      const rib = (f0: number, f1: number): V2[] => rect(s - rw / 2, s + rw / 2, out > 0 ? f0 : -f1, out > 0 ? f1 : -f0);
      k.loft(
        'weathered',
        [
          { outline: rib(t / 2 - 0.01, t / 2 + 0.045), y: 0 },
          { outline: rib(tt / 2 - 0.01, tt / 2 + 0.018), y: h * 0.97 },
        ],
        { at, rot, color: RIB_STONE, shade, lod: 0 },
      );
      // the light washes over the rib's front too, a little dimmer (no black-and-white barcode)
      for (const g of glow.slice(0, 6)) {
        const y0 = g.f0 * h;
        const y1 = g.f1 * h;
        const front = (y: number) => t / 2 + 0.045 + ((tt / 2 + 0.018 - t / 2 - 0.045) * y) / (h * 0.97);
        const sk = (y: number): V2[] => rect(s - rw / 2 - 0.001, s + rw / 2 + 0.001, out > 0 ? front(y) + 0.001 : -front(y) - 0.004, out > 0 ? front(y) + 0.004 : -front(y) - 0.001);
        k.loft(
          'emissiveGreen',
          [
            { outline: sk(y0), y: y0 },
            { outline: sk(y1), y: y1 },
          ],
          { at, rot, color: g.color, glow: { strength: SKIN * g.s * 0.7, gate: 'night' }, lod: 0 },
        );
      }
    }
  }
  // the spiked parapet: dark points with a thin glow (LOD0)
  const ns = Math.floor(L / 0.07);
  for (let i = 0; i < ns; i++) {
    const s = (i + 0.5) / ns - 0.5;
    k.cone('emissiveGreen', 0.016, 0.06 + 0.02 * ((i * 7) % 3), { at: [mid[0] + ux * s * L, base + h - 0.005, mid[1] + uz * s * L], seg: 4, rot: [0, yaw + 45, 0], color: GLOW_HOT, glow: { strength: 1.1, gate: 'night' }, lod: 0 });
  }
  return base;
}

/**
 * A wall tower: a battered dark six-sided drum with glow skins round its foot and a flat top ringed by
 * glowing spikes; `needle`: a tall narrow pointed cap (the film's sharp spires, not a witch's hat).
 */
function wallTower(k: ProxyKit, p: V2, r: number, h: number, needle: number, lod?: 0 | 1 | 2): void {
  const pts: V2[] = Array.from({ length: 6 }, (_, j): V2 => [p[0] + Math.cos((j / 6) * Math.PI * 2) * r, p[1] + Math.sin((j / 6) * Math.PI * 2) * r]);
  const base = Math.min(...[...pts, p].map(([x, z]) => k.ground(x, z))) - SINK;
  const rr = (y: number) => r * (1 - 0.14 * (y / h));
  k.lathe(
    'weathered',
    [
      [r, 0],
      [rr(h), h],
      [rr(h) * 1.12, h],
      [rr(h) * 1.12, h + 0.04],
      [0, h + 0.04],
    ],
    { at: [p[0], base, p[1]], seg: 6, color: WALL_STONE, shade: 1.04, lod },
  );
  for (const g of TOWER_BANDS)
    k.lathe(
      'emissiveGreen',
      [
        [rr(g.f0 * h) + 0.004, g.f0 * h],
        [rr(g.f1 * h) + 0.004, g.f1 * h],
      ],
      { at: [p[0], base, p[1]], seg: 6, color: g.color, glow: { strength: SKIN * g.s, gate: 'night' }, lod: 0 },
    );
  for (let j = 0; j < 6; j++) {
    const a = ((j + 0.5) / 6) * Math.PI * 2;
    k.cone('emissiveGreen', 0.016, 0.07, { at: [p[0] + Math.cos(a) * rr(h) * 1.05, base + h + 0.035, p[1] + Math.sin(a) * rr(h) * 1.05], seg: 4, color: GLOW_HOT, glow: { strength: 1.1, gate: 'night' }, lod: 0 });
  }
  if (needle > 0) k.cone('darkStone', rr(h) * 0.55, needle, { at: [p[0], base + h + 0.03, p[1]], seg: 4, rot: [0, 45, 0], color: SLATE, faceted: true, lod });
}

/**
 * A fin buttress (the film's steep, fin-like walls): a thin dark blade `t` thick, `len` long at its foot
 * (from the wall outwards along `dir`), rising to a point `h` above its foot over the wall line; glow
 * skins on both flanks at its foot.
 */
export function fin(k: ProxyKit, at: V2, dir: V2, len: number, h: number, t: number, shade = 1, lod?: 0 | 1 | 2): void {
  const yaw = -Math.atan2(dir[1], dir[0]) * DEG;
  const sec = (l0: number, l1: number, y: number, z0 = -t / 2, z1 = t / 2) => ({
    outline: [
      [l0, z0],
      [l1, z0],
      [l1, z1],
      [l0, z1],
    ] as V2[],
    y,
  });
  // seat on the lowest ground under the blade's foot (as the kit would)
  const ends: V2[] = [-0.08, len].flatMap((l): V2[] => [-t / 2, t / 2].map((w): V2 => [at[0] + dir[0] * l - dir[1] * w, at[1] + dir[1] * l + dir[0] * w]));
  const base = Math.min(...[...ends, at].map(([x, z]) => k.ground(x, z))) - SINK;
  k.loft('weathered', [sec(-0.08, len, 0), sec(-0.08, len * 0.45, h * 0.55), sec(-0.06, len * 0.08, h * 0.92), sec(-0.05, -0.02, h)], { at: [at[0], base, at[1]], rot: [0, yaw, 0], color: FIN_STONE, shade, lod });
  // the blade's outer edge at height y (on the first loft span, y ≤ 0.55 h)
  const l1 = (y: number) => len - (len * 0.55 * y) / (h * 0.55);
  for (const g of FIN_BANDS) {
    const y0 = g.f0;
    const y1 = g.f1;
    for (const s of [-1, 1]) {
      const z0 = s > 0 ? t / 2 + 0.001 : -t / 2 - 0.004;
      const z1 = s > 0 ? t / 2 + 0.004 : -t / 2 - 0.001;
      k.loft('emissiveGreen', [sec(-0.07, l1(y0), y0, z0, z1), sec(-0.07, l1(y1), y1, z0, z1)], {
        at: [at[0], base, at[1]],
        rot: [0, yaw, 0],
        color: g.color,
        glow: { strength: SKIN * g.s, gate: 'night' },
        lod: 0,
      });
    }
  }
}

/** a small glowing window slit on a face (local centre, outward normal), night-gated */
function slit(k: ProxyKit, p: V3, n: V2, w = 0.014, h = 0.05, strength = 1.8): void {
  const yaw = -Math.atan2(n[1], n[0]) * DEG;
  k.box('emissiveGreen', 0.006, h, w, { at: [p[0] + n[0] * 0.002, p[1], p[2] + n[1] * 0.002], rot: [0, yaw, 0], color: GLOW_HOT, glow: { strength, gate: 'night' }, lod: 0 });
}

/**
 * The walled city: battered dark curtain walls lit from below, ribbed and spiked, with flat-topped towers
 * (three with needle caps); fin buttresses standing out from them (two great blades flanking the fanged
 * gate); an inner ring round the Tower's keep; tall steep-roofed houses packed up towards it with green
 * window slits; six slender spires; a dark retaining terrace under the walls where the shelf falls away.
 */
export function buildCity(k: ProxyKit): void {
  // ---- the curtain wall (open at the gate) and its towers
  for (let i = 0; i + 1 < WALL.length; i++) wallSeg(k, WALL[i], WALL[i + 1], 0.85, 0.2, 0.11, 0.92 + 0.16 * k.r(40 + i), C, WALL_BANDS, true, 0.45);
  WALL.forEach((p, i) => {
    if (i === 0 || i === WALL.length - 1) return;
    const tall = i % 2 === 1;
    wallTower(k, p, tall ? 0.14 : 0.11, tall ? 1.25 : 1.02, i === 3 || i === 7 || i === 10 ? 0.55 : 0);
  });
  // fin buttresses: from the wall line outwards, between the towers (uneven heights)
  for (let i = 0; i + 1 < WALL.length; i++) {
    const a = WALL[i];
    const b = WALL[i + 1];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nf = Math.max(1, Math.round(segLen / 0.4));
    for (let j = 0; j < nf; j++) {
      const t = (j + 0.5) / nf;
      const p: V2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      // skip the fins right beside the gate (the great blades stand there)
      if (Math.hypot(p[0] - GATE[0], p[1] - GATE[1]) < 0.35) continue;
      const d = outward(p);
      const h = 1.1 + 0.45 * k.r(10 + i * 7 + j);
      fin(k, [p[0] - d[0] * 0.06, p[1] - d[1] * 0.06], d, 0.3 + 0.12 * k.r(11 + i * 7 + j), h, 0.055, 0.85 + 0.3 * k.r(12 + i * 7 + j), 0);
    }
  }
  // ---- the gate: two great blades flanking a tall dark gatehouse with a fanged, burning mouth
  const side: V2 = [GATE_OUT[1], -GATE_OUT[0]];
  for (const s of [-1, 1]) {
    const at: V2 = [GATE[0] + side[0] * s * 0.19, GATE[1] + side[1] * s * 0.19];
    fin(k, at, GATE_OUT, 0.6, 2.4, 0.08, 1.1);
  }
  const gy = k.ground(GATE[0], GATE[1]);
  const gyaw = -Math.atan2(side[1], side[0]) * DEG;
  k.house('stone', 'slate', 0.3, 0.2, 0.85, { at: [GATE[0], 0, GATE[1]], rot: [0, gyaw, 0], roof: 'gable', pitch: 62, overhang: 0.01, color: GATE_STONE, roofColor: SLATE });
  const mouth: V3 = [GATE[0] + GATE_OUT[0] * 0.101, gy, GATE[1] + GATE_OUT[1] * 0.101];
  k.box('darkStone', 0.14, 0.4, 0.01, { at: mouth, rot: [0, gyaw, 0], color: 0x0b100e });
  k.box('emissiveGreen', 0.11, 0.3, 0.004, { at: [mouth[0] + GATE_OUT[0] * 0.006, gy, mouth[2] + GATE_OUT[1] * 0.006], rot: [0, gyaw, 0], color: GLOW_HOT, glow: { strength: 1.5, gate: 'night' } });
  for (const s of [-1, 0, 1]) k.cone('darkStone', 0.012, s ? 0.07 : 0.05, { at: [mouth[0] + GATE_OUT[0] * 0.01 + side[0] * s * 0.04, gy + 0.4, mouth[2] + GATE_OUT[1] * 0.01 + side[1] * s * 0.04], rot: [180, 0, 0], seg: 4, color: 0x59625d });
  // the gate's light: in the mouth, low (a small glow, not a lamp hung on the wall)
  k.light([mouth[0] + GATE_OUT[0] * 0.012, gy + 0.1, mouth[2] + GATE_OUT[1] * 0.012], { color: 0x1fe070, intensity: 0.35, radius: 0.014, kind: 'magic', gate: 'night' });

  // ---- the inner ring round the Tower's keep, with window slits on its outer faces
  const inner: V2[] = Array.from({ length: 12 }, (_, j): V2 => {
    const a = (j / 12) * Math.PI * 2;
    const r = 0.8 + 0.06 * Math.sin(3 * a + 0.7);
    return [TOWER[0] + Math.cos(a) * r, TOWER[1] + Math.sin(a) * r];
  });
  inner.forEach((p, i) => {
    const q = inner[(i + 1) % inner.length];
    const base = wallSeg(k, p, q, 0.5, 0.14, 0.09, 0.9 + 0.12 * k.r(60 + i), TOWER, INNER_BANDS, false);
    if (i % 3 === 0) wallTower(k, p, 0.08, 0.78, i === 3 ? 0.45 : 0, 0);
    // slits high on the outer face (the face 0.06 out from the wall line at 0.7 of the height)
    const m: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const d = [q[0] - p[0], q[1] - p[1]];
    const L = Math.hypot(d[0], d[1]);
    // the segment's normal turned away from the Tower
    const sgn = -d[1] * (m[0] - TOWER[0]) + d[0] * (m[1] - TOWER[1]) > 0 ? 1 : -1;
    const n: V2 = [(-d[1] / L) * sgn, (d[0] / L) * sgn];
    for (const f of [-0.22, 0.22]) {
      const x = m[0] + (d[0] / L) * f * L + n[0] * 0.052;
      const z = m[1] + (d[1] / L) * f * L + n[1] * 0.052;
      slit(k, [x, base + 0.3, z], n, 0.016, 0.06);
    }
  });

  // ---- houses: tall, steep-roofed, packed and rising towards the keep; the street from the gate to the
  // inner ring kept clear; green window slits on about half of them
  const street: V2[] = [
    [GATE[0] - 0.06, GATE[1] - 0.1],
    [GATE[0] + 0.06, GATE[1] - 0.1],
    [TOWER[0] + 0.08, TOWER[1] + 0.75],
    [TOWER[0] - 0.08, TOWER[1] + 0.75],
  ];
  const inset = WALL.map((p): V2 => {
    const d = outward(p);
    return [p[0] - d[0] * 0.2, p[1] - d[1] * 0.2];
  });
  k.scatter(
    { polygon: inset },
    260,
    (i, x, z, u) => {
      const dT = Math.hypot(x - TOWER[0], z - TOWER[1]);
      const near = Math.max(0, 1 - (dT - 0.85) / 0.9);
      const w = 0.09 + 0.1 * u;
      const d = 0.07 + 0.06 * k.r(100 + i);
      const h = 0.22 + 0.2 * k.r(200 + i) + 0.35 * near;
      const yaw = -Math.atan2(z - C[1], x - C[0]) * DEG + 90 + (k.r(300 + i) - 0.5) * 30;
      k.house('stone', 'slate', w, d, h, {
        at: [x, 0, z],
        rot: [0, yaw, 0],
        roof: u < 0.25 ? 'hip' : 'gable',
        pitch: 58 + 8 * k.r(400 + i),
        overhang: 0.008,
        color: HOUSE[i % HOUSE.length],
        shade: 0.85 + 0.3 * k.r(500 + i),
        roofColor: ROOF[i % ROOF.length],
        dig: 0.3,
        lod: 0,
      });
      // window slits on the face turned out of the city (the kit's yaw turns local +z onto (sin, cos))
      if (k.r(600 + i) < 0.5) {
        const yr = (yaw * Math.PI) / 180;
        const n: V2 = [Math.sin(yr), Math.cos(yr)];
        const tx: V2 = [n[1], -n[0]];
        const gy0 = k.ground(x, z);
        const cnt = w > 0.14 ? 2 : 1;
        for (let j = 0; j < cnt; j++) {
          const off = cnt === 1 ? 0 : (j - 0.5) * w * 0.45;
          slit(k, [x + n[0] * (d / 2) + tx[0] * off, gy0 + h * (0.45 + 0.15 * k.r(700 + i)), z + n[1] * (d / 2) + tx[1] * off], n, 0.012, Math.min(0.06, h * 0.22), 1.3 + 0.9 * u);
        }
      }
    },
    { minSpacing: 0.125, avoid: [street, { at: TOWER, r: 0.95 }] },
  );
  // six slender spires among the houses, with needle caps
  k.scatter(
    { polygon: inset },
    6,
    (i, x, z, u) => {
      k.tower('weathered', 0.05 + 0.03 * u, 0.95 + 0.55 * u, { at: [x, 0, z], seat: true, sides: 6, taper: 0.25, roof: 'spire', roofFam: 'darkStone', roofColor: SLATE, roofH: 0.55 + 0.25 * u, color: HOUSE[i % HOUSE.length], shade: 0.8, lod: 0 });
    },
    { minSpacing: 0.7, avoid: [street, { at: TOWER, r: 0.95 }] },
  );
}

/**
 * The bridge over the Morgulduin from the gate to the road on the south bank: a broad stone deck on
 * round arches and heavy piers (one elevation-drawn slab: the deck line falling gently from the gate, the
 * arches' intrados and the pier feet following the ground), lined on both parapets with dark statues
 * whose small heads catch the corpse-light.
 */
export function buildBridge(k: ProxyKit, padY: number): void {
  const a: V2 = [GATE[0] + GATE_OUT[0] * 0.115, GATE[1] + GATE_OUT[1] * 0.115];
  const b: V2 = BRIDGE_END;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dir: V2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const yA = padY + 0.05;
  const yB = k.ground(b[0], b[1]) + 0.05;
  const deckY = (u: number) => yA + ((yB - yA) * u) / L;
  const width = 0.28;
  const deck = 0.09;
  const ground = (u: number) => Math.min(...[-0.45, 0, 0.45].map((s) => k.ground(a[0] + dir[0] * u - dir[1] * s * width, a[1] + dir[1] * u + dir[0] * s * width))) - 0.06;
  const n = 7;
  const span = L / n;
  const pier = 0.16;
  const rA = (span - pier) / 2;
  // the outline: the deck top from the gate to the far end, then back along the underside — over each
  // span the arch (when it clears the ground), between them the pier feet on the ground
  const outline: V2[] = [
    [0, deckY(0)],
    [L, deckY(L)],
  ];
  const under: V2[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const u0 = i * span;
    const u1 = (i + 1) * span;
    const uc = (u0 + u1) / 2;
    // the pier (or abutment) at u1: its foot
    const p0 = Math.min(L, u1 + pier / 2);
    const p1 = u1 - pier / 2;
    under.push([p0, Math.min(ground(p0), deckY(p0) - deck)], [p1, Math.min(ground(p1), deckY(p1) - deck)]);
    const spring = deckY(uc) - deck - rA * 1.05;
    if (spring > Math.max(ground(p1), ground(u0 + pier / 2)) + 0.03) {
      // the opening: up the pier face, round the arch (crown at the deck less the deck depth), down
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
  // drop repeated / non-descending points along the bottom (keep the polygon simple)
  const clean: V2[] = [];
  for (const q of under) {
    const last = clean[clean.length - 1];
    if (last && Math.abs(last[0] - q[0]) < 1e-4 && Math.abs(last[1] - q[1]) < 1e-4) continue;
    clean.push(q);
  }
  elevation(k, 'weathered', a, b, [...outline, ...clean], width, { color: BRIDGE_STONE, shade: 0.95 });
  // parapet kerbs
  for (const s of [-1, 1]) {
    const off = (width / 2 - 0.012) * s;
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
        [L, deckY(L) + 0.022],
        [0, deckY(0) + 0.022],
      ],
      0.022,
      { color: BRIDGE_STONE, shade: 0.85, lod: 0 },
    );
  }
  // statues along both parapets: dark hunched blocks on plinths, small green-lit heads (LOD0)
  const ns = Math.floor(L / 0.32);
  for (let i = 1; i < ns; i++) {
    const u = (i / ns) * L;
    const y = deckY(u);
    for (const s of [-1, 1]) {
      const off = (width / 2 - 0.03) * s;
      const px = a[0] + dir[0] * u - dir[1] * off;
      const pz = a[1] + dir[1] * u + dir[0] * off;
      const yaw = -Math.atan2(dir[1], dir[0]) * DEG;
      k.box('darkStone', 0.05, 0.025, 0.05, { at: [px, y, pz], rot: [0, yaw, 0], color: STATUE, lod: 0 });
      k.box('darkStone', 0.036, 0.07, 0.04, { at: [px, y + 0.025, pz], rot: [0, yaw + 8 * s, 0], color: STATUE, lod: 0 });
      k.cone('emissiveGreen', 0.013, 0.026, { at: [px, y + 0.095, pz], seg: 4, color: GLOW_HOT, glow: { strength: 1.2, gate: 'night' }, lod: 0 });
    }
  }
}
