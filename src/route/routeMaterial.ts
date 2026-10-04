import { AdditiveBlending, AddEquation, CustomBlending, DoubleSide, NodeMaterial, OneFactor, OneMinusSrcAlphaFactor } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { tsl, type TslNode } from '../materials/tsl.ts';
import { env } from '../materials/environment.ts';
import { atmosphere } from '../materials/atmosphere.ts';
import { gradeUniforms } from '../render/PostPipeline.ts';

type N = TslNode;
const { Fn, abs, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, dot, exp, float, floor, fract, length, max, min, mix, pow, select, sin, smoothstep, varying, vec2, vec3, vec4 } = tsl;

/**
 * The journey's route line (S5 film): one ribbon (two vertices per route sample) drawn twice — a soft dark
 * under-stroke (premultiplied "over", render order 20) and the luminous gold core + glow (additive, 21) —
 * into the HDR target after the water (1–3) and before the ash deck (30), the mist (34), the falls (35),
 * the emission sprites (50) and the puffs (29 / 51): smoke and the pall veil it, ridges hide it (depth test
 * on, no depth write).
 *
 * Vertex: the width is in SCREEN pixels. The sample is projected (view depth Z); the projected direction of
 * the route's 3D tangent gives the screen normal, and the vertex moves `side · quadPx` along it in the view
 * plane at its (pulled) depth. Core half-width h = clamp(HALF_KM · pxPerKm / Z, HALF_MIN, HALF_MAX) × H/1080:
 * a 120 m road close up, never thinner than ~3 px (1080p) in the overview, never fatter than 14 px.
 * Depth pull: the vertex slides toward the camera by PULL_PX pixels' worth at its depth + PULL_REL of its
 * distance, so the CDLOD terrain (coarser than the HeightField far away) never swallows the draped line.
 * Per vertex: the atmosphere's transmittance (extinction only, like the emission sprites — the far route
 * fades into the haze, the ash veils it in Mordor).
 *
 * Fragment (all in screen px, from the interpolated arc length s and the per-vertex px-per-km along the line):
 * the round head cap — the profile is radial beyond the head (distance √(across² + ahead²)), so the drawn
 * end is a soft dot, not a cut; a Gaussian core and a wider glow; the head comet (brighter and wider over the
 * last ~COMET_PX); a slow shimmer travelling toward the head (env.tFx); underground legs (Moria) dotted at a
 * world period chosen per frame in octaves (no crawling dashes as the camera zooms) and dimmer, fading to a
 * faint solid where the dots would fall below ~4 px. Everything × routeGlow.
 *
 * Vertex buffers: position (centre x, y, z) · routeT (3D unit tangent, side ±1) · routeS (s km, mode; + 4 / + 8 on
 * the extension pair before the start / after the end).
 */

/**
 * The line's gold (linear) — core and the deeper amber glow. AgX desaturates bright warm colours strongly
 * (the brief's (1.0, 0.58, 0.18) × 1.6 displays as cream #d9c29f), so the linear colour is more saturated
 * than the gold it shows: × GAIN_DAY the core displays ≈ #dcab76 on its own, the comet's heart near
 * white-gold.
 */
export const ROUTE_GOLD: [number, number, number] = [1.0, 0.4, 0.07];
const GLOW_GOLD: [number, number, number] = [1.0, 0.34, 0.045];
/**
 * the night golds (× env.night): yellower — the moonlit grade's red-keep exempts the strongly chromatic
 * warm hues from its desaturation, so the day gold would read orange
 */
const ROUTE_GOLD_NIGHT: [number, number, number] = [1.0, 0.47, 0.085];
const GLOW_GOLD_NIGHT: [number, number, number] = [1.0, 0.39, 0.055];
/** HDR gain of the core by day / at night (after the grade's exposure compensation, below) */
const GAIN_DAY = 1.55;
const GAIN_NIGHT = 1.2;
/**
 * Grade compensation: the line is a luminous graphic element, so the region / night grade must not wash its
 * gold out (the moonlit layer's saturation 0.42 and blue tint turned it white-grey; Mordor's 0.55 × warms 0.4
 * beige). The grade is linear up to its saturation step, so the additive line is pre-divided by the grade's
 * normalised tint and pre-saturated by SAT_REF / (saturation × warms^WARMS_SHARE) (≥ 1, ≤ SAT_COMP_MAX: the
 * charcoal regions keep a duskier gold); and its brightness follows only EXPO_COMP of the exposure bias.
 */
const SAT_REF = 1.1;
const SAT_COMP_MAX = 1.6;
const WARMS_SHARE = 0.6;
const EXPO_COMP = 0.5;
/** share of the grade's white balance (tint) the line undoes (the moonlit blue would push it to salmon) */
const TINT_COMP = 0.6;
const LUM: [number, number, number] = [0.2126, 0.7152, 0.0722];
/** physical half-width of the core, km, and its clamp in 1080p pixels */
const HALF_KM = 0.06;
const HALF_MIN = 1.6;
const HALF_MAX = 7;
/** the ribbon's half-width (glow and under-stroke reach) in core half-widths */
export const QUAD_K = 3;
/** Gaussian σ of the core / glow / comet glow / under-stroke, in core half-widths */
const SIGMA_CORE = 0.5;
const SIGMA_GLOW = 0.9;
const SIGMA_COMET = 1.25;
const SIGMA_UNDER = 1.1;
/** smallest core σ (render px): a thinner core keeps its energy (amplitude × σ / σmin), no sub-pixel aliasing */
const SIGMA_MIN_PX = 0.6;
/** glow amplitude (relative to the core peak) */
const GLOW_AMP = 0.24;
/** head comet: length (1080p px, e-folding behind the head), extra core and glow gain at the head */
const COMET_PX = 12;
const COMET_CORE = 0.6;
const COMET_GLOW = 0.65;
/** depth pull toward the camera: render px at the vertex depth + share of the camera distance */
export const PULL_PX = 6;
export const PULL_REL = 0.003;
/** shimmer: wavelength (1080p px), speed (waves per effect-second), depth on core / glow, reach behind the head */
const SHIMMER_PX = 70;
const SHIMMER_HZ = 0.3;
const SHIMMER_CORE = 0.06;
const SHIMMER_GLOW = 0.3;
const SHIMMER_REACH: [number, number, number, number] = [8, 50, 260, 640];
/** underground: dot duty, brightness, the faint solid's level, dots fade to it below this period (render px) */
export const DASH_PX = 10;
const DASH_DUTY = 0.55;
const UNDER_DIM = 0.6;
const DASH_SOLID = 0.35;
const DASH_MIN_PX: [number, number] = [4, 6.5];
/** under-stroke: dark umber (linear), peak alpha, share kept at night */
const UMBER: [number, number, number] = [0.045, 0.028, 0.014];
const UNDER_ALPHA = 0.45;
const UNDER_NIGHT = 0.25;

/** A linear colour for the HDR target such that the grade (tint, saturation, exposure) leaves it ≈ itself. */
function ungraded(day: [number, number, number], night: [number, number, number]): N {
  const g = gradeUniforms;
  const tl = max(dot(g.tint, vec3(...LUM)), 1e-3);
  const c = mix(vec3(...day), vec3(...night), env.night).div(pow(max(g.tint.div(tl), vec3(0.2)), vec3(TINT_COMP)));
  const l = dot(c, vec3(...LUM));
  const sat = max(g.saturation.mul(mix(float(1), g.warms, WARMS_SHARE)), 0.05);
  const k = clamp(float(SAT_REF).div(sat), 1, SAT_COMP_MAX);
  return vec3(l).add(c.sub(l).mul(k)).mul(pow(max(g.exposureBias, 1e-3), -EXPO_COMP));
}

/** Per-frame uniforms (RouteSystem.evaluate writes them; pure functions of the state). */
export function createRouteUniforms() {
  return {
    /** route head (drawn length), km of arc */
    head: uniform(0),
    /** 0..1 overall strength (SceneState.routeGlow) */
    glow: uniform(0),
    /** underground dot period, km (an octave 2^k), and the crossfade 0..1 to the next octave (2×) */
    dashKm: uniform(1),
    dashMix: uniform(0),
  };
}
export type RouteUniforms = ReturnType<typeof createRouteUniforms>;

/** The ribbon's vertex stage (clip position) + the varyings both passes read. */
function ribbon(): { clip: N; vA: N; vB: N } {
  const P = attribute('position', 'vec3');
  const T = attribute('routeT', 'vec4');
  const S = attribute('routeS', 'vec2');
  const pxPerKm = env.pxPerKm;
  const scale = env.viewportH.div(1080);

  // the end pairs (mode + 4: before the start, + 8: after the end) slide out along the tangent by the cap's
  // reach, so both ends of the line get their round cap
  const ext = floor(S.y.add(0.5).div(4));
  const mode = S.y.sub(ext.mul(4));
  const dirE = select(ext.greaterThan(1.5), float(1), select(ext.greaterThan(0.5), float(-1), float(0)));

  const pV0 = cameraViewMatrix.mul(vec4(P, 1)).xyz;
  const tV = cameraViewMatrix.mul(vec4(T.xyz, 0)).xyz;
  const Z0 = max(pV0.z.negate(), 1e-3);
  // screen-space derivative of the projected point along the tangent: d(X/Z) = (dX·Z + X·tz) / Z² (Z = −view z);
  // pixels are isotropic in X/Z, Y/Z (px = pxPerKm · X/Z), so no aspect correction
  const dx = tV.x.mul(Z0).add(pV0.x.mul(tV.z));
  const dy = tV.y.mul(Z0).add(pV0.y.mul(tV.z));
  const dl = max(length(vec2(dx, dy)), 1e-9);
  const nrm = vec2(dy.negate(), dx).div(dl);
  const iso = pxPerKm.div(Z0);
  // px per km of arc along the line (foreshortened; floored so a line seen end-on keeps a finite cap / comet)
  const along = max(pxPerKm.mul(dl).div(Z0.mul(Z0)), iso.mul(0.2));
  const h = clamp(iso.mul(HALF_KM), scale.mul(HALF_MIN), scale.mul(HALF_MAX));
  const quad = h.mul(QUAD_K);
  const extKm = quad.add(scale.mul(2)).div(along).mul(dirE);
  const pV = pV0.add(tV.mul(extKm));
  const Z = pV.z.negate();
  const front = Z.greaterThan(1e-3);
  const Zc = max(Z, 1e-3);
  const dist = max(length(pV), 1e-3);
  // depth pull (keeps the projected centre: the vertex slides along its view ray)
  const pull = Zc.div(pxPerKm).mul(PULL_PX).add(dist.mul(PULL_REL));
  const pN = pV.mul(float(1).sub(clamp(pull.div(dist), 0, 0.9)));
  const ZN = max(pN.z.negate(), 1e-4);
  const off = nrm.mul(T.w.mul(quad)).mul(ZN.div(pxPerKm));
  // a vertex behind the camera keeps its centre (the near plane clips the segment to a thin wedge)
  const posV = select(front, pN.add(vec3(off, 0)), pV);
  const clip = cameraProjectionMatrix.mul(vec4(posV, 1));

  // aerial perspective: extinction only (as the emission sprites), the ash pall along the ray included
  const ash = atmosphere.rayDeck(env.cameraPos, P, true, true, true);
  const tau = atmosphere.opticalDepth(env.cameraPos, P, atmosphere.regional(P.xz, true).a, float(0), ash);
  const Tr = exp(env.extinction.mul(tau).negate());

  const vA = varying(vec4(T.w.mul(quad), S.x.add(extKm), along, h), 'vRouteA');
  const vB = varying(vec4(Tr, mode), 'vRouteB');
  return { clip, vA, vB };
}

/** Shared fragment terms: distance² to the drawn line (round caps at the head and the start), px behind the head, quad window. */
function terms(u: RouteUniforms, vA: N) {
  const d = abs(vA.x);
  const s = vA.y;
  const along = vA.z;
  const h = vA.w;
  const ahead = max(s.sub(u.head), 0).mul(along);
  const behind = max(u.head.sub(s), 0).mul(along);
  const before = max(s.negate(), 0).mul(along);
  const r2 = d.mul(d).add(ahead.mul(ahead)).add(before.mul(before));
  const win = float(1).sub(smoothstep(0.72, 1, d.div(h.mul(QUAD_K))));
  return { d, s, along, h, behind, r2, win };
}

const gauss = (r2: N, sigma: N): N => exp(r2.div(sigma.mul(sigma)).mul(-0.5));

/** The gold core + glow (additive). */
export function createRouteCoreMaterial(u: RouteUniforms): NodeMaterial {
  const { clip, vA, vB } = ribbon();
  const m = new NodeMaterial();
  m.name = 'route-core';
  m.vertexNode = clip;
  m.fragmentNode = Fn(() => {
    const { s, along, h, behind, r2, win } = terms(u, vA);
    const scale = env.viewportH.div(1080);
    const comet = exp(behind.div(scale.mul(COMET_PX)).negate());
    // shimmer: crests travel toward the head (phase grows with the effect clock as the distance shrinks)
    const reach = smoothstep(scale.mul(SHIMMER_REACH[0]), scale.mul(SHIMMER_REACH[1]), behind).mul(float(1).sub(smoothstep(scale.mul(SHIMMER_REACH[2]), scale.mul(SHIMMER_REACH[3]), behind)));
    const sh = sin(behind.div(scale.mul(SHIMMER_PX)).add(env.tFx.mul(SHIMMER_HZ)).mul(Math.PI * 2)).mul(reach);
    const sc0 = h.mul(SIGMA_CORE);
    const sc = max(sc0, SIGMA_MIN_PX);
    const core = gauss(r2, sc).mul(min(sc0.div(sc), 1)).mul(comet.mul(COMET_CORE).add(1)).mul(sh.mul(SHIMMER_CORE).add(1));
    const sg = h.mul(mix(float(SIGMA_GLOW), float(SIGMA_COMET), comet));
    const glow = gauss(r2, sg).mul(comet.mul(COMET_GLOW).add(GLOW_AMP)).mul(sh.mul(SHIMMER_GLOW).add(1));
    // underground: dots at a world period (octave crossfade), fading to a faint solid where they get too small
    const dashAt = (P: N): N => {
      const f = fract(s.div(P));
      const aa = clamp(float(1).div(P.mul(along)), 0.01, 0.25);
      return smoothstep(0, aa, f).mul(float(1).sub(smoothstep(float(DASH_DUTY).sub(aa), DASH_DUTY, f)));
    };
    const dash = mix(dashAt(u.dashKm), dashAt(u.dashKm.mul(2)), u.dashMix);
    const periodPx = u.dashKm.mul(u.dashMix.add(1)).mul(along);
    const dotted = mix(float(DASH_SOLID), dash, smoothstep(DASH_MIN_PX[0], DASH_MIN_PX[1], periodPx)).mul(UNDER_DIM);
    const modeK = select(vB.w.greaterThan(1.5), dotted, float(1));
    const gain = mix(float(GAIN_DAY), float(GAIN_NIGHT), env.night).mul(u.glow);
    const rgb = ungraded(ROUTE_GOLD, ROUTE_GOLD_NIGHT).mul(core).add(ungraded(GLOW_GOLD, GLOW_GOLD_NIGHT).mul(glow));
    return vec4(rgb.mul(vB.xyz).mul(modeK.mul(win).mul(gain)), 1);
  })();
  m.transparent = true;
  m.blending = AdditiveBlending;
  m.depthTest = true;
  m.depthWrite = false;
  m.fog = false;
  m.side = DoubleSide;
  m.forceSinglePass = true;
  return m;
}

/** The soft dark umber under-stroke (premultiplied over): legibility on bright noon ground, fading at night. */
export function createRouteUnderMaterial(u: RouteUniforms): NodeMaterial {
  const { clip, vA, vB } = ribbon();
  const m = new NodeMaterial();
  m.name = 'route-under';
  m.vertexNode = clip;
  m.fragmentNode = Fn(() => {
    const { h, r2, win } = terms(u, vA);
    const night = mix(float(1), float(UNDER_NIGHT), env.night);
    const ground = select(vB.w.greaterThan(1.5), float(0), float(1));
    const a = gauss(r2, h.mul(SIGMA_UNDER)).mul(UNDER_ALPHA).mul(night).mul(ground).mul(win).mul(vB.y).mul(u.glow);
    return vec4(vec3(...UMBER).mul(a), a);
  })();
  m.transparent = true;
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  m.blendEquation = AddEquation;
  m.blendSrcAlpha = OneFactor;
  m.blendDstAlpha = OneMinusSrcAlphaFactor;
  m.blendEquationAlpha = AddEquation;
  m.depthTest = true;
  m.depthWrite = false;
  m.fog = false;
  m.side = DoubleSide;
  m.forceSinglePass = true;
  return m;
}
