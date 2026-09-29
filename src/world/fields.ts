import { hash32, rand, valueNoise } from '../core/rng.ts';
import type { WorldSpec } from './WorldSpec.ts';

/**
 * The Shire / Bree-land field patchwork lattice in world XZ. Shared by hedgerow placement
 * (vegetation) and the terrain's field-colouring mask, so hedges always sit on field boundaries.
 * Vertices are jittered and domain-warped like an old patchwork; `vert(i, j)` is valid for any
 * integer i, j (edges use 0 ≤ i, j ≤ n + 1). Pure function of (spec, seed).
 */
export interface FieldGrid {
  /** lattice cells per side */
  n: number;
  /** nominal field size, km (miniature exaggeration) */
  size: number;
  vert(i: number, j: number): [number, number];
}

export function shireFieldGrid(spec: WorldSpec, seed: number): FieldGrid {
  const fs = 5.2;
  const ang = 0.38;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  // grid covering the Shire + Bree bounding box (ME-GIS km → world)
  const [bx0, bz0] = spec.kmToWorld(420, 1110);
  const [bx1, bz1] = spec.kmToWorld(640, 980);
  const cx = (bx0 + bx1) / 2;
  const cz = (bz0 + bz1) / 2;
  const half = Math.max(bx1 - bx0, bz1 - bz0) * 0.8;
  const n = Math.ceil((2 * half) / fs);
  const vert = (i: number, j: number): [number, number] => {
    const id = hash32(i, j, 202);
    const u = -half + (i + (rand(seed, id, 1) - 0.5) * 0.7) * fs;
    const v = -half + (j + (rand(seed, id, 2) - 0.5) * 0.7) * fs;
    const x = cx + u * ca - v * sa;
    const z = cz + u * sa + v * ca;
    // low-frequency domain warp: field boundaries curve and field sizes vary
    const wx = (valueNoise(x / 26, z / 26, seed + 41) - 0.5) * 9;
    const wz = (valueNoise(x / 26, z / 26, seed + 43) - 0.5) * 9;
    return [x + wx, z + wz];
  };
  return { n, size: fs, vert };
}
