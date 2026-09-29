import { DataTexture, MeshStandardNodeMaterial, NoColorSpace, RGBAFormat, UnsignedByteType, type InstancedBufferAttribute } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import type { World } from '../world/World.ts';
import type { QualityTier } from '../core/quality.ts';
import type { Cdlod } from './cdlod.ts';
import { env } from '../materials/environment.ts';
import { TERRAIN_SHADE as TS, alpineAt, groundLookTexture, groundPalette, rockAt, snowAt, snowLineAt, srgbNode } from '../materials/looks.ts';
import type { GroundMaps } from './groundMaps.ts';
import type { TerrainDetail } from './terrainTextures.ts';

type N = TslNode;

const {
  Fn,
  abs,
  attribute,
  clamp,
  float,
  fract,
  fwidth,
  instancedDynamicBufferAttribute,
  int,
  length,
  max,
  min,
  mix,
  mx_noise_float,
  normalize,
  positionWorld,
  pow,
  property,
  select,
  smoothstep,
  texture,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
  cameraViewMatrix,
} = tsl;

export interface TerrainMaterialOptions {
  quality: QualityTier;
  maps: GroundMaps;
  /** CC0 ground-detail layers (null: procedural micro-detail only) */
  detail: TerrainDetail | null;
}

/** A 1×1 neutral terrain-analysis mask for bakes without World.terrainMask (AO 1, flat, dry, no flow). */
function neutralMask(): DataTexture {
  const t = new DataTexture(new Uint8Array([255, 128, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** 1 on flat ground, 0 on slopes steeper than ~0.2 (1 − n.y) */
const flatGround = (slope: N): N => float(1).sub(smoothstep(0.08, 0.22, slope));

/** tiling of the detail layers (km per tile): soft ground (planar) and hard ground (triplanar) */
const SOFT_TILE = 1.7;
/** domain warp of the regional ground look (km) */
const PAL_WARP = 9;
const HARD_TILE = 4.2;

/**
 * Terrain material family (the only terrain material in the project).
 * Vertex: CDLOD morph + displacement from the HeightField texture.
 * Fragment (one pass over the shared height taps — normal, slope and curvature from the same five
 * fetches): the regional ground look (groundLookTexture: palette, dryness, micro-pattern, snowline,
 * volcanic), relief shading from the runtime curvature + the baked terrain analysis (AO, valley
 * index; faded where landmark stamps changed the ground), rock / scree / alpine zone, snow v2
 * (altitude + aspect + slope + gullies, regional snowlines), stamp turf, Shire field patchwork,
 * forest floor, shores, beaches, wetlands, ash, roads and water channels, with luminance-only CC0
 * detail layers (planar soft ground, triplanar rock / scree / snow) when available. Rules and
 * constants come from TERRAIN_SHADE (src/materials/looks.ts), shared with the water's reflection.
 */
export function createTerrainMaterial(world: World, cdlod: Cdlod, patchAttr: InstancedBufferAttribute, gridN: number, opts: TerrainMaterialOptions): MeshStandardNodeMaterial {
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

  const { quality, maps, detail } = opts;
  const preview = quality.id === 'preview';
  const groundTex = groundLookTexture(world);
  const maskTex = world.terrainMask ?? neutralMask();
  const fieldFrame = uniform(maps.fieldFrame);
  const du = 1 / world.heights.width;
  const dv = 1 / world.heights.height;
  const e = world.heights.texel;

  // outputs of the one surface pass, read by the normal / roughness / AO slots (the colour slot is
  // built first, so these are assigned before they are read)
  const outNormal = property('vec3', 'terrainNormalW');
  const outRough = property('float', 'terrainRough');
  const outAO = property('float', 'terrainAO');

  const surface = Fn(() => {
    const p = positionWorld;
    const uv = toUv(p.xz);

    // ---- relief: one set of height taps → normal, slope, curvature
    const hC = texture(hTex, uv).r;
    const hL = texture(hTex, uv.sub(vec2(du, 0))).r;
    const hR = texture(hTex, uv.add(vec2(du, 0))).r;
    const hU = texture(hTex, uv.sub(vec2(0, dv))).r;
    const hD = texture(hTex, uv.add(vec2(0, dv))).r;
    const nM = normalize(vec3(hL.sub(hR), float(2 * e), hU.sub(hD)));
    const slope = float(1).sub(nM.y);
    // Laplacian over one texel (units): > 0 concave (gully, slope foot), < 0 convex (crest)
    const curv = clamp(hL.add(hR).add(hU).add(hD).sub(hC.mul(4)).mul(1.6), -1, 1);
    // north-facing faces (the normal leans towards −Z)
    const northness = nM.z.negate();

    // ---- baked analysis (stale where stamps changed the ground) + stamp turf
    const tm = texture(maskTex, uv);
    const sm = texture(maps.stamp, uv);
    const stamped = sm.g;
    const ao = mix(tm.r, float(1), stamped.mul(0.8));
    const tpi = mix(tm.g, float(0.5), stamped);
    const moist = tm.b;
    // +1 crest … −1 gully / valley bottom: multi-scale index + this texel's curvature
    const ridge = clamp(tpi.sub(0.5).mul(2.2).sub(curv.mul(0.6)), -1, 1);
    const crest = max(ridge, 0);
    const hollow = max(ridge.negate(), 0);

    const water = texture(world.water, uv);
    const lc = texture(world.landcover, uv);

    // ---- noise (km): 60 and 12 planar; 3 and 0.9 in 3D (no stretching on steep faces)
    const n1 = mx_noise_float(p.xz.mul(1 / 60));
    const n2 = mx_noise_float(p.xz.mul(1 / 12));
    const n3 = mx_noise_float(p.mul(1 / 3));

    // regional ground look, domain-warped (± PAL_WARP km) so region borders meander like real ones
    const warp = vec2(n1.mul(0.7).add(n2.mul(0.3)), n2.mul(0.7).sub(n1.mul(0.3))).mul(PAL_WARP);
    const pal = groundPalette(groundTex, uv, false, toUv(p.xz.add(warp)));
    // stamp turf: automatic (a stamp on gentle ground) unless the ground look overrides it
    const turf = mix(sm.r, pal.turf.mul(stamped), pal.turfWeight);
    const fp = length(fwidth(p.xz));
    const fineFade = float(1).sub(smoothstep(0.08, 0.5, fp));
    const n4 = mx_noise_float(p.mul(1 / 0.9)).mul(fineFade);

    // ---- snow line, alpine zone, snow
    const southness = p.z.sub(spec.zMin).div(D);
    const line = snowLineAt(pal, southness, n1.mul(TS.snowLineNoise[0]).add(n2.mul(TS.snowLineNoise[1])).add(n3.mul(TS.snowLineNoise[2])));
    const hEff = hC.add(northness.mul(TS.snowNorth));
    const alpineRaw = alpineAt(hEff.add(n3.mul(1.2)), line);
    const alpine = alpineRaw.mul(float(1).sub(turf));
    // snow sheds from convex ribs and collects in gullies
    const snowBase = snowAt(hEff, slope.add(n3.mul(0.04)).add(crest.mul(0.12)), line, pal.volcanic, max(curv, 0));

    // ---- rock / scree
    // lowland river valleys: the carved banks are earth and turf, not rock (unless the ground is rocky)
    const lowland = float(1).sub(smoothstep(9, 18, hC)).mul(float(1).sub(pal.rockiness));
    // crests below the alpine zone turn to rock too (no grass rims on mountain ridges)
    const subalpine = smoothstep(line.sub(17), line.sub(9), hEff).mul(float(1).sub(turf));
    const bankTurf = max(water.a.mul(0.85), lowland.mul(0.6)).mul(float(1).sub(pal.rockiness)).mul(float(1).sub(alpineRaw));
    const rockBase = max(
      rockAt(slope.add(n2.mul(0.035)).add(crest.mul(0.06).add(pal.rockiness.mul(crest).mul(0.12))).sub(hollow.mul(0.03)), alpine, max(turf, bankTurf), pal.rockiness),
      smoothstep(0.1, 0.5, crest.add(n3.mul(0.15))).mul(subalpine).mul(0.85),
      smoothstep(0.08, 0.4, crest.add(slope.mul(1.4)).add(n3.mul(0.12))).mul(pal.rockiness).mul(0.85),
    );
    // scree / talus: the concave, less steep parts of the rock ground (slope feet, gully fans)
    const scree = clamp(curv.mul(1.5).add(0.2).add(n3.mul(0.25)), 0, 1).mul(float(1).sub(smoothstep(0.3, 0.52, slope)));

    // ---- ground dryness
    const dryness = clamp(
      pal.dryness.add(n1.mul(0.2)).add(n2.mul(0.12)).add(hC.mul(TS.drynessPerHeight)).add(crest.mul(0.12)).sub(hollow.mul(0.08)).sub(moist.mul(0.3)).sub(water.a.mul(0.15)),
      0,
      1,
    );

    // ---- CC0 detail layers: soft ground planar (two layers), hard ground triplanar (one layer)
    let lumSoft: N = float(1);
    let lumHard: N = float(1);
    let dN: N = vec3(0);
    const rock = rockBase.toVar();
    const snow = snowBase.toVar();
    if (detail) {
      const T = detail.texture;
      const idx = (v: N): N => int(v).toVar();
      const volc = pal.volcanic;
      const warp = vec2(n1, n2).mul(0.45);
      const uvS = p.xz.mul(1 / SOFT_TILE).add(warp);
      const iA = idx(select(volc.greaterThan(0.5), float(detail.index('ash')), float(detail.index('meadow'))));
      const iB = idx(select(volc.greaterThan(0.75), float(detail.index('ash')), float(detail.index('dry'))));
      const sA = texture(T, uvS).depth(iA);
      const sB = texture(T, uvS).depth(iB);
      const soft = mix(sA, sB, dryness);
      const iH = idx(select(snowBase.greaterThan(0.5), float(detail.index('snow')), select(scree.mul(rockBase).greaterThan(0.45), float(detail.index('scree')), float(detail.index('rock')))));
      const aH = abs(nM);
      let hard: N;
      let hardN: N;
      if (preview) {
        const t = texture(T, p.xz.mul(1 / HARD_TILE)).depth(iH);
        hard = t;
        hardN = vec3(t.r.mul(2).sub(1), 0, t.g.mul(2).sub(1).negate());
      } else {
        // triplanar weights (sharpened): top xz, side faces zy / xy
        const bw0 = pow(aH, vec3(4));
        const bw = bw0.div(bw0.x.add(bw0.y).add(bw0.z));
        const tTop = texture(T, p.xz.mul(1 / HARD_TILE)).depth(iH);
        const tX = texture(T, p.zy.mul(1 / HARD_TILE)).depth(iH);
        const tZ = texture(T, p.xy.mul(1 / HARD_TILE)).depth(iH);
        hard = tTop.mul(bw.y).add(tX.mul(bw.x)).add(tZ.mul(bw.z));
        const nx = (t: N): N => t.r.mul(2).sub(1);
        const ny = (t: N): N => t.g.mul(2).sub(1).negate();
        hardN = vec3(nx(tTop), 0, ny(tTop))
          .mul(bw.y)
          .add(vec3(0, ny(tX), nx(tX)).mul(bw.x))
          .add(vec3(nx(tZ), ny(tZ), 0).mul(bw.z));
      }
      // fade by texel footprint: the grain resolves at mid distance; far off (tile < ~10 px) the
      // regional palette alone carries the ground and no tile can repeat visibly
      const ampS = float(1).sub(smoothstep(SOFT_TILE / 64, SOFT_TILE / 10, fp));
      const ampH = float(1).sub(smoothstep(HARD_TILE / 64, HARD_TILE / 9, fp));
      lumSoft = mix(float(1), soft.b.mul(2), ampS.mul(pal.pattern.mul(0.5).add(0.6)));
      lumHard = mix(float(1), hard.b.mul(2), ampH);
      // height-blended transitions: rock and snow edges follow the layers' relief
      const tr = (w: N): N => w.mul(float(1).sub(w)).mul(4);
      rock.assign(clamp(rockBase.add(hard.a.sub(soft.a).mul(0.7).mul(tr(rockBase)).mul(ampH)), 0, 1));
      snow.assign(clamp(snowBase.add(float(0.5).sub(hard.a).mul(0.8).mul(tr(snowBase)).mul(ampH)), 0, 1));
      const softN = vec3(soft.r.mul(2).sub(1), 0, soft.g.mul(2).sub(1).negate());
      dN = mix(softN.mul(ampS.mul(0.45)), hardN.mul(ampH.mul(0.9)), max(rock, snow));
    }

    // ---- rock colour: dry-brush relief (crests catch the light, cavities hold shadow), scree fans
    const brush = float(1).add(crest.mul(0.18)).sub(hollow.mul(0.12)).mul(mix(float(0.8), float(1.05), ao));
    const rockTint = pal.rock.mul(vec3(float(1).add(n2.mul(0.05)), float(1), float(1).sub(n2.mul(0.05))));
    const rockFace = rockTint.mul(float(0.86).add(n2.mul(0.1)).add(n3.mul(0.12)).add(n4.mul(0.06))).mul(brush);
    const screeCol = mix(pal.rock, srgbNode(TS.scree), float(0.5).mul(float(1).sub(pal.volcanic.mul(0.7)))).mul(float(1.02).add(n4.mul(0.06)));
    const rockCol = mix(rockFace, screeCol, scree).mul(lumHard);

    // ---- ground: grass ↔ dry, micro-pattern, alpine turf, soil on slopes, relief tint
    const ground = mix(pal.grass, pal.dry, dryness).toVar();
    // micro-pattern (tussock clumps / meadow patches / heath), region-weighted amplitude
    const patAmp = pal.pattern.mul(detail ? 1.1 : 1.6).add(0.2);
    ground.assign(ground.mul(float(1).add(n3.mul(0.1).add(n4.mul(detail ? 0.08 : 0.16)).mul(patAmp))).mul(lumSoft));
    // above the treeline the turf turns thin, grey-green and stony
    ground.assign(mix(ground, mix(pal.grass, pal.rock, 0.55).mul(0.9), alpine.mul(0.6)));
    ground.assign(mix(ground, pal.soil, smoothstep(0.1, 0.3, slope).mul(0.5).mul(float(1).sub(turf.mul(0.8)))));
    ground.assign(ground.mul(float(1).add(crest.mul(0.05)).sub(hollow.mul(0.05))));

    // Shire / Bree-land patchwork under the hedgerows
    const f = texture(maps.fields, vec2(p.x.sub(fieldFrame.x).mul(fieldFrame.z), p.z.sub(fieldFrame.y).mul(fieldFrame.w)));
    const fieldW = f.a.mul(float(1).sub(smoothstep(0.08, 0.22, slope))).mul(float(1).sub(lc.r));
    ground.assign(mix(ground, f.rgb.mul(float(0.95).add(n4.mul(0.08))).mul(lumSoft), fieldW.mul(0.7)));

    // forest floor under the canopies: darker, richer litter and moss (the canopy is vegetation's)
    const floorCol = mix(pal.grass.mul(0.5), pal.soil.mul(0.62), float(0.45).add(n3.mul(0.2))).mul(float(0.8).add(n4.mul(0.18)));
    ground.assign(mix(ground, floorCol, lc.r.mul(0.9)));

    // volcanic plains (Gorgoroth): a network of dark fissures where the 3 km noise crosses zero
    // (lines ~150 m wide, faded once they would shrink below a pixel)
    const crackFade = float(1).sub(smoothstep(0.12, 0.35, fp));
    const cracks = float(1).sub(smoothstep(0.015, 0.05, abs(n3.add(n4.mul(0.25))))).mul(smoothstep(0.7, 0.95, pal.volcanic)).mul(flatGround(slope)).mul(crackFade);
    ground.assign(ground.mul(float(1).sub(cracks.mul(0.55))));

    const col = mix(ground, rockCol, rock).toVar();
    const snowCol = srgbNode(TS.snow).mul(float(0.97).add(n4.mul(0.03))).mul(mix(float(1), lumHard, 0.6));
    col.assign(mix(col, snowCol, snow));

    // ---- coasts, shores, wetlands, ash, roads, channels
    const flat = flatGround(slope);
    const beach = smoothstep(0.55, 0.12, hC).mul(water.b).mul(flat);
    col.assign(mix(col, srgbNode(TS.beach).mul(float(0.95).add(n4.mul(0.08))).mul(lumSoft), beach.mul(0.85)));
    const shore = max(sm.b, sm.a.mul(fineFade).mul(0.2)).mul(flat).mul(float(1).sub(lc.r)).mul(float(1).sub(snow));
    col.assign(mix(col, srgbNode(TS.shore).mul(float(0.92).add(n4.mul(0.14))).mul(lumSoft), shore.mul(0.5)));
    // wetland: a sedge / reed mat broken by many small open pools (fine noise, resolved at mid
    // distance; far off the pools average into a darker, wetter mat) — pools get a wet sheen
    const wetW = smoothstep(0.15, 0.85, lc.g);
    const poolFade = float(1).sub(smoothstep(0.03, 0.2, fp));
    const n5 = mx_noise_float(p.xz.mul(1 / 0.32));
    const poolN = n5.mul(0.55).add(n4.mul(0.35)).add(n3.mul(0.15)).add(wetW.sub(0.8).mul(0.5));
    const pools = mix(float(0.22), smoothstep(0.16, 0.3, poolN), poolFade).mul(wetW);
    const reeds = mix(srgbNode(TS.wetSedge), srgbNode(TS.wetReed), clamp(n3.mul(0.6).add(n5.mul(0.4)).add(0.5), 0, 1)).mul(lumSoft);
    const wetCol = mix(reeds, srgbNode(TS.wetPool), pools.mul(0.8));
    col.assign(mix(col, wetCol, wetW.mul(0.9)));
    col.assign(mix(col, srgbNode(TS.ash), lc.b.mul(0.9)));
    col.assign(mix(col, srgbNode(TS.road), lc.a.mul(0.45)));
    const channel = max(water.r, water.g);
    col.assign(mix(col, srgbNode(TS.channel), channel.mul(0.9)));

    // ---- micro relief: CC0 detail normals or procedural fallback
    let nW: N;
    if (detail) {
      nW = normalize(nM.add(dN));
    } else {
      const dFade = float(1).sub(smoothstep(0.05, 0.6, fp));
      const dx = mx_noise_float(p.mul(1 / 0.7).add(vec3(3.1, 0, 7.7)));
      const dz = mx_noise_float(p.mul(1 / 0.7).add(vec3(11.3, 0, 1.9)));
      const amt = dFade.mul(float(0.12).add(rock.mul(0.2)));
      nW = normalize(nM.add(vec3(dx, 0, dz).mul(amt)));
    }

    // ---- outputs
    const occl = ao.mul(float(1).sub(max(curv, 0).mul(0.12)));
    col.assign(col.mul(mix(float(0.8), float(1), occl)));
    outNormal.assign(nW);
    outAO.assign(mix(float(1), occl, 0.85));
    const rough = mix(mix(float(0.92), float(0.82), rock), float(0.55), snow);
    outRough.assign(mix(mix(rough, float(0.3), pools.mul(0.8)), float(0.12), channel));
    return col;
  });

  const material = new MeshStandardNodeMaterial();
  material.positionNode = displacedFn(true);
  material.castShadowPositionNode = displacedFn(false);
  material.colorNode = surface();
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(outNormal, 0)).xyz);
  material.roughnessNode = outRough;
  material.aoNode = outAO;
  material.metalnessNode = float(0);
  return material;
}
