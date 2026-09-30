import { hashString, rand } from '../../core/rng.ts';
import { mallornFrame, type MallornFrame } from '../../vegetation/authored.ts';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { TreeDecl, V2 } from '../types.ts';

/**
 * Caras Galadhon: the grove of the greatest mallorns (local km around the display point). Research
 * (landmarks-west-north §7) and the film: a conical hill of individual giant trees rising out of the
 * golden wood, the tallest at the centre — smooth silver-grey trunks, tall tiered golden crowns, white
 * flets, lamps glowing among the branches at night.
 *
 * Rings around the grove centre (crown tops above the ground): centre 7.0 km · 6 at 1.8 km (≈ 5.8) ·
 * 12 at 3.3 km (≈ 4.7) · 21 at 4.8 km (≈ 3.6). Each crown is 3–4 stacked tiers shrinking upward
 * (vegetation/authored.ts mallornFrame), so neighbouring trees part into separate spires with sky between
 * their tops. The Lórien canopy reaches ≈ 1.8–2 km: the inner rings show a band of bare silver trunk
 * (with its flet) above it, the outer ring's crowns rise straight out of the forest. Everything is a pure
 * function of the grove seed (module constants, never mutated by a build).
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
  { n: 1, r: 0, crown: [1.5, 1.5], height: [7.0, 7.0] },
  { n: 6, r: 1.8, crown: [1.25, 1.35], height: [5.6, 6.0] },
  { n: 12, r: 3.3, crown: [1.05, 1.15], height: [4.5, 4.9] },
  { n: 21, r: 4.8, crown: [0.85, 0.95], height: [3.45, 3.75] },
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

/** crown golds of the great trees (sRGB): pale sunlit gold to deeper amber, a few greener */
const GOLDS = [0xd6b94e, 0xcfae44, 0xdcc05a, 0xc9a23e, 0xbfae4c, 0xd4a940];

/** The ~40 authored mallorns (VegetationSystem hero list: silver trunks, tiered golden crowns). */
export const TREES: TreeDecl[] = GROVE_TREES.map((t, i) => ({
  at: t.at,
  kind: 'mallorn',
  crownKm: t.crownKm,
  heightKm: t.heightKm,
  color: GOLDS[Math.floor(rand(SEED, i, 10) * GOLDS.length) % GOLDS.length],
  yawDeg: rand(SEED, i, 9) * 360,
}));

/** trunk / crown frame of a grove tree (vegetation/authored.ts: exact for the hero mallorn recipe) */
const FRAMES: readonly MallornFrame[] = GROVE_TREES.map((t) => mallornFrame(t.crownKm, t.heightKm));

export interface Flet {
  tree: number;
  x: number;
  z: number;
  /** deck height above the tree's ground, km */
  h: number;
  /** deck radius, km */
  r: number;
  /** coarsest LOD keeping the deck: the high decks of the seven central trees read in regional shots */
  lod: 0 | 1;
}

/**
 * White flets (telain) round the trunks: on every tree a deck just under the crown (the inner rings'
 * decks sit in the band of bare trunk above the forest canopy, so they read from outside the grove),
 * and a second, wider deck half-way up the seven central trunks (the city floor under the crowns).
 */
export const FLETS: readonly Flet[] = GROVE_TREES.flatMap((t, ti): Flet[] => {
  const f = FRAMES[ti];
  const r = [0.5, 0.42, 0.36, 0.32][t.ring];
  const high: Flet = { tree: ti, x: t.at[0], z: t.at[1], h: f.low - 0.1 - 0.06 * rand(SEED, 300 + ti, 0), r: r * 0.9, lod: t.ring <= 1 ? 1 : 0 };
  if (t.ring > 1) return [high];
  return [{ ...high, h: f.trunk * (0.46 + 0.06 * rand(SEED, 300 + ti, 1)), r, lod: 0 }, high];
});

/** elven lamp colour (blue-white, research §7: ~#dfe8ff at night) */
const LAMP = 0xdfe8ff;
/** lamps of the landmark (shot-list budget) */
export const LAMP_COUNT = 150;
/** lanterns per flet */
const FLET_LAMPS = 3;
/** flet paint (white plaster) and its beams (pale silver-grey wood) */
const FLET_WHITE = 0xf2efe6;
const FLET_BEAM = 0xbdb6a6;

/**
 * The flets as kit geometry, centred on the trunk of the vegetation's mallorn at `ground + h` (the ground
 * under the trunk: the deck follows the tree, not the slope), wrapping the tapered trunk exactly
 * (mallornFrame.radiusAt): a thin white deck (family 'plaster'), a low rail ring on its rim and a bracket
 * springing from the trunk under it — both lamp-gated glow (family 'emissive' in the lamp colour, faint:
 * each flet reads as lit by its lanterns at night; grey by day) — and radial beams under the bracket.
 * Not seated: they hang on the trunks, so they record no ground contacts. ≈ 400 tris per flet.
 */
export function buildFlets(k: ProxyKit): void {
  for (const f of FLETS) {
    const fr = FRAMES[f.tree];
    const y = k.ground(f.x, f.z) + f.h;
    const seg = f.r > 0.4 ? 18 : 15;
    const trDeck = fr.radiusAt(f.h) * 0.97;
    const trLow = fr.radiusAt(f.h - 0.12) * 0.97;
    const at: [number, number, number] = [f.x, y, f.z];
    k.lathe(
      'plaster',
      [
        [trDeck, -0.02],
        [f.r, -0.02],
        [f.r, 0.02],
        [trDeck, 0.02],
      ],
      { at, seg, color: FLET_WHITE, lod: f.lod },
    );
    k.lathe(
      'emissive',
      [
        [trLow, -0.12],
        [f.r * 0.6, -0.046],
        [f.r * 0.93, -0.0205],
      ],
      { at, seg, color: LAMP, glow: { strength: 0.1, gate: 'night', flicker: 0.02 }, lod: f.lod },
    );
    k.ring('emissive', f.r * 0.975, 0.012, 0.022, { at: [f.x, y + 0.02, f.z], seg, color: LAMP, glow: { strength: 0.25, gate: 'night', flicker: 0.02 }, lod: 0 });
    // radial beams under the bracket, trunk → 0.62 r
    const nb = f.r > 0.4 ? 5 : 4;
    const a0 = rand(SEED, 900 + f.tree, Math.round(f.h * 10)) * Math.PI * 2;
    const x0 = trLow * 0.9;
    const x1 = f.r * 0.62;
    const y0 = -0.128;
    const y1 = -0.054;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const tilt = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
    for (let b = 0; b < nb; b++) {
      const a = a0 + (b / nb) * Math.PI * 2;
      const m = (x0 + x1) / 2;
      k.box('wood', len, 0.014, 0.014, {
        at: [f.x + Math.cos(a) * m, y + (y0 + y1) / 2 - 0.012, f.z + Math.sin(a) * m],
        rot: [0, (-a * 180) / Math.PI, tilt],
        color: FLET_BEAM,
        lod: 0,
      });
    }
  }
}

/**
 * 150 blue-white elven lamps as kit light records (heights above the ground under each lamp's tree):
 * three lanterns on every flet rim at jittered angles and brightness (the outer rings' on the outward
 * two-thirds of the rim, where a camera outside the grove can see them), the rest hung among the branches
 * — sunk 0.15–0.25 km inside the crown tiers, so the leaves partly hide them.
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
    const out0 = Math.atan2(t.at[1] - GROVE[1], t.at[0] - GROVE[0]);
    const full = t.ring <= 1;
    const a0 = full ? rand(SEED, 500 + fi, 9) * Math.PI * 2 : out0 - Math.PI * 0.67;
    const span = full ? Math.PI * 2 : Math.PI * 1.33;
    for (let q = 0; q < FLET_LAMPS; q++) {
      const a = a0 + ((q + 0.15 + 0.7 * rand(SEED, 500 + fi, q)) / FLET_LAMPS) * span;
      const rr = f.r * (0.84 + 0.1 * rand(SEED, 600 + fi, q));
      add(t, f.x + Math.cos(a) * rr, f.z + Math.sin(a) * rr, f.h + 0.045, 1.6 * (0.6 + 0.4 * rand(SEED, 650 + fi, q)), 0.05);
    }
  });
  for (let i = 0; n < LAMP_COUNT; i++) {
    // the inner trees first (their crowns rise clear of the others)
    const ti = i % 7;
    const t = GROVE_TREES[ti];
    const fr = FRAMES[ti];
    const tier = fr.tiers[Math.min(fr.tiers.length - 1, 1 + (i % 2))];
    const out0 = t.ring === 0 ? rand(SEED, 700 + i, 5) * Math.PI * 2 : Math.atan2(t.at[1] - GROVE[1], t.at[0] - GROVE[0]);
    const phi = out0 + (rand(SEED, 700 + i, 0) - 0.5) * Math.PI;
    const th = (-0.1 + 0.6 * rand(SEED, 700 + i, 1)) * (Math.PI / 2);
    const sink = 0.15 + 0.1 * rand(SEED, 700 + i, 2);
    const yc = tier.trunk + 0.46 * tier.vr;
    const rh = Math.max(0.1, tier.hr * Math.cos(th) - sink);
    const rv = 0.82 * tier.vr * Math.sin(th);
    add(t, t.at[0] + Math.cos(phi) * rh, t.at[1] + Math.sin(phi) * rh, yc + rv - Math.sign(rv) * sink * 0.5, (1.3 + 0.5 * rand(SEED, 700 + i, 3)) * 0.6, 0.045);
  }
}
