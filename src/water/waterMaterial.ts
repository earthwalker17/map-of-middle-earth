import { FrontSide, LessDepth, MeshStandardNodeMaterial, type DataTexture } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import { env } from '../materials/environment.ts';
import { atmosphere } from '../materials/atmosphere.ts';
import { coarseGroundAlbedo, groundLookTexture, groundPalette } from '../materials/looks.ts';
import type { QualityTier } from '../core/quality.ts';
import type { World } from '../world/World.ts';
import { spillGlint, spillIrradiance } from '../emission/spill.ts';
import type { ReflectorRecord } from '../landmarks/records.ts';

type N = TslNode;
type RGB = [number, number, number];

const {
  abs,
  attribute,
  cameraPosition,
  cameraViewMatrix,
  clamp,
  dot,
  exp,
  float,
  fwidth,
  length,
  max,
  min,
  mix,
  Fn,
  If,
  normalize,
  positionGeometry,
  pow,
  reflect,
  saturate,
  select,
  sin,
  smoothstep,
  sqrt,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} = tsl;

export type WaterKind = 'sea' | 'lake' | 'river';

/** One scrolling octave of the shared wave-slope texture. */
export interface WaveLayer {
  /** tile size, km */
  scale: number;
  /** direction relative to the wind (sea/lakes) or the flow (rivers), degrees */
  angle: number;
  /** RMS slope this octave contributes (per axis) */
  slope: number;
  /** drift along its direction, km per effect-second */
  speed: number;
  /** > 1 elongates crests across the direction of travel */
  stretch?: number;
  /** drop this octave in the preview tier */
  heavy?: boolean;
}

/**
 * Parameters of one member of the water family. All colours are linear albedos.
 * Depths are world units below the surface (the bathymetry is exaggerated like the relief).
 */
export interface WaterParams {
  kind: WaterKind;
  /** in-scatter albedo of the water body where it is deep */
  deep: RGB;
  /** in-scatter albedo of the water body over the shallows */
  shallow: RGB;
  /** depth (units) over which in-scatter goes shallow → deep */
  scatterDepth: number;
  /** absorption per unit of optical path (r, g, b) — red dies first */
  absorb: RGB;
  /** bed albedo near the shore / deeper down */
  bedNear: RGB;
  bedFar: RGB;
  bedDepth: number;
  waves: WaveLayer[];
  /** GGX alpha of the calm surface (before ripple variance is added) */
  calmAlpha: number;
  /** scale on the Fresnel sky reflection */
  reflection: number;
  /** shoreline foam strength and band width (km) */
  foam: number;
  foamWidth: number;
  /** animated lapping lines (0 = none) */
  lap: number;
  /** large-scale colour / roughness variation amount */
  variation: number;
  /** depth pull toward the camera = min(dist · k, max) (km) — hides coarse-LOD terrain in thin water */
  pullK: number;
  pullMax: number;
  /** river flow speed along the ribbon (km per effect-second) */
  flowSpeed?: number;
  /** heightfield-traced terrain reflection steps (0 = sky only); scaled down in preview */
  traceSteps: number;
  traceStart: number;
  traceGrowth: number;
  /** cap of the sun-relief gain on the bed seen through shallows (default 1.8) */
  bedLightMax?: number;
  /**
   * S4 W4-S1 rivers: Fresnel floor of far water (footprint ≫ the ripples: sub-pixel facets tilted toward
   * the horizon raise the mean reflectance) — rivers read as silver-blue threads at regional range
   */
  farSheen?: number;
  /** S4 W4-S1 rivers: width of the ribbon's edge fade in pixels (default: the S3 fixed 28 % of the half width) */
  edgePx?: number;
  /**
   * S4 W4-S1 rivers: tint of the mirrored terrain (linear rgb, default none). A calm reach seen at a grazing
   * angle mirrored the lit hillside at nearly its own albedo and read as a grass trough; silt, the surface
   * film and the unresolved ripples' scatter make a river's mirror image a darker, cooler copy of its banks.
   */
  mirrorTint?: RGB;
}

export interface WaterMaterialOptions {
  world: World;
  waveTex: DataTexture;
  noiseTex: DataTexture;
  quality: QualityTier;
  params: WaterParams;
  /** upright reflection proxies (landmarkReflectors); tested in the reflection march of lakes and rivers */
  reflectors?: ReflectorRecord[];
}

/** linear albedo of a reflection proxy (weathered grey stone) */
const REFLECTOR_ALBEDO = 0.32;

const lin = (c: RGB): N => vec3(c[0], c[1], c[2]);

/**
 * alpha at or below which a lake / river fragment is discarded (no depth write): the lake skirt and the
 * ribbons' run-ons and edges (the open sea is never faded and skips the test)
 */
const WATER_ALPHA_TEST = 0.004;

/** deep-water scatter albedo of landmark pools (lake attribute waterPool = 1): dark peaty teal */
const POOL_DEEP: RGB = [0.007, 0.014, 0.016];

/** Debug view selector shared by all water materials (0 = beauty). Dev/QA only. */
export const waterDebug: N = uniform(0, 'int');

/**
 * The water material family: one factory for sea, lakes and rivers.
 *
 * Shading model ("resin water"): a lit MeshStandardNodeMaterial whose
 *  - albedo is the water body: bed colour × transmittance + in-scatter × (1 − transmittance), with
 *    per-channel absorption along a refracted path (depth from the HeightField, so shelves, lake
 *    beds and river channels show through the shallows);
 *  - normal is a sum of scrolling octaves of a LEAN wave-slope texture driven only by env.tFx,
 *    rotated into env.wind (or the river flow); the filtered slope variance becomes GGX roughness,
 *    so the sun (and at night the moon) light gives a sharp glint close up and a broad sheen far away;
 *  - emissive is the (roughness-aware) Fresnel reflection of an analytic sky (env sky/fog/sun/moon
 *    colours); where a short march of the reflected ray through the HeightField hits terrain, the
 *    hit point is shaded instead (normal, grass/rock/snow albedo, sun/sky/moon, haze), so hills and
 *    cliffs mirror in lakes and calm bays. The march is skipped where the Fresnel term is tiny;
 *  - shoreline foam / lapping lines from depth ÷ bed slope (≈ distance to shore in km);
 *  - opacity only for anti-aliased waterlines, lake outflows and river edges.
 * Shadows from the sun shadow map apply to both diffuse and glint (receiveShadow).
 */
export function createWaterMaterial(opts: WaterMaterialOptions): MeshStandardNodeMaterial {
  const { world, waveTex, noiseTex, quality, params: P } = opts;
  // the proxies: lakes and rivers, review / final (the sea has none standing in it)
  const reflectors = P.kind !== 'sea' && quality.id !== 'preview' ? (opts.reflectors ?? []) : [];
  const spec = world.spec;
  const hTex = world.heights.texture;
  const W = spec.width;
  const D = spec.depth;
  const e = world.heights.texel;
  const toUv = (xz: N): N => vec2(xz.x.sub(spec.xMin).div(W), xz.y.sub(spec.zMin).div(D));
  const heightAt = (xz: N): N => texture(hTex, toUv(xz)).r;
  const preview = quality.id === 'preview';

  const isRiver = P.kind === 'river';
  const flow = isRiver ? attribute('flow', 'vec4') : null; // along km, across −1..1, half width km, fade
  const flowDir = isRiver ? attribute('flowDir', 'vec4') : null; // dir.xz, rapid, lake share (rivers.ts)

  // ------------------------------------------------------------------ geometry / depth
  const pos = positionGeometry; // meshes live at identity → object space = world space
  const toCam = cameraPosition.sub(pos);
  const dist = length(toCam);
  const V = toCam.div(dist);
  const surfY = pos.y;
  const uv0 = toUv(pos.xz);
  const du = 1 / world.heights.width;
  const dv = 1 / world.heights.height;
  const h0 = texture(hTex, uv0).r;
  const hL = texture(hTex, uv0.sub(vec2(du, 0))).r;
  const hR = texture(hTex, uv0.add(vec2(du, 0))).r;
  const hU = texture(hTex, uv0.sub(vec2(0, dv))).r;
  const hD = texture(hTex, uv0.add(vec2(0, dv))).r;
  const grad = vec2(hR.sub(hL), hD.sub(hU)).div(2 * e);
  const gradLen = max(length(grad), 0.004);
  const depth0 = surfY.sub(h0);
  const footprint = max(length(fwidth(pos.xz)), 1e-4); // km per pixel

  // refracted view ray: where it meets the bed (one fixed-point step is plenty at these slopes)
  const cosV = clamp(V.y, 0.02, 1);
  const sinT = sqrt(float(1).sub(cosV.mul(cosV))).div(1.333);
  const cosT = sqrt(float(1).sub(sinT.mul(sinT)));
  const away = normalize(vec2(V.x, V.z).negate().add(vec2(1e-5, 0)));
  const bedXZ = pos.xz.add(away.mul(sinT.div(cosT)).mul(max(depth0, 0)));
  const depthB = max(surfY.sub(heightAt(bedXZ)), 0);
  const path = depthB.mul(float(1).add(float(1).div(cosT)));
  const T = exp(lin(P.absorb).negate().mul(path));

  // ------------------------------------------------------------------ variation (two noise fetches)
  // noise texture channels = value noise with 4/8/16/32 cells per tile
  const nLarge = texture(noiseTex, pos.xz.mul(1 / 560).add(vec2(0.13, 0.71))); // ~140/70/35/17 km
  const nSmall = texture(noiseTex, bedXZ.mul(1 / 9.2)); // ~2.3/1.15/0.57/0.29 km, on the bed
  const vN1 = nLarge.g.mul(2).sub(1);
  const vN2 = nLarge.a.mul(2).sub(1);
  const hueN = nLarge.r.mul(2).sub(1);
  const patch = clamp(float(1).add(vN1.mul(0.45 * P.variation)).add(vN2.mul(0.3 * P.variation)), 0.35, 1.8);

  // ------------------------------------------------------------------ waves (LEAN)
  let e1: N;
  let e2: N;
  let q: N;
  if (isRiver) {
    const d = normalize(flowDir!.xy);
    e1 = d;
    e2 = vec2(d.y.negate(), d.x);
    q = vec2(flow!.x.sub(env.tFx.mul(P.flowSpeed ?? 0)), flow!.y.mul(flow!.z));
  } else {
    const wlen = max(length(env.wind), 1e-3);
    const wd = env.wind.div(wlen);
    e1 = wd;
    e2 = vec2(wd.y.negate(), wd.x);
    q = vec2(dot(pos.xz, e1), dot(pos.xz, e2));
  }
  const windGain = isRiver ? float(1) : clamp(length(env.wind).mul(1.1), 0.5, 1.6);
  const gain = patch.mul(windGain);
  const layers = P.waves.filter((l) => !(preview && l.heavy));
  let sl: N = vec2(0, 0);
  let variance: N = float(0);
  // seen from far away (pixel footprint ≫ 100 m) the largest resolved octaves are the only
  // structure left and read as a repeating ripple pattern (the overview's tiled sea): there an
  // octave whose tile spans only a few dozen pixels fades out and hands its slope energy to the
  // roughness, so far water keeps the right sheen without the pattern. Up close every octave is
  // kept (the sub-pixel ones are LEAN-filtered as before) and the glint keeps its sparkle.
  const far = smoothstep(0.12, 0.4, footprint);
  const tilePx = (scale: number): N => float(scale).div(footprint);
  layers.forEach((L, i) => {
    const a = (L.angle * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const st = L.stretch ?? 1;
    const qa = q.x.mul(c).add(q.y.mul(s));
    const qb = q.y.mul(c).sub(q.x.mul(s));
    // per-layer fixed offset decorrelates the octaves (same texture)
    const uv = vec2(qa.sub(env.tFx.mul(L.speed)).div(L.scale * st).add(0.37 * i), qb.div(L.scale).add(0.61 * i));
    const t = texture(waveTex, uv);
    const sa = t.x.div(st);
    const sb = t.y;
    const lx = sa.mul(c).sub(sb.mul(s));
    const ly = sa.mul(s).add(sb.mul(c));
    const keep = mix(float(1), smoothstep(18, 70, tilePx(L.scale)), far);
    sl = sl.add(vec2(lx, ly).mul(L.slope).mul(keep));
    const va = max(t.z.div(st * st).sub(sa.mul(sa).mul(keep.mul(keep))), 0);
    const vb = max(t.w.sub(sb.mul(sb).mul(keep.mul(keep))), 0);
    variance = variance.add(va.add(vb).mul(0.5 * L.slope * L.slope));
  });
  // local slope → world gradient
  const slope = e1.mul(sl.x).add(e2.mul(sl.y)).mul(gain);
  // rapids: the ribbon steepens → rougher, whiter water
  const rapid = isRiver ? flowDir!.z : float(0);
  const slopeW = slope.mul(float(1).add(rapid.mul(1.5)));
  const nW = normalize(vec3(slopeW.x.negate(), 1, slopeW.y.negate()));
  const varTotal = variance.mul(gain.mul(gain)).mul(float(1).add(rapid.mul(4)));

  // ------------------------------------------------------------------ shoreline foam / lap
  const shoreDist = max(depth0, 0).div(gradLen); // ≈ km to the waterline
  // the band never gets thinner than ~a pixel; widened bands fade so far shots keep a faint surf line
  const bandW = float(P.foamWidth).add(footprint);
  const band = exp(shoreDist.div(bandW).negate()).mul(sqrt(float(P.foamWidth).div(bandW))).mul(float(1).sub(smoothstep(0.04, 0.3, depth0)));
  const lapLambda = 0.11;
  const nFoam = nSmall.g;
  const lines = smoothstep(0.55, 0.95, sin(shoreDist.mul((2 * Math.PI) / lapLambda).sub(env.tFx.mul(1.4)).add(nFoam.mul(8))).mul(0.5).add(0.5));
  const lineVis = float(1).sub(smoothstep(lapLambda * 0.2, lapLambda * 0.7, footprint)).mul(P.lap);
  const breakup = smoothstep(0.3, 0.7, nSmall.a);
  let foam: N = band.mul(mix(float(0.55), lines, lineVis)).mul(mix(float(0.6), breakup, 0.7)).mul(P.foam);
  if (isRiver) {
    // whitewater on steep reaches (Rauros, rapids); streaks along the flow (~0.6 km cells)
    const streakUv = vec2(flow!.x.sub(env.tFx.mul((P.flowSpeed ?? 0) * 2)).div(19.2), flow!.y.mul(0.1));
    const streak = texture(noiseTex, streakUv).a;
    foam = max(foam, rapid.mul(smoothstep(0.3, 0.7, streak)).mul(0.75));
  }
  foam = saturate(foam);

  // ------------------------------------------------------------------ water body colour
  // landmark pools (the Moria pool, Rivendell's, …) have no baked lake bed under them: their deep body
  // takes more scatter (a dark peaty teal, never a black slab)
  const poolW = P.kind === 'lake' ? attribute('waterPool', 'float') : float(0);
  const deep = mix(lin(P.deep), lin(POOL_DEEP), poolW);
  const scatter = mix(lin(P.shallow), deep, smoothstep(0, P.scatterDepth, depthB));
  // subtle hue/brightness drift (silt, plankton, wind slicks)
  const hueShift = vec3(hueN.mul(0.12), hueN.mul(0.04), hueN.mul(-0.08)).mul(P.variation);
  const scatterV = scatter.mul(vec3(1).add(hueShift)).mul(float(1).add(vN2.mul(0.12 * P.variation)));
  const bedAlb = mix(lin(P.bedNear), lin(P.bedFar), smoothstep(0, P.bedDepth, depthB))
    .mul(float(0.62).add(nSmall.r.mul(0.55)).add(nSmall.b.mul(0.15)));
  // bed relief lit by the sun, relative to the flat water surface that is actually lit
  const nBed = normalize(vec3(grad.x.negate(), 1, grad.y.negate()));
  const sunUp = max(env.sunDir.y, 0.2);
  const bedLight = clamp(max(dot(nBed, env.sunDir), 0).div(sunUp), 0.35, P.bedLightMax ?? 1.8);
  const bed = bedAlb.mul(mix(float(1), bedLight, float(0.75).mul(float(1).sub(env.night))));
  const body = bed.mul(T).add(scatterV.mul(vec3(1).sub(T)));

  // ------------------------------------------------------------------ roughness (LEAN variance → GGX)
  const calm2 = P.calmAlpha * P.calmAlpha;
  const alpha2 = float(calm2).add(varTotal.mul(2));
  const rough = clamp(pow(alpha2, 0.25), 0.06, 1);
  const sigma = sqrt(varTotal.mul(2)); // RMS slope of the sub-pixel ripples

  // ------------------------------------------------------------------ reflection
  const NdV = saturate(dot(nW, V));
  // roughness-aware Schlick (Fdez-Agüera): a rippled surface never reaches mirror Fresnel at grazing
  let fres: N = float(0.02).add(max(float(1).sub(rough), 0.02).sub(0.02).mul(pow(float(1).sub(NdV), 5)));
  // far water: the unresolved ripples' facets tilted toward the horizon lift the mean reflectance (S4
  // W4-S1: rivers as silver-blue threads at regional range instead of flat grey 'asphalt' bands)
  // (rivers: not where a ribbon runs into or out of a lake — flowDir.w, rivers.ts — so river and lake
  // match across the overlap instead of a lighter river band ending at a step)
  if (P.farSheen) {
    const sheen = smoothstep(0.03, 0.15, footprint).mul(P.farSheen).mul(float(1).sub(NdV).mul(0.6).add(0.4));
    fres = max(fres, isRiver ? sheen.mul(float(1).sub(flowDir!.w)) : sheen);
  }
  const Rv = reflect(V.negate(), nW);
  // unresolved ripples tilt part of the lobe up: reflected sky is sampled a little higher
  const Ry = abs(Rv.y).add(sigma.mul(0.6));
  // reflected sky: the atmosphere's horizon in-scatter in the reflected azimuth (the same colour
  // the dome shows there) rising to a zenith tone that carries the dome's regional tint
  // (S4 W1-A contract: under the ash deck the reflected zenith is the overcast's underside, the horizon
  // takes the focus-blended regional tint like the dome's)
  const zenith = mix(env.skyColor.mul(vec3(0.8, 0.95, 1.2)).mul(env.skyTint), env.deckSky, env.deck);
  const horizon = atmosphere.inScatter(vec3(Rv.x, 0, Rv.z)).mul(env.horizonTint);
  const sky = mix(horizon, zenith, pow(saturate(Ry), 0.5));
  const aureole = env.sunColor.mul(pow(saturate(dot(Rv, env.sunDir)), 10).mul(float(0.8).mul(float(1).sub(env.night))));
  const moonGlow = env.moonColor.mul(pow(saturate(dot(Rv, env.moonDir)), 40).mul(env.moonIntensity).mul(1.5));
  const skyRefl = sky.add(aureole).add(moonGlow);

  const steps = preview ? Math.min(P.traceSteps, 4) : P.traceSteps;
  let refl: N = skyRefl;
  if (steps > 0) {
    const groundTex = groundLookTexture(world);
    const southness = (z: N): N => z.sub(spec.zMin).div(D);
    const R3 = normalize(vec3(Rv.x, Ry, Rv.z));
    // explicit-LOD fetches: legal inside the dynamic branch below
    const hAtL = (xz: N): N => texture(hTex, toUv(xz)).level(0).r;
    refl = Fn(() => {
      const out = vec3(skyRefl).toVar();
      const dir = vec3(R3).toVar();
      const origin = vec3(pos).toVar();
      // the march only matters where the reflection is visible (skip the steep-view majority)
      If(fres.mul(P.reflection).greaterThan(0.035), () => {
        // march the reflected ray through the HeightField (geometric step growth)
        let occ: N = float(0);
        let tk = P.traceStart;
        let tPrev = 0;
        let hitT: N = float(P.traceStart * P.traceGrowth ** (steps - 1));
        for (let k = 0; k < steps; k++) {
          const p = origin.add(dir.mul(tk));
          const hit = smoothstep(-0.02, 0.12, hAtL(p.xz).sub(p.y));
          // first-hit distance (the ray enters the ground between the previous and this sample)
          hitT = mix(hitT, float(tPrev + (tk - tPrev) * 0.6), hit.mul(float(1).sub(occ)));
          occ = max(occ, hit);
          tPrev = tk;
          tk *= P.traceGrowth;
        }
        // shade the reflected terrain at the hit: heightfield normal and the terrain material's own
        // ground look + rock / alpine / snow rules (coarseGroundAlbedo: the shared ground look
        // texture and TERRAIN_SHADE, without the terrain's noise and masks), lit by sun + sky + moon
        // and seen through the same atmosphere as everything else (from the water surface to the
        // hit) — mountains and shores mirror in lakes and calm bays
        const hitP = origin.add(dir.mul(hitT));
        const huv = toUv(hitP.xz);
        const hs = (o: N): N => texture(hTex, huv.add(o)).level(0).r;
        const hx = hs(vec2(du * 2, 0)).sub(hs(vec2(-du * 2, 0)));
        const hz = hs(vec2(0, dv * 2)).sub(hs(vec2(0, -dv * 2)));
        const nH = normalize(vec3(hx.negate(), float(4 * e), hz.negate()));
        const hh = hs(vec2(0, 0));
        const slope = float(1).sub(nH.y);
        const alb = coarseGroundAlbedo(groundPalette(groundTex, huv, true), hh, slope, southness(hitP.z), nH.z.negate(), nH.x);
        // Reflections of landmarks standing in the water (the S3 'black holes' under the Argonath's
        // plinths and Tol Brandir): the march sees only the heightfield, so it hits the landmark's stamp
        // (Tol Brandir's 1.2 km plateau) and mirrors that short, dark lozenge with sky where the tall
        // spire should be. The reflected stone is legitimately dark against the bright sky (F ≈ 0.3 of a
        // dark rock); what is wrong is the missing silhouette above the stamp. A sky-share fallback made
        // every dark bank and cliff reflection milky (S4 W2-D critic) and was removed; the real fix is
        // landmark occluder proxies in the march (contract request: analytic upright proxies from the
        // landmark bounds of `onRiver` places, tested along the reflected ray).
        // the key under the ash deck (S4 W1-A contract: the Dead Marshes' pools no longer mirror the land
        // 2–4× brighter than the land itself), the hemisphere fill at its intensity, and (review / final)
        // the emission spill: lava, beacons and lit towns light the land their reflection shows
        const deckK = float(1).sub(atmosphere.deckCover(hitP.xz, true).mul(env.deckShadow));
        const sunLit = env.sunColor.mul(env.sunIntensity).mul(max(dot(nH, env.sunDir), 0)).mul(deckK);
        const skyLit = mix(env.groundColor, env.skyColor, nH.y.mul(0.5).add(0.5)).mul(env.hemiIntensity);
        const moonLit = env.moonColor.mul(env.moonIntensity).mul(max(dot(nH, env.moonDir), 0)).mul(deckK);
        let lit: N = sunLit.add(skyLit).add(moonLit);
        if (!preview) lit = lit.add(spillIrradiance(hitP, nH));
        const groundRad = alb.mul(lit).mul(1 / Math.PI);
        const hazed = atmosphere.apply(groundRad, origin, vec3(hitP.x, max(hitP.y, hh), hitP.z), quality.atmosphere.inScatter, true);
        out.assign(mix(out, P.mirrorTint ? hazed.mul(lin(P.mirrorTint)) : hazed, occ));
        // S4 C2: upright reflection proxies (the Argonath kings, Tol Brandir): exact ray / vertical-cylinder
        // tests; a proxy in front of the terrain hit (or with no terrain hit) mirrors as lit grey stone,
        // where the HeightField-only march showed the sky above the landmark's stamp (black lozenges)
        if (reflectors.length) {
          let tP: N = float(1e9);
          let cP: N = vec2(0, 0);
          const dxz = dir.xz;
          const a = max(dot(dxz, dxz), 1e-6);
          for (const r of reflectors) {
            const c = vec2(r.x, r.z);
            const oc = origin.xz.sub(c);
            const b = dot(oc, dxz);
            const disc = b.mul(b).sub(a.mul(dot(oc, oc).sub(r.r * r.r)));
            const t0 = b.negate().sub(sqrt(max(disc, 0))).div(a);
            const y = origin.y.add(dir.y.mul(t0));
            const ok = disc.greaterThan(0).and(t0.greaterThan(0)).and(y.greaterThan(r.y0)).and(y.lessThan(r.y1)).and(t0.lessThan(tP));
            tP = select(ok, t0, tP);
            cP = select(ok, c, cP);
          }
          const tT = select(occ.greaterThan(0.5), hitT, float(1e9));
          const front = select(tP.lessThan(tT), float(1), float(0));
          const hp = origin.add(dir.mul(min(tP, 1e3)));
          const nP = normalize(vec3(hp.x.sub(cP.x), 0, hp.z.sub(cP.y)).add(vec3(0, 1e-4, 0)));
          const deckP = float(1).sub(atmosphere.deckCover(hp.xz, true).mul(env.deckShadow));
          const litP = env.sunColor
            .mul(env.sunIntensity)
            .mul(max(dot(nP, env.sunDir), 0))
            .add(env.moonColor.mul(env.moonIntensity).mul(max(dot(nP, env.moonDir), 0)))
            .mul(deckP)
            .add(mix(env.groundColor, env.skyColor, 0.5).mul(env.hemiIntensity));
          const stone = atmosphere.apply(vec3(REFLECTOR_ALBEDO).mul(litP).mul(1 / Math.PI), origin, hp, quality.atmosphere.inScatter, true);
          // (stone keeps most of its value: the mirror tint is for the banks' turf, which read as dry grass)
          out.assign(mix(out, P.mirrorTint ? stone.mul(lin(P.mirrorTint).add(1).mul(0.5)) : stone, front));
        }
      });
      return out;
    })();
  }

  // ------------------------------------------------------------------ outputs
  const foamCol = vec3(0.78, 0.8, 0.8);
  const albedo = mix(body.mul(float(1).sub(fres)), foamCol, foam);
  // S4 W2-D: the emission spill on the water — glints of the lights (GGX on the water's own roughness,
  // Fresnel inside) and their diffuse light on the body and the foam
  const lights = spillGlint(pos, V, nW, rough).mul(float(1).sub(foam)).add(albedo.mul(spillIrradiance(pos, nW)).mul(1 / Math.PI));
  const emissive = refl.mul(fres).mul(P.reflection).mul(float(1).sub(foam.mul(0.8))).add(lights);
  const roughness = mix(rough, float(0.85), foam);

  // waterline anti-aliasing: ~1 pixel of depth (rivers: their edges fade by the across coordinate)
  let alpha: N = isRiver ? smoothstep(0, 0.02, depth0) : smoothstep(0, gradLen.mul(footprint).mul(1.5).add(0.004), depth0);
  if (P.kind === 'lake') {
    // baked lakes fade out by the baked lake mask; landmark pools (lakes.ts poolInfos, attribute
    // waterPool = 1) have no baked lake under them and keep only their waterline anti-aliasing
    const lakeMask = texture(world.water, uv0).g;
    const pool = attribute('waterPool', 'float');
    alpha = alpha.mul(max(smoothstep(0.12, 0.4, lakeMask), pool));
  }
  if (isRiver) {
    // the ribbon edge lies buried in the bank (bake v2): a wide see-through fade only showed the dark
    // channel paint under it as an outline at regional range — fade over a few pixels instead (S4 W4-S1)
    const ew = P.edgePx ? clamp(footprint.mul(P.edgePx).div(max(flow!.z, 1e-3)), 0.02, 0.28) : float(0.28);
    const edge = float(1).sub(smoothstep(float(1).sub(ew), 1.0, abs(flow!.y)));
    alpha = alpha.mul(edge).mul(flow!.w);
  }

  const material = new MeshStandardNodeMaterial({ transparent: true, side: FrontSide });
  material.name = `water-${P.kind}`;
  // debug views (waterDebug, emitted unlit): 1 body albedo, 2 reflection term, 3 lit without
  // reflection, 4 world normal, 5 roughness, 6 depth ×0.5, 7 foam
  const views: [number, N][] = [
    [1, body],
    [2, emissive],
    [3, vec3(0)],
    [4, nW.mul(0.5).add(0.5)],
    [5, vec3(rough)],
    [6, vec3(depthB.mul(0.5))],
    [7, vec3(foam)],
  ];
  material.colorNode = select(waterDebug.equal(0).or(waterDebug.equal(3)), albedo, vec3(0));
  material.emissiveNode = views.reduceRight((acc: N, [k, v]) => select(waterDebug.equal(k), v, acc), emissive);
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(nW, 0)).xyz);
  material.roughnessNode = roughness;
  material.metalnessNode = float(0);
  material.opacityNode = saturate(alpha);
  material.depthWrite = true;
  // fragments faded to nothing (over land, outside a lake's mask, past a ribbon's edge) are discarded
  // instead of writing depth (S4 W4-S1: the lake skirt must not hide what is drawn after the water); the
  // open sea is never faded and skips the discard (early depth on the overview's sea)
  if (P.kind !== 'sea') material.alphaTest = WATER_ALPHA_TEST;
  // lakes: a second coplanar layer (the skirt folding over itself on a concave shore) fails the depth test
  // instead of blending twice; the river run-ons still win through their larger depth pull
  if (P.kind === 'lake') material.depthFunc = LessDepth;

  // depth pull toward the camera (screen position unchanged): thin water wins against coarse LOD
  // terrain far away; negligible up close where the channel/lake bed is resolved
  if (P.pullK > 0) {
    const vp = positionGeometry;
    const vc = cameraPosition.sub(vp);
    const vd = length(vc);
    material.positionNode = vp.add(vc.div(vd).mul(min(vd.mul(P.pullK), P.pullMax)));
  }
  return material;
}
