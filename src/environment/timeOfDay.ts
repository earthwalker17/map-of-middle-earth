import { Color, MathUtils, Vector3 } from 'three/webgpu';

/** Latitude used for the sun path (Hobbiton ≈ Oxford's latitude per Letter 294). */
export const LATITUDE_DEG = 50;

const D2R = Math.PI / 180;
/** obliquity of the ecliptic */
const OBLIQUITY = 23.44 * D2R;
const SYNODIC_DAYS = 29.530588;
/**
 * Day-of-year of a new moon. Chosen so the default day (200) shows a bright waxing gibbous moon
 * (phase ≈ 0.42) that rides low in the southern summer night sky — long, cinematic moon shadows.
 */
const NEW_MOON_DAY = 187.6;

/** Ecliptic longitude of the sun (radians), 0 at the March equinox (≈ day 81). */
function sunLongitude(dayOfYear: number): number {
  return (2 * Math.PI * (dayOfYear - 81)) / 365;
}

/** Direction to a body with hour angle H and declination decl (radians) — X east, Y up, −Z north. */
function directionFrom(H: number, decl: number, out: Vector3, latDeg = LATITUDE_DEG): Vector3 {
  const lat = latDeg * D2R;
  const east = -Math.cos(decl) * Math.sin(H);
  const north = Math.cos(lat) * Math.sin(decl) - Math.sin(lat) * Math.cos(decl) * Math.cos(H);
  const up = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  return out.set(east, up, -north).normalize();
}

/** Direction TO the sun in world space (X east, Y up, −Z north) for time of day + day of year. */
export function sunDirection(tod: number, dayOfYear: number, out = new Vector3(), latDeg = LATITUDE_DEG): Vector3 {
  const decl = Math.asin(Math.sin(OBLIQUITY) * Math.sin(sunLongitude(dayOfYear)));
  return directionFrom((tod - 12) * 15 * D2R, decl, out, latDeg);
}

/** Moon phase in [0, 1): 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter. */
export function moonPhase(dayOfYear: number, tod = 0): number {
  const p = (dayOfYear + tod / 24 - NEW_MOON_DAY) / SYNODIC_DAYS;
  return p - Math.floor(p);
}

/** Illuminated fraction of the lunar disc for a phase. */
export function moonIllumination(phase: number): number {
  return 0.5 * (1 - Math.cos(2 * Math.PI * phase));
}

/**
 * Direction TO the moon. The moon trails the sun by `phase` of a day in hour angle and sits
 * `phase` of a turn further along the ecliptic (so a summer full moon rides low, like the real one).
 */
export function moonDirection(tod: number, dayOfYear: number, phase: number, out = new Vector3()): Vector3 {
  const decl = Math.asin(Math.sin(OBLIQUITY) * Math.sin(sunLongitude(dayOfYear) + phase * 2 * Math.PI));
  return directionFrom((tod - 12 - phase * 24) * 15 * D2R, decl, out);
}

/**
 * Sidereal rotation angle of the star field (radians) about the celestial pole. One turn per
 * sidereal day; the day-of-year term shifts the constellations through the seasons.
 */
export function siderealAngle(tod: number, dayOfYear: number): number {
  return 2 * Math.PI * (tod / 24 + dayOfYear / 365.2422) * 1.0027379;
}

/** Unit vector towards the north celestial pole. */
export function celestialPole(out = new Vector3(), latDeg = LATITUDE_DEG): Vector3 {
  return out.set(0, Math.sin(latDeg * D2R), -Math.cos(latDeg * D2R));
}

/**
 * Hemisphere fill lift at full night (S4; see daylight): 0.9 (the brief's value) crushed moon
 * shadows to pure black (2.9 % / 3.5 % black pixels in env-night-moon / env-moonpath); 1.3 keeps a
 * blue-grey shadow floor while the doubled moon key still reads ≥ 3 : 1.
 */
const HEMI_NIGHT_LIFT = 1.3;
/**
 * S4 W4-S2: moonlit cast shadows keep this share of the moon key (the key shadow's intensity is
 * 1 − NIGHT_SHADOW_FLOOR · night; EnvironmentSystem) — the moon is a broad, sky-scattered source, and the
 * ranges' long night shadows printed as black holes in the overview; with the hemisphere fill a shadowed
 * face reads at ≈ 30 % of a lit one
 */
export const NIGHT_SHADOW_FLOOR = 0.28;
/** moon key light at full moon, high in a dark sky (S4: 0.85 → 1.8, a readable moonlit key) */
const MOON_KEY = 1.8;

const smooth = (e0: number, e1: number, x: number) => {
  const t = MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Approximate blackbody colour (Kelvin → linear RGB), Tanner Helland fit. */
export function kelvinToLinear(k: number, out = new Color()): Color {
  const t = k / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  out.setRGB(MathUtils.clamp(r, 0, 255) / 255, MathUtils.clamp(g, 0, 255) / 255, MathUtils.clamp(b, 0, 255) / 255);
  return out.convertSRGBToLinear();
}

// ------------------------------------------------------------------ keyframe curves over sun elevation

type Rgb = [number, number, number];

/** Piecewise-linear scalar curve over sun elevation (keys sorted by elevation). */
function curve(el: number, keys: [number, number][]): number {
  if (el <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (el <= keys[i][0]) {
      const [e0, v0] = keys[i - 1];
      const [e1, v1] = keys[i];
      return MathUtils.lerp(v0, v1, (el - e0) / (e1 - e0));
    }
  }
  return keys[keys.length - 1][1];
}

/**
 * Colour curve over sun elevation, interpolated per channel in log space — twilight light falls
 * off roughly exponentially with the sun's depression, so log-lerp keeps the fades even.
 */
function curveRgb(el: number, keys: [number, Rgb][], out = new Color()): Color {
  const lg = (v: number) => Math.log(Math.max(v, 1e-6));
  let a = keys[0];
  let b = keys[0];
  let t = 0;
  if (el > keys[0][0]) {
    a = keys[keys.length - 1];
    b = a;
    for (let i = 1; i < keys.length; i++) {
      if (el <= keys[i][0]) {
        a = keys[i - 1];
        b = keys[i];
        t = (el - a[0]) / (b[0] - a[0]);
        break;
      }
    }
  }
  const ch = (k: 0 | 1 | 2) => {
    const va = a[1][k];
    const vb = b[1][k];
    if (va <= 1e-6 || vb <= 1e-6) return MathUtils.lerp(va, vb, t);
    return Math.exp(MathUtils.lerp(lg(va), lg(vb), t));
  };
  return out.setRGB(ch(0), ch(1), ch(2));
}

/** sun colour temperature (K) */
const KELVIN: [number, number][] = [
  [-2, 1800], [0, 1950], [2, 2250], [5, 2600], [10, 3100], [15, 3500], [20, 3900], [35, 4900], [60, 5500], [90, 5800],
];
/** sun key illuminance (includes a gentle exposure compensation at low sun) */
const SUN_I: [number, number][] = [
  [-2.5, 0], [0, 0.55], [2, 1.9], [5, 3.1], [10, 3.7], [20, 3.7], [40, 3.5], [90, 3.4],
];
/**
 * Hemisphere sky irradiance (colour × intensity) — the shadow fill. About the S1 level (shadows
 * keep their depth: they are lifted by the warm ground bounce, not by a brighter sky), but less
 * saturated than S1's zenith blue — a clear sky's diffuse light includes the pale haze and horizon
 * (~10–12 kK), so shadows read cool slate, neither navy nor grey.
 */
const HEMI_SKY: [number, Rgb][] = [
  [-18, [0.013, 0.020, 0.044]],
  [-14, [0.020, 0.030, 0.064]],
  [-10, [0.033, 0.046, 0.097]],
  [-6, [0.065, 0.083, 0.178]],
  [-3, [0.145, 0.172, 0.340]],
  [0, [0.232, 0.276, 0.490]],
  [5, [0.320, 0.392, 0.610]],
  [12, [0.395, 0.468, 0.650]],
  [35, [0.455, 0.525, 0.680]],
  [90, [0.470, 0.535, 0.680]],
];
/** Preetham sky gain (the analytic model's radiance is far above our exposure range) */
const SKY_GAIN: [number, number][] = [
  [-3, 1.4], [0, 0.4], [3, 0.2], [8, 0.135], [20, 0.115], [90, 0.1],
];
/** twilight / night parametric sky layer */
const TWI_ZENITH: [number, Rgb][] = [
  [-18, [0.0014, 0.0024, 0.0070]],
  [-12, [0.0028, 0.0055, 0.0170]],
  [-9, [0.0055, 0.0115, 0.0360]],
  [-6, [0.0120, 0.0250, 0.0760]],
  [-4, [0.0190, 0.0380, 0.1050]],
  [-2, [0.0230, 0.0420, 0.1150]],
  [0, [0.0180, 0.0320, 0.0850]],
  [3, [0.0060, 0.0100, 0.0250]],
  [8, [0, 0, 0]],
];
// S4 W4-S2: the night horizon band brighter and greyer (the night dome read as a flat navy wash) — ×1.7 at −18°
const TWI_HORIZON: [number, Rgb][] = [
  [-18, [0.0080, 0.0112, 0.0215]],
  [-12, [0.0105, 0.0142, 0.0300]],
  [-9, [0.0125, 0.0170, 0.0400]],
  [-6, [0.0260, 0.0320, 0.0720]],
  [-4, [0.0450, 0.0480, 0.0980]],
  [-2, [0.0680, 0.0650, 0.1150]],
  [0, [0.0800, 0.0700, 0.1000]],
  [3, [0.0300, 0.0260, 0.0350]],
  [8, [0, 0, 0]],
];
/** glow hugging the horizon under the sun (sunset / afterglow / dawn) */
const TWI_GLOW: [number, Rgb][] = [
  [-16, [0.0005, 0.0004, 0.0005]],
  [-12, [0.0080, 0.0050, 0.0055]],
  [-9, [0.0320, 0.0160, 0.0120]],
  [-6, [0.0950, 0.0400, 0.0200]],
  [-4, [0.1900, 0.0700, 0.0250]],
  [-2, [0.3300, 0.1150, 0.0300]],
  [0, [0.4500, 0.1600, 0.0350]],
  [2, [0.3000, 0.1200, 0.0300]],
  [6, [0.0700, 0.0350, 0.0100]],
  [12, [0, 0, 0]],
];
/** Belt of Venus: pink band above the Earth's shadow, opposite the sun */
const TWI_BELT: [number, Rgb][] = [
  [-9, [0, 0, 0]],
  [-6, [0.0150, 0.0110, 0.0180]],
  [-3, [0.0550, 0.0340, 0.0500]],
  [0, [0.0650, 0.0400, 0.0480]],
  [3, [0.0300, 0.0200, 0.0200]],
  [8, [0, 0, 0]],
];
/**
 * Floor of the studio void below the horizon (absolute, linear HDR). The void itself is a fraction
 * of the horizon haze (VOID_LEVEL); this floor keeps the night void a deep navy instead of black.
 * Display reference (AgX, exposure 0.9): HDR 0.008 → 7/255, 0.015 → 20, 0.03 → 41, 0.05 → 61.
 */
const VOID: [number, Rgb][] = [
  [-18, [0.00045, 0.0006, 0.0012]],
  [-12, [0.0007, 0.0009, 0.0017]],
  [-8, [0.0012, 0.0014, 0.0026]],
  [-4, [0.0022, 0.0022, 0.0036]],
  [0, [0.0036, 0.0030, 0.0038]],
  [5, [0.0042, 0.0037, 0.0044]],
  [15, [0.0036, 0.0042, 0.0056]],
  [90, [0.0034, 0.0042, 0.0058]],
];
/** studio void as a fraction of the horizon haze: a pale sweep by day, relatively lifted at night */
const VOID_LEVEL: [number, number][] = [
  [-18, 0.5], [-8, 0.36], [0, 0.22], [8, 0.16], [30, 0.14], [90, 0.14],
];

export interface Daylight {
  sunElevationDeg: number;
  sunColor: Color;
  sunIntensity: number;
  night: number;
  golden: number;
  /** 0..1 blue-hour amount (sun a few degrees below the horizon) */
  twilight: number;
  skyColor: Color;
  groundColor: Color;
  hemiIntensity: number;
  // sky model parameters
  skyGain: number;
  dayWeight: number;
  twiZenith: Color;
  twiHorizon: Color;
  twiGlow: Color;
  /** angular tightness of the glow around the sun's azimuth */
  glowPower: number;
  /** vertical extent of the glow (in sin(elevation)) */
  glowHeight: number;
  twiBelt: Color;
  voidColor: Color;
  /** studio void level relative to the horizon haze */
  voidLevel: number;
  stars: number;
  sunDisc: number;
  /** aerial perspective (see materials/atmosphere.ts): uniform studio air per world unit */
  fogDensity: number;
  /** thin ground haze: density at sea level, falloff per unit of height (scale height ~6 km) */
  fogHeightDensity: number;
  fogHeightFalloff: number;
  /** broad air layer over the diorama (scale height ~60 km): the regional distance cue */
  airDensity: number;
  airFalloff: number;
  /** 0..1 darkening of the key light under a cloud */
  cloudShadow: number;
  turbidity: number;
}

/** Smooth, continuous daylight model — every quantity is a function of sun elevation. */
export function daylight(sunDir: Vector3): Daylight {
  const el = MathUtils.radToDeg(Math.asin(MathUtils.clamp(sunDir.y, -1, 1)));
  const sunColor = kelvinToLinear(curve(el, KELVIN));
  const sunIntensity = curve(el, SUN_I);
  const night = 1 - smooth(-14, 1, el);
  const golden = smooth(-2, 4, el) * (1 - smooth(9, 24, el));
  const twilight = smooth(1, -3, el) * (1 - smooth(-9, -14, el));

  // The dark-side tables were calibrated against the S1 double-sRGB capture bug (darks lifted ~4×);
  // with the fixed single encode, lift the night regime back so moonlit terrain stays readable.
  // S4: the hemisphere fill gets a smaller lift (1 + 1.3·night, was 1 + 2·night, which flattened
  // the nights) — the moon key carries the moonlit read (key : fill ≥ 3 : 1, moon shadows, rims);
  // the dome's night sky keeps the full lift.
  const nightLift = 1 + 2 * night;
  const skyColor = curveRgb(el, HEMI_SKY).multiplyScalar(1 + HEMI_NIGHT_LIFT * night);
  // warm bounce off the land (dimmer than the sky; carries a little of the sun's colour)
  const skyLum = 0.2126 * skyColor.r + 0.7152 * skyColor.g + 0.0722 * skyColor.b;
  const bounce = sunIntensity * Math.max(0, Math.sin(el * D2R)) * 0.045;
  const groundColor = new Color(0.42, 0.34, 0.25)
    .multiplyScalar(skyLum * 0.55)
    .add(sunColor.clone().multiplyScalar(bounce));

  const skyGain = curve(el, SKY_GAIN);
  const dayWeight = smooth(-3, 1, el);
  const twiZenith = curveRgb(el, TWI_ZENITH).multiplyScalar(nightLift);
  const twiHorizon = curveRgb(el, TWI_HORIZON).multiplyScalar(nightLift);
  const twiGlow = curveRgb(el, TWI_GLOW);
  const twiBelt = curveRgb(el, TWI_BELT);
  const voidColor = curveRgb(el, VOID);
  const voidLevel = curve(el, VOID_LEVEL);
  const glowPower = curve(el, [[-12, 1.6], [-6, 2.2], [0, 3.2], [6, 5]]);
  const glowHeight = curve(el, [[-12, 0.07], [-6, 0.1], [0, 0.14], [6, 0.08]]);
  const stars = smooth(-5, -13, el);
  const sunDisc = curve(el, [[-1, 6], [2, 8], [6, 12], [12, 18], [25, 30], [90, 40]]);

  // haze: a touch denser at golden hour / dawn (evening and morning mist in the valleys), clearest
  // at noon and at night (moonlit air must not turn murky). Layer optical depth ≈ 0.08 over a wide
  // overview's steep rays, ≈ 0.1 to a regional target and ≈ 0.25 half a map away — before the
  // distance ramp (env.hazeRamp), which keeps the near field clear and a 150–300 km target at
  // ≈ 0.02–0.03 (see materials/atmosphere.ts).
  const fogHeightDensity = 0.0024 + 0.0016 * golden + 0.0007 * twilight;
  const fogHeightFalloff = 0.16;
  const airDensity = 0.00072 + 0.00025 * golden + 0.0001 * twilight;
  const airFalloff = 0.016;
  const fogDensity = 0.00001;
  const cloudShadow = 0.22 - 0.08 * night;
  const turbidity = 2.6 + 0.8 * golden;

  return {
    sunElevationDeg: el,
    sunColor,
    sunIntensity,
    night,
    golden,
    twilight,
    skyColor,
    groundColor,
    hemiIntensity: 1,
    skyGain,
    dayWeight,
    twiZenith,
    twiHorizon,
    twiGlow,
    glowPower,
    glowHeight,
    twiBelt,
    voidColor,
    voidLevel,
    stars,
    sunDisc,
    fogDensity,
    fogHeightDensity,
    fogHeightFalloff,
    airDensity,
    airFalloff,
    cloudShadow,
    turbidity,
  };
}

/** Moonlight contribution: key intensity (for the shadow-casting light) and sky brightening. */
export function moonlight(moonDir: Vector3, illum: number, sunElevationDeg: number): { key: number; sky: number; color: Color } {
  const el = MathUtils.radToDeg(Math.asin(MathUtils.clamp(moonDir.y, -1, 1)));
  const up = smooth(-1, 12, el);
  const dark = smooth(-4, -11, sunElevationDeg);
  const key = MOON_KEY * Math.pow(illum, 1.3) * up * dark;
  return { key, sky: Math.pow(illum, 1.5) * up * dark, color: new Color(0.6, 0.72, 1.0) };
}
