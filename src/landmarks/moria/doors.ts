import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { LightDecl, V3 } from '../types.ts';

/**
 * The Doors of Durin (local km; heading 270: the door plane faces local −z = west). A smooth dressed
 * panel stands proud of the rough cliff face; carved pillars and arch in faint relief; ithildin lines
 * (glow family 'ithildin', night gate) on its face — pillars with capitals and bases, the arch and the
 * outer line of the inscription band, the crown with seven stars under the arch, the hammer and anvil,
 * the two trees along the pillars and the Star of Fëanor in the middle — simplified to lines ≥ 0.02 km
 * (≥ 2.4 px at the 12 km hero distance), plus five ithildin sparks (EmissionSystem, kind 'ithildin').
 *
 * Door-plane coordinates: u along local x (the door's width), v up from the sill.
 */
export const DOOR = {
  /** centre of the doorway along local x */
  x: 0,
  /** front face of the door wall (local z) */
  z: 0.03,
  /** door wall: width, height (to the crown of its arched head), depth into the cliff, km */
  w: 1.1,
  h: 1.35,
  d: 0.5,
  /** pillar half-spacing, pillar top, arch radius (centre line) */
  pu: 0.26,
  pv: 0.6,
  ar: 0.26,
} as const;

/** ithildin silver (research §6: faint silver #dff3ff) */
const SILVER = 0xdff3ff;
/** glow slabs sit this far in front of the wall face, this thick */
const OFF = 0.004;
const TH = 0.01;

/** the five ithildin sparks: the star, the keystone, the crown, the capitals (local km) */
export const ITHILDIN_LIGHTS: LightDecl[] = (
  [
    [0, 0.36, 2.4],
    [0, DOOR.pv + DOOR.ar + 0.02, 1.4],
    [0, 0.73, 1.0],
    [DOOR.pu, DOOR.pv, 0.8],
    [-DOOR.pu, DOOR.pv, 0.8],
  ] as [number, number, number][]
).map(([u, v, i]) => ({ at: [DOOR.x + u, v, DOOR.z - 0.02] as V3, color: SILVER, intensity: i, radius: 0.05, kind: 'ithildin' as const }));

/** The door wall and its ithildin; `level` = the pool's water level (local y): the sill stays above it. */
export function buildDoors(k: ProxyKit, wall: number, level: number): void {
  const { x: X, z: Z, w, h, d, pu, pv, ar } = DOOR;
  // the sill (every part below is placed relative to it; the light records assume it at local y ≈ 0)
  const y0 = Math.max(k.ground(X, Z), level + 0.08) - 0.02;
  // the door wall: a smooth dressed face of the cliff's stone with a round-arched head, standing a little
  // proud of the rough face; an outline in the door plane (u, −v) extruded `d` into the cliff (rot 90° about
  // x: outline z → −y, extrusion → +z), its foot buried 0.3 below the sill
  const hw = w / 2;
  const vs = h - hw;
  const panel: [number, number][] = [
    [-hw, 0.3],
    [hw, 0.3],
    [hw, -vs],
  ];
  for (let i = 1; i < 12; i++) {
    const a = (i / 12) * Math.PI;
    panel.push([Math.cos(a) * hw, -(vs + Math.sin(a) * hw)]);
  }
  panel.push([-hw, -vs]);
  k.extrude('weathered', panel, d, { at: [X, y0, Z], rot: [90, 0, 0], color: wall, grain: 0.12 });
  const zf = Z - OFF - TH;
  // ---- carved relief (stone, a little lighter than the wall): pillars and the arch round the doorway
  for (const s of [-1, 1]) k.box('weathered', 0.075, pv, 0.014, { at: [X + s * pu, y0, Z - 0.012], color: 0x66706f, lod: 0 });
  k.ring('weathered', ar, 0.075, 0.014, { at: [X, y0 + pv, Z - 0.012], rot: [90, 0, 0], arcDeg: 180, seg: 20, color: 0x66706f, lod: 0 });
  // ---- ithildin lines
  const glow = { gate: 'night' as const, strength: 2.2, flicker: 0.02 };
  /** a line of glow from (u, v) in the door plane, `len` long, rotated `deg` from straight up (CCW seen from the west) */
  const ray = (u: number, v: number, len: number, bw: number, deg = 0) =>
    k.box('ithildin', bw, len, TH, { at: [X + u, y0 + v, zf], rot: [0, 0, deg], color: SILVER, glow, lod: 0 });
  // pillars, capitals and bases
  for (const s of [-1, 1]) {
    ray(s * pu, 0.04, pv - 0.04, 0.026);
    ray(s * pu, pv, 0.024, 0.1);
    ray(s * pu, 0.02, 0.022, 0.09);
  }
  // the arch and the outer line of the inscription band
  for (const [r, t] of [
    [ar, 0.026],
    [ar + 0.075, 0.02],
  ] as [number, number][])
    k.ring('ithildin', r, t, TH, { at: [X, y0 + pv + 0.012, zf], rot: [90, 0, 0], arcDeg: 180, seg: 22, color: SILVER, glow, lod: 0 });
  // the crown (a band with three points) and the seven stars in an arc under the arch
  ray(0, 0.705, 0.02, 0.075);
  for (const u of [-0.03, 0, 0.03]) ray(u, 0.725, 0.032, 0.016);
  for (let i = 0; i < 7; i++) {
    const a = ((20 + (140 * i) / 6) * Math.PI) / 180;
    ray(Math.cos(a) * 0.19, pv + 0.01 + Math.sin(a) * 0.19, 0.022, 0.022, 45);
  }
  // the hammer and anvil
  ray(0, 0.59, 0.022, 0.07);
  ray(0.01, 0.61, 0.05, 0.02, -30);
  // the two trees along the pillars: trunks, and boughs meeting under the arch
  for (const s of [-1, 1]) {
    ray(s * 0.17, 0.04, 0.46, 0.018);
    ray(s * 0.17, 0.48, 0.11, 0.018, s * 40);
    ray(s * 0.17, 0.46, 0.09, 0.018, -s * 35);
  }
  // the Star of Fëanor: eight rays round a bright centre
  for (let i = 0; i < 8; i++) ray(0, 0.36, 0.075, 0.022, i * 45);
  ray(0, 0.343, 0.034, 0.034);
}
