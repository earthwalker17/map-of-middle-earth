import { hashString, rand } from '../../core/rng.ts';
import { mallornFrame } from '../../vegetation/authored.ts';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { TreeDecl, V2 } from '../types.ts';

/**
 * Caras Galadhon: the grove of the greatest mallorns (local km around the display point). Research
 * (landmarks-west-north §7): giant smooth silver-grey trunks rising well above the Lórien canopy,
 * golden crowns, white flets, lamps glowing among the branches at night — the city is a cluster
 * of the biggest trees, the tallest at the centre.
 *
 * Rings around the grove centre (crown tops above the ground): centre 6.2 km · 6 at 1.8 km · 12 at
 * 3.3 km · 21 at 4.8 km. The Lórien canopy reaches ≈ 1.8–2 km and the emergent wild mallorns ≈ 2.5 km,
 * so even the outer ring shows a band of bare silver trunk (with its flet) between the canopy and the
 * crowns. Everything is a pure function of the grove seed (module constants, never mutated by a build).
 */
const SEED = hashString('lothlorien-grove');
/** grove centre: a little north-west of the display point, away from the Celebrant (5.7 km south) */
export const GROVE: V2 = [-0.8, -1.2];

interface Ring {
  n: number;
  r: number;
  crown: [number, number];
  height: [number, number];
}
const RINGS: Ring[] = [
  { n: 1, r: 0, crown: [1.5, 1.5], height: [6.2, 6.2] },
  { n: 6, r: 1.8, crown: [1.3, 1.4], height: [5.3, 5.7] },
  { n: 12, r: 3.3, crown: [1.15, 1.3], height: [4.6, 5.0] },
  { n: 21, r: 4.8, crown: [1.0, 1.15], height: [4.0, 4.35] },
];

export interface GroveTree {
  at: V2;
  crownKm: number;
  heightKm: number;
  ring: number;
}

export const GROVE_TREES: readonly GroveTree[] = RINGS.flatMap((ring, ri) => {
  const a0 = rand(SEED, ri, 0) * Math.PI * 2;
  return Array.from({ length: ring.n }, (_, i): GroveTree => {
    const id = ri * 100 + i;
    const a = a0 + ((i + (rand(SEED, id, 1) - 0.5) * 0.45) / ring.n) * Math.PI * 2;
    const r = ring.r * (1 + (rand(SEED, id, 2) - 0.5) * 0.16);
    const t = rand(SEED, id, 3);
    return {
      at: [GROVE[0] + Math.cos(a) * r, GROVE[1] + Math.sin(a) * r],
      crownKm: ring.crown[0] + (ring.crown[1] - ring.crown[0]) * t,
      // bigger crowns stand taller (correlated, with a little independent jitter)
      heightKm: ring.height[0] + (ring.height[1] - ring.height[0]) * (0.7 * t + 0.3 * rand(SEED, id, 4)),
      ring: ri,
    };
  });
});

/** The ~40 authored mallorns (VegetationSystem hero list: silver trunks, golden crowns). */
export const TREES: TreeDecl[] = GROVE_TREES.map((t, i) => ({ at: t.at, kind: 'mallorn', crownKm: t.crownKm, heightKm: t.heightKm, color: 0xd6b94e, yawDeg: rand(SEED, i, 9) * 360 }));

/** trunk / crown frame of a grove tree (vegetation/authored.ts: exact for the hero mallorn recipe) */
const frame = (t: GroveTree) => mallornFrame(t.crownKm, t.heightKm);

export interface Flet {
  tree: number;
  x: number;
  z: number;
  /** deck height above the tree's ground, km */
  h: number;
  /** deck radius, km */
  r: number;
  /** trunk radius at the deck, km */
  tr: number;
  /** coarsest LOD keeping the deck: the high decks of the seven central trees read in regional shots */
  lod: 0 | 1;
}

/**
 * White flets (telain) round the trunks: on every tree a deck just under the crown (the outer rings'
 * decks sit in the band of bare trunk above the forest canopy, so they read from outside the grove),
 * and a second, wider deck half-way up the seven central trunks (the city floor under the crowns).
 */
export const FLETS: readonly Flet[] = GROVE_TREES.flatMap((t, ti): Flet[] => {
  const f = frame(t);
  const r = [0.5, 0.42, 0.36, 0.32][t.ring];
  const high: Flet = { tree: ti, x: t.at[0], z: t.at[1], h: f.low - 0.1 - 0.06 * rand(SEED, 300 + ti, 0), r: r * 0.9, tr: f.trunkR, lod: t.ring <= 1 ? 1 : 0 };
  if (t.ring > 1) return [high];
  return [{ ...high, h: f.trunk * (0.46 + 0.06 * rand(SEED, 300 + ti, 1)), r, lod: 0 }, high];
});

/** elven lamp colour (blue-white, research §7: ~#dfe8ff at night) */
const LAMP = 0xdfe8ff;
/** lamps of the landmark (shot-list budget) */
export const LAMP_COUNT = 150;

/**
 * The flets as kit geometry (family 'plaster', white): a thin deck with a rounded rim on a shallow
 * bracket that springs from the trunk below it, centred on the trunk of the vegetation's mallorn at
 * `ground + h` (the ground under the trunk: the deck follows the tree, not the slope). Not seated:
 * they hang on the trunks, so they record no ground contacts.
 */
export function buildFlets(k: ProxyKit): void {
  for (const f of FLETS) {
    const y = k.ground(f.x, f.z) + f.h;
    const tr = f.tr * 0.96;
    k.lathe(
      'plaster',
      [
        [tr, -0.12],
        [f.r * 0.6, -0.045],
        [f.r * 0.95, -0.022],
        [f.r, -0.01],
        [f.r, 0.016],
        [f.r * 0.97, 0.024],
        [tr, 0.024],
      ],
      { at: [f.x, y, f.z], seg: 20, color: 0xf2efe6, lod: f.lod },
    );
  }
}

/**
 * 150 blue-white elven lamps as kit light records (heights above the ground under each lamp's tree):
 * lanterns on the flet rims (three on the central decks, two elsewhere), the rest hung in the crowns —
 * just outside the crown surface (an ellipsoid round the cluster), on the outward faces of the outer
 * rings and the upper crowns of the inner trees, where a camera outside the grove can see them.
 */
export function buildLamps(k: ProxyKit): void {
  let n = 0;
  const add = (t: GroveTree, x: number, z: number, h: number, intensity: number, radius: number) => {
    if (n >= LAMP_COUNT) return;
    n++;
    k.light([x, k.ground(t.at[0], t.at[1]) + h, z], { color: LAMP, intensity, radius, kind: 'lamp' });
  };
  FLETS.forEach((f, fi) => {
    const t = GROVE_TREES[f.tree];
    const m = t.ring <= 1 ? 3 : 2;
    const out0 = Math.atan2(t.at[1] - GROVE[1], t.at[0] - GROVE[0]);
    for (let q = 0; q < m; q++) {
      // outer rings: the lanterns on the outward half of the rim
      const a = t.ring >= 2 ? out0 + (q / (m - 1) - 0.5) * 1.6 + (rand(SEED, 500 + fi, q) - 0.5) * 0.5 : ((q + rand(SEED, 500 + fi, q)) / m) * Math.PI * 2;
      add(t, f.x + Math.cos(a) * f.r * 0.88, f.z + Math.sin(a) * f.r * 0.88, f.h + 0.045, 1.6, 0.05);
    }
  });
  for (let i = 0; n < LAMP_COUNT; i++) {
    const t = GROVE_TREES[i % GROVE_TREES.length];
    const f = frame(t);
    const out0 = t.ring === 0 ? 0 : Math.atan2(t.at[1] - GROVE[1], t.at[0] - GROVE[0]);
    const spread = t.ring >= 2 ? Math.PI * 0.75 : Math.PI * 2;
    const phi = out0 + (rand(SEED, 700 + i, 0) - 0.5) * spread;
    // elevation on the crown: the outer rings from the lower middle up, the inner trees high
    const th = (t.ring >= 2 ? -0.1 + 0.8 * rand(SEED, 700 + i, 1) : 0.35 + 0.6 * rand(SEED, 700 + i, 1)) * (Math.PI / 2);
    // nestled in the leaf surface (0.97–1.03 of the ellipsoid): lamps among the branches, not beside them
    const s = 0.97 + 0.06 * rand(SEED, 700 + i, 2);
    const yc = f.trunk + 0.46 * f.vr;
    const rh = t.crownKm * 1.0 * Math.cos(th) * s;
    add(t, t.at[0] + Math.cos(phi) * rh, t.at[1] + Math.sin(phi) * rh, yc + 0.82 * f.vr * Math.sin(th) * s, 1.3 + 0.5 * rand(SEED, 700 + i, 3), 0.045);
  }
}
