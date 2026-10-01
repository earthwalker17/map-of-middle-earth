import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2 } from '../records.ts';
import { C, GATE_BEARING, PROW, RADII, STEP, TIERS, polarC, prowHalf, tierY, toProw } from './layout.ts';

/**
 * The seven tiers of the White City (research §9; the RotK prow-and-tiers stills, the 1:72 bigature):
 * concentric terrace bodies of warm off-white limestone (#c5b59b; lit #a49b8b, highlights #d2c6b7 —
 * never white), each a battered retaining wall one STEP tall rising from the terrace below, closed at the
 * back by a chord buried in the cliff face; a parapet along every terrace edge (merlons on the outer wall
 * and the citadel), round bastions on the outer wall, turrets on the inner walls; and the houses — tall
 * narrow stone buildings with flat, hipped and domed slate roofs packed in rows along the terraces (tall
 * against the wall of the tier above, low along the parapet), ~1000 of them (LOD0 only), every third one
 * with lit windows facing out over the Pelennor.
 */

/**
 * off-white limestone, never white — painted a little cool: the dawn key light is golden, and the film's
 * lit stone (#a49b8b … #d2c6b7) is a near-neutral warm grey, not sand
 */
export const STONE = [0xcfcfcb, 0xd5d4cf, 0xc8c8c3, 0xd8d6d0, 0xcbcac4, 0xbfbebb];
/** the terrace paving and the retaining walls (a touch greyer than the houses: the lit #a49b8b) */
export const WALL = 0xcac9c3;
/** slate and lead roofs, grey-blue */
const SLATE = [0x5f6266, 0x686b6e, 0x585b5f, 0x707274, 0x63666a];
/** pale lead / stone domes */
const DOME = [0xa9a69c, 0x9fa3a3, 0xb4ad9c];

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

/** inside the prow's footprint (+ margin), local point */
export function onProw(x: number, z: number, margin: number): boolean {
  const [d, p] = toProw(x, z);
  if (d < PROW[0][0] - margin || d > PROW[5][0] + margin) return false;
  return Math.abs(p) < prowHalf(Math.min(PROW[5][0], Math.max(PROW[0][0], d))) + margin;
}

/** the terrace bodies, parapets, bastions and turrets of tiers 1…7; returns the arcs */
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
      { at: [C[0], y0, C[1]], color: WALL, shade: 0.96 + 0.02 * (i % 3), grain: 0.18, lod: 2 },
    );
    // buttress pilasters up the wall face (the film's vertical rhythm), clear of the prow and the cliff
    const wallH = a.top - Math.max(0, tierY(i - 1)) - 0.02;
    for (let b = a.bLo + 2; b <= a.bHi - 2; b += (0.42 / a.R) / DEG) {
      const [x, z] = polarC(b, a.R - BATTER * 0.5);
      if (k.ground(x, z) > a.top - 0.1 || onProw(x, z, 0.08)) continue;
      k.box('stone', 0.045, wallH, 0.055, { at: [x, Math.max(0, tierY(i - 1)) - 0.01, z], rot: [0, 180 - b, 0], color: WALL, shade: 0.97, lod: 0 });
    }
    // the parapet along the terrace edge (merlons on the outer wall and the citadel)
    const edge = full ? arc(a.rTop - 0.02, a.bLo, a.bLo + 360, 64) : arc(a.rTop - 0.02, a.bLo, a.bHi, a.R > 4 ? 64 : 44);
    const crenel = i === 1 || i === TIERS ? { w: 0.045, h: 0.035, gap: 0.035, lod: 0 as const } : undefined;
    k.wallPath('stone', edge, i === 1 ? 0.09 : 0.06, i === 1 ? 0.06 : 0.04, { at: [0, a.top - 0.01, 0], closed: full, color: WALL, shade: 1.02, lod: 1, ...(crenel ? { crenel } : {}) });
  }

  // ---- bastions on the outer wall (seated on the bench), the gate between two square towers
  const t1 = arcs[0];
  for (let b = t1.bLo + 8 + k.r(1) * 3; b <= t1.bHi - 6; b += 12 + k.r(2) * 7) {
    if (Math.abs(b - GATE_BEARING) < 9) continue;
    const [x, z] = polarC(b, t1.R + 0.06);
    if (k.ground(x, z) > t1.top - 0.15) continue;
    const big = k.r(3) < 0.3;
    k.tower('stone', big ? 0.2 : 0.15, t1.top + (big ? 0.42 : 0.26), { at: [x, 0, z], seat: true, sides: 12, roof: 'crenel', color: WALL, shade: 0.98 + k.r(4) * 0.08 });
  }
  // ---- turrets and half-round bastions on the inner walls (standing on the terrace below)
  for (let i = 2; i < TIERS; i++) {
    const a = arcs[i - 1];
    const below = tierY(i - 1);
    const stepDeg = (1.55 / a.R) / DEG;
    for (let b = a.bLo + stepDeg * (0.35 + 0.3 * (i % 2)); b <= a.bHi - 4; b += stepDeg) {
      const [x, z] = polarC(b, a.R + 0.03);
      if (k.ground(x, z) > a.top - 0.1 || onProw(x, z, 0.2)) continue;
      const cone = (i + Math.round(b)) % 3 === 0;
      k.tower('stone', 0.11, STEP + 0.22, {
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

/** running count of window lights (the landmark's budget is 400 lights in all) */
const WINDOW_CAP = 380;

/**
 * The houses: rows along each terrace (tiers 1…6) — tall against the wall of the tier above, lower
 * towards the parapet — skipping the prow, the cliff (where the face stands above the terrace) and the
 * gate court. Every ~12th lot is a slim turret. LOD0 only.
 */
export function buildHouses(k: ProxyKit, arcs: TierArc[]): number {
  let n = 0;
  for (let i = 1; i < TIERS; i++) {
    const a = arcs[i - 1];
    const rIn = RADII[i];
    const rOut = a.rTop - 0.07;
    const width = rOut - rIn;
    const rows = 3;
    for (let row = 0; row < rows; row++) {
      // 0 = back (against the upper wall), rows − 1 = front (by the parapet)
      const back = row === 0;
      const front = row === rows - 1;
      const depth = (back ? 0.16 + k.r(1) * 0.05 : front ? 0.11 + k.r(1) * 0.03 : 0.13 + k.r(1) * 0.04) * Math.min(1, width / 0.62);
      const r = back ? rIn + depth / 2 + 0.02 : front ? rOut - depth / 2 - 0.015 : (rIn + 0.04 + 0.2 * Math.min(1, width / 0.62) + rOut - 0.03) / 2 + (k.r(2) - 0.5) * 0.03;
      let b = a.bLo + 3 + k.r(3) * 2;
      while (b < a.bHi - 3) {
        const w = 0.1 + k.r(4) * 0.14;
        const [x, z] = polarC(b, r);
        const skip =
          k.ground(x, z) > a.top - 0.03 ||
          onProw(x, z, 0.1 + w / 2) ||
          (i === 1 && Math.abs(b - GATE_BEARING) < 3.2) ||
          k.r(5) < 0.06;
        if (!skip) {
          const lot = n++;
          const yaw = 180 - b;
          const turret = lot % 12 === 7;
          if (turret) {
            const tr = 0.04 + k.r(6) * 0.025;
            k.tower('stone', tr, (back ? 0.42 : 0.3) + k.r(7) * 0.22, {
              at: [x, a.top - 0.01, z],
              sides: 8,
              roof: k.r(8) < 0.5 ? 'cone' : 'dome',
              roofFam: 'slate',
              roofColor: SLATE[lot % SLATE.length],
              roofH: tr * 2.2,
              color: STONE[lot % STONE.length],
              lod: 0,
            });
          } else {
            // tall against the wall of the tier above (they hide most of it, some rise past its parapet),
            // lower towards the parapet
            // every fifth one at the back a tall house rising past the parapet of the tier above (the
            // film's skyline of buildings over the walls, never a clean stepped cake)
            const tall = back && k.r(13) < 0.2;
            const h = tall ? STEP * (1.0 + k.r(6) * 0.35) : back ? 0.38 + k.r(6) * 0.5 : front ? 0.12 + k.r(6) * 0.2 : 0.24 + k.r(6) * 0.3;
            const u = k.r(7);
            const roof = u < 0.36 ? 'flat' : u < 0.74 ? 'hip' : u < 0.9 ? 'gable' : 'dome';
            const lit = (lot % 5 === 1 || lot % 5 === 3) && k.lights.length < WINDOW_CAP;
            const yawUsed = yaw + (k.r(8) - 0.5) * 6;
            k.house('stone', 'slate', w, depth, h, {
              at: [x, a.top - 0.01, z],
              rot: [0, yawUsed, 0],
              seat: false,
              roof,
              pitch: 26 + k.r(9) * 12,
              overhang: 0.008,
              color: STONE[lot % STONE.length],
              shade: 0.92 + k.r(10) * 0.14,
              roofColor: roof === 'dome' ? DOME[lot % DOME.length] : SLATE[lot % SLATE.length],
              roofShade: 0.9 + k.r(11) * 0.2,
              lod: 0,
              ...(lit ? { windows: { count: 2, on: 0.47, sides: 1 as const, size: 0.011, intensity: 1.8 } } : {}),
            });
            // dark window openings on the facade over the Pelennor: 2–3 per row, two rows on tall houses
            const yr = yawUsed * DEG;
            const [ox, oz] = [Math.sin(yr), Math.cos(yr)];
            const [tx, tz] = [Math.cos(yr), -Math.sin(yr)];
            const nw = w > 0.17 ? 3 : 2;
            const nr = h > 0.42 ? 2 : 1;
            for (let wr = 0; wr < nr; wr++) {
              const wy = a.top + h * (nr === 2 ? 0.3 + wr * 0.34 : 0.48);
              for (let q = 0; q < nw; q++) {
                const f = (q - (nw - 1) / 2) * (w / nw);
                k.box('darkStone', 0.024, 0.042, 0.01, { at: [x + ox * (depth / 2) + tx * f, wy, z + oz * (depth / 2) + tz * f], rot: [0, yawUsed, 0], color: 0x35322e, lod: 0 });
              }
            }
          }
        }
        b += ((w + 0.012 + k.r(12) * 0.035) / r) / DEG;
      }
    }
  }
  return n;
}
