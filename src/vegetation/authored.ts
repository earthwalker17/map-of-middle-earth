import { rand } from '../core/rng.ts';
import type { AuthoredTree, TreeKind } from '../landmarks/records.ts';
import { RING } from './clumpGeometry.ts';
import { HERO_MALLORN_VR, InstanceList, Kind, LORIEN_TRUNK_K, mallornShape, pickColor, type Crown } from './placement.ts';

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

/** crown top above the crown bottom in units of vr, for a cluster of this spread (tallest sub-crowns) */
export function crownReach(spread: number): number {
  return 1.8 * (1 - RING * spread);
}

/**
 * Where an authored mallorn's parts sit (km above the ground under its trunk), for landmarks that seat
 * flets and lamps on it (src/landmarks/lothlorien/grove.ts). The crown cluster's origin is `trunk`; its
 * sub-crowns reach `top` (= heightKm) and hang down to ≈ `low` (typical; a few hang lower); the silver
 * trunk has radius `trunkR`. Exact for the hero mallorn recipe below (fixed crown ratio).
 */
export function mallornFrame(crownKm: number, heightKm: number): { trunk: number; vr: number; low: number; top: number; trunkR: number } {
  const hr = Math.max(0.02, crownKm);
  const vr = hr * HERO_MALLORN_VR;
  const trunk = Math.max(0, heightKm - crownReach(0.5) * vr);
  return { trunk, vr, low: trunk - 0.35 * vr, top: heightKm, trunkR: LORIEN_TRUNK_K * hr };
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
}

const RECIPES: Record<TreeKind, Recipe> = {
  // silver column, broad golden crown high above the canopy
  mallorn: { kind: Kind.Lorien, crown: (hr, r) => mallornShape(hr, hr * 1.6, r(1), true), colors: [0xc4a436, 0xcaa83a, 0xb89a30] },
  // spreading oak: broad crown on a short bole (placement.ts broadleaf, oak branch)
  oak: {
    kind: Kind.Oak,
    crown: (hr, r) => {
      const vr = hr * (0.72 + 0.14 * r(2));
      return { hr, vr, trunk: vr * (0.45 + 0.15 * r(3)), shape: { spread: 0.62, gap: 0.14, hVar: 0.4 } };
    },
    colors: null,
  },
  // the Party Tree: very large, broad and full
  party: {
    kind: Kind.Oak,
    crown: (hr, r) => {
      const vr = hr * (0.76 + 0.06 * r(2));
      return { hr, vr, trunk: vr * 0.42, shape: { spread: 0.68, gap: 0.06, hVar: 0.32 } };
    },
    colors: [0x4b5e27, 0x53652b],
  },
  // dark, tall, narrow evergreen
  holly: {
    kind: Kind.Dark,
    crown: (hr, r) => {
      const vr = hr * (1.8 + 0.3 * r(2));
      return { hr, vr, trunk: vr * 0.12, shape: { spread: 0.3, gap: 0.04, hVar: 0.3 } };
    },
    colors: [0x2f4a2a],
  },
  // Rivendell's autumn broadleaves
  autumn: {
    kind: Kind.Oak,
    crown: (hr, r) => {
      const vr = hr * (0.82 + 0.16 * r(2));
      return { hr, vr, trunk: vr * (0.38 + 0.12 * r(3)), shape: { spread: 0.55, gap: 0.1, hVar: 0.35 } };
    },
    colors: [0xb5702a, 0xd19a3a],
  },
  conifer: {
    kind: Kind.Generic,
    crown: (hr, r) => {
      const vr = hr * (2.2 + 0.5 * r(2));
      return { hr, vr, trunk: vr * 0.1, shape: { spread: 0.24, gap: 0.05, hVar: 0.5 } };
    },
    colors: [0x2a4226, 0x233a22, 0x2f4a2b],
  },
  poplar: {
    kind: Kind.River,
    crown: (hr, r) => {
      const vr = hr * (2.1 + 0.4 * r(2));
      return { hr, vr, trunk: vr * 0.15, shape: { spread: 0.28, gap: 0.05, hVar: 0.4 } };
    },
    colors: null,
  },
  willow: {
    kind: Kind.River,
    crown: (hr, r) => {
      const vr = hr * (0.72 + 0.1 * r(2));
      return { hr, vr, trunk: vr * 0.3, shape: { spread: 0.6, gap: 0.1, hVar: 0.3 } };
    },
    colors: [0x6f7a3e, 0x66713a],
  },
  scrub: {
    kind: Kind.Scrub,
    crown: (hr, r) => {
      const vr = hr * (0.75 + 0.15 * r(2));
      return { hr, vr, trunk: vr * 0.05, shape: { spread: 0.5, gap: 0.15, hVar: 0.3 } };
    },
    colors: null,
  },
};

/**
 * Authored trees → instance records (world space). The hero list of VegetationSystem: drawn before
 * the placed vegetation (wins the LOD0 cap), never excluded, never thinned by the quality density.
 */
export function authoredRecords(trees: readonly AuthoredTree[], seed: number): InstanceList {
  const out = new InstanceList();
  for (const t of trees) {
    const rec = RECIPES[t.kind];
    const r = (k: number) => rand(seed, t.id, k);
    const hr = Math.max(0.02, t.crownKm);
    const c = rec.crown(hr, r);
    let trunk = c.trunk;
    if (t.heightKm !== undefined) trunk = Math.max(0, t.heightKm - crownReach(c.shape.spread) * c.vr);
    let rgb: RGB;
    if (t.color !== undefined) rgb = hexRgb(t.color);
    else if (rec.colors) {
      const base = hexRgb(rec.colors[Math.floor(r(4) * rec.colors.length) % rec.colors.length]);
      const b = 0.94 + 0.12 * r(5);
      rgb = [base[0] * b, base[1] * b, base[2] * b];
    } else rgb = pickColor(rec.kind, seed, t.id, t.x, t.z);
    out.push(t.x, t.z, c.hr, c.vr, trunk, rec.kind, t.yaw, 0.9 + 0.2 * r(6), rgb, c.shape);
  }
  return out;
}
