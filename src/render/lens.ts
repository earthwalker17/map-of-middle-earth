import { halton } from '../core/rng.ts';
import type { SceneState } from '../core/types.ts';

/**
 * The lens model (S4): a very subtle, physically exact depth of field for the close heroes, made by
 * jittering the camera over the lens aperture inside the offline accumulation (Engine.renderAccumulated)
 * — no depth buffer, no gather blur, no tilt-shift. Every sub-sample moves the pinhole to a point of the
 * aperture disc (in the camera's right / up plane) and shifts the view window so the plane at the focus
 * distance projects to the same pixels; the running average of the sub-samples is the thin-lens image.
 *
 * The aperture scales with the focus distance (`A = K·F/N`, radius), so the blur is a property of the
 * frame (a fraction of its height), never of the world scale: the blur disc of a point at infinity is
 *   coc∞ = A / (F·tan(fov/2)) = K / (N·tan(fov/2))      (diameter, fraction of the frame height)
 * K puts coc∞ at COC_REF for f/5.6 behind a 20° lens; it is clamped at COC_CAP whatever the f-stop
 * (C1: "keep any depth of field very subtle — the bigatures were shot deep-focus").
 *
 * Pure function of (SceneState, sub-sample index, spp, frame height): deterministic, no history.
 */

/** f-number at and above which the lens is a pinhole: deep focus, the default of every shot. */
export const DEEP_FOCUS_FSTOP = 22;
/** fewer aperture samples would stipple the blur: below this spp the lens is a pinhole. */
export const LENS_MIN_SPP = 8;
/** blur disc at infinity (diameter, fraction of the frame height) at f/5.6 behind a 20° vertical fov */
const COC_REF = 0.004;
/**
 * Hard cap of the blur disc at infinity (fraction of the frame height): the brief allows 0.5 %, the C1
 * critics asked for ≤ 0.3 % — the cap is the stricter one (≈ 3 px at 1080p, 2 px at 720p).
 */
export const COC_CAP = 0.003;
/** K of A = K·F/N (aperture radius per focus distance, at N = 1) */
const K = COC_REF * 5.6 * Math.tan((10 * Math.PI) / 180);

/** Halton bases of the aperture samples (2 / 3 are the pixel jitter's). */
const BASE_U = 5;
const BASE_V = 7;

/** One aperture sub-sample: where the pinhole sits and how the view window shifts to keep focus. */
export interface LensSample {
  /** camera offset along its own right / up axes, world units */
  dx: number;
  dy: number;
  /** compensating view-window shift in pixels (added to setViewOffset's x / y) */
  px: number;
  py: number;
}

/** Blur disc of a point at infinity (diameter, fraction of the frame height) for an f-stop and vertical fov, capped. */
export function cocAtInfinity(fStop: number, fovDeg: number): number {
  if (!(fStop < DEEP_FOCUS_FSTOP)) return 0;
  const t = Math.tan((fovDeg * Math.PI) / 360);
  return Math.min(COC_CAP, K / (Math.max(0.5, fStop) * t));
}

/** Shirley–Chiu concentric map of [0,1)² onto the unit disc (area-preserving, low distortion). */
export function concentricDisc(u: number, v: number): [number, number] {
  const a = 2 * u - 1;
  const b = 2 * v - 1;
  if (a === 0 && b === 0) return [0, 0];
  let r: number;
  let th: number;
  if (Math.abs(a) > Math.abs(b)) {
    r = a;
    th = (Math.PI / 4) * (b / a);
  } else {
    r = b;
    th = Math.PI / 2 - (Math.PI / 4) * (a / b);
  }
  return [r * Math.cos(th), r * Math.sin(th)];
}

/** Focus distance of a state: the lens' own, else the camera's target distance (world units). */
export function focusDistance(state: SceneState): number {
  if (state.lens.focusDistance !== undefined && state.lens.focusDistance > 0) return state.lens.focusDistance;
  const [px, py, pz] = state.camera.position;
  const [tx, ty, tz] = state.camera.target;
  return Math.hypot(tx - px, ty - py, tz - pz);
}

/** Is the lens active for this state at this sample count? (f-stop below deep focus, enough samples) */
export function lensActive(state: SceneState, spp: number): boolean {
  return spp >= LENS_MIN_SPP && state.lens.fStop < DEEP_FOCUS_FSTOP && focusDistance(state) > 0;
}

/**
 * The aperture sub-sample `i` of `spp` for a state, or null for a pinhole (deep focus, too few samples).
 * `heightPx` is the frame height in pixels (the view offset's unit). `lensSpp` is the sample count the
 * on / off decision uses (S5 adaptive film sampling passes the run's base spp, so the extra time samples of
 * a fast frame never switch the depth of field on for that frame alone); it defaults to `spp`.
 */
export function lensSample(state: SceneState, i: number, spp: number, heightPx: number, lensSpp = spp): LensSample | null {
  if (!lensActive(state, lensSpp)) return null;
  const F = focusDistance(state);
  const fov = state.camera.fov;
  const t = Math.tan((fov * Math.PI) / 360);
  // aperture radius: coc∞ · F · tan(fov/2) (the cap applied through cocAtInfinity)
  const A = cocAtInfinity(state.lens.fStop, fov) * F * t;
  const [ux, uy] = concentricDisc(halton(i + 1, BASE_U), halton(i + 1, BASE_V));
  const dx = A * ux;
  const dy = A * uy;
  // as the pinhole moves by d (right / up), a point on the focus plane moves by −d/F in the view (tan
  // units): the view window follows it by −d/F, so the focus plane stays put and a point at infinity
  // (which does not move) lands d/F away — the blur. setViewOffset x runs right, y runs down; pixels per
  // tan unit = heightPx / (2·tan(fov/2)).
  const pxPerTan = heightPx / (2 * t);
  return { dx, dy, px: -(dx / F) * pxPerTan, py: (dy / F) * pxPerTan };
}
