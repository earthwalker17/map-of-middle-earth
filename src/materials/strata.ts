import { tsl, type TslNode } from './tsl.ts';

/**
 * Rock strata (S4): sedimentary bedding on steep rock — shared by the terrain material (cliffs, scarps,
 * mountain faces) and the structure family's rock class (kit cliffs), so kit faces and terrain faces band
 * alike. Generalised from the slab's cut-face strata (src/diorama/slabMaterials.ts `formation` / `ledge`).
 *
 * Bedding coordinate (world units of height):
 *   y' = p.y + dip · dot(p.xz, d̂) + warp(p)
 * Beds at three spacings (formations of a few units, beds and laminae under one unit), each bed with a
 * hardness from a hash of its index: hard beds are lighter and stand proud (the step at their top is a ledge
 * whose normal tilts upward), soft beds are darker and recessed (shaded under the ledge above). Every scale
 * fades out once its beds (or its ledge edges) would shrink below ~2 px, from fwidth(y') — so the banding
 * never aliases at regional range. Pure function of the position (no state, no time).
 */

type N = TslNode;
const { abs, clamp, float, floor, fract, fwidth, max, mix, smoothstep, vec3 } = tsl;

/**
 * Float hash of a bed index → [0, 1) (Hoskins' hash without sine: pure float arithmetic, well conditioned
 * for the small integers here; the same in every material that calls it).
 */
const hash = (x: N): N => {
  // fold the index into [0, 289) first: small arguments, no precision loss in any compiler's reassociation
  const k = x.sub(floor(x.mul(1 / 289)).mul(289));
  const a = fract(k.mul(0.1031).add(0.1));
  const b = a.mul(a.add(33.33));
  return fract(b.mul(b.add(b)));
};

export const STRATA = {
  /** regional dip of the bedding: height units per km along DIP_DIR (≈ 2°) */
  dip: 0.035,
  dipDir: [0.8, 0.6] as const,
  /** bed spacings, world units of height: formations, beds, laminae */
  spacing: [2.3, 0.6, 0.17] as const,
  /** luminance contrast of hard vs soft beds per scale (S4 C2: 0.2 / 0.13 → 0.13 / 0.09 — whole mountains,
   *  Mindolluin first, read as painted horizontal stripes; the ledges' normals keep the bedding) */
  lum: [0.13, 0.09, 0.06] as const,
  /** ledge normal tilt per scale (tangent-plane "up" component at a full hard/soft step) */
  tilt: [0.5, 0.55, 0.35] as const,
  /** darkening of a soft bed's top under an overhanging hard bed */
  shadow: [0.035, 0.05, 0.02] as const,
  /** fraction of a bed taken by the step at its top */
  edge: 0.22,
  /**
   * vertical joints / faults: the rock is cut into blocks of about this many km (a jittered lattice in xz),
   * each block's beds offset by up to ±`jointShift` height units — beds end or step at a joint instead of
   * running as ruled lines across a whole face (no layer cake)
   */
  joint: 1.9,
  jointShift: 0.45,
  /** lateral presence: weight of the caller's strike noise and of a per-bed pinch-out along the strike */
  lateral: 0.7,
  pinch: 0.4,
  /** km per radian of the per-bed pinch-out wave along the strike */
  pinchKm: 0.55,
} as const;

export interface StrataSample {
  /** luminance multiplier (≈ 1 on average) */
  lum: N;
  /** linear rgb multiplier: per-formation warm / cool / value shift (1 in the preview tier) */
  tint: N;
  /** world-space normal perturbation (tangent plane, along the face's up direction) */
  dn: N;
}

export interface StrataOptions {
  /** preview tier: luminance and ledges only, no formation tint, two scales */
  preview?: boolean;
  /** overall strength 0..1 of the luminance contrast (normals keep their tilt) */
  contrast?: number;
  /**
   * the bedding coordinate's change per pixel, precomputed (strataFootprint) — for callers that evaluate
   * the strata inside a branch, where no derivative may be taken; default fwidth of the bedding coordinate
   */
  fy?: N;
  /**
   * bed spacing multiplier (default 1): kit faces (0.5–1.5 units tall) use finer beds than the terrain's
   * mountain faces, or a whole kit cliff sits inside one or two beds and shows no banding
   */
  scale?: number;
}

/** fwidth of the (unwarped) bedding coordinate — take it in uniform control flow, pass it as `fy`. */
export function strataFootprint(p: N): N {
  const S = STRATA;
  return fwidth(p.y.add(p.x.mul(S.dip * S.dipDir[0]).add(p.z.mul(S.dip * S.dipDir[1]))));
}

/**
 * Strata at world position `p` (km / world units) on a surface with unit world normal `n`. `warp` is a
 * bedding offset in height units from the caller's noises (folds and wiggles; ≈ ±2); `lateral` (≈ −1..1,
 * a noise of a few km from the caller) makes beds fade in and out along the strike (facies change, scree
 * cover), so no band runs as a ruled line across a whole face. Callers weight the result by their own rock
 * mask: `lum` → mix(1, lum, w), `dn` · w.
 */
export function strata(p: N, n: N, warp: N, lateral: N, opts: StrataOptions = {}): StrataSample {
  const S = STRATA;
  const preview = opts.preview ?? false;
  // jointed blocks: a block id from a jittered xz lattice (the joint planes are vertical, so on any face
  // they run down the face as irregular cracks where the beds step or end)
  const jq = p.xz.div(S.joint).add(warp.mul(0.18));
  const jId = floor(jq.x).mul(57).add(floor(jq.y).mul(131));
  const shift = hash(jId.add(911)).sub(0.5).mul(2 * S.jointShift);
  const yb = p.y.add(p.x.mul(S.dip * S.dipDir[0]).add(p.z.mul(S.dip * S.dipDir[1]))).add(warp).add(shift);
  // a coordinate along the strike (any horizontal direction not parallel to most faces)
  const sAlong = p.x.mul(0.62).add(p.z.mul(0.78)).div(S.pinchKm);
  // bed-coordinate change per pixel (the face's projected bed thickness)
  const fy = max(opts.fy ?? fwidth(yb), 1e-6);
  let lum: N = float(0);
  let tilt: N = float(0);
  let tint: N = vec3(1);
  const scales = preview ? 2 : 3;
  for (let i = 0; i < scales; i++) {
    const T = S.spacing[i] * (opts.scale ?? 1);
    // offset each scale so the bed boundaries of different scales never line up; uneven bed thicknesses
    // (the slab's formation remap)
    const b0 = yb.div(T).add(0.37 * i);
    const b = b0.add(tsl.sin(b0.mul(1.37).add(0.6 + i)).mul(0.28)).add(tsl.sin(b0.mul(2.71).add(2.1 + i)).mul(0.17));
    const id = floor(b);
    const f = fract(b);
    // some beds stand out, some barely show; each fades in and out along the strike (the caller's noise)
    // and pinches out on its own wave (phase from its hash), so no bed runs unbroken across a face
    const pres = (k: N): N =>
      smoothstep(
        0.1,
        0.6,
        hash(k.add(3301 * (i + 1)))
          .mul(0.7)
          .add(lateral.mul(S.lateral))
          .add(tsl.sin(sAlong.mul(1 + 0.6 * i).add(hash(k.add(577 * (i + 1))).mul(6.2832))).mul(S.pinch))
          .add(0.12 + 0.1 * i),
      );
    const h0 = smoothstep(0.2, 0.8, hash(id.add(1013 * (i + 1)))).sub(0.5).mul(pres(id)).add(0.5);
    const h1 = smoothstep(0.2, 0.8, hash(id.add(1 + 1013 * (i + 1)))).sub(0.5).mul(pres(id.add(1))).add(0.5);
    // the step at the top of the bed: 0 inside the bed, 0..1 across the edge zone
    const t = clamp(f.sub(1 - S.edge).div(S.edge), 0, 1);
    const prof = mix(h0, h1, t.mul(t).mul(float(3).sub(t.mul(2))));
    const bump = t.mul(float(1).sub(t)).mul(4);
    // bed visible (≥ 2 px) / its ledge edge visible (≥ ~1.5 px)
    const wBed = float(1).sub(smoothstep(T / 4, T / 2, fy));
    const wEdge = float(1).sub(smoothstep(T * S.edge * 0.35, T * S.edge * 0.75, fy));
    const step = h0.sub(h1); // > 0 harder below: a ledge top; < 0 softer below: an overhang
    // soft bed under a harder one: its upper part sits in the overhang's shade
    const under = max(step.negate(), 0).mul(smoothstep(0.35, 1, f)).mul(S.shadow[i]);
    lum = lum.add(prof.sub(0.5).mul(2 * S.lum[i]).sub(under).mul(wBed));
    tilt = tilt.add(step.mul(bump).mul(S.tilt[i]).mul(wEdge));
    if (i === 0 && !preview) {
      // formations differ in tone and a little in hue (sandstone warm, shale cool, limestone pale)
      const r = hash(id.add(7919));
      const hue = mix(vec3(1.06, 1.0, 0.92), vec3(0.93, 0.99, 1.07), r);
      const val = mix(float(0.84), float(1.14), hash(id.add(4231)));
      tint = mix(vec3(1), hue.mul(val), wBed);
    }
  }
  const c = opts.contrast ?? 1;
  // the face's "up" in its tangent plane (length → 0 on flat ground, where strata never show anyway)
  const up = vec3(n.x.mul(n.y).negate(), float(1).sub(n.y.mul(n.y)), n.z.mul(n.y).negate());
  return { lum: clamp(float(1).add(lum.mul(c)), 0.35, 1.8), tint, dn: up.mul(tilt) };
}

/** 0..1 how sheer a surface is (1 − |n.y|) mapped onto the strata's visibility range [a, b]. */
export function strataSteep(n: N, a = 0.3, b = 0.55): N {
  return smoothstep(a, b, float(1).sub(abs(n.y)));
}
