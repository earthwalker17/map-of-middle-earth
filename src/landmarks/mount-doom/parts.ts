import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';

/**
 * Mount Doom's kit parts: the crater (a lava lake on its floor and one soft crater glow rising from
 * behind the lip), a few lava flows traced down the stamped gullies (steepest
 * descent on the composite ground, so they follow the real gullies), the Sammath Naur door high on the
 * east flank with the winding path up to it, and scattered volcanic blocks (hero range only).
 *
 * A flow (see `flow`): two or three braided strands spilling from just below the rim lip (spread ≈ 0.8 km
 * at the vent), joining into one tapering tongue (0.26 → 0.12 km at the toe) whose paint alternates
 * between long hot runs and short dark crust breaks along its length (crust lengthens downstream), over a
 * 2.5–3× wider draped underlay of very dim red — the glow spilling onto the rock either side. Lights only where the flow is on the hero
 * cameras' flank, seated on the ribbon's top.
 */

/** crater radius (km) of the cone stamp (index.ts) */
export const CRATER_R = 2.4;

const DEG = Math.PI / 180;
const SINK = 0.02;
/** local (x, z) at compass azimuth `az` (0 = north, 90 = east) and distance `d` from the summit */
export const polar = (az: number, d: number): V2 => [Math.sin(az * DEG) * d, -Math.cos(az * DEG) * d];

/**
 * Lava paint. `wallPath` and `mound` do not forward a `glow` override (ProxyKit passes only lod / colour /
 * shade / tint to their bodies), so these ribbons burn at the lava preset's strength (3.2) and their
 * brightness is set by the paint: dark reds × 3.2 ≈ the emissive of a bright red at ~0.35 (brighter
 * clips to white under AgX). The lava lake and the door (glow override honoured) use a dark paint at
 * high strength: the glow material's albedo is the paint × 0.25, so a bright paint reads as a sun-lit
 * tan panel by day.
 */
const LAVA_HOT = 0x7a1c06;
/**
 * hot runs, by stage (vent → toe): × 3.2 their red channel stays ≲ 0.3 linear, where the glow keeps its
 * colour under AgX; no green in the paint, so the glow material's 'hot' facing-the-viewer term (which
 * raises green toward orange) leaves them red enough for the Mordor grade's red exemption
 */
const RUN: number[] = [0x5a0e02, 0x4c0b02, 0x3e0902];
/** the crust between the runs: near-black red (a faint glow in the cracks) */
const CRUST = 0x140401;
/** the underlay: the glow spilling onto the flank (upper, lower half) — barely there, a red cast */
const SPILL: [number, number] = [0x1c0602, 0x140401];

/**
 * Steepest-descent path over the composite ground from `start`, `len` km in `step` km steps, with inertia
 * and a slow deterministic meander (author stream); stops early where the slope dies out on the apron.
 */
function descend(k: ProxyKit, start: V2, len: number, step = 0.2, wander = 0.3): V2[] {
  const pts: V2[] = [start];
  let [x, z] = start;
  let pdx = 0;
  let pdz = 0;
  const e = 0.2;
  for (let s = 0; s < len; s += step) {
    const gx = (k.ground(x + e, z) - k.ground(x - e, z)) / (2 * e);
    const gz = (k.ground(x, z + e) - k.ground(x, z - e)) / (2 * e);
    const g = Math.hypot(gx, gz);
    if (g < 0.1) break;
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

/** cumulative arc length at every vertex of a polyline */
function arcs(path: V2[]): number[] {
  const out = [0];
  for (let i = 0; i + 1 < path.length; i++) out.push(out[i] + Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]));
  return out;
}

/** point and unit direction at arc length `t` (km) along a polyline */
function along(path: V2[], s: number[], t: number): { p: V2; d: V2 } {
  let i = 0;
  while (i + 2 < path.length && s[i + 1] < t) i++;
  const l = s[i + 1] - s[i] || 1;
  const f = Math.min(1, Math.max(0, (t - s[i]) / l));
  const d: V2 = [(path[i + 1][0] - path[i][0]) / l, (path[i + 1][1] - path[i][1]) / l];
  return { p: [path[i][0] + (path[i + 1][0] - path[i][0]) * f, path[i][1] + (path[i + 1][1] - path[i][1]) * f], d };
}

/** the sub-polyline between arc lengths t0 and t1 (inclusive end points) */
function slice(path: V2[], s: number[], t0: number, t1: number): V2[] {
  const out: V2[] = [along(path, s, t0).p];
  for (let i = 0; i < path.length; i++) if (s[i] > t0 && s[i] < t1) out.push(path[i]);
  out.push(along(path, s, t1).p);
  return out;
}

/** the rim crest along azimuth `az`: radius and height of the highest ground between 1 and 5 km */
function crest(k: ProxyKit, az: number): { r: number; h: number } {
  let best = { r: CRATER_R, h: -1e9 };
  for (let r = 1; r <= 5; r += 0.05) {
    const p = polar(az, r);
    const h = k.ground(p[0], p[1]);
    if (h > best.h) best = { r, h };
  }
  return best;
}

/** where a ribbon of half-width hw stands at p (wallPath: the lower ground under its two edges) */
function ribbonTop(k: ProxyKit, p: V2, d: V2, hw: number, h: number): number {
  return Math.min(k.ground(p[0] - d[1] * hw, p[1] + d[0] * hw), k.ground(p[0] + d[1] * hw, p[1] - d[0] * hw)) + h;
}

/** a flow description: rim azimuth, length (km), vent width (km), braided strands, lights */
interface Flow {
  az: number;
  len: number;
  w0: number;
  strands: number;
  lights: number;
}

/**
 * The flows. Two thick ones on the flank the hero cameras face (south-south-east), a thinner one on the
 * west-south-west and a short one on the east (the Sammath Naur side, seen from Barad-dûr). One light,
 * on the hero flow's upper tongue (the flank the hero cameras face): sprites are not occluded by the
 * terrain yet, so any light on another flank shows through the cone.
 */
const FLOWS: Flow[] = [
  { az: 152, len: 13.5, w0: 0.8, strands: 3, lights: 1 },
  { az: 194, len: 11.5, w0: 0.75, strands: 2, lights: 0 },
  { az: 238, len: 6.5, w0: 0.45, strands: 2, lights: 0 },
  { az: 104, len: 5.5, w0: 0.4, strands: 1, lights: 0 },
];

/** ribbon heights: the hot tongue stands a little proud of the draped spill */
const FLOW_H = 0.2;
/** the ribbons' sides slope in (top 40 % of the base width): a low rounded tongue, not a tube with walls */
const LAVA_BATTER = 0.6;

function flow(k: ProxyKit, f: Flow): void {
  // start 0.4 below the rim lip on the outer flank (never poking over the silhouette)
  const c = crest(k, f.az);
  let r0 = c.r;
  for (let r = c.r; r < c.r + 3; r += 0.05) {
    const p = polar(f.az, r);
    r0 = r;
    if (k.ground(p[0], p[1]) <= c.h - 0.4) break;
  }
  const path = descend(k, polar(f.az, r0), f.len);
  if (path.length < 6) return;
  const s = arcs(path);
  const L = s[s.length - 1];
  // the flow's envelope (the braid's spread, the spill's width) and the tongue ribbon's own width: a
  // ribbon wider than ~0.3 km cannot follow the gully's cross-section (wallPath stands on the lower of
  // its two edges, so it floats over a V and buries on a cross-slope — the seating gate); the breadth
  // near the vent comes from the braided strands and the spill
  const width = (t: number) => f.w0 + (0.2 - f.w0) * Math.min(1, t / L) ** 0.8;
  const ribbon = (t: number) => Math.min(0.26, f.w0) - 0.14 * Math.min(1, t / L) ** 0.8;
  // the underlay: overlapping draped discs of dim spill, 2.5–3× the tongue's width (scalloped, soft edges)
  for (let t = 0.1; t < L - 0.2; t += 0.45 + 0.25 * k.r()) {
    const { p } = along(path, s, t);
    const rad = 1.35 * width(t) + 0.12;
    k.mound('lava', rad, 0.03, { at: [p[0], 0, p[1]], seg: 10, color: SPILL[t < L * 0.5 ? 0 : 1], lod: 0 });
  }
  // the braided upper stage: strands fanning out from the main line near the vent and joining it at T
  const T = Math.min(L * 0.32, 3.2);
  if (f.strands > 1) {
    for (let j = 0; j < f.strands; j++) {
      const side = f.strands === 2 ? (j ? 1 : -1) : j - 1;
      const amp = f.w0 * (0.32 + 0.15 * k.r()) * side;
      const pts: V2[] = [];
      for (let t = 0; t <= T + 1e-6; t += 0.2) {
        const { p, d } = along(path, s, t);
        const o = amp * Math.max(0, 1 - t / T) ** 0.7 * (1 + 0.25 * Math.sin(t * 2.3 + j * 1.7));
        pts.push([p[0] - d[1] * o, p[1] + d[0] * o]);
      }
      const ws = Math.min(0.18, (f.w0 / f.strands) * (0.85 + 0.2 * k.r()));
      k.wallPath('lava', pts, FLOW_H, ws, { followGround: true, batter: LAVA_BATTER, color: RUN[j % 2] });
    }
  }
  // the tongue: from the vent (single-strand flows) or the braid's junction down to the toe, in runs of
  // hot lava and dark crust (crust lengthens downstream)
  let t = f.strands > 1 ? T - 0.3 : 0;
  let hot = true;
  while (t < L - 0.05) {
    const u = t / L;
    const run = hot ? 0.6 + 0.9 * k.r() * (1 - u) : 0.08 + 0.22 * k.r() * (0.4 + u);
    const t1 = Math.min(L, t + run);
    const pts = slice(path, s, t, t1);
    if (pts.length >= 2) {
      const stage = Math.min(2, Math.floor(u * 3));
      k.wallPath('lava', pts, FLOW_H, ribbon((t + t1) / 2), { followGround: true, batter: LAVA_BATTER, color: hot ? RUN[stage] : CRUST });
    }
    t = t1;
    hot = !hot;
  }
  // lights on the ribbon's top (the hero flank only)
  for (let i = 0; i < f.lights; i++) {
    const ti = L * (0.22 + 0.3 * i);
    const { p, d } = along(path, s, ti);
    k.light([p[0], ribbonTop(k, p, d, ribbon(ti) / 2, FLOW_H) + 0.03, p[1]], { kind: 'lava', color: 0xff4a12, intensity: 0.1, radius: 0.15 });
  }
}

/** the Sammath Naur: azimuth (toward Barad-dûr, which stands at bearing ≈ 56° — the door looks a little south of it, onto the path) and distance from the summit */
export const DOOR_AZ = 66;
export const DOOR_D = 5.4;

export function buildDoom(k: ProxyKit): void {
  const g = (p: V2) => k.ground(p[0], p[1]);

  // ---- the crater: a lava lake on its floor (seen from above) and one soft crater glow at the rim's
  // height over the crater centre — depth-tested, so from the plain the near rim hides its lower half and
  // it rises from behind the lip as a glow over the crater (not a row of beads on the rim, not an orb)
  const floor = g([0, 0]);
  k.cylinder('lava', 1.35, 1.5, 0.35, { at: [0, floor - 0.2, 0], seg: 28, color: LAVA_HOT, glow: { strength: 2.4 } });
  let rim = -1e9;
  for (let i = 0; i < 24; i++) rim = Math.max(rim, crest(k, (i / 24) * 360).h);
  k.light([0, rim - 0.25, 0], { kind: 'lava', color: 0xff5a1a, intensity: 0.12, radius: 0.6 });

  // ---- the flows
  for (const f of FLOWS) flow(k, f);

  // ---- the Sammath Naur: a dark doorway let into the east flank, facing Barad-dûr, a glow inside
  const dp = polar(DOOR_AZ, DOOR_D);
  const nx = Math.sin(DOOR_AZ * DEG);
  const nz = -Math.cos(DOOR_AZ * DEG);
  // ground at the sill (the front face) — the body digs back into the rising slope
  const sill: V2 = [dp[0] + nx * 0.3, dp[1] + nz * 0.3];
  const gy = g(sill);
  const yaw = 180 - DOOR_AZ;
  // a heavy dark frame let into the slope (two jambs and a lintel, their backs buried in the rising
  // ground) round the glowing opening — no free-standing block
  const tx = -nz;
  const tz = nx;
  const fx = dp[0] + nx * 0.4;
  const fz = dp[1] + nz * 0.4;
  for (const sd of [-1, 1]) k.box('darkStone', 0.14, 0.72, 0.36, { at: [fx + tx * sd * 0.27, gy - 0.08, fz + tz * sd * 0.27], rot: [0, yaw, 0], color: 0x1a1614, lod: 0 });
  k.box('darkStone', 0.76, 0.16, 0.4, { at: [fx, gy + 0.56, fz], rot: [0, yaw, 0], color: 0x151210, lod: 0 });
  const glowAt: V3 = [dp[0] + nx * 0.44, gy - 0.05, dp[1] + nz * 0.44];
  k.box('lava', 0.4, 0.6, 0.05, { at: glowAt, rot: [0, yaw, 0], color: LAVA_HOT, glow: { strength: 2.4 } });
  k.light([glowAt[0] + nx * 0.03, glowAt[1] + 0.3, glowAt[2] + nz * 0.03], { kind: 'lava', color: 0xff6a1a, intensity: 0.3, radius: 0.12 });
  // a ledge in front of the door (the path's end)
  k.extrude('darkStone', [[-0.45, -0.3], [0.45, -0.3], [0.45, 0.3], [-0.45, 0.3]], 0.02, { at: [sill[0] + nx * 0.25, 0, sill[1] + nz * 0.25], rot: [0, yaw, 0], followGround: true, color: 0x2a2624, lod: 0 });

  // ---- the path: from the plain on the east, switchbacks up the flank to the door — a narrow ledge let
  // into the slope (0.24 on its downhill lip, ~0.14 above the uphill ground: on a 45° flank a lower
  // ribbon would be buried under its own uphill edge)
  const PATH: V2[] = [polar(95, 19), polar(86, 15.5), polar(62, 13.5), polar(80, 11), polar(56, 9.4), polar(74, 7.6), polar(DOOR_AZ - 3, DOOR_D + 0.6)];
  k.wallPath('weathered', PATH, 0.24, 0.1, { followGround: true, color: 0x4d4843, lod: 0 });

  // ---- volcanic blocks and cinder heaps on the apron and the lower flanks (hero range only)
  k.scatter(
    { annulus: { at: [0, 0], r0: 7, r1: 24 } },
    90,
    (_i, x, z, u) => k.rock('darkStone', 0.09 + u * 0.18, { at: [x, 0, z], seat: true, squash: 0.65, lump: 0.3, detail: 1, color: u > 0.6 ? 0x2a2522 : 0x1f1b19, lod: 0 }),
    { minSpacing: 0.8, avoid: [{ at: polar(DOOR_AZ, DOOR_D), r: 1.2 }] },
  );
}
