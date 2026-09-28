import { MeshStandardNodeMaterial, PhysicalLightingModel } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import { env } from '../materials/environment.ts';
import type { World } from '../world/World.ts';
import { Kind, KIND_COUNT } from './placement.ts';

type N = TslNode;

const {
  Fn,
  If,
  abs,
  Loop,
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
  min,
  mix,
  mx_noise_float,
  normalView,
  normalize,
  output,
  positionViewDirection,
  positionWorld,
  pow,
  select,
  sin,
  smoothstep,
  step,
  texture,
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
 * Fresnel sheen on thousands of bump normals turned the canopy chalky. Every term uses the
 * shadowed light colour, so canopies in a mountain's shadow stay dark. Indirect (hemisphere)
 * light comes from the inherited physical model and is attenuated by `aoNode`.
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
}

export class FoliageNodeMaterial extends MeshStandardNodeMaterial {
  /** wrap-diffuse amount w in (N·L + w) / (1 + w) */
  wrapNode: N = float(0.3);
  /** translucency colour (already multiplied by strength) */
  transColorNode: N = vec3(0);
  transDistortionNode: N = float(0.35);
  transPowerNode: N = float(4);
  /**
   * Foliage albedo. Deliberately NOT `colorNode`: the renderer folds `colorNode.a` into the
   * shadow-pass fragment shader, which dragged the whole micro-structure graph (cellular bumps,
   * noise) into every shadow-map texel. Assigned in setupDiffuseColor instead.
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
  kindParams: Record<'noiseAmp' | 'trans' | 'glow' | 'grain' | 'dens', { array: number[] }>;
}

/** Feature switches (look-dev / perf experiments; defaults are the production look). */
export interface FoliageOptions {
  /** per-instance noise displacement of the crown silhouette */
  vertexNoise?: boolean;
  /** fragment micro structure (cellular foam balls, gaps) */
  micro?: boolean;
}

/**
 * Foliage material family (all trees, hedges and forest clumps in the project).
 *
 * Instances are drawn with a plain InstancedBufferGeometry: `iA` = (x, z, hr, vr),
 * `iB` = (trunk, kind*8 + yaw, aspect, 0), `iC` = sRGB albedo (unorm8x4). The vertex stage places,
 * scales, rotates and noise-displaces the canonical clump, sits it on the HeightField texture
 * (always consistent with the terrain, stamps included) and sways it with `env.tFx`. The fragment
 * stage adds the clump-foliage micro structure: a 3D cellular pattern of small sphere bumps (the
 * foam balls of a diorama tree) with crease occlusion, sponge-like gaps and per-ball colour
 * variation, faded out by screen size.
 */
export function createFoliageMaterial(world: World, opts: FoliageOptions = {}): FoliageMaterialParts {
  const useNoise = opts.vertexNoise ?? true;
  const useMicro = opts.micro ?? true;
  const spec = world.spec;
  const hTex = world.heights.texture;
  const pxPerKm = uniform(1000);

  const iA = attribute('iA', 'vec4');
  const iB = attribute('iB', 'vec4');
  const iC = attribute('iC', 'vec4');
  const lp = attribute('position', 'vec3');
  const ln = attribute('normal', 'vec3');
  const part = attribute('part', 'float');
  const cavity = attribute('cavity', 'float');

  const kind = floor(iB.y.div(8));
  const yaw = iB.y.sub(kind.mul(8));
  const seed = fract(yaw.mul(7.31).add(iA.x.mul(0.0137)).add(iA.y.mul(0.0071)));
  const ik = int(kind);
  const hr = iA.z;
  const vr = iA.w;
  const trunk = iB.x;
  const aspect = iB.z;
  const cs = cos(yaw);
  const sn = sin(yaw);

  const noiseAmpK = perKind({ [Kind.Fangorn]: 0.3, [Kind.Hedge]: 0.1, [Kind.Mirkwood]: 0.16, [Kind.Lorien]: 0.16 }, 0.22);
  const transK = perKind({ [Kind.Mirkwood]: 0.15, [Kind.Fangorn]: 0.2, [Kind.Lorien]: 0.55, [Kind.Dark]: 0.25, [Kind.Hedge]: 0.25 }, 0.35);
  // effective canopy albedo: a leaf mass self-shadows far more than a smooth clump can show
  const densK = perKind({ [Kind.Lorien]: 0.72, [Kind.Mirkwood]: 0.58, [Kind.Fangorn]: 0.46, [Kind.Hedge]: 0.55 }, 0.52);
  const glowK = perKind({ [Kind.Lorien]: 1 }, 0);
  const grainK = perKind({ [Kind.Hedge]: 0.55, [Kind.Mirkwood]: 1.15, [Kind.Fangorn]: 1.05 }, 1);

  // ---------------------------------------------------------------- vertex
  const uvI = vec2(iA.x.sub(spec.xMin).div(spec.width), iA.y.sub(spec.zMin).div(spec.depth));
  const ground = texture(hTex, uvI).level(0).r;
  const isTrunk = part.greaterThan(0.5);

  const centre = vec3(0, 0.62, 0);
  const nOff = vec3(seed.mul(71.3), seed.mul(13.7), seed.mul(41.1));
  const dn = useNoise ? mx_noise_float(lp.mul(1.9).add(nOff)).add(mx_noise_float(lp.mul(4.1).add(nOff.yzx)).mul(0.35)) : float(0);
  const lpc = centre.add(lp.sub(centre).mul(dn.mul(noiseAmpK.element(ik)).add(1)));
  const crownLocal = vec3(lpc.x.mul(hr), lpc.y.mul(vr).add(trunk), lpc.z.mul(hr).mul(aspect));
  const tr = hr.mul(select(kindIs(kind, Kind.Lorien), float(0.1), float(0.075)));
  const trunkTop = trunk.add(vr.mul(0.5));
  const trunkLocal = vec3(lp.x.mul(tr), mix(float(-0.25), trunkTop, lp.y), lp.z.mul(tr));
  const local = select(isTrunk, trunkLocal, crownLocal);

  // wind: gentle bend growing with height inside the crown (miniature → slow, small)
  const bend = clamp(local.y.sub(trunk).div(vr.mul(1.3)), 0, 1);
  const phase = env.tFx.mul(0.85).add(seed.mul(6.283)).add(iA.x.mul(0.07)).add(iA.y.mul(0.05));
  const sway = sin(phase).add(sin(phase.mul(2.3).add(1.7)).mul(0.4)).mul(hr).mul(0.022).mul(bend);
  const wl = max(length(env.wind), 1e-3);
  const wx = env.wind.x.div(wl).mul(sway);
  const wz = env.wind.y.div(wl).mul(sway);

  const rx = local.x.mul(cs).add(local.z.mul(sn));
  const rz = local.z.mul(cs).sub(local.x.mul(sn));
  const worldPos = vec3(iA.x.add(rx).add(wx), ground.add(local.y), iA.y.add(rz).add(wz));

  // normal: inverse-transpose of the (non-uniform) scale, then the yaw rotation
  const nCrown = vec3(ln.x.div(hr), ln.y.div(vr), ln.z.div(hr.mul(aspect)));
  const nL = normalize(select(isTrunk, ln, nCrown));
  const nW = vec3(nL.x.mul(cs).add(nL.z.mul(sn)), nL.y, nL.z.mul(cs).sub(nL.x.mul(sn)));

  // sRGB bytes → linear
  const albedoV = pow(max(iC.rgb, vec3(0)), vec3(2.2));

  const vNormal = varying(nW, 'vFolNormal');
  const vAlbedo = varying(albedoV, 'vFolAlbedo');
  const vCrownH = varying(select(isTrunk, float(-1), lp.y.div(1.3)), 'vFolCrownH');
  const vCavity = varying(cavity, 'vFolCavity');
  const vKind = varying(kind, 'vFolKind');
  const vSeed = varying(seed, 'vFolSeed');
  const vHr = varying(hr, 'vFolHr');

  // ---------------------------------------------------------------- fragment
  /**
   * Nearest feature point of a jittered 3D grid (2×2×2 search around the nearest cell corner;
   * jitter limited to ±0.3 so the reduced search is visually exact): returns (offset to feature,
   * cell random).
   */
  const cellular = Fn(([q]: [N]) => {
    const ip = floor(q);
    const fq = q.sub(ip);
    const base = step(vec3(0.5), fq).sub(1);
    const bestD = float(1e9).toVar();
    const bestOff = vec3(0).toVar();
    const bestR = float(0).toVar();
    Loop(2, 2, 2, ({ i, j, k }: { i: N; j: N; k: N }) => {
      const o = base.add(vec3(float(i), float(j), float(k)));
      const c = ip.add(o).add(16384);
      const hc = uint(c.x).mul(uint(73856093)).bitXor(uint(c.y).mul(uint(19349663))).bitXor(uint(c.z).mul(uint(83492791)));
      const h = vec3(hash(hc), hash(hc.add(uint(1))), hash(hc.add(uint(2))));
      const off = o.add(h.mul(0.6).add(0.2)).sub(fq);
      const dd = dot(off, off);
      If(dd.lessThan(bestD), () => {
        bestD.assign(dd);
        bestOff.assign(off);
        bestR.assign(hash(hc.add(uint(3))));
      });
    });
    return vec4(bestOff, bestR);
  });

  const nMacro = normalize(vNormal);
  const isTrunkF = vCrownH.lessThan(0);
  const ikF = int(vKind.add(0.5));
  const grain = clamp(vHr.mul(0.12), 0.05, 0.2).mul(grainK.element(ikF));
  const p = positionWorld;
  const dist = length(p.sub(env.cameraPos));
  const grainPx = grain.mul(pxPerKm).div(dist);
  const fade = useMicro ? smoothstep(1.2, 4.5, grainPx).mul(select(isTrunkF, float(0), float(1))) : float(0);

  const shadeFull = Fn(() => {
    const nOut = nMacro.toVar();
    const hBall = float(1).toVar();
    const rBall = float(0.5).toVar();
    If(fade.greaterThan(0.001), () => {
      const q = p.div(grain).add(vec3(vSeed.mul(37.1), 0, vSeed.mul(11.3)));
      const cell = cellular(q);
      const off = cell.xyz;
      const f1 = length(off);
      // sphere-bump normal, mirrored into the outer hemisphere of the macro surface
      const nb = normalize(off.negate());
      const nbOut = normalize(nb.sub(nMacro.mul(min(dot(nb, nMacro), 0).mul(2))));
      nOut.assign(normalize(mix(nMacro, nbOut, fade.mul(0.42))));
      // ball radius varies per cell (clusters of different sizes, not a regular 'brain' network)
      const fr = f1.div(cell.w.mul(0.45).add(0.55));
      hBall.assign(mix(float(1), clamp(float(1).sub(fr.mul(fr).mul(1.15)), 0, 1), fade));
      rBall.assign(mix(float(0.5), cell.w, fade));
    });
    return vec4(nOut, hBall.add(floor(rBall.mul(255)).mul(2)));
  });
  const shade = useMicro ? shadeFull() : vec4(nMacro, float(1).add(floor(float(0.5).mul(255)).mul(2)));
  const nFinal = shade.xyz;
  const packedHB = shade.w;
  const rBallF = floor(packedHB.div(2)).div(255);
  const hBallF = packedHB.sub(floor(packedHB.div(2)).mul(2));

  // sponge-like gaps between leaf clusters (dark holes), finer than the balls
  const holeFade = useMicro ? smoothstep(2.0, 6.0, grainPx.mul(0.55)).mul(select(isTrunkF, float(0), float(1))) : float(0);
  const holeN = mx_noise_float(p.div(grain.mul(0.55)).add(vec3(vSeed.mul(19.7), 3.1, 0)));
  const hole = useMicro ? smoothstep(-0.05, -0.55, holeN).mul(holeFade) : float(0);

  const crownH = clamp(vCrownH, 0, 1);
  // albedo: darker base, warm sun-bleached tips, crease + ball variation
  let alb: N = vAlbedo.mul(densK.element(ikF)).mul(mix(float(0.45), float(1), smoothstep(0.0, 0.75, crownH)));
  alb = mix(alb, alb.mul(vec3(1.12, 1.08, 0.85)), smoothstep(0.6, 1.0, crownH).mul(0.3));
  alb = alb.mul(float(1).sub(vCavity.mul(0.45)));
  alb = alb.mul(mix(float(0.72), float(1.0), hBallF)).mul(mix(float(1), float(0.8).add(rBallF.mul(0.4)), fade));
  alb = alb.mul(float(1).sub(hole.mul(0.65)));
  // trunks: dark bark, silver mallorn trunks in Lórien, pale sick trunks in Mirkwood
  const bark = select(kindIs(vKind, Kind.Lorien), srgb(0xb9bdb6), select(kindIs(vKind, Kind.Mirkwood), srgb(0x5e5a4e), srgb(0x3b3026)));
  const albedo = select(isTrunkF, bark, alb);

  const ao = select(
    isTrunkF,
    float(0.6),
    mix(float(0.35), float(1), smoothstep(0.0, 0.8, crownH)).mul(float(1).sub(vCavity.mul(0.55))).mul(mix(float(0.45), float(1), hBallF)).mul(float(1).sub(hole.mul(0.6))),
  );

  const material = new FoliageNodeMaterial();
  material.positionNode = worldPos;
  material.albedoNode = albedo;
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(nFinal, 0)).xyz);
  material.aoNode = ao;
  material.roughnessNode = float(0.8);
  material.metalnessNode = float(0);
  material.transColorNode = select(isTrunkF, vec3(0), vAlbedo.mul(vec3(1.1, 1.3, 0.6)).mul(transK.element(ikF)).mul(0.85));
  // Lórien: faintly luminous gold (stronger at night)
  material.emissiveNode = vAlbedo.mul(glowK.element(ikF)).mul(float(0.012).add(env.night.mul(0.022))).mul(select(isTrunkF, float(0.6), crownH.mul(0.6).add(0.4)));
  // Guard against the post grade: its saturation (>1) extrapolates away from luma and a saturated
  // gold with little blue went negative → pow() → NaN → black crowns. Keep every channel above
  // a small fraction of luma (visually identical, numerically safe).
  material.outputNode = Fn(() => {
    const c = output.rgb;
    const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return vec4(max(c, vec3(l.mul(0.12))), output.a);
  })();
  return { material, pxPerKm, kindParams: { noiseAmp: noiseAmpK, trans: transK, glow: glowK, grain: grainK, dens: densK } };
}
