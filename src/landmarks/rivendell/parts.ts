import { Euler, Matrix4 } from 'three/webgpu';
import { type ProxyKit, SINK } from '../kit/ProxyKit.ts';
import { elevation } from '../osgiliath/elev.ts';
import type { V2, V3 } from '../types.ts';

/**
 * Rivendell kit helpers (local km, heading 0: x east, z south). Pure functions of their arguments and the
 * kit's ground — no module state.
 */

/**
 * warm honey elven stone (the film's sunlit Rivendell), a paler trim, a warmer shadow stone — S4 W5 (C2
 * #4): a little darker than S3's cream (blank cream walls read as a dollhouse)
 */
export const STONE = 0xc4b08a;
export const STONE2 = 0xb39f7a;
export const TRIM = 0xddd0ad;
/** roofs: verdigris copper, varied (S4 W5: at most a fifth bronze, no terracotta) */
export const BRONZE = 0x8a6a3c;
/** (fix round: greener and darker — under the warm afternoon grade 0x6a7f72 read as taupe) */
export const VERDIGRIS = 0x5a7466;
export const VERDIGRIS2 = 0x5f7d6a;
export const VERDIGRIS3 = 0x4f6a5a;
export const GILT = 0xc8a050;
export const LAMP = 0xffc27a;
const GLASS = 0x3b3228;
const DEG = Math.PI / 180;

/**
 * A polyline offset sideways by `d` km (positive = left of the walking direction, i.e. north when walking
 * east; per-vertex normals averaged over the adjacent segments).
 */
export function offsetPath(path: V2[], d: number): V2[] {
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    // left normal of (dx, dz) with x east / z south: (dz, −dx)
    return [p[0] + (dz / l) * d, p[1] - (dx / l) * d];
  });
}

/**
 * The floor height the kit gives a SEATED house (ProxyKit.house: the minimum ground under its corners and
 * centre, or dug in at most `dig` wall heights on the uphill side), so parts can be placed on its walls.
 */
export function houseFloor(k: ProxyKit, at: V2, w: number, d: number, h: number, yawDeg: number, dig: number): number {
  const c = Math.cos(yawDeg * DEG);
  const s = Math.sin(yawDeg * DEG);
  const loc = (x: number, z: number): V2 => [at[0] + x * c + z * s, at[1] - x * s + z * c];
  const gs = [loc(-w / 2, -d / 2), loc(w / 2, -d / 2), loc(w / 2, d / 2), loc(-w / 2, d / 2)].map(([x, z]) => k.ground(x, z));
  const gc = k.ground(at[0], at[1]);
  const gMin = Math.min(...gs, gc);
  const gMax = Math.max(...gs, gc);
  return Math.max(gMin, gMax - dig * h) - SINK;
}

/** where the elven roof's straight plane breaks into its flared eave (share of the half-width) */
const EAVE_Q = 0.82;
/**
 * height fraction of the swept elven roof at |s| = q of the half-width (1 at the ridge, ≈ 0.03 at the
 * eave): S4 W5 fix round (the critic: fully concave sweeps read as East-Asian pagoda roofs) — a STRAIGHT
 * plane from the ridge, flaring to half its slope over the last fifth only (a bell-cast eave)
 */
function sweep(q: number): number {
  const h0 = 0.12;
  return q <= EAVE_Q ? 1 - (q * (1 - h0)) / EAVE_Q : h0 - (q - EAVE_Q) * 0.5;
}

/**
 * A swept (bell-cast) gable roof and its cream gable fill, in the vertical plane across the ridge:
 * ridge along hall-local x, `hw` = half width across the ridge incl. the overhang, `rise` above the wall
 * top `y`, `len` along the ridge; the gable fill spans the walls' depth `d` and length `w`.
 */
function sweptRoof(k: ProxyKit, at: V2, yawDeg: number, y: number, hw: number, d: number, w: number, len: number, rise: number, color: number, lod?: 0 | 1 | 2): void {
  const c = Math.cos(yawDeg * DEG);
  const s = Math.sin(yawDeg * DEG);
  // across the ridge = hall-local +z → (s, c)
  const a: V2 = [at[0] - s * hw, at[1] - c * hw];
  const b: V2 = [at[0] + s * hw, at[1] + c * hw];
  const n = 6;
  const T = Math.max(0.006, rise * 0.07);
  const top: V2[] = [];
  for (let i = -n; i <= n; i++) {
    const q = Math.abs(i) / n;
    top.push([hw * (1 + i / n), y + rise * sweep(q) - 0.004]);
  }
  const bottom = top.map(([u, v]): V2 => [u, v - T]).reverse();
  elevation(k, 'slate', a, b, [...top, ...bottom], len, { color, lod });
  // carved bargeboards along both gable verges (cream, a hair proud of the roof's ends), close range
  const rd: V2 = [c, -s];
  for (const e of [-1, 1]) {
    const off = e * (len / 2 + 0.003);
    const ea: V2 = [a[0] + rd[0] * off, a[1] + rd[1] * off];
    const eb: V2 = [b[0] + rd[0] * off, b[1] + rd[1] * off];
    const band = top.map(([u, v]): V2 => [u, v + 0.002]);
    const under = top.map(([u, v]): V2 => [u, v - T * 1.9]).reverse();
    elevation(k, 'stone', ea, eb, [...band, ...under], 0.005, { color: TRIM, lod: 0 });
  }
  // the gable fill under the roof over the walls (cream), a hair inside the roof's ends
  const fill: V2[] = [];
  const u0 = hw - d / 2;
  const u1 = hw + d / 2;
  fill.push([u0, y - 0.004]);
  fill.push([u1, y - 0.004]);
  const m = 4;
  for (let i = m; i >= -m; i--) {
    const u = hw + (i / m) * (d / 2);
    const q = Math.abs(u - hw) / hw;
    fill.push([u, Math.max(y + 0.004, y + rise * sweep(q) - T - 0.002)]);
  }
  elevation(k, 'stone', a, b, fill, w - 0.004, { color: STONE, lod });
}

export interface HallOpts {
  at: V2;
  /** yaw (deg): the long side faces local +z rotated by it */
  yaw: number;
  w: number;
  d: number;
  h: number;
  /** roof rise above the wall top (default 0.9·d) */
  rise?: number;
  roof?: number;
  /** lit windows on the long sides */
  windows?: number;
  /** a cross wing on the front, its swept gable facing out */
  cross?: boolean;
  /** an arcaded loggia along the front at the foot */
  loggia?: boolean;
  /** a slender balcony along the front (default on) */
  balcony?: boolean;
  /** an explicit floor (local y) on a built terrace instead of seating on the ground */
  floor?: number;
  /**
   * S4 W5 (C2 #4): the front (+z, the gorge side) opened as a colonnade — the walls stand back by this
   * share of the depth behind an arcade of slender piers, a dark void under the roof between them
   */
  open?: number;
}

/** how deep halls dig into the uphill side of their terrace (wall heights) */
const DIG = 0.6;

/**
 * An elven hall (the film's Last Homely House): honey-cream walls under a steep, swept bell-cast roof of
 * verdigris or bronze with a cream gable fill, seated on its terrace (a turf bank on the slope); tall
 * narrow dark window insets along both long sides and a tall arched opening in each gable; optional
 * cross wing (its own swept gable facing out), an arcaded loggia of slender columns along the front, a
 * slender balcony; warm lit windows.
 */
export function hall(k: ProxyKit, o: HallOpts): number {
  const c = Math.cos(o.yaw * DEG);
  const s = Math.sin(o.yaw * DEG);
  /** house-local (x along the ridge, z toward the front) → local */
  const loc = (x: number, z: number): V2 => [o.at[0] + x * c + z * s, o.at[1] - x * s + z * c];
  // S4 W5 (C2 #4): a lower pitch (≈ 38° at the ridge) over a doubled overhang
  const oh = Math.min(o.w, o.d) * 0.28;
  const rise = o.rise ?? Math.tan(38 * DEG) * (o.d / 2 + oh) * 0.85;
  const roofC = o.roof ?? VERDIGRIS;
  // an open front: the walls' box stands back behind the colonnade
  const back = (o.open ?? 0) * o.d;
  const wd = o.d - back;
  const [bx0, bz0] = loc(0, -back / 2);
  k.house('stone', 'stone', o.w, wd, o.h, {
    at: [bx0, o.floor ?? 0, bz0],
    rot: [0, o.yaw, 0],
    roof: 'flat',
    overhang: 0.004,
    color: STONE,
    roofColor: STONE2,
    ...(o.floor === undefined ? { dig: DIG, bank: { fam: 'foliage' as const, color: 0x6a6a34, slope: 42, ledge: 0.012 } } : { seat: false }),
    ...(o.windows ? { windows: { count: o.windows, on: 0.85, sides: 2 as const, size: 0.014, color: LAMP, intensity: 1.2 } } : {}),
  });
  const y0 = o.floor ?? houseFloor(k, [bx0, bz0], o.w, wd, o.h, o.yaw, DIG) + SINK;
  sweptRoof(k, o.at, o.yaw, y0 + o.h, o.d / 2 + oh, o.d, o.w, o.w + 2 * oh * 0.6, rise, roofC);
  const yawRot: V3 = [0, o.yaw, 0];
  // tall narrow window insets along both long sides (dark glass, a hair proud of the wall); an open front
  // gets the colonnade instead: an arcade of slender piers along the roof's front edge, the recessed wall
  // behind it dark (the void under the roof)
  const bays = Math.max(2, Math.round(o.w / 0.06));
  for (const side of back > 0 ? [-1] : [1, -1]) {
    for (let i = 0; i < bays; i++) {
      const u = (-0.5 + (i + 0.5) / bays) * o.w * 0.86;
      const [x, z] = loc(u, side * (o.d / 2 + 0.002));
      k.box('stone', 0.014, o.h * 0.56, 0.004, { at: [x, y0 + o.h * 0.22, z], rot: yawRot, color: GLASS, lod: 0 });
    }
  }
  if (back > 0) {
    const [vx, vz] = loc(0, o.d / 2 - back + 0.003);
    k.box('stone', o.w * 0.96, o.h * 0.92, 0.004, { at: [vx, y0, vz], rot: yawRot, color: GLASS, lod: 0 });
    const ca = loc(-o.w / 2, o.d / 2 - 0.012);
    const cb = loc(o.w / 2, o.d / 2 - 0.012);
    k.arcade('stone', ca, cb, { count: Math.max(3, Math.round(o.w / 0.034)), h: o.h, archH: o.h * 0.78, pier: 0.007, depth: 0.018, deck: false, color: TRIM, lod: 0 });
    // the floor of the colonnade
    const [fx, fz] = loc(0, o.d / 2 - back / 2);
    k.box('stone', o.w, 0.01, back, { at: [fx, y0 - 0.006, fz], rot: yawRot, color: STONE2, lod: 0 });
  }
  // a tall arched opening in each gable end
  for (const side of [1, -1]) {
    const [x, z] = loc(side * (o.w / 2 + 0.002), 0);
    k.box('stone', 0.004, o.h * 0.5 + rise * 0.3, o.d * 0.2, { at: [x, y0 + o.h * 0.3, z], rot: yawRot, color: GLASS, lod: 0 });
  }
  // the cross wing: a swept gable across the ridge on the front
  if (o.cross) {
    const cw = o.w * 0.32;
    const cd = o.d * 0.75;
    const [x, z] = loc(o.w * 0.06, o.d / 2 + cd / 2 - o.d * 0.25);
    k.box('stone', cw, o.h * 1.08, cd, { at: [x, y0 - 0.01, z], rot: yawRot, color: STONE });
    sweptRoof(k, [x, z], o.yaw + 90, y0 + o.h * 1.08, cw / 2 + oh * 0.8, cw, cd, cd + oh, rise * 1.1, roofC === VERDIGRIS ? VERDIGRIS2 : roofC);
    const [gx, gz] = loc(o.w * 0.06, o.d / 2 + cd - o.d * 0.25 + 0.002);
    k.box('stone', cw * 0.42, o.h * 0.75 + rise * 0.25, 0.004, { at: [gx, y0 + o.h * 0.15, gz], rot: yawRot, color: GLASS, lod: 0 });
  }
  // an arcaded loggia of slender columns along the front
  if (o.loggia) {
    const la = loc(-o.w * 0.42, o.d / 2 + 0.035);
    const lb = loc(o.w * (o.cross ? -0.12 : 0.42), o.d / 2 + 0.035);
    k.arcade('stone', la, lb, { count: Math.max(3, Math.round(Math.hypot(lb[0] - la[0], lb[1] - la[1]) / 0.045)), h: o.h * 0.55, archH: o.h * 0.42, pier: 0.008, depth: 0.05, deck: true, color: TRIM, lod: 0 });
  }
  // a slender balcony along the front at mid height (close-range detail, LOD0 only)
  if (o.balcony ?? true) {
    const [bx, bz] = loc(o.w * 0.2, o.d / 2 + 0.014);
    k.box('stone', o.w * 0.45, 0.008, 0.028, { at: [bx, y0 + o.h * 0.62, bz], rot: yawRot, color: TRIM, lod: 0 });
  }
  return y0;
}

/**
 * A slender elven tower: a pale eight-sided shaft with a band, an open belvedere of slender columns near
 * the top, and a swept ogee spire cap of bronze or verdigris with a gilt finial; a ring of lit windows.
 */
export function elvenTower(k: ProxyKit, at: V2, r: number, h: number, o: { roof?: number; lit?: number; cap?: number } = {}): void {
  const g = Math.min(...[0, 1, 2, 3, 4, 5].map((j) => k.ground(at[0] + Math.cos(j) * r, at[1] + Math.sin(j) * r)), k.ground(at[0], at[1])) - SINK;
  const H = h * 0.78;
  k.tower('stone', r, H, {
    at: [at[0], g, at[1]],
    sides: 8,
    taper: 0.14,
    roof: 'none',
    color: STONE,
    ...(o.lit ? { windows: { count: o.lit, rows: 1, on: 1, size: 0.013, color: LAMP, intensity: 1.2 } } : {}),
  });
  const rt = r * 0.86;
  // a band and the belvedere floor
  k.lathe(
    'stone',
    [
      [rt * 1.25, 0],
      [rt * 1.25, 0.012],
      [rt * 1.05, 0.02],
    ],
    { at: [at[0], g + H, at[1]], seg: 8, color: TRIM, lod: 0 },
  );
  // the open belvedere: eight slender columns round a dark core, a ring beam
  const bh = h * 0.12;
  k.cylinder('stone', rt * 0.55, rt * 0.55, bh, { at: [at[0], g + H, at[1]], seg: 8, color: GLASS, lod: 1 });
  for (let j = 0; j < 8; j++) {
    const a = (j / 8) * Math.PI * 2;
    k.cylinder('stone', 0.004, 0.005, bh, { at: [at[0] + Math.cos(a) * rt * 0.95, g + H, at[1] + Math.sin(a) * rt * 0.95], seg: 5, color: TRIM, lod: 0 });
  }
  k.lathe(
    'stone',
    [
      [rt * 1.12, 0],
      [rt * 1.12, 0.014],
    ],
    { at: [at[0], g + H + bh, at[1]], seg: 8, color: TRIM, lod: 1 },
  );
  // the swept ogee cap: a bulb, then a hollow sweep to a needle
  const cap = o.cap ?? h * 0.32;
  const r0 = rt * 1.1;
  k.lathe(
    'slate',
    [
      [r0, 0],
      [r0 * 1.12, cap * 0.14],
      [r0 * 0.98, cap * 0.3],
      [r0 * 0.55, cap * 0.55],
      [r0 * 0.22, cap * 0.8],
      [0.003, cap],
    ],
    { at: [at[0], g + H + bh + 0.012, at[1]], seg: 8, color: o.roof ?? BRONZE },
  );
  k.cylinder('gold', 0.002, 0.004, cap * 0.25, { at: [at[0], g + H + bh + 0.012 + cap * 0.95, at[1]], seg: 4, color: GILT, lod: 0 });
}

/** an open pavilion: slender columns under a swept ogee dome of verdigris, a gilt finial; `y` = its floor */
export function pavilion(k: ProxyKit, at: V2, r: number, lit: boolean, y = k.ground(at[0], at[1]) - 0.005, roof = VERDIGRIS2): void {
  k.lathe(
    'stone',
    [
      [r * 1.2, 0],
      [r * 1.2, 0.01],
    ],
    { at: [at[0], y, at[1]], seg: 12, color: TRIM, lod: 0 },
  );
  const ch = r * 1.25;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.cylinder('stone', 0.0045, 0.0055, ch, { at: [at[0] + Math.cos(a) * r, y + 0.01, at[1] + Math.sin(a) * r], seg: 5, color: TRIM, lod: 0 });
  }
  k.lathe(
    'stone',
    [
      [r * 1.08, 0],
      [r * 1.08, 0.012],
    ],
    { at: [at[0], y + 0.01 + ch, at[1]], seg: 12, color: TRIM, lod: 0 },
  );
  const dh = r * 1.5;
  k.lathe(
    'slate',
    [
      [r * 1.12, 0],
      [r * 1.1, dh * 0.2],
      [r * 0.85, dh * 0.45],
      [r * 0.4, dh * 0.72],
      [r * 0.12, dh * 0.92],
      [0.002, dh],
    ],
    { at: [at[0], y + 0.022 + ch, at[1]], seg: 12, color: roof },
  );
  if (lit) k.light([at[0], y + ch * 0.7, at[1]], { color: LAMP, intensity: 1.1, radius: 0.014, kind: 'lamp' });
}

/**
 * An arched gallery: a thin cream wall from `a` to `b` (local x, z) on its floor `y`, pierced by a row of
 * tall round-headed openings — the film's open arcades along the terraces' edges.
 */
export function gallery(k: ProxyKit, a: V2, b: V2, y: number, h: number, n: number, o: { t?: number; color?: number; lod?: 0 | 1 | 2 } = {}): void {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const pier = Math.max(0.006, (L / n) * 0.18);
  const ow = (L - pier * (n + 1)) / n;
  const spring = y + h * 0.62;
  const holes: V2[][] = [];
  for (let i = 0; i < n; i++) {
    const u0 = pier + i * (ow + pier);
    const u1 = u0 + ow;
    const r = ow / 2;
    const hole: V2[] = [
      [u0, y + 0.006],
      [u1, y + 0.006],
    ];
    for (let j = 1; j < 8; j++) {
      const t = (j / 8) * Math.PI;
      hole.push([u0 + r + Math.cos(t) * r, Math.min(y + h - 0.008, spring + Math.sin(t) * r)]);
    }
    hole.push([u0, spring]);
    holes.push(hole);
  }
  elevation(
    k,
    'stone',
    a,
    b,
    [
      [0, y],
      [L, y],
      [L, y + h],
      [0, y + h],
    ],
    o.t ?? 0.02,
    { color: o.color ?? TRIM, holes, lod: o.lod ?? 0 },
  );
}

/**
 * A terrace deck cantilevered over the gorge: a thin cream slab (polygon `pts`, local x, z) at height `y`
 * with a balustrade on its outer edges (`edges`: indices of the polygon's segments) and slender columns
 * standing on the slope below it.
 */
export function deck(k: ProxyKit, pts: V2[], y: number, edges: number[], columns: V2[]): void {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  k.extrude('stone', pts.map(([x, z]): V2 => [x - cx, z - cz]), 0.014, { at: [cx, y - 0.014, cz], color: TRIM });
  for (const e of edges) {
    const a = pts[e];
    const b = pts[(e + 1) % pts.length];
    k.wallPath('stone', [a, b], 0.022, 0.006, { at: [0, y, 0], color: TRIM, crenel: { w: 0.005, h: 0.01, gap: 0.01, lod: 0 }, lod: 0 });
  }
  for (const [x, z] of columns) {
    const g = k.ground(x, z) - SINK;
    if (y - 0.014 - g < 0.01) continue;
    k.cylinder('stone', 0.005, 0.0065, y - 0.014 - g, { at: [x, g, z], seg: 6, color: STONE });
  }
}

/**
 * Euler XYZ angles (degrees) that stand an `extrude` outline up in the vertical plane whose right-hand
 * direction is `dir` (local x, z): Ry(yaw)·Rx(90°) with yaw = atan2(−dir.z, dir.x) — outline (u, −v) → u
 * along `dir`, v up; the extrusion runs along the plane's normal (dir turned 90° clockwise seen from above).
 */
function sideRot(dir: V2): V3 {
  const yaw = Math.atan2(-dir[1], dir[0]);
  const m = new Matrix4().makeRotationY(yaw).multiply(new Matrix4().makeRotationX(Math.PI / 2));
  const e = new Euler().setFromRotationMatrix(m, 'XYZ');
  return [e.x / DEG, e.y / DEG, e.z / DEG];
}

/**
 * A thin, high arched bridge from `a` to `b` (local x, deck height y, z): a slender deck on a single
 * elliptical arch rib springing from the two abutments `rise` km below the deck, with spandrel posts
 * between rib and deck — side profiles extruded `width` across.
 */
export function archedBridge(k: ProxyKit, a: V3, b: V3, o: { width: number; rise: number; camber: number; color: number }): void {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const L = Math.hypot(dx, dz);
  const dir: V2 = [dx / L, dz / L];
  const nx = -dir[1];
  const nz = dir[0];
  const rot = sideRot(dir);
  const at = (y: number): V3 => [a[0] - nx * (o.width / 2), y, a[2] - nz * (o.width / 2)];
  const y0 = Math.min(a[1], b[1]) - o.rise - 0.05;
  const deckY = (t: number) => a[1] + (b[1] - a[1]) * t + o.camber * Math.sin(Math.PI * t);
  const n = 18;
  const strip = (top: (t: number) => number, bot: (t: number) => number, t0 = 0, t1 = 1): V2[] => {
    const out: V2[] = [];
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      out.push([t * L, -(top(t) - y0)]);
    }
    for (let i = n; i >= 0; i--) {
      const t = t0 + ((t1 - t0) * i) / n;
      out.push([t * L, -(bot(t) - y0)]);
    }
    return out;
  };
  const dT = 0.03;
  k.extrude('stone', strip(deckY, (t) => deckY(t) - dT), o.width, { at: at(y0), rot, color: o.color, grain: 0.2 });
  const spring = (t: number) => deckY(t) - o.rise;
  const rib = (t: number) => spring(t) + (o.rise - dT) * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
  k.extrude('stone', strip(rib, (t) => rib(t) - 0.025), o.width * 0.8, { at: [a[0] - nx * (o.width * 0.4), y0, a[2] - nz * (o.width * 0.4)], rot, color: o.color, grain: 0.2 });
  for (const t of [0.12, 0.22, 0.32, 0.68, 0.78, 0.88]) {
    const top = deckY(t) - dT;
    const bot = rib(t) - 0.01;
    if (top - bot < 0.02) continue;
    k.box('stone', 0.01, top - bot, o.width * 0.7, { at: [a[0] + dx * t, bot, a[2] + dz * t], rot: [0, (Math.atan2(-dz, dx) * 180) / Math.PI, 0], color: o.color, lod: 0 });
  }
}
