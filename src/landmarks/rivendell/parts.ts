import { Euler, Matrix4 } from 'three/webgpu';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../types.ts';

/**
 * Rivendell kit helpers (local km, heading 0: x east, z south). Pure functions of their arguments and the
 * kit's ground — no module state.
 */

/** pale elven stone, slate roofs, warm lamp light */
export const STONE = 0xe0d3b0;
export const STONE2 = 0xcdbd96;
export const SLATE = 0x5e5b50;
export const SLATE2 = 0x66625a;
export const LAMP = 0xffc27a;

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

/** the part of a polyline between arc lengths s0 and s1 (km), resampled every `step` km */
export function subPath(path: V2[], s0: number, s1: number, step = 0.25): V2[] {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const at = (s: number): V2 => {
    let i = 1;
    while (i < path.length - 1 && cum[i] < s) i++;
    const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1])));
    return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t];
  };
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  return Array.from({ length: n + 1 }, (_, i) => at(s0 + ((s1 - s0) * i) / n));
}

/** total arc length of a polyline, km */
export function pathLength(path: V2[]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return s;
}

export interface HallOpts {
  at: V2;
  /** yaw (deg): the long side faces local +z rotated by it */
  yaw: number;
  w: number;
  d: number;
  h: number;
  roof?: 'gable' | 'hip';
  pitch?: number;
  /** lit windows on the long sides */
  windows?: number;
  shade?: number;
}

/**
 * An elven hall: pale stone walls under a steep slate roof with a pale ridge, seated on its terrace (a
 * ground-following stone plinth on the slope), lit windows on both long sides.
 */
export function hall(k: ProxyKit, o: HallOpts): void {
  const roof = o.roof ?? 'gable';
  k.house('stone', 'slate', o.w, o.d, o.h, {
    at: [o.at[0], 0, o.at[1]],
    rot: [0, o.yaw, 0],
    roof,
    pitch: o.pitch ?? 56,
    overhang: Math.min(o.w, o.d) * 0.1,
    dig: 0.3,
    color: STONE,
    shade: o.shade ?? 1.12,
    roofColor: roof === 'hip' ? SLATE2 : SLATE,
    roofGrain: 0.35,
    plinthFam: 'stone',
    plinthColor: STONE2,
    plinthGrow: 1.12,
    ...(roof === 'gable' ? { ridge: { fam: 'stone' as const, color: 0xe2d6b4, size: 0.012 }, gableBoards: { fam: 'stone' as const, color: 0xe6dcc0, size: 0.01, horn: 0.03 } } : {}),
    ...(o.windows ? { windows: { count: o.windows, on: 0.85, sides: 2 as const, size: 0.014, color: LAMP, intensity: 1.2 } } : {}),
  });
  // a slender balcony along each long side at half height (close-range detail, LOD0 only)
  const c = Math.cos((o.yaw * Math.PI) / 180);
  const s = Math.sin((o.yaw * Math.PI) / 180);
  const ground = Math.min(k.ground(o.at[0], o.at[1]), k.ground(o.at[0] + s * o.d * 0.5, o.at[1] + c * o.d * 0.5));
  for (const side of [1, -1]) {
    const off = side * (o.d / 2 + 0.012);
    k.box('stone', o.w * 0.8, 0.008, 0.024, { at: [o.at[0] + s * off, ground + o.h * 0.5, o.at[1] + c * off], rot: [0, o.yaw, 0], color: 0xe8ddc2, lod: 0 });
  }
}

/** a slender elven tower: pale shaft, a slate spire or a pale dome, a ring of lit windows */
export function spireTower(k: ProxyKit, at: V2, r: number, h: number, o: { roof?: 'spire' | 'dome' | 'cone'; lit?: number } = {}): void {
  k.tower('stone', r, h, {
    at: [at[0], 0, at[1]],
    seat: true,
    sides: 10,
    taper: 0.12,
    roof: o.roof ?? 'spire',
    roofFam: o.roof === 'dome' ? 'stone' : 'slate',
    roofColor: o.roof === 'dome' ? 0xe0d4b0 : SLATE,
    roofH: o.roof === 'dome' ? r * 1.1 : r * (o.roof === 'cone' ? 2 : 3.4),
    color: STONE,
    ...(o.lit ? { windows: { count: o.lit, rows: 1, on: 1, size: 0.013, color: LAMP, intensity: 1.2 } } : {}),
  });
}

/**
 * A terrace for a group of halls: a level pale-stone platform whose top sits on the highest ground under
 * it (its downhill side a stone retaining wall), rectangular, turned by `yaw`.
 */
export function terrace(k: ProxyKit, at: V2, w: number, d: number, yaw: number, lift = 0.012): void {
  const c = Math.cos((yaw * Math.PI) / 180);
  const s = Math.sin((yaw * Math.PI) / 180);
  const loc = (x: number, z: number): V2 => [at[0] + x * c + z * s, at[1] - x * s + z * c];
  k.extrude('stone', [loc(-w / 2, -d / 2), loc(w / 2, -d / 2), loc(w / 2, d / 2), loc(-w / 2, d / 2)], lift, { followGround: true, color: STONE2, grain: 0.3 });
}

const DEG = Math.PI / 180;

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
