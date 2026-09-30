import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';

/**
 * Mount Doom's kit parts: the crater's lava pool and the glowing lip where lava spills over the rim, a few
 * irregular lava flows traced down the stamped gullies (steepest descent on the composite ground, so they
 * follow the real gullies — never evenly spaced dashes), the Sammath Naur door high on the east flank
 * with the winding path up to it, and scattered volcanic blocks (hero range only). Lights: lava records
 * at the crater, the door and along the flows (always on).
 */

/** crater radius (km) — shared with the massif stamp */
export const CRATER_R = 2.3;

const DEG = Math.PI / 180;
/** local (x, z) at compass azimuth `az` (0 = north, 90 = east) and distance `d` from the summit */
export const polar = (az: number, d: number): V2 => [Math.sin(az * DEG) * d, -Math.cos(az * DEG) * d];

/** lava paint: hot at the rim, darker, redder crust lower down */
/**
 * Lava paint. `wallPath` does not forward a `glow` override (ProxyKit passes only lod / colour / shade /
 * tint to its ribbon), so the ribbons burn at the lava preset's strength (3.2) and their brightness is set
 * by the paint: dark reds × 3.2 ≈ the emissive of a bright red at ~0.35 (brighter clips to white under
 * AgX). The lava lake and the door (glow override honoured) use the bright hot paint at low strength.
 */
const LAVA_HOT = 0xf54a10;
const LIP = 0x5c1606;
const LAVA = 0x661806;
const LAVA_WARM = 0x541204;
const LAVA_CRUST = 0x420d03;

/**
 * Steepest-descent path over the composite ground from `start`, `len` km in `step` km steps, with inertia
 * and a slow deterministic meander (author stream); stops early where the slope dies out on the apron.
 */
function descend(k: ProxyKit, start: V2, len: number, step = 0.2, wander = 0.35): V2[] {
  const pts: V2[] = [start];
  let [x, z] = start;
  let pdx = 0;
  let pdz = 0;
  const e = 0.2;
  for (let s = 0; s < len; s += step) {
    const gx = (k.ground(x + e, z) - k.ground(x - e, z)) / (2 * e);
    const gz = (k.ground(x, z + e) - k.ground(x, z - e)) / (2 * e);
    const g = Math.hypot(gx, gz);
    if (g < 0.12) break;
    let dx = -gx / g + 0.8 * pdx;
    let dz = -gz / g + 0.8 * pdz;
    const a = (k.r() - 0.5) * wander;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    [dx, dz] = [dx * c - dz * sn, dx * sn + dz * c];
    const l = Math.hypot(dx, dz) || 1;
    pdx = dx / l;
    pdz = dz / l;
    x += pdx * step;
    z += pdz * step;
    pts.push([x, z]);
  }
  return pts;
}

/** point at arc length `t` (km) along a polyline */
function along(path: V2[], t: number): V2 {
  let acc = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const l = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
    if (acc + l >= t) {
      const f = l > 0 ? (t - acc) / l : 0;
      return [path[i][0] + (path[i + 1][0] - path[i][0]) * f, path[i][1] + (path[i + 1][1] - path[i][1]) * f];
    }
    acc += l;
  }
  return path[path.length - 1];
}

function pathLength(path: V2[]): number {
  let acc = 0;
  for (let i = 0; i + 1 < path.length; i++) acc += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
  return acc;
}

/**
 * The flows: [rim azimuth, length km, width km, lights along it]. Irregular on purpose — most on the
 * south and west flanks the hero camera sees, one long tongue, a short spill on the north-east.
 */
const FLOWS: [number, number, number, number][] = [
  [158, 9.5, 0.15, 3],
  [196, 6.5, 0.16, 2],
  [214, 11, 0.22, 3],
  [262, 4.5, 0.13, 1],
  [118, 5.5, 0.15, 1],
  [34, 3.5, 0.12, 1],
];

/** arcs of the rim where lava spills over the lip: [from az, to az] */
const RIM_ARCS: [number, number][] = [
  [152, 194],
  [203, 221],
  [252, 270],
  [24, 41],
  [110, 123],
];

/** the Sammath Naur: azimuth (toward Barad-dûr, 57°) and distance from the summit */
export const DOOR_AZ = 66;
export const DOOR_D = 5.4;

export function buildDoom(k: ProxyKit): void {
  const g = (p: V2) => k.ground(p[0], p[1]);

  // ---- the crater: a lava lake on its floor (seen from above) and the glowing lip where lava spills
  const floor = g([0, 0]);
  k.cylinder('lava', 1.35, 1.5, 0.35, { at: [0, floor - 0.2, 0], seg: 28, color: LAVA_HOT, glow: { strength: 0.5 } });
  for (const [a0, a1] of RIM_ARCS) {
    const pts: V2[] = [];
    const n = Math.max(3, Math.round((a1 - a0) / 6));
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      // just outside the crest (the crater wall inside it drops sheer), wandering a little: the lip where
      // it spills
      pts.push(polar(a, CRATER_R + 0.36 + 0.06 * Math.sin(i * 1.7 + a0)));
    }
    k.wallPath('lava', pts, 0.45, 0.13, { followGround: true, step: 0.12, color: LIP });
  }
  // the crater glow on the lip, round the rim (no light on the crater floor: seen from the plain it would
  // sit behind the rim)
  for (const a of [176, 261, 33, 117]) {
    const p = polar(a, CRATER_R + 0.36);
    k.light([p[0], g(p) + 0.46, p[1]], { kind: 'lava', color: 0xff5a1a, intensity: 0.5, radius: 0.18 });
  }

  // ---- the flows: traced down the gullies from the rim, cooling as they go (hot and wide at the lip,
  // a darker, redder, thinner tongue below), the longest ones braiding into a side branch
  let lights = 0;
  FLOWS.forEach(([az, len, w, nl], fi) => {
    const start = polar(az, CRATER_R + 0.45);
    const path = descend(k, start, len);
    if (path.length < 4) return;
    const L = pathLength(path);
    // three stages sharing their joint points (one continuous flow)
    const c1 = Math.max(1, Math.round(path.length * 0.35));
    const c2 = Math.max(c1 + 1, Math.round(path.length * 0.7));
    const stages: [V2[], number, number][] = [
      [path.slice(0, c1 + 1), w, LAVA],
      [path.slice(c1, c2 + 1), w * 0.72, LAVA_WARM],
      [path.slice(c2), w * 0.5, LAVA_CRUST],
    ];
    for (const [pts, ww, color] of stages) if (pts.length >= 2) k.wallPath('lava', pts, 0.3, ww, { followGround: true, color });
    // a side branch splitting off the long flows a little below the middle
    if (len > 8) {
      const j = Math.round(path.length * 0.45);
      const [x0, z0] = path[j];
      const [x1, z1] = path[j + 1];
      const side = fi % 2 ? 1 : -1;
      const l = Math.hypot(x1 - x0, z1 - z0) || 1;
      const branch = descend(k, [x0 + (side * -(z1 - z0) * 0.3) / l, z0 + (side * (x1 - x0) * 0.3) / l], len * 0.28);
      if (branch.length >= 3) k.wallPath('lava', [path[j], ...branch], 0.28, w * 0.45, { followGround: true, color: LAVA_CRUST });
    }
    for (let i = 0; i < nl && lights < 12; i++, lights++) {
      const p = along(path, L * (0.3 + 0.55 * (i / Math.max(1, nl - 1))));
      k.light([p[0], g(p) + 0.18, p[1]], { kind: 'lava', color: 0xff4a12, intensity: 0.3 - i * 0.05, radius: 0.08 });
    }
  });

  // ---- the Sammath Naur: a dark doorway let into the east flank, facing Barad-dûr, a glow inside
  const dp = polar(DOOR_AZ, DOOR_D);
  const nx = Math.sin(DOOR_AZ * DEG);
  const nz = -Math.cos(DOOR_AZ * DEG);
  // ground at the sill (the front face) — the body digs back into the rising slope
  const sill: V2 = [dp[0] + nx * 0.25, dp[1] + nz * 0.25];
  const gy = g(sill);
  const yaw = 180 - DOOR_AZ;
  k.box('darkStone', 0.62, 0.62, 0.7, { at: [dp[0], gy - 0.1, dp[1]], rot: [0, yaw, 0], color: 0x1a1614 });
  k.box('darkStone', 0.8, 0.12, 0.5, { at: [dp[0] + nx * 0.12, gy + 0.5, dp[1] + nz * 0.12], rot: [0, yaw, 0], color: 0x151210, lod: 1 });
  const glowAt: V3 = [dp[0] + nx * 0.37, gy + 0.02, dp[1] + nz * 0.37];
  k.box('lava', 0.24, 0.36, 0.05, { at: glowAt, rot: [0, yaw, 0], color: 0xff6418, glow: { strength: 0.5 } });
  k.light([glowAt[0], glowAt[1] + 0.18, glowAt[2]], { kind: 'lava', color: 0xff6a1a, intensity: 0.6, radius: 0.1 });
  // a ledge in front of the door (the path's end)
  k.extrude('darkStone', [[-0.35, -0.25], [0.35, -0.25], [0.35, 0.25], [-0.35, 0.25]], 0.02, { at: [sill[0] + nx * 0.2, 0, sill[1] + nz * 0.2], rot: [0, yaw, 0], followGround: true, color: 0x2a2624, lod: 0 });

  // ---- the path: from the plain on the east, switchbacks up the flank to the door
  const PATH: V2[] = [
    polar(92, 14.5),
    polar(84, 12.2),
    polar(58, 11.0),
    polar(76, 9.4),
    polar(54, 8.1),
    polar(72, 6.6),
    polar(DOOR_AZ - 3, DOOR_D + 0.55),
  ];
  // (a ledge: its uphill edge is let into the slope, its downhill lip stands proud)
  k.wallPath('weathered', PATH, 0.3, 0.08, { followGround: true, color: 0x4d4843, lod: 0 });

  // ---- volcanic blocks and cinder heaps on the apron and the lower flanks (hero range only)
  k.scatter(
    { annulus: { at: [0, 0], r0: 6, r1: 16 } },
    76,
    (_i, x, z, u) => k.rock('darkStone', 0.09 + u * 0.16, { at: [x, 0, z], seat: true, squash: 0.65, lump: 0.3, detail: 1, color: u > 0.6 ? 0x2a2522 : 0x1f1b19, lod: 0 }),
    { minSpacing: 0.75, avoid: [{ at: polar(DOOR_AZ, DOOR_D), r: 1.2 }] },
  );
}
