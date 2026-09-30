import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';

/**
 * The Dark Tower's kit geometry (local frame: y up from the platform on the mount, the crescent of the
 * horns in the local x–y plane, facing local ∓z — the landmark heading turns that face toward the hero
 * cameras in the south).
 *
 * Silhouette, bottom to top (research §14, the RotK stills and Howe's painting): a sprawling foundation of
 * stepped, buttressed plinths with a thicket of spires merging into jagged crags of the mount; four
 * stepped tiers of bundled vertical fins (star-section lofts, slowly twisting and narrowing), each setback
 * ringed with uneven spikes and pinnacles so the shaft reads as one jagged, tapering spire (not stacked
 * galleries); a flared, spiked crown; and the two curved horns rising from it as one U-shaped crescent
 * whose inner faces burn with the Eye's light (#a64d1d), cradling the Eye — an almond of flame (#dc6424)
 * with a hot core (#fcad4d), a slit pupil (#6d1d06) and a halo of deep red flame. Red window slits in the fin
 * valleys (always on). Black (#09090e) on a rough family, so a low sun never paints pale specular stripes
 * on the fins; the spikes keep a little sheen.
 *
 * Tri budget: the big lofts are the LOD1 / LOD2 silhouette (a few hundred tris each); spikes, ribs, slits,
 * pinnacles and crags are hero-range detail (LOD0), so LOD1 stays ≤ 25 % of LOD0.
 */

const BLACK = 0x0b0b0f;
const FIN = 0x101014;
const SPIKE = 0x16161b;
const CRAG = 0x2a2725;

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;

/** a fin-bundle section: `n` fins, each a flat-topped ray (valley rIn, tip rOut, tip half-angle `w` rad) */
export function finSection(n: number, rIn: number, rOut: number, w: number, phase = 0): V2[] {
  const pts: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU;
    const v = a - Math.PI / n;
    pts.push([Math.cos(v) * rIn, Math.sin(v) * rIn]);
    pts.push([Math.cos(a - w) * rOut, Math.sin(a - w) * rOut]);
    pts.push([Math.cos(a + w) * rOut, Math.sin(a + w) * rOut]);
  }
  return pts;
}

/** Euler (deg) tilting +y by `t` rad toward the horizontal direction at angle `phi` (x = cos, z = sin) */
export function tilt(phi: number, t: number): V3 {
  const rz = -Math.asin(Math.sin(t) * Math.cos(phi));
  const rx = Math.atan2(Math.sin(t) * Math.sin(phi), Math.cos(t));
  return [rx * DEG, 0, rz * DEG];
}

/** one tier of the shaft: y0 → y1, fins, narrowing to `top`, twisting `tw0` → `tw1` degrees */
interface Tier {
  y0: number;
  y1: number;
  n: number;
  rIn: number;
  rOut: number;
  top: number;
  tw0: number;
  tw1: number;
}

const TIERS: Tier[] = [
  { y0: 1.8, y1: 6.2, n: 10, rIn: 1.95, rOut: 2.7, top: 0.86, tw0: 0, tw1: 5 },
  { y0: 6.2, y1: 10.2, n: 10, rIn: 1.52, rOut: 2.06, top: 0.92, tw0: 5, tw1: 10 },
  { y0: 10.2, y1: 13.4, n: 8, rIn: 1.34, rOut: 1.8, top: 0.93, tw0: 12, tw1: 17 },
  { y0: 13.4, y1: 16.0, n: 8, rIn: 1.2, rOut: 1.6, top: 0.94, tw0: 19, tw1: 22 },
];
/** the crown: flare from the last tier's top to CROWN_Y (the horns' root) */
export const CROWN_Y = 17.2;
/** the horns: height above the crown */
const HORN_H = 3.8;
/** the Eye's centre above the crown */
export const EYE_DY = 2.25;

/** vesica half-width at height y (|y| ≤ h/2) for an almond of width w and height h (pointed side corners) */
function vesica(w: number, h: number, y: number): number {
  const a = w / 2;
  const b = h / 2;
  const d = (a * a - b * b) / (2 * b);
  const R = b + d;
  const t = Math.abs(y) + d;
  return Math.sqrt(Math.max(0, R * R - t * t));
}

/** An almond (the Eye's body, core or flame halo) facing ±z: loft of horizontal elliptical sections, base at `y0`. */
function almond(k: ProxyKit, w: number, h: number, dz: number, y0: number, color: number, strength: number, lod?: 0 | 1 | 2): void {
  const levels = 9;
  const secs: { outline: V2[]; y: number }[] = [];
  for (let i = 0; i <= levels; i++) {
    const y = -h / 2 + (i / levels) * h;
    const hw = Math.max(0.015, vesica(w, h, y));
    const hd = Math.max(0.01, (dz / 2) * (hw / (w / 2)) ** 0.6);
    const ring: V2[] = [];
    for (let j = 0; j < 10; j++) {
      const a = (j / 10) * TAU;
      ring.push([Math.cos(a) * hw, Math.sin(a) * hd]);
    }
    secs.push({ outline: ring, y: y + h / 2 });
  }
  k.loft('emissive', secs, { at: [0, y0, 0], color, glow: { gate: 'always', strength }, lod });
}

/**
 * The horns: one U-shaped crescent plate in the x–y plane, as an outline in (x, −v) for the +90° x
 * rotation of `extrude` (v up). Outer edge from the root (baseW) bellying to outerW and curving in to the
 * tip; inner edge a round U bottom at `bottom` opening to near-vertical prongs.
 */
function crescent(outerW: number, baseW: number, innerW: number, bottom: number, h: number): V2[] {
  const n = 9;
  const outer: V2[] = [];
  const inner: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const xo = baseW + (outerW - baseW) * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) - (outerW - innerW * 0.92) * t ** 3;
    outer.push([xo, t * h]);
  }
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const xi = innerW * Math.sin(Math.min(1, t * 2.2) * Math.PI * 0.5) ** 0.55 * (1 - 0.06 * t) + (outer[n][0] - innerW * 0.94) * t ** 4;
    inner.push([Math.max(0.001, xi), bottom + t * (h - bottom)]);
  }
  const right: V2[] = [...outer, ...inner.slice(0, n).reverse()];
  const left: V2[] = right.map(([x, v]) => [-x, v] as V2).reverse();
  return [...right.slice(0, right.length - 1), [0, bottom], ...left.slice(1)].map(([x, v]) => [x, -v] as V2);
}

/** the jagged crags of the mount round the foundation (hero range; the stamp carries the mount's form) */
function crags(k: ProxyKit): void {
  for (let i = 0; i < 52; i++) {
    const a = (i / 52) * TAU + 0.5 * (k.r() - 0.5);
    const r = 4.2 + 3.4 * k.r() ** 0.8;
    const s = 0.28 + 0.55 * k.r() ** 1.5;
    k.rock('weathered', s, { at: [Math.cos(a) * r, 0, Math.sin(a) * r], seat: true, squash: 1.35 + 0.4 * k.r(), lump: 0.38, detail: 1, color: CRAG, shade: 0.85 + 0.3 * k.r(), lod: 0 });
  }
}

export function buildTower(k: ProxyKit): void {
  // ---- the foundation: stepped buttressed plinths on the platform (bottoms follow the rock)
  k.extrude('weathered', finSection(12, 3.1, 4.0, 0.07, 0.13), 1.0, { followGround: true, color: BLACK, taper: 0.1 });
  k.extrude('weathered', finSection(12, 2.5, 3.3, 0.06, 0.4), 1.9, { followGround: true, color: FIN, taper: 0.12 });
  // eight great buttresses climbing the lowest tier, each crowned by a spike
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * TAU + 0.13;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const sec = (r: number, w: number, d: number, y: number) => ({
      y,
      outline: [
        [ca * (r - d) + sa * w, sa * (r - d) - ca * w],
        [ca * (r + d) + sa * w, sa * (r + d) - ca * w],
        [ca * (r + d) - sa * w, sa * (r + d) + ca * w],
        [ca * (r - d) - sa * w, sa * (r - d) + ca * w],
      ] as V2[],
    });
    const top = 6.0 + 1.4 * k.r();
    k.loft('weathered', [sec(3.9, 0.32, 0.6, 0), sec(3.3, 0.27, 0.45, top * 0.4), sec(2.72, 0.21, 0.3, top * 0.78), sec(2.45, 0.16, 0.18, top)], { at: [0, -0.3, 0], color: FIN });
    k.cone('darkStone', 0.17, 1.3 + 0.6 * k.r(), { at: [ca * 2.47, top - 0.4, sa * 2.47], rot: tilt(a, 0.16), seg: 5, color: SPIKE, lod: 0 });
  }
  // a thicket of spires round the foot, clustered and uneven (a few tall ones)
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * TAU + 0.4 * (k.r() - 0.5);
    const r = 2.7 + 1.3 * k.r();
    const h = 0.9 + 3.4 * k.r() ** 2.2;
    k.cone('darkStone', 0.09 + 0.1 * k.r(), h, { at: [Math.cos(a) * r, 0.5 + 0.8 * k.r(), Math.sin(a) * r], rot: tilt(a, 0.1 * k.r()), seg: 5, color: SPIKE, lod: h > 3.2 ? undefined : 0 });
  }
  crags(k);

  // ---- the shaft: four tiers of bundled fins; each setback ringed with spikes and pinnacles
  const slits: V3[] = [];
  TIERS.forEach((t, ti) => {
    const sec = finSection(t.n, t.rIn, t.rOut, 0.055 + 0.01 * ti);
    const h = t.y1 - t.y0;
    k.loft(
      'weathered',
      [
        { outline: sec, y: 0, rotDeg: t.tw0 },
        { outline: sec, y: h * 0.55, rotDeg: (t.tw0 + t.tw1) / 2, scale: 1 - (1 - t.top) * 0.5 },
        { outline: sec, y: h, rotDeg: t.tw1, scale: t.top },
      ],
      { at: [0, t.y0 - 0.05, 0], color: ti % 2 ? FIN : BLACK },
    );
    // the core between the fins (the valleys never show sky)
    k.cylinder('weathered', t.rIn * t.top * 0.96, t.rIn * 0.98, h + 0.3, { at: [0, t.y0 - 0.15, 0], seg: 12, color: BLACK });
    // the setback: a thin jagged ledge (the section flared) at the top of the tier
    const ledge = finSection(t.n, t.rIn * t.top * 1.02, t.rOut * t.top * 1.1, 0.07);
    k.loft(
      'weathered',
      [
        { outline: ledge, y: 0, rotDeg: t.tw1, scale: 0.94 },
        { outline: ledge, y: 0.2, rotDeg: t.tw1, scale: 1 },
      ],
      // (hero range: at LOD1 distances the 0.2 km ledge is ~2 px)
      { at: [0, t.y1 - 0.2, 0], color: FIN, lod: 0 },
    );
    const twTop = (t.tw1 * Math.PI) / 180;
    for (let j = 0; j < t.n; j++) {
      // pinnacles on the fin tips at the setback (every other fin, uneven heights)
      const a = (j / t.n) * TAU - twTop;
      const rt = t.rOut * t.top * 1.02;
      if (j % 2 === ti % 2 && ti < TIERS.length - 1) {
        const ph = 1.2 + 1.1 * k.r();
        k.cone('darkStone', 0.13, ph, { at: [Math.cos(a) * rt, t.y1 - 0.1, Math.sin(a) * rt], rot: tilt(a, 0.06), seg: 5, color: SPIKE, lod: ph > 1.9 ? 1 : 0 });
      }
      // spikes round the ledge, leaning out
      for (const da of [-0.5, 0.5]) {
        const b = a + (da * TAU) / t.n;
        const rr = (da < 0 ? t.rOut : t.rIn * 1.1) * t.top;
        k.cone('darkStone', 0.05, 0.35 + 0.35 * k.r(), { at: [Math.cos(b) * rr, t.y1, Math.sin(b) * rr], rot: tilt(b, 0.45), seg: 4, color: SPIKE, lod: 0 });
      }
      // hanging teeth under the ledge
      k.cone('darkStone', 0.05, 0.3, { at: [Math.cos(a + 0.1) * rt, t.y1 - 0.15, Math.sin(a + 0.1) * rt], rot: [180, 0, 0], seg: 4, color: SPIKE, lod: 0 });
      // spikes along the fin edges, sparse and uneven
      const a0 = (j / t.n) * TAU;
      for (let m = 0; m < 4; m++) {
        if (k.r() < 0.4) continue;
        const f = 0.12 + 0.75 * ((m + k.r() * 0.7) / 4);
        const tw = ((t.tw0 + (t.tw1 - t.tw0) * f) * Math.PI) / 180;
        const sc = 1 - (1 - t.top) * f;
        const b = a0 - tw;
        k.cone('darkStone', 0.045, 0.3 + 0.35 * k.r(), { at: [Math.cos(b) * t.rOut * sc, t.y0 + f * h, Math.sin(b) * t.rOut * sc], rot: tilt(b, 0.8), seg: 4, color: SPIKE, lod: 0 });
      }
      // vertical ribs on the fin tips (the plated, ribbed look up close)
      const tw = ((t.tw0 + t.tw1) * 0.5 * Math.PI) / 180;
      const b = a0 - tw;
      const r = t.rOut * (1 - (1 - t.top) * 0.5) + 0.02;
      k.box('darkStone', 0.07, h * 0.62, 0.07, { at: [Math.cos(b) * r, t.y0 + h * 0.16, Math.sin(b) * r], rot: [0, -b * DEG, 0], color: SPIKE, lod: 0 });
      // window slits in the valleys between the fins (every other valley, staggered heights)
      if ((j + ti) % 2 === 0) {
        const f = 0.3 + 0.18 * ((j + ti) % 3);
        const y = t.y0 + f * h;
        const scs = 1 - (1 - t.top) * f;
        const twf = ((t.tw0 + (t.tw1 - t.tw0) * f) * Math.PI) / 180;
        const av = a0 - Math.PI / t.n - twf;
        const rv = t.rIn * scs + 0.01;
        const p: V3 = [Math.cos(av) * rv, y, Math.sin(av) * rv];
        k.box('emissive', 0.07, 0.32, 0.05, { at: p, rot: [0, -av * DEG + 90, 0], color: 0xb8321a, glow: { gate: 'always', strength: 0.45 }, lod: 0 });
        slits.push([Math.cos(av) * (rv + 0.03), y + 0.16, Math.sin(av) * (rv + 0.03)]);
      }
    }
  });

  // ---- the crown: a fin bundle flaring out under the horns, ringed with spikes
  const last = TIERS[TIERS.length - 1];
  const crown = finSection(8, last.rIn * last.top, last.rOut * last.top, 0.1);
  k.loft(
    'weathered',
    [
      { outline: crown, y: 0, rotDeg: last.tw1 },
      { outline: crown, y: 0.6, rotDeg: last.tw1 + 2, scale: 1.12 },
      { outline: crown, y: 1.05, rotDeg: last.tw1 + 4, scale: 1.34 },
      { outline: crown, y: CROWN_Y - last.y1, rotDeg: last.tw1 + 5, scale: 1.3 },
    ],
    { at: [0, last.y1 - 0.02, 0], color: FIN },
  );
  for (let j = 0; j < 16; j++) {
    const a = (j / 16) * TAU + 0.11;
    const big = j % 2 === 0;
    k.cone('darkStone', big ? 0.12 : 0.08, big ? 0.95 + 0.3 * k.r() : 0.55, { at: [Math.cos(a) * 1.85, CROWN_Y - 0.08, Math.sin(a) * 1.85], rot: tilt(a, big ? 0.3 : 0.5), seg: 4, color: SPIKE, lod: big ? 1 : 0 });
  }

  // ---- the horns: one crescent plate (U cradle), its inner half burning with the Eye's light
  const th = 0.36;
  k.extrude('weathered', crescent(1.46, 1.22, 1.0, 0.56, HORN_H), th, { at: [0, CROWN_Y, -th / 2], rot: [90, 0, 0], color: BLACK });
  k.extrude('emissive', crescent(1.22, 1.02, 0.99, 0.54, HORN_H - 0.08), th + 0.04, { at: [0, CROWN_Y + 0.04, -(th + 0.04) / 2], rot: [90, 0, 0], color: 0xa64d1d, glow: { gate: 'always', strength: 0.2 } });

  // ---- the Eye: an almond of flame between the horns (flame halo, body, hot core, slit pupil)
  const ey = CROWN_Y + EYE_DY;
  const EW = 1.45;
  const EH = 0.92;
  almond(k, EW, EH, 0.5, ey - EH / 2, 0xe0601e, 0.3);
  almond(k, EW * 0.62, EH * 0.66, 0.58, ey - (EH * 0.66) / 2, 0xf8a040, 0.5);
  k.box('lava', 0.09, EH * 0.84, 0.66, { at: [0, ey - EH * 0.42, 0], color: 0x6d1d06, glow: { gate: 'always', strength: 0.1, flicker: 0.02 } });
  // the flame halo: a larger, thin almond of deep red fire behind the body (a soft rim, not a star)
  almond(k, EW * 1.32, EH * 1.5, 0.22, ey - (EH * 1.5) / 2, 0x9a2a0c, 0.3, 0);

  // ---- lights: the Eye (always; one on each face of the lens, just proud of it) and the red slits
  for (const z of [-0.36, 0.36]) k.light([0, ey, z], { kind: 'eye', color: 0xf07a28, intensity: 0.6, radius: 0.2 });
  for (const p of slits.slice(0, 16)) k.light(p, { kind: 'magic', color: 0xc83a18, intensity: 0.35, radius: 0.04, flicker: 0.04 });
}
