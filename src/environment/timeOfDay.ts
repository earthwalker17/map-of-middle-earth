import { Color, MathUtils, Vector3 } from 'three/webgpu';

/** Latitude used for the sun path (Hobbiton ≈ Oxford's latitude per Letter 294). */
export const LATITUDE_DEG = 50;

/** Direction TO the sun in world space (X east, Y up, −Z north) for time of day + day of year. */
export function sunDirection(tod: number, dayOfYear: number, out = new Vector3(), latDeg = LATITUDE_DEG): Vector3 {
  const lat = MathUtils.degToRad(latDeg);
  const decl = MathUtils.degToRad(23.44 * Math.sin((2 * Math.PI * (dayOfYear - 81)) / 365));
  const H = MathUtils.degToRad((tod - 12) * 15);
  const east = -Math.cos(decl) * Math.sin(H);
  const north = Math.cos(lat) * Math.sin(decl) - Math.sin(lat) * Math.cos(decl) * Math.cos(H);
  const up = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  return out.set(east, up, -north).normalize();
}

/** Moon: roughly opposite the sun with a phase-dependent offset (full moon ≈ opposite). */
export function moonDirection(tod: number, dayOfYear: number, phase: number, out = new Vector3()): Vector3 {
  // phase 0 = new, 0.5 = full; the moon lags the sun by phase * 24h
  return sunDirection((tod - phase * 24 + 48) % 24, dayOfYear, out);
}

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

export interface Daylight {
  sunElevationDeg: number;
  sunColor: Color;
  sunIntensity: number;
  night: number;
  golden: number;
  skyColor: Color;
  groundColor: Color;
  hemiIntensity: number;
  fogColor: Color;
}

/** Smooth, continuous daylight model — every quantity is a function of sun elevation. */
export function daylight(sunDir: Vector3): Daylight {
  const el = MathUtils.radToDeg(Math.asin(MathUtils.clamp(sunDir.y, -1, 1)));
  const kelvin = MathUtils.lerp(1900, 5600, smooth(-1, 35, el));
  const sunColor = kelvinToLinear(kelvin);
  const sunIntensity = 3.4 * smooth(-3, 6, el);
  const night = 1 - smooth(-14, 1, el);
  const golden = smooth(-2, 4, el) * (1 - smooth(9, 24, el));
  const daySky = new Color(0.36, 0.52, 0.8);
  const duskSky = new Color(0.48, 0.38, 0.42);
  const nightSky = new Color(0.02, 0.035, 0.07);
  const skyColor = nightSky.clone().lerp(duskSky, smooth(-14, -2, el)).lerp(daySky, smooth(-1, 16, el));
  const groundColor = new Color(0.22, 0.2, 0.15).multiplyScalar(0.25 + 0.75 * smooth(-6, 20, el));
  const hemiIntensity = 0.05 + 0.5 * smooth(-12, 18, el);
  const fogDay = new Color(0.66, 0.74, 0.84);
  const fogDusk = new Color(0.74, 0.55, 0.45);
  const fogNight = new Color(0.03, 0.045, 0.08);
  const fogColor = fogNight.clone().lerp(fogDusk, smooth(-12, -1, el)).lerp(fogDay, smooth(2, 20, el));
  return { sunElevationDeg: el, sunColor, sunIntensity, night, golden, skyColor, groundColor, hemiIntensity, fogColor };
}
