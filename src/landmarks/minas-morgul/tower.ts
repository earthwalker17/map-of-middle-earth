import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2 } from '../records.ts';

/** the Tower's stone: pale, ghostly grey with a faint green cast (moonlit it reads bone-white) */
export const TOWER_STONE = 0xb2b6af;
const CROWN_STONE = 0x9ca19b;
const D2R = Math.PI / 180;

/**
 * The twisted tower's section: four great fins (N/E/S/W), a lesser fin between each pair and a deep
 * recess either side of every fin — a star of 16 points, radius `r` at the great fin tips.
 */
export function finStar(r: number): V2[] {
  const pattern = [1, 0.5, 0.78, 0.5];
  return Array.from({ length: 16 }, (_, j): V2 => {
    const a = (j / 16) * Math.PI * 2;
    const rr = r * pattern[j % 4];
    return [Math.cos(a) * rr, Math.sin(a) * rr];
  });
}

/** a circle of `n` points, radius `r` (glowing cores) */
function ring(r: number, n = 16): V2[] {
  return Array.from({ length: n }, (_, j): V2 => [Math.cos((j / n) * Math.PI * 2) * r, Math.sin((j / n) * Math.PI * 2) * r]);
}

/** twist (deg) of the shaft at height fraction t ∈ [0, 1]: 120° over the shaft, faster higher up */
export function twistAt(t: number): number {
  return 120 * t * t * (1.4 - 0.4 * t);
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

/** a thin quad section (radial depth `dr`, tangential width `w`) centred at radius `r`, angle `a` (deg) */
function blade(r: number, aDeg: number, w: number, dr: number): V2[] {
  const a = aDeg * D2R;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // radial (c, s), tangential (−s, c)
  return [
    [c * (r - dr / 2) - s * (-w / 2), s * (r - dr / 2) + c * (-w / 2)],
    [c * (r + dr / 2) - s * (-w / 2), s * (r + dr / 2) + c * (-w / 2)],
    [c * (r + dr / 2) - s * (w / 2), s * (r + dr / 2) + c * (w / 2)],
    [c * (r - dr / 2) - s * (w / 2), s * (r - dr / 2) + c * (w / 2)],
  ];
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

/** corpse-light greens: the shaft slits (dim), the lamp room (the one strong light, burning always) */
const GLOW_CORE = 0x0f8a45;
const GLOW_LAMP = 0x1ee070;
const LIGHT = 0x3cf08a;

/**
 * The Tower of the Moon: a battered keep, then a pale shaft of deep fin sections twisting 120° as it
 * rises and tapering, broken by three band rings; then the lamp room — a green-burning core behind eight
 * piers that twist 40° round it — and over it the crown: eight blades sweeping 80° round the axis as they
 * rise, swelling out and then drawing in to a faceted needle, an open spiral of thorns round a second,
 * smaller lamp (nothing like Barad-dûr's fork or Orthanc's four horns). The corpse-light: dim green slits
 * between the fins (dusk gate: a quarter by day), the lamp room always, the brightest light of the city.
 * Returns local heights for the caller.
 */
export function buildTower(k: ProxyKit, s: TowerSpec): { crownY: number; topY: number; shaftTop: number } {
  const [x, z] = s.at;
  const base = s.y0 - 0.05;
  // ---- the keep: a heavy battered star, no twist
  k.loft(
    'weathered',
    [
      { outline: finStar(s.r * 1.55), y: 0 },
      { outline: finStar(s.r * 1.42), y: s.keepH * 0.85 },
      { outline: finStar(s.r * 1.5), y: s.keepH * 0.92 },
      { outline: finStar(s.r * 1.3), y: s.keepH },
    ],
    { at: [x, base, z], color: TOWER_STONE, shade: 0.92 },
  );
  // ---- the shaft: twisted fin sections
  const y1 = base + s.keepH;
  const n = 14;
  k.loft(
    'weathered',
    Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      return { outline: finStar(s.r), y: t * s.shaftH, rotDeg: twistAt(t), scale: scaleAt(t) };
    }),
    { at: [x, y1, z], color: TOWER_STONE },
  );
  // band rings breaking the shaft (a little proud of the fin tips, twisted with it)
  for (const t of [0.37, 0.64, 0.87]) {
    const dt = 0.05 / s.shaftH;
    k.loft(
      'weathered',
      [
        { outline: finStar(s.r * 1.08), y: t * s.shaftH, rotDeg: twistAt(t), scale: scaleAt(t) },
        { outline: finStar(s.r * 1.08), y: (t + dt) * s.shaftH, rotDeg: twistAt(t + dt), scale: scaleAt(t + dt) },
      ],
      { at: [x, y1, z], color: CROWN_STONE },
    );
  }
  // dim glowing cores in the recesses (two short bands of the shaft): a circle between the recess and rib
  // radii, twisted and scaled like the shaft, so it shows only as slits between the fins
  const CORE = 0.57;
  const bandsT: [number, number][] = [
    [0.47, 0.56],
    [0.74, 0.8],
  ];
  for (const [t0, t1] of bandsT) {
    const m = 3;
    k.loft(
      'emissiveGreen',
      Array.from({ length: m + 1 }, (_, i) => {
        const t = t0 + ((t1 - t0) * i) / m;
        return { outline: ring(s.r * CORE), y: t * s.shaftH, rotDeg: twistAt(t) + 11.25, scale: scaleAt(t) };
      }),
      { at: [x, y1, z], color: GLOW_CORE, glow: { strength: 0.35, gate: 'dusk' } },
    );
  }
  // ---- the lamp room: a green core behind eight piers twisting 40° round it
  const shaftTop = y1 + s.shaftH;
  const sc = scaleAt(1);
  const tw = twistAt(1);
  const cr = s.r * sc;
  const LH = 0.46;
  // its floor: a flared ring
  k.loft(
    'weathered',
    [
      { outline: finStar(cr * 1.02), y: -0.02, rotDeg: tw },
      { outline: finStar(cr * 1.3), y: 0.08, rotDeg: tw + 3 },
    ],
    { at: [x, shaftTop, z], color: CROWN_STONE },
  );
  k.loft(
    'emissiveGreen',
    [
      { outline: ring(cr * 0.78), y: 0.05 },
      { outline: ring(cr * 0.82), y: LH + 0.04 },
    ],
    { at: [x, shaftTop, z], color: GLOW_LAMP, glow: { strength: 1.1 } },
  );
  const PIERS = 8;
  for (let j = 0; j < PIERS; j++) {
    const a0 = (j / PIERS) * 360 + tw;
    k.loft(
      'weathered',
      [0, 0.25, 0.5, 0.75, 1].map((t) => ({ outline: blade(cr * 1.0, a0 + 40 * t, 0.07 * (1 - 0.25 * Math.sin(Math.PI * t)), 0.07), y: 0.08 + t * (LH - 0.08) })),
      { at: [x, shaftTop, z], color: TOWER_STONE, lod: 1 },
    );
  }
  // magic lights in the lamp room (always on): the one strong accent
  for (let j = 0; j < 4; j++) {
    const [px, pz] = turned(45 + 90 * j, -tw, cr * 0.84);
    k.light([x + px, shaftTop + LH * 0.55, z + pz], { color: LIGHT, intensity: 1.0, radius: 0.04, kind: 'magic' });
  }
  // ---- the crown: a cap ring over the lamp room, then eight twisted blades and a faceted needle
  const capY = shaftTop + LH;
  k.loft(
    'weathered',
    [
      { outline: finStar(cr * 1.05), y: 0, rotDeg: tw + 40 },
      { outline: finStar(cr * 1.45), y: 0.1, rotDeg: tw + 44 },
      { outline: finStar(cr * 1.3), y: 0.16, rotDeg: tw + 46 },
    ],
    { at: [x, capY, z], color: CROWN_STONE },
  );
  const crownY = capY + 0.14;
  const CH = 1.35;
  const BL = 8;
  for (let j = 0; j < BL; j++) {
    const a0 = (j / BL) * 360 + tw + 44;
    const big = j % 2 === 0;
    const h = CH * (big ? 1 : 0.78);
    const secs = Array.from({ length: 8 }, (_, i) => {
      const t = i / 7;
      // swell out, then draw in to the axis: an open, flame-like spiral
      const r = cr * 1.3 * (1 + 0.38 * Math.sin(Math.PI * Math.min(1, t * 1.25))) * (1 - 0.92 * t ** 1.6);
      const w = (big ? 0.11 : 0.08) * (1 - 0.85 * t) + 0.008;
      return { outline: blade(r, a0 + 80 * t, w, 0.045 * (1 - 0.6 * t) + 0.01), y: t * h };
    });
    k.loft('weathered', secs, { at: [x, crownY, z], color: big ? TOWER_STONE : CROWN_STONE, lod: big ? 1 : 0 });
  }
  // the second lamp inside the crown and the needle rising out of it
  k.cone('emissiveGreen', cr * 0.45, CH * 0.5, { at: [x, crownY, z], seg: 8, color: GLOW_LAMP, glow: { strength: 0.9 } });
  const spireH = 1.1;
  k.cone('weathered', cr * 0.3, spireH + CH * 0.5, { at: [x, crownY + CH * 0.35, z], seg: 6, rot: [0, tw, 0], color: TOWER_STONE, faceted: true });
  k.light([x, crownY + CH * 0.3, z], { color: LIGHT, intensity: 0.8, radius: 0.05, kind: 'magic' });
  return { crownY, topY: crownY + CH * 0.35 + spireH + CH * 0.5, shaftTop };
}
