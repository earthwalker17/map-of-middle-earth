/**
 * Far canopy shell configuration (S4 W2-C), shared by placement (CPU, runs in Node for `pnpm check`), the
 * VegetationSystem (instance retirement) and canopyShell.ts (the terrain's shell). No three / TSL imports.
 */

/** Switch: off = no retirement, no shell (the S3 instanced forests everywhere). */
export const SHELL_ON = true;

/**
 * The hand-over band, in PIXELS of a canopy crown (≈ SHELL_CROWN_KM across): the canopy instances retire
 * while a crown shrinks from SHELL_NEAR_PX to SHELL_FAR_PX on screen, i.e. over the distances
 * SHELL_CROWN_KM · pxPerKm / px (720p, 35°: ≈ 76 … 137 km; 1080p: ≈ 114 … 205 km).
 *
 * (The brief's fixed 28–45 km band was built and rendered first, with the S3 canopy crowns of ≈ 1 km: at
 * those distances a crown still spans 25–40 px and the canopy stands ≈ 1 km above the ground — Mirkwood's
 * and Fangorn's edges lost their wall of trees and the shell read as a flat dark sheet / cobbles at grazing
 * angles. A band in screen pixels hands over only where the instances are a few-pixel speckle, and the
 * shell keeps that speckle (crown domes, per-crown tone).)
 */
export const SHELL_CROWN_KM = 0.6;
export const SHELL_NEAR_PX = 9;
export const SHELL_FAR_PX = 5;

/**
 * Per-tier band scale (× the band distances): the preview tier (the explorer on the iGPU) retires the
 * canopy instances earlier — the count drawn, never the size of a crown, changes.
 */
export function shellTierScale(tier: string): number {
  return tier === 'preview' ? 0.7 : 1;
}

/** the band (near, far km) for a view of `pxPerKm` screen pixels per km at 1 km distance, written to `out` */
export function shellBand(pxPerKm: number, tierScale: number, out: { near: number; far: number }): void {
  out.near = ((SHELL_CROWN_KM * pxPerKm) / SHELL_NEAR_PX) * tierScale;
  out.far = ((SHELL_CROWN_KM * pxPerKm) / SHELL_FAR_PX) * tierScale;
}

export const SHELL_W = 512;
export const SHELL_H = 307;
