import { rand, valueNoise } from '../../core/rng.ts';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2 } from '../records.ts';
import { PROW_BATTER, type TierArc, WALL, onProw } from './city.ts';
import { BEACON, C, CITADEL_Y, GATE_BEARING, PROW, PROW_YAW, RADII, TOWER, fromProw, polarC, tierY } from './layout.ts';

/**
 * the prow's rock: weathered grey limestone, darker than the walls (S4 W5, C2 #10: in the wall colour it
 * read as a thin smooth slab — rock, not masonry; S4.5: 0x9b9a92 → a shade lighter, so the shaded face takes
 * the sky light and its blocks show instead of a flat dark slab)
 */
const ROCK = 0xa9a79e;
/** the prow's stem rake: at its foot the keel edge stands this fraction of the prow's length further back */
const PROW_RAKE = 0.13;
const SLATE = 0x63676c;
/** the White Tower: the palest stone of the city (highlight #d2c6b7), still not white */
const TOWER_STONE = 0xdcd9d0;
/** the citadel's buildings: pale dressed stone */
const CITADEL_STONE = [0xd2d0c9, 0xcbc9c2, 0xd6d3cb, 0xc8c6bf];

/**
 * The prow: a keel of rock from inside the citadel to its edge over the second tier wall above the
 * Great Gate, level with the citadel on top (a paved terrace with a parapet round its edge). Its faces are
 * blocky fractured limestone — irregular blocks pushed in and out by quantised noise, crossed by oblique
 * bedding (strata dipping along the keel) — low in amplitude, battered at the foot; the keel edge and the
 * crest stay clean.
 */
export function buildProw(k: ProxyKit): void {
  const y0 = tierY(1) - 0.1;
  const span = CITADEL_Y - y0;
  // the outline densified along both faces (root → tip → root), so the rock can break into blocks
  const ring: V2[] = [];
  for (let e = 0; e < PROW.length - 1; e++) {
    const [a, b] = [PROW[e], PROW[e + 1]];
    const n = 6;
    for (let j = 0; j < n; j++) ring.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  ring.push(PROW[PROW.length - 1]);
  const tip = ring.findIndex(([d, p]) => d === PROW[5][0] && p === 0);
  const fs = [0, 0.08, 0.17, 0.26, 0.35, 0.44, 0.53, 0.62, 0.71, 0.8, 0.88, 0.95, 1];
  const secs = fs.map((f) => {
    const outline = ring.map(([d, p], vi): V2 => {
      if (f === 1) return [d, p];
      const side = Math.sign(p) || 1;
      // blocks: noise quantised to four levels on a coarse (along, up) grid — irregular fractured blocks
      // (S4.5: amplitude 0.15 → 0.22 km, the blocks break the shaded face in minas-tirith-close / -wide)
      const q = valueNoise(d * 2.6 + side * 7.1, f * 4.2, 9105);
      const block = 0.22 * (Math.floor(q * 4) / 3 - 0.5);
      // oblique bedding: a sawtooth of ledges dipping along the keel
      const ph = f * 9 + d * 0.8 + side * 0.3;
      const strata = 0.03 * (ph - Math.floor(ph) - 0.5);
      const broad = 0.05 * (valueNoise(d * 1.1 + side * 5.1, f * 2.0, 9101) - 0.5);
      const bulge = (block + strata + broad) * Math.sin(Math.min(1, f / 0.95) * Math.PI * 0.5 + 0.35);
      // (S4 W5: the keel flares to ≈ 1.4× its crest width at its foot; fix round, the critic's 'flat dark
      // box': the front raked like a ship's stem — the keel edge leans out toward the crest, the foot pulled
      // back along the axis by PROW_RAKE of its length, so the shaded face is a tapering wedge)
      const batter = PROW_BATTER * (1 - f);
      const edge = vi === tip ? 0.25 : 1;
      const dr = PROW[0][0] + (d - PROW[0][0]) * (1 - PROW_RAKE * (1 - f) ** 1.3);
      return [dr - 0.05 * (1 - f) + (vi === tip ? 0.05 * (1 - f) : 0), p * (1 + batter) + side * bulge * edge];
    });
    return { outline, y: span * f };
  });
  k.loft('weathered', secs, { at: [C[0], y0, C[1]], rot: [0, PROW_YAW, 0], color: ROCK, grain: 0.4, lod: 2 });
  // the battlement along the crest (open at the root, where the prow joins the citadel)
  k.wallPath(
    'stone',
    PROW.map(([d, p]) => fromProw(d, p * 0.97)),
    0.06,
    0.035,
    { at: [0, CITADEL_Y, 0], color: WALL, lod: 1, crenel: { w: 0.035, h: 0.03, gap: 0.03, lod: 0 } },
  );
}

/**
 * The citadel on the seventh tier: the White Tower of Ecthelion (a slim shaft with banded storeys, a
 * gallery, a crown and a short spire — the top accent of the city), the Hall of the Kings before it, and
 * a ring of tall buildings round the citadel wall (where the citadel stands clear of the mountain).
 */
export function buildCitadel(k: ProxyKit): void {
  const y = CITADEL_Y - 0.01;
  const [tx, tz] = TOWER.at;
  const { h, r } = TOWER;
  // the White Tower (lathe profile, base to spire tip)
  k.lathe(
    'stone',
    [
      [r * 1.35, 0],
      [r * 1.3, h * 0.08],
      [r * 1.05, h * 0.1],
      [r, h * 0.36],
      [r * 1.12, h * 0.37],
      [r * 1.12, h * 0.39],
      [r * 0.95, h * 0.4],
      [r * 0.88, h * 0.78],
      [r * 1.16, h * 0.8],
      [r * 1.16, h * 0.83],
      [r * 0.95, h * 0.84],
      [r * 0.95, h * 0.9],
      [r * 1.08, h * 0.91],
      [r * 1.08, h * 0.93],
      [r * 0.7, h * 0.935],
      [0.0, h * 1.08],
    ],
    { at: [tx, y, tz], color: TOWER_STONE, seg: 20, grain: 0.12 },
  );
  // the Hall of the Kings, east of the tower along the axis
  k.house('stone', 'slate', 0.7, 0.36, 0.32, { at: [C[0] + 0.25, y, C[1]], rot: [0, 90 - GATE_BEARING, 0], seat: false, roof: 'hip', pitch: 32, overhang: 0.012, color: 0xd4d1c9, roofColor: SLATE, lod: 1, windows: { count: 3, on: 0.67, sides: 2, size: 0.012 } });
  // the citadel's buildings in a ring along its wall (tall, facing out), clear of the prow, the tower and
  // the cliff
  const rr = RADII[6] - 0.26;
  let lot = 0;
  for (let b = -60; b < 240; b += 8 + k.r(1) * 4) {
    const [x, z] = polarC(b, rr);
    if (onProw(x, z, 0.2)) continue;
    if (Math.hypot(x - tx, z - tz) < r * 1.35 + 0.18) continue;
    if (k.ground(x, z) > y - 0.03) continue;
    const w = 0.16 + k.r(2) * 0.12;
    k.house('stone', 'slate', w, 0.2, 0.26 + k.r(3) * 0.3, {
      at: [x, y, z],
      rot: [0, 180 - b, 0],
      seat: false,
      roof: k.r(4) < 0.3 ? 'flat' : 'hip',
      pitch: 38,
      overhang: 0.01,
      color: CITADEL_STONE[lot % CITADEL_STONE.length],
      shade: 0.98 + k.r(5) * 0.06,
      roofColor: SLATE,
      lod: 0,
      ...(lot % 3 === 0 ? { windows: { count: 2, on: 0.7, sides: 1 as const, size: 0.012, intensity: 2 } } : {}),
    });
    lot++;
  }
}

/** The Great Gate in the outer wall, facing east between two square towers, under the prow's keel. */
export function buildGate(k: ProxyKit): void {
  const R = RADII[0];
  const top = tierY(1);
  const half = 4.3; // deg either side of the gate axis
  const t = (GATE_BEARING * Math.PI) / 180;
  const [ox, oz] = [Math.sin(t), -Math.cos(t)];
  for (const s of [-1, 1]) {
    const [x, z] = polarC(GATE_BEARING + s * half, R + 0.1);
    k.tower('stone', 0.26, top + 0.72, { at: [x, 0, z], seat: true, sides: 4, rot: [0, 45 + 90 - GATE_BEARING, 0], roof: 'crenel', color: WALL, shade: 1.04 });
    k.light([x + ox * 0.2, 0.36, z + oz * 0.2], { kind: 'lamp', color: 0xffb35c, intensity: 1.2, radius: 0.02 });
  }
  // the gate: dark iron leaves in a deep recess, a heavier band of stone over it
  const [gx, gz] = polarC(GATE_BEARING, R + 0.02);
  k.box('iron', 0.05, 0.46, 0.3, { at: [gx, 0, gz], seat: 'min', rot: [0, 90 - GATE_BEARING, 0], color: 0x2a2a28 });
  k.box('stone', 0.12, 0.14, 0.5, { at: [gx - ox * 0.02, 0.48, gz - oz * 0.02], rot: [0, 90 - GATE_BEARING, 0], color: WALL, shade: 0.94 });
}

/**
 * The apron at the outer wall's foot (S4 W5, C2 #10: the wall met a flat lawn in one hard line): patches of
 * trodden earth, gravel and broken rock along the wall's foot, broken by turf — an inner row of long
 * patches from under the wall out to 0.2–0.4 km, an outer row of shorter, scattered ones out to ≈ 0.6 km,
 * each of its own tone and ragged on its outer edge. Each patch is a low slab whose flat top stands
 * APRON_H over the highest ground under it, so a patch is laid only where the ground under ALL its outline
 * vertices and its centre line is level within APRON_LEVEL (fix round — the review's 0.35 km plinth: the
 * S4 W5 band was one slab over 175° whose top stood on its highest ground while the bench fell away by the
 * Great Gate); patches span ≤ 1 km, so each top tracks its own ground. (APRON_H ≈ 20 m: the seating gate
 * counts a thinner slab, sunk SINK, as buried — under a pixel at the hero's 55 km.)
 */
const APRON_H = 0.021;
const APRON_LEVEL = 0.01;
export function buildApron(k: ProxyKit, t1: TierArc): void {
  // (its own random stream: the author stream k.r() would reshuffle every house built after it)
  let id = 0;
  const r = (kk: number): number => rand(0x61707231, id, kk);
  const TONES = [0x857c6a, 0x7b7364, 0x8f887a, 0x6f6a60, 0x938a76];
  const [cx, cz] = C;
  for (const row of [0, 1]) {
    let b = t1.bLo + 1 + r(1) * 3;
    while (b < t1.bHi - 2) {
      // patch length (deg of arc: 1° ≈ 0.11 km on the outer wall), then a gap of turf
      const len = row ? 2 + r(2) * 5 : 4 + r(2) * 5;
      const b1 = Math.min(t1.bHi - 1, b + len);
      if (r(3) < (row ? 0.55 : 0.85)) {
        const w = row ? 0.1 + r(4) * 0.15 : 0.2 + r(4) * 0.2;
        const r0 = row ? t1.R + 0.25 + r(5) * 0.2 : t1.R - 0.05;
        const ph = r(6) * 10;
        const n = Math.max(2, Math.ceil(b1 - b));
        const outer: V2[] = [];
        const inner: V2[] = [];
        const mid: V2[] = [];
        for (let j = 0; j <= n; j++) {
          const bb = b + ((b1 - b) * j) / n;
          // the outer edge ragged, the patch's ends tapering in
          const end = Math.min(1, Math.min(j, n - j) / 1.5 + 0.35);
          const ww = w * end * (0.75 + 0.5 * valueNoise(bb * 0.7 + ph, 2.3 + row, 9137));
          outer.push(polarC(bb, r0 + ww));
          inner.push(polarC(bb, row ? r0 + w * 0.15 * (1 - end) : r0));
          mid.push(polarC(bb, r0 + ww / 2));
        }
        const gs = [...outer, ...inner, ...mid].map(([x, z]) => k.ground(x, z));
        const lo = Math.min(...gs);
        const hi = Math.max(...gs);
        if (hi - lo <= APRON_LEVEL && lo > -0.03 && hi < 0.04) {
          const ring = [...outer, ...inner.reverse()].map(([x, z]): V2 => [x - cx, z - cz]);
          k.extrude('weathered', ring, APRON_H, { at: [cx, 0, cz], followGround: true, color: TONES[Math.floor(r(7) * TONES.length)], grain: 0.5, lod: 1 });
        }
      }
      id++;
      b = b1 + (row ? 2 + r(8) * 6 : 0.5 + r(8) * 2.5);
    }
  }
}

/**
 * The beacon crag on the cliff top above the city: a rock spire, a stone platform and the timber pile
 * (its `beacon` light is switched on by the S4 timeline).
 */
export function buildBeacon(k: ProxyKit): void {
  const [x, z] = BEACON;
  const g = k.ground(x, z);
  k.rock('weathered', 0.22, { at: [x, 0.05, z], seat: true, squash: 1.3, lump: 0.3, color: 0x5d5d5a, lod: 1 });
  const top = g + 0.24;
  k.cylinder('stone', 0.085, 0.1, 0.07, { at: [x, top - 0.04, z], seg: 10, color: 0x9d9686 });
  k.cone('wood', 0.07, 0.1, { at: [x, top + 0.03, z], seg: 8, color: 0x4a3828 });
  k.light([x, top + 0.12, z], { kind: 'beacon', color: 0xffa040, intensity: 4, radius: 0.08 });
}
