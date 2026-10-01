import { aimRot } from '../argonath/king.ts';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';
import type { LocalStamp } from '../types.ts';

/**
 * The Front Gate of Erebor (research §13; the Weta "Front Gate" miniature, the Desolation of Smaug
 * still): a tall carved façade of cold green-grey dwarf stone let into the sheer southern foot of the
 * mountain at the head of the gate valley, flanked by two colossal dwarf-warrior statues with
 * double-bitted axes, a dressed terrace before it from whose front the River Running issues, braziers
 * burning at dusk; prologue gold (#8c713f) on the pilaster edges, the gable and the door arch.
 *
 * The terrain is the recess: the mountain's foot rises ≈ 10 units per km here (sheer at the heightfield's
 * 0.4 km resolution); three lowerOnly flattens (GATE_STAMPS) cut a level court for the façade and the
 * two kings into it, so the façade's back and the plinths are let into the rock and the face rises
 * straight above them. No kit rock band: the terrain's own rock is the wall.
 *
 * Gate frame (u, w): u along the façade (≈ east-north-east), w out of it (≈ south-south-west, bearing
 * FACE); y up. The river source (the baked River Running starts at the display point) lies on the gate
 * axis 1.0 km in front of the façade, at the foot of the terrace.
 */
export const FACE = 195;
const DEG = Math.PI / 180;
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
/** the kings stand at ±KING_U along the façade */
const KING_U = 1.64;

/** the court cut into the mountain's foot: the façade's bay and the two kings' bays (lowerOnly: never raises) */
export const GATE_STAMPS: LocalStamp[] = [
  { kind: 'flatten', at: G(0, 0.3), radius: 0.85, falloff: 0.4, height: COURT, lowerOnly: true, surface: 'rock' },
  { kind: 'flatten', at: G(-KING_U, 0.2), radius: 0.55, falloff: 0.35, height: COURT + 0.05, lowerOnly: true, surface: 'rock' },
  { kind: 'flatten', at: G(KING_U, 0.2), radius: 0.55, falloff: 0.35, height: COURT + 0.05, lowerOnly: true, surface: 'rock' },
];

/** cold grey-green dwarf stone (DoS: #707773 / #899995), the darker carved recesses, prologue gold */
const STONE = 0x707773;
const STONE_LIGHT = 0x899995;
const RECESS = 0x2f3732;
const DOOR = 0x101311;
const GOLD = 0x8c713f;

/** octagonal section outline of half-width hw (u) and half-depth hd (w), centred */
function oct(hw: number, hd: number): V2[] {
  const out: V2[] = [];
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    out.push([Math.cos(a) * hw, Math.sin(a) * hd]);
  }
  return out;
}
/** n-sided section outline (smooth LOD0 shells) */
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

/**
 * One colossal statue: a dwarf lord in plated armour, a tall pointed helm, a long square beard, both
 * hands on the haft of a double-bitted axe standing beside him on the `axeSide` (+1 = +u). Statue frame:
 * origin at (u0, base, w0), +y up, facing +w. ≈ 3.2 km over the plinth step, nearly the façade's height
 * — a feature of the mountain's face from 50 km.
 */
function statue(k: ProxyKit, u0: number, w0: number, base: number, axeSide: number): void {
  /** figure scale: the kings stand nearly as tall as the façade */
  const SC = 1.2;
  const P = (x: number, y: number, z: number): V3 => at(u0 + x * SC, base + y * SC, w0 + z * SC);
  const rot: V3 = [0, YAW, 0];
  const S = STONE_LIGHT;
  const sc = (q: [number, number, number][]) => q.map(([y, hw, hd]) => [y, hw * SC, hd * SC] as [number, number, number]);
  // plinth: a deep block let into the court (its foot buried), a moulded top step
  k.box('stone', 1.2 * SC, 1.22, 1.0 * SC, { at: P(0, -1.2 / SC, 0), rot, color: STONE, shade: 0.95, lod: 2 });
  k.box('stone', 1.08 * SC, 0.1 * SC, 0.9 * SC, { at: P(0, 0.02, 0), rot, color: STONE_LIGHT, shade: 0.9, lod: 1 });
  const y0 = 0.12;
  // the body: a smooth 16-sided shell at LOD0 round a coarse octagonal core kept for the far LODs
  const body = sc(BODY);
  k.loft('plaster', body.map(([y, hw, hd]) => ({ outline: ngon(16, hw, hd), y: y * SC })), { at: P(0, y0, 0), rot, color: S, lod: 0 });
  k.loft('plaster', body.map(([y, hw, hd]) => ({ outline: oct(hw * 0.96, hd * 0.96), y: y * SC })), { at: P(0, y0, 0), rot, color: S, lod: 2 });
  // lamellar armour: tiers of plates round the skirt and the chest, each a little proud of the one above
  for (let t = 0; t < 8; t++) {
    const y = 0.06 + t * 0.12;
    if (y > 0.86 && y < 1.1) continue;
    const [hw, hd] = bodyAt(y + 0.06);
    k.loft(
      'plaster',
      [
        { outline: ngon(16, (hw + 0.028) * SC, (hd + 0.028) * SC), y: 0 },
        { outline: ngon(16, (hw + 0.008) * SC, (hd + 0.008) * SC), y: 0.1 * SC },
      ],
      { at: P(0, y0 + y, 0), rot, color: t % 2 ? STONE : S, shade: 0.97, lod: 0 },
    );
  }
  for (let t = 0; t < 4; t++) {
    const y = 1.14 + t * 0.13;
    const [hw, hd] = bodyAt(y + 0.06);
    k.loft(
      'plaster',
      [
        { outline: ngon(16, (hw + 0.022) * SC, (hd + 0.022) * SC), y: 0 },
        { outline: ngon(16, (hw + 0.006) * SC, (hd + 0.006) * SC), y: 0.11 * SC },
      ],
      { at: P(0, y0 + y, 0), rot, color: t % 2 ? STONE : S, shade: 0.97, lod: 0 },
    );
  }
  // pauldrons
  for (const s of [-1, 1]) k.sphere('plaster', 0.21 * SC, { at: P(s * 0.47, y0 + 1.76, 0), squash: 0.72, color: S, shade: 1.05, lod: 1 });
  // the head: a broad face block, the tall pointed helm with a brim (smooth shell + coarse core)
  const HEAD: [number, number, number][] = sc([
    [0, 0.16, 0.17],
    [0.22, 0.17, 0.18],
    [0.25, 0.21, 0.22],
    [0.3, 0.19, 0.2],
    [0.48, 0.12, 0.13],
    [0.66, 0.015, 0.015],
  ]);
  k.loft('plaster', HEAD.map(([y, hw, hd]) => ({ outline: ngon(16, hw, hd), y: y * SC })), { at: P(0, y0 + 1.88, 0.02), rot, color: S, lod: 0 });
  k.loft('plaster', HEAD.map(([y, hw, hd]) => ({ outline: oct(hw * 0.95, hd * 0.95), y: y * SC })), { at: P(0, y0 + 1.88, 0.02), rot, color: S, lod: 2 });
  // the beard: a long squared wedge down the chest
  k.loft(
    'plaster',
    [
      { outline: rect(0.06 * SC, 0.04 * SC), y: 0 },
      { outline: rect(0.14 * SC, 0.06 * SC), y: 0.35 * SC },
      { outline: rect(0.16 * SC, 0.07 * SC), y: 0.62 * SC },
      { outline: rect(0.13 * SC, 0.05 * SC), y: 0.72 * SC },
    ],
    { at: P(0, y0 + 1.27, 0.25), rot, color: S, shade: 0.92, lod: 1 },
  );
  // the axe: haft standing on the plinth beside him, the double-bitted head above his helm's brim
  const ax = axeSide * 0.36;
  const az = 0.44;
  k.cylinder('stone', 0.032 * SC, 0.036 * SC, 2.42 * SC, { at: P(ax, y0, az), seg: 8, color: STONE, shade: 0.9 });
  k.loft(
    'plaster',
    [
      // a double-bitted head: two crescent blades, flaring to their horns, waisted at the haft
      { outline: rect(0.05 * SC, 0.035 * SC), y: 0 },
      { outline: rect(0.39 * SC, 0.02 * SC), y: 0.07 * SC },
      { outline: rect(0.33 * SC, 0.025 * SC), y: 0.15 * SC },
      { outline: rect(0.27 * SC, 0.03 * SC), y: 0.24 * SC },
      { outline: rect(0.33 * SC, 0.025 * SC), y: 0.33 * SC },
      { outline: rect(0.39 * SC, 0.02 * SC), y: 0.41 * SC },
      { outline: rect(0.05 * SC, 0.035 * SC), y: 0.48 * SC },
    ],
    { at: P(ax, y0 + 1.86, az), rot, color: S, shade: 1.08 },
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
  limb([-near * 0.5, y0 + 1.72, 0], [-near * 0.36, y0 + 1.18, 0.24], 0.13, 0.11);
  limb([-near * 0.36, y0 + 1.18, 0.24], fistLo, 0.11, 0.09);
  for (const f of [fistHi, fistLo]) k.box('plaster', 0.13 * SC, 0.12 * SC, 0.13 * SC, { at: P(f[0], f[1] - 0.06, f[2]), rot, color: S, lod: 0 });
}

/** a brazier: a stone pedestal and an iron bowl, the fire on top (dusk-gated) */
function brazier(k: ProxyKit, u: number, w: number, y: number): void {
  const p = at(u, y, w);
  k.cylinder('stone', 0.05, 0.07, 0.14, { at: p, seg: 8, color: STONE, lod: 0 });
  k.cylinder('iron', 0.1, 0.06, 0.06, { at: [p[0], y + 0.14, p[2]], seg: 8, lod: 0 });
  k.light([p[0], y + 0.22, p[2]], { kind: 'fire', color: 0xff9a40, intensity: 3.6, radius: 0.07, flicker: 0.35 });
}

/** Build the Front Gate (the court is levelled by GATE_STAMPS). */
export function buildGate(k: ProxyKit): void {
  const rot: V3 = [0, YAW, 0];
  /** lowest ground under a gate-frame rectangle */
  const groundUnder = (u: number, w: number, hu: number, hw: number): number =>
    Math.min(
      ...[-1, 0, 1].flatMap((a) =>
        [-1, 0, 1].map((b) => {
          const [x, z] = G(u + a * hu, w + b * hw);
          return k.ground(x, z);
        }),
      ),
    );

  // ---- the terrace before the gate: three broad tiers of dressed stone stepping down towards the river,
  // which issues from a dark culvert in the lowest tier's front
  const g0 = Math.max(...[-0.9, 0, 0.9].map((u) => k.ground(...G(u, -0.08))));
  const ty = g0 + 0.06;
  const tiers: [number, number, number, number][] = [
    // u half-width, w from, w to, top below ty
    [1.15, -0.12, 0.3, 0],
    [1.0, 0.3, 0.55, 0.09],
    [0.85, 0.55, 0.8, 0.18],
  ];
  for (const [hu, w0, w1, drop] of tiers) {
    const outline: V2[] = [G(-hu, w0), G(hu, w0), G(hu, w1), G(-hu, w1)];
    const top = ty - drop;
    const gmax = Math.max(...outline.map(([x, z]) => k.ground(x, z)));
    // followGround puts the top `height` above the highest ground under the outline: aim it at `top`
    k.extrude('stone', outline, Math.max(0.02, top - gmax), { followGround: true, color: STONE, shade: 0.92 - drop * 0.4 });
  }
  k.box('darkStone', 0.32, 0.1, 0.05, { at: at(0, ty - 0.18 - 0.12, 0.81), rot, color: 0x141716, lod: 0 });

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
  // the door: a tall pointed arch at the foot of the bay, its leaves dark
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
      for (const e of [-1, 1]) k.box('gold', 0.02, h - 0.12, 0.012, { at: at(s * u + e * (w / 2 - 0.012), fy + 0.05, fz + d - 0.0), rot, color: GOLD, lod: 0 });
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
  k.scatter(
    { polygon: [G(-2.2, 0.2), G(-1.0, 0.9), G(-0.6, 1.8), G(-2.0, 1.6)] },
    9,
    (_i, x, z, u) => k.rock('weathered', 0.05 + u * 0.06, { at: [x, 0, z], seat: true, squash: 0.65, lump: 0.35, detail: 1, color: 0x6a6d68, lod: 0 }),
    { minSpacing: 0.18 },
  );
  k.scatter(
    { polygon: [G(2.2, 0.2), G(1.0, 0.9), G(0.6, 1.8), G(2.0, 1.6)] },
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

  // ---- the two kings, axes on the outer sides; each plinth's deep block let into the court, its top
  // just above the highest ground under it
  const groundOver = (u: number, w: number, hu: number, hw: number): number =>
    Math.max(
      ...[-1, 0, 1].flatMap((a) =>
        [-1, 0, 1].map((b) => {
          const [x, z] = G(u + a * hu, w + b * hw);
          return k.ground(x, z);
        }),
      ),
    );
  // (the plinth's back is let into the rising rock: seat on the ground along its front edge)
  for (const s of [-1, 1]) statue(k, s * KING_U, 0.08, Math.max(ty - 0.02, groundOver(s * KING_U, 0.58, 0.15, 0.02) + 0.04), s);

  // ---- braziers: either side of the door, at the terrace's front corners, before the kings
  for (const s of [-1, 1]) {
    brazier(k, s * 0.5, 0.2, ty);
    brazier(k, s * 0.95, 0.45, ty);
    brazier(k, s * KING_U, 0.72, groundUnder(s * KING_U, 0.72, 0.07, 0.07) - 0.02);
  }
  // the gate's inner glow (the halls behind the open door)
  k.light(at(0, fy + 0.32, bz + 0.05), { kind: 'window', color: 0xffb35a, intensity: 2.0, radius: 0.1, gate: 'dusk' });
}
