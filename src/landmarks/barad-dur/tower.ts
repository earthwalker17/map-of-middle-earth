import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';

/**
 * The Dark Tower's kit geometry (local frame: y up from the platform on the mount, the crescent of the
 * horns in the local x–y plane, facing local ∓z — the landmark heading turns that face toward the hero
 * cameras in the south).
 *
 * Silhouette, bottom to top (research §14, the RotK stills and Howe's painting): a sprawling foundation of
 * stepped, buttressed plinths with a thicket of spires merging into jagged crags of the mount; four tiers
 * of bundled vertical fins (star-section lofts, slowly twisting and narrowing), each set back 15–20 % in
 * radius behind a jagged, overhanging ledge ringed with spikes and pinnacles; three buttress fins
 * springing from the first setback to the third tier (they break the shaft's outline at mid-height); a
 * pinched neck under the crown; a flared, spiked crown; and the two horns — tapering, curved prongs of
 * dark metal with real thickness and a few serrations on their outer edges, joined in a U under the Eye,
 * their inner faces lit by it (a glow band brightest at the base, #a64d1d family, fading up the prongs) —
 * cradling the Eye: an almond of flame (body #d0400e, hot core #ff7a1a, slit pupil #6d1d06) inside two
 * thin flame-halo cards, with soft additive 'eye' sprites. Eight red window slits (tall thin glow slots in
 * the fin valleys of the upper tiers and the neck, lit at night). Black (#09090e) on a rough family, so a
 * low sun never paints pale specular stripes on the fins; the spikes keep a little sheen.
 *
 * Tri budget: the big lofts are the LOD1 / LOD2 silhouette (a few hundred tris each); spikes, ribs, slits,
 * pinnacles, crags and the fine Eye are hero-range detail (LOD0), so LOD1 stays ≤ 25 % of LOD0.
 */

const BLACK = 0x0b0b0f;
const FIN = 0x101014;
const SPIKE = 0x16161b;
const CRAG = 0x2a2725;
/** the horns' dark metal */
const HORN = 0x1e1915;
/**
 * Glow paint is also the glow material's (sun-lit) albedo (× 0.25): a bright orange paint at low strength
 * reads as a tan-lit plate by day. So the Eye and the lit horn faces use DARK paints at high strength —
 * the same emissive, a near-black albedo: body ≈ #d0400e and core ≈ #ff7a1a as emitted light.
 */
const BODY = 0x8a2006;
const CORE = 0xb04010;

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

/** each tier starts 15–18 % narrower than the one below ends (the setbacks read in silhouette at 50 km) */
const TIERS: Tier[] = [
  { y0: 1.8, y1: 6.4, n: 10, rIn: 2.15, rOut: 2.95, top: 0.9, tw0: 0, tw1: 5 },
  { y0: 6.4, y1: 10.4, n: 10, rIn: 1.62, rOut: 2.2, top: 0.92, tw0: 5, tw1: 10 },
  { y0: 10.4, y1: 13.4, n: 8, rIn: 1.3, rOut: 1.7, top: 0.93, tw0: 12, tw1: 17 },
  { y0: 13.4, y1: 15.6, n: 8, rIn: 1.05, rOut: 1.36, top: 0.92, tw0: 19, tw1: 22 },
];
/** the crown: from the last tier's top through a pinched neck, flaring out to CROWN_Y (the horns' root) */
export const CROWN_Y = 17.2;
/** the horns: height above the crown */
const HORN_H = 3.8;
/** the Eye's centre above the crown */
export const EYE_DY = 2.25;

/** twist (deg) and scale of a tier's loft at fraction f of its height (piecewise linear, as the loft) */
function tierAt(t: Tier, f: number): { tw: number; sc: number } {
  const mid = { tw: (t.tw0 + t.tw1) / 2, sc: 1 - (1 - t.top) * 0.5 };
  if (f <= 0.55) {
    const u = f / 0.55;
    return { tw: t.tw0 + (mid.tw - t.tw0) * u, sc: 1 + (mid.sc - 1) * u };
  }
  const u = (f - 0.55) / 0.45;
  return { tw: mid.tw + (t.tw1 - mid.tw) * u, sc: mid.sc + (t.top - mid.sc) * u };
}

/** vesica half-width at height y (|y| ≤ h/2) for an almond of width w and height h (pointed side corners) */
function vesica(w: number, h: number, y: number): number {
  const a = w / 2;
  const b = h / 2;
  const d = (a * a - b * b) / (2 * b);
  const R = b + d;
  const t = Math.abs(y) + d;
  return Math.sqrt(Math.max(0, R * R - t * t));
}

/**
 * An almond (the Eye's body, core or a flame-halo card) facing ±z: loft of horizontal elliptical sections
 * (`seg` around, `levels` up), base at `y0`.
 */
function almond(k: ProxyKit, w: number, h: number, dz: number, y0: number, color: number, strength: number, o: { lod?: 0 | 1 | 2; seg?: number; levels?: number } = {}): void {
  const levels = o.levels ?? 16;
  const seg = o.seg ?? 32;
  const secs: { outline: V2[]; y: number }[] = [];
  for (let i = 0; i <= levels; i++) {
    // denser near the pointed ends (cosine spacing): a smooth outline, no facets at the corners
    const y = (-h / 2) * Math.cos((i / levels) * Math.PI);
    const hw = Math.max(0.012, vesica(w, h, y));
    const hd = Math.max(0.008, (dz / 2) * (hw / (w / 2)) ** 0.6);
    const ring: V2[] = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * TAU;
      ring.push([Math.cos(a) * hw, Math.sin(a) * hd]);
    }
    secs.push({ outline: ring, y: y + h / 2 });
  }
  k.loft('emissive', secs, { at: [0, y0, 0], color, glow: { gate: 'always', strength }, lod: o.lod });
}

/** The horns' crescent: outer and inner edge half-widths at height v above the crown (U bottom at HORN_BOTTOM). */
const HORN_OUTER = 1.46;
const HORN_BASE = 1.22;
const HORN_INNER = 1.0;
const HORN_BOTTOM = 0.56;
function hornOuter(v: number): number {
  const t = Math.min(1, Math.max(0, v / HORN_H));
  return HORN_BASE + (HORN_OUTER - HORN_BASE) * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) - (HORN_OUTER - HORN_INNER * 0.92) * t ** 3;
}
function hornInner(v: number): number {
  const t = Math.min(1, Math.max(0, (v - HORN_BOTTOM) / (HORN_H - HORN_BOTTOM)));
  const tip = hornOuter(HORN_H);
  return HORN_INNER * Math.sin(Math.min(1, t * 2.2) * Math.PI * 0.5) ** 0.55 * (1 - 0.06 * t) + (tip - HORN_INNER * 0.94) * t ** 4;
}
/** prong depth (z thickness) at height v: heavy at the root, a blade at the tip */
const hornDepth = (v: number): number => 0.62 * (1 - 0.82 * Math.min(1, v / HORN_H) ** 1.3);

/** the two horns (prongs joined in a U), their inner faces' glow bands and serrations; base at CROWN_Y */
function horns(k: ProxyKit): void {
  const Y = CROWN_Y;
  // the U bottom: a heavy bar under the Eye, its top hollowed by the prongs' inner edges
  const bar = (v: number): V2[] => {
    const x = hornOuter(v);
    const d = hornDepth(v) / 2;
    return [
      [-x, -d * 0.8],
      [-x + 0.2, -d],
      [x - 0.2, -d],
      [x, -d * 0.8],
      [x, d * 0.8],
      [x - 0.2, d],
      [-x + 0.2, d],
      [-x, d * 0.8],
    ];
  };
  k.loft('darkStone', [0, 0.35, HORN_BOTTOM + 0.08].map((v) => ({ outline: bar(v), y: v })), { at: [0, Y, 0], color: HORN });
  // the prongs: lens sections from the inner edge (toward the Eye) to the outer edge, tapering to a point
  const LV = [HORN_BOTTOM - 0.02, 0.75, 0.97, 1.2, 1.45, 1.8, 2.3, 2.8, 3.25, 3.6, HORN_H - 0.02];
  for (const s of [-1, 1]) {
    const lens = (v: number): V2[] => {
      const xo = hornOuter(v);
      const xi = Math.min(hornInner(v), xo - 0.03);
      const w = xo - xi;
      const d = hornDepth(v) / 2;
      const pts: V2[] = [
        [xo, 0],
        [xo - 0.3 * w, d],
        [xi + 0.15 * w, d * 0.8],
        [xi, 0],
        [xi + 0.15 * w, -d * 0.8],
        [xo - 0.3 * w, -d],
      ];
      return s > 0 ? pts : pts.map(([x, z]) => [-x, z] as V2).reverse();
    };
    k.loft('darkStone', LV.map((v) => ({ outline: lens(v), y: v })), { at: [0, Y, 0], color: HORN });
    // the inner faces, lit by the Eye: a band over the inner ~40 % of the prong, just proud of both faces,
    // brightest at the root and fading up the prong
    const bands: [number, number, number, number][] = [
      [HORN_BOTTOM - 0.02, 1.4, 0x7a2406, 2.4],
      [1.4, 2.3, 0x6a1e05, 1.9],
      [2.3, 3.0, 0x561804, 1.4],
      [3.0, 3.5, 0x401203, 1.0],
    ];
    for (const [v0, v1, col, str] of bands) {
      const band = (v: number): V2[] => {
        const xo = hornOuter(v);
        const xi = Math.min(hornInner(v), xo - 0.03);
        const d = hornDepth(v) / 2 + 0.02;
        const x1 = xi + 0.42 * (xo - xi);
        const pts: V2[] = [
          [xi - 0.02, -d],
          [x1, -d],
          [x1, d],
          [xi - 0.02, d],
        ];
        return s > 0 ? pts : pts.map(([x, z]) => [-x, z] as V2).reverse();
      };
      k.loft('emissive', [0, 0.25, 0.5, 0.75, 1].map((f) => ({ outline: band(v0 + (v1 - v0) * f), y: v0 + (v1 - v0) * f })), { at: [0, Y, 0], color: col, glow: { gate: 'always', strength: str } });
    }
    // serrations: a few teeth on the outer edge, raking outward and up
    for (const v of [1.25, 2.05, 2.75]) {
      const x = hornOuter(v) - 0.04;
      k.cone('darkStone', 0.07, 0.34 + 0.1 * k.r(), { at: [s * x, Y + v, 0], rot: tilt(s > 0 ? 0 : Math.PI, 1.0), seg: 4, color: HORN, lod: 0 });
    }
  }
  // the top of the U bottom, under the Eye: the brightest lit face
  k.box('emissive', 0.9, 0.05, hornDepth(HORN_BOTTOM) + 0.04, { at: [0, Y + HORN_BOTTOM + 0.04, 0], color: 0x7a2406, glow: { gate: 'always', strength: 2.6 } });
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

/**
 * A buttress fin: a thin blade in the radial plane at angle `phi`, springing from the first setback (on
 * the tier-0 ledge) out to a spiked elbow ~1.8 km beyond the shaft and sweeping back in to the third tier,
 * its inner edge buried in the fins (a gap between blade and shaft read as a jug handle). Outline (u
 * radial, v height) for `extrude` stood up by +90° about x.
 */
function flyingButtress(k: ProxyKit, phi: number, scale: number): void {
  const th = 0.34;
  const uv: V2[] = [
    [1.95, 5.9],
    [3.0, 6.1],
    [3.95, 6.8],
    [3.85, 7.7],
    [3.05, 9.4],
    [1.9, 11.3],
    [1.45, 11.15],
    [1.6, 9.4],
    [1.75, 7.6],
    [1.8, 6.5],
  ].map(([u, v]) => [u, 6.4 + (v - 6.4) * scale] as V2);
  const e: V2 = [-Math.sin(phi), Math.cos(phi)];
  k.extrude(
    'weathered',
    uv.map(([u, v]) => [u, -v] as V2),
    th,
    { at: [-e[0] * (th / 2), 0, -e[1] * (th / 2)], rot: [90, 0, phi * DEG], color: FIN },
  );
  // a spike on the elbow, raking outward
  const ex = 3.9;
  const ey = 6.4 + (7.05 - 6.4) * scale;
  k.cone('darkStone', 0.13, 1.0 + 0.4 * k.r(), { at: [Math.cos(phi) * ex, ey, Math.sin(phi) * ex], rot: tilt(phi, 0.55), seg: 5, color: SPIKE, lod: 1 });
}

export function buildTower(k: ProxyKit): void {
  // ---- the foundation: stepped buttressed plinths on the platform (bottoms follow the rock)
  k.extrude('weathered', finSection(12, 3.2, 4.1, 0.07, 0.13), 1.0, { followGround: true, color: BLACK, taper: 0.1 });
  k.extrude('weathered', finSection(12, 2.6, 3.45, 0.06, 0.4), 1.9, { followGround: true, color: FIN, taper: 0.12 });
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
    const top = 5.6 + 1.2 * k.r();
    k.loft('weathered', [sec(4.05, 0.32, 0.6, 0), sec(3.5, 0.27, 0.45, top * 0.4), sec(3.0, 0.21, 0.3, top * 0.78), sec(2.75, 0.16, 0.18, top)], { at: [0, -0.3, 0], color: FIN });
    k.cone('darkStone', 0.17, 1.3 + 0.6 * k.r(), { at: [ca * 2.77, top - 0.4, sa * 2.77], rot: tilt(a, 0.16), seg: 5, color: SPIKE, lod: 0 });
  }
  // a thicket of spires round the foot, clustered and uneven (a few tall ones)
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * TAU + 0.4 * (k.r() - 0.5);
    const r = 2.9 + 1.3 * k.r();
    const h = 0.9 + 3.4 * k.r() ** 2.2;
    k.cone('darkStone', 0.09 + 0.1 * k.r(), h, { at: [Math.cos(a) * r, 0.5 + 0.8 * k.r(), Math.sin(a) * r], rot: tilt(a, 0.1 * k.r()), seg: 5, color: SPIKE, lod: h > 3.2 ? undefined : 0 });
  }
  crags(k);

  // ---- the shaft: four tiers of bundled fins; each setback an overhanging jagged ledge with spikes
  const slits: { p: V3; a: number }[] = [];
  TIERS.forEach((t, ti) => {
    const sec = finSection(t.n, t.rIn, t.rOut, 0.055 + 0.01 * ti);
    const h = t.y1 - t.y0;
    const mid = tierAt(t, 0.55);
    k.loft(
      'weathered',
      [
        { outline: sec, y: 0, rotDeg: t.tw0 },
        { outline: sec, y: h * 0.55, rotDeg: mid.tw, scale: mid.sc },
        { outline: sec, y: h, rotDeg: t.tw1, scale: t.top },
      ],
      { at: [0, t.y0 - 0.05, 0], color: ti % 2 ? FIN : BLACK },
    );
    // the core between the fins (the valleys never show sky)
    k.cylinder('weathered', t.rIn * t.top * 0.96, t.rIn * 0.98, h + 0.3, { at: [0, t.y0 - 0.15, 0], seg: 12, color: BLACK });
    // the setback: a jagged ledge overhanging the tier top by ~18 %, its underside stepping in
    if (ti < TIERS.length - 1) {
      const ledge = finSection(t.n, t.rIn * t.top * 1.02, t.rOut * t.top * 1.18, 0.08);
      k.loft(
        'weathered',
        [
          { outline: ledge, y: 0, rotDeg: t.tw1, scale: 0.88 },
          { outline: ledge, y: 0.16, rotDeg: t.tw1, scale: 1 },
          { outline: ledge, y: 0.3, rotDeg: t.tw1, scale: 1 },
        ],
        { at: [0, t.y1 - 0.3, 0], color: FIN },
      );
    }
    const twTop = (t.tw1 * Math.PI) / 180;
    for (let j = 0; j < t.n; j++) {
      // pinnacles on the ledge's fin tips (every other fin, uneven heights)
      const a = (j / t.n) * TAU - twTop;
      const rt = t.rOut * t.top * 1.12;
      if (j % 2 === ti % 2 && ti < TIERS.length - 1) {
        const ph = 1.2 + 1.1 * k.r();
        k.cone('darkStone', 0.13, ph, { at: [Math.cos(a) * rt, t.y1 - 0.05, Math.sin(a) * rt], rot: tilt(a, 0.08), seg: 5, color: SPIKE, lod: ph > 1.9 ? 1 : 0 });
      }
      // spikes round the ledge, leaning out
      for (const da of [-0.5, 0.5]) {
        const b = a + (da * TAU) / t.n;
        const rr = (da < 0 ? t.rOut * 1.12 : t.rIn * 1.1) * t.top;
        k.cone('darkStone', 0.05, 0.35 + 0.35 * k.r(), { at: [Math.cos(b) * rr, t.y1, Math.sin(b) * rr], rot: tilt(b, 0.45), seg: 4, color: SPIKE, lod: 0 });
      }
      // hanging teeth under the ledge
      k.cone('darkStone', 0.05, 0.34, { at: [Math.cos(a + 0.1) * rt, t.y1 - 0.3, Math.sin(a + 0.1) * rt], rot: [180, 0, 0], seg: 4, color: SPIKE, lod: 0 });
      // spikes along the fin edges, sparse and uneven
      const a0 = (j / t.n) * TAU;
      for (let m = 0; m < 4; m++) {
        if (k.r() < 0.4) continue;
        const f = 0.12 + 0.75 * ((m + k.r() * 0.7) / 4);
        const { tw, sc } = tierAt(t, f);
        const b = a0 - (tw * Math.PI) / 180;
        k.cone('darkStone', 0.045, 0.3 + 0.35 * k.r(), { at: [Math.cos(b) * t.rOut * sc, t.y0 + f * h, Math.sin(b) * t.rOut * sc], rot: tilt(b, 0.8), seg: 4, color: SPIKE, lod: 0 });
      }
      // vertical ribs on the fin tips (the plated, ribbed look up close), lofted with the tier's own
      // twist and taper so they never stand off the narrowing fins
      const c = Math.cos(a0);
      const sn = Math.sin(a0);
      const rr = t.rOut + 0.03;
      const sq: V2[] = [
        [-0.035, -0.035],
        [0.035, -0.035],
        [0.035, 0.035],
        [-0.035, 0.035],
      ].map(([u, v]) => [c * (rr + v) - sn * u, sn * (rr + v) + c * u] as V2);
      const fs = [0.16, 0.55, 0.78];
      k.loft(
        'darkStone',
        fs.map((f) => ({ outline: sq, y: (f - fs[0]) * h, rotDeg: tierAt(t, f).tw, scale: tierAt(t, f).sc })),
        { at: [0, t.y0 + fs[0] * h, 0], color: SPIKE, lod: 0 },
      );
      // window slits in the fin valleys of the upper tiers, on the sides the hero cameras see (local
      // 200°–330°: Gorgoroth and Mount Doom), staggered heights
      if (ti >= 2) {
        const f = 0.3 + 0.2 * ((j + ti) % 3);
        const { tw, sc } = tierAt(t, f);
        let av = a0 - Math.PI / t.n - (tw * Math.PI) / 180;
        av = ((av % TAU) + TAU) % TAU;
        if (av > (200 * Math.PI) / 180 && av < (330 * Math.PI) / 180) {
          const y = t.y0 + f * h;
          const rv = Math.max(t.rIn * sc, t.rIn * 0.98 - (t.rIn * 0.98 - t.rIn * t.top * 0.96) * ((y - t.y0 + 0.15) / (h + 0.3))) + 0.005;
          slits.push({ p: [Math.cos(av) * rv, y, Math.sin(av) * rv], a: av });
        }
      }
    }
  });

  // ---- three buttress fins from the first setback to the third tier
  for (let i = 0; i < 3; i++) flyingButtress(k, ((i / 3) * TAU + 0.35) % TAU, 0.95 + 0.1 * k.r());

  // ---- the neck and the crown: the last tier pinches in, then flares out under the horns, spiked
  const last = TIERS[TIERS.length - 1];
  const crown = finSection(8, 0.8, 1.0, 0.1);
  const cy = last.y1 - 0.02;
  k.loft(
    'weathered',
    [
      { outline: crown, y: 0, rotDeg: last.tw1, scale: 1.2 },
      { outline: crown, y: 0.4, rotDeg: last.tw1 + 1, scale: 0.94 },
      { outline: crown, y: 0.78, rotDeg: last.tw1 + 2, scale: 0.94 },
      { outline: crown, y: 1.2, rotDeg: last.tw1 + 4, scale: 1.5 },
      { outline: crown, y: CROWN_Y - cy, rotDeg: last.tw1 + 5, scale: 1.72 },
    ],
    { at: [0, cy, 0], color: FIN },
  );
  // two slits in the neck (the pinched waist under the crown), in its fin valleys (22.5° + k·45°, less
  // the ~23° twist there)
  for (const deg of [224.45, 269.45]) {
    const av = (deg * Math.PI) / 180;
    const rv = 0.8 * 0.94 + 0.005;
    slits.push({ p: [Math.cos(av) * rv, cy + 0.59, Math.sin(av) * rv], a: av });
  }
  for (let j = 0; j < 16; j++) {
    const a = (j / 16) * TAU + 0.11;
    const big = j % 2 === 0;
    k.cone('darkStone', big ? 0.12 : 0.08, big ? 0.95 + 0.3 * k.r() : 0.55, { at: [Math.cos(a) * 1.62, CROWN_Y - 0.08, Math.sin(a) * 1.62], rot: tilt(a, big ? 0.3 : 0.5), seg: 4, color: SPIKE, lod: big ? 1 : 0 });
  }

  // ---- the window slits: tall thin glow slots (0.06 × 0.42 km) lit at night, six to eight of them
  const lit = slits.slice(0, 8);
  for (const { p, a } of lit) {
    k.box('emissive', 0.06, 0.42, 0.05, { at: [p[0] - Math.cos(a) * 0.01, p[1] - 0.21, p[2] - Math.sin(a) * 0.01], rot: [0, -a * DEG + 90, 0], color: 0xb8321a, glow: { gate: 'night', strength: 0.6 }, lod: 0 });
    k.light([p[0] + Math.cos(a) * 0.04, p[1], p[2] + Math.sin(a) * 0.04], { kind: 'magic', gate: 'night', color: 0xc83a18, intensity: 0.22, radius: 0.05, flicker: 0.04 });
  }

  // ---- the horns
  horns(k);

  // ---- the Eye: an almond of flame between the horns (two flame-halo cards, body, hot core, slit pupil)
  const ey = CROWN_Y + EYE_DY;
  const EW = 1.45;
  const EH = 0.92;
  // fine (hero) and coarse (silhouette LODs, a hair smaller so the fine one covers it at LOD0)
  almond(k, EW, EH, 0.5, ey - EH / 2, BODY, 2.4, { lod: 0 });
  almond(k, EW * 0.97, EH * 0.97, 0.48, ey - (EH * 0.97) / 2, BODY, 2.4, { lod: 2, seg: 12, levels: 7 });
  almond(k, EW * 0.62, EH * 0.66, 0.58, ey - (EH * 0.66) / 2, CORE, 3.0, { lod: 0, seg: 28, levels: 12 });
  k.box('lava', 0.09, EH * 0.84, 0.66, { at: [0, ey - EH * 0.42, 0], color: 0x6d1d06, glow: { gate: 'always', strength: 0.1, flicker: 0.02 } });
  // the flame halo: two thin cards behind the body, deep red fading outward (a stepped soft rim)
  almond(k, EW * 1.22, EH * 1.3, 0.2, ey - (EH * 1.3) / 2, 0x5a1404, 1.6, { lod: 0, seg: 24, levels: 10 });
  almond(k, EW * 1.42, EH * 1.55, 0.1, ey - (EH * 1.55) / 2, 0x300a02, 1.4, { lod: 0, seg: 24, levels: 10 });

  // ---- lights: the Eye (always; one on each face of the lens, just proud of it): the additive glow the
  // opaque cards cannot give — small enough that the almond's shape still reads up close, a hot spark
  // with a soft halo from afar
  for (const z of [-0.36, 0.36]) k.light([0, ey, z], { kind: 'eye', color: 0xff7a1a, intensity: 0.75, radius: 0.16 });
}
