import { tsl, type TslNode } from '../materials/tsl.ts';
import { srgbNode } from '../materials/looks.ts';

/**
 * Volcanic ground (S4): Gorgoroth's cracked ash crust and basalt, Dagorlad's lighter crust, cinder around
 * Orodruin and a dim fissure glow — procedural, no texture fetches (the terrain shader calls it inside a
 * branch taken only on volcanic ground near enough for any of it to resolve, so the rest of the world
 * pays nothing).
 *
 *  - crack networks at three scales (≈ 6 / 1.5 / 0.4 km): Voronoi edges (F2 − F1) for the two coarse
 *    scales — angular crust plates with a barely different tone and tilt each (a narrow dark crack with a
 *    soft shoulder between them, never a tone step: no camouflage) — and the zero set of a noise for the
 *    fine crazing; every crack opens and closes along its length and fades below ~1 px (footprint)
 *  - rubble: sub-plate grit / gravel speckle and clinker normals (review / final), so a plate is not flat
 *  - basalt: dark, rougher flow lobes (more of them towards Doom) with pressure ridges
 *  - cinder: warm-dark around Doom
 *  - fissure glow: segments of the 1.5 km crack network (each crack between two plates is either lit or
 *    dark, from a hash of the plate pair) on the open plain round the cone's foot — never on the cone, never
 *    on slopes; the caller dims it by day
 */

type N = TslNode;
const { abs, clamp, dot, float, floor, fract, length, max, min, mix, mx_cell_noise_vec3, mx_noise_float, mx_noise_vec3, select, smoothstep, sqrt, vec2, vec3 } = tsl;

export const VOLCANIC = {
  /** crust only where the ground look's volcanic ≥ [a] (full at [b]; Dagorlad's 0.5 → ≈ 0.7) */
  volcanic: [0.3, 0.62] as const,
  /** crack network scales: cell size km, line width (fraction of a cell), darkening */
  cracks: [
    [6.0, 0.03, 0.75],
    [1.5, 0.045, 0.6],
    [0.4, 0.05, 0.28],
  ] as const,
  /**
   * footprint (km / px) over which the crust fades out (the branch is skipped beyond it: regional views
   * keep a calm plain and never pay for networks they cannot resolve)
   */
  fade: [0.12, 0.2] as const,
  /** basalt flow lobes (sRGB), cinder (sRGB), crack floor (sRGB) */
  basalt: 0x19191b,
  cinder: 0x3a2b25,
  crackFloor: 0x0d0c0c,
  /** Doom's influence: cinder / basalt full within [a] km, gone by [b] */
  doomReach: [7, 26] as const,
  /** fissure glow: none on the cone (inside [a] km of Doom, full outside [b]), gone beyond [c] km */
  glowRing: [17, 23, 42] as const,
  /** fissure glow (linear rgb × strength): round Doom's foot, and across the rest of Gorgoroth */
  glow: [1.0, 0.26, 0.05] as const,
  glowDoom: 1.3,
  glowPlain: 0.08,
  /** fraction of the 1.5 km cracks (plate pairs) that glow (and of each lit crack's length, by a 0.9 / 3 km noise) */
  glowLit: 0.22,
  glowRun: 0.5,
  /** glow only on ground flatter than this slope range (1 − n.y) */
  glowSlope: [0.05, 0.12] as const,
  /** horizontal part of the base normal kept on gentle volcanic ground (the baked sub-km ripples read as dunes) */
  flatten: 0.4,
} as const;

/**
 * Voronoi on a unit lattice: F1, F2 (euclidean, cell units), a random value of the nearest cell and one of
 * the second nearest (the pair names the crack between them).
 */
function voronoi(q: N): { f1: N; f2: N; id: N; id2: N } {
  const c = floor(q);
  const fq = q.sub(c);
  const f1 = float(64).toVar();
  const f2 = float(64).toVar();
  const idv = float(0).toVar();
  const id2 = float(0).toVar();
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const o = vec2(i, j);
      const r = mx_cell_noise_vec3(c.add(o));
      const d = o.add(r.xy.mul(0.85).add(0.075)).sub(fq);
      const dd = dot(d, d);
      const closer = dd.lessThan(f1);
      const second = closer.not().and(dd.lessThan(f2));
      id2.assign(select(closer, idv, select(second, r.z, id2)));
      f2.assign(select(closer, f1, min(f2, dd)));
      idv.assign(select(closer, r.z, idv));
      f1.assign(min(f1, dd));
    }
  return { f1: sqrt(f1), f2: sqrt(f2), id: idv, id2 };
}

export interface CrustInputs {
  p: N;
  /** texel footprint km / px */
  fp: N;
  slope: N;
  /** ground look volcanic 0..1 */
  volcanic: N;
  /** the terrain's shared noises: 12 km (3D), 3 km (3D), 0.9 km (3D, fine-faded), 0.4 km (offline tiers, else 0) */
  n2: N;
  n3: N;
  n4: N;
  n5: N;
  /** Doom's world xz */
  doom: N;
  preview: boolean;
}

export interface CrustOut {
  /** 0..1 crust weight on the ground colour */
  w: N;
  /** crust albedo (linear) for a ground colour `ground` */
  col: (ground: N) => N;
  /** world-space normal perturbation */
  dn: N;
  /** emissive (linear rgb) */
  glow: N;
  /** roughness of the crust surface */
  rough: N;
  /** 0..1 cinder tint (also applied to rock near Doom) */
  cinder: N;
}

/** Proximity to Doom (1 inside doomReach[0] km, 0 beyond doomReach[1]). */
export function doomProximity(p: N, doom: N): N {
  return float(1).sub(smoothstep(VOLCANIC.doomReach[0], VOLCANIC.doomReach[1], length(p.xz.sub(doom))));
}

/**
 * The crust terms. Call inside a branch (no texture fetches here); the outputs are plain nodes the
 * caller assigns to its vars.
 */
export function volcanicCrust(i: CrustInputs): CrustOut {
  const V = VOLCANIC;
  const { p, slope, n2, n3, n4, n5 } = i;
  // (a zero footprint would divide 0 / 0 below)
  const fp = max(i.fp, 1e-5);
  const w = smoothstep(V.volcanic[0], V.volcanic[1], i.volcanic)
    .mul(float(1).sub(smoothstep(0.35, 0.6, slope)))
    .mul(float(1).sub(smoothstep(V.fade[0], V.fade[1], fp)));
  const doomP = doomProximity(p, i.doom);
  // full Gorgoroth (volcanic ≈ 1) vs Dagorlad / Nurn (≈ 0.4–0.5): the glow and basalt are Gorgoroth's
  const gorgoroth = smoothstep(0.8, 0.95, i.volcanic);
  // a gentle warp of the coarse network only (the plates stay angular — a warped edge wiggles like a worm)
  const warp = vec2(n3, n2).mul(0.3);
  let crack: N = float(0);
  let shoulder: N = float(0);
  let core: N = float(0);
  let plateTone: N = float(1);
  let tiltV: N = vec3(0);
  const scales = i.preview ? 2 : 3;
  for (let k = 0; k < scales; k++) {
    const [L, width, dark] = V.cracks[k];
    // cracks open and close along their length (gaps, tapering) — 12 km and 3 km noise per scale
    const open = clamp(n4.mul(1.2).add(n3.mul(0.8)).add(n2.mul(0.5)).add(0.35 - 0.1 * k), 0, 1);
    let edge: N;
    let wd: N = float(width).mul(open);
    if (k < 2) {
      const v = voronoi(p.xz.div(L).add(warp.mul(k === 0 ? 0.5 : 0.12)).add(37.1 * k));
      edge = v.f2.sub(v.f1);
      // plates: a barely different tone (±≈3 %) and a small tilt each (hash of the nearest cell)
      const r = v.id;
      plateTone = plateTone.mul(float(0.97).add(r.mul(0.06)));
      const a = r.mul(6.2832);
      const tiltAmt = (k === 0 ? 0.025 : 0.04) as number;
      tiltV = tiltV.add(vec3(tsl.cos(a), 0, tsl.sin(a)).mul(tiltAmt));
      // glowing fissures: a lit subset of the 1.5 km cracks (a hash of the plate pair: each crack between
      // two plates is lit or dark along its whole length — short angular segments, a network at night)
      if (k === 1) {
        const pair = fract(v.id.add(v.id2).mul(91.7).add(v.id.mul(v.id2).mul(37.3)));
        const lit = smoothstep(1 - V.glowLit - 0.04, 1 - V.glowLit + 0.04, pair);
        const wg = float(width * 0.5);
        // anti-aliased like the cracks: below a pixel the line keeps its energy (dimmer, never gone)
        const hw = max(wg, fp.div(L).mul(0.6));
        core = float(1).sub(smoothstep(hw.mul(0.4), hw, edge)).mul(wg.div(hw)).mul(lit);
      }
    } else {
      // fine crazing: the zero set of a 0.4 km noise (faint)
      edge = abs(mx_noise_float(p.xz.div(L).add(warp))).mul(1.6);
    }
    // anti-aliased line: its half-width in cell units against the footprint in cell units
    const fpc = fp.div(L);
    const halfW = max(wd, fpc.mul(0.5));
    const line = float(1).sub(smoothstep(halfW.mul(0.35), halfW, edge)).mul(wd.div(halfW));
    // fade once the crack is narrower than ~1 px
    const vis = smoothstep(0.35, 1.2, wd.mul(L).div(fp));
    crack = max(crack, line.mul(vis).mul(dark));
    // a soft, slightly darker shoulder either side of the coarse cracks (sunken plate margins)
    if (k < 2) shoulder = max(shoulder, float(1).sub(smoothstep(halfW, halfW.mul(4), edge)).mul(vis).mul(0.12));
  }
  // basalt flow lobes (sparse on the open plain, more towards Doom) with ragged, fingering margins and
  // pressure ridges — a darker, rougher ground, never a black blot
  const lobes = n2.mul(0.7).add(n3.mul(0.45)).add(n4.mul(0.3)).add(doomP.mul(0.55)).sub(0.3);
  const basalt = smoothstep(-0.08, 0.3, lobes).mul(gorgoroth).mul(0.8);
  const ridge = float(1).sub(abs(mx_noise_float(p.xz.div(0.7).add(vec2(n3, n4).mul(0.9)))));
  const ridgeVis = float(1).sub(smoothstep(0.03, 0.12, fp));
  const ridges = ridge.mul(ridge).mul(ridge).mul(ridgeVis);
  const cinder = doomP.mul(gorgoroth).mul(0.85);
  // rough clinker on the basalt, gravel and blocks over the whole crust (review / final only)
  let rubble: N = vec3(0);
  if (!i.preview) rubble = mx_noise_vec3(p.div(0.35)).mul(0.22).mul(float(1).sub(smoothstep(0.02, 0.08, fp)));
  const dn = vec3(tiltV.x, 0, tiltV.z)
    .mul(float(1).sub(smoothstep(0.08, 0.3, fp)))
    .add(rubble.mul(basalt.add(0.45)))
    .mul(w);
  // sub-plate grit: paler ash drifts and darker gravel patches at 0.4 / 0.9 km (no flat plate interiors)
  const grit = n5.mul(0.6).add(n4.mul(0.5));
  const col = (ground: N): N => {
    const ash = ground.mul(plateTone).mul(float(1.0).add(grit.mul(0.16)));
    const bas = mix(ground.mul(0.62), srgbNode(V.basalt), 0.5).mul(float(0.85).add(ridges.mul(0.45)));
    const c0 = mix(mix(ash, bas, basalt), srgbNode(V.cinder).mul(float(0.9).add(n4.mul(0.15))), cinder.mul(0.7));
    return mix(c0.mul(float(1).sub(shoulder)), srgbNode(V.crackFloor), crack);
  };
  // the lit cracks of the 1.5 km network on the open plain round the cone's foot (a few elsewhere in
  // Gorgoroth): never on the cone itself, never on slopes
  const dDoom = length(p.xz.sub(i.doom));
  const ring = smoothstep(V.glowRing[0], V.glowRing[1], dDoom).mul(float(1).sub(smoothstep(V.glowRing[1], V.glowRing[2], dDoom)));
  // each lit crack burns along part of its length only (short segments, not whole polygons)
  const run = smoothstep(-0.12, 0.12, n4.mul(0.8).add(n3.mul(0.5)).add(0.5 - V.glowRun));
  const glowAmt = core
    .mul(run)
    .mul(ring.mul(V.glowDoom).add(gorgoroth.mul(V.glowPlain)))
    .mul(smoothstep(V.glowRing[0], V.glowRing[1], dDoom))
    .mul(float(1).sub(smoothstep(V.glowSlope[0], V.glowSlope[1], slope)))
    .mul(w);
  const glow = vec3(V.glow[0], V.glow[1], V.glow[2]).mul(glowAmt);
  const rough = mix(float(0.95), float(0.72), basalt);
  return { w, col, dn, glow, rough, cinder: cinder.mul(w) };
}
