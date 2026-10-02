import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2 } from '../records.ts';
import { C, CITADEL_Y, GATE_BEARING, PROW, RADII, TIERS, polarC, prowHalf, stepOf, tierY, toProw } from './layout.ts';

/**
 * The seven tiers of the White City (research §9; the RotK prow-and-tiers stills, the 1:72 bigature):
 * concentric terrace bodies of off-white limestone, each a battered retaining wall one step tall rising
 * from the terrace below, closed at the back by a chord buried in the cliff face; along every terrace edge
 * a tall parapet (merlons on the outer wall and the citadel) under a projecting coping that throws a dark
 * line — so the seven walls read as seven pale horizontal bands over the roofs below them — round
 * bastions on the outer wall, turrets on the inner walls; and the houses — weathered stone buildings with
 * hipped, gabled and domed slate roofs packed in rows along the terraces (lower than the wall above them,
 * a few tall ones breaking the skyline, the front row below the parapet), ~900 of them (LOD0 only), with
 * dark blue-grey window openings and evenly spread lit windows over the Pelennor; a cheap roofscape strip
 * per terrace stands in for them at LOD1.
 */

/**
 * The houses' weathered limestone: a near-neutral warm grey (the film's lit stone is #a49b8b … #d2c6b7,
 * painted a little cool because the dawn key light is golden); every house is jittered in value and hue
 */
export const STONE = 0xc6c4bd;
/** the terrace walls, parapets and copings: the palest stone of the city (bright bands) */
export const WALL = 0xd3d1ca;
/** slate and lead roofs, grey-blue, visibly darker than the stone */
const SLATE = [0x62666b, 0x6c6f73, 0x5b5f64, 0x686a6c, 0x5f6368];
/** pale lead / stone domes */
const DOME = [0x9a978e, 0x8f9393, 0xa39d8f];
/** window openings: dark blue-grey (never black) */
const WINDOW = 0x2a2d33;
/** lit windows: dark warm paint (a dark opening by day) with a strong night-gated glow */
const WINDOW_LIT = 0x7a5530;

const DEG = Math.PI / 180;

/** The arc of tier `i` (1…7) clear of the mountain: bearings bLo…bHi (= 180 − bLo) around C. */
export interface TierArc {
  i: number;
  R: number;
  top: number;
  bLo: number;
  bHi: number;
  /** top radius after the batter */
  rTop: number;
}

/** batter of the retaining walls: inset at the top, km */
const BATTER = 0.035;
/** parapet height above the terrace (outer wall / inner walls) and the coping's projection */
const PARAPET = { outer: 0.22, inner: 0.16, coping: 0.024, overhang: 0.022 };

/**
 * Where tier `i` meets the mountain: march west from C until the face stands higher than the terrace
 * (+0.3) all across the chord there; the arc runs on round to that chord (a full circle when the face
 * never clears it — the citadel on its shelf).
 */
export function tierArc(k: ProxyKit, i: number): TierArc {
  const R = RADII[i - 1];
  const top = tierY(i);
  let xb = -R;
  for (let dx = 0; dx >= -R; dx -= 0.05) {
    const half = Math.sqrt(Math.max(0, R * R - dx * dx));
    let lo = Infinity;
    for (let f = -0.95; f <= 0.951; f += 0.1) lo = Math.min(lo, k.ground(C[0] + dx, C[1] + f * half));
    if (lo >= top + 0.3) {
      xb = dx;
      break;
    }
  }
  const bLo = Math.asin(Math.max(-1, Math.min(0, xb / R))) / DEG;
  return { i, R, top, bLo, bHi: 180 - bLo, rTop: R - BATTER };
}

/** arc points (local) of radius r from bearing b0 to b1, about `n` per 180° */
function arc(r: number, b0: number, b1: number, per180: number): V2[] {
  const n = Math.max(6, Math.round(((b1 - b0) / 180) * per180));
  const out: V2[] = [];
  for (let s = 0; s <= n; s++) out.push(polarC(b0 + ((b1 - b0) * s) / n, r));
  return out;
}

/** the prow keel's flare: its half width at the foot is (1 + PROW_BATTER)× the crest's (citadel.ts) */
export const PROW_BATTER = 0.4;
/** the prow's width factor at local height y (1 at the citadel, 1 + PROW_BATTER at its foot on tier 1) */
export function prowFlare(y: number): number {
  const y0 = tierY(1) - 0.1;
  const f = Math.min(1, Math.max(0, (y - y0) / (CITADEL_Y - y0)));
  return 1 + PROW_BATTER * (1 - f);
}

/** inside the prow's footprint (+ margin) at height `y` (default: the crest), local point */
export function onProw(x: number, z: number, margin: number, y = CITADEL_Y): boolean {
  const [d, p] = toProw(x, z);
  if (d < PROW[0][0] - margin || d > PROW[5][0] + margin) return false;
  return Math.abs(p) < prowHalf(Math.min(PROW[5][0], Math.max(PROW[0][0], d))) * prowFlare(y) + margin;
}

/**
 * The great buildings breaking the uniform scatter of houses (S4 W5, C2 #10): domed halls, long halls and
 * towers at 2–3× a house's height on the middle of tiers 2–6, spread over the faces seen from the Pelennor
 * (tier, compass bearing from C, kind).
 */
const GREAT: [number, number, 'dome' | 'hall' | 'tower'][] = [
  [2, 52, 'hall'],
  [2, 80, 'tower'],
  [2, 140, 'dome'],
  [2, 166, 'hall'],
  [3, 45, 'dome'],
  [3, 128, 'tower'],
  [3, 158, 'hall'],
  [4, 62, 'tower'],
  [4, 92, 'dome'],
  [4, 150, 'hall'],
  [5, 56, 'hall'],
  [5, 140, 'dome'],
  [6, 76, 'tower'],
  [6, 134, 'hall'],
];
/** the half-width (km) a great building claims along its terrace */
const GREAT_HALF: Record<'dome' | 'hall' | 'tower', number> = { dome: 0.22, hall: 0.3, tower: 0.13 };
/** the radius of tier i's middle row */
const midRow = (a: TierArc): number => (RADII[a.i] + a.rTop) / 2;

/** the terrace bodies, parapets with their copings, bastions and turrets of tiers 1…7; returns the arcs */
export function buildTiers(k: ProxyKit): TierArc[] {
  const arcs: TierArc[] = [];
  for (let i = 1; i <= TIERS; i++) {
    const a = tierArc(k, i);
    arcs.push(a);
    const full = a.bLo <= -89.9;
    const ring = arc(a.R, a.bLo, full ? a.bLo + 360 : a.bHi, a.R > 4 ? 76 : 52).map(([x, z]): V2 => [x - C[0], z - C[1]]);
    if (full) ring.pop();
    const y0 = i === 1 ? -0.3 : tierY(i - 1) - 0.12;
    const H = a.top - y0;
    // the terrace body: a battered retaining wall, its top the terrace paving
    k.loft(
      'stone',
      [
        { outline: ring, y: 0 },
        { outline: ring, y: H, scale: a.rTop / a.R },
      ],
      { at: [C[0], y0, C[1]], color: WALL, shade: 0.97 + 0.02 * (i % 3), grain: 0.16, lod: 2 },
    );
    // buttress pilasters up the wall face (the film's vertical rhythm), clear of the prow and the cliff
    const wallH = a.top - Math.max(0, tierY(i - 1)) - 0.02;
    for (let b = a.bLo + 2; b <= a.bHi - 2; b += (0.42 / a.R) / DEG) {
      const [x, z] = polarC(b, a.R - BATTER * 0.5);
      if (k.ground(x, z) > a.top - 0.1 || onProw(x, z, 0.08, a.top)) continue;
      k.box('stone', 0.045, wallH, 0.055, { at: [x, Math.max(0, tierY(i - 1)) - 0.01, z], rot: [0, 180 - b, 0], color: WALL, shade: 0.96, lod: 0 });
    }
    // the parapet along the terrace edge (merlons on the outer wall and the citadel) under a projecting
    // coping: a bright band with a dark shadow line, taller than the front-row roofs behind it
    const outer = i === 1;
    const ph = outer ? PARAPET.outer : PARAPET.inner;
    const pt = outer ? 0.085 : 0.06;
    const rp = a.rTop - pt / 2;
    const edge = full ? arc(rp, a.bLo, a.bLo + 360, 64) : arc(rp, a.bLo, a.bHi, a.R > 4 ? 64 : 44);
    const crenel = i === 1 || i === TIERS ? { w: 0.045, h: 0.035, gap: 0.035, lod: 0 as const } : undefined;
    k.wallPath('stone', edge, ph, pt, { at: [0, a.top - 0.01, 0], closed: full, color: WALL, shade: 1.02, lod: 1 });
    k.wallPath('stone', edge, PARAPET.coping, pt + PARAPET.overhang * 2, {
      at: [0, a.top - 0.01 + ph, 0],
      closed: full,
      color: WALL,
      shade: 1.05,
      lod: 1,
      ...(crenel ? { crenel } : {}),
    });
  }

  // ---- bastions on the outer wall (seated on the bench), the gate between two square towers
  const t1 = arcs[0];
  for (let b = t1.bLo + 8 + k.r(1) * 3; b <= t1.bHi - 6; b += 12 + k.r(2) * 7) {
    if (Math.abs(b - GATE_BEARING) < 9) continue;
    const [x, z] = polarC(b, t1.R + 0.06);
    if (k.ground(x, z) > t1.top - 0.15) continue;
    const big = k.r(3) < 0.3;
    k.tower('stone', big ? 0.2 : 0.15, t1.top + PARAPET.outer + (big ? 0.3 : 0.14), { at: [x, 0, z], seat: true, sides: 12, roof: 'crenel', color: WALL, shade: 0.98 + k.r(4) * 0.08 });
  }
  // ---- turrets and half-round bastions on the inner walls (standing on the terrace below)
  for (let i = 2; i < TIERS; i++) {
    const a = arcs[i - 1];
    const below = tierY(i - 1);
    const stepDeg = (1.55 / a.R) / DEG;
    for (let b = a.bLo + stepDeg * (0.35 + 0.3 * (i % 2)); b <= a.bHi - 4; b += stepDeg) {
      const [x, z] = polarC(b, a.R + 0.03);
      if (k.ground(x, z) > a.top - 0.1 || onProw(x, z, 0.2, a.top)) continue;
      const cone = (i + Math.round(b)) % 3 === 0;
      k.tower('stone', 0.11, stepOf(i) + PARAPET.inner + 0.08, {
        at: [x, below - 0.02, z],
        sides: 12,
        roof: cone ? 'cone' : 'crenel',
        roofFam: 'slate',
        roofColor: SLATE[i % SLATE.length],
        roofH: 0.2,
        color: WALL,
        shade: 1.04,
        lod: 0,
      });
    }
  }
  return arcs;
}

/** a house lot (pass 1), built in pass 2 once the lit windows are chosen */
interface Lot {
  tier: number;
  row: number;
  b: number;
  r: number;
  x: number;
  z: number;
  w: number;
  depth: number;
  top: number;
  u: number;
}

/** the lit-window budget of the houses (the landmark's budget is 400 lights in all) */
const WINDOW_LIGHTS = 360;
/** the facades facing the Pelennor and the hero camera (bearings from C) get the lit windows */
const LIT_ARC: [number, number] = [22, 196];

/** jittered stone: ±6 % value, a few warm and cool tints */
function stoneTint(k: ProxyKit): number {
  const v = 1 + (k.r(31) - 0.5) * 0.12;
  const t = k.r(32);
  const [dr, dg, db] = t < 0.25 ? [0.03, 0.01, -0.03] : t < 0.5 ? [-0.025, 0, 0.03] : [0, 0, 0];
  const ch = (c: number, d: number) => Math.round(Math.min(255, Math.max(0, c * v * (1 + d))));
  const r = (STONE >> 16) & 255;
  const g = (STONE >> 8) & 255;
  const bb = STONE & 255;
  return (ch(r, dr) << 16) | (ch(g, dg) << 8) | ch(bb, db);
}

/**
 * The houses: rows along each terrace (tiers 1…6) — the back row against the wall of the tier above but
 * lower than it (so its bright band shows; every tenth one a tall house breaking the skyline), the middle
 * row lower, the front row below the parapet — skipping the prow, the cliff (where the face stands above
 * the terrace) and the gate court. Every ~12th lot is a slim turret. LOD0 only. Lit windows: chosen evenly
 * by tier and bearing over the arc facing the Pelennor; each lit window is a glowing (night-gated) opening
 * plus a window light.
 */
export function buildHouses(k: ProxyKit, arcs: TierArc[]): number {
  // ---- pass 1: the lots
  const lots: Lot[] = [];
  for (let i = 1; i < TIERS; i++) {
    const a = arcs[i - 1];
    const rIn = RADII[i];
    const rOut = a.rTop - 0.1;
    const width = rOut - rIn;
    const rows = 3;
    for (let row = 0; row < rows; row++) {
      // 0 = back (against the upper wall), rows − 1 = front (by the parapet)
      const back = row === 0;
      const front = row === rows - 1;
      const depth = (back ? 0.15 + k.r(1) * 0.05 : front ? 0.1 + k.r(1) * 0.03 : 0.12 + k.r(1) * 0.04) * Math.min(1, width / 0.5);
      const r = back ? rIn + depth / 2 + 0.02 : front ? rOut - depth / 2 - 0.015 : (rIn + 0.04 + 0.17 * Math.min(1, width / 0.5) + rOut - 0.03) / 2 + (k.r(2) - 0.5) * 0.03;
      let b = a.bLo + 3 + k.r(3) * 2;
      while (b < a.bHi - 3) {
        const w = 0.1 + k.r(4) * 0.14;
        const [x, z] = polarC(b, r);
        const skip =
          k.ground(x, z) > a.top - 0.03 ||
          onProw(x, z, 0.1 + w / 2, a.top) ||
          (i === 1 && Math.abs(b - GATE_BEARING) < 3.2) ||
          GREAT.some(([gi, gb, kind]) => gi === i && Math.abs(b - gb) * DEG * r < GREAT_HALF[kind] + w / 2 + 0.02) ||
          k.r(5) < 0.06;
        if (!skip) lots.push({ tier: i, row, b, r, x, z, w, depth, top: a.top, u: k.r(6) });
        b += ((w + 0.012 + k.r(12) * 0.035) / r) / DEG;
      }
    }
  }
  // ---- the lit lots: evenly by tier and bearing (houses only, not turrets) on the lit arc
  const lit = new Set<Lot>();
  const facing = lots.filter((l, n) => n % 12 !== 7 && l.b >= LIT_ARC[0] && l.b <= LIT_ARC[1]);
  const want = WINDOW_LIGHTS / 2;
  for (let i = 1; i < TIERS; i++) {
    const tier = facing.filter((l) => l.tier === i).sort((p, q) => p.b - q.b || p.row - q.row);
    const m = Math.min(tier.length, Math.round((want * tier.length) / Math.max(1, facing.length)));
    for (let j = 0; j < m; j++) lit.add(tier[Math.floor(((j + 0.5) * tier.length) / m)]);
  }

  // ---- pass 2: the buildings
  lots.forEach((l, lot) => {
    const back = l.row === 0;
    const front = l.row === 2;
    const yaw = 180 - l.b;
    const { x, z, w, depth } = l;
    if (lot % 12 === 7) {
      const tr = 0.04 + k.r(6) * 0.025;
      k.tower('weathered', tr, (back ? 0.5 : front ? 0.12 : 0.36) + k.r(7) * 0.18, {
        at: [x, l.top - 0.01, z],
        sides: 8,
        roof: k.r(8) < 0.5 ? 'cone' : 'dome',
        roofFam: 'slate',
        roofColor: SLATE[lot % SLATE.length],
        roofH: tr * 2.2,
        color: stoneTint(k),
        grain: 0.26,
        lod: 0,
      });
      return;
    }
    // back row covering the lower half of the wall above (a tenth of them tall, rising past its parapet:
    // the film's skyline of buildings over the walls), the middle row lower, the front row below the
    // parapet — so each tier reads as a band of roofs under a band of pale wall
    const tall = back && k.r(13) < 0.1;
    const h = tall ? stepOf(l.tier + 1) * (1.05 + k.r(6) * 0.25) : back ? 0.36 + k.r(6) * 0.2 : front ? 0.07 + k.r(6) * 0.04 : 0.26 + k.r(6) * 0.14;
    const u = k.r(7);
    const roof = u < 0.15 ? 'flat' : u < 0.62 ? 'hip' : u < 0.9 ? 'gable' : 'dome';
    const yawUsed = yaw + (k.r(8) - 0.5) * 6;
    k.house('weathered', 'slate', w, depth, h, {
      at: [x, l.top - 0.01, z],
      rot: [0, yawUsed, 0],
      seat: false,
      roof,
      pitch: 40 + k.r(9) * 12,
      overhang: 0.012,
      color: stoneTint(k),
      grain: 0.26,
      roofColor: roof === 'dome' ? DOME[lot % DOME.length] : SLATE[lot % SLATE.length],
      roofShade: 0.9 + k.r(11) * 0.2,
      lod: 0,
    });
    // window openings on the facade over the Pelennor: 2–3 per row, two rows on tall houses; on a lit
    // house the openings of one row glow at night and carry the window lights
    const yr = yawUsed * DEG;
    const [ox, oz] = [Math.sin(yr), Math.cos(yr)];
    const [tx, tz] = [Math.cos(yr), -Math.sin(yr)];
    const nw = w > 0.17 ? 3 : 2;
    const nr = h > 0.4 ? 2 : 1;
    const on = lit.has(l);
    const litRow = nr === 2 ? (k.r(14) < 0.5 ? 0 : 1) : 0;
    let lights = 0;
    for (let wr = 0; wr < nr; wr++) {
      const wy = l.top + h * (nr === 2 ? 0.3 + wr * 0.34 : 0.5);
      for (let q = 0; q < nw; q++) {
        const f = (q - (nw - 1) / 2) * (w / nw);
        const at: [number, number, number] = [x + ox * (depth / 2) + tx * f, wy, z + oz * (depth / 2) + tz * f];
        const glow = (on && wr === litRow && q < 2) || (!on && l.b >= LIT_ARC[0] && l.b <= LIT_ARC[1] && k.r(15) < 0.1);
        if (glow) {
          k.box('emissive', 0.024, 0.042, 0.01, { at, rot: [0, yawUsed, 0], color: WINDOW_LIT, glow: { gate: 'night', strength: 8 }, lod: 0 });
          if (on && lights < 2) {
            k.light([at[0] + ox * 0.008, wy + 0.021, at[2] + oz * 0.008], { kind: 'window', color: 0xffb35c, intensity: 2.4, radius: 0.013 });
            lights++;
          }
        } else k.box('darkStone', 0.024, 0.042, 0.01, { at, rot: [0, yawUsed, 0], color: WINDOW, lod: 0 });
      }
    }
  });

  // ---- the great buildings (S4 W5): domed halls, long hipped halls and towers on the middle rows
  GREAT.forEach(([i, b, kind], n) => {
    const a = arcs[i - 1];
    const r = midRow(a);
    const [x, z] = polarC(b, r);
    if (k.ground(x, z) > a.top - 0.03 || onProw(x, z, 0.15, a.top)) return;
    const yaw = 180 - b;
    const tint = stoneTint(k);
    if (kind === 'tower') {
      const tr = 0.085 + k.r(40 + n) * 0.03;
      k.tower('weathered', tr, 0.95 + k.r(41 + n) * 0.35, { at: [x, a.top - 0.01, z], sides: 8, roof: n % 2 ? 'dome' : 'cone', roofFam: 'slate', roofColor: SLATE[n % SLATE.length], roofH: tr * 2.6, color: tint, grain: 0.26, lod: 1 });
    } else {
      const w = kind === 'hall' ? 0.5 + k.r(42 + n) * 0.1 : 0.34;
      const d = kind === 'hall' ? 0.24 : 0.3;
      k.house('weathered', 'slate', w, d, kind === 'hall' ? 0.62 + k.r(43 + n) * 0.2 : 0.5, {
        at: [x, a.top - 0.01, z],
        rot: [0, yaw, 0],
        seat: false,
        roof: kind === 'hall' ? 'hip' : 'dome',
        pitch: 34,
        overhang: 0.015,
        color: tint,
        grain: 0.26,
        roofColor: kind === 'dome' ? DOME[n % DOME.length] : SLATE[n % SLATE.length],
        lod: 1,
      });
    }
  });
  return lots.length;
}

/**
 * The LOD1 roofscape: per terrace one strip of merged blocks in the middle of the terrace — a sawtooth
 * of stone walls with a dark window band and slate roofs — standing in for the houses (LOD0 only) from
 * the middle distance on, so the switch to LOD1 keeps the city's texture and the wide shot is never a
 * smooth wedding cake. In LOD0 it sits low among the houses as infill.
 */
export function buildRoofscape(k: ProxyKit, arcs: TierArc[]): void {
  for (let i = 1; i < TIERS; i++) {
    const a = arcs[i - 1];
    const rIn = RADII[i] + 0.08;
    const rOut = a.rTop - 0.16;
    if (rOut - rIn < 0.08) continue;
    const seg = (0.38 / ((rIn + rOut) / 2)) / DEG;
    for (let b = a.bLo + 3; b < a.bHi - 3; b += seg) {
      const b1 = Math.min(a.bHi - 3, b + seg * 0.92);
      const [mx, mz] = polarC((b + b1) / 2, (rIn + rOut) / 2);
      if (k.ground(mx, mz) > a.top - 0.03 || onProw(mx, mz, 0.12, a.top)) continue;
      const cut = (rOut - rIn) * (0.12 + k.r(21) * 0.2);
      const r0 = rIn + (k.r(22) < 0.5 ? cut : 0);
      const r1 = rOut - (k.r(23) < 0.5 ? cut : 0);
      const outline: V2[] = [polarC(b, r0), polarC(b1, r0), polarC(b1, r1), polarC(b, r1)].reverse();
      const h = 0.14 + k.r(24) * 0.14;
      k.extrude('weathered', outline, h, { at: [0, a.top - 0.01, 0], color: STONE, shade: 0.96 + k.r(25) * 0.08, grain: 0.3, lod: 1 });
      // the window band: a dark course just proud of the outer face
      const wb: V2[] = [polarC(b, r1 - 0.012), polarC(b1, r1 - 0.012), polarC(b1, r1 + 0.006), polarC(b, r1 + 0.006)].reverse();
      k.extrude('darkStone', wb, 0.035, { at: [0, a.top - 0.01 + h * 0.5, 0], color: 0x4a4c50, lod: 1 });
      // the roof: a hipped slate cap
      k.extrude('slate', outline, 0.07, { at: [0, a.top - 0.01 + h, 0], taper: 0.45, color: SLATE[(i + Math.round(b)) % SLATE.length], lod: 1 });
    }
  }
}
