import { MeshStandardNodeMaterial, PhysicalLightingModel, type Data3DTexture } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import { env } from '../materials/environment.ts';
import type { World } from '../world/World.ts';
import { RING, RNOM } from './clumpGeometry.ts';
import { createFoamTexture, FOAM_PERIOD } from './foamTexture.ts';
import { Kind, KIND_COUNT } from './placement.ts';

type N = TslNode;

const {
  Fn,
  abs,
  attribute,
  cameraViewMatrix,
  clamp,
  cos,
  diffuseColor,
  dot,
  float,
  floor,
  fract,
  hash,
  int,
  length,
  max,
  mix,
  normalView,
  normalize,
  output,
  positionViewDirection,
  positionWorld,
  pow,
  select,
  sin,
  smoothstep,
  texture,
  texture3D,
  uint,
  uniform,
  uniformArray,
  varying,
  vec2,
  vec3,
  vec4,
} = tsl;

/** Per-kind shader parameters, indexed by `Kind`. */
function perKind(values: Partial<Record<Kind, number>>, fallback: number): N {
  const arr: number[] = [];
  for (let k = 0; k < KIND_COUNT; k++) arr.push(values[k as Kind] ?? fallback);
  return uniformArray(arr, 'float');
}

/** float kind node == K (kinds travel as floats; avoids int/float literal mixing in WGSL) */
function kindIs(kindNode: N, k: number): N {
  return abs(kindNode.sub(k)).lessThan(0.5);
}

/** sRGB hex → linear vec3 constant */
function srgb(hex: number): N {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return vec3(c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255));
}

/**
 * Foliage lighting: a soft "wrap" diffuse (light bleeding round the clump — the soft,
 * subsurface-like read of foam clump foliage) and view-dependent back-translucency so crowns glow
 * when back-lit at golden hour. No microfacet specular: a leaf mass is a matte scatterer, and
 * Fresnel sheen on thousands of bump normals turned the canopy chalky. Every direct term uses the
 * shadowed light colour, so canopies in a mountain's shadow stay dark. Indirect (hemisphere)
 * light comes from the inherited physical model, plus a per-kind sky fill (a leaf mass transmits
 * and multiply-scatters the sky light, so a shaded canopy never crushes to black at golden hour,
 * dawn or night), both attenuated by `aoNode`.
 */
class FoliageLightingModel extends PhysicalLightingModel {
  constructor(private readonly foliage: FoliageNodeMaterial) {
    super();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override direct(input: any): void {
    const { lightDirection, lightColor, reflectedLight } = input;
    const m = this.foliage;
    const nl = normalView.dot(lightDirection);
    const w = m.wrapNode;
    const wrapped = nl.add(w).div(w.add(1)).clamp();
    reflectedLight.directDiffuse.addAssign(wrapped.mul(lightColor).mul(diffuseColor.rgb).mul(1 / Math.PI));

    const scatter = normalize(lightDirection.add(normalView.mul(m.transDistortionNode)));
    const back = pow(positionViewDirection.dot(scatter.negate()).clamp(), m.transPowerNode);
    const rim = float(1).sub(normalView.dot(positionViewDirection).clamp()).mul(0.75).add(0.25);
    reflectedLight.directDiffuse.addAssign(back.mul(rim).mul(m.transColorNode).mul(lightColor));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override indirectDiffuse(builder: any): void {
    super.indirectDiffuse(builder);
    const { irradiance, reflectedLight } = builder.context;
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(diffuseColor.rgb).mul(this.foliage.skyFillNode).mul(1 / Math.PI));
  }
}

export class FoliageNodeMaterial extends MeshStandardNodeMaterial {
  /** wrap-diffuse amount w in (N·L + w) / (1 + w) */
  wrapNode: N = float(0.45);
  /** translucency colour (already multiplied by strength) */
  transColorNode: N = vec3(0);
  transDistortionNode: N = float(0.35);
  transPowerNode: N = float(4);
  /** extra hemisphere (sky + ground bounce) response of the leaf mass, × albedo */
  skyFillNode: N = float(0);
  /**
   * Foliage albedo. Deliberately NOT `colorNode`: the renderer folds `colorNode.a` into the
   * shadow-pass fragment shader, which dragged the whole micro-structure graph into every
   * shadow-map texel. Assigned in setupDiffuseColor instead.
   */
  albedoNode: N = vec3(0.1);

  override setupDiffuseColor(): void {
    diffuseColor.assign(vec4(this.albedoNode, 1));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override setupLightingModel(): any {
    return new FoliageLightingModel(this);
  }
}

export interface FoliageMaterialParts {
  material: FoliageNodeMaterial;
  /** screen pixels per km at 1 km distance (viewportHeight / (2 tan(fov/2))) — set per frame */
  pxPerKm: { value: number };
  /** per-kind tuning arrays (uniform arrays; edit `.array[kind]` for live look-dev) */
  kindParams: Record<'trans' | 'glow' | 'grain' | 'dens' | 'fill' | 'tone' | 'hue', { array: number[] }>;
}

/** Feature switches (quality tier / perf experiments; defaults are the production look). */
export interface FoliageOptions {
  /**
   * fragment micro structure: foam-clump texture taps (0 = none, 1 = clumps, 2 = clumps + fine
   * porosity). The preview tier uses 1, stills and film 2.
   */
  microTaps?: 0 | 1 | 2;
  /** shared foam texture (built once per system; created here when omitted) */
  foam?: Data3DTexture;
}

/**
 * Foliage material family (all trees, hedges and forest canopy in the project).
 *
 * Instances are drawn with a plain InstancedBufferGeometry (clumpGeometry.ts — a cluster of seven
 * sub-crowns): `iA` = (x, z, hr, vr), `iB` = (trunk, kind*8 + yaw, aspect, spread + 2·gapQ),
 * `iC` = sRGB albedo + sub-crown height variation (unorm8x4). The vertex stage lays the cluster
 * out per instance — each sub-crown gets a hashed size, height, offset and tone, and is dropped
 * with probability gap (canopy gaps, broken hedges) — scales, rotates, sits it on the HeightField
 * texture (always consistent with the terrain, stamps included) and sways it with `env.tFx`. The
 * fragment stage adds the clump micro structure from a precomputed tileable 3D foam field (one tap
 * per scale, faded out by screen size), crown-scale self shadowing and per-kind tone.
 */
export function createFoliageMaterial(world: World, opts: FoliageOptions = {}): FoliageMaterialParts {
  const taps = opts.microTaps ?? 2;
  const spec = world.spec;
  const hTex = world.heights.texture;
  const pxPerKm = uniform(1000);

  const iA = attribute('iA', 'vec4');
  const iB = attribute('iB', 'vec4');
  const iC = attribute('iC', 'vec4');
  const lp = attribute('position', 'vec3');
  const ln = attribute('normal', 'vec3');
  const sub = attribute('sub', 'vec4');
  const meta = attribute('clumpMeta', 'vec3');
  const part = meta.x;
  const cavity = meta.y;
  const relief = meta.z;

  const kind = floor(iB.y.div(8));
  const yaw = iB.y.sub(kind.mul(8));
  const seed = fract(yaw.mul(7.31).add(iA.x.mul(0.0137)).add(iA.y.mul(0.0071)));
  const ik = int(kind).toVar();
  const hr = iA.z;
  const vr = iA.w;
  const trunk = iB.x;
  const aspect = iB.z;
  const gapQ = floor(iB.w.div(2));
  const spread = iB.w.sub(gapQ.mul(2));
  const gap = gapQ.div(50);
  const hVar = iC.a;
  const cs = cos(yaw);
  const sn = sin(yaw);

  const transK = perKind({ [Kind.Mirkwood]: 0.2, [Kind.Fangorn]: 0.24, [Kind.Lorien]: 0.55, [Kind.Dark]: 0.26, [Kind.Hedge]: 0.22 }, 0.34);
  // effective canopy albedo: a leaf mass self-shadows far more than a smooth clump can show
  const densK = perKind({ [Kind.Lorien]: 1.0, [Kind.Mirkwood]: 1.05, [Kind.Fangorn]: 1.0, [Kind.Hedge]: 0.9 }, 0.95);
  // sky fill of the shaded canopy (dark kinds need the most to stay readable)
  const fillK = perKind({ [Kind.Mirkwood]: 1.1, [Kind.Fangorn]: 0.95, [Kind.Dark]: 0.95, [Kind.Lorien]: 0.55, [Kind.Hedge]: 0.4 }, 0.6);
  const glowK = perKind({ [Kind.Lorien]: 1 }, 0);
  const grainK = perKind({ [Kind.Hedge]: 0.7, [Kind.Mirkwood]: 1.1, [Kind.Fangorn]: 1.05 }, 1);
  // per-sub-crown brightness and warm/cool spread
  const toneK = perKind({ [Kind.Mirkwood]: 0.34, [Kind.Fangorn]: 0.36, [Kind.Lorien]: 0.4, [Kind.Hedge]: 0.3, [Kind.Ithilien]: 0.34 }, 0.3);
  const hueK = perKind({ [Kind.Mirkwood]: 0.08, [Kind.Lorien]: 0.08, [Kind.Fangorn]: 0.1, [Kind.Hedge]: 0.06 }, 0.09);
  // trunk radius / horizontal crown radius (mallorns: stout silver columns)
  const trunkK = perKind({ [Kind.Lorien]: 0.12, [Kind.Hedge]: 0 }, 0.085);

  // ---------------------------------------------------------------- vertex
  const uvI = vec2(iA.x.sub(spec.xMin).div(spec.width), iA.y.sub(spec.zMin).div(spec.depth));
  const ground = texture(hTex, uvI).level(0).r;
  const isTrunk = part.greaterThan(0.5);

  // per (instance, sub-crown) random numbers
  const subIdx = sub.w;
  const hBase = uint(seed.mul(16777215)).mul(uint(64)).add(uint(subIdx.mul(8)));
  const h = (k: number) => hash(hBase.add(uint(k)));
  const isCentre = subIdx.lessThan(0.5);
  const dropped = isCentre.not().and(h(1).lessThan(gap));
  const size = select(dropped, float(0), mix(float(0.6), float(1.2), h(2)));
  // some crowns taller and narrower, some squat
  const sy = mix(float(0.8), float(1.32), h(8));
  const kSpread = float(1).sub(spread.mul(RING)).div(RNOM);
  // the far LOD's single blob (sub.z = WHOLE) already spans the cluster, whatever its spread
  const R = sub.z.mul(select(sub.z.greaterThan(0.9), float(1), kSpread)).mul(size);
  const cy = R.mul(sy).mul(0.55).add(h(3).sub(0.5).mul(hVar));
  const jit = spread.mul(0.16);
  const centreU = vec3(sub.x.mul(spread).add(h(4).sub(0.5).mul(jit)), cy, sub.y.mul(spread).add(h(5).sub(0.5).mul(jit)));
  const u = centreU.add(vec3(lp.x, lp.y.mul(sy), lp.z).mul(R));
  const crownLocal = vec3(u.x.mul(hr), u.y.mul(vr).add(trunk), u.z.mul(hr).mul(aspect));
  // trunks only where the crown is lifted off the ground (forest canopy hides its stems)
  const tr = select(trunk.greaterThan(vr.mul(0.04)), hr.mul(trunkK.element(ik)), float(0));
  const trunkTop = trunk.add(vr.mul(kSpread).mul(0.42 * 0.5));
  const trunkLocal = vec3(lp.x.mul(tr), mix(float(-0.25), trunkTop, lp.y), lp.z.mul(tr));
  const local = select(isTrunk, trunkLocal, crownLocal);

  // wind: gentle bend growing with height inside the crown (miniature → slow, small)
  const bend = clamp(local.y.sub(trunk).div(vr.mul(1.3)), 0, 1);
  const phase = env.tFx.mul(0.85).add(seed.mul(6.283)).add(iA.x.mul(0.07)).add(iA.y.mul(0.05));
  const sway = sin(phase).add(sin(phase.mul(2.3).add(1.7)).mul(0.4)).mul(hr).mul(0.02).mul(bend);
  const wl = max(length(env.wind), 1e-3);
  const wx = env.wind.x.div(wl).mul(sway);
  const wz = env.wind.y.div(wl).mul(sway);

  const rx = local.x.mul(cs).add(local.z.mul(sn));
  const rz = local.z.mul(cs).sub(local.x.mul(sn));
  const basePos = vec3(iA.x.add(rx).add(wx), ground.add(local.y), iA.y.add(rz).add(wz));

  // normal: inverse-transpose of the (non-uniform) scale, then the yaw rotation
  const nCrown = vec3(ln.x.div(hr), ln.y.div(vr.mul(sy)), ln.z.div(hr.mul(aspect)));
  const nGeo = normalize(nCrown);
  // a leaf mass scatters light from leaves of every orientation: soften the sphere shading of each
  // sub-crown towards the canopy's up (more for canopy patches than for single trees)
  const nCrownW = normalize(mix(nGeo, vec3(0, 1, 0), spread.mul(0.42)));
  const nL = select(isTrunk, normalize(ln), nCrownW);
  const nW = vec3(nL.x.mul(cs).add(nL.z.mul(sn)), nL.y, nL.z.mul(cs).sub(nL.x.mul(sn)));

  // foam clumps: size follows the sub-crown (small trees get small clumps); one field shared by
  // the vertex relief and the fragment micro structure
  const foam = taps > 0 ? (opts.foam ?? createFoamTexture(world.spec.json.seeds.world + 71)) : null;
  const grainOf = (subR: N, kIdx: N) => clamp(subR.mul(0.4), 0.022, 0.28).mul(grainK.element(kIdx));
  const foamOff = (sd: N) => vec3(sd.mul(37.1), sd.mul(5.3), sd.mul(11.3));
  let worldPos: N = basePos;
  if (foam && taps > 1) {
    // clump relief on near crowns (stills / film): displace along the geometric normal, so
    // silhouettes break up into clumps instead of smooth potatoes
    const grainV = grainOf(R.mul(hr), ik);
    const distV = length(vec3(iA.x, ground, iA.y).sub(env.cameraPos));
    const fadeV = smoothstep(2.5, 7.0, grainV.mul(pxPerKm).div(distV)).mul(select(isTrunk, float(0), relief));
    const tV = texture3D(foam, basePos.div(grainV).add(foamOff(seed)).div(FOAM_PERIOD)).level(0);
    const nGeoW = vec3(nGeo.x.mul(cs).add(nGeo.z.mul(sn)), nGeo.y, nGeo.z.mul(cs).sub(nGeo.x.mul(sn)));
    worldPos = basePos.add(nGeoW.mul(tV.a.sub(0.55).mul(grainV).mul(0.9).mul(fadeV)));
  }

  // sRGB bytes → linear, then the sub-crown's own tone (brightness + warm/cool)
  const tone = float(1).add(h(6).sub(0.5).mul(toneK.element(ik)));
  const warm = h(7).sub(0.5).mul(hueK.element(ik));
  const albedoV = pow(max(iC.rgb, vec3(0)), vec3(2.2)).mul(tone).mul(vec3(float(1).add(warm), 1, float(1).sub(warm.mul(1.5))));
  // cluster height fraction (0 bottom … 1 ≈ top of the centre crown)
  const uTop = kSpread.mul(0.42 * 1.55);

  const vNormal = varying(nW, 'vFolNormal');
  const vAlbedo = varying(albedoV, 'vFolAlbedo');
  // (crowns hung low by the height jitter may reach below 0: clamp, negative marks the trunk)
  const vCrownH = varying(select(isTrunk, float(-1), max(u.y.div(uTop), 0)), 'vFolCrownH');
  const vSubH = varying(lp.y, 'vFolSubH');
  const vCavity = varying(cavity, 'vFolCavity');
  const vKind = varying(kind, 'vFolKind');
  const vSeed = varying(seed, 'vFolSeed');
  const vSubR = varying(R.mul(hr), 'vFolSubR');

  // ---------------------------------------------------------------- fragment
  const nMacro = normalize(vNormal);
  const isTrunkF = vCrownH.lessThan(0);
  const crownF = select(isTrunkF, float(0), float(1));
  const ikF = int(vKind.add(0.5)).toVar();
  const p = positionWorld;
  const dist = length(p.sub(env.cameraPos));

  let bumpG: N = vec3(0);
  let creaseA: N = float(1);
  let creaseAO: N = float(1);
  if (foam) {
    const grain = grainOf(vSubR, ikF);
    const grainPx = grain.mul(pxPerKm).div(dist);
    const off = foamOff(vSeed);
    const fade1 = smoothstep(1.0, 4.0, grainPx).mul(crownF);
    const t1 = texture3D(foam, p.div(grain).add(off).div(FOAM_PERIOD));
    const g1 = t1.rgb.sub(0.5).mul(8);
    bumpG = g1.mul(fade1.mul(0.12));
    creaseA = mix(float(1), mix(float(0.82), float(1), t1.a), fade1);
    creaseAO = mix(float(1), mix(float(0.55), float(1), t1.a), fade1);
    if (taps > 1) {
      // fine porosity: the same field 2.6× smaller, axes swizzled so the two scales never align
      const g2s = grain.mul(0.34);
      const fade2 = smoothstep(1.0, 4.0, grainPx.mul(0.34)).mul(crownF);
      const t2 = texture3D(foam, p.zxy.div(g2s).add(off.yzx).div(FOAM_PERIOD));
      // leaf clusters: lit tips and dark holes, their normals scattered (sun speckle)
      bumpG = bumpG.add(t2.rgb.sub(0.5).mul(8).zxy.mul(fade2.mul(0.13)));
      creaseA = creaseA.mul(mix(float(1), mix(float(0.66), float(1.1), t2.a), fade2));
      creaseAO = creaseAO.mul(mix(float(1), mix(float(0.6), float(1), t2.a), fade2));
    }
  }
  // tilt the macro normal away from the clump centre (tangential part of the field gradient)
  const bumpT = bumpG.sub(nMacro.mul(dot(bumpG, nMacro)));
  const nFinal = normalize(nMacro.sub(bumpT));

  const crownH = clamp(vCrownH, 0, 1);
  // crown-scale self shadowing: each sub-crown's underside, and the cluster's lower part
  const subLit = smoothstep(-0.55, 0.8, vSubH);
  const clusterLit = smoothstep(0.0, 0.9, crownH);
  let alb: N = vAlbedo.mul(densK.element(ikF)).mul(mix(float(0.7), float(1), subLit)).mul(mix(float(0.8), float(1), clusterLit));
  // warm, sun-bleached crown tops
  alb = mix(alb, alb.mul(vec3(1.1, 1.06, 0.86)), smoothstep(0.6, 1.0, crownH).mul(0.3));
  alb = alb.mul(float(1).sub(vCavity.mul(0.35))).mul(creaseA);
  // trunks: dark bark, silver mallorn trunks in Lórien, pale sick trunks in Mirkwood
  const bark = select(kindIs(vKind, Kind.Lorien), srgb(0xa7aca6), select(kindIs(vKind, Kind.Mirkwood), srgb(0x5e5a4e), srgb(0x3b3026)));
  const albedo = select(isTrunkF, bark, alb);

  const ao = select(
    isTrunkF,
    float(0.7),
    mix(float(0.5), float(1), subLit).mul(mix(float(0.6), float(1), clusterLit)).mul(float(1).sub(vCavity.mul(0.4))).mul(creaseAO),
  );

  const material = new FoliageNodeMaterial();
  material.positionNode = worldPos;
  material.albedoNode = albedo;
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(nFinal, 0)).xyz);
  material.aoNode = ao;
  material.roughnessNode = float(0.8);
  material.metalnessNode = float(0);
  // the fill matters most when the key light is weak: moonlit night, blue hour, dawn
  material.skyFillNode = select(isTrunkF, float(0.3), fillK.element(ikF)).mul(float(1).add(env.night.mul(2.6)).add(env.twilight.mul(0.9)));
  material.transColorNode = select(isTrunkF, vec3(0), vAlbedo.mul(vec3(1.1, 1.3, 0.6)).mul(transK.element(ikF)).mul(0.85));
  // Lórien: faintly luminous gold (stronger at night); mallorn bark catches a little of it
  material.emissiveNode = select(isTrunkF, bark.mul(0.2), vAlbedo)
    .mul(glowK.element(ikF))
    .mul(float(0.012).add(env.night.mul(0.024)))
    .mul(select(isTrunkF, float(1), crownH.mul(0.6).add(0.4)));
  // Guard against the post grade: its saturation (>1) extrapolates away from luma and a saturated
  // gold with little blue went negative → pow() → NaN → black crowns. Keep every channel above
  // a small fraction of luma (visually identical, numerically safe).
  material.outputNode = Fn(() => {
    const c = output.rgb;
    const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return vec4(max(c, vec3(l.mul(0.12))), output.a);
  })();
  return {
    material,
    pxPerKm,
    kindParams: { trans: transK, glow: glowK, grain: grainK, dens: densK, fill: fillK, tone: toneK, hue: hueK },
  };
}
