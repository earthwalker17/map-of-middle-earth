import { MeshStandardNodeMaterial, type Texture } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import { env } from '../materials/environment.ts';
import { SLAB } from './slabSpec.ts';

type N = TslNode;

const {
  Fn,
  abs,
  attribute,
  cameraViewMatrix,
  clamp,
  dot,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  mx_noise_float,
  mx_noise_vec3,
  normalGeometry,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  texture,
  varying,
  vec2,
  vec3,
  vec4,
} = tsl;

/** sRGB hex → linear vec3 constant */
function srgb(hex: number): N {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return vec3(c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255));
}

/** cheap 1D hash → [0,1) (band ids are small integers) */
const hash11 = (x: N): N => fract(sin(x.mul(127.1).add(11.7)).mul(43758.5453));

export interface SlabMaterialInputs {
  heights: Texture;
  /** world → height-texture uv */
  toUv: (xz: N) => N;
}

/** Height of the terrain at the slab edge nearest to a (possibly just-outside) world xz. */
function edgeHeight(inp: SlabMaterialInputs, xz: N, level = true): N {
  const t = texture(inp.heights, inp.toUv(xz));
  return level ? t.level(0).r : t.r;
}

// ------------------------------------------------------------------ strata cut face

export interface StrataOptions {
  /**
   * Preview tier: everything that varies only along the cut (fold under the relief, undulation,
   * fault-block coordinate, soil depth noise, the cut-top height) moves to the vertex stage — the
   * strip has a vertex per height texel — and the per-pixel noise drops its fine octaves
   * (grain, warp, rock normal). No texture taps are left in the fragment stage.
   */
  preview?: boolean;
}

/**
 * Geological cross-section on the cut faces: turf line → topsoil → subsoil → folded sedimentary
 * strata (sandstones, shales, limestones, mudstones) that arch up under mountain ranges, marine
 * sediments under the sea, darker and denser with depth. Ledges of harder beds are carried by the
 * normal (finite differences of a bump function), not geometry.
 */
export function createStrataMaterial(inp: SlabMaterialInputs, opts: StrataOptions = {}): MeshStandardNodeMaterial {
  const base = SLAB.base;
  const BAND = 5.6;
  const preview = opts.preview ?? false;

  const positionNode = Fn(() => {
    const p = positionLocal;
    const h = edgeHeight(inp, p.xz);
    return vec3(p.x, mix(float(base), h, attribute('top', 'float')), p.z);
  })();

  // along-cut terms (vertex stage in the preview tier; the strip's xz is its world xz)
  const along = (xz: N, level: boolean) => {
    const s = xz.x.add(xz.y);
    const tap = (o: N) => edgeHeight(inp, xz.add(o), level);
    const fold = select0(tap(vec2(22, 22)).add(tap(vec2(-22, -22))).add(tap(vec2(48, -48))).add(tap(vec2(-48, 48))).mul(0.25));
    const fcS = s.div(70).add(mx_noise_float(vec2(s.mul(0.004), 3.7)).mul(0.6));
    const undul = sin(s.mul(0.0105).add(1.3)).mul(2.5).add(mx_noise_float(vec2(s.mul(0.0045), 8.1)).mul(5));
    const soilN = mx_noise_float(vec2(s.mul(0.09), 0.5));
    return { fold, fcS, undul, soilN, top: edgeHeight(inp, xz, level) };
  };
  const vAlong = preview
    ? (() => {
        const a = along(positionLocal.xz, true);
        return {
          foldUndul: varying(a.fold.add(a.undul), 'vStrataFoldUndul'),
          fcS: varying(a.fcS, 'vStrataFc'),
          soilN: varying(a.soilN, 'vStrataSoilN'),
          top: varying(a.top, 'vStrataTop'),
        };
      })()
    : null;

  const soilNoise = (): N => (vAlong ? vAlong.soilN : mx_noise_float(vec2(positionWorld.x.add(positionWorld.z).mul(0.09), 0.5)));

  /**
   * Shared per-pixel core (computed once, used by colour and normal):
   *  x = stratigraphic offset: fold under the regional relief (arches under ranges, sags under the
   *      sea), long undulation along the cut, gentle warp, and the throw of the fault block
   *      (blocks ~70 km wide, planes dipping ~70°)
   *  y = fractional fault coordinate (seams), z = terrain height at the cut top, w = camera distance
   */
  const core = Fn(() => {
    const p = positionWorld;
    const s = p.x.add(p.z);
    const a = vAlong ?? along(p.xz, false);
    const foldUndul = vAlong ? vAlong.foldUndul : (a as ReturnType<typeof along>).fold.add((a as ReturnType<typeof along>).undul);
    const fc = a.fcS.add(p.y.mul(0.36 / 70));
    const throwY = hash11(floor(fc).add(21.3)).sub(0.5).mul(7);
    let warp: N = mx_noise_float(vec2(s.mul(0.011), p.y.mul(0.03))).mul(1.4);
    if (!preview) warp = warp.add(mx_noise_float(vec2(s.mul(0.045), p.y.mul(0.12))).mul(0.35));
    const off = throwY.sub(foldUndul).add(warp);
    return vec4(off, fract(fc), a.top, length(p.sub(env.cameraPos))).toVar();
  })
    .once()();

  /** formation coordinate at height y, remapped so formations have uneven thicknesses */
  const formation = (y: N): N => {
    const b = y.add(core.x).div(BAND);
    return b.add(sin(b.mul(1.37).add(0.6)).mul(0.28)).add(sin(b.mul(2.71).add(2.1)).mul(0.17));
  };

  const rockColor = (id: N): N => {
    const r = hash11(id);
    const c = srgb(0x8c785e).toVar(); // buff sandstone
    c.assign(mix(c, srgb(0x6f4c3e), smoothstep(0.12, 0.13, r))); // red-brown sandstone
    c.assign(mix(c, srgb(0x4b4845), smoothstep(0.26, 0.27, r))); // grey shale
    c.assign(mix(c, srgb(0x8f8779), smoothstep(0.4, 0.41, r))); // limestone
    c.assign(mix(c, srgb(0x5b4f43), smoothstep(0.53, 0.54, r))); // mudstone
    c.assign(mix(c, srgb(0x716555), smoothstep(0.66, 0.67, r))); // siltstone
    c.assign(mix(c, srgb(0x5a5b50), smoothstep(0.78, 0.79, r))); // greenish siltstone
    c.assign(mix(c, srgb(0x363330), smoothstep(0.89, 0.9, r))); // dark shale
    return c;
  };

  /** protrusion of the bed at height y: harder rock stands proud, small sub-bed steps */
  const ledge = (y: N): N => {
    const bw = formation(y);
    const id = floor(bw);
    const hard = mix(hash11(id.add(3.3)), hash11(id.add(4.3)), smoothstep(0.86, 1.0, fract(bw)));
    const sub = smoothstep(0.3, 0.7, fract(bw.mul(float(3).add(hash11(id.add(7.7)).mul(3))))).mul(0.022);
    return hard.mul(0.6).add(sub);
  };

  const surface = Fn(() => {
    const p = positionWorld;
    const hTop = core.z;
    const dTop = max(hTop.sub(p.y), 0);
    const bw = formation(p.y);
    const id = floor(bw);
    const f = fract(bw);
    const rock = mix(rockColor(id), rockColor(id.add(1)), smoothstep(0.93, 1.0, f)).toVar();
    // sub-bedding + fine lamination + grain
    const s = p.x.add(p.z);
    const subN = fract(bw.mul(float(3).add(hash11(id.add(7.7)).mul(3))));
    const subBed = smoothstep(0.3, 0.7, subN).mul(0.06).sub(0.03);
    // thin laminations only in the fissile beds (shales / siltstones), massive sandstones stay plain
    const fissile = smoothstep(0.55, 0.75, hash11(id.add(12.1)));
    const lam = sin(bw.mul(BAND * 6.3).add(sin(s.mul(0.05)).mul(2))).mul(0.5).add(0.5).mul(fissile);
    const near = float(1).sub(smoothstep(60, 500, core.w));
    let grain: N = mx_noise_float(p.mul(1.7)).mul(0.09);
    if (!preview) grain = grain.add(mx_noise_float(p.mul(7.0)).mul(0.06).mul(near));
    // vertical joints, faint at distance
    const joint = smoothstep(0.93, 1.0, abs(mx_noise_float(vec2(s.mul(0.32), p.y.mul(0.045).add(id.mul(3.1)))))).mul(0.25).mul(near.mul(0.7).add(0.3));
    // lateral facies change: a bed drifts towards another's colour along the cut
    const facies = smoothstep(0.1, 0.6, mx_noise_float(vec2(s.mul(0.006), id.mul(1.7))));
    rock.assign(mix(rock, rockColor(id.add(2)), facies.mul(0.45)));
    // weathering streaks running down from the top edge
    const streak = smoothstep(0.1, 0.8, mx_noise_float(vec2(s.mul(0.23), p.y.mul(0.018)))).mul(smoothstep(-20, 4, p.y)).mul(0.14);
    // fault seams
    const fc = core.y;
    const seam = smoothstep(0.012, 0.0, min(fc, float(1).sub(fc))).mul(0.3);
    rock.mulAssign(float(0.93).add(lam.mul(0.04)).add(subBed).add(grain).sub(joint).sub(streak).sub(seam));

    // soils (land) / marine sediments (sea floor)
    const land = smoothstep(-0.3, 0.3, hTop);
    const mountain = smoothstep(9, 20, hTop);
    const soilN = soilNoise();
    const soilD = float(0.3).add(soilN.mul(0.18)).mul(float(1).sub(mountain.mul(0.75)));
    const subD = soilD.add(float(1.1).add(sin(s.mul(0.031).add(soilN)).mul(0.4)).mul(float(1).sub(mountain.mul(0.6))));
    const turf = srgb(0x3b4126);
    const topsoil = srgb(0x2f2419);
    const subsoil = srgb(0x5e4a35);
    const sand = srgb(0x7d7465);
    const clay = srgb(0x4b4943);
    const upper = mix(mix(sand, topsoil, land), turf, land.mul(float(1).sub(smoothstep(0.05, 0.12, dTop))).mul(float(1).sub(mountain)));
    const lower = mix(clay, subsoil, land);
    const soil = mix(upper, lower, smoothstep(soilD.mul(0.8), soilD.mul(1.15), dTop));
    const col = mix(soil, rock, smoothstep(subD.mul(0.85), subD.mul(1.1), dTop)).toVar();
    col.mulAssign(float(0.94).add(grain.mul(0.5)));

    // weight and depth: darker downward, a soft contact shadow on the plinth ledge
    col.mulAssign(mix(0.38, 1.0, smoothstep(base, base + 34, p.y)));
    col.mulAssign(mix(0.5, 1.0, smoothstep(base, base + 1.4, p.y)));
    const rough = clamp(float(0.86).add(grain.mul(0.5)), 0.6, 1);
    return vec4(col, rough);
  })();

  const normalNode = Fn(() => {
    const p = positionWorld;
    const nW = normalize(normalGeometry);
    const up = vec3(0, 1, 0);
    const e = 0.18;
    const dy = ledge(p.y.add(e)).sub(ledge(p.y.sub(e))).div(2 * e);
    // rough rock: one vector-noise perturbation (+ a finer octave up close)
    const detail = float(1).sub(smoothstep(40, 300, core.w));
    // slightly stretched along the bedding; the ledges carry the main relief
    let nv: N = mx_noise_vec3(p.mul(vec3(0.3, 0.85, 0.3))).mul(0.065);
    if (!preview) nv = nv.add(mx_noise_vec3(p.mul(1.6)).mul(0.035).mul(detail));
    const tangential = nv.sub(nW.mul(dot(nv, nW)));
    const n = normalize(nW.sub(up.mul(dy.mul(0.75))).add(tangential));
    return normalize(cameraViewMatrix.mul(vec4(n, 0)).xyz);
  })();

  const m = new MeshStandardNodeMaterial();
  m.positionNode = positionNode;
  m.castShadowPositionNode = positionNode;
  m.colorNode = surface.rgb;
  m.roughnessNode = surface.a;
  m.metalnessNode = float(0);
  m.normalNode = normalNode;
  return m;
}

/** strata arch up under high ground and sag gently under the sea */
function select0(reg: N): N {
  return max(reg, 0).mul(0.55).add(min(reg, 0).mul(0.3));
}

// ------------------------------------------------------------------ water column (sea cut-away)

/**
 * The sea's cross-section where the cut crosses water: a glassy, translucent column from the
 * seabed up to sea level (y = 0), turquoise under the surface deepening to ink blue, with a bright
 * meniscus line, faint light shafts (animated only by env.tFx) and in-scattered key light.
 */
export function createWaterColumnMaterial(inp: SlabMaterialInputs): MeshStandardNodeMaterial {
  const positionNode = Fn(() => {
    const p = positionLocal;
    const h = min(edgeHeight(inp, p.xz), 0);
    // below the seabed row sits the strata face; above sea level nothing (degenerate where land)
    return vec3(p.x, mix(h, float(0), attribute('top', 'float')), p.z);
  })();

  const shade = () => {
    const p = positionWorld;
    const depth = max(p.y.negate(), 0);
    const seabed = max(edgeHeight(inp, p.xz, false).negate(), 0.01);
    const s = p.x.add(p.z);
    const col = mix(mix(srgb(0x3aa3a6), srgb(0x1a6a8e), smoothstep(0, 1.8, depth)), srgb(0x0d3f73), smoothstep(1.5, 6.0, depth));
    // silt haze just above the seabed
    const colSilt = mix(col, srgb(0x2b3f45), smoothstep(0.35, 0.0, seabed.sub(depth)).mul(0.5));
    // light shafts slanting down from the surface, drifting slowly with effect time
    const shaftN = mx_noise_float(vec2(s.mul(0.55).add(depth.mul(0.35)).add(env.tFx.mul(0.05)), env.tFx.mul(0.02)));
    const shafts = pow(clamp(shaftN.mul(0.5).add(0.5), 0, 1), 3).mul(float(1).sub(smoothstep(0.2, 4.5, depth)));
    const lightAmt = env.sunIntensity.mul(max(env.sunDir.y, 0.05)).mul(float(1).sub(env.night)).add(env.keyIntensity.mul(0.15));
    const meniscus = smoothstep(0.1, 0.0, depth);
    const glow = colSilt.mul(float(0.06).add(shafts.mul(0.18))).mul(lightAmt).add(vec3(0.5, 0.75, 0.8).mul(meniscus.mul(lightAmt).mul(0.12)));
    const alpha = clamp(mix(0.72, 0.95, smoothstep(0.0, 3.5, depth)).add(meniscus.mul(0.2)), 0, 1);
    return { col: colSilt, glow, alpha };
  };

  const m = new MeshStandardNodeMaterial({ transparent: true });
  m.positionNode = positionNode;
  m.colorNode = Fn(() => shade().col)();
  m.emissiveNode = Fn(() => shade().glow)();
  m.opacityNode = Fn(() => shade().alpha)();
  m.roughnessNode = float(0.07);
  m.metalnessNode = float(0);
  m.depthWrite = false;
  return m;
}

// ------------------------------------------------------------------ plinth

/** Dark polished stone for the base moulding — restrained, a little warm, faint veining. */
export function createPlinthMaterial(): MeshStandardNodeMaterial {
  const surface = Fn(() => {
    const p = positionWorld;
    const n1 = mx_noise_float(p.mul(0.02));
    const n2 = mx_noise_float(p.mul(0.11).add(n1));
    const grain = mx_noise_float(p.mul(1.3)).mul(0.04);
    const col = srgb(0x1d1b19).mul(float(0.93).add(n1.mul(0.08)).add(n2.mul(0.05)).add(grain));
    const rough = clamp(float(0.3).add(n1.mul(0.06)).add(n2.mul(0.04)), 0.18, 0.5);
    return vec4(col, rough);
  })();
  const m = new MeshStandardNodeMaterial();
  m.colorNode = surface.rgb;
  m.roughnessNode = surface.a;
  m.metalnessNode = float(0);
  return m;
}

