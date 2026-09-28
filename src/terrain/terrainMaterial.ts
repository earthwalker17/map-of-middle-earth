import { MeshStandardNodeMaterial, type InstancedBufferAttribute } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import type { World } from '../world/World.ts';
import type { Cdlod } from './cdlod.ts';
import { env } from '../materials/environment.ts';
import { LookNodes } from '../materials/looks.ts';

type N = TslNode;

const {
  Fn,
  abs,
  attribute,
  clamp,
  float,
  fract,
  instancedDynamicBufferAttribute,
  int,
  length,
  max,
  mix,
  mx_noise_float,
  mx_noise_vec3,
  normalize,
  positionWorld,
  select,
  smoothstep,
  texture,
  uniformArray,
  vec2,
  vec3,
  vec4,
  cameraViewMatrix,
} = tsl;

/** sRGB hex → linear vec3 constant */
function srgb(hex: number): N {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return vec3(c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255));
}

export interface TerrainMaterialParts {
  material: MeshStandardNodeMaterial;
  looks: LookNodes;
}

/**
 * Terrain material family (the only terrain material in the project).
 * Vertex: CDLOD morph + displacement from the HeightField texture.
 * Fragment: per-pixel normal from the heightfield + procedural micro-detail; albedo from the
 * region ground palette, slope rock, snow line, beaches, wetlands, ash, forest floor and water
 * channels (real water surfaces are drawn by the water system).
 */
export function createTerrainMaterial(world: World, cdlod: Cdlod, patchAttr: InstancedBufferAttribute, gridN: number): TerrainMaterialParts {
  const spec = world.spec;
  const hTex = world.heights.texture;
  const W = spec.width;
  const D = spec.depth;
  const toUv = (xz: N): N => vec2(xz.x.sub(spec.xMin).div(W), xz.y.sub(spec.zMin).div(D));
  const ranges = uniformArray(cdlod.ranges.map((r) => (Number.isFinite(r) ? r : 1e9)), 'float');
  const mstart = uniformArray(cdlod.morphStart.map((r) => (Number.isFinite(r) ? r : 1e9)), 'float');
  const patch = instancedDynamicBufferAttribute(patchAttr, 'vec4');

  const displacedFn = (withSkirt: boolean) => Fn(() => {
    const origin = patch.xy;
    const size = patch.z;
    const code = patch.w;
    const forced = code.greaterThanEqual(100);
    const lod = select(forced, code.sub(100), code);
    const g = attribute('grid', 'vec2');
    const skirt = attribute('skirt', 'float');
    const xz0 = origin.add(g.mul(size));
    const h0 = texture(hTex, toUv(xz0)).level(0).r;
    const dist = length(vec3(xz0.x, h0, xz0.y).sub(env.cameraPos));
    const li = int(lod).toVar();
    const k = select(forced, float(1), clamp(dist.sub(mstart.element(li)).div(max(ranges.element(li).sub(mstart.element(li)), 1e-3)), 0, 1));
    const frac = fract(g.mul(gridN * 0.5)).mul(2 / gridN);
    const xz = origin.add(g.sub(frac.mul(k)).mul(size));
    const h = texture(hTex, toUv(xz)).level(0).r;
    // skirts hang below the patch edge in the colour pass only; in the shadow pass they collapse
    // onto the edge (zero-area) so they never cast seam-line shadows
    const y = withSkirt ? h.sub(skirt.mul(size.mul(0.03).add(0.08))) : h;
    return vec3(xz.x, y, xz.y);
  })();
  const displaced = displacedFn(true);
  const displacedShadow = displacedFn(false);

  const looks = new LookNodes(world);
  const texelU = 1 / world.heights.width;
  const texelV = 1 / world.heights.height;
  const e = world.heights.texel;

  const surface = Fn(() => {
    const p = positionWorld;
    const uv = toUv(p.xz);
    const hL = texture(hTex, uv.sub(vec2(texelU, 0))).r;
    const hR = texture(hTex, uv.add(vec2(texelU, 0))).r;
    const hU = texture(hTex, uv.sub(vec2(0, texelV))).r;
    const hD = texture(hTex, uv.add(vec2(0, texelV))).r;
    const nMacro = normalize(vec3(hL.sub(hR), float(2 * e), hU.sub(hD)));
    const slope = float(1).sub(nMacro.y);
    const h = p.y;

    const water = texture(world.water, uv);
    const lc = texture(world.landcover, uv);
    const fo = texture(world.forests, uv);
    const weights = looks.regionWeights(uv);
    const pal = looks.palette(weights);
    const mordor = looks.weightOf(weights, 'mordor').add(looks.weightOf(weights, 'nurn').mul(0.6));

    // procedural variation at three scales (km): 60, 12, 2.5
    const xz = p.xz;
    const n1 = mx_noise_float(xz.mul(1 / 60));
    const n2 = mx_noise_float(xz.mul(1 / 12));
    const n3 = mx_noise_float(xz.mul(1 / 2.5));

    // ground: grass ↔ dry by noise, altitude and distance from water
    const dryness = clamp(float(0.38).add(n1.mul(0.32)).add(n2.mul(0.14)).add(h.mul(0.006)).sub(water.a.mul(0.35)), 0, 1);
    const ground = mix(pal.grass, pal.dry, dryness).toVar();
    ground.assign(ground.mul(float(0.92).add(n3.mul(0.1))));
    ground.assign(mix(ground, pal.soil, smoothstep(0.1, 0.3, slope).mul(0.75)));

    // rock on steep slopes and at altitude; darker basalt in Mordor
    const greyRock = mix(srgb(0x6b665f), srgb(0x8e8a84), n3.mul(0.5).add(0.5));
    const rockCol = mix(greyRock, srgb(0x2b2826), mordor.clamp(0, 1));
    const rockAmt = clamp(smoothstep(0.26, 0.46, slope.add(n2.mul(0.04))).add(smoothstep(20, 34, h).mul(0.55)), 0, 1);
    ground.assign(mix(ground, rockCol, rockAmt));

    // snow line (none in Mordor)
    // snow line rises toward the south (Forodwaith ~23 → Harad ~36 world units): the Grey and Misty
    // Mountains are snow-capped, the Ephel Dúath and southern White Mountain foothills are not
    const southness = p.z.sub(spec.zMin).div(D);
    const snowLine = float(23).add(southness.mul(13)).add(n1.mul(4)).add(n2.mul(1.5));
    const snowAmt = smoothstep(snowLine, snowLine.add(3.5), h).mul(float(1).sub(smoothstep(0.55, 0.8, slope))).mul(float(1).sub(mordor.clamp(0, 1)));
    ground.assign(mix(ground, srgb(0xeef1f5), snowAmt));

    // beaches just above sea level
    const beach = smoothstep(0.55, 0.12, h).mul(water.b).mul(float(1).sub(smoothstep(0.1, 0.25, slope)));
    ground.assign(mix(ground, srgb(0xb8a986), beach.mul(0.85)));

    // wetlands, ash fields, roads
    ground.assign(mix(ground, mix(srgb(0x4a4f36), srgb(0x2f3a33), n3.mul(0.5).add(0.5)), lc.g.mul(0.85)));
    ground.assign(mix(ground, srgb(0x1c1917), lc.b.mul(0.9)));
    ground.assign(mix(ground, srgb(0x9a8a6c), lc.a.mul(0.45)));

    // forest floor / canopy base colour by forest type (the canopy itself is the vegetation system)
    const canopy = srgb(0x34472a).toVar();
    canopy.assign(mix(canopy, srgb(0x1d2918), fo.r));
    canopy.assign(mix(canopy, srgb(0x243a22), fo.g));
    canopy.assign(mix(canopy, srgb(0x8a7a3a), fo.b));
    canopy.assign(mix(canopy, srgb(0x22331f), fo.a));
    ground.assign(mix(ground, canopy.mul(float(0.9).add(n3.mul(0.15))), lc.r.mul(0.92)));

    // water channels (surfaces come from the water system)
    const wet = max(water.r, water.g);
    ground.assign(mix(ground, srgb(0x1d3137), wet.mul(0.9)));

    const rough = mix(mix(float(0.93), float(0.6), snowAmt), float(0.12), wet);
    return vec4(ground, rough);
  })();

  const normalNode = Fn(() => {
    const p = positionWorld;
    const uv = toUv(p.xz);
    const hL = texture(hTex, uv.sub(vec2(texelU, 0))).r;
    const hR = texture(hTex, uv.add(vec2(texelU, 0))).r;
    const hU = texture(hTex, uv.sub(vec2(0, texelV))).r;
    const hD = texture(hTex, uv.add(vec2(0, texelV))).r;
    const nMacro = normalize(vec3(hL.sub(hR), float(2 * e), hU.sub(hD)));
    const slope = float(1).sub(nMacro.y);
    // micro relief: stronger on rock, fades with distance (avoids shimmer in wide shots)
    const dist = length(p.sub(env.cameraPos));
    const fade = float(1).sub(smoothstep(40, 400, dist));
    const detail = mx_noise_vec3(p.mul(1 / 1.3)).mul(0.22).add(mx_noise_vec3(p.mul(1 / 0.35)).mul(0.1));
    const amt = fade.mul(float(0.25).add(smoothstep(0.1, 0.4, slope).mul(0.75)));
    const nW = normalize(nMacro.add(vec3(detail.x, abs(detail.y).mul(0.2), detail.z).mul(amt)));
    return normalize(cameraViewMatrix.mul(vec4(nW, 0)).xyz);
  })();

  const material = new MeshStandardNodeMaterial();
  material.positionNode = displaced;
  material.castShadowPositionNode = displacedShadow;
  material.colorNode = surface.rgb;
  material.roughnessNode = surface.a;
  material.metalnessNode = float(0);
  material.normalNode = normalNode;
  return { material, looks };
}
