import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2 } from '../records.ts';
import { defineLandmark } from '../types.ts';
import { CROSS, DECK, DECK_T, deckRuns, GRAND, inCanal, insideTown, inRect, MARKET, MASTER, onDeck, regionOf, regionYaw, SIDE_CANALS, T, YAW } from './layout.ts';

/**
 * Lake-town (Esgaroth, research §15): a dense town of weathered grey timber houses on stilts out on the
 * Long Lake — ONE continuous deck on piles with a ragged, notched outline and jetties, cut by a broad
 * Grand Canal (the hero looks up it), a cross canal and narrow side canals bridged here and there;
 * houses of one to four storeys in blocks turned a few degrees against each other, gable fronts on the
 * canals, steep cool-grey shingle roofs; a spiky skyline of towers — the Master's house and its tall
 * tower, a bell tower, a watch tower, many little spired turrets; joined to the west shore by a long
 * trestle bridge. Lit windows cluster on the fronts the hero sees, at the market and the Master's house
 * (the settlement aggregates into one warm spark in overviews). Layout and frame: layout.ts. Design scale
 * ≈ ×9 (houses 50–95 m wide).
 */

/**
 * dark, wet, weathered timber (S4 W5, the C2 art director: S3's pale grey read as warm tan balsa under the
 * grade): cool grey-brown 0x67645d … 0x55524c, every third house tarred near 0x3e3a35
 */
const WALLS = [0x67645d, 0x5e5b55, 0x3e3a35, 0x625f58, 0x55524c, 0x433f3a, 0x5a5751, 0x605d57, 0x3b3833];
/** dark slate / shingle (dark stone family: a lower roughness, the roofs catch the sky) */
const ROOFS = [0x4a5358, 0x40494e, 0x454e53, 0x3a4247, 0x4d555a, 0x3e464b, 0x434c51];
const DECK_C = 0x3a3631;
const POST = 0x2a2622;
const BRIDGE_C = 0x5a554e;
const HULL = 0x3a3129;
const LANTERN = 0xf0a54a;
/** the deck's inset behind the outer houses' fronts (ellipse-normalised: ≈ 0.025–0.035 km) */
const DECK_INSET = 0.018;
/** pile spacing along the deck's edges, km, and the scan's half extents (town frame) */
const PILE_STEP = 0.03;
const A_PILES = 1.85;
const B_PILES = 1.45;
/** at most this many lights (shot-list budget 120; the review asked for ≈ 55) */
const MAX_LIGHTS = 60;
/** walkway left free along the canals, km */
const WALK = 0.016;

const DEG = Math.PI / 180;

/** town frame (u, v) of a point (s, t) of a region turned by `rho` degrees about the town centre */
const rotST = (s: number, t: number, rho: number): V2 => {
  const c = Math.cos(rho * DEG);
  const n = Math.sin(rho * DEG);
  return [s * c + t * n, -s * n + t * c];
};

function buildTown(k: ProxyKit): void {
  /** deep enough water under (u, v): the town never runs onto the shore */
  const wet = (u: number, v: number): boolean => {
    const [x, z] = T(u, v);
    return k.ground(x, z) < -0.12;
  };
  const deckAt = (u: number, v: number): boolean => onDeck(u, v) && wet(u, v);

  let lights = 0;
  const light = (x: number, y: number, z: number, kind: 'window' | 'lamp', intensity: number, size = 0.009): void => {
    if (lights >= MAX_LIGHTS) return;
    lights++;
    k.light([x, y, z], { kind, color: LANTERN, intensity, radius: size });
  };
  /** a lamp on a short post standing on the deck (or a bridge) at local (x, z), deck top y */
  const lamp = (x: number, z: number, y: number, intensity: number): void => {
    if (lights >= MAX_LIGHTS) return;
    k.box('wood', 0.006, 0.026, 0.006, { at: [x, y - 0.002, z], color: POST, lod: 0 });
    light(x, y + 0.03, z, 'lamp', intensity, 0.01);
  };

  // ---------------------------------------------------------------- the deck on its piles
  // S4 W5 (the C2 art director: "a toy village on two rafts"): no dark skirt under the deck — open water
  // under a thin deck on piles; the deck stops DECK_INSET (normalised) inside the outline the houses may
  // reach, so the outer houses overhang the water on their piles
  const DV = 0.05;
  const deckMask = (u: number, v: number): boolean => onDeck(u, v) && insideTown(u, v, 0.985 - DECK_INSET);
  for (const r of deckRuns(DV, wet, deckMask)) {
    const [x, z] = T((r.u0 + r.u1) / 2, r.v + DV / 2);
    k.box('wood', r.u1 - r.u0 + 0.01, DECK_T, DV + 0.004, { at: [x, DECK - DECK_T, z], rot: [0, YAW, 0], color: DECK_C, shade: 0.88 + k.r(1) * 0.24, lod: 1 });
  }
  // piles (three-sided posts, no caps): wherever the zone the houses may cover meets water — the outline,
  // the harbour notches, the canals' banks — every PILE_STEP km (twice that along the side canals, which
  // the hero hardly sees), jittered, from below the water to the deck's underside
  const zone = (u: number, v: number): boolean => deckAt(u, v) && insideTown(u, v, 0.985);
  const pile = (u: number, v: number, i: number) => {
    const [x, z] = T(u + (k.r(i) - 0.5) * 0.008, v + (k.r(i + 1) - 0.5) * 0.008);
    k.cylinder('wood', 0.0055, 0.0065, DECK - DECK_T + 0.05, { at: [x, -0.05, z], seg: 3, rot: [0, YAW + 30, 0], color: POST, shade: 0.8 + k.r(i + 2) * 0.35, lod: 0 });
  };
  let pi = 0;
  for (let v = -B_PILES; v <= B_PILES; v += PILE_STEP)
    for (let u = -A_PILES; u <= A_PILES; u += PILE_STEP) {
      if (!zone(u, v)) continue;
      const nb: V2[] = [
        [u - PILE_STEP, v],
        [u + PILE_STEP, v],
        [u, v - PILE_STEP],
        [u, v + PILE_STEP],
      ];
      const off = nb.filter(([a, b]) => !zone(a, b));
      if (!off.length) continue;
      // along the side and cross canals and on the far (north) half the hero hardly sees: every other spot
      const side = off.every(([a, b]) => insideTown(a, b, 0.985) && Math.abs(a - GRAND.u) > GRAND.w / 2 + 0.01);
      if ((side || v < -0.3) && (Math.round(u / PILE_STEP) + Math.round(v / PILE_STEP)) % 2) continue;
      pile(u, v, 3000 + pi++ * 3);
    }

  // ---------------------------------------------------------------- houses
  let houseN = 0;
  let windowBudget = 36;
  const storeys = (p: number[]): number => {
    const x = k.r(20);
    let a = 0;
    for (let i = 0; i < p.length; i++) if (x < (a += p[i])) return i + 1;
    return p.length;
  };
  /**
   * One timber house centred at town (u, v): `along` = its width on the street, `deep` = its depth, `h` =
   * wall height; `face` = the town-frame unit normal of its front; `rho` = its block's turn (deg). Gable
   * fronts turn the ridge onto the normal.
   */
  const house = (u: number, v: number, along: number, deep: number, h: number, face: V2, o: { gable: boolean; lod: 0 | 1 | 2; lit: number; tall?: boolean }): void => {
    const i = houseN++;
    const [x, z] = T(u, v);
    // the yaw that turns the house's local +z onto the front normal (kit: +z → (sin yaw, cos yaw) in x, z)
    const [nx, nz] = [face[0] * Math.cos(YAW * DEG) + face[1] * Math.sin(YAW * DEG), -face[0] * Math.sin(YAW * DEG) + face[1] * Math.cos(YAW * DEG)];
    const yawF = (Math.atan2(nx, nz) * 180) / Math.PI;
    const yaw = yawF + (o.gable ? 90 : 0) + (k.r(1) - 0.5) * 3;
    const w = o.gable ? deep : along;
    const d = o.gable ? along : deep;
    const r = k.r(2);
    const roof = o.tall ? 'cone' : r < 0.1 ? 'hip' : 'gable';
    k.house('wood', 'darkStone', w, d, h, {
      at: [x, DECK - 0.002, z],
      seat: false,
      rot: [0, yaw, 0],
      roof,
      pitch: 56 + k.r(3) * 12,
      overhang: 0.006 + k.r(4) * 0.004,
      color: WALLS[i % WALLS.length],
      shade: 0.9 + k.r(5) * 0.2,
      roofColor: ROOFS[(i * 3 + 1) % ROOFS.length],
      roofGrain: 0.5,
      lod: o.lod,
      // carved gable boards with short horns (the film's town) on every third house (S4 W5: they cost
      // ≈ 0.2k tris a house; the piles took the budget), ridge caps on some
      ...(roof === 'gable' && i % 3 === 0 ? { gableBoards: { color: 0x4a443c, size: 0.0045, horn: 0.008 } } : {}),
      ...(i % 3 === 0 && roof === 'gable' ? { ridge: { color: 0x3b4246, size: 0.006 } } : {}),
      ...(i % 11 === 2 ? { chimney: true } : {}),
    });
    if (o.lit > 0 && windowBudget > 0 && k.r(6) < o.lit) {
      windowBudget--;
      const fx = x + nx * (deep / 2 + 0.004);
      const fz = z + nz * (deep / 2 + 0.004);
      light(fx, DECK + h * (0.3 + k.r(7) * 0.4), fz, 'window', 0.4 + k.r(8) * 0.6, 0.008);
    }
  };

  /** a spired timber turret standing on the deck at (u, v) */
  let turretN = 0;
  const turret = (u: number, v: number, r: number, h: number, sides: number, lod: 0 | 1 | 2 = 1): void => {
    const [x, z] = T(u, v);
    // S4 W5: every other turret under a low pyramid cap instead of a spire (no field of church spires)
    const cap = turretN++ % 2 === 1;
    k.tower('wood', r, h, {
      at: [x, DECK - 0.002, z],
      sides,
      rot: [0, YAW + (sides === 4 ? 45 : 0), 0],
      roof: cap ? 'cone' : 'spire',
      roofH: cap ? r * (1.1 + k.r(1) * 0.4) : r * (2.6 + k.r(1) * 1.2),
      roofFam: 'darkStone',
      color: WALLS[(houseN + 2) % WALLS.length],
      roofColor: ROOFS[houseN % ROOFS.length],
      lod,
    });
  };

  /** footprint test: every corner and the centre on the deck, clear of the canals' walkways and of the reserved squares */
  const fits = (u: number, v: number, a: number, b: number, rho: number, region: number | null): boolean => {
    const pts: V2[] = [[0, 0], [-a / 2, -b / 2], [a / 2, -b / 2], [a / 2, b / 2], [-a / 2, b / 2]];
    for (const [ds, dt] of pts) {
      const [du, dv] = rotST(ds, dt, rho);
      const pu = u + du;
      const pv = v + dv;
      if (!deckAt(pu, pv) || inCanal(pu, pv, WALK) || !insideTown(pu, pv, 0.985)) return false;
      if (inRect(MARKET, pu, pv, 0.01) || inRect(MASTER, pu, pv, 0.01)) return false;
      if (region !== null && regionOf(pu, pv) !== region) return false;
    }
    return true;
  };

  // ---- 1. the Grand Canal's frontages: tall gable-fronted houses shoulder to shoulder on both banks,
  // facing the water (the view up the canal), a walkway along the water
  for (const side of [-1, 1]) {
    let v = -1.5 + k.r(1) * 0.05;
    let n = 0;
    while (v < 1.5) {
      const along = 0.05 + k.r(2) * 0.04;
      const deep = 0.075 + k.r(3) * 0.03;
      const u = GRAND.u + side * (GRAND.w / 2 + WALK + 0.006 + deep / 2);
      const vc = v + along / 2;
      if (fits(u, vc, deep, along, 0, null)) {
        const n_ = storeys([0.05, 0.35, 0.4, 0.2]);
        const tall = k.r(4) < 0.05;
        // lit windows: a share of the canal fronts in the near (south-south-west) half of the canal (seen
        // at a grazing angle from the hero: most windows go on the fronts that face it, below)
        const lit = vc > 0.3 ? 0.22 : 0.05;
        house(u, vc, along, deep, 0.032 * n_ + 0.012, [-side, 0], { gable: k.r(5) < 0.7, lod: n % 2 === 0 ? 2 : 1, lit, tall });
        n++;
      }
      v += along + (k.r(6) < 0.1 ? 0.025 + k.r(7) * 0.02 : 0.003 + k.r(8) * 0.006);
    }
  }

  // ---- 2. the blocks: back-to-back rows of houses in each region's own slightly turned frame, alleys
  // between the pairs of rows, now and then a gap; storeys 1–4 (taller towards the middle and the canal)
  // (the southern regions first: their outer rows face the hero and get the window budget first)
  const regions = [3, 13, 6, 2, 12, 5, 1, 4, 0, 14];
  for (const reg of regions) {
    const rho = regionYaw(reg);
    let t = -1.55 + k.r(1) * 0.08;
    while (t < 1.55) {
      const d1 = 0.06 + k.r(2) * 0.04;
      const d2 = 0.06 + k.r(3) * 0.04;
      for (const [row, depth, sgn] of [
        [t + d1 / 2, d1, -1],
        [t + d1 + 0.004 + d2 / 2, d2, 1],
      ] as const) {
        let s = -1.9 + k.r(4) * 0.06;
        let n = 0;
        while (s < 1.9) {
          const along = 0.05 + k.r(5) * 0.045;
          const sc = s + along / 2;
          const [u, v] = rotST(sc, row, rho);
          // never on the Grand Canal's frontage strip (its houses face the water)
          if (Math.abs(u - GRAND.u) > GRAND.w / 2 + WALK + 0.12 && fits(u, v, along, depth, rho, reg)) {
            const edge = !insideTown(u, v, 0.9);
            const mid = Math.hypot(u / 1.7, v / 1.3) < 0.55;
            const n_ = storeys(edge ? [0.35, 0.45, 0.2, 0] : mid ? [0.1, 0.35, 0.35, 0.2] : [0.25, 0.45, 0.25, 0.05]);
            const face = rotST(0, sgn, rho);
            // lit windows on the fronts that face the hero (south-south-west, +v), most on the outer rows
            // it sees (the inner fronts hide behind the next row's backs)
            const lit = face[1] > 0.5 ? (edge && v > 0 ? 0.65 : v > -0.4 ? 0.18 : 0.06) : 0;
            const lod: 0 | 1 | 2 = edge ? (n % 3 === 0 ? 2 : 1) : n % 4 === 0 ? 1 : 0;
            house(u, v, along, depth * (0.9 + k.r(6) * 0.1), 0.032 * n_ + 0.012, face, { gable: k.r(7) < 0.6, lod, lit, tall: k.r(8) < 0.04 && along < 0.07 });
            n++;
          }
          s += along + (k.r(9) < 0.12 ? 0.024 + k.r(10) * 0.02 : 0.003 + k.r(11) * 0.007);
        }
      }
      t += d1 + d2 + 0.004 + 0.018 + k.r(12) * 0.014;
    }
  }

  // ---- 3. spired turrets at canal corners and along the outline (the spiky skyline)
  let turrets = 0;
  for (let a = 0; a < 360 && turrets < 12; a += 23 + k.r(1) * 14) {
    const ca = Math.cos(a * DEG);
    const sa = Math.sin(a * DEG);
    // walk in from beyond the outline to the first deck
    for (let q = 1.08; q > 0.6; q -= 0.02) {
      const u = 1.7 * q * ca;
      const v = 1.3 * q * sa;
      if (deckAt(u, v) && insideTown(u, v, 0.96)) {
        turret(u, v, 0.022 + k.r(2) * 0.012, 0.16 + k.r(3) * 0.1, k.r(4) < 0.6 ? 4 : 6);
        turrets++;
        break;
      }
    }
  }
  for (const [u, v] of [
    [GRAND.u - GRAND.w / 2 - WALK - 0.03, -0.95],
    [GRAND.u + GRAND.w / 2 + WALK + 0.03, -0.55],
    [GRAND.u + GRAND.w / 2 + WALK + 0.03, 0.85],
    [GRAND.u - GRAND.w / 2 - WALK - 0.03, 0.95],
    [-0.62, CROSS.v - CROSS.w / 2 - WALK - 0.03],
    [0.75, SIDE_CANALS[2].at + SIDE_CANALS[2].w / 2 + WALK + 0.03],
  ] as const)
    if (deckAt(u, v)) turret(u, v, 0.026 + k.r(1) * 0.01, 0.2 + k.r(2) * 0.08, 6);

  // ---- 4. the Master's house: a long hall, a cross wing gable-on to the Grand Canal, the town's tallest
  // tower (≈ 0.92 km to the spire's tip); its windows and the lamps on its landing
  {
    const cu = (MASTER.u0 + MASTER.u1) / 2;
    const cv = (MASTER.v0 + MASTER.v1) / 2;
    const hw = MASTER.u1 - MASTER.u0 - 0.12;
    const hd = Math.min(0.15, MASTER.v1 - MASTER.v0 - 0.08);
    const [x, z] = T(cu - 0.05, cv);
    k.house('wood', 'darkStone', hw, hd, 0.14, { at: [x, DECK - 0.002, z], seat: false, rot: [0, YAW, 0], pitch: 58, overhang: 0.01, color: 0x5e5b55, roofColor: 0x3f474c, roofGrain: 0.5, ridge: { color: 0x8c713f, size: 0.007 }, lod: 2 });
    const [wx, wz] = T(MASTER.u1 - 0.065, cv);
    k.house('wood', 'darkStone', 0.13, MASTER.v1 - MASTER.v0 - 0.02, 0.16, { at: [wx, DECK - 0.002, wz], seat: false, rot: [0, YAW + 90, 0], pitch: 60, overhang: 0.01, color: 0x3e3a35, roofColor: 0x3f474c, roofGrain: 0.5, lod: 2 });
    const [tx, tz] = T(MASTER.u0 + 0.07, MASTER.v0 + 0.07);
    // S4 W5: lower (0.62 → 0.45, spire 0.3 → 0.16), so it reads as a timber tower, not a church spire
    k.tower('wood', 0.055, 0.45, { at: [tx, DECK - 0.002, tz], sides: 6, roof: 'spire', roofH: 0.16, roofFam: 'darkStone', color: 0x5a5751, roofColor: 0x3a4247, lod: 2 });
    for (const [y, a] of [
      [0.26, 200],
      [0.37, 160],
    ] as const)
      light(tx + Math.sin(a * DEG) * 0.057, DECK + y, tz - Math.cos(a * DEG) * 0.057, 'window', 0.95, 0.01);
    // windows down the hall's front (south-south-west) and the wing's canal gable
    const [fnx, fnz] = [Math.sin(YAW * DEG), Math.cos(YAW * DEG)];
    for (let s = 0; s < 3; s++) {
      const [lx, lz] = T(cu - 0.05 - hw / 2 + 0.05 + s * ((hw - 0.1) / 2), cv);
      light(lx + fnx * (hd / 2 + 0.004), DECK + 0.08, lz + fnz * (hd / 2 + 0.004), 'window', 0.85 + k.r(1) * 0.15, 0.009);
    }
    const [gx, gz] = T(MASTER.u1 + 0.004, cv);
    light(gx, DECK + 0.1, gz, 'window', 1.0, 0.01);
    // lamps on the landing at the canal
    for (const dv of [-0.08, 0.08]) {
      const [lx, lz] = T(GRAND.u - GRAND.w / 2 - 0.012, cv + dv);
      lamp(lx, lz, DECK, 0.9);
    }
  }

  // ---- 5. the market square: stalls with coloured awnings round an open deck, lamps at its corners
  {
    for (let s = 0; s < 8; s++) {
      const u = MARKET.u0 + 0.07 + (s % 4) * 0.07 + k.r(1) * 0.012;
      const v = MARKET.v0 + 0.07 + Math.floor(s / 4) * 0.11;
      if (u > MARKET.u1 - 0.04 || v > MARKET.v1 - 0.04) continue;
      const [x, z] = T(u, v);
      k.house('wood', 'wood', 0.03, 0.024, 0.016, { at: [x, DECK - 0.002, z], seat: false, rot: [0, YAW + (k.r(2) - 0.5) * 20, 0], roof: 'hip', pitch: 35, color: 0x6a5a48, roofColor: [0x7a3a2c, 0x3d5a7a, 0x8a6a3a][s % 3], lod: 0 });
    }
    for (const [u, v] of [
      [MARKET.u0 + 0.03, MARKET.v0 + 0.03],
      [MARKET.u1 - 0.02, MARKET.v0 + 0.03],
      [MARKET.u1 - 0.02, MARKET.v1 - 0.03],
      [MARKET.u0 + 0.03, MARKET.v1 - 0.03],
    ] as const) {
      const [x, z] = T(u, v);
      lamp(x, z, DECK, 0.85 + k.r(1) * 0.15);
    }
    // houses round the square's back (west) and south sides, facing it
    let v = MARKET.v0;
    while (v < MARKET.v1 - 0.05) {
      const along = 0.055 + k.r(1) * 0.03;
      const u = MARKET.u0 - 0.045;
      if (deckAt(u, v + along / 2)) house(u, v + along / 2, along, 0.08, 0.032 * storeys([0, 0.3, 0.5, 0.2]) + 0.012, [1, 0], { gable: true, lod: 1, lit: 0.6 });
      v += along + 0.004;
    }
  }

  // ---- 6. the bell tower (east bank, across from the market) and a watch tower at the north end
  {
    const [bx, bz] = T(GRAND.u + GRAND.w / 2 + WALK + 0.06, CROSS.v + 0.15);
    // S4 W5: the bell and watch towers 30 % lower, the bell tower under a pyramid cap
    k.tower('wood', 0.048, 0.35, { at: [bx, DECK - 0.002, bz], sides: 4, rot: [0, YAW + 45, 0], roof: 'cone', roofH: 0.07, roofFam: 'darkStone', color: 0x55524c, roofColor: 0x40494e, lod: 2 });
    light(bx + Math.sin(YAW * DEG) * 0.05, DECK + 0.29, bz + Math.cos(YAW * DEG) * 0.05, 'window', 0.9, 0.011);
    const [wx, wz] = T(GRAND.u + GRAND.w / 2 + WALK + 0.05, -1.0);
    if (deckAt(GRAND.u + GRAND.w / 2 + WALK + 0.05, -1.0)) k.tower('wood', 0.042, 0.29, { at: [wx, DECK - 0.002, wz], sides: 6, roof: 'spire', roofH: 0.14, roofFam: 'darkStone', color: 0x5e5b55, roofColor: 0x3e464b, lod: 2 });
    const [hx, hz] = T(-0.85, -0.3);
    if (deckAt(-0.85, -0.3)) k.tower('wood', 0.04, 0.27, { at: [hx, DECK - 0.002, hz], sides: 4, rot: [0, YAW + 45, 0], roof: 'cone', roofH: 0.06, roofFam: 'darkStone', color: 0x433f3a, roofColor: 0x3a4247, lod: 1 });
  }

  // ---- 7. bridges: humped ones over the Grand Canal (lamps at their heads), plank footbridges over the
  // side canals, and houses built across two side canals
  for (const v of [-0.78, -0.42, -0.08, 0.6, 0.95]) {
    const a = T(GRAND.u - GRAND.w / 2 - 0.012, v);
    const m = T(GRAND.u, v);
    const b = T(GRAND.u + GRAND.w / 2 + 0.012, v);
    k.bridge('wood', [a[0], DECK + 0.002, a[1]], [m[0], DECK + 0.034, m[1]], { width: 0.034, arches: 1, deck: 0.01, color: BRIDGE_C, lod: 0 });
    k.bridge('wood', [m[0], DECK + 0.034, m[1]], [b[0], DECK + 0.002, b[1]], { width: 0.034, arches: 1, deck: 0.01, color: BRIDGE_C, lod: 0 });
    if (v > -0.5) {
      const [lx, lz] = T(GRAND.u + GRAND.w / 2 + 0.012, v + 0.026);
      lamp(lx, lz, DECK, 0.7);
    }
  }
  SIDE_CANALS.forEach((c, i) => {
    for (let q = 0; q < 2; q++) {
      const along = c.from < -5 ? c.to - 0.12 - q * 0.35 : c.from + 0.12 + q * 0.35;
      const [u, v] = c.axis === 'u' ? [along, c.at] : [c.at, along];
      if (!insideTown(u, v, 0.95)) continue;
      const [x, z] = T(u, v);
      if (q === 1 && i % 3 === 0) {
        // a house built across the canal on its own posts
        k.house('wood', 'darkStone', c.w + 0.05, 0.06, 0.07, { at: [x, DECK - 0.002, z], seat: false, rot: [0, YAW + (c.axis === 'u' ? 90 : 0), 0], pitch: 58, color: WALLS[i % WALLS.length], roofColor: ROOFS[i % ROOFS.length], lod: 0 });
      } else k.box('wood', c.w + 0.04, 0.009, 0.026, { at: [x, DECK - 0.005, z], rot: [0, YAW + (c.axis === 'u' ? 90 : 0), 0], color: BRIDGE_C, lod: 0 });
    }
  });

  // ---- 8. jetties out into the lake from the outline (piles, a boat or two moored alongside)
  const hull = (len: number, beam: number): V2[] => [
    [-len / 2, 0],
    [-len * 0.3, -beam / 2],
    [len * 0.3, -beam / 2],
    [len / 2, 0],
    [len * 0.3, beam / 2],
    [-len * 0.3, beam / 2],
  ];
  const boat = (x: number, z: number, yaw: number, lod: 0 | 1 = 0) =>
    k.extrude('wood', hull(0.044 + k.r(1) * 0.016, 0.014), 0.009, { at: [x, -0.003, z], rot: [0, yaw, 0], color: HULL, shade: 0.8 + k.r(2) * 0.4, lod });
  for (const a of [20, 62, 105, 150, 205, 238, 290, 330]) {
    const ca = Math.cos(a * DEG);
    const sa = Math.sin(a * DEG);
    let q0 = 0;
    for (let q = 1.12; q > 0.6; q -= 0.01)
      if (deckAt(1.7 * q * ca, 1.3 * q * sa)) {
        q0 = q;
        break;
      }
    if (!q0) continue;
    const len = 0.16 + k.r(1) * 0.14;
    const u0 = 1.7 * q0 * ca;
    const v0 = 1.3 * q0 * sa;
    const dl = Math.hypot(1.7 * ca, 1.3 * sa);
    const [du, dv] = [(1.7 * ca) / dl, (1.3 * sa) / dl];
    const p0 = T(u0, v0);
    const p1 = T(u0 + du * len, v0 + dv * len);
    if (!wet(u0 + du * len, v0 + dv * len)) continue;
    k.bridge('wood', [p0[0], DECK - 0.01, p0[1]], [p1[0], DECK - 0.012, p1[1]], { width: 0.022, arches: Math.max(2, Math.round(len / 0.05)), deck: 0.008, color: BRIDGE_C, lod: 0 });
    const jyaw = (-Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180) / Math.PI;
    const side = k.r(2) < 0.5 ? -1 : 1;
    const [bx, bz] = T(u0 + du * len * 0.6 - dv * side * 0.025, v0 + dv * len * 0.6 + du * side * 0.025);
    boat(bx, bz, jyaw);
  }

  // ---------------------------------------------------------------- the long trestle bridge to the west shore
  const brV = -0.2;
  let bu = -2.1;
  while (bu < 0 && !deckAt(bu, brV)) bu += 0.01;
  const A0 = T(bu, brV);
  // westward (WNW) until the ground rises to the deck
  const dir: V2 = [-Math.cos(12 * DEG), -Math.sin(12 * DEG)];
  let L = 0.1;
  while (L < 4 && k.ground(A0[0] + dir[0] * L, A0[1] + dir[1] * L) < DECK - 0.01) L += 0.05;
  const B0: V2 = [A0[0] + dir[0] * L, A0[1] + dir[1] * L];
  const spans = Math.max(4, Math.round(L / 0.1));
  k.bridge('wood', [A0[0] + dir[0] * 0.01, DECK - 0.004, A0[1] + dir[1] * 0.01], [B0[0], DECK + 0.004, B0[1]], { width: 0.04, arches: spans, deck: 0.014, color: BRIDGE_C, lod: 1 });
  // lanterns on posts every 0.3 km, alternating sides
  for (let s = 1; s * 0.3 < L - 0.1; s++) {
    const t = s * 0.3;
    const off = (s % 2 ? 1 : -1) * 0.016;
    lamp(A0[0] + dir[0] * t - dir[1] * off, A0[1] + dir[1] * t + dir[0] * off, DECK - 0.004 + (0.008 * t) / L, 0.75);
  }
  // the shore gatehouse where the bridge lands
  const gyaw = (-Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
  k.house('wood', 'darkStone', 0.095, 0.08, 0.075, { at: [B0[0] + dir[0] * 0.07, 0, B0[1] + dir[1] * 0.07], rot: [0, gyaw, 0], pitch: 58, color: 0x5e5b55, roofColor: 0x40494e, roofGrain: 0.5, lod: 1 });
  light(B0[0] + dir[0] * 0.012, k.ground(B0[0], B0[1]) + 0.04, B0[1], 'lamp', 0.9, 0.011);

  // ---------------------------------------------------------------- boats moored in the Grand Canal, in the harbours, out on the lake
  let boats = 0;
  for (let v = -1.15; v <= 1.15 && boats < 34; v += 0.06) {
    if (k.r(1) < 0.3) continue;
    const side = k.r(2) < 0.5 ? -1 : 1;
    const u = GRAND.u + side * (GRAND.w / 2 - 0.02);
    if (!insideTown(u, v, 0.98) || !wet(u, v)) continue;
    const [x, z] = T(u, v);
    boat(x, z, YAW + 90 + (k.r(3) - 0.5) * 10);
    boats++;
  }
  for (let a = 0; a < 360 && boats < 46; a += 19) {
    const u = 1.88 * Math.cos(a * DEG);
    const v = 1.46 * Math.sin(a * DEG);
    if (k.r(1) < 0.55 || insideTown(u, v, 1.02) || !wet(u, v)) continue;
    const [x, z] = T(u, v);
    boat(x, z, a + (k.r(2) - 0.5) * 30);
    boats++;
  }
}

export default defineLandmark({
  id: 'lake-town',
  placeId: 'lake-town',
  tier: 'A',
  anchor: 'water',
  proxy: buildTown,
  // a few thin chimney smokes over the roofs (town frame u, v; all on the deck, off the canals) at the
  // town's design scale (houses ×9): pale wisps bending downwind, dissolving ≈ 0.4–0.5 km up
  emitters: [
    ...(
      [
        [-0.9, -0.5],
        [-0.5, 0.55],
        [0.55, -0.35],
        [0.85, 0.55],
        [-1.25, 0.1],
        [1.2, -0.1],
      ] as V2[]
    ).map(([u, v], i) => {
      const [x, z] = T(u, v);
      return { preset: 'smoke' as const, at: [x, 0.19 + 0.03 * (i % 3), z] as [number, number, number], rate: 0.8, scale: 0.075 + 0.015 * (i % 2), color: 0xb4b8bd };
    }),
    // S4 W5 (C2 #16): a low, cold blue-grey mist lying on the water round the town — behind it (north) and
    // along its flanks, never across the hero's view of the fronts
    ...(
      [
        [[-2.3, -1.75], [2.3, -1.75], 0.45],
        [[-2.2, -0.9], [-2.4, 1.2], 0.35],
        [[2.25, -1.1], [2.35, 0.9], 0.35],
      ] as [V2, V2, number][]
    ).map(([a, b, w]) => {
      const [ax, az] = T(a[0], a[1]);
      const [bx, bz] = T(b[0], b[1]);
      return { preset: 'mist' as const, at: [ax, 0.02, az] as [number, number, number], to: [bx, 0.03, bz] as [number, number, number], rate: 0.55, scale: w, color: 0xc2cbd3 };
    }),
  ],
  annotation: { title: 'Lake-town', subtitle: 'Esgaroth upon the Long Lake', blurb: 'A town of Men built out on the waters, in the shadow of the Lonely Mountain.' },
  bookmarks: [
    {
      id: 'lake-town-close',
      fStop: 5.6,
      distanceKm: 6.0,
      elevationDeg: 10,
      azimuthDeg: 60,
      fov: 34,
      // the aim point sits on the lake bed: lift it to the water surface (≈ 2.4 above the bed here)
      lift: 2.6,
      aimKm: [1.4, 0.4],
      tod: 16.3,
      dayOfYear: 240,
      // (the probe's ground line of sight aims at the lake bed under the town's water anchor; the town's
      // upper body is in clear view)
      expect: { los: false },
      compare: ['reference/film/lake-town/lake-town-wide.webp', 'reference/concept-art/lake-town/lake-town-alan-lee.jpg'],
      note: 'afternoon, BACKLIT (S4 W5, C2 #16: the film plate looks into a low sun; from the south-south-west the town stood against a sunny grass ramp across a lake that read as a river): from the east-north-east into the sun (≈ 22°, west-south-west), the dark timber roofscape on its piles against the glittering lake, the far shore’s hills in shadow behind, chimney smoke and a low cold mist on the water. The Long Lake is ≈ 5 km wide between hills 2–4 units high at the ×12 relief, so no framing from the town shows open water to a horizon; Erebor stands 18–25° above the horizon from here (that composition is erebor-wide / w4h-laketown-erebor)',
    },
  ],
});
