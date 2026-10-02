import { Euler, Matrix4 } from 'three/webgpu';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { LightDecl, V2, V3 } from '../types.ts';

/**
 * The Doors of Durin (local km; heading 270: the door plane faces local −z = west). No slab stands out of
 * the cliff: a rectangular dressed patch of the cliff's own dark stone, wider than the arch, lies in the
 * plane of the terrain's rock face (fitted to the scarp around the door: it leans back LEAN km per km of
 * height and is turned YAW° to follow the face), a hair in front of it — where the rough face bulges
 * forward it swallows the patch's edge, so the doors sit in a smooth, sheer, dark face. On it: faint
 * carved pillars and arch (0.008 km relief) and the ithildin lines (glow family 'ithildin', night gate)
 * — pillars with capitals and bases, the arch and the outer line of the inscription band with a dotted
 * arc of letters, the crown with seven stars under the arch, the hammer and anvil, the two branching trees
 * along the pillars and the Star of Fëanor — fine lines 0.009–0.013 km (S4 W5), plus ONE ithildin spark at
 * the star (EmissionSystem): a single soft glow from afar.
 *
 * The ithildin paint is a dim silver whose daytime albedo (glow paint × 0.25) matches the dark stone, so
 * by day the doors are invisible, as in the tale; at night the glow (paint × strength) is as bright as
 * full-silver lines.
 *
 * Door-plane coordinates: u along the face (toward local +x, north), v up the leaning face from the sill.
 */
export const DOOR = {
  /** the face point under the doors' centre at the sill (local x, z): 0.03 km in front of the terrain face */
  at: [0, 0.193] as V2,
  /** the terrain face here (least-squares fit, residual ≤ 0.07 km): z = 0.223 + 0.154·x + 0.22·y */
  lean: 0.22,
  yawDeg: -8.8,
  /** the dressed patch: width, height above the sill, depth into the rock */
  w: 1.45,
  h: 1.5,
  d: 0.45,
  /** pillar half-spacing, pillar top, arch radius (centre line) */
  pu: 0.26,
  pv: 0.6,
  ar: 0.26,
} as const;

/** the dressed patch: the moonlit scarp's own dark blue-grey stone (S4 W5: the S3 0x575e64 read as a lighter slab) */
const FACE_ROCK = 0x464c51;
/**
 * ithildin: a cool blue-silver (daytime albedo ≈ the dark face); S4 W5 (C2 #12): fine lines at half the S3
 * width, a cooler and fainter glow — the S3 lines read as thick white neon clip-art
 */
const SILVER = 0x7c97b0;
const GLOW = { gate: 'night' as const, strength: 5, flicker: 0.02 };
/** carved relief: the face's stone, a shade lighter, this proud of the face */
const RELIEF = 0x4f565c;
const RELIEF_T = 0.008;
/** glow lines: their back this far in front of the face (over the relief), this thick (≤ 0.02 in all) */
const BACK = RELIEF_T + 0.003;
const TH = 0.008;

const DEG = Math.PI / 180;
const TILT = Math.atan(DOOR.lean);
const PSI = DOOR.yawDeg * DEG;
/** the face frame: U along it, N into the rock (horizontal), UP up the leaning face, OUT its outward normal */
const U: V3 = [Math.cos(PSI), 0, -Math.sin(PSI)];
const N: V3 = [Math.sin(PSI), 0, Math.cos(PSI)];
const UP: V3 = [Math.sin(TILT) * N[0], Math.cos(TILT), Math.sin(TILT) * N[2]];
const OUT: V3 = [-Math.cos(TILT) * N[0], Math.sin(TILT), -Math.cos(TILT) * N[2]];
/** the frame's rotation: box x → U, y → UP, z → into the rock */
const FRAME = new Matrix4().makeRotationY(PSI).multiply(new Matrix4().makeRotationX(TILT));

/** Euler XYZ degrees of FRAME · extra */
function rotOf(extra: Matrix4): V3 {
  const e = new Euler().setFromRotationMatrix(FRAME.clone().multiply(extra), 'XYZ');
  return [e.x / DEG, e.y / DEG, e.z / DEG];
}
/** in-plane turn by `deg` (CCW seen from the pool) */
const inPlane = (deg: number): V3 => rotOf(new Matrix4().makeRotationZ(deg * DEG));
/** a flat ring / extrude stood up in the plane (its +y into the rock) */
const STAND = rotOf(new Matrix4().makeRotationX(Math.PI / 2));

/** a point on the face at door-plane (u, v), `f` km in front of it; `sill` = local y of the sill line */
function onFace(u: number, v: number, f: number, sill: number): V3 {
  const [x0, z0] = DOOR.at;
  return [x0 + U[0] * u + UP[0] * v + OUT[0] * f, sill + UP[1] * v + OUT[1] * f, z0 + U[2] * u + UP[2] * v + OUT[2] * f];
}

/**
 * The ithildin's light on its surroundings (S4 W2-D, spill-only — no sprite): three soft silver sources a
 * little in front of the lines — the arch's crown and the two pillars — that light the dressed face, the
 * cliff round the doors, the sill and the pool at their foot (EmissionSystem spill, night-dim gate).
 */
const DOOR_SPILL: LightDecl[] = (
  [
    [0, 0.8],
    [-0.3, 0.35],
    [0.3, 0.35],
  ] as const
).map(([u, v]) => ({ at: onFace(u, v, 0.4, 0), color: 0xdff3ff, intensity: 5, radius: 0.25, kind: 'ithildin' as const, spillKm: 1.4, sprite: false }));

/** the single ithildin spark: the Star of Fëanor (local km; the sill is at local y ≈ 0), and the doors' spill */
export const ITHILDIN_LIGHTS: LightDecl[] = [{ at: onFace(0, 0.36, 0.03, 0), color: 0xdff3ff, intensity: 2.2, radius: 0.04, kind: 'ithildin' }, ...DOOR_SPILL];

/** The dressed patch, the carved relief and the ithildin lines; `sill` = the sill's local y. */
export function buildDoors(k: ProxyKit, sill: number): void {
  const { pu, pv, ar, w, h, d } = DOOR;
  // ---- the dressed patch in the face plane (outline (u, −v)), its foot buried below the sill: arch-topped
  // and ragged (S4 W5, C2 #12 — the S3 rectangle with hard top corners read as a poster on the cliff): the
  // sides wander up to the springing, then a ragged half-ellipse to the crown; no corners above the sill
  const foot = 0.35;
  const spring = h * 0.5;
  const rag = (i: number) => 0.035 * Math.sin(i * 2.7 + 0.6) + 0.025 * Math.sin(i * 5.3 + 1.9);
  const patch: V2[] = [
    [-w / 2, foot],
    [w / 2, foot],
  ];
  for (let i = 1; i <= 3; i++) patch.push([w / 2 + rag(i), -(spring * i) / 3]);
  const n = 16;
  for (let i = 1; i < n; i++) {
    const a = (i / n) * Math.PI;
    const rr = 1 + rag(i + 7) * 1.6;
    patch.push([(Math.cos(a) * w * rr) / 2, -(spring + Math.sin(a) * (h - spring) * rr)]);
  }
  for (let i = 3; i >= 1; i--) patch.push([-w / 2 + rag(i + 30), -(spring * i) / 3]);
  k.extrude('weathered', patch, d, { at: onFace(0, 0, 0, sill), rot: STAND, color: FACE_ROCK, grain: 0.3 });
  // ---- carved relief: pillars and the arch round the doorway (0.008 km proud of the face)
  for (const s of [-1, 1]) k.box('weathered', 0.075, pv, RELIEF_T, { at: onFace(s * pu, 0, RELIEF_T / 2, sill), rot: inPlane(0), color: RELIEF, lod: 0 });
  k.ring('weathered', ar, 0.075, RELIEF_T, { at: onFace(0, pv, RELIEF_T, sill), rot: STAND, arcDeg: 180, seg: 20, color: RELIEF, lod: 0 });
  // ---- ithildin lines
  /** a line of glow from (u, v) on the face, `len` long, turned `deg` from straight up (CCW seen from the pool) */
  const ray = (u: number, v: number, len: number, bw: number, deg = 0) =>
    k.box('ithildin', bw, len, TH, { at: onFace(u, v, BACK + TH / 2, sill), rot: inPlane(deg), color: SILVER, glow: GLOW, lod: 0 });
  // (S4 W5: every line half the S3 width, 0.009–0.013 km — fine tracery, not neon)
  // pillars, capitals and bases
  for (const s of [-1, 1]) {
    ray(s * pu, 0.04, pv - 0.04, 0.013);
    ray(s * pu, pv, 0.012, 0.1);
    ray(s * pu, 0.02, 0.011, 0.09);
  }
  // the arch and the outer line of the inscription band
  for (const [r, t] of [
    [ar, 0.013],
    [ar + 0.075, 0.01],
  ] as [number, number][])
    k.ring('ithildin', r, t, TH, { at: onFace(0, pv + 0.012, BACK + TH, sill), rot: STAND, arcDeg: 180, seg: 22, color: SILVER, glow: GLOW, lod: 0 });
  // the inscription in the band: a dotted arc of 40 short dashes along its middle (the letters at this scale)
  for (let i = 0; i < 40; i++) {
    const a = ((4 + (172 * (i + 0.5)) / 40) * Math.PI) / 180;
    const rr = ar + 0.0375;
    ray(Math.cos(a) * rr, pv + 0.012 + Math.sin(a) * rr - 0.007, 0.014 + 0.006 * ((i * 7) % 3 === 0 ? 1 : 0), 0.009, (a * 180) / Math.PI);
  }
  // the crown (a band with three points) and the seven stars in an arc under the arch
  ray(0, 0.705, 0.011, 0.075);
  for (const u of [-0.03, 0, 0.03]) ray(u, 0.725, 0.03, 0.009);
  for (let i = 0; i < 7; i++) {
    const a = ((20 + (140 * i) / 6) * Math.PI) / 180;
    ray(Math.cos(a) * 0.19, pv + 0.01 + Math.sin(a) * 0.19, 0.014, 0.014, 45);
  }
  // the hammer and anvil
  ray(0, 0.59, 0.011, 0.07);
  ray(0.01, 0.61, 0.05, 0.01, -30);
  // the two trees along the pillars: trunks, and branching boughs interlacing under the arch
  for (const s of [-1, 1]) {
    ray(s * 0.17, 0.04, 0.46, 0.011);
    ray(s * 0.17, 0.48, 0.11, 0.009, s * 40);
    ray(s * 0.17, 0.46, 0.09, 0.009, -s * 35);
    ray(s * 0.17, 0.4, 0.08, 0.009, s * 55);
    ray(s * 0.17, 0.34, 0.065, 0.009, -s * 50);
    ray(s * 0.12, 0.535, 0.07, 0.009, s * 20);
  }
  // the Star of Fëanor: eight rays round a bright centre
  for (let i = 0; i < 8; i++) ray(0, 0.36, 0.07, 0.011, i * 45);
  ray(0, 0.35, 0.02, 0.02);
}
