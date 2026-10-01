import { tsl, type TslNode } from '../materials/tsl.ts';
import { srgbNode } from '../materials/looks.ts';

/**
 * Volcanic ground (S4): Gorgoroth's cracked ash crust and basalt, Dagorlad's lighter crust, cinder around
 * Orodruin and a dim fissure glow — procedural, no texture fetches (the terrain shader calls it inside a
 * branch taken only on volcanic ground near enough for any of it to resolve, so the rest of the world
 * pays nothing).
 *
 *  - crack networks at three scales (≈ 6 / 1.5 / 0.4 km): Voronoi edges (F2 − F1) for the two coarse
 *    scales — crust plates with their own tone and a small tilt, so the plain reads broken, not rippled —
 *    and the zero set of a noise for the fine one; every crack opens and closes along its length (gaps,
 *    tapering) and fades once it would shrink below ~1 px (footprint)
 *  - basalt: dark, rougher flow lobes (more of them towards Doom) with pressure ridges
 *  - cinder: warm-dark around Doom
 *  - fissure glow: the cores of the coarse cracks emit a dim orange near Doom, fainter across Gorgoroth
 */

type N = TslNode;
const { abs, clamp, dot, float, floor, length, max, min, mix, mx_cell_noise_vec3, mx_noise_float, mx_noise_vec3, select, smoothstep, sqrt, vec2, vec3 } = tsl;

export const VOLCANIC = {
  /** crust only where the ground look's volcanic ≥ [a] (full at [b]; Dagorlad's 0.5 → ≈ 0.7) */
  volcanic: [0.3, 0.62] as const,
  /** crack network scales: cell size km, line width (fraction of a cell), darkening */
  cracks: [
    [6.0, 0.03, 0.75],
    [1.5, 0.045, 0.6],
    [0.4, 0.06, 0.45],
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
  /** Doom's influence: cinder / basalt / glow full within [a] km, gone by [b] */
  doomReach: [7, 26] as const,
  /** fissure glow (linear rgb × strength): near Doom, and across the rest of Gorgoroth */
  glow: [1.0, 0.26, 0.05] as const,
  glowDoom: 2.2,
  glowPlain: 0.07,
  /** horizontal part of the base normal kept on gentle volcanic ground (the baked sub-km ripples read as dunes) */
  flatten: 0.4,
} as const;

/** Voronoi on a unit lattice: F1, F2 (euclidean, cell units) and a random value of the nearest cell. */
function voronoi(q: N): { f1: N; f2: N; id: N } {
  const c = floor(q);
  const fq = q.sub(c);
  const f1 = float(64).toVar();
  const f2 = float(64).toVar();
  const idv = float(0).toVar();
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const o = vec2(i, j);
      const r = mx_cell_noise_vec3(c.add(o));
      const d = o.add(r.xy.mul(0.85).add(0.075)).sub(fq);
      const dd = dot(d, d);
      const closer = dd.lessThan(f1);
      f2.assign(select(closer, f1, min(f2, dd)));
      idv.assign(select(closer, r.z, idv));
      f1.assign(min(f1, dd));
    }
  return { f1: sqrt(f1), f2: sqrt(f2), id: idv };
}

export interface CrustInputs {
  p: N;
  /** texel footprint km / px */
  fp: N;
  slope: N;
  /** ground look volcanic 0..1 */
  volcanic: N;
  /** the terrain's shared noises: 12 km (3D), 3 km (3D), 0.9 km (3D, fine-faded) */
  n2: N;
  n3: N;
  n4: N;
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
  const { p, fp, slope, n2, n3, n4 } = i;
  const w = smoothstep(V.volcanic[0], V.volcanic[1], i.volcanic)
    .mul(float(1).sub(smoothstep(0.35, 0.6, slope)))
    .mul(float(1).sub(smoothstep(V.fade[0], V.fade[1], fp)));
  const doomP = doomProximity(p, i.doom);
  // full Gorgoroth (volcanic ≈ 1) vs Dagorlad / Nurn (≈ 0.4–0.5): the glow and basalt are Gorgoroth's
  const gorgoroth = smoothstep(0.8, 0.95, i.volcanic);
  // a gentle warp so no network reads as a lattice
  const warp = vec2(n3, n4).mul(0.35);
  let crack: N = float(0);
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
      const v = voronoi(p.xz.div(L).add(warp.mul(k === 0 ? 0.5 : 1)).add(37.1 * k));
      edge = v.f2.sub(v.f1);
      // plates: a tone and a small tilt each (hash of the nearest cell)
      const r = v.id;
      plateTone = plateTone.mul(float(0.86).add(r.mul(0.28)));
      const a = r.mul(6.2832);
      const tiltAmt = (k === 0 ? 0.05 : 0.09) as number;
      tiltV = tiltV.add(vec3(tsl.cos(a), 0, tsl.sin(a)).mul(tiltAmt));
    } else {
      // fine crazing: the zero set of a 0.4 km noise
      edge = abs(mx_noise_float(p.xz.div(L).add(warp))).mul(1.6);
      wd = wd.mul(1.3);
    }
    // anti-aliased line: its half-width in cell units against the footprint in cell units
    const fpc = fp.div(L);
    const halfW = max(wd, fpc.mul(0.5));
    const line = float(1).sub(smoothstep(halfW.mul(0.35), halfW, edge)).mul(wd.div(halfW));
    // fade once the crack is narrower than ~1 px
    const vis = smoothstep(0.35, 1.2, wd.mul(L).div(fp));
    crack = max(crack, line.mul(vis).mul(dark));
    // glowing cores: the major fissures (6 km network), and the 1.5 km cracks only close round Doom
    if (k < 2) {
      const reach = k === 0 ? float(1) : doomP.mul(0.6);
      // the core keeps a width of its own (the crack's opening only sets how bright it burns)
      const wg = float(width * 0.45);
      const lit = smoothstep(0.05, 0.4, max(open, doomP.mul(0.6)));
      core = max(core, float(1).sub(smoothstep(wg.mul(0.3), wg, edge)).mul(smoothstep(0.5, 1.6, wg.mul(L).div(fp))).mul(lit).mul(reach));
    }
  }
  // basalt flow lobes (sparse on the open plain, more towards Doom) with ragged, fingering margins and
  // pressure ridges — a darker, rougher ground, never a black blot
  const lobes = n2.mul(0.7).add(n3.mul(0.45)).add(n4.mul(0.3)).add(doomP.mul(0.55)).sub(0.3);
  const basalt = smoothstep(0.0, 0.22, lobes).mul(gorgoroth).mul(0.85);
  const ridge = float(1).sub(abs(mx_noise_float(p.xz.div(0.7).add(vec2(n3, n4).mul(0.9)))));
  const ridgeVis = float(1).sub(smoothstep(0.03, 0.12, fp));
  const ridges = ridge.mul(ridge).mul(ridge).mul(ridgeVis);
  const cinder = doomP.mul(gorgoroth).mul(0.85);
  // rough clinker on the basalt (review / final only)
  let rubble: N = vec3(0);
  if (!i.preview) rubble = mx_noise_vec3(p.div(0.35)).mul(0.22).mul(float(1).sub(smoothstep(0.02, 0.08, fp)));
  const dn = vec3(tiltV.x, 0, tiltV.z)
    .mul(float(1).sub(smoothstep(0.08, 0.3, fp)))
    .add(rubble.mul(basalt))
    .mul(w);
  const col = (ground: N): N => {
    const ash = ground.mul(plateTone).mul(float(1.02).add(n4.mul(0.08)));
    const bas = mix(ground.mul(0.62), srgbNode(V.basalt), 0.5).mul(float(0.85).add(ridges.mul(0.45)));
    const c0 = mix(mix(ash, bas, basalt), srgbNode(V.cinder).mul(float(0.9).add(n4.mul(0.15))), cinder.mul(0.7));
    return mix(c0, srgbNode(V.crackFloor), crack);
  };
  // long glowing stretches (12 / 3 km gating, so a fissure glows for kilometres, then goes dark), on
  // the open plain only — never as scattered sparks, never on the cone's flanks
  const glowSeg = smoothstep(-0.15, 0.2, n2.mul(0.8).add(n3.mul(0.5)));
  const glowAmt = core
    .mul(glowSeg)
    .mul(doomP.mul(V.glowDoom).add(gorgoroth.mul(V.glowPlain)))
    .mul(float(1).sub(smoothstep(0.08, 0.22, slope)))
    .mul(w);
  const glow = vec3(V.glow[0], V.glow[1], V.glow[2]).mul(glowAmt);
  const rough = mix(float(0.95), float(0.72), basalt);
  return { w, col, dn, glow, rough, cinder: cinder.mul(w) };
}
