import { Euler, Matrix4, Vector3 } from 'three/webgpu';
import { type FamilyId, type LodLevel, type ProxyKit, SINK } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../types.ts';

/**
 * Hobbiton kit helpers (local km, heading 0: x east, z south). Pure functions of their arguments and the
 * kit's ground — no module state. Weathertop and the Grey Havens also use the generic plane helpers
 * (`archOutline`, `planeRot`); they belong in the kit (ProxyKit) once it grows a ground-draped ribbon and
 * a vertical-panel primitive (contract request).
 */

const DEG = Math.PI / 180;

/** timber of posts and door frames, brick of chimneys, the ochre plaster of hobbit-hole fronts */
export const TIMBER = 0x7a5a3a;
/** the dark weathered timber ring round a round door */
export const DOOR_RING = 0x4a3a28;
export const BRICK = 0x6e4e3e;
/** (S4 W5: 30 % less saturated — the S3 rings read as orange halos) */
export const OCHRE = [0xb99f6f, 0xc4ac81, 0xb39668, 0xbfa87b, 0xb09669];
/** round painted doors: green (Bag End), yellow, red, blue */
export const DOORS = [0x2f5d3a, 0xd9a441, 0x8e2f25, 0x3c5f8c];
/**
 * turf of the Hill: the banks of the holes continue the terrain's grass (sampled from the rendered Hill
 * under the golden grade, so the banks read as the hillside, never as lighter caps)
 */
export const TURF = 0x4c7630;
export const LAWN = 0x4f7830;
/** the fill under a garden terrace: a grassy bank (S4 W5: the S3 dry-stone fronts read as pedestals) */
export const BANK = 0x4a6c2c;
/** warm window glow; the yellow-painted frames of the round windows (muted) */
export const WARM = 0xf0a850;
export const WINDOW_FRAME = 0xa88c4a;
/** hedges: dark, dense green */
export const HEDGE = 0x3c5c24;
/** lanes: worn soil (≤ 15 % luminance contrast to the grass), their worn grassy verges */
export const LANE = 0x6c6a52;
export const VERGE = 0x5e6c34;
/** dry-stone retaining faces of the garden terraces (grey), the moss and turf on their tops */
export const DRYSTONE = 0x6c6c5c;
export const MOSS = 0x55702c;
/** pale weathered timber of picket fences */
export const PICKET = 0xb39d78;

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

/** unit ground normal at (x, z) */
export function groundNormal(k: ProxyKit, x: number, z: number, e = 0.03): V3 {
  const gx = (k.ground(x + e, z) - k.ground(x - e, z)) / (2 * e);
  const gz = (k.ground(x, z + e) - k.ground(x, z - e)) / (2 * e);
  const l = Math.hypot(gx, 1, gz);
  return [-gx / l, 1 / l, -gz / l];
}

/** Euler XYZ angles (degrees) of the rotation taking the part axes x, y, z onto X, Y, Z */
export function basisRot(X: V3, Y: V3, Z: V3): V3 {
  const m = new Matrix4().makeBasis(new Vector3(...X), new Vector3(...Y), new Vector3(...Z));
  const e = new Euler().setFromRotationMatrix(m, 'XYZ');
  return [e.x / DEG, e.y / DEG, e.z / DEG];
}

const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

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
export function faceRot(deg: number): V3 {
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
export function archOutline(w: number, hs: number, h: number, foot = 0.03, n = 10): V2[] {
  const out: V2[] = [
    [-w / 2, foot],
    [w / 2, foot],
    [w / 2, -hs],
  ];
  for (let i = 1; i < n; i++) {
    const a = (i / n) * Math.PI;
    out.push([(Math.cos(a) * w) / 2, -(hs + Math.sin(a) * (h - hs))]);
  }
  out.push([-w / 2, -hs]);
  return out;
}

/**
 * A smial facade outline (u, −v) in the door plane: half width `hw`, straight sides to `hs`, then a low
 * rounded "eyebrow" (steep at the ends, flat over the crown) up to `crown`; foot 0.004 below y = 0.
 */
export function eyebrow(hw: number, hs: number, crown: number, n = 12): V2[] {
  const out: V2[] = [
    [-hw, 0.004],
    [hw, 0.004],
  ];
  for (let i = 0; i <= n; i++) {
    const u = 1 - (2 * i) / n;
    out.push([u * hw, -(hs + (crown - hs) * Math.max(0, 1 - u * u) ** 0.7)]);
  }
  return out;
}

/**
 * A strip lying IN the ground along a local polyline (lanes, tracks, ditches): short thin planks, each in
 * the local ground's tangent plane (pitched along the path AND rolled across it), its top `lift` above
 * the terrain; plank widths, sideways offsets and shades jittered and the odd plank dropped, so the
 * verges break up into the grass — no curbs, nothing standing proud of the ground.
 */
export function decal(k: ProxyKit, path: V2[], width: number, o: { fam?: FamilyId; color?: number; step?: number; lift?: number; jitter?: number; gaps?: number; lod?: LodLevel; grain?: number } = {}): void {
  const step = o.step ?? 0.05;
  const thick = 0.006;
  const lift = o.lift ?? 0.0015;
  const jit = o.jitter ?? 1;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < n; j++) {
      const u1 = k.r(21);
      const u2 = k.r(22);
      const u3 = k.r(23);
      const u4 = k.r(24);
      if (u4 < (o.gaps ?? 0.05)) continue;
      const x0 = ax + ((bx - ax) * j) / n;
      const z0 = az + ((bz - az) * j) / n;
      const x1 = ax + ((bx - ax) * (j + 1)) / n;
      const z1 = az + ((bz - az) * (j + 1)) / n;
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      const my = k.ground(mx, mz);
      const Z = norm([x1 - x0, k.ground(x1, z1) - k.ground(x0, z0), z1 - z0]);
      const nn = groundNormal(k, mx, mz);
      const d = nn[0] * Z[0] + nn[1] * Z[1] + nn[2] * Z[2];
      const Y = norm([nn[0] - Z[0] * d, nn[1] - Z[1] * d, nn[2] - Z[2] * d]);
      const X = cross(Y, Z);
      const w = width * (1 - 0.25 * jit + 0.4 * jit * u1);
      const off = (u2 - 0.5) * 0.3 * jit * width;
      const L = Math.hypot(x1 - x0, z1 - z0) * 1.02 + 0.006;
      const s = lift - thick;
      k.box(o.fam ?? 'weathered', w, thick, L, {
        at: [mx + X[0] * off + Y[0] * s, my + X[1] * off + Y[1] * s, mz + X[2] * off + Y[2] * s],
        rot: basisRot(X, Y, Z),
        color: o.color ?? LANE,
        shade: 1 + (u3 - 0.5) * 0.1 * jit,
        grain: o.grain ?? 0.55,
        lod: o.lod ?? 0,
      });
    }
  }
}

/** a lane of worn soil lying in the ground (see `decal`), fading into the grass through a broken verge */
export function lane(k: ProxyKit, path: V2[], width = 0.036): void {
  // (top 4 m above the heightfield: the rendered terrain triangles may stand a little above the bilinear
  // height on steep convex ground, and a lower strip breaks up into dashes there)
  // S4 W5: short, barely jittered planks (0.03 km) so the strip follows the ground as one worn ribbon —
  // the S3 0.09 km planks stepped down the Hill like a LEGO track
  decal(k, path, width * 1.6, { color: VERGE, gaps: 0.08, jitter: 0.3, step: 0.07, lift: 0.0032, grain: 0.75 });
  decal(k, path, width, { color: LANE, gaps: 0, jitter: 0.05, step: 0.035, lift: 0.004 });
}

/**
 * A hedge along a local polyline: a thick clipped volume following the ground, its sides battered in (a
 * rounded-looking section, never a card), its shade broken from step to step — never a string of beads.
 */
export function hedge(k: ProxyKit, path: V2[], h = 0.022, t = 0.032): void {
  // segments ≤ 0.05 km, each a hump-sectioned prism lying along the ground between its ends (pitched with
  // the slope), its foot sunk 0.02 — plain placed parts: no seating contacts (the gate would read the sink
  // across a sloping hedge line as burial)
  const up: V3 = [0, 1, 0];
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.05));
    for (let j = 0; j < n; j++) {
      const x0 = ax + ((bx - ax) * j) / n;
      const z0 = az + ((bz - az) * j) / n;
      const x1 = ax + ((bx - ax) * (j + 1)) / n;
      const z1 = az + ((bz - az) * (j + 1)) / n;
      const y0 = k.ground(x0, z0);
      const y1 = k.ground(x1, z1);
      const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      const D = norm([x1 - x0, y1 - y0, z1 - z0]);
      const d = D[1];
      const U = norm([up[0] - D[0] * d, up[1] - D[1] * d, up[2] - D[2] * d]);
      const R = cross(U, D);
      const hh = h * (0.88 + 0.24 * k.r(46));
      const sec: V2[] = [
        [-t / 2, 0.02],
        [t / 2, 0.02],
        [t / 2, -hh * 0.45],
        [t * 0.38, -hh * 0.85],
        [0, -hh],
        [-t * 0.38, -hh * 0.85],
        [-t / 2, -hh * 0.45],
      ];
      k.extrude('foliage', sec, L + 0.004, { at: [x0 - D[0] * 0.002, y0 - D[1] * 0.002, z0 - D[2] * 0.002], rot: basisRot(R, D, [-U[0], -U[1], -U[2]]), color: HEDGE, shade: 0.88 + k.r(47) * 0.22, lod: 0 });
    }
  }
}

/** a picket fence standing on a level terrace at height `y`: a low rail with pointed pickets */
export function picket(k: ProxyKit, path: V2[], y: number, color = PICKET): void {
  k.wallPath('wood', path, 0.009, 0.003, { at: [0, y - 0.003, 0], color, crenel: { w: 0.0045, h: 0.012, gap: 0.013, shape: 'point', lod: 0 }, lod: 0 });
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
  /** the terrace's front edge: a picket fence, a low hedge, both (fence with a hedge clump), or nothing */
  edge?: 'picket' | 'hedge' | 'none';
  /** turn from the fall line, degrees */
  turn?: number;
  shade?: number;
  /** terrace depth in front of the door (default 0.15 km, shallower on steep ground) and width factor */
  terrace?: number;
  terraceW?: number;
  /** extra: a hedge clump at one corner of the terrace (−1 left, +1 right, 0 none) */
  clump?: -1 | 0 | 1;
}

export interface Hole {
  door: V3;
  /** level of the terrace top */
  ty: number;
  /** facing direction and right-hand vector of the front */
  n: V2;
  r: V2;
  /** centre of the terrace's front edge (where its gate opens) */
  gate: V2;
  /** half width of the terrace */
  hw: number;
}

/**
 * A hobbit-hole dug into the slope, facing down the fall line, behind its own shallow garden terrace: a
 * LEVEL lawn on a low grassy fill in front of the door (its visible drop capped at ≈ 0.025 km) under a
 * mossy turf lip; a vegetable bed and a flower bed on the lawn. The front (S4 W5, the Matamata smials): a
 * low ochre facade with a shallow eyebrow top round the door and windows, set into a thin turf bank face
 * (0.025 km deep) whose brow meets it within 0.01 km — the Hill itself is the turf above (no separate kit
 * mound: kit turf on the Hill shades unlike the terrain grass and read as lighter caps). On the facade a
 * round painted door in a dark timber ring on a stone step, round windows in muted painted frames (warm
 * glass at night when lit), low tufts along the foot of the bank, a short brick chimney poking out of the
 * turf behind (when asked: every third hole), a picket fence or a clipped hedge along the terrace's edge
 * with a gap for the gate, sometimes a hedge clump at a corner. Returns the door and terrace frame.
 */
export function hobbitHole(k: ProxyKit, o: HoleOpts): Hole {
  const { yaw: fall, slope } = fallLine(k, o.at[0], o.at[1]);
  const yaw = fall + (o.turn ?? 0);
  const [nx, nz] = facing(yaw);
  // right-hand vector of the front (house local +x)
  const rx = Math.cos(yaw * DEG);
  const rz = -Math.sin(yaw * DEG);
  const w = o.w;
  const H = w * 0.52;
  const F: V2 = o.at;
  const P = (u: number, v: number): V2 => [F[0] + rx * u + nx * v, F[1] + rz * u + nz * v];
  // ---- the terrace: a level top at the door's foot (ty), filled out over the slope below it
  // (shallow: the retaining face stays low — S4 W5: its visible drop capped at ≈ 0.025 km, so no hole
  // stands on a pedestal)
  const D = Math.min(Math.min(o.terrace ?? 0.12, 0.055 / Math.max(0.2, slope)) * (slope > 0.8 ? 0.4 : 0.62), 0.028 / Math.max(0.2, slope));
  const hw = (w * (o.terraceW ?? 1.2)) / 2;
  const ring = (gw: number, gd: number): V2[] => [P(-hw - gw, -0.03), P(hw + gw, -0.03), P(hw + gw, D * 0.62 + gd * 0.5), P(hw * 0.9 + gw * 0.8, D * 0.9 + gd * 0.85), P(hw * 0.62, D + gd), P(-hw * 0.62, D + gd), P(-hw * 0.9 - gw * 0.8, D * 0.9 + gd * 0.85), P(-hw - gw, D * 0.62 + gd * 0.5)];
  const outline = ring(0, 0);
  const gs = outline.map(([x, z]) => k.ground(x, z));
  // (the fill stands at least 0.021 above its lowest ground: the seating gate's sink allowance)
  const ty = Math.max(k.ground(F[0], F[1]) + 0.003, Math.min(...gs) + 0.021);
  // the body under the lawn: its front is the low dry-stone retaining face, its ends running into the slope
  const high = Math.max(...gs);
  k.extrude('foliage', outline, 0.003, { followGround: true, at: [0, ty - 0.003 - high, 0], taper: 0.12, color: BANK, shade: 0.92 + k.r(31) * 0.12, grain: 0.4, lod: 0 });
  // the lawn on the terrace (a hair proud of the stone top), a mossy turf lip overhanging the face
  const lawnW = hw * 2 - 0.01;
  const lawnD = D - 0.006;
  const lc = P(0, lawnD / 2 - 0.004);
  k.box('foliage', lawnW, 0.003, lawnD, { at: [lc[0], ty - 0.0025, lc[1]], rot: [0, yaw, 0], color: LAWN, shade: 0.92 + k.r(32) * 0.14, lod: 0 });
  k.wallPath('foliage', [P(-hw, D * 0.6), P(-hw * 0.9, D * 0.9 + 0.002), P(-hw * 0.62, D + 0.003), P(hw * 0.62, D + 0.003), P(hw * 0.9, D * 0.9 + 0.002), P(hw, D * 0.6)], 0.006, 0.014, { at: [0, ty - 0.004, 0], color: MOSS, shadeJitter: 0.15, lod: 0 });
  const ly = ty + 0.0005;
  // ---- the door, its plaster surround, the bank face over it and the turf mound behind
  const r = o.doorR ?? H * 0.32;
  const fy = ly + r + 0.004;
  const fx = F[0] + nx * 0.002;
  const fz = F[1] + nz * 0.002;
  const y0 = ty - 0.008;
  // ---- S4 W5 (C2 #1): the front reads as the Matamata smials — a low ochre facade with a shallow eyebrow
  // top round the door and windows, set into a thin turf bank face whose brow meets it within 0.01 km, the
  // hillside swelling softly behind (a smooth low mound) — never an extruded hood on a faceted cap
  const crown = fy + r * 1.08 + 0.008 - y0;
  const fhw = r * 2.8 + 0.012;
  const fhs = r * 1.35 + 0.002;
  // the turf bank face (0.025 deep, flush behind the facade) and the ochre facade on it
  k.extrude('foliage', eyebrow(fhw + 0.009, fhs + 0.004, crown + 0.008), 0.025, { at: [F[0] - nx * 0.027, y0, F[1] - nz * 0.027], rot: planeRot(yaw), color: TURF, grain: 0.35, lod: 1 });
  k.extrude('plaster', eyebrow(fhw, fhs, crown), 0.004, { at: [F[0] - nx * 0.002, y0, F[1] - nz * 0.002], rot: planeRot(yaw), color: o.facade ?? OCHRE[0], shade: o.shade, grain: 0.55, lod: 0 });
  // (no separate turf mound behind the face: any kit turf lying on the Hill shades unlike the terrain's
  // grass and read as lighter caps / patches in every C2 frame — the Hill itself is the bank above the door)
  // the dark timber frame and the painted door on the facade, a stone step
  k.cylinder('wood', r * 1.12, r * 1.12, 0.004, { at: [fx - nx * 0.0015, fy, fz - nz * 0.0015], rot: faceRot(yaw), seg: 12, color: DOOR_RING, lod: 0 });
  k.cylinder('wood', r, r, 0.005, { at: [fx, fy, fz], rot: faceRot(yaw), seg: 12, color: o.door, lod: 0 });
  k.box('weathered', r * 2.2, 0.005, 0.02, { at: [fx + nx * 0.008, ly - 0.003, fz + nz * 0.008], rot: [0, yaw, 0], color: 0x8a8272, lod: 0 });
  // round windows in the facade either side of the door: painted frames round warm glass
  // (glowing at night when lit) or dark glass
  const nw = o.windows ?? 1;
  for (let i = 0; i < nw; i++) {
    const side = i === 0 ? 1 : -1;
    const u = side * (r * 2.3);
    const wx = fx + rx * u;
    const wz = fz + rz * u;
    const wy = fy + r * 0.15;
    k.cylinder('wood', r * 0.5, r * 0.5, 0.004, { at: [wx - nx * 0.0015, wy, wz - nz * 0.0015], rot: faceRot(yaw), seg: 8, color: WINDOW_FRAME, lod: 0 });
    if (o.lit) k.cylinder('emissive', r * 0.34, r * 0.34, 0.005, { at: [wx, wy, wz], rot: faceRot(yaw), seg: 8, color: WARM, glow: { strength: 2.4, gate: 'night', flicker: 0.02 }, lod: 0 });
    else k.cylinder('wood', r * 0.34, r * 0.34, 0.005, { at: [wx, wy, wz], rot: faceRot(yaw), seg: 8, color: 0x3a3226, lod: 0 });
    if (o.spark && i === 0) k.light([wx + nx * 0.004, wy, wz + nz * 0.004], { color: WARM, intensity: 1.1, radius: 0.012, kind: 'window' });
  }
  // grass tufts and the odd muted flower clump along the foot of the bank, breaking its edge (low, squashed:
  // never a string of beads)
  for (const u of [-0.42, -0.3, 0.3, 0.42]) {
    if (k.r(34) < 0.25) continue;
    const [px, pz] = P(u * w * 1.08 + (k.r(35) - 0.5) * 0.01, 0.004);
    const flower = k.r(36) < 0.3;
    const tint = flower ? [0xb8a650, 0x9c6a72, 0xb8b4a0, 0x80688e][Math.floor(k.r(38) * 4)] : [0x5e7a30, 0x6c8038][Math.floor(k.r(39) * 2)];
    k.rock('foliage', 0.009 + k.r(37) * 0.006, { at: [px, ly + 0.002, pz], squash: flower ? 0.55 : 0.7, detail: 0, color: tint, lod: 0 });
  }
  // a short brick chimney with a cap slab poking out of the turf behind the face (its base in the bank or
  // the hillside, whichever is higher there)
  if (o.chimney) {
    const [cx, cz] = P(w * 0.22, -0.1);
    const base = k.ground(cx, cz) - 0.012;
    k.box('plaster', 0.022, 0.045, 0.022, { at: [cx, base, cz], rot: [0, yaw, 0], color: BRICK, grain: 0.5, lod: 0 });
    k.box('weathered', 0.03, 0.006, 0.03, { at: [cx, base + 0.045, cz], rot: [0, yaw, 0], color: 0x5c5650, lod: 0 });
  }
  // ---- the garden on the lawn: a tilled vegetable bed and a flower bed either side of the path
  const bedW = Math.min(0.07, hw * 0.55);
  for (const [s, c] of [
    [-1, 0x5a4630],
    [1, k.r(33) < 0.5 ? 0x3f6b26 : 0x8a5a6a],
  ] as [number, number][]) {
    const [bx, bz] = P(s * (hw * 0.52), D * 0.5);
    k.box('foliage', bedW, 0.005, D * 0.42, { at: [bx, ly - 0.002, bz], rot: [0, yaw, 0], color: c, lod: 0 });
  }
  // ---- the terrace's front edge (a gap in the middle for the gate)
  const gate = P(0, D);
  const g = 0.028;
  const left: V2[] = [P(-hw + 0.006, D * 0.6), P(-hw * 0.88, D * 0.88), P(-hw * 0.6, D - 0.005), P(-g, D - 0.005)];
  const right: V2[] = [P(g, D - 0.005), P(hw * 0.6, D - 0.005), P(hw * 0.88, D * 0.88), P(hw - 0.006, D * 0.6)];
  if (o.edge === 'picket' || o.edge === undefined) {
    picket(k, left, ty);
    picket(k, right, ty);
  } else if (o.edge === 'hedge') {
    // a clipped hedge on the level terrace: a thick battered volume, never a card
    for (const seg of [left, right]) k.wallPath('foliage', seg, 0.026 + k.r(35) * 0.008, 0.03, { at: [0, ty - 0.004, 0], batter: 0.5, shadeJitter: 0.14, color: HEDGE, lod: 0 });
  }
  if (o.clump) {
    const [cx, cz] = P(o.clump * (hw + 0.012), D * 0.4);
    k.rock('foliage', 0.034 + k.r(37) * 0.012, { at: [cx, 0, cz], seat: 'min', squash: 0.85, detail: 1, color: HEDGE, shade: 0.9 + k.r(38) * 0.2, lod: 0 });
  }
  return { door: [fx, fy, fz], ty, n: [nx, nz], r: [rx, rz], gate, hw };
}

/**
 * A stone bridge along +z from (x, z0) to (x, z1), deck `width` wide: a side profile (humped deck over
 * `arches` round arches springing from the water, the ends on the banks) extruded across the stream, a
 * ring of voussoirs proud of both faces round every arch, and a parapet on each side (the same profile, a
 * coping line proud of the deck). The profile lives in the door-plane trick of `extrude` (rot [−90, 0, 90]:
 * outline (p, q) → (−y, q, −p), so p = −s runs along +z, q is up, and the extrusion runs along −x).
 */
export function archBridge(k: ProxyKit, x: number, z0: number, z1: number, o: { width: number; arches: number; water: number; crown: number; rise: number; color: number; parapet?: number }): void {
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
  const spring = o.water - 0.02 - y0;
  const archPts = (sa: number, rr: number, m: number): V2[] => {
    const pts: V2[] = [];
    for (let j = 0; j <= m; j++) {
      const th = (j / m) * Math.PI;
      pts.push([-(sa + span / 2 + Math.cos(th) * (span / 2 + rr)), spring + Math.sin(th) * (o.rise + rr)]);
    }
    return pts;
  };
  for (let a = o.arches - 1; a >= 0; a--) {
    const sa = pier + a * (span + pier);
    const sb = sa + span;
    out.push([-sb, 0], [-sb, spring]);
    for (let j = 1; j < 12; j++) {
      const th = (j / 12) * Math.PI;
      out.push([-(sa + span / 2 + (Math.cos(th) * span) / 2), spring + Math.sin(th) * o.rise]);
    }
    out.push([-sa, spring], [-sa, 0]);
  }
  out.push([0, 0]);
  k.extrude('weathered', out, o.width, { at: [x + o.width / 2, y0, z0], rot: [-90, 0, 90], color: o.color, grain: 0.75 });
  // voussoirs: a ring of paler dressed stones round each arch, a hair proud of both faces
  const vr = Math.min(0.03, span * 0.16);
  for (let a = 0; a < o.arches; a++) {
    const sa = pier + a * (span + pier);
    const outer = archPts(sa, vr, 12);
    const inner = archPts(sa, 0, 12).reverse();
    const ring: V2[] = [...outer, ...inner];
    for (const side of [1, -1]) {
      const xo = side > 0 ? x + o.width / 2 + 0.004 : x - o.width / 2;
      k.extrude('weathered', ring, 0.004, { at: [xo, y0, z0], rot: [-90, 0, 90], color: o.color, shade: 1.18, grain: 0.9, lod: 0 });
    }
  }
  // the parapets: a coping strip along each edge of the deck, a shade darker
  const ph = o.parapet ?? 0.02;
  const strip: V2[] = [];
  for (let i = 0; i <= n; i++) strip.push([-(i / n) * L, deck((i / n) * L) - 0.004 - y0]);
  for (let i = n; i >= 0; i--) strip.push([-(i / n) * L, deck((i / n) * L) + ph - y0]);
  const pt = Math.min(0.012, o.width * 0.15);
  for (const side of [1, -1]) {
    const xo = side > 0 ? x + o.width / 2 + 0.002 : x - o.width / 2 + pt - 0.002;
    k.extrude('weathered', strip, pt, { at: [xo, y0, z0], rot: [-90, 0, 90], color: o.color, shade: 0.9, grain: 0.6, lod: 1 });
  }
}

/**
 * A Shire cottage or inn (Bywater): a stone plinth, ochre / cream plaster walls with dark half-timbering
 * on the front, a deep, steep straw thatch with a big overhang and a ridge roll, a round painted door, a
 * brick chimney and warm windows. Returns the floor height.
 */
export function cottage(k: ProxyKit, at: V2, yaw: number, o: { w: number; d: number; h: number; wall: number; roof: number; door: number; chimney?: boolean; windows?: number; lights?: number; storeys?: number }): number {
  const [x, z] = at;
  const { w, d, h } = o;
  k.house('plaster', 'thatch', w, d, h, {
    at: [x, 0, z],
    rot: [0, yaw, 0],
    pitch: 54,
    overhang: Math.min(w, d) * 0.22,
    color: o.wall,
    roofColor: o.roof,
    roofGrain: 0.65,
    dig: 0.25,
    plinthFam: 'weathered',
    plinthColor: 0x857d6c,
    plinthGrow: 1.05,
    ridge: { color: 0x6e5c3a, size: d * 0.1 },
    chimney: o.chimney,
    ...(o.lights ? { windows: { count: o.lights, on: 1, sides: 1 as const, size: 0.012, color: WARM } } : {}),
  });
  const [cx, cz] = facing(yaw);
  const rx = Math.cos(yaw * DEG);
  const rz = -Math.sin(yaw * DEG);
  const f = houseFloor(k, at, w, d, h, yaw, 0.25);
  // a round door and window frames on the front, dark timber framing across it
  k.cylinder('wood', d * 0.2, d * 0.2, 0.005, { at: [x + cx * (d / 2 + 0.002), f + d * 0.2 + 0.004, z + cz * (d / 2 + 0.002)], rot: faceRot(yaw), seg: 10, color: o.door, lod: 0 });
  const storeys = o.storeys ?? 1;
  for (const u of [-0.47, -0.2, 0.2, 0.47]) {
    if (Math.abs(u * w) < d * 0.24) continue;
    k.box('wood', 0.007, h * 0.94, 0.004, { at: [x + rx * u * w + cx * (d / 2 + 0.002), f + SINK, z + rz * u * w + cz * (d / 2 + 0.002)], rot: [0, yaw, 0], color: 0x4a3a28, lod: 0 });
  }
  for (let s = 1; s <= storeys; s++) {
    const yb = f + SINK + (h * s) / (storeys + 1);
    k.box('wood', w * 0.98, 0.006, 0.004, { at: [x + cx * (d / 2 + 0.002), yb, z + cz * (d / 2 + 0.002)], rot: [0, yaw, 0], color: 0x4a3a28, lod: 0 });
  }
  for (let i = 0; i < (o.windows ?? 2); i++) {
    const u = (i % 2 === 0 ? 1 : -1) * w * (0.3 + 0.1 * Math.floor(i / 2));
    k.box('wood', 0.022, 0.018, 0.004, { at: [x + rx * u + cx * (d / 2 + 0.003), f + h * 0.42, z + rz * u + cz * (d / 2 + 0.003)], rot: [0, yaw, 0], color: WINDOW_FRAME, lod: 0 });
  }
  return f;
}
