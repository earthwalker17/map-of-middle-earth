import { AdditiveBlending, CustomBlending, DoubleSide, NodeMaterial, OneFactor, OneMinusSrcAlphaFactor, AddEquation, Vector4, type DataTexture, type Texture } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import { env } from '../materials/environment.ts';
import { atmosphere } from '../materials/atmosphere.ts';
import { gateNode } from '../materials/gates.ts';
import { spillIrradiance } from '../emission/spill.ts';
import type { WorldSpec } from '../world/WorldSpec.ts';
import { ATLAS } from './textures.ts';
import { FALLS, FX_VIS_SLOTS, MIST } from './presets.ts';

type N = TslNode;
const { Fn, abs, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, cross, dot, exp, float, floor, int, length, max, min, mix, mod, normalize, pow, select, sign, sin, smoothstep, sqrt, texture, uniformArray, varying, vec2, vec3, vec4 } = tsl;

/**
 * The EffectsSystem's material module (S4 W3-E) — four pipelines, all transparent with no depth write,
 * none uses scene fog: the shared aerial perspective (atmosphere.apply) is evaluated PER VERTEX at the
 * effect's own position (transmittance T and in-scatter S as varyings; a puff, a fall or a mist card is
 * small against the haze's scale), so a smoke puff hazes exactly like the ground behind it and the
 * W2-D halos (spill in-scatter) sit in front of it.
 *
 *  - puffs (billboards: smoke / ash / steam / spray), premultiplied-alpha "over", CPU-sorted back to
 *    front: one atlas tap (density + bump normal) per fragment; lit by the key (deck shadow and self-
 *    shadow from the CPU), the hemisphere and the emission spill (CPU-gathered per puff, lit from the
 *    side facing the sources — Doom's plume glows red from below)
 *  - falls (ribbons + plunge foam discs), premultiplied: scrolling streaks (1 noise tap preview, 2
 *    review / final), an aerated white core with translucent edges, glassy at the lip
 *  - mist cards, premultiplied: soft horizontal layers, faded where the ground rises to them (height
 *    texture tap in review / final, per-vertex ground in preview), time-of-day weighted
 *  - beam, additive: an axis-aligned billboard (never edge-on), Gaussian core + glow, event-gated
 */

/**
 * Per-frame key visibility over the HeightField (EffectsSystem, CPU march): per fall (lip, middle, foot)
 * and per mist card (its `at` end, middle, `to` end); w unused. Slots beyond FX_VIS_SLOTS draw lit.
 */
export const fxVisU = {
  falls: uniformArray(Array.from({ length: FX_VIS_SLOTS }, () => new Vector4(1, 1, 1, 1)), 'vec4'),
  mist: uniformArray(Array.from({ length: FX_VIS_SLOTS }, () => new Vector4(1, 1, 1, 1)), 'vec4'),
};

/** visibility along a fall / card from its three samples (t 0..1) */
function vis3(v: N, t: N): N {
  return select(t.lessThan(0.5), mix(v.x, v.y, t.mul(2)), mix(v.y, v.z, t.mul(2).sub(1)));
}

/** gain on the puff lighting (the deck's light model scale: radiance = albedo · E · PUFF_LIGHT) */
const PUFF_LIGHT = 0.85;
/** share of the ash deck's overcast radiance (env.deckSky × π) lighting a puff under it from above */
const PUFF_OVERCAST = 1.6;
/**
 * multiple scattering of bright media (spray, steam, chimney smoke): their light is scattered many times
 * inside the cloud, so they stay pale in the shade — × the albedo's luminance² (dark ash takes ~none)
 */
const PUFF_MULTI = 0.8;
/** wrap of the puffs' key term: a volume is lit well past its terminator */
const PUFF_WRAP = 0.6;

export interface FxMaterialOptions {
  /** review / final: the atmosphere's mid-ray haze tap, second noise octaves, height-texture soft edges */
  detail: boolean;
}

/** premultiplied "over" blending: src·1 + dst·(1 − αsrc) */
function premultiplied(m: NodeMaterial): void {
  m.transparent = true;
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  m.blendEquation = AddEquation;
  m.blendSrcAlpha = OneFactor;
  m.blendDstAlpha = OneMinusSrcAlphaFactor;
  m.blendEquationAlpha = AddEquation;
  m.premultipliedAlpha = true;
  m.depthTest = true;
  m.depthWrite = false;
  m.fog = false;
  m.side = DoubleSide;
  m.forceSinglePass = true;
}

/**
 * The aerial perspective of a point seen from the camera, split into transmittance (rgb) and the
 * additive in-scatter + halos (rgb): apply(c) = c·T + S. Vertex stage (explicit-LOD fetches).
 */
function fogSplit(P: N, midTap: boolean): { T: N; S: N } {
  // one evaluation of the haze (S4 W4-S2: atmosphere.applySplit — two apply() calls built the graph twice)
  return atmosphere.applySplit(env.cameraPos, P, true, true, true, midTap);
}

/** hemisphere + key irradiance (the env uniforms every lit material reads) */
const eKey = (): N => env.keyColor.mul(env.keyIntensity);
const eSky = (): N => env.skyColor.mul(env.hemiIntensity);
const eGnd = (): N => env.groundColor.mul(env.hemiIntensity);

// ------------------------------------------------------------------------------------------ puffs

/**
 * Billboard puffs. Instance attributes (+ the quad corner = 5 vertex buffers):
 *  fxA = (x, y, z, radius km) · fxB = (albedo rgb, opacity + 2 × round(8 × ash-deck cover)) · fxC = (spill
 *  radiance rgb, key visibility)
 *  · fxD = (rotation rad, atlas frame + 16 × softness, sky visibility, vertical direction to the spill
 *  sources −1..1)
 */
export function createPuffMaterial(atlas: DataTexture, noise: Texture, o: FxMaterialOptions): NodeMaterial {
  const A = attribute('fxA', 'vec4');
  const B = attribute('fxB', 'vec4');
  const C = attribute('fxC', 'vec4');
  const D = attribute('fxD', 'vec4');
  const corner = attribute('position', 'vec3').xy;

  const cs = cos(D.x);
  const sn = sin(D.x);
  const rc = vec2(corner.x.mul(cs).sub(corner.y.mul(sn)), corner.x.mul(sn).add(corner.y.mul(cs)));
  const pView = cameraViewMatrix.mul(vec4(A.xyz, 1)).xyz;
  const depth = pView.z.negate();
  const clip = cameraProjectionMatrix.mul(vec4(pView.add(vec3(rc.mul(A.w), 0)), 1));
  // a puff the camera is in (or nearly) fades out instead of filling the lens
  const nearFade = smoothstep(A.w.mul(0.4), A.w.mul(1.6), depth);

  // lights in the quad's frame: view space, turned back by the quad's rotation
  const toQuad = (v: N): N => {
    const vv = cameraViewMatrix.mul(vec4(v, 0)).xyz;
    return vec3(vv.x.mul(cs).add(vv.y.mul(sn)), vv.y.mul(cs).sub(vv.x.mul(sn)), vv.z);
  };
  const fog = fogSplit(A.xyz, o.detail);
  const vT = varying(fog.T, 'vFxT');
  const vS = varying(fog.S, 'vFxS');
  const vKey = varying(toQuad(env.keyDir), 'vFxKey');
  const vUp = varying(toQuad(vec3(0, 1, 0)), 'vFxUp');
  // opacity and the ash-deck cover over the puff (packed: opacity + 2 × cover in eighths)
  const coverQ = floor(B.a.mul(0.5));
  const vAlb = varying(vec4(B.rgb, B.a.sub(coverQ.mul(2)).mul(nearFade)), 'vFxAlb');
  const vSpill = varying(C, 'vFxSpill');
  // atlas frame (0..15) + 16 × softness level (0..3: a billowing smoke edge … a diffuse spray / wisp)
  const vAux = varying(vec4(D.z, D.w, floor(D.y.div(16)).div(3), coverQ.div(8)), 'vFxAux');
  // atlas cell of the frame (half-texel inset: the frames never sample their neighbours)
  const f = mod(D.y, 16);
  const cell = vec2(mod(f, 4), floor(f.div(4)));
  const inset = 0.5 / ATLAS.cell;
  const uv = cell.add(corner.mul(0.5).add(0.5).mul(1 - 2 * inset).add(inset)).div(ATLAS.frames);
  const vUv = varying(uv, 'vFxUv');
  // review / final: a finer erosion octave (fx noise in the quad's frame, offset per puff) — close up a
  // puff keeps crisp cauliflower edges instead of a magnified 64² frame
  const vNq = varying(corner.mul(0.62).add(vec2(D.x.mul(0.37), f.mul(0.173))), 'vFxNq');

  const m = new NodeMaterial();
  m.name = 'fx-puffs';
  m.vertexNode = clip;
  m.fragmentNode = Fn(() => {
    const t = texture(atlas, vUv);
    // erosion: the thin parts of the density are eaten by the wisp octave (same tap) and, in review / final,
    // a finer noise octave; the cores survive
    let ero: N = t.a.sub(0.5);
    if (o.detail) ero = ero.mul(0.5).add(texture(noise, vNq).b.sub(0.5));
    const d = t.r.add(ero.mul(float(1).sub(t.r)).mul(0.55));
    // a firmer silhouette than the raw density: billows with edges, not airbrushed blobs
    const a = smoothstep(0.04, mix(float(0.6), float(1.15), vAux.z), d).mul(vAlb.a);
    const nxy = t.gb.mul(2).sub(1);
    const n = vec3(nxy, sqrt(max(float(1).sub(dot(nxy, nxy)), 0.04)));
    const nl = dot(n, vKey);
    const up = dot(n, vUp);
    const wrapKey = clamp(nl.add(PUFF_WRAP).div(1 + PUFF_WRAP), 0, 1);
    // forward scattering: the thin edges of a puff glow when the key is behind it
    const back = pow(clamp(vKey.z.negate(), 0, 1), 3).mul(float(1).sub(t.r)).mul(0.8);
    const E = eKey()
      .mul(vSpill.a)
      .mul(wrapKey.add(back))
      .add(eSky().mul(vAux.x).mul(up.mul(0.55).add(0.5)))
      // ground bounce, half desaturated: a white cloud over brown rock does not turn brown
      .add(mix(vec3(dot(eGnd(), vec3(0.2126, 0.7152, 0.0722))), eGnd(), 0.5).mul(float(0.3).sub(up.mul(0.25))))
      // under an ash deck the overcast itself lights the puff from above (its radiance is env.deckSky)
      .add(env.deckSky.mul(Math.PI * PUFF_OVERCAST).mul(vAux.w).mul(vAux.x).mul(up.mul(0.5).add(0.5)));
    // the spill sources light the side of the puff facing them (dy < 0: below — the crater)
    const spillW = clamp(up.mul(vAux.y).mul(0.85).add(0.45), 0.08, 1);
    const lumA = dot(vAlb.rgb, vec3(0.2126, 0.7152, 0.0722));
    const multi = eSky().add(eKey().mul(vSpill.a).mul(0.35)).mul(lumA.mul(lumA).mul(PUFF_MULTI));
    const rad = vAlb.rgb.mul(E.add(multi)).mul(PUFF_LIGHT).add(vSpill.rgb.mul(spillW));
    const col = rad.mul(vT).add(vS);
    return vec4(col.mul(a), a);
  })();
  premultiplied(m);
  return m;
}

// ------------------------------------------------------------------------------------------ falls

/**
 * Waterfall ribbons and plunge-foam discs (one static mesh). Vertex attributes:
 *  position · normal (the curtain's outward normal; foam: up) · fallA = (u across 0..1 | foam radius
 *  0..1, v km from the lip | foam angle 0..1, length km, layer: 0 core, 1 veil, 2 foam) · fallB = (width km,
 *  seed, projected-size reference km, foam disc radius km | 0 on the curtains) · fallW = the half-width
 *  offset across (turned toward the camera here) · fallT = (tangent xyz, the fall's index: its fxVisU slot)
 */
export function createFallsMaterial(noise: Texture, o: FxMaterialOptions): NodeMaterial {
  const P0 = attribute('position', 'vec3');
  const Nrm = attribute('normal', 'vec3');
  const FA = attribute('fallA', 'vec4');
  const FB = attribute('fallB', 'vec4');
  const SW = attribute('fallW', 'vec3');
  const TG4 = attribute('fallT', 'vec4');
  const TG = TG4.xyz;
  // the offset across the curtain turns part-way toward the camera around the fall's axis (a fall seen
  // along its wall keeps some width); foam vertices have no offset
  const sLen = length(SW);
  const wN = SW.div(max(sLen, 1e-6));
  const toCam = normalize(env.cameraPos.sub(P0));
  const wc0 = cross(TG, toCam);
  const wcL = length(wc0);
  const wC = wc0.div(max(wcL, 1e-4)).mul(sign(dot(wc0, wN)));
  const wF = normalize(mix(wN, wC, smoothstep(0.05, 0.25, wcL).mul(FALLS.facing)).add(vec3(1e-6, 0, 0)));
  const P = P0.add(wF.mul(sLen));
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(P, 1)));
  const fog = fogSplit(P, o.detail);
  // light: two-sided (a curtain is translucent), key + sky + a little ground + the spill
  const camDist = max(length(env.cameraPos.sub(P)), 1e-3);
  const ndl = abs(dot(Nrm, env.keyDir));
  const E = Fn(() => {
    // the key's visibility over the terrain (a fall in its gorge's shade takes no sun): lip → foot
    const slot = int(clamp(TG4.w, 0, FX_VIS_SLOTS - 1)).toVar();
    const vv = fxVisU.falls.element(slot);
    const kv = select(FA.w.greaterThan(1.5), vv.z, vis3(vv, clamp(FA.y.div(max(FA.z, 1e-3)), 0, 1)));
    return eKey()
      .mul(ndl.mul(0.6).add(0.4))
      .mul(max(env.keyDir.y, 0).mul(4).min(1))
      .mul(kv)
      .add(eSky().mul(0.85))
      .add(eGnd().mul(0.2))
      .add(spillIrradiance(P, Nrm).mul(0.5));
  })();
  // projected width (px): sub-pixel ribbons fade out (no aliased threads in wide shots)
  const px = FB.z.mul(env.pxPerKm).div(camDist);
  const vis = smoothstep(0.8, 3, px);
  const vT = varying(fog.T, 'vFallT');
  const vS = varying(fog.S, 'vFallS');
  const vE = varying(E, 'vFallE');
  const vA = varying(FA, 'vFallA');
  const vB = varying(vec4(FB.x, FB.y, vis, FB.w), 'vFallB');
  const vP = varying(P, 'vFallP');
  const vSky = varying(env.skyColor.mul(env.hemiIntensity), 'vFallSky');

  const m = new NodeMaterial();
  m.name = 'fx-falls';
  m.vertexNode = clip;
  m.fragmentNode = Fn(() => {
    const u = vA.x;
    const v = vA.y;
    const L = max(vA.z, 1e-3);
    const layer = vA.w;
    const w = vB.x;
    const seed = vB.y;
    const isFoam = layer.greaterThan(1.5);
    // streaks: across the width ~ one per 12 m (5 … 48), stretched along the flow by the water's
    // acceleration (time of travel ∝ √v), scrolling down with the effect clock
    const nAcross = clamp(w.div(0.012), 5, 48);
    const streakLen = w.div(nAcross).mul(7);
    const tau = sqrt(v.mul(L)).mul(2).div(streakLen.mul(FALLS.streakStretch));
    const uvA = vec2(u.mul(nAcross).div(8).add(seed), tau.div(8).sub(env.tFx.mul(0.55)).add(layer.mul(0.37)));
    const n1 = texture(noise, uvA).r;
    let n = n1;
    if (o.detail) n = n1.mul(0.65).add(texture(noise, uvA.mul(vec2(2.3, 1.7)).add(vec2(0.31, env.tFx.mul(-0.4)))).b.mul(0.35));
    // across: aerated core, ragged translucent edges (wide, noise-eaten: no paper-cut border)
    const edgeW = mix(float(0.22), float(0.36), layer.min(1)).add(n.sub(0.5).mul(0.18));
    const edge = smoothstep(0, edgeW, u).mul(smoothstep(1, float(1).sub(edgeW), u));
    // along: glassy at the lip, white lower down, thinning into the spray at the foot; the lip itself fades
    // in over the first few percent (a ragged top edge, never a flat cut line)
    const vf = v.div(L);
    const aer = smoothstep(0.02, 0.3, vf);
    const lip = smoothstep(0, 0.07, vf.add(n.sub(0.5).mul(0.06)));
    const foot = float(1).sub(smoothstep(0.88, 1, vf).mul(0.55));
    const core = edge.mul(mix(float(0.55), float(1), aer)).mul(clamp(n.mul(1.3).add(0.22), 0, 1)).mul(foot).mul(lip);
    const veil = core.mul(0.38);
    const aCurtain = mix(core, veil, layer.min(1));
    // plunge foam: churning patches round the foot (world-space noise drifting with the effect clock),
    // thinning out to a ragged edge
    const r = u;
    // (curtains carry no foam radius: a fixed divisor keeps their discarded coordinates small)
    const fq = vP.xz.div(max(vB.w, 0.05).mul(0.45)).add(vec2(seed.mul(7), env.tFx.mul(0.08)));
    const fn = texture(noise, fq.div(4)).g;
    const aFoam = float(1).sub(smoothstep(0.25, 1, r.add(fn.sub(0.5).mul(0.5)))).mul(smoothstep(0.3, 0.7, fn.add(float(1).sub(r).mul(0.25)))).mul(0.8);
    const alpha = mix(aCurtain, aFoam, select(isFoam, float(1), float(0))).mul(vB.z);
    // colour: white aerated water; the glassy lip carries a dark-water / sky tint
    const foam = vec3(0.86, 0.88, 0.9).mul(vE);
    const glass = vec3(0.1, 0.13, 0.14).mul(vE).add(vSky.mul(0.12));
    const white = select(isFoam, float(1), aer.mul(n.mul(0.45).add(0.65)));
    const col = mix(glass, foam, clamp(white, 0, 1)).mul(vT).add(vS);
    return vec4(col.mul(alpha), alpha);
  })();
  premultiplied(m);
  return m;
}

// ------------------------------------------------------------------------------------------ mist

/**
 * Mist cards (one static mesh of stacked horizontal grids). Vertex attributes: position ·
 * mistA = (u, v across the card −1..1, layer 0..1, ground height under the vertex) · mistB = (tint rgb,
 * opacity) · mistC = (layer spacing km, half-width km, noise offset, top-light share) · mistI = the card's
 * index (its fxVisU slot).
 */
export function createMistMaterial(noise: Texture, heights: Texture, spec: WorldSpec, o: FxMaterialOptions): NodeMaterial {
  const P = attribute('position', 'vec3');
  const MA = attribute('mistA', 'vec4');
  const MB = attribute('mistB', 'vec4');
  const MC = attribute('mistC', 'vec4');
  const MI = attribute('mistI', 'float');
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(P, 1)));
  const fog = fogSplit(P, o.detail);
  // pale droplet light (the W1 valley mist's model, brighter: a card is the dense core of that layer): key
  // (more on the top layers, forward-scattered toward the sun) + sky, desaturated, tinted by the card and
  // the region's chroma (Morgul's green); the spill (Morgul's wall-wash, a beacon) lights it strongly
  const lum = vec3(0.2126, 0.7152, 0.0722);
  // (S4 C2: lit mostly by the sky — with the full key, a card in golden light read as pink cotton wool)
  const keyK = mix(float(0.15), float(0.3), MA.z.mul(MC.w));
  const lit = Fn(() => {
    const view = normalize(P.sub(env.cameraPos));
    const fwd = pow(clamp(dot(view, env.keyDir), 0, 1), 6).mul(0.7);
    // the key's visibility over the terrain along the card (a layer in a gorge's shade takes no sun)
    const slot = int(clamp(MI, 0, FX_VIS_SLOTS - 1)).toVar();
    const kv = vis3(fxVisU.mist.element(slot), MA.x.mul(0.5).add(0.5));
    const e = eKey().mul(keyK.add(fwd)).mul(max(env.keyDir.y, 0).mul(5).min(1)).mul(kv).add(eSky().mul(0.85));
    const grey = vec3(dot(e, lum));
    const reg = atmosphere.regional(P.xz, true).rgb;
    const chroma = mix(vec3(1), reg.div(max(dot(reg, lum), 0.05)), 0.6);
    // the lower layers a little cooler (the shade under the layer), the top one warmer (its lit skin)
    const strata = mix(vec3(0.93, 0.97, 1.04), vec3(1.03, 1.0, 0.96), MA.z);
    return mix(grey, e, 0.45).mul(chroma).mul(strata).mul(MB.rgb).add(spillIrradiance(P, vec3(0, 1, 0)).mul(MB.rgb).mul(0.6));
  })();
  // dawn, dusk and night weighted; thin wisps by day
  const tod = float(0.3).add(clamp(max(max(env.golden, env.twilight.mul(0.9)), env.night.mul(0.75)), 0, 1).mul(0.7));
  // a flat layer seen edge-on reads as a line: grazing views see more of it but never a hard sheet
  const camDist = max(length(env.cameraPos.sub(P)), 1e-3);
  const sinEl = abs(env.cameraPos.y.sub(P.y)).div(camDist);
  const graze = smoothstep(0.015, 0.12, sinEl).mul(min(float(1).div(max(sinEl.mul(3), 0.6)), 1.25));
  // wide shots: the cards fade with their projected size (the atmosphere's valley mist takes over)
  const px = MC.y.mul(2).mul(env.pxPerKm).div(camDist);
  const vis = smoothstep(MIST.lodPx[0], MIST.lodPx[1], px);
  // a camera inside the layer sees no card edge in the lens
  const inLayer = smoothstep(MC.x.mul(0.5), MC.x.mul(2), abs(env.cameraPos.y.sub(P.y)));
  const vT = varying(fog.T, 'vMistT');
  const vS = varying(fog.S, 'vMistS');
  const vLit = varying(lit, 'vMistLit');
  const vA = varying(MA, 'vMistA');
  const vK = varying(vec4(MB.a.mul(tod).mul(graze).mul(vis).mul(inLayer), MC.x, MC.z, 0), 'vMistK');
  const vP = varying(P, 'vMistP');
  const hFrame = vec4(spec.xMin, spec.zMin, 1 / spec.width, 1 / spec.depth);

  const m = new NodeMaterial();
  m.name = 'fx-mist';
  m.vertexNode = clip;
  m.fragmentNode = Fn(() => {
    const u = vA.x;
    const v = vA.y;
    // drifting billows (world xz, wind × tFx), a finer octave in review / final; preview's one tap is a
    // broader, lower-frequency layer (no discrete blobs)
    const q = vP.xz.sub(env.wind.mul(env.tFx).mul(0.012)).div(2.4).add(vec2(vK.z, vA.z.mul(0.37)));
    const t0 = texture(noise, q.div(o.detail ? 4 : 7));
    let n: N = t0.g;
    if (o.detail) n = n.mul(0.6).add(texture(noise, q.mul(0.61).add(vec2(0.17, 0.53))).r.mul(0.4));
    // footprint: a rounded band whose border is eaten by the low-frequency noise (the same tap's other
    // channel) — no straight card edge, no parallelogram ends
    const ne = t0.r.sub(0.5);
    const ru = abs(u).add(ne.mul(0.45));
    const rv = abs(v).add(ne.mul(0.6));
    const edge = float(1).sub(smoothstep(0.3, 0.95, ru)).mul(float(1).sub(smoothstep(0.15, 0.9, rv)));
    const dens = smoothstep(0.28, 0.8, n.add(edge.mul(0.25))).mul(edge);
    // where the ground rises to the layer the mist thins out over a broad, ragged ramp (soft against the
    // valley sides: no contour line along the slope)
    let ground: N = vA.w;
    if (o.detail) ground = texture(heights, vec2(vP.x.sub(hFrame.x).mul(hFrame.z), vP.z.sub(hFrame.y).mul(hFrame.w))).r;
    const ramp = max(vK.y.mul(3.5), 0.06);
    const soft = smoothstep(0, ramp, vP.y.sub(ground).add(n.sub(0.5).mul(ramp).mul(0.8)));
    // (preview: its one broad layer and per-vertex ground cover more — a lighter veil)
    const a = clamp(dens.mul(soft).mul(vK.x).mul(o.detail ? 1 : 0.7), 0, 1);
    const col = vLit.mul(vT).add(vS);
    // a scattering layer: it veils the ground less than its in-scatter adds (it never darkens a dim scene)
    return vec4(col.mul(a), a.mul(MIST.occlusion));
  })();
  premultiplied(m);
  return m;
}

// ------------------------------------------------------------------------------------------ beam

/**
 * The beam (Minas Morgul's Great Signal): an additive, axis-aligned billboard along each beam. Vertex
 * attributes: position (on the axis) · beamA = (side −1..1, t 0..1 from the source, glow half-width km,
 * gate code) · beamB = (axis direction xyz, core half-width km) · beamC = (HDR colour rgb, beam length km).
 */
export function createBeamMaterial(noise: Texture): NodeMaterial {
  const P = attribute('position', 'vec3');
  const BA = attribute('beamA', 'vec4');
  const BB = attribute('beamB', 'vec4');
  const BC = attribute('beamC', 'vec4');
  const toCam = normalize(env.cameraPos.sub(P));
  const side = normalize(cross(BB.xyz, toCam).add(vec3(1e-5, 0, 0)));
  const pos = P.add(side.mul(BA.x.mul(BA.z)));
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(pos, 1)));
  // extinction only (an additive light must not add in-scatter twice), like the emission sprites
  const tau = atmosphere.opticalDepth(env.cameraPos, P, atmosphere.regional(P.xz, true).a);
  const T = exp(env.extinction.mul(tau).negate());
  const gate = gateNode(BA.w);
  const vA = varying(BA, 'vBeamA');
  const vC = varying(BC.rgb.mul(T).mul(gate), 'vBeamC');
  const vK = varying(vec2(BB.w.div(max(BA.z, 1e-4)), BC.w), 'vBeamK');

  const m = new NodeMaterial();
  m.name = 'fx-beam';
  m.vertexNode = clip;
  m.fragmentNode = Fn(() => {
    const t = vA.y;
    // a roiling column: the width breathes along the axis and with the effect clock, and the axis sways a
    // little (more toward the top) — the Great Signal, not a laser line
    const roil = texture(noise, vec2(0.31, t.mul(vK.y).div(4).sub(env.tFx.mul(0.18))));
    const sway = roil.g.sub(0.5).mul(0.35).mul(t);
    const width = roil.r.mul(0.7).add(0.65);
    const x = abs(vA.x.sub(sway)).div(width);
    const kc = max(vK.x, 0.03);
    // a narrow hot core inside a broad soft glow (3–5 × wider), the glow streaked by the ripples
    const rip = texture(noise, vec2(vA.x.mul(0.35).add(0.3), t.mul(vK.y).div(2.5).sub(env.tFx.mul(0.6)))).r;
    const core = exp(pow(x.div(kc), 2).mul(-1.5));
    const glow = exp(x.mul(x).mul(-3.2)).mul(0.16).mul(rip.mul(0.9).add(0.55));
    const prof = core.mul(rip.mul(0.5).add(0.75)).add(glow).mul(float(1).sub(smoothstep(0.75, 1, abs(vA.x))));
    // brightest at the crown, fading into the pall
    const along = smoothstep(0, 0.03, t).mul(float(1).sub(smoothstep(0.7, 1, t))).mul(float(1.25).sub(t.mul(0.55)));
    return vec4(vC.mul(prof.mul(along)), 1);
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
