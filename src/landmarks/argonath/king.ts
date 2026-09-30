import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';

/**
 * One king of the Argonath, TS kit v2 (the fallback of the Blender spike — tools/blender/argonath.py
 * builds the same figure from the same proportions; keep KING in sync with its `KING` table).
 *
 * King frame: origin = the pedestal axis at the nominal waterline, x to the king's right (east when he
 * faces north), y up, facing −z (the landmark heading: upstream). He raises his LEFT hand (−x) palm
 * outward in warning; the right hand grips a long axe before his chest. Variants: 'crown' (bearded, a
 * tall, narrow helm-crown, the film's west king) and 'helm' (a full helm with a face guard and a tall crest).
 * Parts are sized for the landmark's LOD rule: coarse cores (lod 2) sit inside the fluted LOD0 shells.
 */
export const KING = {
  /** pedestal: buried foot, top above the waterline, footprint (x × z), km */
  pedFoot: -2.0,
  pedTop: 1.6,
  pedW: 2.1,
  pedD: 1.55,
  /** figure height above the pedestal top (helm top), km */
  figH: 4.44,
  shoulderY: 3.5,
  shoulderX: 0.52,
  headY: 4.12,
  headR: 0.2,
  /** raised left arm: shoulder → elbow → wrist, hand length */
  leftElbow: [-0.8, 4.3, -0.1] as V3,
  leftWrist: [-0.86, 5.1, -0.18] as V3,
  /** right arm: elbow, fist before the chest; the axe haft runs through the fist */
  rightElbow: [0.64, 2.72, 0.02] as V3,
  rightFist: [0.28, 2.95, -0.4] as V3,
  axe: { bottom: 0.2, top: 3.95, r: 0.036 },
} as const;

/** robe / torso sections: y above the pedestal top, half width, half depth (front), extra depth behind (cloak), fold amplitude */
const ROBE: [number, number, number, number, number][] = [
  [0.0, 0.7, 0.44, 0.22, 0.075],
  [0.14, 0.68, 0.43, 0.21, 0.075],
  [0.7, 0.62, 0.39, 0.18, 0.068],
  [1.4, 0.55, 0.35, 0.14, 0.058],
  [2.05, 0.48, 0.31, 0.1, 0.045],
  [2.5, 0.43, 0.28, 0.08, 0.03],
  [2.9, 0.48, 0.3, 0.07, 0.022],
  [3.3, 0.55, 0.31, 0.06, 0.014],
  [3.55, 0.6, 0.28, 0.05, 0.008],
  [3.72, 0.34, 0.2, 0.02, 0.0],
];

const RAD = 180 / Math.PI;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Euler angles (deg, XYZ as the kit uses them) that turn +y onto the direction a → b. */
export function aimRot(a: V3, b: V3): V3 {
  const d = sub(b, a);
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [Math.atan2(d[2] / l, d[1] / l) * RAD, 0, -Math.asin(Math.max(-1, Math.min(1, d[0] / l))) * RAD];
}

/** the fold wave round the robe (vertical flutes; the same phase at every height) */
const foldWave = (t: number): number => 0.62 * Math.cos(17 * t + 0.4) + 0.28 * Math.cos(29 * t + 1.9) + 0.1 * Math.cos(7 * t);

/** one robe ring: an egg-shaped ellipse (deeper behind: the cloak) with vertical folds */
function robeRing(n: number, hw: number, hd: number, back: number, amp: number, inset = 1): V2[] {
  const out: V2[] = [];
  for (let j = 0; j < n; j++) {
    const t = (j / n) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const depth = s > 0 ? hd + back * s : hd;
    const f = (1 + amp * foldWave(t)) * inset;
    out.push([hw * c * f, depth * s * f]);
  }
  return out;
}

/** interpolated robe section at figure height y */
function robeAt(y: number): { hw: number; hd: number } {
  for (let k = 0; k + 1 < ROBE.length; k++) {
    const a = ROBE[k];
    const b = ROBE[k + 1];
    if (y <= b[0]) {
      const t = Math.max(0, (y - a[0]) / (b[0] - a[0]));
      return { hw: a[1] + (b[1] - a[1]) * t, hd: a[2] + (b[2] - a[2]) * t };
    }
  }
  const l = ROBE[ROBE.length - 1];
  return { hw: l[1], hd: l[2] };
}

export interface KingOpts {
  /** local position of the king frame origin (pedestal axis at the waterline) */
  at: V3;
  variant: 'crown' | 'helm';
  /** statue paint (sRGB) */
  stone: number;
  /** pedestal paint (sRGB) */
  plinth: number;
}

/** Build one king (pedestal + figure) into the kit. */
export function kingTS(k: ProxyKit, o: KingOpts): void {
  const [bx, by, bz] = o.at;
  const S = o.stone;
  /** figure frame (origin on the pedestal top) → landmark local */
  const F = (p: V3): V3 => [bx + p[0], by + KING.pedTop + p[1], bz + p[2]];
  const bone = (a: V3, b: V3, r0: number, r1: number, seg: number, lod: 0 | 1 | 2, shade = 1) => {
    const d = sub(b, a);
    const len = Math.hypot(d[0], d[1], d[2]);
    k.cylinder('weathered', r1, r0, len, { at: F(a), rot: aimRot(a, b), seg, color: S, shade, lod });
  };

  // ---- pedestal: a battered block (buried foot) with a moulded top step, rough rocks at the waterline
  const pw = KING.pedW / 2;
  const pd = KING.pedD / 2;
  const ch = 0.22;
  const block: V2[] = [
    [-pw + ch, -pd],
    [pw - ch, -pd],
    [pw, -pd + ch],
    [pw, pd - ch],
    [pw - ch, pd],
    [-pw + ch, pd],
    [-pw, pd - ch],
    [-pw, -pd + ch],
  ];
  const pedH = KING.pedTop - 0.16 - KING.pedFoot;
  k.extrude('weathered', block, pedH, { at: [bx, by + KING.pedFoot, bz], taper: 0.1, color: o.plinth, lod: 2 });
  k.extrude('weathered', block.map(([x, z]) => [x * 0.86, z * 0.86] as V2), 0.16, { at: [bx, by + KING.pedTop - 0.16, bz], taper: 0.05, color: o.plinth, shade: 1.08, lod: 1 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.4 + k.r() * 0.5;
    const rr = 0.18 + 0.16 * k.r();
    k.rock('weathered', rr, { at: [bx + Math.cos(a) * (pw + 0.05), by + 0.02, bz + Math.sin(a) * (pd + 0.05)], squash: 0.7, color: o.plinth, shade: 0.9, lod: 0, detail: 1 });
  }

  // ---- robe: a fluted LOD0 shell round a smooth coarse core (LOD1/2 silhouette)
  const ring = (n: number, inset: number, amp: boolean) =>
    ROBE.map(([y, hw, hd, back, a]) => ({ outline: robeRing(n, hw, hd, back, amp ? a : 0, inset), y }));
  k.loft('weathered', ring(96, 1, true), { at: F([0, 0, 0]), color: S, lod: 0 });
  k.loft('weathered', ring(18, 0.93, false), { at: F([0, 0.01, 0]), color: S, lod: 2 });
  // belt and a hanging girdle end
  const waist = robeAt(2.5);
  k.loft('weathered', [
    { outline: robeRing(48, waist.hw, waist.hd, 0.08, 0, 1.06), y: 0 },
    { outline: robeRing(48, waist.hw, waist.hd, 0.08, 0, 1.06), y: 0.1 },
  ], { at: F([0, 2.44, 0]), color: S, shade: 0.9, lod: 0 });
  bone([0.06, 2.46, -0.29], [0.1, 1.2, -0.4], 0.045, 0.035, 8, 0, 0.92);
  // cloak edges down the front: two raised hems from the collar to the ground
  for (const sx of [-1, 1]) {
    const pts: V3[] = [];
    for (const y of [3.45, 2.9, 2.2, 1.4, 0.7, 0.05]) {
      const r = robeAt(y);
      const x = sx * (0.2 + (3.45 - y) * 0.05);
      pts.push([x, y, -r.hd * Math.sqrt(Math.max(0, 1 - (x / r.hw) ** 2)) * 1.02]);
    }
    for (let i = 0; i + 1 < pts.length; i++) bone(pts[i], pts[i + 1], 0.045, 0.045, 10, 0);
  }

  // ---- shoulders, neck, head
  for (const sx of [-1, 1]) k.sphere('weathered', 0.2, { at: F([sx * KING.shoulderX, KING.shoulderY + 0.02, 0.0]), squash: 0.85, color: S, lod: 1 });
  k.cylinder('weathered', 0.13, 0.16, 0.4, { at: F([0, 3.6, 0.0]), seg: 16, color: S, lod: 1 });
  // the cloak's collar round the neck
  k.lathe('weathered', [
    [0.15, 0],
    [0.3, 0],
    [0.25, 0.12],
    [0.16, 0.14],
    [0.15, 0],
  ], { at: F([0, 3.62, 0.02]), seg: 24, color: S, shade: 0.97, lod: 0 });
  k.sphere('weathered', KING.headR, { at: F([0, KING.headY, -0.02]), squash: 1.22, color: S, lod: 2 });
  // brow and nose (LOD0 only)
  k.cone('weathered', 0.04, 0.11, { at: F([0, 4.06, -0.2]), rot: [-72, 0, 0], seg: 6, color: S, lod: 0 });

  // ---- helm (lathe) and variant dressing
  const helm: V2[] = [
    [0.226, 0],
    [0.236, 0.03],
    [0.224, 0.06],
    [0.216, 0.16],
    [0.182, 0.26],
    [0.1, 0.325],
    [0, 0.34],
  ];
  if (o.variant === 'crown') {
    // a tall, narrow ogival helm-crown (≈ 1.6× the head's height, as the GLB's CROWN_HELM) with a low diadem
    // at the brow and short upright crenels — never a ring of splayed spikes; a long beard over the chest
    const tall: V2[] = [
      [0.232, 0],
      [0.238, 0.03],
      [0.229, 0.1],
      [0.213, 0.18],
      [0.188, 0.27],
      [0.155, 0.36],
      [0.116, 0.45],
      [0.074, 0.53],
      [0.036, 0.59],
      [0, 0.636],
    ];
    k.lathe('weathered', tall, { at: F([0, 4.1, -0.02]), seg: 24, color: S, shade: 1.05, lod: 1 });
    k.lathe('weathered', [
      [0.22, 0],
      [0.258, 0],
      [0.258, 0.1],
      [0.25, 0.125],
      [0.22, 0.125],
    ], { at: F([0, 4.1, -0.02]), seg: 24, color: S, shade: 1.08, lod: 0 });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      const h = i === 0 ? 0.085 : 0.05 + 0.012 * (i % 2);
      k.cone('weathered', 0.022, h, { at: F([Math.cos(a) * 0.245, 4.22, -0.02 + Math.sin(a) * 0.245]), seg: 5, color: S, shade: 1.08, lod: 0 });
    }
    const chin: V3 = [0, 3.97, -0.15];
    const tip: V3 = [0, 3.2, -0.33];
    const d = sub(chin, tip);
    const len = Math.hypot(d[0], d[1], d[2]);
    k.cone('weathered', 0.17, len, { at: F(chin), rot: aimRot(chin, tip), seg: 14, color: S, shade: 0.96, lod: 1 });
    for (const sx of [-1, 1]) {
      const a: V3 = [sx * 0.11, 3.95, -0.12];
      const b: V3 = [sx * 0.08, 3.35, -0.3];
      k.cone('weathered', 0.07, Math.hypot(...sub(b, a)), { at: F(a), rot: aimRot(a, b), seg: 8, color: S, shade: 0.92, lod: 0 });
    }
  } else {
    k.lathe('weathered', helm, { at: F([0, 4.1, -0.02]), seg: 24, color: S, shade: 1.05, lod: 1 });
    // face guard with a nose bar, cheek plates, a tall crest and two swept wings
    k.box('weathered', 0.25, 0.3, 0.05, { at: F([0, 3.88, -0.2]), color: S, shade: 1.02, lod: 0 });
    k.box('weathered', 0.035, 0.26, 0.04, { at: F([0, 3.92, -0.235]), color: S, shade: 1.1, lod: 0 });
    for (const sx of [-1, 1]) k.box('weathered', 0.05, 0.26, 0.2, { at: F([sx * 0.2, 3.87, -0.06]), rot: [0, sx * 18, 0], color: S, lod: 0 });
    // crest fin over the helm, sweeping back: outline (z, y) extruded across x (rot z +90: extrude
    // (ox, t, oz) → (−t, ox, oz), so the outline goes in as (y, z) and the fin spans x −0.025…0.025)
    const crest: V2[] = [
      [-0.16, 0.02],
      [-0.06, 0.24],
      [0.12, 0.34],
      [0.34, 0.26],
      [0.5, 0.06],
      [0.3, -0.02],
      [0.0, -0.02],
    ];
    k.extrude('weathered', crest.map(([z, y]) => [y, z] as V2), 0.05, { at: F([0.025, 4.3, -0.02]), rot: [0, 0, 90], color: S, shade: 1.06, lod: 0 });
    for (const sx of [-1, 1]) {
      const a: V3 = [sx * 0.2, 4.2, 0.0];
      const b: V3 = [sx * 0.38, 4.62, 0.08];
      k.cone('weathered', 0.05, Math.hypot(...sub(b, a)), { at: F(a), rot: aimRot(a, b), seg: 6, color: S, shade: 1.06, lod: 0 });
    }
  }

  // ---- the raised LEFT arm: sleeve-clad upper arm, bare forearm, open palm facing upstream
  const sh: V3 = [-KING.shoulderX, KING.shoulderY, 0];
  bone(sh, KING.leftElbow, 0.19, 0.15, 14, 2);
  k.sphere('weathered', 0.13, { at: F(KING.leftElbow), color: S, lod: 1 });
  bone(KING.leftElbow, KING.leftWrist, 0.12, 0.085, 12, 2);
  // the sleeve falls from the upper arm to the pedestal: a fluted drape on the outer side
  const drape: [number, number, number, number][] = [
    // y, centre x, half width, half depth
    [0.02, -0.66, 0.26, 0.28],
    [1.0, -0.66, 0.25, 0.26],
    [2.2, -0.66, 0.22, 0.22],
    [3.2, -0.68, 0.19, 0.18],
    [3.9, -0.74, 0.14, 0.14],
    [4.28, -0.79, 0.1, 0.11],
  ];
  k.loft(
    'weathered',
    drape.map(([y, cx, hw, hd]) => ({ outline: robeRing(40, hw, hd, 0.02, 0.06).map(([x, z]) => [x + cx, z + 0.02] as V2), y })),
    { at: F([0, 0, 0]), color: S, shade: 0.97, lod: 1 },
  );
  // open hand: palm with four fingers and the thumb towards the body, palm facing −z
  const hand: V2[] = [
    [-0.1, 0],
    [0.1, 0],
    [0.11, 0.08],
    [0.17, 0.13],
    [0.2, 0.21],
    [0.18, 0.235],
    [0.13, 0.19],
    [0.105, 0.22],
    [0.1, 0.43],
    [0.078, 0.448],
    [0.056, 0.43],
    [0.052, 0.3],
    [0.048, 0.46],
    [0.024, 0.478],
    [0.0, 0.46],
    [-0.004, 0.3],
    [-0.008, 0.45],
    [-0.032, 0.468],
    [-0.054, 0.45],
    [-0.058, 0.3],
    [-0.062, 0.41],
    [-0.084, 0.426],
    [-0.106, 0.405],
    [-0.108, 0.24],
  ];
  // extrude lies in (x, z); rot x +90 stands it up: outline (u, v) → (u, −v) in x-y, thickness along +z
  const lean = aimRot(KING.leftElbow, KING.leftWrist);
  k.extrude(
    'weathered',
    hand.map(([u, v]) => [u, -v] as V2),
    0.075,
    { at: F([KING.leftWrist[0] + 0.005, KING.leftWrist[1] - 0.04, KING.leftWrist[2] - 0.035]), rot: [90 + lean[0], 0, 0], color: S, shade: 1.04, lod: 1 },
  );

  // ---- the right arm: elbow at the side, the fist before the chest round a long axe
  const shr: V3 = [KING.shoulderX, KING.shoulderY, 0];
  bone(shr, KING.rightElbow, 0.19, 0.16, 14, 2);
  k.sphere('weathered', 0.13, { at: F(KING.rightElbow), color: S, lod: 1 });
  bone(KING.rightElbow, KING.rightFist, 0.13, 0.1, 12, 1);
  k.rock('weathered', 0.12, { at: F(KING.rightFist), squash: 1.1, color: S, lod: 1, detail: 1, lump: 0.12 });
  const fx = KING.rightFist[0];
  const fz = KING.rightFist[2] - 0.02;
  k.cylinder('weathered', KING.axe.r * 0.85, KING.axe.r, KING.axe.top - KING.axe.bottom, { at: F([fx, KING.axe.bottom, fz]), seg: 8, faceted: false, color: S, shade: 0.95, lod: 1 });
  // axe head: a crescent blade to the outside (+x) and a short back spike; lies in the x-y plane
  const blade: V2[] = [
    [0.0, 3.34],
    [0.14, 3.3],
    [0.3, 3.22],
    [0.36, 3.42],
    [0.37, 3.62],
    [0.32, 3.82],
    [0.15, 3.76],
    [0.0, 3.72],
    [-0.12, 3.56],
    [-0.02, 3.5],
  ];
  k.extrude('weathered', blade.map(([u, v]) => [u, -v] as V2), 0.04, { at: F([fx, 0, fz - 0.02]), rot: [90, 0, 0], color: S, shade: 1.05, lod: 1 });
  k.cone('weathered', 0.05, 0.16, { at: F([fx, KING.axe.top, fz]), seg: 6, color: S, lod: 0 });
  void lerp3;
}
