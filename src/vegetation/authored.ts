import { rand } from '../core/rng.ts';
import type { AuthoredTree, TreeKind } from '../landmarks/records.ts';
import { Arch, archMaxReach, archReach } from './archetypes.ts';
import { RING } from './clumpGeometry.ts';
import { InstanceList, Kind, LORIEN_TRUNK_K, pickColor, type Crown } from './placement.ts';

/**
 * Authored landmark trees (the mallorns of Caras Galadhon, the Party Tree, Rivendell's autumn
 * trees, Moria's hollies…) → instance records in the shared 10-float cluster format
 * (placement.ts FLOATS_PER_INSTANCE). Each TreeKind maps onto an existing foliage `Kind` + cluster
 * `Shape` + explicit colour, so no new vertex attributes or materials are needed (the foliage
 * material's per-kind trunk colour and translucency apply: mallorns get silver bark and the faint
 * Lórien glow). Pure function of (trees, seed).
 *
 * Sizes: `crownKm` is the horizontal crown radius (≈ the cluster radius hr); `heightKm` the total
 * height ground → crown top (the trunk is derived from it with the cluster's crown reach); without
 * it each kind's recipe decides.
 */

/**
 * crown top above the crown bottom in units of vr, for a record of this spread and archetype (the cluster
 * layouts: tallest sub-crowns; archetypes.ts archReach)
 */
export function crownReach(spread: number, arch: number = Arch.Cluster): number {
  if (arch === Arch.Cluster || arch === Arch.Canopy || arch === Arch.CanopyEdge) return 1.8 * (1 - RING * spread);
  return archReach(arch, spread);
}

/** the tallest crown top an instance can reach (units of vr; bounds and tree-height caps — archMaxReach) */
export function crownMaxReach(spread: number, arch: number = Arch.Cluster): number {
  if (arch === Arch.Cluster || arch === Arch.Canopy || arch === Arch.CanopyEdge) return 1.8 * (1 - RING * spread);
  return archMaxReach(arch, spread);
}

/**
 * Hero trunk profile (the hero geometry of VegetationSystem — ringed trunks of authored trees near the
 * camera; foliageMaterial.ts builds the same curve on the GPU): radius(h) = trunkR · taper(h) · flare(h),
 * h km above the ground under the trunk. The taper runs from 1 at the foot to `taper` at the crown base
 * (the tier origin `trunk`) and on to `taperTop` inside the crown; the root flare widens the foot by
 * `flare` (1.8× in all) over the lowest `flareKm` (or a twentieth of the trunk, if shorter), and the foot
 * is sunk `sink` + 2.2·trunkR below the ground (never floats on a slope or over the coarse terrain LODs).
 */
export const HERO_TRUNK = { taper: 0.55, taperTop: 0.45, flare: 0.8, flareKm: 0.15, sink: 0.08 } as const;

/** Radius of a hero trunk at `h` km above its ground (see HERO_TRUNK). */
export function heroTrunkRadius(trunkR: number, trunk: number, trunkTop: number, h: number): number {
  const T = HERO_TRUNK;
  const c = (v: number) => Math.min(1, Math.max(0, v));
  const taper = 1 - (1 - T.taper) * c(h / Math.max(trunk, 1e-3)) - (T.taper - T.taperTop) * c((h - trunk) / Math.max(trunkTop - trunk, 1e-3));
  const fh = Math.min(T.flareKm, trunk / 20);
  const f = 1 - c(h / Math.max(fh, 1e-3));
  return trunkR * taper * (1 + T.flare * f * f);
}

/**
 * Stacked crown tiers of an authored mallorn (the great trees of Caras Galadhon): 3 (crown < 1.2 km) or 4
 * tiers of broad, flattened clusters (vr = MALLORN_TIER_VR · hr), each smaller than the one below and
 * lifted TIER_STEP of its height above it — a tall conical crown with shelves and sky gaps between the
 * tiers, not one round blob. Every tier is its own instance record (trunk to its origin, its own limbs).
 */
export const MALLORN_TIER_VR = 0.8;
const TIER_SHRINK: Record<3 | 4, number[]> = { 3: [1, 0.72, 0.44], 4: [1, 0.78, 0.56, 0.34] };
const TIER_STEP = 0.74;
const TIER_SPREAD = 0.56;

export interface MallornTier {
  hr: number;
  vr: number;
  /** tier origin (crown base) above the ground, km */
  trunk: number;
}

/** trunk / crown frame of an authored mallorn (km above the ground under its trunk) */
export interface MallornFrame {
  tiers: MallornTier[];
  /** origin of the lowest tier: the crown base, where the trunk taper ends */
  trunk: number;
  /** vertical radius of the lowest tier */
  vr: number;
  /** ≈ lowest leaves of the crown (a few sub-crowns hang lower) */
  low: number;
  top: number;
  /** trunk radius at the foot (before the root flare) */
  trunkR: number;
  /** trunk radius at height h (hero geometry; the flets wrap the trunk at this radius) */
  radiusAt(h: number): number;
}

/**
 * Where an authored mallorn's parts sit (km above the ground under its trunk), for landmarks that seat
 * flets and lamps on it (src/landmarks/lothlorien/grove.ts). Exact for the tiered hero recipe.
 */
export function mallornFrame(crownKm: number, heightKm: number): MallornFrame {
  const hr = Math.max(0.02, crownKm);
  const shrink = TIER_SHRINK[hr >= 1.2 ? 4 : 3];
  const rel: { hr: number; vr: number; o: number }[] = [];
  let o = 0;
  for (const k of shrink) {
    const h = hr * k;
    const vr = MALLORN_TIER_VR * h;
    rel.push({ hr: h, vr, o });
    o += TIER_STEP * vr;
  }
  const last = rel[rel.length - 1];
  const o0 = Math.max(0, heightKm - (last.o + crownReach(TIER_SPREAD) * last.vr));
  const tiers = rel.map((t) => ({ hr: t.hr, vr: t.vr, trunk: o0 + t.o }));
  const trunkR = LORIEN_TRUNK_K * hr;
  const top0 = trunkTopOf(tiers[0]);
  return { tiers, trunk: o0, vr: tiers[0].vr, low: o0 - 0.35 * tiers[0].vr, top: heightKm, trunkR, radiusAt: (h) => heroTrunkRadius(trunkR, o0, top0, h) };
}

/** top of a record's trunk inside its crown (foliageMaterial.ts: trunk + vr·kSpread·0.21) */
function trunkTopOf(t: MallornTier): number {
  return t.trunk + t.vr * ((1 - RING * TIER_SPREAD) / 0.4) * 0.21;
}

type RGB = [number, number, number];

function hexRgb(hex: number): RGB {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

interface Recipe {
  kind: Kind;
  crown: (hr: number, r: (k: number) => number) => Crown;
  /** default sRGB crown colours (one picked per tree) — null: the kind's palette */
  colors: number[] | null;
  /**
   * bare stem as a share of the declared total height (`heightKm`): [min, max]. A tree declared taller
   * than its crown proportions grows a taller crown (never a lollipop stick); one declared shorter keeps
   * at least the minimum stem.
   */
  stem: [number, number];
}

const RECIPES: Record<TreeKind, Recipe> = {
  // silver column, a tall tiered golden crown high above the canopy (authoredRecords: mallornFrame tiers;
  // this entry is the default height and palette)
  mallorn: {
    kind: Kind.Lorien,
    crown: (hr) => ({ hr, vr: hr * MALLORN_TIER_VR, trunk: hr * 1.6, shape: { spread: TIER_SPREAD, gap: 0.06, hVar: 0.3, arch: Arch.Cluster } }),
    colors: [0xc4a436, 0xcaa83a, 0xb89a30],
    stem: [0, 1],
  },
  // spreading oak: broad, asymmetric crown on a short bole (placement.ts broadleaf, oak branch)
  oak: {
    kind: Kind.Oak,
    crown: (hr, r) => {
      const vr = hr * (0.85 + 0.15 * r(2));
      return { hr, vr, trunk: vr * (0.38 + 0.12 * r(3)), shape: { spread: 0.62, gap: 0.12, hVar: 0.4, arch: Arch.Broadleaf } };
    },
    colors: null,
    stem: [0.2, 0.3],
  },
  // the Party Tree: very large, broad and full
  party: {
    kind: Kind.Oak,
    crown: (hr, r) => {
      const vr = hr * (0.9 + 0.06 * r(2));
      return { hr, vr, trunk: vr * 0.45, shape: { spread: 0.68, gap: 0.05, hVar: 0.32, arch: Arch.Broadleaf } };
    },
    colors: [0x4b5e27, 0x53652b],
    stem: [0.2, 0.3],
  },
  // holly: a dense, dark, glossy, pointed ovoid reaching low
  holly: {
    kind: Kind.Dark,
    crown: (hr, r) => {
      const vr = hr * (1.0 + 0.2 * r(2));
      return { hr, vr, trunk: vr * 0.16, shape: { spread: 0.4, gap: 0, hVar: 0.3, arch: Arch.Holly } };
    },
    colors: [0x2f4a2a],
    stem: [0.1, 0.2],
  },
  // Rivendell's autumn broadleaves
  autumn: {
    kind: Kind.Oak,
    crown: (hr, r) => {
      const vr = hr * (0.95 + 0.2 * r(2));
      return { hr, vr, trunk: vr * (0.42 + 0.12 * r(3)), shape: { spread: 0.55, gap: 0.08, hVar: 0.35, arch: Arch.Broadleaf } };
    },
    colors: [0xb5702a, 0xd19a3a],
    stem: [0.2, 0.3],
  },
  // fir / pine: one pointed spire (archetype Conifer), a short bare stem
  conifer: {
    kind: Kind.Generic,
    crown: (hr, r) => {
      const vr = hr * (1.8 + 0.5 * r(2));
      return { hr, vr, trunk: vr * 0.1, shape: { spread: 0.3, gap: 0, hVar: 0.2, arch: Arch.Conifer } };
    },
    colors: [0x2a4226, 0x233a22, 0x2f4a2b],
    stem: [0.05, 0.14],
  },
  // poplar / birch: a narrow column
  poplar: {
    kind: Kind.River,
    crown: (hr, r) => {
      const vr = hr * (1.6 + 0.4 * r(2));
      return { hr, vr, trunk: vr * 0.1, shape: { spread: 0.3, gap: 0, hVar: 0.25, arch: Arch.Columnar } };
    },
    colors: null,
    stem: [0.06, 0.16],
  },
  // willow: a broad, low, drooping crown leaning over the water
  willow: {
    kind: Kind.River,
    crown: (hr, r) => {
      const vr = hr * (0.8 + 0.1 * r(2));
      return { hr, vr, trunk: vr * 0.32, shape: { spread: 0.66, gap: 0.1, hVar: 0.45, arch: Arch.Broadleaf } };
    },
    colors: [0x6f7a3e, 0x66713a],
    stem: [0.14, 0.28],
  },
  scrub: {
    kind: Kind.Scrub,
    crown: (hr, r) => {
      const vr = hr * (0.7 + 0.15 * r(2));
      return { hr, vr, trunk: vr * 0.03, shape: { spread: 0.6, gap: 0.15, hVar: 0.3, arch: Arch.Shrub } };
    },
    colors: null,
    stem: [0, 0.1],
  },
};

/**
 * Authored trees → instance records (world space). The hero list of VegetationSystem: drawn before
 * the placed vegetation (wins the LOD0 cap), never excluded, never thinned by the quality density.
 */
export function authoredRecords(trees: readonly AuthoredTree[], seed: number): InstanceList {
  const out = new InstanceList();
  for (const t of trees) pushTree(out, t, seed);
  return out;
}

/** The tree fields the record recipes need (an AuthoredTree, or one tree of a landmark forest). */
type TreeSpec = Pick<AuthoredTree, 'x' | 'z' | 'kind' | 'crownKm' | 'heightKm' | 'color' | 'yaw' | 'id'>;

/**
 * One tree of a landmark forest (forests.ts) → one instance record (conifers are one Conifer-archetype
 * spire since S4, no longer two stacked clusters).
 */
export function pushForestTree(out: InstanceList, t: TreeSpec, seed: number): void {
  pushTree(out, t, seed);
}

function pushTree(out: InstanceList, t: TreeSpec, seed: number): void {
  {
    const rec = RECIPES[t.kind];
    const r = (k: number) => rand(seed, t.id, k);
    const hr = Math.max(0.02, t.crownKm);
    const c = rec.crown(hr, r);
    let trunk = c.trunk;
    let vr = c.vr;
    if (t.heightKm !== undefined && t.kind !== 'mallorn') {
      // the declared height: the stem within its share, the crown takes the rest
      const reach = crownReach(c.shape.spread, c.shape.arch);
      const h = Math.max(0.01, t.heightKm);
      trunk = Math.min(rec.stem[1] * h, Math.max(rec.stem[0] * h, h - reach * c.vr));
      vr = (h - trunk) / reach;
    }
    let rgb: RGB;
    if (t.color !== undefined) rgb = hexRgb(t.color);
    else if (rec.colors) {
      const base = hexRgb(rec.colors[Math.floor(r(4) * rec.colors.length) % rec.colors.length]);
      const b = 0.94 + 0.12 * r(5);
      rgb = [base[0] * b, base[1] * b, base[2] * b];
    } else rgb = pickColor(rec.kind, seed, t.id, t.x, t.z);
    if (t.kind === 'mallorn') {
      // stacked tiers, each its own cluster (upper tiers a little brighter and more broken)
      const f = mallornFrame(hr, t.heightKm ?? c.trunk + crownReach(TIER_SPREAD) * c.vr);
      f.tiers.forEach((tier, k) => {
        const lift = 1 + 0.045 * k;
        const shape = { spread: TIER_SPREAD + 0.04 * (r(10 + k) - 0.5), gap: k === 0 ? 0.06 : 0.14, hVar: 0.3, arch: Arch.Cluster };
        out.push(t.x, t.z, tier.hr, tier.vr, tier.trunk, rec.kind, t.yaw + k * 0.93, 0.92 + 0.16 * r(20 + k), [rgb[0] * lift, rgb[1] * lift, rgb[2] * lift], shape);
      });
      return;
    }
    out.push(t.x, t.z, c.hr, vr, trunk, rec.kind, t.yaw, 0.9 + 0.2 * r(6), rgb, c.shape);
  }
}
