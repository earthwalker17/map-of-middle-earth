import { Vector4 } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';

/**
 * Emission spill — "emission lights its surroundings" (S4 W2-D).
 *
 * The EmissionSystem selects the few strongest light sources around the camera focus each frame (a
 * pure function of the SceneState: spillSources.ts) and uploads them here as uniform arrays; the
 * shared materials call these TSL helpers to add the light those sources throw onto nearby surfaces
 * (terrain, structures, foliage, water), into the haze along the view ray (halos) and as glints on water.
 * W0 contract: the exported signatures are frozen.
 *
 * Source i (uniform arrays, SPILL_MAX each):
 *  - spillPos[i] = (x, y, z, R)       position (world km) and reach R (km): the light is windowed to 0 at R
 *  - spillCol[i] = (c.rgb, r0)        near-field irradiance c (linear, gate · flicker · selection weight
 *                                     applied) and the core radius r0 (km): E(d) = c / (1 + (d / r0)²)
 *  - spillAux[i] = (halo, glint, 0, 0) halo gain (lava, the Eye, magic, beacons; 0 = no halo) and glint gain
 * Counts are uniforms (dynamic loops): `spillCount` (4 preview, 8 review / final), `haloOn` (0 in preview).
 * Frames without lit sources near the focus run zero iterations.
 */

type N = TslNode;
const { Fn, If, Loop, atan, clamp, dot, float, int, length, max, min, normalize, sqrt, uniform, uniformArray, vec3 } = tsl;

/** Maximum number of spill sources uploaded per frame (review/final; preview uses fewer). */
export const SPILL_MAX = 8;

/** length of the view ray through the haze for sky pixels (sky.ts dome: halos above the horizon), km */
export const HALO_RAY_KM = 600;

/** wrap of the Lambert term: surfaces turned up to ~17° away from a source still catch a little of it */
const WRAP = 0.3;
/** halo: scattering per unit regional density (× the source's radiant intensity × the airlight integral) */
const HALO_SIGMA = 0.008;
/** halo: soft cap of the summed in-scatter (radiance): a glow in the air, never a sun disc */
const HALO_CAP = 0.3;

const vec4s = (): Vector4[] => Array.from({ length: SPILL_MAX }, () => new Vector4());

/** The uniforms the EmissionSystem writes every frame (spillSources.ts selectSpill → uploadSpill). */
export const spillU = {
  pos: uniformArray(vec4s(), 'vec4'),
  col: uniformArray(vec4s(), 'vec4'),
  aux: uniformArray(vec4s(), 'vec4'),
  /** number of active sources (≤ SPILL_MAX) */
  count: uniform(0, 'int'),
  /** 1 = halos on (review / final), 0 = off (preview: spillInScatter costs one uniform test) */
  haloOn: uniform(0),
};

/** CPU-side views of the uniform arrays (Vector4 per source). */
export function spillArrays(): { pos: Vector4[]; col: Vector4[]; aux: Vector4[] } {
  return { pos: spillU.pos.array as Vector4[], col: spillU.col.array as Vector4[], aux: spillU.aux.array as Vector4[] };
}

/** Irradiance (linear RGB) at world position `p` with unit normal `n` from the selected sources. */
export function spillIrradiance(p: N, n: N): N {
  return Fn(() => {
    // shared nodes built here, in uniform control flow, before the loop's branch
    const P = vec3(p).toVar();
    const Nn = vec3(n).toVar();
    const sum = vec3(0).toVar();
    Loop({ start: int(0), end: spillU.count, type: 'int', condition: '<' }, ({ i }: { i: N }) => {
      const a = spillU.pos.element(i);
      const L = a.xyz.sub(P);
      const d2 = dot(L, L);
      const R2 = a.w.mul(a.w);
      If(d2.lessThan(R2), () => {
        const c = spillU.col.element(i);
        const d = sqrt(max(d2, 1e-8));
        const wrap = clamp(dot(Nn, L.div(d)).add(WRAP).div(1 + WRAP), 0, 1);
        // smooth window to exactly 0 at R; finite near-field core (1 + (d/r0)²)⁻¹
        const x2 = d2.div(R2);
        const win = clamp(float(1).sub(x2.mul(x2)), 0, 1);
        const fall = float(1).div(float(1).add(d2.div(c.w.mul(c.w))));
        sum.addAssign(c.xyz.mul(wrap.mul(win.mul(win)).mul(fall)));
      });
    });
    return sum;
  })();
}

/**
 * Light scattered toward the eye by the haze along the segment `from` → `to` (halos round strong
 * sources: lava, the Eye, magic, beacons). Per source the analytic point-light airlight integral
 * ∫ dt / (h² + (t − t0)²) = (atan((L − t0)/h) − atan(−t0/h)) / h along the ray (h ≥ the core radius r0,
 * so the glow is finite at the source), × the source's radiant intensity c·r0², the halo gain and the
 * local haze `density` (the regional density multiplier, 1 = clear air); faded out where the ray passes
 * farther than the source's reach; soft-capped. Review / final only (preview: zero).
 */
export function spillInScatter(from: N, to: N, density: N): N {
  return Fn(() => {
    const out = vec3(0).toVar();
    If(spillU.haloOn.greaterThan(0.5).and(spillU.count.greaterThan(int(0))), () => {
      const F = vec3(from).toVar();
      const ray = vec3(to).sub(F);
      const Lr = max(length(ray), 1e-4);
      const u = ray.div(Lr);
      const sum = vec3(0).toVar();
      Loop({ start: int(0), end: spillU.count, type: 'int', condition: '<' }, ({ i }: { i: N }) => {
        const hg = spillU.aux.element(i).x;
        If(hg.greaterThan(0), () => {
          const a = spillU.pos.element(i);
          const c = spillU.col.element(i);
          const m = a.xyz.sub(F);
          const t0 = dot(m, u);
          const h = max(sqrt(max(dot(m, m).sub(t0.mul(t0)), 0)), c.w);
          // the ray passes within the source's reach: a smooth window in the passing distance (no disc edge)
          const hx = clamp(h.div(a.w), 0, 1);
          const hw = float(1).sub(hx.mul(hx));
          const reach = hw.mul(hw).mul(hw);
          const I = atan(Lr.sub(t0).div(h)).sub(atan(t0.negate().div(h))).div(h);
          sum.addAssign(c.xyz.mul(c.w.mul(c.w)).mul(I.mul(hg).mul(reach)));
        });
      });
      const s = sum.mul(max(density, 0).mul(HALO_SIGMA));
      // soft cap per channel: s / (1 + s / cap)
      out.assign(s.div(vec3(1).add(s.div(HALO_CAP))));
    });
    return out;
  })();
}

/**
 * Specular glints of the sources on a glossy surface (water): view vector V (surface → eye), normal n,
 * GGX `roughness` (perceptual). Normalised GGX lobe per source × the source's irradiance at the surface
 * (spill falloff) × its glint gain; the highlight widens with roughness and with the source's angular
 * size (r0 / d), so a near fire is a soft streak and a far one a small sparkle.
 */
export function spillGlint(p: N, V: N, n: N, roughness: N): N {
  return Fn(() => {
    const P = vec3(p).toVar();
    const Vv = vec3(V).toVar();
    const Nn = vec3(n).toVar();
    const a0 = max(roughness, 0.04).mul(roughness).toVar();
    const sum = vec3(0).toVar();
    Loop({ start: int(0), end: spillU.count, type: 'int', condition: '<' }, ({ i }: { i: N }) => {
      const a = spillU.pos.element(i);
      const gg = spillU.aux.element(i).y;
      const L = a.xyz.sub(P);
      const d2 = dot(L, L);
      const R2 = a.w.mul(a.w);
      If(gg.greaterThan(0).and(d2.lessThan(R2.mul(4))), () => {
        const c = spillU.col.element(i);
        const d = sqrt(max(d2, 1e-8));
        const l = L.div(d);
        const Hh = normalize(l.add(Vv));
        const nh = clamp(dot(Nn, Hh), 0, 1);
        const nl = clamp(dot(Nn, l), 0, 1);
        // the source's angular radius widens the lobe (energy-conserving: a bigger source, a broader glint)
        const alpha = min(a0.add(c.w.div(d).mul(0.5)), 1);
        const a2 = alpha.mul(alpha);
        const den = nh.mul(nh).mul(a2.sub(1)).add(1);
        const D = a2.div(den.mul(den).mul(Math.PI));
        // the irradiance the source delivers at the surface (no window: reflections reach farther than spill)
        const E = float(1).div(float(1).add(d2.div(c.w.mul(c.w))));
        const x2 = d2.div(R2.mul(4));
        const win = clamp(float(1).sub(x2.mul(x2)), 0, 1);
        sum.addAssign(c.xyz.mul(D.mul(E).mul(nl).mul(gg).mul(win).mul(0.25)));
      });
    });
    return sum;
  })();
}
