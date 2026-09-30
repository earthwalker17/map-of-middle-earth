import { Euler, Matrix4 } from 'three/webgpu';
import { type FamilyId, type ProxyKit, SINK } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../types.ts';

/**
 * Rivendell kit helpers (local km, heading 0: x east, z south). Pure functions of their arguments and the
 * kit's ground — no module state.
 */

/** warm off-white elven stone, grey-blue slate roofs, warm lamp light, dark window glass */
export const STONE = 0xdcd2bf;
export const STONE2 = 0xc9bea6;
export const SLATE = 0x66717c;
export const SLATE2 = 0x6d7782;
export const LAMP = 0xffc27a;
const GLASS = 0x34383c;
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

export interface HallOpts {
  at: V2;
  /** yaw (deg): the long side faces local +z rotated by it */
  yaw: number;
  w: number;
  d: number;
  h: number;
  pitch?: number;
  /** lit windows on the long sides */
  windows?: number;
  /** a cross-gable on the front (a gabled wing across the ridge, its gable facing out) */
  cross?: boolean;
  /** dormers on the front roof slope */
  dormers?: number;
}

/** how deep halls dig into the uphill side of their terrace (wall heights) */
const DIG = 0.6;

/**
 * An elven hall (the film's pale, steep-gabled, many-dormered houses): warm off-white walls under a steep
 * grey-blue slate gable roof with a dark ridge, seated on its terrace (a ground-following stone plinth on
 * the slope); rows of tall narrow dark window insets on both long sides, a tall dark arched opening in
 * each gable end, an optional cross-gable on the front and dormers on the front slope, a slender balcony
 * along the front; lit windows on both long sides.
 */
export function hall(k: ProxyKit, o: HallOpts): void {
  const pitch = o.pitch ?? 50;
  const c = Math.cos(o.yaw * DEG);
  const s = Math.sin(o.yaw * DEG);
  /** house-local (x along the ridge, z toward the front) → local */
  const loc = (x: number, z: number): V2 => [o.at[0] + x * c + z * s, o.at[1] - x * s + z * c];
  k.house('stone', 'slate', o.w, o.d, o.h, {
    at: [o.at[0], 0, o.at[1]],
    rot: [0, o.yaw, 0],
    roof: 'gable',
    pitch,
    overhang: Math.min(o.w, o.d) * 0.1,
    dig: DIG,
    color: STONE,
    roofColor: SLATE,
    roofGrain: 0.3,
    // on the sloping edge of a terrace: a grassy bank, not a tall stone plinth (no crates on stilts)
    bank: { fam: 'foliage', color: 0x5f6a34, slope: 42, ledge: 0.012 },
    ridge: { fam: 'slate', color: 0x464e57, size: 0.008 },
    ...(o.windows ? { windows: { count: o.windows, on: 0.85, sides: 2 as const, size: 0.014, color: LAMP, intensity: 1.2 } } : {}),
  });
  // the wall bottom: the kit's seated floor + its sink
  const y0 = houseFloor(k, o.at, o.w, o.d, o.h, o.yaw, DIG) + SINK;
  const tan = Math.tan(pitch * DEG);
  const rise = (o.d / 2) * tan;
  const yawRot: V3 = [0, o.yaw, 0];
  // tall narrow window insets along both long sides (dark glass, a hair proud of the wall)
  const bays = Math.max(2, Math.round(o.w / 0.07));
  for (const side of [1, -1]) {
    for (let i = 0; i < bays; i++) {
      const u = (-0.5 + (i + 0.5) / bays) * o.w * 0.86;
      const [x, z] = loc(u, side * (o.d / 2 + 0.002));
      k.box('stone', 0.016, o.h * 0.5, 0.004, { at: [x, y0 + o.h * 0.25, z], rot: yawRot, color: GLASS, lod: 0 });
    }
  }
  // a tall dark arched opening in each gable end
  for (const side of [1, -1]) {
    const [x, z] = loc(side * (o.w / 2 + 0.002), 0);
    k.box('stone', 0.004, o.h * 0.45 + rise * 0.45, o.d * 0.22, { at: [x, y0 + o.h * 0.4, z], rot: yawRot, color: GLASS, lod: 0 });
  }
  // the cross-gable: a gabled wing across the ridge on the front, its gable facing out
  if (o.cross) {
    const cw = o.w * 0.3;
    const cz = o.d * 0.3;
    const [x, z] = loc(o.w * 0.08, cz);
    k.house('stone', 'slate', o.d * 0.95, cw, o.h, {
      at: [x, y0, z],
      rot: [0, o.yaw + 90, 0],
      seat: false,
      roof: 'gable',
      pitch: pitch + 4,
      overhang: cw * 0.12,
      color: STONE,
      roofColor: SLATE2,
      roofGrain: 0.3,
      ridge: { fam: 'slate', color: 0x464e57, size: 0.007 },
    });
    // its gable window
    const [gx, gz] = loc(o.w * 0.08, cz + (o.d * 0.95) / 2 + 0.002);
    k.box('stone', cw * 0.3, o.h * 0.5 + rise * 0.3, 0.004, { at: [gx, y0 + o.h * 0.35, gz], rot: yawRot, color: GLASS, lod: 0 });
  }
  // dormers on the front slope, halfway up the roof
  const nd = o.dormers ?? 0;
  for (let i = 0; i < nd; i++) {
    const u = (-0.5 + (i + 0.5) / nd) * o.w * 0.6 - (o.cross ? o.w * 0.18 : 0);
    const [x, z] = loc(u, o.d / 4);
    const dw = Math.min(0.06, o.w * 0.14);
    k.house('stone', 'slate', o.d * 0.32, dw, dw * 0.7, {
      at: [x, y0 + o.h + (o.d / 4) * tan * 0.9 - dw * 0.35, z],
      rot: [0, o.yaw + 90, 0],
      seat: false,
      roof: 'gable',
      pitch: 55,
      overhang: dw * 0.12,
      color: STONE,
      roofColor: SLATE2,
      lod: 0,
    });
  }
  // a slender balcony along the front at mid height (close-range detail, LOD0 only)
  const [bx, bz] = loc(0, o.d / 2 + 0.014);
  k.box('stone', o.w * 0.7, 0.008, 0.026, { at: [bx, y0 + o.h * 0.48, bz], rot: yawRot, color: 0xe8dfca, lod: 0 });
}

/** a slender elven tower: pale shaft, a slate spire or a pale dome, a ring of lit windows */
export function spireTower(k: ProxyKit, at: V2, r: number, h: number, o: { roof?: 'spire' | 'dome' | 'cone'; lit?: number; spire?: number } = {}): void {
  k.tower('stone', r, h, {
    at: [at[0], 0, at[1]],
    seat: true,
    sides: 10,
    taper: 0.12,
    roof: o.roof ?? 'spire',
    roofFam: o.roof === 'dome' ? 'stone' : 'slate',
    roofColor: o.roof === 'dome' ? 0xe4dac4 : SLATE,
    roofH: o.roof === 'dome' ? r * 1.1 : r * (o.roof === 'cone' ? 2 : (o.spire ?? 3.4)),
    color: STONE,
    ...(o.lit ? { windows: { count: o.lit, rows: 1, on: 1, size: 0.013, color: LAMP, intensity: 1.2 } } : {}),
  });
}

/**
 * A pale streak of falling water draped down the terrain from `a` to `b` (local x, z; the S4 waterfalls'
 * static placeholder): a thin ground-following ribbon `width` km wide, foam white.
 */
export function fallStreak(k: ProxyKit, a: V2, b: V2, width: number): void {
  // only where the ground falls steeply (the fall itself; below it the stream and the terrain carry on)
  const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.04));
  const pts: V2[] = Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as V2);
  let run: V2[] = [];
  const flush = () => {
    if (run.length >= 2) drape(k, 'plaster', run, width, { color: 0xdfe8ea, step: 0.04, lift: 0.01, jitter: 0.25 });
    run = [];
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[i + 1];
    const steep = (k.ground(x0, z0) - k.ground(x1, z1)) / Math.hypot(x1 - x0, z1 - z0) > 1.2;
    if (steep) {
      if (!run.length) run.push(pts[i]);
      run.push(pts[i + 1]);
    } else flush();
  }
  flush();
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
  // normal of the side plane (the extrusion direction): dir turned so the strip centres on the axis
  const nx = -dir[1];
  const nz = dir[0];
  const rot = sideRot(dir);
  const at = (y: number): V3 => [a[0] - nx * (o.width / 2), y, a[2] - nz * (o.width / 2)];
  const y0 = Math.min(a[1], b[1]) - o.rise - 0.05;
  const deck = (t: number) => a[1] + (b[1] - a[1]) * t + o.camber * Math.sin(Math.PI * t);
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
  const dT = 0.035;
  // the deck
  k.extrude('stone', strip(deck, (t) => deck(t) - dT), o.width, { at: at(y0), rot, color: o.color, grain: 0.2 });
  // the rib: an elliptical arch from springing to springing, meeting the deck at the crown
  const spring = (t: number) => deck(t) - o.rise;
  const rib = (t: number) => spring(t) + (o.rise - dT) * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
  k.extrude('stone', strip(rib, (t) => rib(t) - 0.03), o.width * 0.8, { at: [a[0] - nx * (o.width * 0.4), y0, a[2] - nz * (o.width * 0.4)], rot, color: o.color, grain: 0.2 });
  // slender posts between the rib and the deck
  for (const t of [0.12, 0.22, 0.32, 0.68, 0.78, 0.88]) {
    const top = deck(t) - dT;
    const bot = rib(t) - 0.01;
    if (top - bot < 0.02) continue;
    k.box('stone', 0.012, top - bot, o.width * 0.7, { at: [a[0] + dx * t, bot, a[2] + dz * t], rot: [0, (Math.atan2(-dz, dx) * 180) / Math.PI, 0], color: o.color, lod: 0 });
  }
}

/**
 * A thin band draped on the ground along a local polyline (lanes, streaks): tilted planks `step` km long,
 * each lying along the ground between its ends (level across), `t` thick with its top `lift` above the
 * ground; `jitter` varies each plank's top (± jitter·lift) and paint (± jitter), for hedges. Plain placed
 * boxes — flush ground decals and strips, not seated parts (no seating contacts: the seating gate would
 * read their sink as burial).
 */
export function drape(k: ProxyKit, fam: FamilyId, path: V2[], width: number, o: { color: number; t?: number; lift?: number; step?: number; shade?: number; jitter?: number; lod?: 0 | 1 | 2 }): void {
  const t = o.t ?? 0.02;
  const lift = o.lift ?? 0.007;
  const step = o.step ?? 0.05;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < n; j++) {
      const x0 = ax + ((bx - ax) * j) / n;
      const z0 = az + ((bz - az) * j) / n;
      const x1 = ax + ((bx - ax) * (j + 1)) / n;
      const z1 = az + ((bz - az) * (j + 1)) / n;
      const y0 = k.ground(x0, z0);
      const y1 = k.ground(x1, z1);
      const hl = Math.hypot(x1 - x0, z1 - z0);
      const yaw = Math.atan2(x1 - x0, z1 - z0);
      const pitch = Math.atan2(y1 - y0, hl);
      const m = new Matrix4().makeRotationY(yaw).multiply(new Matrix4().makeRotationX(-pitch));
      const e = new Euler().setFromRotationMatrix(m, 'XYZ');
      const jt = o.jitter ? (k.r(11) - 0.5) * 2 * o.jitter : 0;
      // the plank's base centre: under the segment's midpoint, `t − lift` below the ground there
      k.box(fam, width, t + jt * lift, Math.hypot(hl, y1 - y0) + 0.004, {
        at: [(x0 + x1) / 2, (y0 + y1) / 2 - (t - lift), (z0 + z1) / 2],
        rot: [e.x / DEG, e.y / DEG, e.z / DEG],
        color: o.color,
        shade: (o.shade ?? 1) * (1 + jt * 0.5),
        lod: o.lod ?? 0,
      });
    }
  }
}
