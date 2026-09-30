import { Euler, Matrix4 } from 'three/webgpu';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../types.ts';

/**
 * Hobbiton kit helpers (local km, heading 0: x east, z south). Pure functions of their arguments and the
 * kit's ground — no module state.
 */

const DEG = Math.PI / 180;
/** kit seating sink (ProxyKit SINK) */
const SINK = 0.02;

/** timber of door frames and fences, brick of chimneys, the ochre plaster of hobbit-hole fronts */
export const TIMBER = 0x8a6a44;
export const BRICK = 0x8c5a3c;
export const OCHRE = [0xc9a45f, 0xd2b073, 0xc39a58, 0xceac6c];
/** round painted doors: green (Bag End), yellow, red, blue */
export const DOORS = [0x2f5d3a, 0xd9a441, 0x8e2f25, 0x3c5f8c];
/** turf of the Hill (the barrel roofs of the holes and their terrace banks continue it) */
export const TURF = 0x5a6e2c;
/** warm window glow */
export const WARM = 0xf0a850;

/** unit vector a house with yaw `deg` faces (its local +z) */
export function facing(deg: number): V2 {
  return [Math.sin(deg * DEG), Math.cos(deg * DEG)];
}

/** the local fall line at (x, z): yaw (deg) that points a house's +z downhill, and the slope */
export function fallLine(k: ProxyKit, x: number, z: number): { yaw: number; slope: number } {
  const e = 0.06;
  const gx = (k.ground(x + e, z) - k.ground(x - e, z)) / (2 * e);
  const gz = (k.ground(x, z + e) - k.ground(x, z - e)) / (2 * e);
  return { yaw: (Math.atan2(-gx, -gz) * 180) / Math.PI, slope: Math.hypot(gx, gz) };
}

/**
 * The floor height the kit gives a SEATED house (ProxyKit.house: the minimum ground under its corners and
 * centre, or dug in at most `dig` wall heights on the uphill side), so parts can be placed on its front.
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

/**
 * A disk / ring facing along the horizontal direction of yaw `deg` (a house front's +z): a cylinder whose
 * axis is turned from +y to that direction (rot z 90° takes +y to −x, then the yaw turns −x onto it).
 */
function faceRot(deg: number): V3 {
  return [0, deg + 90, 90];
}

export interface HoleOpts {
  /** local ground position of the hole's front centre */
  at: V2;
  /** width of the ochre front, km */
  w: number;
  door: number;
  /** door radius, km */
  doorR?: number;
  facade?: number;
  windows?: number;
  chimney?: boolean;
  /** record a warm window light (night) */
  lit?: boolean;
  /** a low hedge along the garden's downhill edge */
  fence?: boolean;
  /** turn from the fall line, degrees */
  turn?: number;
  shade?: number;
}

/**
 * Euler XYZ angles (degrees) that stand an `extrude` outline up in a vertical plane facing yaw `deg`:
 * Ry(yaw)·Rx(90°) — outline (u, −v) → right u, up v; the extrusion runs along the facing direction.
 */
export function planeRot(deg: number): V3 {
  const m = new Matrix4().makeRotationY(deg * DEG).multiply(new Matrix4().makeRotationX(Math.PI / 2));
  const e = new Euler().setFromRotationMatrix(m, 'XYZ');
  return [e.x / DEG, e.y / DEG, e.z / DEG];
}

/** a round-headed outline (u, −v) in the door plane: width w, springing at hs, crown at h, foot buried */
function archOutline(w: number, hs: number, h: number, foot = 0.03): V2[] {
  const out: V2[] = [
    [-w / 2, foot],
    [w / 2, foot],
    [w / 2, -hs],
  ];
  for (let i = 1; i < 10; i++) {
    const a = (i / 10) * Math.PI;
    out.push([(Math.cos(a) * w) / 2, -(hs + Math.sin(a) * (h - hs))]);
  }
  out.push([-w / 2, -hs]);
  return out;
}

/**
 * A hobbit-hole dug into the slope, facing down the fall line: the ochre plastered front with a round head,
 * a turf hood over it (the same round head, larger, extruded back into the hill until the slope buries
 * it), a round painted door in a timber frame, round windows either side, a brick chimney out of the turf
 * behind, a low hedge along the garden. Returns the door centre (local) for lights.
 */
export function hobbitHole(k: ProxyKit, o: HoleOpts): V3 {
  const { yaw: fall } = fallLine(k, o.at[0], o.at[1]);
  const yaw = fall + (o.turn ?? 0);
  const [nx, nz] = facing(yaw);
  // right-hand vector of the front (house local +x)
  const rx = Math.cos(yaw * DEG);
  const rz = -Math.sin(yaw * DEG);
  const w = o.w;
  const H = w * 0.52;
  const F: V2 = o.at;
  // the front stands on the ground at its foot (the slope rises behind it into the hood)
  const y0 = k.ground(F[0], F[1]) - 0.004;
  // the turf hood: a larger round head extruded 0.24 km back into the hill (the slope buries its back)
  const hood = 0.24;
  k.extrude('foliage', archOutline(w * 1.3, H * 0.55, H * 1.28, 0.06), hood, {
    at: [F[0] - nx * (hood + 0.012), y0, F[1] - nz * (hood + 0.012)],
    rot: planeRot(yaw),
    color: TURF,
    lod: 1,
  });
  // the ochre front
  const t = 0.03;
  k.extrude('plaster', archOutline(w, H * 0.45, H, 0.04), t, {
    at: [F[0] - nx * t, y0, F[1] - nz * t],
    rot: planeRot(yaw),
    color: o.facade ?? OCHRE[0],
    shade: o.shade,
    grain: 0.15,
    lod: 1,
  });
  const r = o.doorR ?? H * 0.3;
  const fy = y0 + r + 0.006;
  const fx = F[0] + nx * 0.002;
  const fz = F[1] + nz * 0.002;
  // timber frame ring, then the painted door
  k.ring('wood', r * 1.14, r * 0.28, 0.006, { at: [fx, fy, fz], rot: faceRot(yaw), seg: 14, color: TIMBER, lod: 0 });
  k.cylinder('wood', r, r, 0.005, { at: [fx, fy, fz], rot: faceRot(yaw), seg: 14, color: o.door, lod: 0 });
  // round windows either side of the door (dark glass; lit ones record a warm light)
  const nw = o.windows ?? 1;
  for (let i = 0; i < nw; i++) {
    const side = i === 0 ? 1 : -1;
    const u = side * (r * 2.15);
    const wx = fx + rx * u;
    const wz = fz + rz * u;
    k.cylinder('wood', r * 0.42, r * 0.42, 0.005, { at: [wx, fy + r * 0.2, wz], rot: faceRot(yaw), seg: 10, color: 0x3a3226, lod: 0 });
    if (o.lit && i === 0) k.light([wx + nx * 0.01, fy + r * 0.2, wz + nz * 0.01], { color: WARM, intensity: 1.1, radius: 0.012, kind: 'window' });
  }
  const at: V2 = [F[0] - nx * 0.12, F[1] - nz * 0.12];
  const d = 0.24;
  // chimney: brick stack standing out of the turf above the hole
  if (o.chimney) {
    const cx = at[0] - nx * d * 0.35 + rx * w * 0.25;
    const cz = at[1] - nz * d * 0.35 + rz * w * 0.25;
    k.box('plaster', 0.022, 0.07, 0.022, { at: [cx, 0, cz], seat: 'mean', rot: [0, yaw, 0], color: BRICK, lod: 0 });
  }
  // the garden in front: a short hedge of leafy clumps along its downhill edge
  if (o.fence) {
    for (let j = -1; j <= 1; j++) {
      const hx = F[0] + nx * 0.17 + rx * j * w * 0.42;
      const hz = F[1] + nz * 0.17 + rz * j * w * 0.42;
      k.rock('foliage', 0.028 + 0.006 * ((j + 2) % 2), { at: [hx, 0, hz], seat: true, squash: 0.8, detail: 1, color: [0x44602a, 0x3e5826, 0x4b6630][j + 1], lod: 0 });
    }
  }
  return [fx, fy, fz];
}

/**
 * A stone bridge along +z from (x, z0) to (x, z1), deck `width` wide: a side profile (humped deck over
 * `arches` round arches springing from the water, the ends on the banks) extruded across the stream. The
 * profile lives in the door-plane trick of `extrude` (rot [−90, 0, 90]: outline (p, q) → (−y, q, −p), so
 * p = −s runs along +z, q is up, and the extrusion runs along −x).
 */
export function archBridge(
  k: ProxyKit,
  x: number,
  z0: number,
  z1: number,
  o: { width: number; arches: number; water: number; crown: number; rise: number; color: number },
): void {
  const L = z1 - z0;
  const y0 = Math.min(k.ground(x, z0), k.ground(x, z1), o.water) - 0.3;
  const yEnd0 = k.ground(x, z0) + 0.012;
  const yEnd1 = k.ground(x, z1) + 0.012;
  const deck = (s: number) => {
    const t = s / L;
    // ends on the banks, a gentle hump to the crown over the stream
    return yEnd0 + (yEnd1 - yEnd0) * t + (o.crown - (yEnd0 + (yEnd1 - yEnd0) * 0.5)) * Math.sin(t * Math.PI) ** 0.7;
  };
  const out: V2[] = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * L;
    out.push([-s, deck(s) - y0]);
  }
  // down the far end, then back along the bottom with the arches cut into it
  out.push([-L, 0]);
  const span = (L * 0.72) / o.arches;
  const pier = (L - span * o.arches) / (o.arches + 1);
  for (let a = o.arches - 1; a >= 0; a--) {
    const sa = pier + a * (span + pier);
    const sb = sa + span;
    const spring = o.water - 0.02 - y0;
    out.push([-sb, 0], [-sb, spring]);
    for (let j = 1; j < 10; j++) {
      const th = (j / 10) * Math.PI;
      out.push([-(sa + span / 2 + (Math.cos(th) * span) / 2), spring + Math.sin(th) * o.rise]);
    }
    out.push([-sa, spring], [-sa, 0]);
  }
  out.push([0, 0]);
  k.extrude('stone', out, o.width, { at: [x + o.width / 2, y0, z0], rot: [-90, 0, 90], color: o.color, grain: 0.35 });
}
