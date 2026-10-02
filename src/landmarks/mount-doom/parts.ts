import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';
import { type DoomFlow, DOOM_FLOWS } from './flows.ts';

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
/** compass azimuth of the notch cut in the crater lip on the hero side (index.ts), the hero flow's vent */
export const NOTCH_AZ = 166;

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

/** ribbon heights: the hot tongue stands a little proud of the ground */
const FLOW_H = 0.2;
/** the ribbons' sides slope in (top 40 % of the base width): a low rounded tongue, not a tube with walls */
const LAVA_BATTER = 0.6;
/** widest lane (km): a ribbon wider than ≈ 0.25 km cannot follow a gully's cross-section (wallPath stands on the lower of its two edges) */
const LANE_MAX = 0.22;
/** the pools on the plain: hot core paint, crusted rim paint */
const POOL_HOT = 0x6a1203;
const POOL_RIM = 0x1e0602;

/** a unit vector on a compass heading (deg) */
const headingDir = (h: number): V2 => [Math.sin(h * DEG), -Math.cos(h * DEG)];

/**
 * The flow's centreline: the steepest descent from the vent down the cone's gullies for `coneKm`, then a
 * Hermite ease onto the authored toe and heading (flows.ts) — the terrain's flow continues from there.
 */
function flowPath(k: ProxyKit, f: DoomFlow, vent: V2): V2[] {
  // the trace, smoothed (a 1-2-1 filter, three passes: no sharp kinks for the side lanes to fold over)
  let cone = descend(k, vent, f.coneKm);
  for (let pass = 0; pass < 3; pass++)
    cone = cone.map((p, i): V2 => (i === 0 || i === cone.length - 1 ? p : [(cone[i - 1][0] + 2 * p[0] + cone[i + 1][0]) / 4, (cone[i - 1][1] + 2 * p[1] + cone[i + 1][1]) / 4]));
  const p0 = cone[cone.length - 1];
  const q = cone[Math.max(0, cone.length - 4)];
  const dl = Math.hypot(p0[0] - q[0], p0[1] - q[1]) || 1;
  const d0: V2 = [(p0[0] - q[0]) / dl, (p0[1] - q[1]) / dl];
  const p1: V2 = [f.toe[0], f.toe[1]];
  const d1 = headingDir(f.heading);
  const D = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const n = Math.max(2, Math.ceil(D / 0.2));
  const out = cone.slice();
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
    const h10 = t ** 3 - 2 * t ** 2 + t;
    const h01 = -2 * t ** 3 + 3 * t ** 2;
    const h11 = t ** 3 - t ** 2;
    out.push([h00 * p0[0] + h10 * d0[0] * D + h01 * p1[0] + h11 * d1[0] * D, h00 * p0[1] + h10 * d0[1] * D + h01 * p1[1] + h11 * d1[1] * D]);
  }
  return out;
}

/**
 * The widest ribbon (≤ `w`) that stays seated along `pts`: wallPath stands on the lower of its two edges, so
 * where it crosses the slope or a rib's crest its centre line is buried by the ground's rise across it —
 * kept under ≈ 40 % of the ribbon's height (sampled every 0.1 km; never narrower than 0.05 km).
 */
function fitWidth(k: ProxyKit, pts: V2[], w: number): number {
  const s = arcs(pts);
  const L = s[s.length - 1];
  const n = Math.max(2, Math.ceil(L / 0.1));
  const bury = (ww: number): number => {
    let worst = 0;
    for (let i = 0; i <= n; i++) {
      const { p, d } = along(pts, s, (L * i) / n);
      const h = ww / 2;
      const lo = Math.min(k.ground(p[0] - d[1] * h, p[1] + d[0] * h), k.ground(p[0] + d[1] * h, p[1] - d[0] * h));
      worst = Math.max(worst, k.ground(p[0], p[1]) - lo);
    }
    return worst;
  };
  let ww = w;
  while (ww > 0.05 && bury(ww) > 0.4 * FLOW_H) ww *= 0.8;
  return Math.max(0.05, ww);
}

/** a polyline offset sideways by o(t) (t = arc length) */
function offsetPath(path: V2[], s: number[], o: (t: number) => number): V2[] {
  return path.map((p, i) => {
    const { d } = along(path, s, Math.min(s[s.length - 1] - 1e-6, s[i]));
    const oo = o(s[i]);
    return [p[0] - d[1] * oo, p[1] + d[0] * oo];
  });
}

/**
 * One lane of a flow: runs of hot lava and dark crust along it (the crust lengthening downstream; the
 * outer lanes of a wide flow mostly crust — the crusted edges — the middle lane mostly hot).
 */
function lane(k: ProxyKit, pts: V2[], w: number, hotShare: number, t0 = 0): void {
  const s = arcs(pts);
  const L = s[s.length - 1];
  let t = t0;
  let hot = k.r() < hotShare + 0.3;
  while (t < L - 0.05) {
    const u = t / L;
    const run = hot ? (0.4 + 0.9 * k.r() * (1 - u)) * (0.4 + hotShare) : 0.08 + 0.3 * k.r() * (0.4 + u) * (1.4 - hotShare);
    const t1 = Math.min(L, t + run);
    const seg = slice(pts, s, t, t1);
    if (seg.length >= 2) {
      const stage = Math.min(2, Math.floor(u * 3));
      k.wallPath('lava', seg, FLOW_H, fitWidth(k, seg, w * (1 - 0.3 * u)), { followGround: true, batter: LAVA_BATTER, color: hot ? RUN[stage] : CRUST, step: 0.15 });
    }
    t = t1;
    hot = !hot;
  }
}

/** a glowing pool on the plain: a crusted rim disc and a hot core, draped on the ground */
function pool(k: ProxyKit, p: V2, r: number): void {
  k.mound('lava', r, 0.03, { at: [p[0], 0, p[1]], seg: 14, color: POOL_RIM, lod: 0 });
  k.mound('lava', r * 0.62, 0.05, { at: [p[0] + r * 0.08, 0, p[1] - r * 0.05], seg: 12, color: POOL_HOT, lod: 0 });
}

function flow(k: ProxyKit, f: DoomFlow): void {
  // start 0.4 below the rim lip on the outer flank (never poking over the silhouette)
  const c = crest(k, f.az);
  let r0 = c.r;
  for (let r = c.r; r < c.r + 3; r += 0.05) {
    const p = polar(f.az, r);
    r0 = r;
    if (k.ground(p[0], p[1]) <= c.h - 0.4) break;
  }
  const path = flowPath(k, f, polar(f.az, r0));
  if (path.length < 6) return;
  const s = arcs(path);
  const L = s[s.length - 1];
  // ---- the braided upper stage: strands fanning out from the main line near the vent and joining it at T
  const T = Math.min(L * 0.25, 3.0);
  if (f.strands > 1) {
    for (let j = 0; j < f.strands; j++) {
      const side = f.strands === 2 ? (j ? 1 : -1) : j - 1;
      const amp = Math.max(0.35, f.width) * (0.55 + 0.2 * k.r()) * side;
      const pts: V2[] = [];
      for (let t = 0; t <= T + 1e-6; t += 0.2) {
        const { p, d } = along(path, s, t);
        const o = amp * Math.max(0, 1 - t / T) ** 0.7 * (1 + 0.25 * Math.sin(t * 2.3 + j * 1.7));
        pts.push([p[0] - d[1] * o, p[1] + d[0] * o]);
      }
      k.wallPath('lava', pts, FLOW_H, fitWidth(k, pts, Math.min(0.16, (f.width / f.strands) * (1 + 0.3 * k.r()))), { followGround: true, batter: LAVA_BATTER, color: RUN[j % 2] });
    }
  }
  // ---- the body: side-by-side lanes (≤ LANE_MAX each) from the braid's junction down to the toe, the
  // flow narrowing by a third downstream; the outer lanes crusted, the middle one hot
  const n = Math.max(1, Math.ceil(f.width / LANE_MAX));
  const lw = f.width / n;
  const tStart = f.strands > 1 ? T - 0.3 : 0;
  const sub = slice(path, s, tStart, L);
  const ss = arcs(sub);
  const Ls = ss[ss.length - 1];
  for (let j = 0; j < n; j++) {
    const off = (j - (n - 1) / 2) * lw;
    const pts = n === 1 ? sub : offsetPath(sub, ss, (t) => (off + 0.025 * Math.sin(t * 1.3 + j * 2.1)) * (1 - 0.33 * (t / Ls)));
    const edge = n > 1 && (j === 0 || j === n - 1);
    lane(k, pts, lw * 1.08, edge ? 0.25 : 0.75);
  }
  // ---- the branching toes: short lanes fanning from the toe, each ending in a glowing pool on the plain
  const toe: V2 = [f.toe[0], f.toe[1]];
  f.branches.forEach((b, i) => {
    const pts: V2[] = [toe];
    for (let t = 0.2; t <= b.len + 1e-6; t += 0.2) {
      const h = f.heading + b.dh * (0.6 + 0.6 * (t / b.len));
      const [dx, dz] = headingDir(h);
      const q = pts[pts.length - 1];
      pts.push([q[0] + dx * 0.2, q[1] + dz * 0.2]);
    }
    lane(k, pts, Math.min(LANE_MAX, lw * 1.1), 0.7);
    if (b.pool > 0) {
      const end = pts[pts.length - 1];
      const [dx, dz] = headingDir(f.heading + b.dh * 1.2);
      const pc: V2 = [end[0] + dx * b.pool * 0.6, end[1] + dz * b.pool * 0.6];
      pool(k, pc, b.pool);
      // its glow on the ash round it (spill only: a sprite would show through the cone from the far side)
      k.light([pc[0], k.ground(pc[0], pc[1]) + 0.15, pc[1]], { kind: 'lava', color: 0xff4a12, intensity: 0.1 + 0.05 * i, radius: 0.3, sprite: false, spillKm: 3 });
    }
  });
  // ---- lights on the ribbon's top (the hero flank only): sprites (visible glints) and spill-only sources
  for (let i = 0; i < f.sprites + f.spills; i++) {
    const ti = L * (0.22 + 0.33 * i);
    const { p, d } = along(path, s, ti);
    const sprite = i < f.sprites;
    k.light([p[0], ribbonTop(k, p, d, lw / 2, FLOW_H) + 0.03, p[1]], { kind: 'lava', color: 0xff4a12, intensity: 0.1, radius: 0.15, ...(sprite ? {} : { sprite: false, spillKm: 4 }) });
  }
}

/**
 * the Sammath Naur: azimuth (toward Barad-dûr, which stands at bearing ≈ 56°) and distance from the summit.
 * S4 W5: 66 → 54 — at 66 its frame stood on the cone's silhouette from the hero cameras (south-south-east,
 * the silhouette's tangent at ≈ 76°) as a stepped notch; at 54 it sits just behind the east skyline
 */
export const DOOR_AZ = 54;
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
  for (const f of DOOM_FLOWS) flow(k, f);

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
