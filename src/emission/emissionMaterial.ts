import { AdditiveBlending, DoubleSide, NodeMaterial } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import { env } from '../materials/environment.ts';
import { atmosphere } from '../materials/atmosphere.ts';
import { gateNode } from '../materials/gates.ts';

type N = TslNode;
const { Fn, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, exp, float, floor, length, max, pow, select, sin, smoothstep, sqrt, varying, vec2, vec3, vec4 } = tsl;

/** smallest Gaussian σ (px): a sub-pixel light keeps its energy as a stable ~1.4 px sparkle */
const SIGMA_MIN_PX = 0.6;
/**
 * The quad reaches out to where the core or the halo falls below CUTOFF (HDR luminance), 3σ…(3·haloK)σ;
 * the profile is windowed to exactly zero at that radius (round, the corners are black) and renormalised
 * to the light's full energy (the energy of the windowed profile is computed per instance, so a dim or
 * sub-pixel light keeps exactly the energy of a bright one: brightness is linear in distance, T and gate).
 */
const CUTOFF = 0.004;
const QUAD_SIGMAS_MIN = 3;
const QUAD_SIGMAS_MAX = 6;
/**
 * The halo never widens the quad beyond this radius (px): a resolved lamp close up would otherwise
 * draw a ~160 px quad (overdraw); the renormalisation keeps its full energy in the truncated profile.
 */
const HALO_MAX_PX = 64;
/** the sprite is pulled this many pixels' worth toward the camera (never z-fights its own wall) */
const NUDGE_PX = 2;
/** wide-shot gain: (dist / WIDE_KM)^0.75, clamped to [1, cap] — cap 6 (windows, fires) or 3 (lamps) */
const WIDE_KM = 30;
/** focal kinds (lava, the Eye) start gaining only from here (cap 6): overview embers, untouched heroes */
const FOCAL_KM = 120;
/**
 * Settlement aggregation (EmissionSystem): members fade out and the group's aggregate sprite fades in as
 * the group's projected diameter falls from AGG_PX[1] to AGG_PX[0] px.
 */
const AGG_PX: [number, number] = [6, 12];
/**
 * Visibility floor of an aggregate (peak HDR value of the largest channel of its sub-pixel core, before
 * gate and transmittance): a lit settlement stays a small, coloured spark in overviews.
 */
const FLOOR_PEAK = 2.4;
/** largest extra pull of an aggregate toward the camera (km): the centroid of a grove's lamps sits inside its crowns */
const AGG_PULL_KM = 3;

/**
 * The emission sprite material (one pipeline): an instanced camera-facing quad per light, drawn
 * additively into the HDR target after the opaques (depth-tested against them, no depth write,
 * no scene fog).
 *
 * Vertex: the light is projected (view depth z), its physical radius gives rpx = r·pxPerKm / z, the
 * Gaussian σ = max(rpx / 2, 0.6 px) and the quad spans 3σ…(3·haloK)σ (to where the profile is
 * negligible). Gate (time of day), flicker (env.tFx), wide-shot gain, the settlement crossfade and the
 * atmosphere's transmittance T = exp(−β·τ(camera → light)) are per instance, so the fragment is two exp().
 * Fragment: an energy-normalised Gaussian, peak = L·rpx²/(2σ²) — a resolved light peaks at 2L with
 * a soft edge at ~rpx, a sub-pixel light keeps its integrated energy (stable under the Halton jitter
 * of the accumulation: no fireflies, it converges at spp 4 / 12) — with a per-kind share of the energy
 * in a wider halo (lightKinds.ts HALO: a quarter in 3.5σ for windows, lamps, fires and the Eye; a tenth
 * in 2σ for lava).
 *
 * Instance attributes (four buffers + the quad's position = five vertex buffers):
 *  emPos = (x, y, z, radiusKm) · emCol = (HDR colour, flicker depth) · emAux = (gate code + 8·wide class,
 *  ω₁, ω₂, φ) · emGrp = (group radius km, role, halo share, halo width in σ)
 */
export function createEmissionMaterial(): NodeMaterial {
  const P = attribute('emPos', 'vec4');
  const C = attribute('emCol', 'vec4');
  const A = attribute('emAux', 'vec4');
  const G = attribute('emGrp', 'vec4');
  const corner = attribute('position', 'vec3').xy;

  const pView = cameraViewMatrix.mul(vec4(P.xyz, 1)).xyz;
  const dist = max(length(pView), 1e-4);
  const z = max(pView.z.negate(), 1e-4);
  const pxPerKm = env.pxPerKm;

  // ---- gate: time of day / timeline event (the shared table, materials/gates.ts)
  const wideCls = floor(A.x.add(0.5).div(8));
  const code = A.x.sub(wideCls.mul(8));
  const gate = gateNode(code);

  // ---- deterministic flicker (effect clock only)
  const phi = A.w;
  const flick = max(float(1).add(C.a.mul(sin(env.tFx.mul(A.y).add(phi)).mul(sin(env.tFx.mul(A.z).add(phi.mul(1.7)).add(1.3))))), 0);

  // ---- wide-shot gain: a town's windows sum into a warm few-pixel cluster in overviews
  const isFocal = wideCls.greaterThan(2.5);
  const wideCap = select(isFocal, float(6), select(wideCls.greaterThan(1.5), float(3), float(6)));
  const wideKm = select(isFocal, float(FOCAL_KM), float(WIDE_KM));
  const wideGain = select(wideCls.greaterThan(0.5), clamp(pow(dist.div(wideKm), 0.75), float(1), wideCap), float(1));

  // ---- settlement crossfade: members → the group's aggregate as the group shrinks to a few pixels
  const role = G.y;
  const groupPx = G.x.mul(2).mul(pxPerKm).div(z);
  const wAgg = float(1).sub(smoothstep(AGG_PX[0], AGG_PX[1], groupPx));
  const isAgg = role.greaterThan(1.5);
  const roleW = select(role.lessThan(0.5), float(1), select(isAgg, wAgg, float(1).sub(wAgg)));

  // ---- aerial perspective: extinction only (the additive sprite must not add in-scatter squares); the
  //      ash pall along the ray (eye + mid taps, as the geometry's camera-ray haze) dims a light with its tower
  const ash = atmosphere.rayDeck(env.cameraPos, P.xyz, true, true, true);
  const tau = atmosphere.opticalDepth(env.cameraPos, P.xyz, atmosphere.regional(P.xz, true).a, float(0), ash);
  const T = exp(env.extinction.mul(tau).negate());

  // ---- projected size, energy-normalised amplitude (+ the aggregate's visibility floor)
  const rpx = P.w.mul(pxPerKm).div(z);
  const sigma = max(rpx.mul(0.5), SIGMA_MIN_PX);
  const peak = rpx.mul(rpx).div(sigma.mul(sigma).mul(2));
  const maxC = max(max(C.r, C.g), max(C.b, 1e-6));
  const gain = max(wideGain.mul(peak).mul(flick), select(isAgg, float(FLOOR_PEAK).div(maxC), float(0)));
  const amp0 = C.rgb.mul(gate.mul(gain).mul(roleW)).mul(T);
  const on = gate.mul(roleW).greaterThan(1e-4);

  // ---- halo (per kind) and the quad radius: to where the core or the halo falls below CUTOFF
  const hs = G.z;
  const hk = max(G.w, 1);
  const hk2 = hk.mul(hk);
  const peakLum = max(amp0.dot(vec3(0.2126, 0.7152, 0.0722)), 1e-6);
  const kCore = clamp(sqrt(max(tsl.log(peakLum.mul(float(1).sub(hs)).div(CUTOFF)), 0).mul(2)), QUAD_SIGMAS_MIN, QUAD_SIGMAS_MAX);
  const kHalo = sqrt(max(tsl.log(peakLum.mul(hs).div(hk2).div(CUTOFF)), 0).mul(2)).mul(hk);
  const kq = max(kCore, clamp(kHalo, 0, hk.mul(3)).min(float(HALO_MAX_PX).div(sigma)));
  // core + halo profile in units of σ² (energy 2πσ² over the plane)
  const profile = (t: N, share: N, k2: N): N => exp(t.mul(-0.5)).mul(float(1).sub(share)).add(exp(t.mul(-0.5).div(k2)).mul(share.div(k2)));
  const T2 = kq.mul(kq);
  const edge = profile(T2, hs, hk2);
  // energy of the windowed profile max(profile − edge, 0) over the disc of radius kq, relative to 2πσ²
  const eWin = float(1)
    .sub(hs)
    .mul(float(1).sub(exp(T2.mul(-0.5))))
    .add(hs.mul(float(1).sub(exp(T2.mul(-0.5).div(hk2)))))
    .sub(edge.mul(T2).mul(0.5));
  const amp = amp0.div(max(eWin, 0.05));

  const quadPx = select(on, sigma.mul(kq), float(0));
  // pulled toward the camera by NUDGE_PX pixels' worth; an aggregate also by the group's radius (its
  // centroid can sit inside the landmark it stands for: a grove's crowns, a town's roofs)
  const pull = z.div(pxPerKm).mul(NUDGE_PX).add(select(isAgg, clamp(G.x, 0, AGG_PULL_KM), float(0)));
  const pNear = pView.mul(float(1).sub(clamp(pull.div(dist), 0, 0.9)));
  const zNear = max(pNear.z.negate(), 1e-4);
  const offset = corner.mul(quadPx).mul(zNear.div(pxPerKm));
  const clip = cameraProjectionMatrix.mul(vec4(pNear.add(vec3(offset, 0)), 1));

  const vUv = varying(corner.mul(quadPx), 'vEmUv');
  const vSigma = varying(sigma, 'vEmSigma');
  const vAmp = varying(amp, 'vEmAmp');
  const vEdge = varying(edge, 'vEmEdge');
  const vHalo = varying(vec2(hs, hk2), 'vEmHalo');

  const m = new NodeMaterial();
  m.name = 'emission-sprites';
  m.vertexNode = clip;
  m.fragmentNode = Fn(() => {
    const t = vUv.dot(vUv).div(vSigma.mul(vSigma));
    const g = max(profile(t, vHalo.x, vHalo.y).sub(vEdge), 0);
    return vec4(vAmp.mul(g), 1);
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
