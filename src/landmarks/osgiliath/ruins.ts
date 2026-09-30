import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2 } from '../records.ts';

/** the film's lit stone #646e6c, painted lighter (the dawn haze and the grade take it down) */
export const STONE = [0x8e9894, 0x959f9b, 0x87918d, 0x9aa39e];
export const STONE_DARK = 0x6f7875;

const DEG = Math.PI / 180;

/** local point `(u, v)` of a frame at `at` turned by `yaw` degrees (kit convention: +yaw turns x towards −z) */
export function frame(at: V2, yaw: number): (u: number, v: number) => V2 {
  const c = Math.cos(yaw * DEG);
  const s = Math.sin(yaw * DEG);
  return (u, v) => [at[0] + u * c + v * s, at[1] - u * s + v * c];
}

/**
 * A roofless hall: four walls of broken masonry — each side a run of wall panels of uneven, jagged height
 * with gaps where it has fallen — `w` × `d`, up to `h` tall; the long side facing the river (+v) an
 * arcade of round-arched bays with some arches missing. `seed` picks the damage.
 */
export function ruinHall(k: ProxyKit, at: V2, yaw: number, w: number, d: number, h: number, seed: number, color: number): void {
  const P = frame(at, yaw);
  const t = Math.max(0.025, Math.min(w, d) * 0.08);
  const side = (a: V2, b: V2, n: number, s0: number) => {
    for (let i = 0; i < n; i++) {
      const r = k.r(s0 + i);
      if (r < 0.2) continue; // fallen
      const f0 = i / n;
      const f1 = (i + 1) / n;
      const pa: V2 = [a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0];
      const pb: V2 = [a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1];
      const hh = h * (0.3 + 0.7 * r);
      const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      const wy = (-Math.atan2(pb[1] - pa[1], pb[0] - pa[0]) * 180) / Math.PI;
      k.box('weathered', len * 1.02, hh, t, { at: [(pa[0] + pb[0]) / 2, 0, (pa[1] + pb[1]) / 2], rot: [0, wy, 0], seat: true, color, shade: 0.9 + 0.2 * k.r(s0 + 50 + i), lod: 0 });
    }
  };
  const c0 = P(-w / 2, -d / 2);
  const c1 = P(w / 2, -d / 2);
  const c2 = P(w / 2, d / 2);
  const c3 = P(-w / 2, d / 2);
  const nw = Math.max(2, Math.round(w / 0.14));
  const nd = Math.max(2, Math.round(d / 0.14));
  side(c0, c1, nw, seed);
  side(c1, c2, nd, seed + 20);
  side(c3, c0, nd, seed + 40);
  // the front: an arcade with fallen arches
  const missing = [Math.floor(k.r(seed + 60) * 5), 3 + Math.floor(k.r(seed + 61) * 3)];
  k.arcade('weathered', c3, c2, { count: Math.max(3, Math.round(w / 0.12)), h: h * 0.85, archH: h * 0.6, pier: 0.035, depth: t * 1.2, missing, color, lod: 0 });
}

/**
 * A broken tower: a round or faceted shaft, its top snapped off — a few jagged stumps of wall rising from
 * the break at uneven heights on one side.
 */
export function brokenTower(k: ProxyKit, at: V2, r: number, h: number, sides: number, color: number, lod?: 0 | 1 | 2): void {
  k.tower('weathered', r, h, { at: [at[0], 0, at[1]], seat: true, sides, taper: 0.06, roof: 'none', color, lod });
  const a0 = k.r(700) * 360;
  // stumps on the break (the kit seats the shaft on the lowest ground under its rim and centre, sunk 0.02)
  const base = Math.min(...Array.from({ length: 8 }, (_, j) => k.ground(at[0] + Math.cos((j / 8) * Math.PI * 2) * r, at[1] + Math.sin((j / 8) * Math.PI * 2) * r)), k.ground(at[0], at[1])) - 0.02;
  for (let j = 0; j < 3; j++) {
    const a = (a0 + j * 38) * DEG;
    const rr = r * 0.94;
    const sh = h * (0.12 + 0.14 * k.r(710 + j));
    k.box('weathered', r * 0.55, sh, r * 0.18, { at: [at[0] + Math.cos(a) * rr, base + h * 0.94 - 0.005, at[1] + Math.sin(a) * rr], rot: [0, -a / DEG + 90, 0], color, lod: 0 });
  }
}

/**
 * A broken dome: a drum of `r` and `drumH` with a cornice, and the dome over it half fallen in (a partial
 * arc of the shell, open on one side).
 */
export function brokenDome(k: ProxyKit, at: V2, r: number, drumH: number, arcDeg: number, color: number): void {
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
    { at: [at[0], base, at[1]], seg: 16, color, seat: false },
  );
  // the shell: up the outside, back down the inside (a thick broken shell), over a partial arc — the
  // fallen side shows the dark interior
  const n = 5;
  const y0 = drumH + r * 0.08;
  const outer: V2[] = [];
  const inner: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2) * 0.9;
    outer.push([Math.cos(a) * r * 0.97, y0 + Math.sin(a) * r * 0.9]);
    inner.push([Math.cos(a) * r * 0.87, y0 + Math.sin(a) * r * 0.8]);
  }
  k.lathe('weathered', [...outer, ...inner.reverse(), outer[0]], { at: [at[0], base, at[1]], seg: 12, arcDeg, rot: [0, k.r(720) * 360, 0], color, shade: 1.08 });
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
