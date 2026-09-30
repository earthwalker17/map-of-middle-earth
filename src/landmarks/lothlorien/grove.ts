import { hashString, rand } from '../../core/rng.ts';
import type { LightDecl, TreeDecl, V2 } from '../types.ts';

/**
 * Caras Galadhon: the grove of the greatest mallorns (local km around the display point). Research
 * (landmarks-west-north §7): giant smooth silver-grey trunks rising well above the Lórien canopy,
 * golden crowns, white flets, lamps glowing among the branches at night — the city is a cluster
 * of the biggest trees, the tallest at the centre.
 *
 * Rings around the grove centre (crown tops above the ground; the Lórien canopy reaches ≈ 1.8–2 km,
 * the emergent wild mallorns ≈ 2.5 km): centre 5.6 km · 6 at 1.8 km · 12 at 3.3 km · 21 at 4.8 km.
 * Everything is a pure function of the landmark seed.
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
  { n: 1, r: 0, crown: [1.5, 1.5], height: [5.6, 5.6] },
  { n: 6, r: 1.8, crown: [1.3, 1.4], height: [4.6, 5.0] },
  { n: 12, r: 3.3, crown: [1.15, 1.3], height: [4.0, 4.4] },
  { n: 21, r: 4.8, crown: [1.0, 1.15], height: [3.4, 3.75] },
];

export interface GroveTree {
  at: V2;
  crownKm: number;
  heightKm: number;
  ring: number;
}

export const GROVE_TREES: GroveTree[] = [];
RINGS.forEach((ring, ri) => {
  const a0 = rand(SEED, ri, 0) * Math.PI * 2;
  for (let i = 0; i < ring.n; i++) {
    const id = ri * 100 + i;
    const a = a0 + ((i + (rand(SEED, id, 1) - 0.5) * 0.45) / ring.n) * Math.PI * 2;
    const r = ring.r * (1 + (rand(SEED, id, 2) - 0.5) * 0.16);
    const t = rand(SEED, id, 3);
    GROVE_TREES.push({
      at: [GROVE[0] + Math.cos(a) * r, GROVE[1] + Math.sin(a) * r],
      crownKm: ring.crown[0] + (ring.crown[1] - ring.crown[0]) * t,
      // bigger crowns stand taller (correlated, with a little independent jitter)
      heightKm: ring.height[0] + (ring.height[1] - ring.height[0]) * (0.7 * t + 0.3 * rand(SEED, id, 4)),
      ring: ri,
    });
  }
});

export const TREES: TreeDecl[] = GROVE_TREES.map((t, i) => ({ at: t.at, kind: 'mallorn', crownKm: t.crownKm, heightKm: t.heightKm, color: 0xd6b94e, yawDeg: rand(SEED, i, 9) * 360 }));

/**
 * Approximate crown underside above the ground (km) for a mallorn of this crown / height: the
 * vegetation recipe (vegetation/authored.ts, hero mallorn) derives the trunk from the height with
 * the cluster reach (≈ 1.26 · vr at spread 0.5) and vr ≈ 1.2–1.45 · crown — the mean is used here.
 */
const VR = 1.32;
export function crownBase(t: GroveTree): number {
  return t.heightKm - 1.26 * VR * t.crownKm;
}
const trunkRadius = (t: GroveTree) => 0.12 * t.crownKm;

export interface Flet {
  x: number;
  z: number;
  /** height above the tree's ground, km */
  h: number;
  r: number;
}

/** White flets around the trunks of the central seven trees (two levels each). */
export const FLETS: Flet[] = GROVE_TREES.filter((t) => t.ring <= 1).flatMap((t) => {
  const top = crownBase(t);
  const r = t.ring === 0 ? 0.44 : 0.34;
  return [0.5, 0.78].map((f) => ({ x: t.at[0], z: t.at[1], h: top * f, r: r * (f > 0.6 ? 0.85 : 1) }));
});

const LAMP = 0xdfe8ff;

/**
 * ~150 blue-white elven lamps (heights relative to the ground under each tree — `ground` is the
 * proxy's local ground function, the lights are declared relative to the origin's ground):
 * lanterns on the flet rims, a spiral of stair lamps up the seven central trunks, lanterns hung
 * round the outer crowns of the grove.
 */
export function lamps(ground: (x: number, z: number) => number): LightDecl[] {
  const out: LightDecl[] = [];
  const add = (x: number, z: number, h: number, intensity: number, radius: number) =>
    out.push({ at: [x, ground(x, z) + h, z], color: LAMP, intensity, radius, kind: 'lamp' });
  // flet rims: 4 lanterns each
  FLETS.forEach((f, fi) => {
    for (let k = 0; k < 4; k++) {
      const a = ((k + rand(SEED, 500 + fi, k)) / 4) * Math.PI * 2;
      add(f.x + Math.cos(a) * f.r * 0.92, f.z + Math.sin(a) * f.r * 0.92, f.h + 0.035, 1.5, 0.045);
    }
  });
  // stair lamps spiralling up the central trunks
  GROVE_TREES.filter((t) => t.ring <= 1).forEach((t, ti) => {
    const top = crownBase(t);
    for (let k = 0; k < 3; k++) {
      const a = (k * 2.4 + ti) % (Math.PI * 2);
      const r = trunkRadius(t) * 1.3;
      add(t.at[0] + Math.cos(a) * r, t.at[1] + Math.sin(a) * r, top * (0.15 + 0.14 * k), 1.1, 0.035);
    }
  });
  // lanterns hung round the outer crowns of the grove (on the outer branches, lower half of the
  // crown, facing out of the grove — inside it the crowns overlap and would hide them): the outer
  // ring two or three each, the middle ring one or two
  const outer = GROVE_TREES.filter((t) => t.ring >= 2);
  const hanging = 150 - out.length;
  for (let i = 0; i < hanging; i++) {
    const t = outer[i % outer.length];
    const out0 = Math.atan2(t.at[1] - GROVE[1], t.at[0] - GROVE[0]);
    const a = out0 + (rand(SEED, 700 + i, 0) - 0.5) * Math.PI * 1.1;
    const rho = t.crownKm * (1.08 + 0.16 * rand(SEED, 700 + i, 1));
    const h = crownBase(t) + VR * t.crownKm * (0.05 + 0.5 * rand(SEED, 700 + i, 2));
    add(t.at[0] + Math.cos(a) * rho, t.at[1] + Math.sin(a) * rho, h, 1.2 + 0.5 * rand(SEED, 700 + i, 3), 0.04);
  }
  return out;
}
