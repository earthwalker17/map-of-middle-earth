import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';
import type { LocalStamp } from '../types.ts';

/**
 * The Front Gate of Erebor (research §13; the Weta "Front Gate" miniature, the Desolation of Smaug
 * still): a tall carved façade of cold green-grey dwarf stone let into the sheer southern foot of the
 * mountain at the head of the gate valley, flanked by two colossal dwarf kings carved in half-relief
 * out of the rock walls either side, a dressed terrace before it from whose front the River Running
 * issues, braziers burning at dusk; prologue gold (#8c713f) on the pilaster edges, the gable and the
 * door arch.
 *
 * The terrain is the recess: the mountain's foot rises ≈ 10 units per km here (sheer at the heightfield's
 * 0.4 km resolution); three lowerOnly flattens (GATE_STAMPS) cut a level court for the façade and the
 * two kings into it, kept small so the cut fades into the face instead of slotting it. The kings' backs
 * are let into kit rock walls (`cliff`) that close the recess either side of the façade.
 *
 * Gate frame (u, w): u along the façade, w out of it (≈ south-south-west, bearing FACE); y up. The river
 * source (the baked River Running starts at the display point) lies on the gate axis 1.0 km in front of
 * the façade, at the foot of the terrace.
 */
export const FACE = 195;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
/** kit yaw of a part whose local +z looks along the gate axis */
export const YAW = -(FACE - 180);
const N: V2 = [Math.sin(FACE * DEG), -Math.cos(FACE * DEG)];
const U: V2 = [-N[1], N[0]];
/** gate centre (the door sill), local km */
export const GC: V2 = [0.29, -1.0];
/** gate frame → local x, z */
export const G = (u: number, w: number): V2 => [GC[0] + U[0] * u + N[0] * w, GC[1] + U[1] * u + N[1] * w];
/** court floor height above the ground at the display point (the river source) */
export const COURT = 0.35;
/** the kings stand at ±KING_U along the façade, their centre line at KING_W */
const KING_U = 1.64;
const KING_W = 0.08;

/**
 * The court cut into the mountain's foot: the façade's bay and the two kings' bays (lowerOnly: never
 * raises). Small radii with long falloffs: the cut is level where the terrace and the plinths stand and
 * fades into the face behind them (a full-radius cut left a dark slot up the south face).
 */
export const GATE_STAMPS: LocalStamp[] = [
  // the terrace and the façade's front: a row of three cuts, level from u ±1.0 to one texel behind the
  // façade's face (w −0.1; the 0.4 km heightfield ramps over a texel) and out to the river, fading out by
  // w ≈ −0.7
  ...[-0.7, 0, 0.7].map((u): LocalStamp => ({ kind: 'flatten', at: G(u, 0.2), radius: 0.6, falloff: 0.3, height: COURT, lowerOnly: true, surface: 'rock' })),
  { kind: 'flatten', at: G(-KING_U, 0.15), radius: 0.5, falloff: 0.3, height: COURT + 0.05, lowerOnly: true, surface: 'rock' },
  { kind: 'flatten', at: G(KING_U, 0.15), radius: 0.5, falloff: 0.3, height: COURT + 0.05, lowerOnly: true, surface: 'rock' },
];

/** cold grey-green dwarf stone (DoS: #707773 / #899995), the darker carved recesses, prologue gold */
const STONE = 0x707773;
const STONE_LIGHT = 0x899995;
/** the kings: carved from the same dark green-grey stone as the rock round them */
const KING = 0x6a706c;
const KING_ROCK = 0x5f6561;
const RECESS = 0x2f3732;
const DOOR = 0x101311;
const GOLD = 0x8c713f;

/** n-sided section outline of half-width hw (u) and half-depth hd (w), centred */
function ngon(n: number, hw: number, hd: number): V2[] {
  const out: V2[] = [];
  for (let k = 0; k < n; k++) {
    const a = ((k + 0.5) / n) * Math.PI * 2;
    out.push([Math.cos(a) * hw, Math.sin(a) * hd]);
  }
  return out;
}
/** thin rectangle section (blades, fins) */
function rect(hw: number, hd: number): V2[] {
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
}

/** Euler angles (deg, XYZ as the kit uses them) that turn +y onto the direction a → b. */
function aimRot(a: V3, b: V3): V3 {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [Math.atan2(d[2] / l, d[1] / l) * RAD, 0, -Math.asin(Math.max(-1, Math.min(1, d[0] / l))) * RAD];
}

/** gate frame (u, y, w) → local km */
function at(u: number, y: number, w: number): V3 {
  const [x, z] = G(u, w);
  return [x, y, z];
}

/** the armoured body of a king: (y above the plinth, half-width, half-depth) */
const BODY: [number, number, number][] = [
  [0, 0.47, 0.36],
  [0.25, 0.45, 0.34],
  [0.55, 0.41, 0.31],
  [0.92, 0.36, 0.27],
  [0.96, 0.39, 0.29],
  [1.06, 0.39, 0.29],
  [1.1, 0.35, 0.26],
  [1.45, 0.4, 0.28],
  [1.72, 0.46, 0.28],
  [1.84, 0.4, 0.24],
  [1.9, 0.2, 0.17],
];
const bodyAt = (y: number): [number, number] => {
  for (let i = 0; i + 1 < BODY.length; i++) {
    const a = BODY[i];
    const b = BODY[i + 1];
    if (y <= b[0]) {
      const t = Math.max(0, (y - a[0]) / (b[0] - a[0]));
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
  }
  return [BODY[BODY.length - 1][1], BODY[BODY.length - 1][2]];
};

/** king figure scale: the kings stand nearly as tall as the façade */
const SC = 1.2;

/**
 * One colossal king carved in half-relief: a dwarf lord in lamellar armour, a broad dwarf helm with
 * cheek guards and a crest, a long broad beard over the chest, both hands on the haft of a double-bitted
 * axe with curved bits standing beside him on the `axeSide` (+1 = +u). Statue frame: origin at
 * (u0, base, w0), +y up, facing +w. ≈ 3.2 km over the plinth step — a feature of the mountain's face
 * from 50 km. Same dark stone as the rock wall it is cut from (plaster family: smooth, no coursing).
 */
function statue(k: ProxyKit, u0: number, w0: number, base: number, axeSide: number): void {
  const P = (x: number, y: number, z: number): V3 => at(u0 + x * SC, base + y * SC, w0 + z * SC);
  const rot: V3 = [0, YAW, 0];
  const S = KING;
  const sc = (q: [number, number, number][]) => q.map(([y, hw, hd]) => [y, hw * SC, hd * SC] as [number, number, number]);
  // plinth: a deep block let into the court (its foot buried), a moulded top step
  k.box('stone', 1.2 * SC, 1.22, 1.0 * SC, { at: P(0, -1.2 / SC, 0), rot, color: STONE, shade: 0.92, lod: 2 });
  k.box('stone', 1.08 * SC, 0.1 * SC, 0.9 * SC, { at: P(0, 0.02, 0), rot, color: STONE, shade: 0.98, lod: 1 });
  const y0 = 0.12;
  // the body: a smooth 16-sided shell at LOD0 round a coarse octagonal core kept for the far LODs
  const body = sc(BODY);
  k.loft('plaster', body.map(([y, hw, hd]) => ({ outline: ngon(16, hw, hd), y: y * SC })), { at: P(0, y0, 0), rot, color: S, lod: 0 });
  k.loft('plaster', body.map(([y, hw, hd]) => ({ outline: ngon(8, hw * 0.96, hd * 0.96), y: y * SC })), { at: P(0, y0, 0), rot, color: S, lod: 2 });
  // lamellar armour: low tiers of plates round the skirt and the chest, a few percent of tonal change
  for (let t = 0; t < 8; t++) {
    const y = 0.06 + t * 0.12;
    if (y > 0.86 && y < 1.1) continue;
    const [hw, hd] = bodyAt(y + 0.06);
    k.loft(
      'plaster',
      [
        { outline: ngon(16, (hw + 0.016) * SC, (hd + 0.016) * SC), y: 0 },
        { outline: ngon(16, (hw + 0.004) * SC, (hd + 0.004) * SC), y: 0.1 * SC },
      ],
      { at: P(0, y0 + y, 0), rot, color: S, shade: t % 2 ? 0.97 : 1.0, lod: 0 },
    );
  }
  for (let t = 0; t < 4; t++) {
    const y = 1.14 + t * 0.13;
    const [hw, hd] = bodyAt(y + 0.06);
    k.loft(
      'plaster',
      [
        { outline: ngon(16, (hw + 0.014) * SC, (hd + 0.014) * SC), y: 0 },
        { outline: ngon(16, (hw + 0.004) * SC, (hd + 0.004) * SC), y: 0.11 * SC },
      ],
      { at: P(0, y0 + y, 0), rot, color: S, shade: t % 2 ? 0.97 : 1.0, lod: 0 },
    );
  }
  // a broad belt with a square buckle plate
  k.loft('plaster', [{ outline: ngon(16, 0.4 * SC, 0.3 * SC), y: 0 }, { outline: ngon(16, 0.4 * SC, 0.3 * SC), y: 0.1 * SC }], { at: P(0, y0 + 0.95, 0), rot, color: S, shade: 0.94, lod: 1 });
  k.box('plaster', 0.16 * SC, 0.13 * SC, 0.04 * SC, { at: P(0, y0 + 0.935, 0.29), rot, color: S, shade: 1.04, lod: 0 });
  // pauldrons: squat faceted caps over two lames each (no ball shoulders)
  for (const s of [-1, 1]) {
    for (const [dy, sz] of [
      [-0.12, 1.0],
      [0, 0.92],
    ] as const)
      k.loft(
        'plaster',
        [
          { outline: ngon(8, 0.2 * sz * SC, 0.22 * sz * SC), y: 0 },
          { outline: ngon(8, 0.19 * sz * SC, 0.21 * sz * SC), y: 0.07 * SC },
          { outline: ngon(8, 0.13 * sz * SC, 0.16 * sz * SC), y: 0.13 * SC },
          { outline: ngon(8, 0.05 * sz * SC, 0.07 * sz * SC), y: 0.16 * SC },
        ],
        { at: P(s * 0.45, y0 + 1.66 + dy, 0), rot, color: S, shade: dy < 0 ? 0.96 : 1.02, lod: dy < 0 ? 0 : 1 },
      );
  }
  // the head: a broad face block under a wide dwarf helm (brim, rounded crown, crest, cheek guards)
  const FACE_: [number, number, number][] = sc([
    [0, 0.15, 0.16],
    [0.24, 0.16, 0.17],
  ]);
  k.loft('plaster', FACE_.map(([y, hw, hd]) => ({ outline: ngon(8, hw, hd), y: y * SC })), { at: P(0, y0 + 1.86, 0.02), rot, color: S, lod: 1 });
  const HELM: [number, number, number][] = sc([
    [0, 0.25, 0.25],
    [0.05, 0.25, 0.25],
    [0.06, 0.22, 0.22],
    [0.14, 0.215, 0.215],
    [0.22, 0.17, 0.18],
    [0.28, 0.09, 0.1],
    [0.3, 0.02, 0.02],
  ]);
  k.loft('plaster', HELM.map(([y, hw, hd]) => ({ outline: ngon(16, hw, hd), y: y * SC })), { at: P(0, y0 + 2.08, 0.02), rot, color: S, shade: 1.03, lod: 0 });
  k.loft('plaster', HELM.map(([y, hw, hd]) => ({ outline: ngon(8, hw * 0.95, hd * 0.95), y: y * SC })), { at: P(0, y0 + 2.08, 0.02), rot, color: S, shade: 1.03, lod: 2 });
  // the crest: a low ridge front to back over the crown
  k.box('plaster', 0.05 * SC, 0.09 * SC, 0.42 * SC, { at: P(0, y0 + 2.3, 0.02), rot, color: S, shade: 1.05, lod: 0 });
  // cheek guards down both sides of the face, a nasal
  for (const s of [-1, 1]) k.box('plaster', 0.05 * SC, 0.22 * SC, 0.22 * SC, { at: P(s * 0.19, y0 + 1.88, 0.06), rot, color: S, shade: 1.02, lod: 0 });
  k.box('plaster', 0.04 * SC, 0.12 * SC, 0.03 * SC, { at: P(0, y0 + 1.98, 0.2), rot, color: S, lod: 0 });
  // the beard: long and broad, from the chin to the belt, squared at its end, over the chest
  k.loft(
    'plaster',
    [
      { outline: rect(0.19 * SC, 0.05 * SC), y: 0 },
      { outline: rect(0.22 * SC, 0.07 * SC), y: 0.18 * SC },
      { outline: rect(0.23 * SC, 0.08 * SC), y: 0.5 * SC },
      { outline: rect(0.2 * SC, 0.08 * SC), y: 0.8 * SC },
      { outline: rect(0.16 * SC, 0.06 * SC), y: 0.9 * SC },
    ],
    { at: P(0, y0 + 1.02, 0.27), rot, color: S, shade: 0.95, lod: 1 },
  );
  // braids down the beard's front (LOD0)
  for (const s of [-1, 0, 1]) k.box('plaster', 0.05 * SC, 0.62 * SC, 0.03 * SC, { at: P(s * 0.11, y0 + 1.0, 0.35), rot, color: S, shade: 0.9, lod: 0 });
  // the axe: haft standing on the plinth beside him, the double-bitted head above his helm's brim with
  // two curved bits (convex edges, horns top and bottom) lofted out from the socket
  const ax = axeSide * 0.36;
  const az = 0.44;
  k.cylinder('stone', 0.032 * SC, 0.036 * SC, 2.42 * SC, { at: P(ax, y0, az), seg: 8, color: KING, shade: 0.92 });
  const hy = y0 + 2.08;
  k.box('plaster', 0.09 * SC, 0.24 * SC, 0.08 * SC, { at: P(ax, hy - 0.12, az), rot, color: S, lod: 1 });
  const BIT: [number, number, number][] = [
    [0, 0.07, 0.035],
    [0.08, 0.08, 0.03],
    [0.18, 0.15, 0.025],
    [0.28, 0.23, 0.02],
    [0.35, 0.27, 0.015],
    [0.39, 0.25, 0.01],
    [0.42, 0.16, 0.006],
  ];
  for (const roll of [90, -90])
    k.loft(
      'plaster',
      BIT.map(([y, hv, hd]) => ({ outline: rect(hv * SC, hd * SC), y: y * SC })),
      { at: P(ax, hy, az), rot: [0, YAW, roll], color: S, shade: 1.06, lod: 1 },
    );
  // arms: shoulders → elbows → both fists on the haft at chest height
  const fistHi: V3 = [ax, y0 + 1.42, az - 0.02];
  const fistLo: V3 = [ax, y0 + 1.18, az - 0.02];
  const limb = (a: V3, b: V3, r0: number, r1: number) => {
    const pa = P(a[0], a[1], a[2]);
    const pb = P(b[0], b[1], b[2]);
    const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
    k.cylinder('plaster', r1 * SC, r0 * SC, len, { at: pa, rot: aimRot(pa, pb), seg: 8, color: S, lod: 1 });
  };
  const near = axeSide;
  limb([near * 0.5, y0 + 1.72, 0], [near * 0.56, y0 + 1.32, 0.16], 0.13, 0.11);
  limb([near * 0.56, y0 + 1.32, 0.16], fistHi, 0.11, 0.09);
  limb([-near * 0.5, y0 + 1.72, 0], [-near * 0.36, y0 + 1.18, 0.3], 0.13, 0.11);
  limb([-near * 0.36, y0 + 1.18, 0.3], fistLo, 0.11, 0.09);
  for (const f of [fistHi, fistLo]) k.box('plaster', 0.13 * SC, 0.12 * SC, 0.13 * SC, { at: P(f[0], f[1] - 0.06, f[2]), rot, color: S, lod: 0 });
}

/** a brazier: a stone pedestal and an iron bowl, the fire on top (fire gate: lit from golden hour) */
function brazier(k: ProxyKit, u: number, w: number, y: number, intensity: number): void {
  const p = at(u, y, w);
  k.cylinder('stone', 0.05, 0.07, 0.14, { at: p, seg: 8, color: STONE, lod: 0 });
  k.cylinder('iron', 0.1, 0.06, 0.06, { at: [p[0], y + 0.14, p[2]], seg: 8, lod: 0 });
  k.light([p[0], y + 0.22, p[2]], { kind: 'fire', color: 0xff9a40, intensity, radius: 0.07, flicker: 0.35 });
}

/** Build the Front Gate (the court is levelled by GATE_STAMPS). */
export function buildGate(k: ProxyKit): void {
  const rot: V3 = [0, YAW, 0];
  /** lowest / highest ground under a gate-frame rectangle */
  const groundRange = (u: number, w: number, hu: number, hw: number): [number, number] => {
    const gs = [-1, 0, 1].flatMap((a) =>
      [-1, 0, 1].map((b) => {
        const [x, z] = G(u + a * hu, w + b * hw);
        return k.ground(x, z);
      }),
    );
    return [Math.min(...gs), Math.max(...gs)];
  };

  // ---- the terrace before the gate: three broad tiers of dressed stone stepping down towards the river,
  // which issues from a dark culvert in the lowest tier's front. Plain prisms from below the ground up to
  // each tier's own top (no ground-following: the rising rock at the back simply pokes through them)
  // (the top tier stands just above the highest ground under its own front part — never sampled behind
  // the façade's face, where the coarse heightfield already ramps up into the mountain)
  const ty = Math.max(COURT, ...[-0.9, -0.45, 0, 0.45, 0.9].flatMap((u) => [0, 0.15, 0.3].map((w) => k.ground(...G(u, w))))) + 0.06;
  const tiers: [number, number, number, number][] = [
    // u half-width, w from, w to, top below ty
    [1.15, -0.12, 0.3, 0],
    [1.0, 0.3, 0.55, 0.09],
    [0.85, 0.55, 0.8, 0.18],
  ];
  for (const [hu, w0, w1, drop] of tiers) {
    const outline: V2[] = [G(-hu, w0), G(hu, w0), G(hu, w1), G(-hu, w1)];
    const top = ty - drop;
    const bottom = Math.min(...outline.map(([x, z]) => k.ground(x, z)), top) - 0.25;
    k.extrude('stone', outline, top - bottom, { at: [0, bottom, 0], color: STONE, shade: 0.98 - drop * 0.4, lod: drop > 0.1 ? 1 : 2 });
    // a moulded lip along each tier's front (LOD0)
    k.box('stone', hu * 2, 0.025, 0.03, { at: at(0, top - 0.025, w1 + 0.005), rot, color: STONE_LIGHT, shade: 0.95, lod: 0 });
  }
  // the river's culvert in the lowest tier's front: a dark arched mouth, its frame proud of the wall
  k.box('darkStone', 0.3, 0.09, 0.03, { at: at(0, ty - 0.18 - 0.13, 0.805), rot, color: 0x141716, lod: 0 });
  k.box('stone', 0.38, 0.03, 0.04, { at: at(0, ty - 0.18 - 0.04, 0.81), rot, color: STONE_LIGHT, lod: 0 });

  // ---- the façade: a deep block let into the mountain's foot, a pointed gable, the central bay
  const fy = ty;
  const fw = 2.0;
  const fh = 2.9;
  const fz = -0.1;
  k.box('stone', fw, fh, 1.5, { at: at(0, fy - 0.02, fz - 0.75), rot, color: STONE, lod: 2 });
  k.loft(
    'stone',
    [
      { outline: rect(fw / 2, 0.7), y: 0 },
      { outline: rect(fw * 0.4, 0.7), y: 0.32 },
      { outline: rect(fw * 0.24, 0.7), y: 0.66 },
      { outline: rect(0.03, 0.7), y: 1.0 },
    ],
    { at: at(0, fy + fh - 0.02, fz - 0.75), rot, color: STONE, lod: 2 },
  );
  // the central bay: a dark recess panel under a pointed arch, framed by tall gilt-edged pilasters
  const bay = 0.7;
  const bz = fz + 0.015;
  k.box('stone', bay, 2.4, 0.03, { at: at(0, fy, bz), rot, color: RECESS, lod: 1 });
  k.loft(
    'stone',
    [
      { outline: rect(bay / 2, 0.015), y: 0 },
      { outline: rect(bay * 0.36, 0.015), y: 0.2 },
      { outline: rect(bay * 0.18, 0.015), y: 0.38 },
      { outline: rect(0.01, 0.015), y: 0.5 },
    ],
    { at: at(0, fy + 2.4, bz), rot, color: RECESS, lod: 1 },
  );
  // the door: a tall pointed arch at the foot of the bay, its leaves dark, a gilt frame round it
  k.box('darkStone', 0.38, 0.7, 0.03, { at: at(0, fy, bz + 0.025), rot, color: DOOR, lod: 0 });
  k.loft(
    'darkStone',
    [
      { outline: rect(0.19, 0.015), y: 0 },
      { outline: rect(0.12, 0.015), y: 0.13 },
      { outline: rect(0.01, 0.015), y: 0.27 },
    ],
    { at: at(0, fy + 0.7, bz + 0.025), rot, color: DOOR, lod: 0 },
  );
  for (const s of [-1, 1]) k.box('gold', 0.025, 0.72, 0.02, { at: at(s * 0.205, fy, bz + 0.035), rot, color: GOLD, lod: 0 });
  // tiers above the door: carved bands with window slits (the stacked halls behind the gate)
  for (let t = 0; t < 4; t++) {
    const y = fy + 1.05 + t * 0.34;
    k.box('stone', bay * 0.92, 0.035, 0.07, { at: at(0, y, bz + 0.02), rot, color: STONE_LIGHT, lod: 0 });
    for (let s = -2; s <= 2; s++) k.box('darkStone', 0.045, 0.13, 0.02, { at: at(s * 0.125, y + 0.07, bz + 0.03), rot, color: DOOR, lod: 0 });
  }
  // pilasters: the two great ones framing the bay, two at the façade's edges; pointed caps; gilt edges
  for (const s of [-1, 1]) {
    for (const [u, w, h, d] of [
      [0.43, 0.16, 3.1, 0.18],
      [0.93, 0.14, 2.75, 0.13],
    ] as const) {
      const cz = fz + d / 2 - 0.05;
      k.box('stone', w, h, d + 0.1, { at: at(s * u, fy - 0.02, cz), rot, color: STONE_LIGHT, shade: 0.95, lod: 1 });
      // fluting down the pilaster's face (LOD0)
      for (const f of [-1, 0, 1]) k.box('stone', 0.022, h - 0.3, 0.015, { at: at(s * u + f * w * 0.28, fy + 0.15, fz + d + 0.006), rot, color: STONE, lod: 0 });
      for (const e of [-1, 1]) k.box('gold', 0.02, h - 0.12, 0.012, { at: at(s * u + e * (w / 2 - 0.012), fy + 0.05, fz + d), rot, color: GOLD, lod: 0 });
      k.loft('stone', [{ outline: rect(w / 2, (d + 0.1) / 2), y: 0 }, { outline: rect(0.01, (d + 0.1) / 2), y: w * 1.5 }], { at: at(s * u, fy + h - 0.02, cz), rot, color: STONE_LIGHT, lod: 0 });
    }
    // the outer bays: a stepped buttress panel with a lattice of small windows
    k.box('stone', 0.32, 1.8, 0.08, { at: at(s * 0.68, fy - 0.02, fz + 0.02), rot, color: STONE, shade: 1.06, lod: 1 });
    k.box('stone', 0.24, 0.7, 0.05, { at: at(s * 0.68, fy + 1.78, fz + 0.02), rot, color: STONE, shade: 1.0, lod: 1 });
    // carved courses across the outer bay (LOD0)
    for (let r = 0; r < 6; r++) k.box('stone', 0.34, 0.02, 0.02, { at: at(s * 0.68, fy + 0.35 + r * 0.31, fz + 0.075), rot, color: STONE_LIGHT, lod: 0 });
    for (let r = 0; r < 7; r++)
      for (let c = -1; c <= 1; c++) k.box('darkStone', 0.045, 0.12, 0.02, { at: at(s * 0.68 + c * 0.08, fy + 0.2 + r * 0.31, fz + 0.065), rot, color: DOOR, lod: 0 });
  }
  // gilt along the gable's rising edges and round the bay's arch, a gilt cornice
  const gableH = 1.0;
  const slope = Math.atan2(gableH, fw / 2) / DEG;
  for (const s of [-1, 1]) {
    const len = Math.hypot(fw / 2, gableH);
    k.box('gold', len, 0.035, 0.02, { at: at((s * fw) / 4, fy + fh - 0.02 + gableH / 2 - 0.018, fz - 0.03), rot: [0, YAW, s * slope], color: GOLD, lod: 0 });
    const al = Math.hypot(bay / 2, 0.5);
    const as = Math.atan2(0.5, bay / 2) / DEG;
    k.box('gold', al, 0.022, 0.015, { at: at((s * bay) / 4, fy + 2.4 + 0.25 - 0.011, bz + 0.02), rot: [0, YAW, s * as], color: GOLD, lod: 0 });
  }
  k.box('gold', fw * 0.98, 0.03, 0.02, { at: at(0, fy + fh - 0.05, fz - 0.03), rot, color: GOLD, lod: 0 });

  // the gable's carved lattice: rows of narrow slits narrowing to the apex (LOD0)
  for (let r = 0; r < 5; r++) {
    const y = fy + fh + 0.1 + r * 0.16;
    const half = (fw / 2) * (1 - (r * 0.16 + 0.2) / gableH) - 0.08;
    for (let u = -half; u <= half + 1e-6; u += 0.1) k.box('darkStone', 0.035, 0.09, 0.02, { at: at(u, y, fz - 0.04), rot, color: DOOR, lod: 0 });
  }
  // fallen blocks and scree in the court's corners and down the valley (LOD0)
  for (const s of [-1, 1])
    k.scatter(
      { polygon: [G(s * 2.2, 0.35), G(s * 1.0, 0.9), G(s * 0.6, 1.8), G(s * 2.0, 1.6)] },
      9,
      (_i, x, z, u) => k.rock('weathered', 0.05 + u * 0.06, { at: [x, 0, z], seat: true, squash: 0.65, lump: 0.35, detail: 1, color: 0x6a6d68, lod: 0 }),
      { minSpacing: 0.18 },
    );
  // geometric dwarven ramparts along both banks of the outflow, from the terrace down the valley (LOD0)
  for (const s of [-1, 1]) {
    const line: V2[] = [G(s * 0.95, 0.8), G(s * 0.55, 1.3), G(s * 0.5, 1.9), G(s * 0.6, 2.5)];
    k.wallPath('stone', line, 0.08, 0.045, { followGround: true, step: 0.08, batter: 0.15, color: STONE, crenel: { w: 0.03, h: 0.025, gap: 0.025, lod: 0 }, lod: 0 });
    for (const w of [1.3, 2.5]) {
      const [tx, tz] = G(s * (w < 2 ? 0.55 : 0.6), w);
      k.tower('stone', 0.05, 0.14, { at: [tx, 0, tz], seat: true, sides: 4, rot: [0, YAW + 45, 0], roof: 'crenel', color: STONE_LIGHT, lod: 0 });
    }
  }

  // ---- the two kings, axes on the outer sides, carved in half-relief: the plinth's deep block is let
  // into the court (its top just above the highest ground along its front edge), and a rock wall (the
  // recess either side of the façade) takes the back third of each figure — its face 0.13 km behind
  // the figure's centre line (body half-depth 0.43 km)
  for (const s of [-1, 1]) {
    const base = Math.max(ty - 0.02, groundRange(s * KING_U, 0.58, 0.15, 0.02)[1] + 0.04);
    statue(k, s * KING_U, KING_W, base, s);
    // the rock wall, walked along −u so its face looks out along +w; it starts just outside the façade
    // and runs out past the axe on a level foot at the court (where the mountain rises it simply buries
    // the wall), its ends tapering into the court and the mountain
    const wb = KING_W - 0.13;
    const inner = s * 1.02;
    const outer = s * (KING_U + 1.15);
    const path: V2[] = s > 0 ? [G(outer, wb - 0.12), G(s * (KING_U + 0.4), wb), G(s * (KING_U - 0.4), wb), G(inner, wb)] : [G(inner, wb), G(s * (KING_U - 0.4), wb), G(s * (KING_U + 0.4), wb), G(outer, wb - 0.12)];
    const hs = s > 0 ? [2.6, 3.3, 3.5, 3.2] : [3.2, 3.5, 3.3, 2.6];
    k.cliff('weathered', path, hs, { at: [0, COURT - 0.1, 0], followGround: false, depth: 1.6, rough: 0.2, strata: 0.35, soft: 0.5, overhang: 0.12, taper: 0.22, color: KING_ROCK });
  }

  // ---- braziers: either side of the door on the upper tier, at the second tier's corners, before the
  // kings on the court (staggered heights and strengths: not a row of headlights from afar)
  for (const s of [-1, 1]) {
    brazier(k, s * 0.5, 0.2, ty, 3.6);
    brazier(k, s * 0.9, 0.46, ty - 0.09, 2.6);
    brazier(k, s * KING_U, 0.72, groundRange(s * KING_U, 0.72, 0.07, 0.07)[0] - 0.02, 3.1);
  }
  // the gate's inner glow (the halls behind the open door; a window: night gate)
  k.light(at(0, fy + 0.32, bz + 0.05), { kind: 'window', color: 0xffb35a, intensity: 2.0, radius: 0.1 });
}
