/**
 * Deterministic, stateless randomness.
 *
 * Every random value in the project is a pure function of (seed, id, k) — there is no
 * sequential generator whose output depends on call order. This keeps any frame renderable
 * in isolation (random access for capture/resume) and makes subsystems independent.
 */

/** 32-bit integer mix (lowbias32 by Chris Wellons). */
function mix32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** FNV-1a string hash → uint32. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hash any number of integers/floats into a uint32. Floats are quantised to 1e-6. */
export function hash32(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const v of values) {
    const iv = Number.isInteger(v) ? v | 0 : Math.round(v * 1e6) | 0;
    h = mix32(h ^ mix32(iv + 0x632be5ab));
  }
  return h;
}

/** Uniform float in [0, 1) from (seed, id, k). */
export function rand(seed: number, id: number | string, k = 0): number {
  const idn = typeof id === 'string' ? hashString(id) : id;
  return hash32(seed, idn, k) / 4294967296;
}

export function randRange(seed: number, id: number | string, k: number, min: number, max: number): number {
  return min + (max - min) * rand(seed, id, k);
}

/** Radical-inverse Halton sequence value (index >= 1) — used for sub-pixel jitter. */
export function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}
