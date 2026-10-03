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
 *  - spillAux[i] = (halo, glint, 0, 0) halo gain (lava, the Eye, magic, beacons, faintly the ithildin; 0 = no halo) and glint gain
 * Counts are uniforms (dynamic loops): `spillU.count` (≤ 4 preview, ≤ 8 review / final) and `spillU.haloOn`
 * (0 in preview).
 * Frames without lit sources near the focus run zero iterations.
 */

type N = TslNode;
const { Fn, If, Loop, atan, clamp, dot, float, int, length, log, max, min, sqrt, step, uniform, uniformArray, vec3 } = tsl;

/** Maximum number of spill sources uploaded per frame (review/final; preview uses fewer). */
export const SPILL_MAX = 8;

/** length of the view ray through the haze for sky pixels (sky.ts dome: halos above the horizon), km */
export const HALO_RAY_KM = 600;

/** wrap of the Lambert term: surfaces turned up to ~17° away from a source still catch a little of it */
const WRAP = 0.3;
/** halo: scattering per unit regional density (× the source's radiant intensity × the airlight integral) */
const HALO_SIGMA = 0.008;
/**
 * halo: knee of the soft compression of the summed in-scatter (radiance): cap · ln(1 + s / cap) keeps a
 * slope everywhere (a peaked glow that keeps falling off — no flat-topped disc) while a crater's core
 * grows only logarithmically (never a sun disc)
 */
const HALO_CAP = 0.12;

const vec4s = (): Vector4[] => Array.from({ length: SPILL_MAX }, () => new Vector4());

/** The uniforms the EmissionSystem writes every frame (spillSources.ts selectSpill writes spillArrays()). */
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
 * ∫ dt / (h² + (t − t0)²) = (atan((L − t0)/h) − atan(−t0/h)) / h along the ray (h = √(h₀² + r0²) with the
 * passing distance h₀ and the core radius r0: finite at the source, a smooth peak), × the source's radiant intensity c·r0², the halo gain and the
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
          // passing distance with a smooth core: √(h² + r0²) (finite at the source; no flat-topped disc of
          // radius r0, which max(h, r0) gave)
          const h = sqrt(max(dot(m, m).sub(t0.mul(t0)), 0).add(c.w.mul(c.w)));
          // the ray passes within the source's reach: a smooth window in the passing distance (no disc edge)
          const hx = clamp(h.div(a.w), 0, 1);
          const hw = float(1).sub(hx.mul(hx));
          const reach = hw.mul(hw).mul(hw);
          const I = atan(Lr.sub(t0).div(h)).sub(atan(t0.negate().div(h))).div(h);
          sum.addAssign(c.xyz.mul(c.w.mul(c.w)).mul(I.mul(hg).mul(reach)));
        });
      });
      const s = sum.mul(max(density, 0).mul(HALO_SIGMA));
      // soft compression per channel: cap · ln(1 + s / cap)
      out.assign(log(vec3(1).add(s.div(HALO_CAP))).mul(HALO_CAP));
    });
    return out;
  })();
}

/**
 * Specular glints of the sources on a glossy surface (water): view vector V (surface → eye), normal n,
 * GGX `roughness` (perceptual). Per source: the irradiance it delivers at the surface (the spill's
 * near-field falloff, windowed at twice the reach — reflections carry farther than diffuse light) × a
 * normalised GGX lobe × Schlick Fresnel (water, F0 = 0.02) / (4 n·v) × its glint gain. The lobe widens
 * with roughness and with the source's angular size (r0 / d), so a near fire is a soft streak on the
 * water and a far one a small sparkle.
 */
export function spillGlint(p: N, V: N, n: N, roughness: N): N {
  return Fn(() => {
    const P = vec3(p).toVar();
    const Vv = vec3(V).toVar();
    const Nn = vec3(n).toVar();
    const a0 = max(roughness, 0.04).mul(roughness).toVar();
    const nv = max(dot(Nn, Vv), 0.08).toVar();
    const sum = vec3(0).toVar();
    Loop({ start: int(0), end: spillU.count, type: 'int', condition: '<' }, ({ i }: { i: N }) => {
      const a = spillU.pos.element(i);
      const gg = spillU.aux.element(i).y;
      const L = a.xyz.sub(P);
      const d2 = dot(L, L);
      const R2 = a.w.mul(a.w).mul(4);
      If(gg.greaterThan(0).and(d2.lessThan(R2)), () => {
        const c = spillU.col.element(i);
        const d = sqrt(max(d2, 1e-8));
        const l = L.div(d);
        // half vector, guarded against l = −V (normalize(0) → NaN)
        const hv = l.add(Vv);
        const Hh = hv.div(max(length(hv), 1e-6));
        const nh = clamp(dot(Nn, Hh), 0, 1);
        const vh = clamp(dot(Vv, Hh), 0, 1);
        // the source's angular radius widens the lobe (a bigger source, a broader glint)
        const alpha = min(a0.add(c.w.div(d).mul(0.5)), 1);
        const a2 = alpha.mul(alpha);
        const den = nh.mul(nh).mul(a2.sub(1)).add(1);
        const D = a2.div(den.mul(den).mul(Math.PI));
        const f = float(1).sub(vh);
        const f2 = f.mul(f);
        const F = float(0.02).add(f2.mul(f2).mul(f).mul(0.98));
        const E = float(1).div(float(1).add(d2.div(c.w.mul(c.w))));
        const x2 = d2.div(R2);
        const win = clamp(float(1).sub(x2.mul(x2)), 0, 1);
        // a source below the surface's tangent plane throws no glint
        const above = step(0, dot(Nn, l));
        sum.addAssign(c.xyz.mul(D.mul(F).mul(E).mul(win).mul(gg).mul(above).div(nv.mul(4))));
      });
    });
    return sum;
  })();
}
