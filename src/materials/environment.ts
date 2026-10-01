import { Color, Vector2, Vector3, Vector4 } from 'three/webgpu';
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
  /** intensity of the hemisphere (sky / ground) fill light — skyColor / groundColor × this = its radiance */
  hemiIntensity: uniform(1),
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
  // ---- added by atmosphere v2 (src/materials/atmosphere.ts) ----
  /** broad air layer over the diorama: density at sea level and falloff per world unit of height */
  airDensity: uniform(0.0012),
  airFalloff: uniform(0.016),
  /** relative extinction per channel (green = 1): distance shifts towards the blue-grey in-scatter */
  extinction: uniform(new Vector3(0.8, 1, 1.22)),
  /**
   * Distance ramp of the aerial perspective (km from the camera): the air layers fade in from
   * x (clear near field) to y (full haze); the regional excess (Mordor's fumes, elven luminous
   * haze, marsh damp) — local features rather than a distance cue — fades in from z to w.
   * S4: written every frame by the EnvironmentSystem (focus-blended looks.json atmo.ramp, its
   * distances scaled with the shot's focus distance).
   */
  hazeRamp: uniform(new Vector4(35, 700, 2, 30)),
  /**
   * S4: gain on the distance-ramped air of the aerial perspective ("film air"): 1 for regional and
   * whole-table views (focus ≥ 320 km), up to 2.5 for mid shots (≤ 60 km), so the land beyond the
   * subject veils in layered haze while the regional views stay clear (no milky veil).
   */
  hazeGain: uniform(1),
  /** multiplier on the sky dome from the region the camera looks at (Mordor's charcoal sky) */
  skyTint: uniform(new Color(1, 1, 1)),
  /** cloud shadows: 0..1 darkening of the key light under a cloud, height of the cloud deck */
  cloudShadow: uniform(0.5),
  cloudHeight: uniform(58),
  // ---- added by S4 W1-A (sky / ash deck / clouds; written by the EnvironmentSystem) ----
  /** 0..1 overcast of the dome: the focus's ash-deck cover while the camera is under the deck */
  deck: uniform(0),
  /** the focus-blended deck tone (linear, albedo-like; for systems that merge into the pall, e.g. plumes) */
  deckTone: uniform(new Color(0.25, 0.25, 0.25)),
  /** 0..1 key-light darkening under full deck cover (× atmo2.R per fragment) */
  deckShadow: uniform(0),
  /**
   * radiance of the overcast deck's underside seen from below (CPU mirror of the deck shader): the
   * dome's overcast colour and, × the regional chroma, the in-scatter of the haze under the deck
   */
  deckSky: uniform(new Color(0.1, 0.1, 0.1)),
  /** time-of-day gain on the deck's red underglow (stronger at dusk and night) */
  deckGlow: uniform(0),
  /** multiplier on the dome's horizon haze: the focus-blended regional in-scatter tint (atmo.tint) */
  horizonTint: uniform(new Color(1, 1, 1)),
  /** 0..1 opacity gate of the visible cumulus layer (regional shots; overviews stay a clean model) */
  cloudVis: uniform(0),
  /** the clear-sky hemisphere irradiance (colour × intensity) before the deck's overcast pull and fill (lights the decks and cumulus) */
  clearSkyColor: uniform(new Color(0.55, 0.7, 0.9)),
  /** S4 W2-D: the timeline's event channels (SceneState.events → materials/gates.ts EVENT_SLOT: x beacons, y morgul-beam, z/w spare) */
  events: uniform(new Vector4(0, 0, 0, 0)),
  // ---- added by S3 emission (src/emission) ----
  /** screen pixels per km at 1 km view depth: viewportHeight / (2·tan(fov/2)) — projected sizes in px */
  pxPerKm: uniform(1000),
  /** render-target height in pixels (the frame's viewport, not the canvas CSS size) */
  viewportH: uniform(720),
};

export type EnvUniforms = typeof env;
