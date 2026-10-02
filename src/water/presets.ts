import type { WaterParams } from './waterMaterial.ts';

/**
 * Parameter sets of the water family. Colours are linear albedos; absorption is per world unit of
 * optical path (the bathymetry is exaggerated with the relief, so these are tuned by eye against
 * the references, not physical coefficients).
 */

/** Open sea: clear turquoise over the shelf, deep blue-green offshore, wind ripples + swell. */
export const SEA: WaterParams = {
  kind: 'sea',
  // a deeper, more saturated blue than S1: the aerial perspective now lays a blue-grey veil over
  // the open sea, and the turquoise is kept to the true shallows (not the whole 1–4 unit shelf)
  deep: [0.0006, 0.011, 0.034],
  shallow: [0.004, 0.042, 0.044],
  scatterDepth: 2.2,
  absorb: [3.0, 1.2, 0.9],
  bedNear: [0.3, 0.28, 0.2],
  bedFar: [0.07, 0.085, 0.07],
  bedDepth: 0.8,
  waves: [
    { scale: 70, angle: 0, slope: 0.018, speed: 0.45, stretch: 1.6 },
    { scale: 19, angle: 27, slope: 0.02, speed: 0.26, stretch: 1.4 },
    { scale: 5.2, angle: -24, slope: 0.022, speed: 0.14, stretch: 1.3 },
    { scale: 1.5, angle: 13, slope: 0.024, speed: 0.075 },
    { scale: 0.42, angle: -38, slope: 0.026, speed: 0.04, heavy: true },
    { scale: 0.12, angle: 52, slope: 0.026, speed: 0.02, heavy: true },
  ],
  calmAlpha: 0.06,
  reflection: 0.85,
  foam: 0.9,
  foamWidth: 0.12,
  lap: 1,
  variation: 1,
  pullK: 0,
  pullMax: 0,
  traceSteps: 10,
  traceStart: 0.3,
  traceGrowth: 1.75,
};

/** Lakes: calmer, darker, peaty beds; strong mirror-like reflections. */
export const LAKE: WaterParams = {
  kind: 'lake',
  deep: [0.002, 0.005, 0.007],
  shallow: [0.006, 0.016, 0.016],
  scatterDepth: 0.8,
  absorb: [9.0, 5.0, 3.6],
  bedNear: [0.08, 0.075, 0.055],
  bedFar: [0.03, 0.035, 0.03],
  bedDepth: 0.6,
  waves: [
    { scale: 14, angle: 0, slope: 0.018, speed: 0.12, stretch: 1.4 },
    { scale: 3.6, angle: 31, slope: 0.022, speed: 0.07, stretch: 1.3 },
    { scale: 1.0, angle: -21, slope: 0.028, speed: 0.04 },
    { scale: 0.28, angle: 47, slope: 0.03, speed: 0.02, heavy: true },
    { scale: 0.08, angle: -12, slope: 0.03, speed: 0.01, heavy: true },
  ],
  calmAlpha: 0.05,
  reflection: 1.1,
  foam: 0.2,
  foamWidth: 0.05,
  lap: 0.4,
  variation: 0.7,
  pullK: 0.0012,
  pullMax: 1.2,
  traceSteps: 11,
  traceStart: 0.25,
  traceGrowth: 1.6,
};

/**
 * Rivers: flow-aligned ripples scrolling downstream, a teal body over a brown-green shallow band.
 * S4 W4-S1 (rivers read as matte 'concrete canals'): the chop that printed a hammered-metal texture at
 * 10–20 km (short crests across the flow, strong slopes → a broad grey sun sheen everywhere) became a
 * calmer surface of long flow-aligned slicks, so the sky and the banks mirror and the sun keeps a glint
 * path; the pale sand bed in the shallows (the pale lip inside the waterline) is a dark brown-green; far
 * water keeps a Fresnel floor (silver-blue threads at regional range); the ribbon edge fades over a few
 * pixels (no dark see-through outline); mirrored banks are a darker, cooler copy (a calm reach no longer
 * mirrors a lit hillside at its own albedo and reads as grass).
 */
export const RIVER: WaterParams = {
  kind: 'river',
  deep: [0.004, 0.012, 0.016],
  shallow: [0.012, 0.022, 0.014],
  scatterDepth: 0.25,
  absorb: [5.0, 2.6, 2.2],
  bedNear: [0.075, 0.072, 0.045],
  bedFar: [0.03, 0.034, 0.024],
  bedDepth: 0.2,
  waves: [
    { scale: 2.4, angle: 0, slope: 0.016, speed: 0.03, stretch: 2.2 },
    { scale: 0.7, angle: 8, slope: 0.022, speed: 0.02, stretch: 1.8 },
    { scale: 0.2, angle: -14, slope: 0.033, speed: 0.01, stretch: 1.3, heavy: true },
    { scale: 0.06, angle: 30, slope: 0.03, speed: 0.005, heavy: true },
  ],
  calmAlpha: 0.05,
  reflection: 1.0,
  foam: 0,
  foamWidth: 0.015,
  lap: 0,
  variation: 0.6,
  pullK: 0.003,
  pullMax: 2.5,
  flowSpeed: 0.12,
  traceSteps: 6,
  traceStart: 0.2,
  traceGrowth: 1.8,
  bedLightMax: 1.2,
  farSheen: 0.16,
  edgePx: 2.5,
  mirrorTint: [0.48, 0.56, 0.68],
};
