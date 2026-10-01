import { DataTexture, MeshStandardNodeMaterial, NoColorSpace, RGBAFormat, UnsignedByteType, type InstancedBufferAttribute } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import type { World } from '../world/World.ts';
import type { QualityTier } from '../core/quality.ts';
import type { Cdlod } from './cdlod.ts';
import { env } from '../materials/environment.ts';
import { TERRAIN_SHADE as TS, alpineAt, aspectDryness, groundLookTexture, groundPalette, rockAt, snowAt, snowLineAt, srgbNode } from '../materials/looks.ts';
import type { GroundMaps } from './groundMaps.ts';
import { stampSnowCaps } from '../world/stamps.ts';
import type { TerrainDetail } from './terrainTextures.ts';
import { strata } from '../materials/strata.ts';
import { VOLCANIC, volcanicCrust } from './volcanic.ts';
import { spillIrradiance } from '../emission/spill.ts';
import { canopyShell } from '../vegetation/canopyShell.ts';

type N = TslNode;

const {
  Fn,
  If,
  abs,
  attribute,
  clamp,
  dFdx,
  dFdy,
  float,
  fract,
  fwidth,
  instancedDynamicBufferAttribute,
  int,
  length,
  max,
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

/** tiling of the detail layers (km per tile): soft ground and hard ground */
const SOFT_TILE = 1.7;
const HARD_TILE = 4.2;
/** preview (soft grain projected from above only): fade it out over this slope range (1 − n.y) */
const SOFT_STEEP = [0.22, 0.45] as const;
/** the lowland / river-bank turf rule holds on moderate slopes only (steep scarps stay rock) */
// exaggerated heights make ordinary Shire stream banks / downs steeper than 0.3: keep them turf
const BANK_TURF_SLOPE = [0.55, 0.8] as const;
/** wetland only on flat ground (marsh fills, river flats), gone on this slope range */
const WET_SLOPE = [0.06, 0.2] as const;
/** cos, sin of the fixed grain direction of the bog pools */
const POOL_GRAIN = [Math.cos(0.7), Math.sin(0.7)] as const;

/** stamp snow caps the terrain shader reads (world/stamps.ts `snowCap`; unused slots have reach 0) */
const MAX_SNOW_CAPS = 4;
/** strata on steep rock: visible over this slope range (1 − n.y) */
const STRATA_SLOPE = [0.26, 0.5] as const;
/** S4 switches (P1/P2 on; P3/P4 items ship switched off until they read right) */
const STRATA_ON = true;
const CRUST_ON = true;
/** P3: patchy, wind-scoured snow edges; grass tonal breakup (mottling, aspect, hollows) */
const SNOW_V3_ON = true;
const GRASS_BREAKUP_ON = true;

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
  // stamp snow caps (x, z, reach, absolute snow line): Erebor's upper body holds snow on slopes the
  // regional rules shed it from
  const caps = stampSnowCaps(world.heights.stampList).slice(0, MAX_SNOW_CAPS);
  const capData: number[] = [];
  for (let i = 0; i < MAX_SNOW_CAPS; i++) capData.push(caps[i]?.x ?? 0, caps[i]?.z ?? 0, caps[i]?.reach ?? 0, caps[i]?.line ?? 0);
  const snowCaps = uniformArray(capData, 'float');
  const du = 1 / world.heights.width;
  const dv = 1 / world.heights.height;
  const e = world.heights.texel;
  // Orodruin (cinder, basalt and fissure glow are strongest around it)
  const doomPlace = world.places.get('mount-doom');
  const doomXZ = vec2(doomPlace?.x ?? 1e6, doomPlace?.z ?? 1e6);

  // outputs of the one surface pass, read by the normal / roughness / AO / emissive slots (the colour
  // slot is built first, so these are assigned before they are read)
  const outNormal = property('vec3', 'terrainNormalW');
  const outRough = property('float', 'terrainRough');
  const outAO = property('float', 'terrainAO');
  const outAlbedo = property('vec3', 'terrainAlbedo');
  const outGlow = property('vec3', 'terrainGlow');

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

    // ---- noise (km): 60 planar; 12, 3 and 0.9 in 3D (they vary along a cliff's fall line, so no
    // rock term is constant down a face — the vertical smear of a planar noise on steep ground)
    const n1 = mx_noise_float(p.xz.mul(1 / 60));
    const n2 = mx_noise_float(p.mul(1 / 12));
    const n3 = mx_noise_float(p.mul(1 / 3));

    // regional ground look (its ecotones are domain-warped and dithered in the texture itself)
    const pal = groundPalette(groundTex, uv);
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
    // snow v3: a patchy edge (fine 3D noise shifts the effective height near the line: 0.9 km, and 0.4 km
    // offline) and wind scouring — convex crests and the windward (west-facing) steep faces lose their snow
    // first, so a massif shows broken snowfields between bare ribs, never an icing line
    // the 0.4 km 3D noise (offline tiers only; faded once it would shimmer): snow edge patches, grass mottling
    const n5f: N = !preview && (SNOW_V3_ON || GRASS_BREAKUP_ON) ? mx_noise_float(p.mul(1 / 0.4)).mul(float(1).sub(smoothstep(0.03, 0.15, fp))) : float(0);
    let snowJit: N = float(0);
    let scour: N = float(0);
    if (SNOW_V3_ON) {
      snowJit = n4.mul(1.0).add(n5f.mul(0.6));
      const windward = clamp(nM.x.negate().mul(1.6), 0, 1).mul(smoothstep(0.18, 0.42, slope));
      scour = crest.mul(0.6).add(windward.mul(0.5)).mul(smoothstep(-0.25, 0.35, n3.add(n4.mul(0.6))));
    }
    // snow sheds from convex ribs and collects in gullies
    const snowRegional = snowAt(hEff.add(snowJit), slope.add(n3.mul(0.04)).add(crest.mul(0.12)).add(scour.mul(0.18)), line, pal.volcanic, max(curv, 0));
    // stamp snow caps: above the cap's line (streaky edge, lower on north faces) on all but the sheerest
    // faces, fading out over the outer fifth of the stamp's reach
    let capSnow: N = float(0);
    if (caps.length) {
      // rock buttresses break through the cap on its steep, scoured parts (snow v3)
      const sheer = SNOW_V3_ON
        ? float(1).sub(smoothstep(0.6, 0.88, slope.add(n3.mul(0.08)).add(crest.mul(0.06)).add(n4.mul(0.12)).add(scour.mul(0.2))))
        : float(1).sub(smoothstep(0.8, 0.96, slope.add(n3.mul(0.08)).add(crest.mul(0.06))));
      for (let i = 0; i < caps.length; i++) {
        const cx = snowCaps.element(i * 4);
        const cz = snowCaps.element(i * 4 + 1);
        const reach = snowCaps.element(i * 4 + 2);
        const cl = snowCaps.element(i * 4 + 3);
        const d = length(p.xz.sub(vec2(cx, cz)));
        const wR = clamp(reach.sub(d).div(reach.mul(0.2).add(1e-3)), 0, 1);
        const up = smoothstep(cl.sub(0.6), cl.add(1.6), hEff.add(n3.mul(1.4)).add(n2.mul(0.8)).add(snowJit.mul(1.3)));
        capSnow = max(capSnow, wR.mul(up));
      }
      capSnow = capSnow.mul(sheer).mul(float(1).sub(pal.volcanic));
    }
    const snowBase = max(snowRegional, capSnow);

    // ---- rock / scree
    // lowland river valleys: the carved banks are earth and turf, not rock (unless the ground is
    // rocky) — on moderate slopes only: a steep scarp (the Gladden bluffs) stays rock
    const lowland = float(1).sub(smoothstep(9, 18, hC)).mul(float(1).sub(pal.rockiness));
    // crests below the alpine zone turn to rock too (no grass rims on mountain ridges)
    const subalpine = smoothstep(line.sub(17), line.sub(9), hEff).mul(float(1).sub(turf));
    // ... except where a landmark stamp kept its faces rock (surface 'rock', or a stamp on rocky ground:
    // Rivendell's scarps, the Argonath gorge) — those walls read as soil-brown under the bank rule
    const rockStamp = stamped.mul(float(1).sub(turf));
    const bankTurf = max(water.a.mul(0.85), lowland.mul(0.6))
      .mul(float(1).sub(pal.rockiness))
      .mul(float(1).sub(rockStamp))
      .mul(float(1).sub(alpineRaw))
      .mul(float(1).sub(smoothstep(BANK_TURF_SLOPE[0], BANK_TURF_SLOPE[1], slope)));
    const rockBase = max(
      rockAt(slope.add(n2.mul(0.035)).add(n3.mul(0.02)).add(crest.mul(0.06).add(pal.rockiness.mul(crest).mul(0.12))).sub(hollow.mul(0.03)), alpine, max(turf, bankTurf), pal.rockiness),
      smoothstep(0.1, 0.5, crest.add(n3.mul(0.15))).mul(subalpine).mul(0.85),
      smoothstep(0.08, 0.4, crest.add(slope.mul(1.4)).add(n3.mul(0.12))).mul(pal.rockiness).mul(0.85),
    );
    // scree / talus: the concave, less steep parts of the rock ground (slope feet, gully fans)
    const scree = clamp(curv.mul(1.5).add(0.2).add(n3.mul(0.25)), 0, 1).mul(float(1).sub(smoothstep(0.3, 0.52, slope)));

    // ---- ground dryness
    // grass breakup (P3): lush ↔ straw mottling at ≈ 5 and 1.5 km (3 / 0.9 km noise), sun-facing (south)
    // slopes drier and shade-facing ones lusher (aspectDryness, shared with the water's coarse albedo),
    // hollows lusher — the tonal variety of real pasture instead of one felt colour
    let breakup: N = float(0);
    if (GRASS_BREAKUP_ON)
      breakup = n3
        .mul(0.14)
        .add(n4.mul(0.16))
        .add(n5f.mul(0.12))
        .mul(pal.pattern.add(0.5))
        .add(aspectDryness(nM.z, slope))
        .sub(hollow.mul(0.06));
    const dryness = clamp(
      pal.dryness.add(n1.mul(0.2)).add(n2.mul(0.12)).add(hC.mul(TS.drynessPerHeight)).add(crest.mul(0.12)).sub(hollow.mul(0.08)).sub(moist.mul(0.3)).sub(water.a.mul(0.15)).add(breakup),
      0,
      1,
    );

    // ---- CC0 detail layers: soft ground (two layers) and hard ground (one layer), triplanar in
    // review/final; preview projects the soft grain from above (faded on steep faces) and the hard layer
    // biplanar (top + the dominant side axis)
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
      // volcanic ground (Gorgoroth, and Dagorlad's 0.5) takes the ash grain, never meadow
      const iA = idx(select(volc.greaterThan(0.35), float(detail.index('ash')), float(detail.index('meadow'))));
      const iB = idx(select(volc.greaterThan(0.6), float(detail.index('ash')), float(detail.index('dry'))));
      const iH = idx(select(snowBase.greaterThan(0.5), float(detail.index('snow')), select(scree.mul(rockBase).greaterThan(0.45), float(detail.index('scree')), float(detail.index('rock')))));
      // the two soft layers at one projection, blended by dryness
      const softAt = (uv: N): N => mix(texture(T, uv).depth(iA), texture(T, uv).depth(iB), dryness);
      // tangent-space detail normal (0.5 = flat) → world perturbation for each projection: x along the
      // projection's u axis, y along its v axis (OpenGL green, v grows with the texture rows)
      const nx = (t: N): N => t.r.mul(2).sub(1);
      const ny = (t: N): N => t.g.mul(2).sub(1).negate();
      const topN = (t: N): N => vec3(nx(t), 0, ny(t));
      // side projections mirrored on the negative faces (a west face shows its texture the same way round
      // as an east face) — u runs to the face's right, so the u axis flips with the face: the detail
      // normals follow the mirror and east / west / north / south faces are lit consistently
      const sx = select(nM.x.lessThan(0), float(-1), float(1));
      const sz = select(nM.z.lessThan(0), float(-1), float(1));
      const uvX = (tile: number): N => vec2(p.z.mul(sx).negate(), p.y).mul(1 / tile);
      const uvZ = (tile: number): N => vec2(p.x.mul(sz), p.y).mul(1 / tile);
      const sideXN = (t: N): N => vec3(0, ny(t), nx(t).mul(sx).negate());
      const sideZN = (t: N): N => vec3(nx(t).mul(sz), ny(t), 0);
      let soft: N;
      let softN: N;
      let hard: N;
      let hardN: N;
      // steep-face fade of the soft grain where it is projected from above only (preview)
      let softSteep: N = float(1);
      if (preview) {
        soft = softAt(p.xz.mul(1 / SOFT_TILE).add(warp));
        softN = topN(soft);
        softSteep = float(1).sub(smoothstep(SOFT_STEEP[0], SOFT_STEEP[1], slope));
        // biplanar hard layer: top + the dominant side axis (+1 fetch). Gradients are taken from the
        // continuous world position, so the switch between the two side axes never shows a mip seam
        const hTop = texture(T, p.xz.mul(1 / HARD_TILE)).depth(iH);
        const useX = abs(nM.x).greaterThan(abs(nM.z));
        const dpx = dFdx(p);
        const dpy = dFdy(p);
        const gx = select(useX, vec2(dpx.z, dpx.y), vec2(dpx.x, dpx.y)).mul(1 / HARD_TILE);
        const gy = select(useX, vec2(dpy.z, dpy.y), vec2(dpy.x, dpy.y)).mul(1 / HARD_TILE);
        const hSide = texture(T, select(useX, uvX(HARD_TILE), uvZ(HARD_TILE))).grad(gx, gy).depth(iH);
        const wt0 = pow(nM.y, 4);
        const ws0 = pow(max(abs(nM.x), abs(nM.z)), 4);
        const wt = wt0.div(wt0.add(ws0));
        hard = mix(hSide, hTop, wt);
        hardN = topN(hTop).mul(wt).add(select(useX, sideXN(hSide), sideZN(hSide)).mul(float(1).sub(wt)));
      } else {
        // triplanar weights (sharpened): top xz, side faces zy / xy — turf on steep stamp flanks
        // and banks (the Minas Tirith cone) keeps an unstretched grain like the rock does
        const bw0 = pow(abs(nM), vec3(4));
        const bw = bw0.div(bw0.x.add(bw0.y).add(bw0.z));
        const tri = (top: N, tx: N, tz: N): [N, N] => [
          top.mul(bw.y).add(tx.mul(bw.x)).add(tz.mul(bw.z)),
          topN(top).mul(bw.y).add(sideXN(tx).mul(bw.x)).add(sideZN(tz).mul(bw.z)),
        ];
        [soft, softN] = tri(softAt(p.xz.mul(1 / SOFT_TILE).add(warp)), softAt(uvX(SOFT_TILE).add(warp)), softAt(uvZ(SOFT_TILE).add(warp)));
        [hard, hardN] = tri(texture(T, p.xz.mul(1 / HARD_TILE)).depth(iH), texture(T, uvX(HARD_TILE)).depth(iH), texture(T, uvZ(HARD_TILE)).depth(iH));
      }
      // fade by texel footprint: the grain resolves at mid distance; far off (tile < ~10 px) the
      // regional palette alone carries the ground and no tile can repeat visibly
      const ampS = float(1).sub(smoothstep(SOFT_TILE / 64, SOFT_TILE / 10, fp)).mul(softSteep);
      const ampH = float(1).sub(smoothstep(HARD_TILE / 64, HARD_TILE / 9, fp));
      lumSoft = mix(float(1), soft.b.mul(2), ampS.mul(pal.pattern.mul(0.5).add(0.6)));
      lumHard = mix(float(1), hard.b.mul(2), ampH);
      // height-blended transitions: rock and snow edges follow the layers' relief
      const tr = (w: N): N => w.mul(float(1).sub(w)).mul(4);
      rock.assign(clamp(rockBase.add(hard.a.sub(soft.a).mul(0.7).mul(tr(rockBase)).mul(ampH)), 0, 1));
      snow.assign(clamp(snowBase.add(float(0.5).sub(hard.a).mul(0.8).mul(tr(snowBase)).mul(ampH)), 0, 1));
      dN = mix(softN.mul(ampS.mul(0.45)), hardN.mul(ampH.mul(0.9)), max(rock, snow));
    }

    // ---- rock colour: dry-brush relief (crests catch the light, cavities hold shadow), scree fans
    const brush = float(1).add(crest.mul(0.18)).sub(hollow.mul(0.12)).mul(mix(float(0.8), float(1.05), ao));
    const rockTint = pal.rock.mul(vec3(float(1).add(n2.mul(0.05)), float(1), float(1).sub(n2.mul(0.05))));
    const rockFace = rockTint.mul(float(0.86).add(n2.mul(0.1)).add(n3.mul(0.12)).add(n4.mul(0.06))).mul(brush);
    const screeCol = mix(pal.rock, srgbNode(TS.scree), float(0.5).mul(float(1).sub(pal.volcanic.mul(0.7)))).mul(float(1.02).add(n4.mul(0.06)));
    const rockCol = mix(rockFace, screeCol, scree).mul(lumHard).toVar();

    // ---- strata on steep rock: bedding planes across the face (hard beds pale and proud with lit ledge
    // tops, soft beds dark and recessed), folded by the 60 km noise and wiggled by the 3 km one — the
    // horizontal structure that breaks the fall-line smear of the 0.4 km relief and masks
    if (STRATA_ON) {
      const sW = smoothstep(STRATA_SLOPE[0], STRATA_SLOPE[1], slope).mul(rock).mul(float(1).sub(snow)).mul(float(1).sub(scree.mul(0.7)));
      const st = strata(p, nM, n1.mul(2.2).add(n3.mul(0.35)), n3.mul(0.8).add(n2.mul(0.6)), { preview });
      rockCol.assign(rockCol.mul(mix(float(1), st.lum, sW)).mul(mix(vec3(1), st.tint, sW)));
      dN = dN.add(st.dn.mul(sW));
    }

    // ---- ground: grass ↔ dry, micro-pattern, alpine turf, soil on slopes, relief tint
    const ground = mix(pal.grass, pal.dry, dryness).toVar();
    // micro-pattern (tussock clumps / meadow patches / heath), region-weighted amplitude
    const patAmp = pal.pattern.mul(detail ? 1.1 : 1.6).add(0.2);
    ground.assign(ground.mul(float(1).add(n3.mul(0.1).add(n4.mul(detail ? (GRASS_BREAKUP_ON ? 0.12 : 0.08) : 0.16)).mul(patAmp))).mul(lumSoft));
    // grass breakup (P3): a tonal mottle independent of the palette's grass ↔ dry pair — lusher, darker
    // patches and lighter straw ones at 0.4 / 0.9 / 3 km — so even a region whose two tones are close
    // (Rohan's golds, the Hobbiton turf) never reads as one felt colour
    if (GRASS_BREAKUP_ON) {
      const m = clamp(n5f.mul(1.1).add(n4.mul(0.9)).add(n3.mul(0.6)), -1, 1).mul(pal.pattern.mul(0.6).add(0.5));
      ground.assign(ground.mul(vec3(1).add(vec3(0.12, 0.07, -0.04).mul(m))).mul(float(1).add(m.mul(0.07))));
    }
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
    // far canopy shell (S4 W2-C; weight 0 until it lands): the forest's own canopy surface replaces the
    // floor — and the slope rock under it — and carries its own relief
    const shell = canopyShell(p, fp, lc.r);
    ground.assign(mix(ground, shell.albedo, shell.weight));

    // ---- volcanic ground (Gorgoroth, Dagorlad, Nurn): cracked ash crust plates, basalt flow lobes,
    // cinder round Doom, fissure glow (volcanic.ts). Branch: the rest of the world never pays for it,
    // nor does volcanic ground too far off for any crack to resolve
    const crustDn = vec3(0).toVar();
    const crustW = float(0).toVar();
    const crustRough = float(0.95).toVar();
    const glow = vec3(0).toVar();
    // the relief normal the shading uses (review / final: on the volcanic plains, the broad normal)
    const nRelief = nM.toVar();
    // gentle volcanic ground: the baked sub-km ripples of the plain shade like dunes under a raking sun
    const flatV = smoothstep(0.6, 0.95, pal.volcanic).mul(float(1).sub(smoothstep(0.12, 0.32, slope)));
    if (CRUST_ON) {
      const volc = pal.volcanic.toVar();
      If(volc.greaterThan(VOLCANIC.volcanic[0]).and(fp.lessThan(VOLCANIC.fade[1])), () => {
        const c = volcanicCrust({ p, fp, slope, volcanic: volc, n2, n3, n4, doom: doomXZ, preview });
        ground.assign(mix(ground, c.col(ground), c.w));
        rockCol.assign(mix(rockCol, rockCol.mul(vec3(1.3, 0.92, 0.8)), c.cinder));
        crustDn.assign(c.dn);
        crustW.assign(c.w);
        crustRough.assign(c.rough);
        glow.assign(c.glow);
        if (!preview) {
          // the plain's broad relief (taps 3 texels out, ≈ 1.2 km): its ripples no longer shade, the
          // landforms (the cone, the ranges' feet) still do — offline tiers only (+4 fetches, here only)
          const o = 3;
          const bL = texture(hTex, uv.sub(vec2(du * o, 0))).level(0).r;
          const bR = texture(hTex, uv.add(vec2(du * o, 0))).level(0).r;
          const bU = texture(hTex, uv.sub(vec2(0, dv * o))).level(0).r;
          const bD = texture(hTex, uv.add(vec2(0, dv * o))).level(0).r;
          const nBroad = normalize(vec3(bL.sub(bR), float(2 * e * o), bU.sub(bD)));
          const k = smoothstep(0.6, 0.95, volc).mul(float(1).sub(smoothstep(0.15, 0.3, float(1).sub(nBroad.y)))).mul(0.85).mul(c.w);
          nRelief.assign(normalize(mix(nM, nBroad, k)));
        }
      });
    }

    const col = mix(ground, rockCol, rock.mul(float(1).sub(shell.weight))).toVar();
    // snow: a slightly grey, varied albedo (old wind-packed vs fresh), never paper white
    const snowCol = srgbNode(TS.snow).mul(float(0.97).add(n3.mul(0.03)).add(n4.mul(0.03))).mul(mix(float(1), lumHard, 0.6));
    col.assign(mix(col, snowCol, snow));

    // ---- coasts, shores, wetlands, ash, roads, channels
    const flat = flatGround(slope);
    const beach = smoothstep(0.55, 0.12, hC).mul(water.b).mul(flat);
    col.assign(mix(col, srgbNode(TS.beach).mul(float(0.95).add(n4.mul(0.08))).mul(lumSoft), beach.mul(0.85)));
    const shore = max(sm.b, sm.a.mul(fineFade).mul(0.2)).mul(flat).mul(float(1).sub(lc.r)).mul(float(1).sub(snow));
    col.assign(mix(col, srgbNode(TS.shore).mul(float(0.92).add(n4.mul(0.14))).mul(lumSoft), shore.mul(0.5)));
    // wetland (flat ground only): a reddish-olive bog mat (red tussock, sedge, moss) with sparse
    // dark pools of varying size and density. The edge frays out of the soft wetland cover
    // (ground look layer 4, noise-dithered) instead of following the binary landcover outline;
    // far off the pools average into a slightly darker, wetter mat. Pools carry a low roughness
    // (a subtle sheen under the key light).
    // the noise only frays an existing cover: no bog tint where there is no wetland at all
    const wetCover = smoothstep(0.02, 0.15, max(pal.wetland, lc.g));
    const wetEdge = max(pal.wetland.mul(1.25), lc.g.mul(0.55)).add(n2.mul(0.2)).add(n3.mul(0.16)).add(n4.mul(0.08)).mul(wetCover);
    const wetW = smoothstep(0.35, 0.7, wetEdge).mul(float(1).sub(smoothstep(WET_SLOPE[0], WET_SLOPE[1], slope)));
    // pools fade into the mat from regional distances on (at 20–40 km a hard-edged pool of a few hundred
    // metres printed as a graphic 'leopard' blotch), and their edges soften with the pixel footprint
    const poolFade = float(1).sub(smoothstep(0.015, 0.15, fp));
    const poolSoft = fp.mul(3);
    // fine pool noise in a stretched frame bent by a gentle domain warp: bog pools lie in a grain
    // (along the mire's slope and drainage) that wanders, not as round blobs (a fixed rotation —
    // a position-dependent angle on world-scale coordinates would swirl into moiré)
    const pq = vec2(p.x.mul(POOL_GRAIN[0]).sub(p.z.mul(POOL_GRAIN[1])), p.x.mul(POOL_GRAIN[1]).add(p.z.mul(POOL_GRAIN[0]))).add(vec2(n3.mul(2.6), n2.mul(3.4)));
    // only a mild grain (≈1.4:1): stronger stretching printed parallel 'tiger-stripe' dashes
    const n5 = preview ? n4 : mx_noise_float(vec2(pq.x.div(0.46), pq.y.div(0.33)));
    // pool density: open, water-logged reaches in clusters (12 and 3 km noise, the wetter core)
    // between stretches of closed mat
    const poolDens = clamp(n2.mul(0.8).add(n3.mul(1.6)).add(wetW.sub(0.6)).add(0.2), 0, 1);
    const tS = mix(float(0.48), float(0.18), poolDens);
    const tL = mix(float(0.72), float(0.42), poolDens);
    const nS = n5.add(n4.mul(0.3));
    const nL = n4.add(n3.mul(0.35));
    const poolS = smoothstep(tS, tS.add(poolSoft.add(0.07)), nS);
    const poolL = smoothstep(tL, tL.add(poolSoft.add(0.1)), nL);
    const pools = mix(poolDens.mul(0.16).add(0.04), max(poolS, poolL), poolFade).mul(wetW);
    // a wetter, darker moss rim around each pool
    const poolRim = max(smoothstep(tS.sub(0.14), tS, nS), smoothstep(tL.sub(0.16), tL, nL)).mul(poolFade);
    const matN = clamp(n3.mul(0.7).add(n2.mul(0.5)).add(n4.mul(0.25)).add(0.42), 0, 1);
    const mat = mix(mix(srgbNode(TS.wetSedge), srgbNode(TS.wetRust), matN), srgbNode(TS.wetReed), smoothstep(0, 0.5, n4.add(n3.mul(0.4))).mul(0.4))
      .mul(float(1).sub(poolRim.mul(0.22)))
      .mul(lumSoft);
    const wetCol = mix(mat, srgbNode(TS.wetPool), pools.mul(0.85));
    col.assign(mix(col, wetCol, wetW.mul(0.92)));
    col.assign(mix(col, srgbNode(TS.ash), lc.b.mul(0.9)));
    col.assign(mix(col, srgbNode(TS.road), lc.a.mul(0.45)));
    const channel = max(water.r, water.g);
    col.assign(mix(col, srgbNode(TS.channel), channel.mul(0.9)));

    // ---- micro relief: CC0 detail normals or procedural fallback
    // gentle volcanic ground: keep only part of the relief normal's tilt (the crust's plates and clinker
    // carry the relief there, not the baked ripples)
    const kH = float(1).sub(flatV.mul(1 - VOLCANIC.flatten));
    const nB = normalize(vec3(nRelief.x.mul(kH), nRelief.y, nRelief.z.mul(kH)));
    let nW: N;
    if (detail) {
      nW = normalize(nB.add(dN).add(crustDn).add(shell.dn.mul(shell.weight)));
    } else {
      const dFade = float(1).sub(smoothstep(0.05, 0.6, fp));
      const dx = mx_noise_float(p.mul(1 / 0.7).add(vec3(3.1, 0, 7.7)));
      const dz = mx_noise_float(p.mul(1 / 0.7).add(vec3(11.3, 0, 1.9)));
      const amt = dFade.mul(float(0.12).add(rock.mul(0.2)));
      nW = normalize(nB.add(vec3(dx, 0, dz).mul(amt)).add(dN).add(crustDn).add(shell.dn.mul(shell.weight)));
    }

    // ---- outputs
    // (no curvature darkening in the volcanic plains' ripple troughs)
    const occl = ao.mul(float(1).sub(max(curv, 0).mul(0.12).mul(float(1).sub(flatV))));
    col.assign(col.mul(mix(float(0.8), float(1), occl)));
    outNormal.assign(nW);
    outAO.assign(mix(float(1), occl, 0.85));
    const rough = mix(mix(mix(float(0.92), crustRough, crustW), float(0.82), rock), float(0.55), snow);
    outRough.assign(mix(mix(rough, float(0.24), pools.mul(0.85)), float(0.12), channel));
    outAlbedo.assign(col);
    // fissure glow on open ground only (never on the rock faces or under snow / water)
    outGlow.assign(glow.mul(float(1).sub(rock)).mul(float(1).sub(channel)));
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
  // fissure glow + the light the emission spill throws onto the ground (W2-D; zero until it lands):
  // Lambertian albedo · E / π
  material.emissiveNode = outGlow.add(outAlbedo.mul(spillIrradiance(positionWorld, outNormal)).mul(1 / Math.PI));
  return material;
}
