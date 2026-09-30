import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';

/**
 * The tower's stone: the 'emissiveGreen' family at a low strength (its lit albedo is ¼ of the paint, a dark
 * teal by day like the film's #2b4f4c; a faint teal glow at night, so the shaft stands out against the
 * dark mountain behind while its slits burn brighter)
 */
export const TOWER_STONE = 0x3f7a6e;
const TOWER_STRENGTH = 0.1;
const CROWN_STONE = 0x2e4d49;
const D2R = Math.PI / 180;

/**
 * The twisted tower's section: four great fins (N/E/S/W), a lesser fin between each pair and a deep
 * recess either side of every fin — a star of 16 points, radius `r` at the great fin tips.
 */
export function finStar(r: number): V2[] {
  const pattern = [1, 0.62, 0.8, 0.62];
  return Array.from({ length: 16 }, (_, j): V2 => {
    const a = (j / 16) * Math.PI * 2;
    const rr = r * pattern[j % 4];
    return [Math.cos(a) * rr, Math.sin(a) * rr];
  });
}

/** a circle of `n` points, radius `r` (glowing cores between the fins) */
function ring(r: number, n = 16): V2[] {
  return Array.from({ length: n }, (_, j): V2 => [Math.cos((j / n) * Math.PI * 2) * r, Math.sin((j / n) * Math.PI * 2) * r]);
}

/** twist (deg) of the shaft at height fraction t ∈ [0, 1] */
export function twistAt(t: number): number {
  return 78 * t * t * (1.4 - 0.4 * t);
}
/** scale of the shaft section at height fraction t: a slight swell a third of the way up, tapering to 0.6 */
export function scaleAt(t: number): number {
  return 1 - 0.4 * t + 0.06 * Math.sin(Math.PI * Math.min(1, t * 1.6));
}

/**
 * Where a section vertex at angle `theta` (deg, section frame) ends up after the loft's rotation by
 * `rotDeg`: the kit turns (x, z) by (x cos a + z sin a, −x sin a + z cos a), i.e. the angle becomes θ − a.
 */
function turned(theta: number, rotDeg: number, r: number): V2 {
  const a = (theta - rotDeg) * D2R;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

export interface TowerSpec {
  at: V2;
  /** ground (local y) under the tower */
  y0: number;
  /** fin-tip radius of the shaft at its foot, km */
  r: number;
  /** keep (base) height, km */
  keepH: number;
  /** shaft height above the keep, km */
  shaftH: number;
}

/** corpse-light greens */
const GLOW_CORE = 0x7bd99a;
const GLOW_LANTERN = 0xa6f0bf;
const LIGHT = 0x8ff0b0;

/**
 * The Tower of the Moon: a battered keep, then a shaft of fin sections twisting ~80° as it rises and
 * tapering, an open lantern stage (the fins run on up as piers round a green-burning core), a flared crown
 * ring with jagged spikes leaning out round a faceted spire. The corpse-light burns inside: green cores
 * show in the recesses between the fins in three bands, the lantern glows between the piers; magic lights
 * sit on the slits, in the lantern bays and on the crown. Returns local heights for the caller.
 */
export function buildTower(k: ProxyKit, s: TowerSpec): { crownY: number; topY: number; shaftTop: number } {
  const [x, z] = s.at;
  const base = s.y0 - 0.05;
  // ---- the keep: a heavy battered star, no twist
  k.loft(
    'emissiveGreen',
    [
      { outline: finStar(s.r * 1.55), y: 0 },
      { outline: finStar(s.r * 1.42), y: s.keepH * 0.85 },
      { outline: finStar(s.r * 1.5), y: s.keepH * 0.92 },
      { outline: finStar(s.r * 1.3), y: s.keepH },
    ],
    { at: [x, base, z], color: TOWER_STONE, shade: 0.95, glow: { strength: TOWER_STRENGTH } },
  );
  // ---- the shaft: twisted fin sections
  const y1 = base + s.keepH;
  const n = 10;
  k.loft(
    'emissiveGreen',
    Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      return { outline: finStar(s.r), y: t * s.shaftH, rotDeg: twistAt(t), scale: scaleAt(t) };
    }),
    { at: [x, y1, z], color: TOWER_STONE, glow: { strength: TOWER_STRENGTH } },
  );
  // glowing cores in the recesses (bands of the shaft): a circle between the recess and rib radii,
  // twisted and scaled like the shaft (its edge midpoints sit on the recess vertices), so it shows only
  // as slits between the fins
  const CORE = 0.7;
  const bands: [number, number][] = [
    [0.16, 0.3],
    [0.46, 0.58],
    [0.72, 0.8],
  ];
  for (const [t0, t1] of bands) {
    const m = 3;
    k.loft(
      'emissiveGreen',
      Array.from({ length: m + 1 }, (_, i) => {
        const t = t0 + ((t1 - t0) * i) / m;
        return { outline: ring(s.r * CORE), y: t * s.shaftH, rotDeg: twistAt(t) + 11.25, scale: scaleAt(t) };
      }),
      { at: [x, y1, z], color: GLOW_CORE, glow: { strength: 0.9 } },
    );
  }
  // window lights on the slits: two per band on alternating recesses
  bands.forEach(([t0, t1], b) => {
    for (let j = 0; j < 4; j++) {
      const t = t0 + (t1 - t0) * (0.3 + 0.4 * ((j + b) % 2));
      const theta = 22.5 * (1 + 2 * ((2 * j + b * 3) % 8));
      const [px, pz] = turned(theta, twistAt(t), s.r * scaleAt(t) * CORE * 0.99 + 0.006);
      k.light([x + px, y1 + t * s.shaftH, z + pz], { color: LIGHT, intensity: 1.6, radius: 0.03, kind: 'magic' });
    }
  });
  // ---- the lantern stage: a green core, the fins running on up round it as piers
  const shaftTop = y1 + s.shaftH;
  const sc = scaleAt(1);
  const tw = twistAt(1);
  const cr = s.r * sc;
  const LH = 0.34;
  k.loft(
    'emissiveGreen',
    [
      { outline: ring(cr * 0.7), y: -0.03 },
      { outline: ring(cr * 0.7), y: LH + 0.02 },
    ],
    { at: [x, shaftTop, z], color: GLOW_LANTERN, glow: { strength: 1.8 } },
  );
  for (let j = 0; j < 16; j += 2) {
    const rr = cr * (j % 4 === 0 ? 1.02 : 0.84);
    const [ax, az] = turned(j * 22.5, tw, 1);
    const yaw = -Math.atan2(az, ax) / D2R;
    const len = rr - cr * 0.6;
    k.box('stone', len, LH, 0.04, { at: [x + ax * (cr * 0.6 + len / 2), shaftTop, z + az * (cr * 0.6 + len / 2)], rot: [0, yaw, 0], color: CROWN_STONE });
  }
  for (let j = 0; j < 8; j++) {
    const [px, pz] = turned(22.5 + 45 * j, tw, cr * 0.7 + 0.012);
    k.light([x + px, shaftTop + LH * 0.5, z + pz], { color: GLOW_LANTERN, intensity: 2, radius: 0.04, kind: 'magic' });
  }
  // ---- the crown: a flared ring over the lantern
  const crownY = shaftTop + LH;
  k.loft(
    'stone',
    [
      { outline: finStar(cr * 1.05), y: 0, rotDeg: tw },
      { outline: finStar(cr * 1.5), y: 0.13, rotDeg: tw + 4 },
      { outline: finStar(cr * 1.42), y: 0.22, rotDeg: tw + 6 },
    ],
    { at: [x, crownY, z], color: CROWN_STONE },
  );
  const rimY = crownY + 0.22;
  // jagged spikes: one per fin, leaning out, uneven (the great fins tallest)
  for (let j = 0; j < 16; j += 2) {
    const big = j % 4 === 0;
    const R = cr * 1.42 * (big ? 0.92 : 0.72);
    const [ax, az] = turned(j * 22.5, tw + 6, 1);
    const h = (big ? 0.66 : 0.36) * (0.75 + 0.5 * k.r(900 + j));
    const lean = big ? 13 : 20;
    // lean outwards: tilt the tip towards (ax, az) (Euler x tilts +y towards +z, z tilts it towards −x)
    const rot: V3 = [lean * az, 0, -lean * ax];
    k.cone('darkStone', big ? 0.075 : 0.05, h, { at: [x + ax * R, rimY - 0.05, z + az * R], rot, seg: 4, color: 0x2b3f3c });
  }
  // the central spire, faceted
  const spireH = 1.05;
  k.cone('stone', cr * 0.62, spireH, { at: [x, rimY - 0.02, z], seg: 8, rot: [0, tw, 0], color: CROWN_STONE, faceted: true });
  return { crownY: rimY, topY: rimY + spireH, shaftTop };
}
