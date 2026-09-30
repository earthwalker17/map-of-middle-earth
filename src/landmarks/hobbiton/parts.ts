import { Euler, Matrix4 } from 'three/webgpu';
import { type FamilyId, type ProxyKit, SINK } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../types.ts';

/**
 * Hobbiton kit helpers (local km, heading 0: x east, z south). Pure functions of their arguments and the
 * kit's ground — no module state.
 */

const DEG = Math.PI / 180;

/** timber of door frames and fences, brick of chimneys, the ochre plaster of hobbit-hole fronts */
export const TIMBER = 0x8a6a44;
export const BRICK = 0x7a5a48;
export const OCHRE = [0xc9a45f, 0xd2b073, 0xc39a58, 0xceac6c];
/** round painted doors: green (Bag End), yellow, red, blue */
export const DOORS = [0x2f5d3a, 0xd9a441, 0x8e2f25, 0x3c5f8c];
/** turf of the Hill (the hoods of the holes continue it) */
export const TURF = 0x4f7a2a;
/** warm window glow */
export const WARM = 0xf0a850;
/** hedges: dark, dense green */
export const HEDGE = 0x33521f;
/** lanes: pale beaten earth */
export const LANE = 0xa6906a;

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
 * A continuous hedge along a local polyline: a ground-following strip `h` tall and `t` thick with an
 * uneven top (short planks of varying height and shade), dark green — never a string of beads.
 */
export function hedge(k: ProxyKit, path: V2[], h = 0.03, t = 0.024): void {
  drape(k, 'foliage', path, t, { color: HEDGE, t: h + 0.03, lift: h, step: 0.03, jitter: 0.3 });
}

/** a pale beaten-earth lane `width` km wide draped on the ground along a local polyline */
export function lane(k: ProxyKit, path: V2[], width = 0.034): void {
  drape(k, 'weathered', path, width, { color: LANE, step: 0.05, lift: 0.003 });
}

/** a low post-and-rail fence along a local polyline (a thin rail, posts every 0.04 km) */
export function fence(k: ProxyKit, path: V2[]): void {
  k.wallPath('wood', path, 0.018, 0.003, { followGround: true, step: 0.04, color: 0x8f7a5a, crenel: { w: 0.004, h: 0.008, gap: 0.036, lod: 0 }, lod: 0 });
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
  /** its round windows glow at night; `spark` also records a window light (EmissionSystem) */
  lit?: boolean;
  spark?: boolean;
  /** the garden's front edge: a low hedge, a post-and-rail fence or nothing */
  edge?: 'hedge' | 'fence';
  /** turn from the fall line, degrees */
  turn?: number;
  shade?: number;
}

/**
 * A hobbit-hole dug into the slope, facing down the fall line: the ochre plastered front with a round head,
 * a turf hood over it (the same round head, larger, running back into the hill and narrowing, so it
 * sinks into the slope like a mound), a round painted door in a timber frame, round windows either side
 * (glowing warm at night when lit), a stubby brick chimney with a cap on the hood behind the front, a
 * garden in front (a tilled bed and a vegetable bed, flowers) closed by a low hedge or a post-and-rail
 * fence. Returns the door centre (local).
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
  // the turf hood: a short brow (the same round head, larger) framing the front from behind, and behind it a draped turf
  // mound rising out of the slope over the hole (kit mound: every vertex rides the ground) — the hill
  // swelling over the door, never a prism standing on the slope
  const { slope } = fallLine(k, F[0], F[1]);
  k.extrude('foliage', archOutline(w * 1.3, H * 0.55, H * 1.28, 0.06), 0.1, {
    at: [F[0] - nx * 0.112, y0, F[1] - nz * 0.112],
    rot: planeRot(yaw),
    color: TURF,
    lod: 1,
  });
  const mr = w * 0.8;
  const mc: V2 = [F[0] - nx * (0.1 + mr * 0.3), F[1] - nz * (0.1 + mr * 0.3)];
  k.mound('foliage', mr, Math.max(0.03, H * 1.3 - slope * (0.1 + mr * 0.3)), { at: [mc[0], 0, mc[1]], seg: 12, color: TURF, lod: 1 });
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
  // round windows either side of the door: warm glass that glows at night when lit, dark otherwise
  const nw = o.windows ?? 1;
  for (let i = 0; i < nw; i++) {
    const side = i === 0 ? 1 : -1;
    const u = side * (r * 2.15);
    const wx = fx + rx * u;
    const wz = fz + rz * u;
    const wy = fy + r * 0.2;
    k.ring('wood', r * 0.5, r * 0.16, 0.006, { at: [wx, wy, wz], rot: faceRot(yaw), seg: 10, color: TIMBER, lod: 0 });
    if (o.lit) k.cylinder('emissive', r * 0.42, r * 0.42, 0.005, { at: [wx, wy, wz], rot: faceRot(yaw), seg: 10, color: WARM, glow: { strength: 2.4, gate: 'night', flicker: 0.02 }, lod: 0 });
    else k.cylinder('wood', r * 0.42, r * 0.42, 0.005, { at: [wx, wy, wz], rot: faceRot(yaw), seg: 10, color: 0x3a3226, lod: 0 });
    if (o.spark && i === 0) k.light([wx + nx * 0.004, wy, wz + nz * 0.004], { color: WARM, intensity: 1.1, radius: 0.012, kind: 'window' });
  }
  // a stubby brick chimney with a cap slab, on the hood 0.1 km behind the front
  if (o.chimney) {
    const cx = F[0] - nx * 0.1 + rx * w * 0.25;
    const cz = F[1] - nz * 0.1 + rz * w * 0.25;
    const base = Math.max(k.ground(cx, cz), y0 + 0.63 * w) - 0.012;
    k.box('plaster', 0.03, 0.072, 0.03, { at: [cx, base, cz], rot: [0, yaw, 0], color: BRICK, lod: 0 });
    k.box('weathered', 0.042, 0.008, 0.042, { at: [cx, base + 0.072, cz], rot: [0, yaw, 0], color: 0x5c5650, lod: 0 });
  }
  // the garden in front: a tilled bed and a vegetable bed, flowers by the door, and its front edge
  const g = (u: number, v: number): V2 => [F[0] + nx * v + rx * u, F[1] + nz * v + rz * u];
  const bed = (u: number, v: number, color: number) => drape(k, 'foliage', [g(u, v - 0.025), g(u, v + 0.025)], 0.07, { color, t: 0.016, lift: 0.005 });
  bed(-w * 0.3, 0.09, 0x5a4630);
  bed(w * 0.3, 0.09, 0x3f6b26);
  for (const [u, c] of [
    [-r * 3.3, 0xd9c24a],
    [r * 3.3, 0xc95f7a],
  ] as [number, number][]) {
    const [x, z] = g(u, 0.03);
    k.rock('foliage', 0.014, { at: [x, 0, z], seat: true, squash: 0.8, detail: 1, color: c, lod: 0 });
  }
  const edge: V2[] = [g(-w * 0.62, 0.15), g(-w * 0.2, 0.16), g(w * 0.2, 0.16), g(w * 0.62, 0.15)];
  if (o.edge === 'hedge') hedge(k, edge, 0.028, 0.022);
  else if (o.edge === 'fence') fence(k, edge);
  return [fx, fy, fz];
}

/**
 * A stone bridge along +z from (x, z0) to (x, z1), deck `width` wide: a side profile (humped deck over
 * `arches` round arches springing from the water, the ends on the banks) extruded across the stream, with
 * a parapet on each side (the same profile, a coping line proud of the deck). The profile lives in the
 * door-plane trick of `extrude` (rot [−90, 0, 90]: outline (p, q) → (−y, q, −p), so p = −s runs along +z,
 * q is up, and the extrusion runs along −x).
 */
export function archBridge(
  k: ProxyKit,
  x: number,
  z0: number,
  z1: number,
  o: { width: number; arches: number; water: number; crown: number; rise: number; color: number; parapet?: number },
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
    for (let j = 1; j < 12; j++) {
      const th = (j / 12) * Math.PI;
      out.push([-(sa + span / 2 + (Math.cos(th) * span) / 2), spring + Math.sin(th) * o.rise]);
    }
    out.push([-sa, spring], [-sa, 0]);
  }
  out.push([0, 0]);
  k.extrude('weathered', out, o.width, { at: [x + o.width / 2, y0, z0], rot: [-90, 0, 90], color: o.color, grain: 0.5 });
  // the parapets: a coping strip along each edge of the deck, a shade darker
  const ph = o.parapet ?? 0.02;
  const strip: V2[] = [];
  for (let i = 0; i <= n; i++) strip.push([-(i / n) * L, deck((i / n) * L) - 0.004 - y0]);
  for (let i = n; i >= 0; i--) strip.push([-(i / n) * L, deck((i / n) * L) + ph - y0]);
  const pt = Math.min(0.012, o.width * 0.15);
  for (const side of [1, -1]) {
    const xo = side > 0 ? x + o.width / 2 + 0.002 : x - o.width / 2 + pt - 0.002;
    k.extrude('weathered', strip, pt, { at: [xo, y0, z0], rot: [-90, 0, 90], color: o.color, shade: 0.88, grain: 0.4, lod: 1 });
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
