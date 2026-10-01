import { tsl, type TslNode } from '../materials/tsl.ts';

/**
 * Far canopy shell (S4 W2-C fills this in): beyond ~30 km the forests are drawn by the terrain shader
 * as a canopy surface whose colour comes from the placed vegetation records, while the canopy-patch
 * instances retire across the same distance band.
 *
 * W0 contract: the terrain material calls `canopyShell(p, footprintKm, forest)` in its forest-floor
 * block and mixes `albedo` in by `weight` and adds `dn` to its normal. Until W2-C lands the weight is 0,
 * so the hook changes nothing.
 */

type N = TslNode;
const { float, vec3 } = tsl;

export interface CanopyShellSample {
  /** 0..1 how much of the ground is replaced by canopy */
  weight: N;
  /** canopy albedo (linear RGB) */
  albedo: N;
  /** world-space normal perturbation of the canopy surface */
  dn: N;
}

/** `p` world position, `footprintKm` texel footprint (km per pixel), `forest` 0..1 forest cover mask. */
export function canopyShell(p: N, footprintKm: N, forest: N): CanopyShellSample {
  void p;
  void footprintKm;
  void forest;
  return { weight: float(0), albedo: vec3(0), dn: vec3(0) };
}
