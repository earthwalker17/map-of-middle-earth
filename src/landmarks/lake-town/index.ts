import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2 } from '../records.ts';
import { defineLandmark } from '../types.ts';
import { blockAt, CROSS, DECK, DECK_T, GRAND, insideTown, T, townBlocks, YAW, type Block } from './layout.ts';

/**
 * Lake-town (Esgaroth, research §15): a dense town of weathered grey timber houses on stilts out on the
 * Long Lake — steep dark shingle roofs, gable fronts on the canals, little spired turrets everywhere, the
 * Master's house with its tall tower, a bell tower — laced with canals (a broad Grand Canal, a cross
 * canal, narrow canals between the blocks, footbridges over them), joined to the west shore by a long
 * trestle bridge, lantern-lit at dusk (windows + lamps along the Grand Canal and the bridge; the
 * settlement aggregates into one warm spark in overviews). Layout and frame: layout.ts. Design scale
 * ≈ ×9 (houses 55–100 m wide): the town is ≈ 3 km across so it reads as a town of roofs from 20–25 km.
 */

/** weathered grey timber (the film: #7d7b76 / #595a58), a few browner boards */
const WALLS = [0x8a877f, 0x7d7b76, 0x6f6d67, 0x918d84, 0x837f76, 0x6e675d, 0x7a776f];
/** dark blue-grey shingle (#3f494e / #283235), frosted and weathered paler on many roofs */
const ROOFS = [0x5d666b, 0x4f585e, 0x6b7377, 0x454e54, 0x737a7c, 0x586064, 0x3f494e];
const DECK_C = 0x3e3a34;
const SKIRT = 0x1c1a17;
const POST = 0x2a2622;
const BRIDGE_C = 0x55504a;
const HULL = 0x3a3129;
const LANTERN = 0xf0a54a;
/** walkway left free along canal-facing deck edges, km */
const WALK = 0.022;
/** at most this many lights (shot-list budget 120) */
const MAX_LIGHTS = 118;

const DEG = Math.PI / 180;

/** unit outward normal of a block face in the town frame: 0 +v (south) · 1 +u · 2 −v · 3 −u */
const NRM: V2[] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];
/** house yaw so its local +z (the window side) looks along face `f` */
const FACE_YAW = [0, 90, 180, -90];

function buildTown(k: ProxyKit): void {
  const blocks = townBlocks();
  let lights = 0;
  const light = (x: number, y: number, z: number, kind: 'window' | 'lamp', intensity = 1, size = 0.01): void => {
    if (lights >= MAX_LIGHTS) return;
    lights++;
    // lanterns and windows are lit from golden hour (dusk gate): the prologue's town glows at sunset
    k.light([x, y, z], { kind, color: LANTERN, intensity, radius: size, gate: 'dusk' });
  };
  // house windows claim up to this many lights; the lamps (Grand Canal, bridge), the Master's house and
  // the bell tower take the rest of the budget
  let windowBudget = 66;
  let houseN = 0;

  /** is the water beyond face `f` of block `bk` at (u, v) open (no block within `reach`)? */
  const open = (u: number, v: number, f: number, reach = 0.05): boolean => !blockAt(blocks, u + NRM[f][0] * reach, v + NRM[f][1] * reach);

  /**
   * One timber house centred at (u, v) of the town frame, looking along face `f`: `along` = width along
   * the row, `deep` = depth into the block, `h` = wall height. Gable fronts turn the ridge onto the normal.
   */
  const house = (u: number, v: number, along: number, deep: number, h: number, f: number, o: { gable: boolean; lod: 0 | 1 | 2; lit: boolean; tall?: boolean }): void => {
    const i = houseN++;
    const [x, z] = T(u, v);
    const yaw = YAW + FACE_YAW[f] + (o.gable ? 90 : 0) + (k.r(1) - 0.5) * 3;
    const w = o.gable ? deep : along;
    const d = o.gable ? along : deep;
    const r = k.r(2);
    const roof = o.tall ? 'cone' : r < 0.1 ? 'hip' : 'gable';
    k.house('wood', 'slate', w, d, h, {
      at: [x, DECK - 0.002, z],
      seat: false,
      rot: [0, yaw, 0],
      roof,
      pitch: 58 + k.r(3) * 10,
      overhang: 0.006 + k.r(4) * 0.004,
      color: WALLS[i % WALLS.length],
      shade: 0.9 + k.r(5) * 0.2,
      roofColor: ROOFS[(i * 3 + 1) % ROOFS.length],
      roofGrain: 0.5,
      lod: o.lod,
      // carved gable boards with short horns (the film's town), ridge caps on some
      ...(roof === 'gable' && i % 5 !== 4 ? { gableBoards: { color: 0x4a443c, size: 0.0045, horn: 0.008 } } : {}),
      ...(i % 3 === 0 && roof === 'gable' ? { ridge: { color: 0x2b3134, size: 0.006 } } : {}),
      ...(i % 7 === 2 ? { chimney: true } : {}),
    });
    if (o.lit && windowBudget > 0) {
      windowBudget--;
      const [nu, nv] = NRM[f];
      const [lx, lz] = T(u + nu * (deep / 2 + 0.003), v + nv * (deep / 2 + 0.003));
      light(lx, DECK + h * (0.35 + k.r(6) * 0.3), lz, 'window', 0.9 + k.r(7) * 0.4, 0.008);
    }
  };

  /** a spired timber turret standing on the deck at (u, v) */
  const turret = (u: number, v: number, r: number, h: number, sides: number): void => {
    const [x, z] = T(u, v);
    k.tower('wood', r, h, {
      at: [x, DECK - 0.002, z],
      sides,
      rot: [0, YAW + (sides === 4 ? 45 : 0), 0],
      roof: 'spire',
      roofH: r * (3 + k.r(1) * 1.5),
      roofFam: 'slate',
      color: WALLS[(houseN + 2) % WALLS.length],
      roofColor: ROOFS[houseN % ROOFS.length],
      lod: 1,
    });
  };

  /** a row of houses along one face of a block, from s0 to s1 along the face (town-frame coordinate) */
  const row = (bk: Block, f: number, s0: number, s1: number, depth: number, inset: number, centre: number, inner = false): void => {
    if (depth < 0.04) return;
    let s = s0 + 0.004;
    let n = 0;
    while (s1 - s > 0.047) {
      const along = Math.min(s1 - s - 0.002, 0.055 + k.r(1) * 0.047);
      if (along < 0.044) break;
      const mid = s + along / 2;
      const deep = depth * (0.85 + k.r(2) * 0.15);
      // houses on the outer ring and the canals are taller towards the middle of the town
      const h = (0.06 + k.r(3) * 0.06) * (1 + 0.3 * (1 - Math.min(1, centre)));
      const off = inset + deep / 2;
      const [u, v] = f === 0 ? [mid, bk.v1 - off] : f === 2 ? [mid, bk.v0 + off] : f === 1 ? [bk.u1 - off, mid] : [bk.u0 + off, mid];
      const tall = k.r(4) < 0.06 && along < 0.078;
      // the inner rows (inside a block) drop out at LOD1; every third outer house stays in the silhouette LOD
      const lod = inner ? 0 : n % 3 === 0 ? 2 : 1;
      house(u, v, along, deep, tall ? h * 1.5 : h, f, { gable: k.r(5) < 0.55, lod, lit: k.r(6) < 0.42, tall });
      n++;
      // mostly shoulder to shoulder; now and then an alley
      s += along + (k.r(7) < 0.12 ? 0.026 + k.r(8) * 0.02 : 0.003 + k.r(9) * 0.008);
    }
  };

  // ---------------------------------------------------------------- decks, piles, house rows
  blocks.forEach((bk, bi) => {
    const j = (a: number) => (k.r(a) - 0.5) * 0.016;
    const quad: V2[] = [T(bk.u0 + j(1), bk.v0 + j(2)), T(bk.u1 + j(3), bk.v0 + j(4)), T(bk.u1 + j(5), bk.v1 + j(6)), T(bk.u0 + j(7), bk.v1 + j(8))];
    k.extrude('wood', quad, DECK_T, { at: [0, DECK - DECK_T, 0], color: DECK_C, shade: 0.85 + k.r(9) * 0.25 });
    // the dark space under the deck between the piles (reads as stilts from afar)
    const cu = (bk.u0 + bk.u1) / 2;
    const cv = (bk.v0 + bk.v1) / 2;
    const ins = (a: number, c: number) => a + Math.sign(c - a) * 0.016;
    const under: V2[] = [T(ins(bk.u0, cu), ins(bk.v0, cv)), T(ins(bk.u1, cu), ins(bk.v0, cv)), T(ins(bk.u1, cu), ins(bk.v1, cv)), T(ins(bk.u0, cu), ins(bk.v1, cv))];
    k.extrude('wood', under, DECK - DECK_T + 0.06, { at: [0, -0.06, 0], color: SKIRT, lod: 1 });
    // piles along the faces that look onto open water or the wide canals
    for (let f = 0; f < 4; f++) {
      const len = f % 2 === 0 ? bk.u1 - bk.u0 : bk.v1 - bk.v0;
      const n = Math.floor(len / 0.045);
      for (let p = 0; p <= n; p++) {
        const s = (f % 2 === 0 ? bk.u0 : bk.v0) + (len * p) / Math.max(1, n);
        const [u, v] = f === 0 ? [s, bk.v1] : f === 2 ? [s, bk.v0] : f === 1 ? [bk.u1, s] : [bk.u0, s];
        if (!open(u, v, f, 0.11)) continue;
        const [x, z] = T(u + NRM[f][0] * 0.005, v + NRM[f][1] * 0.005);
        k.box('wood', 0.015, DECK - DECK_T + 0.05, 0.015, { at: [x, -0.05, z], rot: [0, YAW, 0], color: POST, shade: 0.85 + k.r(1) * 0.3, lod: 0 });
      }
    }
    if (bk.role === 'master') return;
    const centre = Math.hypot(cu / 1.5, cv / 1.16);
    const depthV = bk.v1 - bk.v0;
    const depthU = bk.u1 - bk.u0;
    // which faces keep a walkway (canal-facing); outer faces over open lake run the houses to the edge
    const inset = (f: number, u: number, v: number) => (open(u, v, f, 0.28) ? 0.005 : WALK);
    const midU = cu;
    const midV = cv;
    const inN = inset(2, midU, bk.v0);
    const inS = inset(0, midU, bk.v1);
    const inW = inset(3, bk.u0, midV);
    const inE = inset(1, bk.u1, midV);
    if (bk.role === 'square') {
      // the market square: houses only along the two faces away from the canals, stalls on the deck
      const dN = Math.min(0.1, (depthV - 0.07) / 2);
      row(bk, 2, bk.u0 + inW, bk.u1 - inE, dN, inN, centre);
      row(bk, 3, bk.v0 + inN + dN, bk.v1 - inS, Math.min(0.095, depthU / 3), inW, centre);
      for (let s = 0; s < 6; s++) {
        const u = bk.u0 + inW + 0.13 + (s % 3) * 0.065 + k.r(1) * 0.013;
        const v = bk.v0 + inN + dN + 0.065 + Math.floor(s / 3) * 0.06;
        if (u > bk.u1 - 0.04 || v > bk.v1 - 0.04) continue;
        const [x, z] = T(u, v);
        k.house('wood', 'wood', 0.029, 0.023, 0.016, { at: [x, DECK - 0.002, z], seat: false, rot: [0, YAW, 0], roof: 'hip', pitch: 35, color: 0x6a5a48, roofColor: [0x7a3a2c, 0x3d5a7a, 0x8a6a3a][s % 3], lod: 0 });
      }
      return;
    }
    if (depthV < 0.19) {
      // a narrow block: one row through, alternately facing either side
      const f = bi % 2 === 0 ? 0 : 2;
      row(bk, f, bk.u0 + inW, bk.u1 - inE, depthV - inN - inS - 0.008, f === 0 ? inS : inN, centre);
      return;
    }
    const dN = Math.min(0.065 + k.r(1) * 0.045, (depthV - inN - inS) / 2 - 0.005);
    const dS = Math.min(0.065 + k.r(2) * 0.045, (depthV - inN - inS) / 2 - 0.005);
    row(bk, 2, bk.u0 + inW, bk.u1 - inE, dN, inN, centre);
    row(bk, 0, bk.u0 + inW, bk.u1 - inE, dS, inS, centre);
    const s0 = bk.v0 + inN + dN + 0.005;
    const s1 = bk.v1 - inS - dS - 0.005;
    if (s1 - s0 > 0.05) {
      const dW = Math.min(0.065 + k.r(3) * 0.04, depthU / 2 - inW - 0.005);
      const dE = Math.min(0.065 + k.r(4) * 0.04, depthU / 2 - inE - 0.005);
      row(bk, 3, s0, s1, dW, inW, centre, inW > 0.01);
      row(bk, 1, s0, s1, dE, inE, centre, inE > 0.01);
      // the block's core: back-to-back rows of smaller houses round little yards (LOD0 only)
      const c0 = bk.u0 + inW + dW + 0.008;
      const c1 = bk.u1 - inE - dE - 0.008;
      let v = s0 + 0.004;
      let n = 0;
      while (c1 - c0 > 0.06 && s1 - v > 0.06) {
        const dd = Math.min(s1 - v - 0.004, 0.055 + k.r(5) * 0.03);
        if (dd < 0.05) break;
        const sub: Block = { ...bk, u0: c0, u1: c1, v0: v, v1: v + dd };
        if (k.r(6) > 0.15) row(sub, n % 2 === 0 ? 0 : 2, c0 + k.r(7) * 0.02, c1, dd, 0, centre, true);
        v += dd + 0.004 + (k.r(8) < 0.3 ? 0.02 : 0);
        n++;
      }
    }
    // spired turrets at some corners (more on the outer ring and along the Grand Canal)
    const corners: [number, number, number, number][] = [
      [bk.u0, bk.v0, 1, 1],
      [bk.u1, bk.v0, -1, 1],
      [bk.u1, bk.v1, -1, -1],
      [bk.u0, bk.v1, 1, -1],
    ];
    for (const [u, v, su, sv] of corners) {
      const nearGrand = Math.abs(u - GRAND.u) < GRAND.w / 2 + 0.04;
      if (k.r(1) > (nearGrand ? 0.5 : 0.28)) continue;
      const r = 0.024 + k.r(2) * 0.014;
      turret(u + su * (r + 0.014), v + sv * (r + 0.014), r, 0.14 + k.r(3) * 0.1, k.r(4) < 0.6 ? 4 : 6);
    }
  });

  // ---------------------------------------------------------------- the Master's house and its tower
  const mb = blocks.find((bk) => bk.role === 'master');
  if (mb) {
    const cu = (mb.u0 + mb.u1) / 2;
    const cv = (mb.v0 + mb.v1) / 2;
    const [x, z] = T(cu - 0.03, cv);
    const hw = Math.min(0.3, mb.u1 - mb.u0 - 0.09);
    const hd = Math.min(0.15, mb.v1 - mb.v0 - 0.07);
    k.house('wood', 'slate', hw, hd, 0.105, { at: [x, DECK - 0.002, z], seat: false, rot: [0, YAW, 0], pitch: 58, overhang: 0.01, color: 0x6d6a63, roofColor: 0x2f383d, roofGrain: 0.5, ridge: { color: 0x8c713f, size: 0.007 }, lod: 2 });
    // the cross wing on the Grand Canal with its gable to the water
    const [wx, wz] = T(mb.u1 - 0.075, cv);
    k.house('wood', 'slate', 0.125, Math.min(0.22, mb.v1 - mb.v0 - 0.03), 0.12, { at: [wx, DECK - 0.002, wz], seat: false, rot: [0, YAW + 90, 0], pitch: 60, overhang: 0.01, color: 0x75716a, roofColor: 0x2f383d, roofGrain: 0.5, lod: 2 });
    // the Master's tower: the tallest thing in the town
    const [tx, tz] = T(mb.u1 - 0.055, mb.v0 + 0.06);
    k.tower('wood', 0.047, 0.42, { at: [tx, DECK - 0.002, tz], sides: 6, roof: 'spire', roofH: 0.21, roofFam: 'slate', color: 0x6b675f, roofColor: 0x2a3236, lod: 2 });
    for (const [y, a] of [[0.22, 200], [0.33, 260], [0.38, 150]] as const) light(tx + Math.sin(a * DEG) * 0.05, DECK + y, tz - Math.cos(a * DEG) * 0.05, 'window', 1.3, 0.011);
    // a lantern on the Master's landing and windows down the hall
    for (let s = 0; s < 4; s++) {
      const [lx, lz] = T(cu - 0.03 - hw / 2 + 0.04 + s * ((hw - 0.08) / 3), cv + hd / 2 + 0.005);
      light(lx, DECK + 0.055, lz, 'window', 1.2, 0.011);
    }
    // houses along the block's west face
    row(mb, 3, mb.v0 + 0.008, mb.v1 - 0.008, Math.min(0.095, (mb.u1 - mb.u0 - hw) / 2), 0.005, 0.2);
  }

  // ---------------------------------------------------------------- the bell tower (on the cross canal)
  const eb = blocks.find((bk) => Math.abs(bk.u0 - (GRAND.u + GRAND.w / 2)) < 0.03 && Math.abs(bk.v1 - (CROSS.v - CROSS.w / 2)) < 0.03);
  if (eb) {
    const [x, z] = T(eb.u0 + 0.055, eb.v1 - 0.055);
    k.tower('wood', 0.042, 0.35, { at: [x, DECK - 0.002, z], sides: 4, rot: [0, YAW + 45, 0], roof: 'spire', roofH: 0.18, roofFam: 'slate', color: 0x76726a, roofColor: 0x2c3438, lod: 2 });
    light(x, DECK + 0.28, z + 0.034, 'window', 1.4, 0.012);
  }

  // ---------------------------------------------------------------- footbridges over the narrow canals
  blocks.forEach((bk) => {
    const cv = (bk.v0 + bk.v1) / 2;
    const cu = (bk.u0 + bk.u1) / 2;
    // east across a narrow canal
    const east = blockAt(blocks, bk.u1 + 0.11, cv);
    if (east && east !== bk && east.u0 - bk.u1 < 0.12) {
      const [x, z] = T((bk.u1 + east.u0) / 2, cv);
      k.box('wood', east.u0 - bk.u1 + 0.04, 0.009, 0.026, { at: [x, DECK - 0.005, z], rot: [0, YAW, 0], color: BRIDGE_C, lod: 0 });
    }
    const south = blockAt(blocks, cu, bk.v1 + 0.1);
    if (south && south !== bk && south.v0 - bk.v1 < 0.11) {
      const [x, z] = T(cu + 0.04, (bk.v1 + south.v0) / 2);
      k.box('wood', south.v0 - bk.v1 + 0.04, 0.009, 0.026, { at: [x, DECK - 0.005, z], rot: [0, YAW + 90, 0], color: BRIDGE_C, lod: 0 });
    }
  });
  // humped bridges over the Grand Canal
  for (const v of [-0.72, -0.26, 0.6]) {
    const a = T(GRAND.u - GRAND.w / 2 - 0.01, v);
    const m = T(GRAND.u, v);
    const b = T(GRAND.u + GRAND.w / 2 + 0.01, v);
    k.bridge('wood', [a[0], DECK + 0.002, a[1]], [m[0], DECK + 0.028, m[1]], { width: 0.034, arches: 1, deck: 0.01, color: BRIDGE_C, lod: 0 });
    k.bridge('wood', [m[0], DECK + 0.028, m[1]], [b[0], DECK + 0.002, b[1]], { width: 0.034, arches: 1, deck: 0.01, color: BRIDGE_C, lod: 0 });
  }

  // ---------------------------------------------------------------- the long trestle bridge to the west shore
  const brV = -0.42;
  let bu = -1.6;
  while (bu < 0 && !blockAt(blocks, bu, brV)) bu += 0.01;
  const A = T(bu, brV);
  // westward (WNW) until the ground rises to the deck
  const dir: V2 = [-Math.cos(12 * DEG), -Math.sin(12 * DEG)];
  let L = 0.1;
  while (L < 4 && k.ground(A[0] + dir[0] * L, A[1] + dir[1] * L) < DECK - 0.01) L += 0.05;
  const B: V2 = [A[0] + dir[0] * L, A[1] + dir[1] * L];
  const spans = Math.max(4, Math.round(L / 0.1));
  k.bridge('wood', [A[0] + dir[0] * 0.01, DECK - 0.004, A[1] + dir[1] * 0.01], [B[0], DECK + 0.004, B[1]], { width: 0.04, arches: spans, deck: 0.014, color: BRIDGE_C, lod: 1 });
  for (let s = 1; s * 0.3 < L - 0.1; s++) {
    const t = s * 0.3;
    light(A[0] + dir[0] * t, DECK + 0.02, A[1] + dir[1] * t + 0.016, 'lamp', 0.9, 0.011);
  }
  // the shore gatehouse where the bridge lands
  const gyaw = (-Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
  k.house('wood', 'slate', 0.095, 0.08, 0.065, { at: [B[0] + dir[0] * 0.07, 0, B[1] + dir[1] * 0.07], rot: [0, gyaw, 0], pitch: 58, color: 0x6f6b64, roofColor: 0x2f383d, roofGrain: 0.5, lod: 1 });
  light(B[0] + dir[0] * 0.01, k.ground(B[0], B[1]) + 0.04, B[1] + 0.04, 'lamp', 1.1, 0.012);

  // ---------------------------------------------------------------- lanterns along the Grand Canal walkways
  for (let v = -1.12; v <= 1.12; v += 0.15) {
    for (const side of [-1, 1]) {
      const u = GRAND.u + side * (GRAND.w / 2 + 0.01);
      if (!blockAt(blocks, u + side * 0.014, v)) continue;
      const [x, z] = T(u, v + side * 0.026);
      light(x, DECK + 0.02, z, 'lamp', 1, 0.011);
    }
  }

  // ---------------------------------------------------------------- boats in the canals and at the deck edges
  const hull = (len: number, beam: number): V2[] => [
    [-len / 2, 0],
    [-len * 0.3, -beam / 2],
    [len * 0.3, -beam / 2],
    [len / 2, 0],
    [len * 0.3, beam / 2],
    [-len * 0.3, beam / 2],
  ];
  let boats = 0;
  for (let v = -1.0; v <= 1.0 && boats < 40; v += 0.09) {
    const side = k.r(1) < 0.5 ? -1 : 1;
    if (k.r(2) < 0.35) continue;
    const u = GRAND.u + side * (GRAND.w / 2 - 0.022);
    if (!insideTown(u, v)) continue;
    const [x, z] = T(u, v);
    k.extrude('wood', hull(0.044 + k.r(3) * 0.016, 0.014), 0.009, { at: [x, -0.003, z], rot: [0, YAW + 90 + (k.r(4) - 0.5) * 10, 0], color: HULL, shade: 0.8 + k.r(5) * 0.4, lod: 0 });
    boats++;
  }
  for (let a = 0; a < 360 && boats < 40; a += 17) {
    const u = 1.58 * Math.cos(a * DEG);
    const v = 1.24 * Math.sin(a * DEG);
    if (k.r(1) < 0.5 || insideTown(u, v, 0.98)) continue;
    const [x, z] = T(u, v);
    k.extrude('wood', hull(0.044 + k.r(2) * 0.016, 0.014), 0.009, { at: [x, -0.003, z], rot: [0, a + (k.r(3) - 0.5) * 30, 0], color: HULL, lod: 0 });
    boats++;
  }
}

export default defineLandmark({
  id: 'lake-town',
  placeId: 'lake-town',
  tier: 'A',
  anchor: 'water',
  proxy: buildTown,
  annotation: { title: 'Lake-town', subtitle: 'Esgaroth upon the Long Lake', blurb: 'A town of Men built out on the waters, in the shadow of the Lonely Mountain.' },
  bookmarks: [
    {
      id: 'lake-town-close',
      distanceKm: 22,
      elevationDeg: 22,
      azimuthDeg: 112,
      fov: 22,
      // the aim point sits on the lake bed: lift it to the water surface (≈ 2.4 above the bed here)
      lift: 2.6,
      aimKm: [1.3, 0.6],
      tod: 18.2,
      dayOfYear: 240,
      compare: ['reference/film/lake-town/lake-town-wide.webp', 'reference/concept-art/lake-town/lake-town-alan-lee.jpg'],
      note: 'dusk from the east-south-east, into the low sun: the stilt town silhouetted on the bright Long Lake, its lanterns and windows lit, the trestle bridge running to the west shore. Not from the south with Erebor behind: at the ×12 relief the mountain stands 18° above the horizon from the town, so a frame holding both shows the town as a speck (that composition is erebor-wide)',
    },
  ],
});
