import { MeshStandardNodeMaterial, PhysicalLightingModel, type Data3DTexture } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import { env } from '../materials/environment.ts';
import type { World } from '../world/World.ts';
import { spillIrradiance } from '../emission/spill.ts';
import { Arch, archReach } from './archetypes.ts';
import { RING, RNOM, TRUNK_LIMB, TRUNK_RING, WHOLE } from './clumpGeometry.ts';
import { HERO_TRUNK } from './authored.ts';
import { createFoamTexture, FOAM_PERIOD } from './foamTexture.ts';
import { Kind, KIND_COUNT, LORIEN_TRUNK_K } from './placement.ts';

type N = TslNode;

const {
  Fn,
  If,
  abs,
  attribute,
  cameraViewMatrix,
  clamp,
  cos,
  cross,
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

/** Emission spill on the foliage (P4; inert until W2-D fills spill.ts). */
const SPILL_ON = true;
/**
 * Single-tree hemisphere / ground-bounce fill through the emissive (S4 W2-C, OFF): in the fix round's
 * renders neither this emissive term (even a flat magenta) nor the lighting model's skyFill addition
 * changed a single pixel, while an albedo change did — the foliage's additive paths need a look before
 * this (and the spill on foliage) can do anything. The shaded trees are lifted through the albedo / AO
 * instead (treeF below).
 */
const TREE_FILL_ON = false;

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

    // glossy evergreen leaves (holly): a tight sheen speckled by the bumped leaf-cluster normals
    // (only on faces turned to the light: a grazing back-light's half-vector can lie near a face turned away)
    const H = normalize(lightDirection.add(positionViewDirection));
    const spec = pow(normalView.dot(H).clamp(), 28).mul(nl.clamp()).mul(m.glossNode);
    reflectedLight.directSpecular.addAssign(spec.mul(lightColor));
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
  /** glossy-leaf sheen strength (holly; 0 = matte leaf mass) */
  glossNode: N = float(0);
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
  /** emission spill on the leaves (review / final; the preview tier leaves it out of the graph) */
  spill?: boolean;
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
  // shape field: spread + 2·gapQ + 128·arch (placement.ts; archetypes.ts)
  const archF = floor(iB.w.div(128));
  const shapeLo = iB.w.sub(archF.mul(128));
  const gapQ = floor(shapeLo.div(2));
  const spread = shapeLo.sub(gapQ.mul(2));
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
  const trunkK = perKind({ [Kind.Lorien]: LORIEN_TRUNK_K, [Kind.Hedge]: 0 }, 0.085);

  const foam = taps > 0 ? (opts.foam ?? createFoamTexture(world.spec.json.seeds.world + 71)) : null;

  // ---------------------------------------------------------------- vertex
  const uvI = vec2(iA.x.sub(spec.xMin).div(spec.width), iA.y.sub(spec.zMin).div(spec.depth));
  const ground = texture(hTex, uvI).level(0).r;
  const isTrunk = part.greaterThan(0.5);

  // per (instance, sub-crown) random numbers
  const subIdx = sub.w;
  const seedU = uint(seed.mul(16777215)).mul(uint(64));
  const hBase = seedU.add(uint(subIdx.mul(8)));
  const h = (k: number) => hash(hBase.add(uint(k)));
  // per-sub-crown keys beyond the 8 slots a sub-crown owns (slot k ≥ 8 would be the next sub-crown's k − 8):
  // salted out of the slot window
  const HX_SALT = 0x632be5ab;
  const hx = (k: number) => hash(hBase.add(uint(HX_SALT + k)));
  // per-instance random numbers (the same for every sub-crown): slots 56 + k (sub-crown 7's window — there
  // are seven sub-crowns, 0…6; slot 0 of every window and h(8) = the next window's slot 0 are unused)
  const hi = (k: number) => hash(seedU.add(uint(56 + k)));
  const isCentre = subIdx.lessThan(0.5);
  const isWhole = sub.z.greaterThan(0.9);
  const archIs = (a: number) => abs(archF.sub(a)).lessThan(0.5);
  const aBroad = archIs(Arch.Broadleaf);
  const aCon = archIs(Arch.Conifer);
  const aCol = archIs(Arch.Columnar);
  const aHolly = archIs(Arch.Holly);
  const aShrub = archIs(Arch.Shrub);
  const aStand = archIs(Arch.ConiferStand);
  /** forest canopy patches (the retiring ones and the standing edge ring): an irregular, flat-topped layout */
  const aCanopy = archIs(Arch.Canopy).or(archIs(Arch.CanopyEdge));
  /** the S3 cluster layout family (canopy patches, clusters: hedges, mallorn tiers) */
  const aCluster = aCanopy.or(archIs(Arch.Cluster));
  /** archetypes whose sub-crowns stack into one column (never dropped) */
  const aStack = aCon.or(aCol).or(aHolly);
  // broadleaf: 1–2 dominant upper lobes among the ring crowns (never dropped)
  const dom1 = floor(hi(4).mul(5.999)).add(1);
  const dom2 = floor(hi(5).mul(5.999)).add(1);
  const isDom = aBroad.and(isCentre.not()).and(abs(subIdx.sub(dom1)).lessThan(0.5).or(hi(6).lessThan(0.55).and(abs(subIdx.sub(dom2)).lessThan(0.5))));
  // (canopy patches: flatter sub-crowns, their tops levelled into one undulating surface — see the layout)
  const syCanopy = mix(float(0.7), float(1.02), h(8));
  const dropped = isCentre.not().and(aStack.not()).and(isDom.not()).and(h(1).lessThan(gap));
  const size = select(dropped, float(0), mix(float(0.6), float(1.2), h(2)));
  const t6 = subIdx.div(6);
  // vertical stretch of each sub-crown, per archetype (the far LOD's single blob keeps its cluster's height)
  const syCluster = mix(float(0.8), float(1.32), h(8));
  const syArch = select(
    aBroad,
    mix(float(0.78), float(1.08), h(8)),
    select(
      aCon,
      mix(float(0.55), float(1.6), t6),
      select(
        aCol,
        mix(float(1.12), float(1.38), h(8)),
        select(aHolly, mix(float(0.95), float(1.5), t6), select(aShrub, mix(float(0.55), float(0.8), h(8)), select(aStand, mix(float(1.7), float(2.3), h(8)), syCluster))),
      ),
    ),
  );
  // whole blob: radius and stretch so its top meets the archetype's crown top (archetypes.ts archReach)
  const reachA = select(
    aBroad,
    float(archReach(Arch.Broadleaf, 0)),
    select(aCon, float(archReach(Arch.Conifer, 0)), select(aCol, float(archReach(Arch.Columnar, 0)), select(aHolly, float(archReach(Arch.Holly, 0)), float(archReach(Arch.Shrub, 0))))),
  );
  const wWidth = select(aCol, float(0.62), select(aHolly, float(0.8), select(aShrub, float(0.95), float(0.85))));
  const Rw = float(WHOLE).mul(wWidth).mul(mix(float(0.9), float(1.1), h(2)));
  const treeWhole = aCluster.or(aStand).not();
  const sy = select(isWhole, select(treeWhole, reachA.mul(0.6).div(Rw), syCluster.mul(0.45)), select(aCanopy, syCanopy, syArch));
  // whorl taper: each sub-crown narrows upward (a skirt, never a puck), per archetype
  const taperK = select(aCon, float(0.6), select(aCol, float(0.3), select(aHolly, float(0.22), select(aStand, float(0.8), float(0)))));
  const kSpread = float(1).sub(spread.mul(RING)).div(RNOM);
  const jit = spread.mul(0.16);
  // per-instance asymmetry (broadleaf / shrub) and lean (every tree archetype; conifers less)
  const aAng = hi(1).mul(6.2832);
  const aDir = vec2(cos(aAng), sin(aAng));
  const am = mix(float(0.1), float(0.3), hi(2));
  const leanAmt = select(aBroad.or(aHolly), mix(float(0), float(0.14), hi(3)), select(aCon.or(aCol), mix(float(0), float(0.06), hi(3)), float(0)));

  // sub-crown centre (unit cluster space) and radius per archetype: vec4(cx, cy, cz, R)
  const layout = Fn(() => {
    // every node shared between the branches (or with the code after them) is built here, once, before
    // the branches: a shared node first referenced inside one branch is assigned only there and read
    // unassigned by the others (the W1 lesson — here it flattened every non-whole crown)
    const vSeedU = seedU.toVar();
    const vHBase = hBase.toVar();
    const hb = (k: number) => hash(vHBase.add(uint(k)));
    const hbx = (k: number) => hash(vHBase.add(uint(HX_SALT + k)));
    const vSpread = spread.toVar();
    const vHVar = hVar.toVar();
    const vSub = sub.toVar();
    const vSize = size.toVar();
    const vSy = sy.toVar();
    const vT6 = t6.toVar();
    const vRw = Rw.toVar();
    const vTreeWhole = treeWhole.toVar();
    const vKSpread = kSpread.toVar();
    const vJit = jit.toVar();
    const vADir = aDir.toVar();
    const vAm = am.toVar();
    const vCentre = isCentre.toVar();
    const vDom = isDom.toVar();
    const vDropped = dropped.toVar();
    const vShrub = aShrub.toVar();
    const vHolly7 = hash(vSeedU.add(uint(56 + 7))).toVar();
    const L = vec4(0).toVar();
    If(isWhole, () => {
      // the far LOD's single blob (sub.z = WHOLE): spans the cluster whatever its spread
      const Rc = select(vTreeWhole, vRw, vSub.z.mul(vSize));
      L.assign(vec4(0, Rc.mul(vSy).mul(0.55), 0, Rc));
    })
      .ElseIf(aCanopy, () => {
        // forest canopy patch: the cluster ring made irregular per instance (ring angles ±0.5 rad, ring radii
        // 0.75–1.1), crowns 12 % larger so neighbours overlap, and their tops levelled at one canopy height
        // (±25 %): a closed, undulating canopy surface, never a pile of separate balls
        const dl = max(length(vSub.xy), 1e-4);
        const d0 = vSub.xy.div(dl);
        const dA = hb(4).sub(0.5);
        const ca = cos(dA);
        const sa = sin(dA);
        const dir = vec2(d0.x.mul(ca).sub(d0.y.mul(sa)), d0.x.mul(sa).add(d0.y.mul(ca)));
        const ringD = dl.mul(vSpread).mul(mix(float(0.75), float(1.1), hb(5)));
        const R = vSub.z.mul(vKSpread).mul(vSize).mul(1.12);
        const top = float(0.6).mul(hb(3).sub(0.5).mul(vHVar.mul(0.8).add(0.3)).add(1));
        const cy = max(top.sub(R.mul(vSy)), R.mul(vSy).mul(0.25));
        const xz = select(vCentre, vec2(hb(5).sub(0.5), hb(4).sub(0.5)).mul(vJit), dir.mul(ringD));
        L.assign(vec4(xz.x, cy, xz.y, R));
      })
      .ElseIf(aCluster, () => {
        const R = vSub.z.mul(vKSpread).mul(vSize);
        L.assign(vec4(vSub.x.mul(vSpread).add(hb(4).sub(0.5).mul(vJit)), R.mul(vSy).mul(0.55).add(hb(3).sub(0.5).mul(vHVar)), vSub.y.mul(vSpread).add(hb(5).sub(0.5).mul(vJit)), R));
      })
      .ElseIf(aBroad.or(aShrub), () => {
        // a jittered ring (±0.6 rad) at radii 0.45–0.95 (× the spread), heavier and wider on the
        // asymmetry side; dominant lobes pulled in and lifted; outer crowns droop a little
        const dl = max(length(vSub.xy), 1e-4);
        const d0 = vSub.xy.div(dl);
        const dA = hbx(9).sub(0.5).mul(1.2);
        const ca = cos(dA);
        const sa = sin(dA);
        const dir = vec2(d0.x.mul(ca).sub(d0.y.mul(sa)), d0.x.mul(sa).add(d0.y.mul(ca)));
        const side = dot(dir, vADir);
        const spreadAdj = clamp(vSpread.div(0.55), 0.75, 1.25);
        const ringD = mix(float(0.45), float(0.95), hbx(10))
          .mul(0.5)
          .mul(spreadAdj)
          .mul(vAm.mul(side).add(1))
          .mul(select(vDom, float(0.55), float(1)))
          .mul(select(vShrub, float(1.25), float(1)));
        const Rr = mix(float(0.34), float(0.5), hb(2))
          .mul(vAm.mul(side).mul(0.8).add(1))
          .mul(select(vDom, float(1.12), float(1)));
        const R = select(vCentre, float(0.56).mul(mix(float(0.92), float(1.08), hb(2))), Rr).mul(select(vDropped, float(0), float(1)));
        const lift = select(vShrub, float(0), select(vDom, float(0.3), select(vCentre, float(0.18), float(0))));
        // (the outer ring crowns hang lower: a skirt meeting the trunk wide, never a ball on a stick)
        const cy = R.mul(vSy)
          .mul(0.5)
          .add(hb(3).sub(0.5).mul(vHVar).mul(0.6))
          .add(lift)
          .sub(select(vCentre.or(vDom), float(0), ringD.mul(0.26)));
        const xz = select(vCentre, vec2(0), dir.mul(ringD)).add(vADir.mul(vAm).mul(0.25));
        L.assign(vec4(xz.x, cy, xz.y, R));
      })
      .ElseIf(aCon, () => {
        // whorls stacked into a spire: radius (1 − i/7)^1.2, centres up to 0.85 of the height
        const R = float(0.92).mul(pow(float(1).sub(vSub.w.div(7)), 1.2)).mul(mix(float(0.92), float(1.08), hb(2)));
        L.assign(vec4(hb(4).sub(0.5).mul(0.08), vT6.mul(1.6).add(R.mul(vSy).mul(0.25)).add(hb(3).sub(0.5).mul(0.06)), hb(5).sub(0.5).mul(0.08), R));
      })
      .ElseIf(aCol, () => {
        // a narrow column, rounded below, pointed above
        const R = float(0.9).mul(pow(float(1).sub(vT6.mul(0.85)), 0.6)).mul(mix(float(0.9), float(1.1), hb(2)));
        L.assign(vec4(hb(4).sub(0.5).mul(0.12), vT6.mul(1.75).add(R.mul(vSy).mul(0.6)), hb(5).sub(0.5).mul(0.12), R));
      })
      .ElseIf(aHolly, () => {
        // a dense, broad-shouldered ovoid: crowns on a loose rising spiral (each its own angle and reach,
        // heavier to one side), a blunt top — a wild holly, not topiary
        const ang = vSub.w.mul(2.4).add(vHolly7.mul(6.2832)).add(hb(4).sub(0.5).mul(1.1));
        const R = float(0.78).mul(float(1).sub(pow(vT6, 1.7).mul(0.55))).mul(mix(float(0.86), float(1.12), hb(2)));
        const dH = float(0.4).mul(float(1).sub(vT6.mul(0.6))).mul(mix(float(0.7), float(1.15), hb(5)));
        const xz = vec2(cos(ang), sin(ang)).mul(dH).add(vADir.mul(vAm).mul(0.3));
        L.assign(vec4(xz.x, vT6.mul(1.15).add(R.mul(vSy).mul(0.55)), xz.y, R));
      })
      .Else(() => {
        // conifer stand: the canopy patch layout with spires
        const R = vSub.z.mul(vKSpread).mul(vSize).mul(0.8);
        L.assign(vec4(vSub.x.mul(vSpread).add(hb(4).sub(0.5).mul(vJit)), R.mul(vSy).mul(0.42).add(hb(3).sub(0.5).mul(vHVar)), vSub.y.mul(vSpread).add(hb(5).sub(0.5).mul(vJit)), R));
      });
    return L;
  })().toVar();
  const centreU = layout.xyz;
  const R = layout.w;
  // silhouette breakup: the sub-crown surface displaced ±9 % radially by a lump field of about two thirds
  // of its radius — a few large leaf masses, not a noise sphere (each sub-crown its own lumps; stable per
  // instance, never swimming with the wind)
  let lpS: N = lp;
  if (foam) {
    const sil = texture3D(foam, lp.mul(1.5).add(vec3(seed.mul(37.1), subIdx.mul(5.3), seed.mul(11.3))).div(FOAM_PERIOD)).level(0).a;
    lpS = lp.mul(float(1).add(sil.sub(0.5).mul(0.18)));
  }
  // whorl taper (x, z scaled by s(y) = 1 − k·(y + 0.7)/1.7): conifers' skirts, the pointed tips; whole
  // blobs taper only as conifers (a cone) and holly / columnar (a pointed ovoid)
  const taperW = select(isWhole, select(aCon, float(0.85), select(aCol, float(0.45), select(aHolly, float(0.3), float(0)))), taperK);
  const tapS = max(float(1).sub(taperW.mul(clamp(lp.y.add(0.7).div(1.7), 0, 1))), 0.06);
  const lpT = vec3(lpS.x.mul(tapS), lpS.y, lpS.z.mul(tapS));
  const u0 = centreU.add(vec3(lpT.x, lpT.y.mul(sy), lpT.z).mul(R));
  // lean towards the heavy side (shear with height)
  const u = vec3(u0.x.add(u0.y.mul(leanAmt).mul(aDir.x)), u0.y, u0.z.add(u0.y.mul(leanAmt).mul(aDir.y)));
  const crownLocal = vec3(u.x.mul(hr), u.y.mul(vr).add(trunk), u.z.mul(hr).mul(aspect));
  // trunks only where the crown is lifted off the ground (forest canopy hides its stems)
  const tr = select(trunk.greaterThan(vr.mul(0.04)), hr.mul(trunkK.element(ik)), float(0));
  // the stem runs up into the crown: clusters to their centre crown, broadleaves to mid-crown, stacked
  // archetypes most of the way up the spire
  const trunkTop = trunk.add(vr.mul(select(aCluster, kSpread.mul(0.42 * 0.5), select(aBroad, float(0.5), select(aShrub, float(0.2), reachA.mul(0.55))))));
  const trunkLocal = vec3(lp.x.mul(tr), mix(float(-0.25), trunkTop, lp.y), lp.z.mul(tr));

  // hero geometry (authored trees near the camera, clumpGeometry TRUNK_RING / TRUNK_LIMB):
  // a ringed trunk with the hero profile (authored.ts HERO_TRUNK / heroTrunkRadius) - ring codes: < -1.5
  // the deep foot, -1..0 a flare ring at that fraction of the flare height, > 0 a fraction of the trunk top
  const isRing = isTrunk.and(abs(sub.w.sub(TRUNK_RING)).lessThan(0.5));
  const isLimb = isTrunk.and(abs(sub.w.sub(TRUNK_LIMB)).lessThan(0.5));
  const fh = max(min(float(HERO_TRUNK.flareKm), trunk.div(20)), 1e-3);
  const foot = tr.mul(2.2).add(HERO_TRUNK.sink);
  const hRing = select(lp.y.lessThan(-1.5), foot.negate(), select(lp.y.lessThan(0), lp.y.negate().mul(fh), lp.y.mul(trunkTop)));
  const taper = float(1)
    .sub(clamp(hRing.div(max(trunk, 1e-3)), 0, 1).mul(1 - HERO_TRUNK.taper))
    .sub(clamp(hRing.sub(trunk).div(max(trunkTop.sub(trunk), 1e-3)), 0, 1).mul(HERO_TRUNK.taper - HERO_TRUNK.taperTop));
  const flareF = float(1).sub(clamp(hRing.div(fh), 0, 1));
  const rRing = tr.mul(taper).mul(flareF.mul(flareF).mul(HERO_TRUNK.flare).add(1));
  const ringLocal = vec3(lp.x.mul(rRing), hRing, lp.z.mul(rRing));
  // the flare's surface faces up as well as out (dr/dh)
  const ringUp = clamp(tr.mul(2 * HERO_TRUNK.flare).mul(flareF).div(fh).mul(taper).mul(select(hRing.greaterThan(0), float(1), float(0))), 0, 3);
  const ringN = normalize(vec3(lp.x, ringUp, lp.z));
  // primary limbs: from the upper trunk (about 0.8 of its height, never more than 0.6 vr below the crown
  // base) out and up into the lower crown, tapering
  const az = sub.x;
  const limbS = vec3(0, trunk.sub(min(trunk.mul(0.2), vr.mul(0.6))), 0);
  const limbE = vec3(cos(az).mul(hr).mul(0.55), trunk.add(vr.mul(0.15)), sin(az).mul(hr).mul(0.55).mul(aspect));
  const limbD = normalize(limbE.sub(limbS));
  const limbU = normalize(vec3(limbD.z.negate(), 0, limbD.x));
  const limbW = cross(limbU, limbD);
  const limbN = limbU.mul(lp.x).add(limbW.mul(lp.z));
  // (limbs only where a lifted broadleaf crown or a cluster shows them: none inside spires, columns, hollies)
  const limbR = tr.mul(select(aBroad.or(aCluster), float(1), float(0)));
  const limbLocal = mix(limbS, limbE, lp.y).add(limbN.mul(mix(limbR.mul(0.34), limbR.mul(0.12), lp.y)));

  const trunkAny = select(isLimb, limbLocal, select(isRing, ringLocal, trunkLocal));
  const local = select(isTrunk, trunkAny, crownLocal);

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

  // cluster height fraction (0 bottom … 1 ≈ top of the centre crown / the archetype's crown top)
  const uTop = select(aCluster, kSpread.mul(0.42 * 1.55), select(aStand, float(1.05), reachA.mul(0.92)));

  // normal: inverse-transpose of the (non-uniform) scale, then the yaw rotation
  // (the whorl taper tilts the surface up: n.y += k/1.7 · (x·nx + z·nz) / s, n.xz /= s)
  // (s is constant below y = −0.7, where the clamp holds it at 1: no tilt there)
  const tapSlope = select(lp.y.greaterThan(-0.7), taperW.div(1.7), float(0));
  const tapN = vec3(ln.x.div(tapS), ln.y.add(tapSlope.mul(lp.x.mul(ln.x).add(lp.z.mul(ln.z))).div(tapS)), ln.z.div(tapS));
  const nCrown = vec3(tapN.x.div(hr), tapN.y.div(vr.mul(sy)), tapN.z.div(hr.mul(aspect)));
  const nGeo = normalize(nCrown);
  // single trees: the whole crown's shading (an ellipsoid round the crown: lit on the sun side, shaded on
  // the other) carries the sub-crown lobes as a second order — one leaf mass with lobes, never a pile of
  // separately shaded balls (none for canopy patches and clusters, less for the spires)
  const eA = float(0.8);
  const eB = max(uTop.mul(0.55), 0.3);
  const eC = uTop.mul(0.45);
  const nEll = vec3(u.x.div(eA.mul(eA)), u.y.sub(eC).div(eB.mul(eB)), u.z.div(eA.mul(eA)));
  const nTree = normalize(vec3(nEll.x.div(hr), nEll.y.div(vr), nEll.z.div(hr.mul(aspect))));
  const treeBlend = select(aBroad.or(aShrub).or(aHolly), float(0.55), select(aCon.or(aCol), float(0.35), float(0))).mul(select(isWhole, float(0), float(1)));
  const nGeoT = normalize(mix(nGeo, nTree, treeBlend));
  // a leaf mass scatters light from leaves of every orientation: soften the sphere shading of each
  // sub-crown towards the canopy's up (more for canopy patches than for single trees)
  const nCrownW = normalize(mix(nGeoT, vec3(0, 1, 0), spread.mul(0.42)));
  const nL = select(isTrunk, select(isLimb, limbN, select(isRing, ringN, normalize(ln))), nCrownW);
  const nW = vec3(nL.x.mul(cs).add(nL.z.mul(sn)), nL.y, nL.z.mul(cs).sub(nL.x.mul(sn)));

  // foam clumps: size follows the sub-crown (small trees get small clumps); one field shared by
  // the vertex relief and the fragment micro structure
  const CLUMP_RELIEF = false;
  // clump grain: about a third of the sub-crown radius (about 1/12 of a clustered crown), at most 0.24 km
  const grainOf = (subR: N, kIdx: N) => clamp(subR.mul(0.3), 0.02, 0.24).mul(grainK.element(kIdx));
  const foamOff = (sd: N) => vec3(sd.mul(37.1), sd.mul(5.3), sd.mul(11.3));
  let worldPos: N = basePos;
  // Vertex clump relief is off: the finest LOD's sub-crown vertex spacing is as large as the foam
  // feature size, so the displacement aliased into faceted, crumpled silhouettes (offline tiers
  // looked worse than preview). Re-enable together with a tessellation that matches the grain.
  if (foam && taps > 1 && CLUMP_RELIEF) {
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
  // (single trees: a wider spread, so a crown reads as lobes of light and shade, not one puff)
  const tone = float(1).add(h(6).sub(0.5).mul(toneK.element(ik)).mul(select(aCluster.or(aStand), float(1), float(1.5))));
  const warm = h(7).sub(0.5).mul(hueK.element(ik));
  const linC = pow(max(iC.rgb, vec3(0)), vec3(2.2));
  // autumn crowns (warm golds / ochres on broadleaf and riverside kinds — Rivendell): a real autumn crown is
  // a mix of gold, rust and leaves still olive-green, and darker than its brightest leaves — never one
  // flat peach puff. Per sub-crown, from its own hash
  const warmth = smoothstep(0.24, 0.42, linC.r.sub(linC.b).div(linC.r.add(linC.g).add(linC.b).add(1e-3))).mul(
    select(kindIs(kind, Kind.Oak).or(kindIs(kind, Kind.River)), float(1), float(0)),
  );
  const hA = hx(11);
  const autumnMix = select(hA.lessThan(0.3), vec3(0.6, 0.78, 0.5), select(hA.greaterThan(0.78), vec3(0.9, 0.58, 0.4), vec3(0.88, 0.8, 0.6)));
  const albedoV = linC
    .mul(mix(vec3(1), autumnMix, warmth))
    .mul(tone)
    .mul(vec3(float(1).add(warm), 1, float(1).sub(warm.mul(1.5))));
  const vNormal = varying(nW, 'vFolNormal');
  const vAlbedo = varying(albedoV, 'vFolAlbedo');
  // (crowns hung low by the height jitter may reach below 0: clamp, negative marks the trunk)
  const vCrownH = varying(select(isTrunk, float(-1), max(u.y.div(uTop), 0)), 'vFolCrownH');
  const vSubH = varying(lp.y, 'vFolSubH');
  // cavities: the creases between a sub-crown's own lobes (baked), the saddles of its surface (distance
  // to the lobe centre: a crease lies inside the lobe tops) and the inner faces of the cluster (distance to
  // its centre: where sub-crowns meet, deep in the crown)
  const lobeCav = float(1).sub(smoothstep(0.74, 0.93, length(lp)));
  const uMid = uTop.mul(0.45);
  const dC = length(vec3(u.x, u.y.sub(uMid).div(max(uTop.mul(0.55), 0.2)), u.z));
  const clusterCav = float(1).sub(smoothstep(0.35, 0.8, dC));
  const vCavity = varying(select(isTrunk, float(0), max(cavity, max(lobeCav.mul(0.85), clusterCav.mul(0.75)))), 'vFolCavity');
  const vKind = varying(kind, 'vFolKind');
  const vArch = varying(archF, 'vFolArch');
  const vSeed = varying(seed, 'vFolSeed');
  // micro-structure scale: the sub-crown radius (crowns), a fraction of the trunk radius (bark)
  const vSubR = varying(select(isTrunk, tr.mul(0.6), R.mul(hr)), 'vFolSubR');

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
  let barkN: N = float(1);
  if (foam) {
    const grain = grainOf(vSubR, ikF);
    const grainPx = grain.mul(pxPerKm).div(dist);
    const off = foamOff(vSeed);
    const fade1 = smoothstep(1.0, 4.0, grainPx).mul(crownF);
    // bark: the same tap stretched 10x along the trunk (vertical streaks)
    const aniso = select(isTrunkF, vec3(1, 0.1, 1), vec3(1, 1, 1));
    const t1 = texture3D(foam, p.mul(aniso).div(grain).add(off).div(FOAM_PERIOD));
    const g1 = t1.rgb.sub(0.5).mul(8);
    // leaf clumps shade with their own normals (lit tops, shaded undersides) more than by albedo spots
    bumpG = g1.mul(fade1.mul(0.28));
    creaseA = mix(float(1), mix(float(0.88), float(1.02), t1.a), fade1);
    creaseAO = mix(float(1), mix(float(0.72), float(1), t1.a), fade1);
    barkN = mix(float(1), mix(float(0.78), float(1.1), t1.a), smoothstep(1.0, 4.0, grainPx).mul(float(1).sub(crownF)));
    if (taps > 1) {
      // fine porosity: the same field 2.6× smaller, axes swizzled so the two scales never align
      const g2s = grain.mul(0.34);
      const fade2 = smoothstep(1.0, 4.0, grainPx.mul(0.34)).mul(crownF);
      const t2 = texture3D(foam, p.zxy.div(g2s).add(off.yzx).div(FOAM_PERIOD));
      // leaf clusters: lit tips and dark holes, their normals scattered (sun speckle)
      bumpG = bumpG.add(t2.rgb.sub(0.5).mul(8).zxy.mul(fade2.mul(0.2)));
      creaseA = creaseA.mul(mix(float(1), mix(float(0.8), float(1.05), t2.a), fade2));
      creaseAO = creaseAO.mul(mix(float(1), mix(float(0.78), float(1), t2.a), fade2));
    }
  }
  // tilt the macro normal away from the clump centre (tangential part of the field gradient)
  const bumpT = bumpG.sub(nMacro.mul(dot(bumpG, nMacro)));
  const nFinal = normalize(nMacro.sub(bumpT));

  const crownH = clamp(vCrownH, 0, 1);
  // crown-scale self shadowing: each sub-crown's underside, and the cluster's lower part
  const subLit = smoothstep(-0.55, 0.8, vSubH);
  const clusterLit = smoothstep(0.0, 0.9, crownH);
  // single trees (archetypes 1–5) self-shadow a little harder than canopy patches (a crown's depth, no
  // cotton-wool puff) — never into crushed black undersides (the AO floor below)
  const treeF = abs(vArch.sub(3)).lessThan(2.5);
  const subLo = select(treeF, float(0.74), float(0.7));
  const clusLo = select(treeF, float(0.84), float(0.8));
  let alb: N = vAlbedo.mul(densK.element(ikF)).mul(mix(subLo, float(1), subLit)).mul(mix(clusLo, float(1), clusterLit));
  // warm, sun-bleached crown tops
  // (not on autumn golds: warming them further turns them salmon)
  const warmF = smoothstep(0.24, 0.42, vAlbedo.r.sub(vAlbedo.b).div(vAlbedo.r.add(vAlbedo.g).add(vAlbedo.b).add(1e-3)));
  alb = mix(alb, alb.mul(vec3(1.1, 1.06, 0.86)), smoothstep(0.6, 1.0, crownH).mul(0.3).mul(float(1).sub(warmF)));
  alb = alb.mul(float(1).sub(vCavity.mul(select(treeF, float(0.28), float(0.4))))).mul(creaseA);
  // trunks: grey-brown bark (never a saturated red stick under warm light), warm silver mallorn trunks in
  // Lórien, pale sick trunks in Mirkwood
  const bark = select(kindIs(vKind, Kind.Lorien), srgb(0xcfc8b8), select(kindIs(vKind, Kind.Mirkwood), srgb(0x5e5a4e), srgb(0x3e3a35)));
  const albedo = select(isTrunkF, bark.mul(barkN), alb);

  const ao = select(
    isTrunkF,
    float(0.7),
    max(
      mix(select(treeF, float(0.6), float(0.5)), float(1), subLit)
        .mul(mix(select(treeF, float(0.7), float(0.6)), float(1), clusterLit))
        .mul(float(1).sub(vCavity.mul(select(treeF, float(0.4), float(0.55)))))
        .mul(creaseAO),
      select(treeF, float(0.5), float(0.35)),
    ),
  );

  const material = new FoliageNodeMaterial();
  material.positionNode = worldPos;
  material.albedoNode = albedo;
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(nFinal, 0)).xyz);
  material.aoNode = ao;
  material.roughnessNode = float(0.8);
  material.metalnessNode = float(0);
  // the fill matters most when the key light is weak: moonlit night, blue hour, dawn
  // (S4 note: with three r186 this indirectDiffuse addition has no effect on the render — fill × 40 left
  // the frame unchanged; the single trees' fill below goes through the emissive instead)
  material.skyFillNode = select(isTrunkF, float(0.3), fillK.element(ikF)).mul(float(1).add(env.night.mul(2.6)).add(env.twilight.mul(0.9)));
  // single trees (archetypes 1–5): the hemisphere's sky light and the ground bounce on a lone crown's
  // shaded flank and underside (more on the underside) — no crushed-black silhouettes in a hill's shadow.
  // Diffuse: albedo · E_hemi(n) · fill / π, through the ambient occlusion
  const nUp = nFinal.y;
  const eHemi = mix(env.groundColor, env.skyColor, nUp.mul(0.5).add(0.5)).mul(env.hemiIntensity);
  const treeFill = select(treeF.and(isTrunkF.not()), clamp(float(0.4).sub(nUp), 0, 1.4).mul(0.6).add(0.45), float(0));
  const fillE = TREE_FILL_ON ? albedo.mul(eHemi).mul(treeFill).mul(ao).mul(1 / Math.PI) : vec3(0);
  material.transColorNode = select(isTrunkF, vec3(0), vAlbedo.mul(vec3(1.1, 1.3, 0.6)).mul(transK.element(ikF)).mul(0.85));
  material.glossNode = select(isTrunkF.not().and(abs(vArch.sub(Arch.Holly)).lessThan(0.5)), float(0.22), float(0));
  // Lórien: faintly luminous gold (stronger at night), with a warm-gold sheen through twilight (the wood
  // keeps its gold at blue hour); mallorn bark catches a little of it
  const sheen = select(isTrunkF, vec3(0), vAlbedo.mul(vec3(1.15, 0.98, 0.62))).mul(env.twilight.mul(0.075));
  const glow = select(isTrunkF, bark.mul(0.2), vAlbedo)
    .mul(float(0.012).add(env.night.mul(0.024)))
    .add(sheen)
    .mul(glowK.element(ikF))
    .mul(select(isTrunkF, float(1), crownH.mul(0.6).add(0.4)));
  // emission spill (S4 P4): the light of nearby fires, windows and lamps on the leaves (W2-D's
  // spillIrradiance; zero until it lands). Diffuse: albedo · E / π, through the ambient occlusion
  material.emissiveNode = SPILL_ON && (opts.spill ?? true) ? glow.add(fillE).add(albedo.mul(spillIrradiance(positionWorld, nFinal)).mul(ao).mul(1 / Math.PI)) : glow.add(fillE);
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
