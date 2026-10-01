import { tsl, type TslNode } from '../materials/tsl.ts';

/**
 * Emission spill — "emission lights its surroundings" (S4 W2-D fills this in).
 *
 * The EmissionSystem selects the few brightest light records around the camera focus each frame
 * (a pure function of the SceneState) and uploads them as uniform arrays; the shared materials call
 * these TSL helpers to add the light those sources throw onto nearby surfaces, into the haze and onto
 * water. W0 contract: the signatures are frozen; until W2-D lands every helper returns zero, so the
 * hooks planted by the terrain / structure / foliage / water / atmosphere materials change nothing.
 */

type N = TslNode;
const { vec3 } = tsl;

/** Maximum number of spill sources uploaded per frame (review/final; preview uses fewer). */
export const SPILL_MAX = 8;

/** Irradiance (linear RGB) at world position `p` with unit normal `n` from the selected sources. */
export function spillIrradiance(p: N, n: N): N {
  void p;
  void n;
  return vec3(0);
}

/** Light scattered toward the eye by the haze along the segment `from` → `to` (halos around strong sources). */
export function spillInScatter(from: N, to: N, density: N): N {
  void from;
  void to;
  void density;
  return vec3(0);
}

/** Specular glints of the sources on a glossy surface (water): view vector V (surface → eye), normal n. */
export function spillGlint(p: N, V: N, n: N, roughness: N): N {
  void p;
  void V;
  void n;
  void roughness;
  return vec3(0);
}
