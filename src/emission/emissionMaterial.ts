import { AdditiveBlending, DoubleSide, NodeMaterial } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import { env } from '../materials/environment.ts';
import { atmosphere } from '../materials/atmosphere.ts';

type N = TslNode;
const { Fn, abs, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, exp, float, length, max, mix, pow, select, sin, smoothstep, sqrt, varying, vec3, vec4 } = tsl;

/** smallest Gaussian σ (px): a sub-pixel light keeps its energy as a stable ~1.4 px sparkle */
const SIGMA_MIN_PX = 0.6;
/**
 * The quad reaches out to where the Gaussian falls below CUTOFF (HDR luminance), 3σ…6σ: a bright
 * lava / Eye sprite would otherwise show its square edge; the profile is windowed to exactly zero
 * at that radius (no edge, round, the corners are black).
 */
const CUTOFF = 0.004;
const QUAD_SIGMAS_MIN = 3;
const QUAD_SIGMAS_MAX = 6;
/**
 * Soft halo: a share of each light's energy spread as a second, HALO_K× wider Gaussian — the lamp's
 * light scattered in the air and the leaves round it, so a lantern reads as a glowing point rather than
 * a hard pellet (and a town's windows melt into a warm glow in wide shots). The total energy is
 * unchanged (sub-pixel stability under the jitter accumulation holds).
 */
const HALO_SHARE = 0.25;
const HALO_K = 3.5;
/** the sprite is pulled this many pixels' worth toward the camera (never z-fights its own wall) */
const NUDGE_PX = 2;
/** wide-shot gain: (dist / WIDE_KM)^0.75, clamped to [1, WIDE_MAX] — windows, lamps, fires only */
const WIDE_KM = 30;
const WIDE_MAX = 6;

/**
 * The emission sprite material (one pipeline): an instanced camera-facing quad per light, drawn
 * additively into the HDR target after the opaques (depth-tested against them, no depth write,
 * no scene fog).
 *
 * Vertex: the light is projected (view depth z), its physical radius gives rpx = r·pxPerKm / z, the
 * Gaussian σ = max(rpx / 2, 0.6 px) and the quad spans 3–6σ (to where the profile is negligible). Gate (time of day), flicker (env.tFx),
 * wide-shot gain and the atmosphere's transmittance T = exp(−β·τ(camera → light)) are per instance,
 * so the fragment is one exp().
 * Fragment: an energy-normalised Gaussian, peak = L·rpx²/(2σ²) — a resolved light peaks at 2L with
 * a soft edge at ~rpx, a sub-pixel light keeps its integrated energy (stable under the Halton jitter
 * of the accumulation: no fireflies, it converges at spp 4 / 12) — with a quarter of the energy in a
 * 3.5× wider halo (HALO_SHARE / HALO_K).
 *
 * Instance attributes (three buffers + the quad's position = four vertex buffers):
 *  emPos = (x, y, z, radiusKm) · emCol = (HDR colour, flicker depth) · emAux = (gate code + 8·wide, ω₁, ω₂, φ)
 */
export function createEmissionMaterial(): NodeMaterial {
  const P = attribute('emPos', 'vec4');
  const C = attribute('emCol', 'vec4');
  const A = attribute('emAux', 'vec4');
  const corner = attribute('position', 'vec3').xy;

  const pView = cameraViewMatrix.mul(vec4(P.xyz, 1)).xyz;
  const dist = max(length(pView), 1e-4);
  const z = max(pView.z.negate(), 1e-4);
  const pxPerKm = env.pxPerKm;

  // ---- time-of-day gate (codes: lightKinds.ts gateCode)
  const wide = select(A.x.greaterThan(7.5), float(1), float(0));
  const code = A.x.sub(wide.mul(8));
  const isCode = (k: number): N => abs(code.sub(k)).lessThan(0.5);
  // windows / lamps: ramp in through blue hour, off by day and in golden hour (the glow families'
  // night gate, families.ts gateNode)
  const gNight = clamp(smoothstep(0.2, 0.7, env.night).add(env.twilight.mul(0.4)), 0, 1);
  const gDim = smoothstep(0.35, 0.95, env.night);
  const gDusk = float(0.25).add(max(env.night, env.golden).mul(0.75));
  const gate = select(isCode(0), gNight, select(isCode(1), gDim, select(isCode(2), gDusk, select(isCode(3), float(1), float(0)))));

  // ---- deterministic flicker (effect clock only)
  const phi = A.w;
  const flick = max(float(1).add(C.a.mul(sin(env.tFx.mul(A.y).add(phi)).mul(sin(env.tFx.mul(A.z).add(phi.mul(1.7)).add(1.3))))), 0);

  // ---- wide-shot gain: a town's windows sum into a warm few-pixel cluster in overviews
  const wideGain = mix(float(1), clamp(pow(dist.div(WIDE_KM), 0.75), 1, WIDE_MAX), wide);

  // ---- aerial perspective: extinction only (the additive sprite must not add in-scatter squares)
  const tau = atmosphere.opticalDepth(env.cameraPos, P.xyz, atmosphere.regional(P.xz, true).a);
  const T = exp(env.extinction.mul(tau).negate());

  // ---- projected size, energy-normalised amplitude
  const rpx = P.w.mul(pxPerKm).div(z);
  const sigma = max(rpx.mul(0.5), SIGMA_MIN_PX);
  const peak = rpx.mul(rpx).div(sigma.mul(sigma).mul(2));
  const amp = C.rgb.mul(gate.mul(flick).mul(wideGain).mul(peak)).mul(T);
  const on = gate.greaterThan(1e-4);

  // ---- camera-facing quad (view space), nudged toward the camera by NUDGE_PX pixels' worth; it
  // reaches to where the core or the halo falls below CUTOFF
  const peakLum = max(amp.dot(vec3(0.2126, 0.7152, 0.0722)), 1e-6);
  const kCore = clamp(sqrt(max(tsl.log(peakLum.mul(1 - HALO_SHARE).div(CUTOFF)), 0).mul(2)), QUAD_SIGMAS_MIN, QUAD_SIGMAS_MAX);
  const kHalo = sqrt(max(tsl.log(peakLum.mul(HALO_SHARE / (HALO_K * HALO_K)).div(CUTOFF)), 0).mul(2)).mul(HALO_K);
  const kq = max(kCore, clamp(kHalo, 0, 3 * HALO_K));
  const quadPx = select(on, sigma.mul(kq), float(0));
  const nudge = z.div(pxPerKm).mul(NUDGE_PX);
  const pNear = pView.mul(float(1).sub(nudge.div(dist)));
  const zNear = max(pNear.z.negate(), 1e-4);
  const offset = corner.mul(quadPx).mul(zNear.div(pxPerKm));
  const clip = cameraProjectionMatrix.mul(vec4(pNear.add(vec3(offset, 0)), 1));

  const vUv = varying(corner.mul(quadPx), 'vEmUv');
  const vSigma = varying(sigma, 'vEmSigma');
  const vAmp = varying(amp, 'vEmAmp');
  // core + halo profile in units of σ² (energy 2πσ², like the core alone); its value at the quad radius is
  // subtracted, so the sprite ends at exactly zero (round, no square edge)
  const profile = (t: N): N => exp(t.mul(-0.5)).mul(1 - HALO_SHARE).add(exp(t.mul(-0.5 / (HALO_K * HALO_K))).mul(HALO_SHARE / (HALO_K * HALO_K)));
  const vEdge = varying(profile(kq.mul(kq)), 'vEmEdge');

  const m = new NodeMaterial();
  m.name = 'emission-sprites';
  m.vertexNode = clip;
  m.fragmentNode = Fn(() => {
    const t = vUv.dot(vUv).div(vSigma.mul(vSigma));
    const g = max(profile(t).sub(vEdge), 0);
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
