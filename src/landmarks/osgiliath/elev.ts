import type { FamilyId, PartOpts, ProxyKit } from '../kit/ProxyKit.ts';
import type { V2 } from '../records.ts';

/**
 * An upright slab cut from an elevation drawing (shared by Osgiliath's ruins and Minas Morgul's bridge):
 * `outline` is drawn in (u, y) — u along the line a → b (km from `a`), y the LOCAL height — with optional
 * `holes` (arched openings, (u, y) rings strictly inside), extruded `t` thick across the line and
 * centred on it. One part, flat facets, any concave outline: a broken wall with a jagged top, an arcade
 * of round-headed openings, an arched bridge.
 *
 * It is the kit's `extrude` turned upright: Euler XYZ applies z first, so rot z 90° takes the prism's
 * outline (x, z) to (height y, along z) and its extrusion (+y) to −x; the yaw then turns local +z onto
 * a → b (sin ψ = dx, cos ψ = dz) and −x onto (−dz, dx), so `at` is shifted by t/2 along (dz, −dx).
 */
export function elevation(k: ProxyKit, fam: FamilyId, a: V2, b: V2, outline: V2[], t: number, o: Omit<PartOpts, 'at' | 'rot' | 'seat'> & { holes?: V2[][] } = {}): void {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const dx = (b[0] - a[0]) / L;
  const dz = (b[1] - a[1]) / L;
  const yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
  const flip = (r: V2[]): V2[] => r.map(([u, y]): V2 => [y, u]);
  const { holes, ...rest } = o;
  k.extrude(fam, flip(outline), t, { ...rest, holes: holes?.map(flip), at: [a[0] + (dz * t) / 2, 0, a[1] - (dx * t) / 2], rot: [0, yaw, 90] });
}

/**
 * Jagged broken-top profile for a ruined wall of length `L`: (u, y) points along the top from u = L back
 * to u = 0 (the caller closes the outline along the bottom), heights between `lo`·h and h over `base`,
 * irregular spacing, occasional deep breaks and sloping fractures — never a regular comb. `r(i)` is the
 * caller's random stream (rand(seed, id, k) via k.r).
 */
export function brokenTop(L: number, h: number, base: number, lo: number, r: (i: number) => number): V2[] {
  const pts: V2[] = [];
  const n = Math.max(3, Math.round(L / 0.085) + Math.floor(r(0) * 3));
  // break positions: irregular, sorted, descending u
  const us: number[] = [];
  for (let i = 1; i < n; i++) us.push(((i + (r(10 + i) - 0.5) * 0.8) / n) * L);
  us.sort((p, q) => q - p);
  // a few full-height stretches, deep breaks between them; heights wander (a random walk) so the top
  // reads as fractured masonry
  let y = lo + (1 - lo) * (0.55 + 0.45 * r(1));
  pts.push([L, base + h * (lo + (1 - lo) * r(2) * 0.8)]);
  for (let i = 0; i < us.length; i++) {
    const step = r(30 + i);
    if (step < 0.18) y = lo + (1 - lo) * 0.15 * r(50 + i); // a deep break
    else if (step < 0.4) y = Math.min(1, y + 0.35 * (1 - lo));
    else y = Math.max(lo, Math.min(1, y + (r(70 + i) - 0.5) * 0.5 * (1 - lo)));
    // a fracture: two points at different heights close together (a sloping or stepped break)
    const u = us[i];
    pts.push([u + 0.012 * r(90 + i), base + h * y]);
    if (r(110 + i) < 0.35) pts.push([u - 0.012, base + h * Math.max(lo, y - 0.25 * (1 - lo) * r(130 + i))]);
  }
  pts.push([0, base + h * (lo + (1 - lo) * r(3) * 0.7)]);
  // strictly descending u (a simple polygon): drop points that would step back
  const out: V2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) if (pts[i][0] < out[out.length - 1][0] - 0.004 && pts[i][0] > 0.004) out.push(pts[i]);
  out.push(pts[pts.length - 1]);
  return out;
}
