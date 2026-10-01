import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2 } from '../records.ts';
import { brokenTop, elevation } from './elev.ts';

/**
 * Osgiliath's stone: a warm pale limestone (the film's ruins read pale and dusty in the haze), a few
 * tones, and a darker weathered tone for the bridge, rubble and the dirt-stained lower courses.
 */
export const STONE = [0xb7ac97, 0xc1b7a2, 0xaca28d, 0xc6bca8, 0xb2a690];
export const STONE_DARK = 0x8f8574;

const DEG = Math.PI / 180;

/** local point `(u, v)` of a frame at `at` turned by `yaw` degrees (kit convention: +yaw turns x towards −z) */
export function frame(at: V2, yaw: number): (u: number, v: number) => V2 {
  const c = Math.cos(yaw * DEG);
  const s = Math.sin(yaw * DEG);
  return (u, v) => [at[0] + u * c + v * s, at[1] - u * s + v * c];
}

/** the lowest ground (local y) along a → b, sampled every ~0.1 km, sunk 0.03 */
function lowGround(k: ProxyKit, a: V2, b: V2): number {
  const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1));
  let g = Infinity;
  for (let i = 0; i <= n; i++) g = Math.min(g, k.ground(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n));
  return g - 0.03;
}

/**
 * A broken wall a → b: one slab of masonry `t` thick, its top a fractured, irregular line between `lo`·h
 * and h above the lowest ground under it (seeded per wall — never a regular comb), the foot following
 * the ground; `arches` round-headed openings (window or door arcades), some broken open into the top.
 */
export function brokenWall(k: ProxyKit, a: V2, b: V2, h: number, t: number, lo: number, seed: number, color: number, arches = 0, lod?: 0 | 1 | 2): void {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 0.03) return;
  const base = lowGround(k, a, b);
  const r = (i: number) => k.r(seed * 1000 + i);
  // the foot follows the ground: a few samples along the wall (sunk 0.03)
  const foot: [number, number][] = [];
  const nf = Math.max(2, Math.ceil(L / 0.15));
  for (let i = 0; i <= nf; i++) {
    const u = (L * i) / nf;
    foot.push([u, k.ground(a[0] + ((b[0] - a[0]) * u) / L, a[1] + ((b[1] - a[1]) * u) / L) - 0.03]);
  }
  // the foot's height at u (piecewise linear between the samples)
  const footAt = (u: number): number => {
    const i = Math.min(nf - 1, Math.max(0, Math.floor((u / L) * nf)));
    const f = (u - foot[i][0]) / Math.max(1e-9, foot[i + 1][0] - foot[i][0]);
    return foot[i][1] + (foot[i + 1][1] - foot[i][1]) * Math.min(1, Math.max(0, f));
  };
  // the broken top never drops below the foot on rising ground (a simple outline)
  const top = brokenTop(L, h, base, lo, r).map(([u, y]): V2 => [u, Math.max(y, footAt(u) + 0.05)]);
  const outline: V2[] = [...foot, ...top];
  const holes: V2[][] = [];
  if (arches > 0) {
    const bay = L / arches;
    const w = bay * 0.56;
    for (let j = 0; j < arches; j++) {
      const uc = (j + 0.5) * bay;
      const y0 = Math.max(base + 0.03 + h * 0.08, footAt(uc - w / 2) + 0.025, footAt(uc + w / 2) + 0.025);
      const spring = base + h * (0.5 + 0.08 * r(200 + j));
      // the opening must stay under the broken top (else it is part of the break): check the top there
      const topAt = Math.min(...top.filter(([u]) => Math.abs(u - uc) < w).map(([, y]) => y), Infinity);
      if (spring + w / 2 + 0.03 > topAt) continue;
      const hole: V2[] = [
        [uc - w / 2, y0],
        [uc + w / 2, y0],
      ];
      for (let q = 0; q <= 4; q++) {
        const ang = (q / 4) * Math.PI;
        hole.push([uc + (Math.cos(ang) * w) / 2, spring + (Math.sin(ang) * w) / 2]);
      }
      holes.push(hole);
    }
  }
  elevation(k, 'weathered', a, b, outline, t, { color, shade: 0.88 + 0.22 * r(300), holes, lod });
}

/**
 * A roofless hall `w` × `d`, up to `h` tall: broken walls on three sides (one may be gone), the long
 * front (+v) an arcade of round-headed bays; seeded damage.
 */
export function ruinHall(k: ProxyKit, at: V2, yaw: number, w: number, d: number, h: number, seed: number, color: number): void {
  const P = frame(at, yaw);
  const t = Math.max(0.03, Math.min(w, d) * 0.09);
  const c0 = P(-w / 2, -d / 2);
  const c1 = P(w / 2, -d / 2);
  const c2 = P(w / 2, d / 2);
  const c3 = P(-w / 2, d / 2);
  const gone = Math.floor(k.r(seed + 1) * 5); // 0..2: that side has fallen; 3, 4: all stand
  brokenWall(k, c0, c1, h, t, 0.3, seed + 2, color, w > 0.42 ? 2 : 0, 0);
  if (gone !== 1) brokenWall(k, c1, c2, h * 0.9, t, 0.25, seed + 3, color, 0, 0);
  if (gone !== 2) brokenWall(k, c3, c0, h * 0.9, t, 0.25, seed + 4, color, 0, 0);
  brokenWall(k, c3, c2, h, t * 1.15, 0.35, seed + 5, color, Math.max(2, Math.round(w / 0.15)), 0);
}

/** A ruined corner: two broken walls meeting at `at` (an L), one with a window arcade. */
export function ruinCorner(k: ProxyKit, at: V2, yaw: number, a: number, b: number, h: number, seed: number, color: number): void {
  const P = frame(at, yaw);
  const t = 0.032;
  brokenWall(k, P(0, 0), P(a, 0), h, t, 0.2, seed + 1, color, a > 0.3 ? 2 : 0, 0);
  brokenWall(k, P(0, 0), P(0, b), h * 0.85, t, 0.2, seed + 2, color, 0, 0);
}

/**
 * A broken tower: a faceted shaft, its top snapped off — jagged stumps of wall rising from the break at
 * uneven heights on one side.
 */
export function brokenTower(k: ProxyKit, at: V2, r: number, h: number, sides: number, color: number, lod?: 0 | 1 | 2): void {
  k.tower('weathered', r, h, { at: [at[0], 0, at[1]], seat: true, sides, taper: 0.06, roof: 'none', color, lod });
  const a0 = k.r(700) * 360;
  // stumps on the break (the kit seats the shaft on the lowest ground under its rim and centre, sunk 0.02)
  const base = Math.min(...Array.from({ length: 8 }, (_, j) => k.ground(at[0] + Math.cos((j / 8) * Math.PI * 2) * r, at[1] + Math.sin((j / 8) * Math.PI * 2) * r)), k.ground(at[0], at[1])) - 0.02;
  for (let j = 0; j < 2; j++) {
    const a = (a0 + j * 50) * DEG;
    const rr = r * 0.94;
    const sh = h * (0.12 + 0.16 * k.r(710 + j));
    k.box('weathered', r * 0.6, sh, r * 0.2, { at: [at[0] + Math.cos(a) * rr, base + h * 0.94 - 0.005, at[1] + Math.sin(a) * rr], rot: [0, -a / DEG + 90, 0], color, lod: 0 });
  }
}

/**
 * A broken dome: a drum of `r` and `drumH` with a cornice, and the dome over it half fallen in (a partial
 * arc of the shell, open on one side).
 */
export function brokenDome(k: ProxyKit, at: V2, r: number, drumH: number, arcDeg: number, color: number, seg = 12): void {
  const base = Math.min(...Array.from({ length: 8 }, (_, j) => k.ground(at[0] + Math.cos((j / 8) * Math.PI * 2) * r, at[1] + Math.sin((j / 8) * Math.PI * 2) * r)), k.ground(at[0], at[1])) - 0.02;
  k.lathe(
    'weathered',
    [
      [r, 0],
      [r, drumH],
      [r * 1.06, drumH],
      [r * 1.06, drumH + r * 0.08],
      [r * 0.97, drumH + r * 0.08],
    ],
    { at: [at[0], base, at[1]], seg, color, seat: false },
  );
  // the shell: up the outside, back down the inside (a thick broken shell), over a partial arc — the
  // fallen side shows the dark interior
  const n = 4;
  const y0 = drumH + r * 0.08;
  const outer: V2[] = [];
  const inner: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2) * 0.9;
    outer.push([Math.cos(a) * r * 0.97, y0 + Math.sin(a) * r * 0.9]);
    inner.push([Math.cos(a) * r * 0.87, y0 + Math.sin(a) * r * 0.8]);
  }
  k.lathe('weathered', [...outer, ...inner.reverse(), outer[0]], { at: [at[0], base, at[1]], seg: Math.max(8, seg - 2), arcDeg, rot: [0, k.r(720) * 360, 0], color, shade: 1.06 });
}

/**
 * A multi-arched stone bridge along +x at `z`, deck top at `yDeck`: `n` spans between `x0` and `x1`,
 * each a round arch (a half annulus under the deck) springing from piers that stand on the river bed;
 * spans listed in `fallen` have lost deck and arch (the stubs of their arches stay on the piers).
 */
export function archBridge(k: ProxyKit, x0: number, x1: number, z: number, yDeck: number, n: number, fallen: number[], color: number): void {
  const L = (x1 - x0) / n;
  const width = 0.2;
  const pier = 0.1;
  const deck = 0.06;
  const rOut = L / 2 - pier / 2;
  const rIn = rOut - 0.05;
  const spring = yDeck - deck - rOut;
  const arch = (cx: number, arcDeg: number, rotY: number) =>
    k.lathe(
      'weathered',
      [
        [rIn, 0],
        [rOut, 0],
        [rOut, width],
        [rIn, width],
        [rIn, 0],
      ],
      // a half annulus in the x–y plane (lathe axis → −z): the kit's Euler XYZ applies the y turn first
      // (about the lathe axis: arc angle a → a − rotY), then x −90 turns (cos b, 0, sin b) into (cos b, sin b, 0)
      { at: [cx, spring, z + width / 2], rot: [-90, rotY, 0], seg: Math.max(3, Math.round((10 * arcDeg) / 180)), arcDeg, color, shade: 1.05 },
    );
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * L;
    const g = Math.min(k.ground(x - pier / 2, z), k.ground(x + pier / 2, z), k.ground(x, z - width / 2), k.ground(x, z + width / 2));
    // piers up to the deck where a span on either side stands, else to the spring line (a stump)
    const whole = !fallen.includes(i - 1) || !fallen.includes(i);
    const top = whole ? yDeck - deck : spring + 0.08;
    k.box('weathered', pier, top - g + 0.02, width * 1.08, { at: [x, g - 0.02, z], color, shade: 0.92 });
  }
  for (let i = 0; i < n; i++) {
    const cx = x0 + (i + 0.5) * L;
    if (fallen.includes(i)) {
      // the broken stubs of the arch on the piers either side
      // (the arch springs at angle 0 on the +x pier and at 180° on the −x pier)
      if (!fallen.includes(i + 1) || i === n - 1) arch(cx, 38, 0);
      if (!fallen.includes(i - 1) || i === 0) arch(cx, 38, -142);
      continue;
    }
    arch(cx, 180, 0);
    k.box('weathered', L, deck, width, { at: [cx, yDeck - deck, z], color });
  }
}
