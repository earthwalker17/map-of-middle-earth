import { AddEquation, CustomBlending, DoubleSide, MinEquation, NodeMaterial, OneFactor, OneMinusSrcAlphaFactor, type Texture } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { tsl, type TslNode } from '../materials/tsl.ts';
import { env } from '../materials/environment.ts';
import { atmosphere } from '../materials/atmosphere.ts';
import { gradeUniforms } from '../render/PostPipeline.ts';

type N = TslNode;
const { Fn, abs, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, dot, exp, float, floor, fract, length, max, min, mix, pow, sin, smoothstep, sqrt, step, texture, varying, vec2, vec3, vec4 } = tsl;

/**
 * The journey's route line (S5 film): one ribbon (three vertices across per route sample: the centre and the
 * two edges) drawn three times — a soft
 * dark under-stroke (premultiplied "over", render order 20), the luminous gold core + glow (additive, 21)
 * and, for the underground legs only, an x-ray of round dots (additive, depth test off, 22) — into the HDR
 * target after the water (1–3) and before the ash deck (30), the mist (34), the falls (35), the emission
 * sprites (50) and the puffs (29 / 51): smoke and the pall veil it, ridges hide it (depth test on, no
 * depth write), the mountain does not hide the Moria leg (it is drawn THROUGH the mountain).
 *
 * Vertex (path.ts gives each sample a NEAR and a FAR position, and the neighbours ±STENCIL samples on each):
 *  - level: the vertex morphs from the far path to the near one as 1 km at its depth grows past ~1.5 ribbon
 *    widths (a function of depth only, so it is smooth along the line); far away the samples are sub-pixel
 *    and the near path's height wiggles would move the projected centre back and forth (bright ticks).
 *  - width in SCREEN pixels: core half-width h = clamp(HALF_KM · pxPerKm / Z, HALF_MIN, HALF_MAX) × H/1080
 *    (a 100 m road close up, never under ~1.6 px nor over 3.5 px at 1080p); the ribbon reaches QUAD_K·h.
 *  - direction: the exact screen derivative of the chord tangent dP/ds = (B − A) / (s_B − s_A) (s = the
 *    compiled XZ arc length, the unit of the head / caps / comet / dots: `along` = px per km of s).
 *  - bends: the screen turn between the projected neighbours gives the local radius R; the side toward the
 *    centre of curvature reaches at most INNER_K·R, so the ribbon never folds over itself (an additive fold
 *    counts the glow twice: the bright knots at bends and zig-zags).
 *  - depth pull toward the camera along the view ray (the projection is kept): PULL_PX 1080p px + PULL_CORE
 *    core half-widths at the depth + PULL_REL of the distance at the centre — the CDLOD terrain (coarser than
 *    the HeightField far away) never swallows the line — and PULL_EDGE ribbon reaches more at the edges, so
 *    on a skyline (a crest seen at a grazing angle) the glow's lower half is not lost behind the slope just
 *    below the line, while a ridge well in front still hides it.
 *  - canopy pull (S5 motion): where crowns rise over the line (routeC: their height above the sample, km —
 *    VegetationSystem.canopyAlong at boot) the vertex slides further toward the camera, by the canopy height
 *    over the sine of the view ray's elevation (≥ CANOPY_SIN_MIN), so the forest no longer cuts dark notches
 *    and a crawling hatch into the line — but never past the terrain: the pull stops at the first of
 *    CANOPY_STEPS points along the ray (from the line toward the camera) under the HeightField, so a ridge in
 *    front still hides the line. Trees are not in the HeightField: the line reads through them like a map.
 *  - per vertex: the atmosphere's transmittance (extinction only, like the emission sprites).
 *
 * Fragment (screen px): round caps (radial profile beyond the head and before the start; the window is
 * radial too), a Gaussian core and a wide soft glow, the head comet (brighter / wider over the last
 * ~COMET_PX), a slow shimmer travelling toward the head (env.tFx). Underground: round dots at a world period
 * (octaves crossfaded: no crawling as the camera zooms), dimmer, fading to a faint solid where the dots
 * would fall below ~4 px. Everything × routeGlow.
 *
 * Vertex buffers (2): position (near centre) and one interleaved buffer — routeAn / routeBn (near
 * neighbours), routePf / routeAf / routeBf (far centre and neighbours), routeS (s, side −1 / 0 / +1, mode
 * + 4 / + 8 on the extension triples before the start / after the end, s_B − s_A), routeC (canopy, km).
 */

/**
 * The line's gold (linear) — core and the deeper amber glow. AgX desaturates bright warm colours strongly,
 * so the core stays under its shoulder (gain ≈ 1) and leans yellow with no blue at all: it displays a gold
 * of hue ≈ 40° (≈ #dab875 alone on dark ground); the glow carries the luminous halo.
 */
export const ROUTE_GOLD: [number, number, number] = [1.0, 0.52, 0.0];
const GLOW_GOLD: [number, number, number] = [1.0, 0.42, 0.0];
/**
 * the night golds (× env.night): yellower — the moonlit grade's red-keep exempts the strongly chromatic
 * warm hues from its desaturation, so the day gold would read orange
 */
const ROUTE_GOLD_NIGHT: [number, number, number] = [1.0, 0.66, 0.0];
const GLOW_GOLD_NIGHT: [number, number, number] = [1.0, 0.55, 0.0];
/**
 * HDR gain of the core by day / at night (after the grade's exposure compensation, below). Kept under the
 * bloom threshold by day (≈ 2.0): the line's glow is its own Gaussian halo; the bloom only joins at night.
 */
const GAIN_DAY = 0.95;
const GAIN_NIGHT = 0.75;
/**
 * Grade compensation: the line is a luminous graphic element, so the region / night grade must not wash its
 * gold out (the moonlit layer's saturation 0.42 and blue tint turned it white-grey; Mordor's 0.55 × warms 0.4
 * cream-white). The film grade keeps the line's pixels at saturation 1 (its coverage rides in the HDR alpha:
 * PostPipeline.enableRouteKeep — a pre-saturation cannot do it: past ~2.5× the grade's red-keep catches the
 * line and turns it orange), the colour is pre-saturated by SAT_REF and pre-divided by TINT_COMP of the
 * grade's normalised tint (a power); its brightness follows only EXPO_COMP of the exposure bias. Tuned on the
 * V1 grade (a grade change shifts the displayed gold).
 */
const SAT_REF = 1.1;
const EXPO_COMP = 0.5;
/** coverage gain of the line's profile (core peak 1, glow 0.4) for the grade's saturation keep */
const KEEP_K = 2.5;
/** share of the grade's white balance (tint) the line undoes (the moonlit blue would push it to salmon) */
const TINT_COMP = 0.6;
const LUM: [number, number, number] = [0.2126, 0.7152, 0.0722];
/** physical half-width of the core, km, and its clamp in 1080p pixels */
export const HALF_KM = 0.05;
export const HALF_MIN = 1.6;
export const HALF_MAX = 3.5;
/** the ribbon's half-width (glow and under-stroke reach) in core half-widths */
export const QUAD_K = 5;
/** near / far morph: 1 km at the vertex depth in ribbon reaches (iso · 1 km / (QUAD_K·h)) — far below, near above */
export const MORPH: [number, number] = [0.5, 1.5];
/** the inner side of a bend reaches at most this share of the local screen radius of curvature */
const INNER_K = 0.85;
/** Gaussian σ of the core / glow / comet glow / under-stroke, in core half-widths */
const SIGMA_CORE = 0.5;
const SIGMA_GLOW = 1.6;
const SIGMA_COMET = 2.0;
const SIGMA_UNDER = 1.3;
/** smallest core σ (render px): a thinner core keeps its energy (amplitude × σ / σmin), no sub-pixel aliasing */
const SIGMA_MIN_PX = 0.6;
/** glow amplitude (relative to the core peak) */
const GLOW_AMP = 0.4;
/** head comet: length (1080p px, e-folding behind the head), extra core and glow gain at the head */
const COMET_PX = 12;
const COMET_CORE = 0.35;
const COMET_GLOW = 0.45;
/** depth pull toward the camera: 1080p px at the vertex depth + share of the ribbon reach (render px) + share of the distance */
export const PULL_PX = 6;
export const PULL_CORE = 2;
export const PULL_EDGE = 3;
export const PULL_REL = 0.003;
/**
 * canopy pull: the view ray's elevation sine is floored here (a grazing ray would pull without bound); the
 * terrain test's sample count along the pull, and its tolerance (km: the path rides ≈ on the HeightField)
 */
export const CANOPY_SIN_MIN = 0.35;
export const CANOPY_STEPS = 8;
export const CANOPY_TOL_KM = 0.03;

/** The HeightField the canopy pull is tested against (world.heights.texture over the world frame). */
export interface RouteGround {
  texture: Texture;
  xMin: number;
  zMin: number;
  width: number;
  depth: number;
}

/** shimmer: wavelength (1080p px), speed (waves per effect-second), depth on core / glow, reach behind the head */
const SHIMMER_PX = 70;
const SHIMMER_HZ = 0.3;
const SHIMMER_CORE = 0.06;
const SHIMMER_GLOW = 0.3;
const SHIMMER_REACH: [number, number, number, number] = [8, 50, 260, 640];
/**
 * underground x-ray: dot period (1080p px at the head depth → a world octave), dot radius ≤ h and ≤ a quarter
 * period (the gap is at least one dot), brightness, the faint solid's level, dots fade to it below this
 * period (render px)
 */
export const DASH_PX = 10;
const XRAY = 0.42;
const DASH_SOLID = 0.35;
const DASH_MIN_PX: [number, number] = [4, 6.5];
/** under-stroke: dark umber (linear), peak alpha, share kept at night */
const UMBER: [number, number, number] = [0.045, 0.028, 0.014];
const UNDER_ALPHA = 0.2;
const UNDER_NIGHT = 0.25;

/**
 * A linear colour for the HDR target such that the grade (tint, exposure) leaves it ≈ itself. The film grade
 * keeps the line's pixels at saturation 1 (the coverage it writes into the alpha: PostPipeline.enableRouteKeep),
 * so the colour is pre-saturated by SAT_REF only, whatever the region / night saturation.
 */
function ungraded(day: [number, number, number], night: [number, number, number]): N {
  const g = gradeUniforms;
  const tl = max(dot(g.tint, vec3(...LUM)), 1e-3);
  const c = mix(vec3(...day), vec3(...night), env.night).div(pow(max(g.tint.div(tl), vec3(0.2)), vec3(TINT_COMP)));
  const l = dot(c, vec3(...LUM));
  return vec3(l).add(c.sub(l).mul(SAT_REF)).mul(pow(max(g.exposureBias, 1e-3), -EXPO_COMP));
}

/**
 * The line's coverage for the grade's keep (HDR alpha ← min(alpha, 1 − coverage)): the core and the inner
 * glow (KEEP_K × the profile, clamped), dimmed by the atmosphere's transmittance at the vertex.
 */
function keepAlpha(profile: N, trans: N): N {
  return float(1).sub(clamp(profile.mul(KEEP_K).mul(dot(trans, vec3(...LUM))), 0, 1));
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

const view = (p: N): N => cameraViewMatrix.mul(vec4(p, 1)).xyz;

/**
 * The canopy pull at the line's centre C (world): canopy / max(sin elevation, CANOPY_SIN_MIN), at most half
 * the way to the camera, cut short at the first of CANOPY_STEPS points along the ray toward the camera that
 * lies under the HeightField (+ CANOPY_TOL_KM; outside the world frame nothing blocks). Unrolled, step / mix
 * only (vertex stage).
 */
function canopyPull(C: N, canopy: N, g: RouteGround): N {
  const toCam = env.cameraPos.sub(C);
  const dCam = max(length(toCam), 1e-3);
  const dir = toCam.div(dCam);
  const want = min(canopy.div(max(dir.y, CANOPY_SIN_MIN)), dCam.mul(0.5));
  let allowed: N = want;
  for (let j = 1; j <= CANOPY_STEPS; j++) {
    const q = C.add(dir.mul(want.mul(j / CANOPY_STEPS)));
    const uv = vec2(q.x.sub(g.xMin).div(g.width), q.z.sub(g.zMin).div(g.depth));
    const inside = step(0, uv.x).mul(step(uv.x, 1)).mul(step(0, uv.y)).mul(step(uv.y, 1));
    const h = texture(g.texture, uv).level(0).r;
    const under = step(q.y.add(CANOPY_TOL_KM), h).mul(inside);
    allowed = min(allowed, mix(want, want.mul((j - 1) / CANOPY_STEPS), under));
  }
  return allowed.mul(step(1e-4, canopy));
}

/** The ribbon's vertex stage (clip position) + the varyings every pass reads. */
function ribbon(ground?: RouteGround): { clip: N; vA: N; vB: N; vC: N } {
  const Pn = attribute('position', 'vec3');
  const An = attribute('routeAn', 'vec3');
  const Bn = attribute('routeBn', 'vec3');
  const Pf = attribute('routePf', 'vec3');
  const Af = attribute('routeAf', 'vec3');
  const Bf = attribute('routeBf', 'vec3');
  const S = attribute('routeS', 'vec4');
  const canopy = attribute('routeC', 'float');
  const pxPerKm = env.pxPerKm;
  const scale = env.viewportH.div(1080);
  const side = S.y;

  // near / far level (depth only: smooth along the line)
  const isoN = pxPerKm.div(max(view(Pn).z.negate(), 1e-3));
  const hN = clamp(isoN.mul(HALF_KM), scale.mul(HALF_MIN), scale.mul(HALF_MAX));
  const wN = smoothstep(MORPH[0], MORPH[1], isoN.div(hN.mul(QUAD_K)));
  const C = mix(Pf, Pn, wN);
  const A = mix(Af, An, wN);
  const B = mix(Bf, Bn, wN);

  // the end triples (mode + 4: before the start, + 8: after the end) slide out along the tangent by the cap's
  // reach, so both ends of the line get their round cap
  const ext = floor(S.z.add(0.5).div(4));
  const mode = S.z.sub(ext.mul(4));
  // (no `select` in this stage: TSL emits it as if / else and builds a sub-expression shared with the rest
  // of the graph inside the first branch — unassigned in the other; step / mix keep everything inline)
  const dirE = step(1.5, ext).mul(2).sub(step(0.5, ext));

  const pV0 = view(C);
  const aV = view(A);
  const bV = view(B);
  // dP/ds in view space (chord tangent over the stencil)
  const tV = bV.sub(aV).div(max(S.w, 1e-6));
  const Z0 = max(pV0.z.negate(), 1e-3);
  // screen-space derivative of the projected point along the tangent: d(X/Z) = (dX·Z + X·tz) / Z² (Z = −view z);
  // pixels are isotropic in X/Z, Y/Z (px = pxPerKm · X/Z), so no aspect correction
  const dx = tV.x.mul(Z0).add(pV0.x.mul(tV.z));
  const dy = tV.y.mul(Z0).add(pV0.y.mul(tV.z));
  const dl = max(length(vec2(dx, dy)), 1e-9);
  const nrm = vec2(dy.negate(), dx).div(dl);
  const iso = pxPerKm.div(Z0);
  // px per km of s along the line (foreshortened; floored so a line seen end-on keeps a finite cap / comet)
  const along = max(pxPerKm.mul(dl).div(Z0.mul(Z0)), iso.mul(0.2));
  const h = clamp(iso.mul(HALF_KM), scale.mul(HALF_MIN), scale.mul(HALF_MAX));
  const quad = h.mul(QUAD_K);

  // bends: local screen radius from the projected neighbours; the inner side reaches ≤ INNER_K·R
  const sA = aV.xy.div(max(aV.z.negate(), 1e-3)).mul(pxPerKm);
  const sC = pV0.xy.div(Z0).mul(pxPerKm);
  const sB = bV.xy.div(max(bV.z.negate(), 1e-3)).mul(pxPerKm);
  const u1 = sC.sub(sA);
  const u2 = sB.sub(sC);
  const l1 = length(u1);
  const l2 = length(u2);
  const cr = u1.x.mul(u2.y).sub(u1.y.mul(u2.x));
  // circumradius of the three projected points: |u1|·|u2|·|u1 + u2| / (2·|u1 × u2|)
  const radius = l1.mul(l2).mul(length(u1.add(u2))).div(max(abs(cr).mul(2), 1e-6));
  // left normal (−dy, dx) and a left turn (u1 × u2 > 0) put the centre of curvature on side +1; only with
  // all three points in front of the camera and apart on screen
  const inner = step(1e-3, aV.z.negate()).mul(step(1e-3, bV.z.negate())).mul(step(1e-3, pV0.z.negate())).mul(step(1e-3, l1)).mul(step(1e-3, l2)).mul(step(1e-9, side.mul(cr)));
  const reach = mix(quad, clamp(radius.mul(INNER_K), 0.25, quad), inner);

  const extKm = quad.add(scale.mul(2)).div(along).mul(dirE);
  const pV = pV0.add(tV.mul(extKm));
  const Z = pV.z.negate();
  const front = step(1e-3, Z);
  const Zc = max(Z, 1e-3);
  const dist = max(length(pV), 1e-3);
  // depth pull (keeps the projected centre: the vertex slides along its view ray)
  const pull0 = Zc.div(pxPerKm).mul(scale.mul(PULL_PX).add(h.mul(PULL_CORE)).add(abs(side).mul(reach).mul(PULL_EDGE))).add(dist.mul(PULL_REL));
  const pull = ground ? pull0.add(canopyPull(C, canopy, ground)) : pull0;
  const pN = pV.mul(float(1).sub(clamp(pull.div(dist), 0, 0.9)));
  const ZN = max(pN.z.negate(), 1e-4);
  const off = nrm.mul(side.mul(reach)).mul(ZN.div(pxPerKm));
  // a vertex behind the camera keeps its centre (the near plane clips the segment to a thin wedge)
  const posV = mix(pV, pN.add(vec3(off, 0)), front);
  const clip = cameraProjectionMatrix.mul(vec4(posV, 1));

  // aerial perspective: extinction only (as the emission sprites), the ash pall along the ray included
  const ash = atmosphere.rayDeck(env.cameraPos, C, true, true, true);
  const tau = atmosphere.opticalDepth(env.cameraPos, C, atmosphere.regional(C.xz, true).a, float(0), ash);
  const Tr = exp(env.extinction.mul(tau).negate());

  const vA = varying(vec4(side.mul(reach), S.x.add(extKm), along, h), 'vRouteA');
  const vB = varying(vec4(Tr, mode), 'vRouteB');
  const vC = varying(reach, 'vRouteC');
  return { clip, vA, vB, vC };
}

/** Shared fragment terms: distance² to the drawn line (round caps at the head and the start), px behind the head, radial window. */
function terms(u: RouteUniforms, vA: N, vC: N) {
  const d = abs(vA.x);
  const s = vA.y;
  const along = vA.z;
  const h = vA.w;
  const ahead = max(s.sub(u.head), 0).mul(along);
  const behind = max(u.head.sub(s), 0).mul(along);
  const before = max(s.negate(), 0).mul(along);
  const r2 = d.mul(d).add(ahead.mul(ahead)).add(before.mul(before));
  const win = float(1).sub(smoothstep(0.72, 1, sqrt(r2).div(max(vC, 1e-3))));
  return { d, s, along, h, ahead, behind, r2, win };
}

const gauss = (r2: N, sigma: N): N => exp(r2.div(sigma.mul(sigma)).mul(-0.5));

/** additive colour; the alpha takes min(dst, src) — the fragment's alpha is 1 − coverage (keepAlpha) */
function additive(m: NodeMaterial, depthTest: boolean): NodeMaterial {
  m.transparent = true;
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneFactor;
  m.blendEquation = AddEquation;
  m.blendSrcAlpha = OneFactor;
  m.blendDstAlpha = OneFactor;
  m.blendEquationAlpha = MinEquation;
  m.depthTest = depthTest;
  m.depthWrite = false;
  m.fog = false;
  m.side = DoubleSide;
  m.forceSinglePass = true;
  return m;
}

/** The gold core + glow (additive; the underground legs are left to the x-ray). */
export function createRouteCoreMaterial(u: RouteUniforms, ground?: RouteGround): NodeMaterial {
  const { clip, vA, vB, vC } = ribbon(ground);
  const m = new NodeMaterial();
  m.name = 'route-core';
  m.vertexNode = clip;
  m.fragmentNode = Fn(() => {
    const { h, behind, r2, win } = terms(u, vA, vC);
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
    const ground = float(1).sub(step(1.5, vB.w));
    const gain = mix(float(GAIN_DAY), float(GAIN_NIGHT), env.night).mul(u.glow);
    const rgb = ungraded(ROUTE_GOLD, ROUTE_GOLD_NIGHT).mul(core).add(ungraded(GLOW_GOLD, GLOW_GOLD_NIGHT).mul(glow));
    const on = ground.mul(win).mul(gain);
    return vec4(rgb.mul(vB.xyz).mul(on), keepAlpha(core.add(glow).mul(on), vB.xyz));
  })();
  return additive(m, true);
}

/**
 * The underground legs as an x-ray (additive, depth test OFF — the line runs through the mountain between
 * the portals): round dots at a world period (octaves crossfaded), radius ≤ h and ≤ a quarter period,
 * dimmer than the ground line, brighter toward the head, fading to a faint solid when the dots get small.
 */
export function createRouteXrayMaterial(u: RouteUniforms, ground?: RouteGround): NodeMaterial {
  const { clip, vA, vB, vC } = ribbon(ground);
  const m = new NodeMaterial();
  m.name = 'route-xray';
  m.vertexNode = clip;
  m.fragmentNode = Fn(() => {
    const { d, s, along, h, ahead, behind, r2, win } = terms(u, vA, vC);
    const scale = env.viewportH.div(1080);
    const dotAt = (P: N): N => {
      const periodPx = P.mul(along);
      const a = fract(s.div(P).add(0.5)).sub(0.5).mul(periodPx);
      const rd = max(min(h, periodPx.mul(0.25)), 0.5);
      const r = sqrt(d.mul(d).add(a.mul(a)));
      return float(1).sub(smoothstep(rd.sub(0.6), rd.add(0.6), r));
    };
    const dots = mix(dotAt(u.dashKm), dotAt(u.dashKm.mul(2)), u.dashMix);
    const periodPx = u.dashKm.mul(u.dashMix.add(1)).mul(along);
    const sc = max(h.mul(SIGMA_CORE), SIGMA_MIN_PX);
    const solid = gauss(r2, sc).mul(DASH_SOLID);
    // nothing beyond the head (the dots would otherwise run on): a soft round end within ~1 px
    const capK = float(1).sub(smoothstep(0, scale.mul(1.5), ahead));
    const v = mix(solid, dots, smoothstep(DASH_MIN_PX[0], DASH_MIN_PX[1], periodPx)).mul(capK);
    const comet = exp(behind.div(scale.mul(COMET_PX)).negate());
    const underground = step(1.5, vB.w);
    const gain = mix(float(GAIN_DAY), float(GAIN_NIGHT), env.night).mul(u.glow).mul(XRAY);
    const rgb = ungraded(ROUTE_GOLD, ROUTE_GOLD_NIGHT).mul(v.mul(comet.mul(0.8).add(1)));
    const on = underground.mul(win).mul(gain);
    return vec4(rgb.mul(vB.xyz).mul(on), keepAlpha(v.mul(on), vB.xyz));
  })();
  return additive(m, false);
}

/** The soft dark umber under-stroke (premultiplied over): legibility on bright noon ground, fading at night. */
export function createRouteUnderMaterial(u: RouteUniforms, ground?: RouteGround): NodeMaterial {
  const { clip, vA, vB, vC } = ribbon(ground);
  const m = new NodeMaterial();
  m.name = 'route-under';
  m.vertexNode = clip;
  m.fragmentNode = Fn(() => {
    const { h, r2, win } = terms(u, vA, vC);
    const night = mix(float(1), float(UNDER_NIGHT), env.night);
    const ground = float(1).sub(step(1.5, vB.w));
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
