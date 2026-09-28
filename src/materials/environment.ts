import { Color, Vector2, Vector3 } from 'three/webgpu';
import { uniform } from 'three/tsl';

/**
 * EnvironmentState — the shared TSL uniforms every material family and system reads.
 * Written only by the EnvironmentSystem (from SceneState: tod, tFx, camera), read everywhere.
 * These replace TSL's wall-clock `time`: use `env.tFx` for anything animated.
 */
export const env = {
  /** timeline seconds */
  t: uniform(0),
  /** effect-time seconds (motion-scaled) — the ONLY clock animated shaders may use */
  tFx: uniform(0),
  /** time of day, hours */
  tod: uniform(12),
  /** direction TO the sun (world, normalised) */
  sunDir: uniform(new Vector3(0.3, 0.8, 0.5)),
  sunColor: uniform(new Color(1, 0.95, 0.88)),
  sunIntensity: uniform(3),
  /** direction TO the moon (moonColor × moonIntensity = moonlight on the key light at night) */
  moonDir: uniform(new Vector3(-0.3, 0.6, -0.5)),
  moonColor: uniform(new Color(0.6, 0.7, 0.9)),
  moonIntensity: uniform(0),
  /** 0 = full day … 1 = deep night (smooth, derived from sun elevation) */
  night: uniform(0),
  /** 0..1 golden-hour amount (low sun, above horizon) */
  golden: uniform(0),
  skyColor: uniform(new Color(0.55, 0.7, 0.9)),
  groundColor: uniform(new Color(0.3, 0.28, 0.22)),
  fogColor: uniform(new Color(0.72, 0.78, 0.84)),
  /** exponential distance fog density per world unit */
  fogDensity: uniform(0.00002),
  /** height fog: density at sea level and falloff per world unit of height */
  fogHeightDensity: uniform(0.0025),
  fogHeightFalloff: uniform(0.2),
  wind: uniform(new Vector2(0.8, 0.3)),
  cloudCoverage: uniform(0.35),
  cameraPos: uniform(new Vector3()),
  // ---- added by environment v1 ----
  /** moon phase 0..1 (0 new, 0.5 full) and lit fraction of the disc */
  moonPhase: uniform(0.42),
  moonIllum: uniform(0.8),
  /** 0..1 blue-hour amount (sun a few degrees below the horizon) */
  twilight: uniform(0),
  /** the active shadow-casting key light (sun by day, moon by night): direction TO it, colour, intensity */
  keyDir: uniform(new Vector3(0.3, 0.8, 0.5)),
  keyColor: uniform(new Color(1, 0.95, 0.88)),
  keyIntensity: uniform(3),
  /** average sky colour at the horizon (the haze colour distant things fade to) */
  horizonColor: uniform(new Color(0.62, 0.68, 0.78)),
  /** colour of the atmospheric void below the horizon around the floating slab */
  voidColor: uniform(new Color(0.02, 0.025, 0.035)),
};

export type EnvUniforms = typeof env;
