/**
 * Crown archetypes (S4): the vertex-stage layout of a cluster's seven sub-crowns (clumpGeometry.ts) per
 * instance. The archetype travels in the record's shape field (placement.ts: spread + 2·gapQ + 128·arch;
 * gapQ ≤ 45 so the low part stays < 128), so no vertex buffer is added.
 *
 * - `Canopy` (0): a patch of forest canopy — seven separate crowns (the S3 layout). Retired into the far
 *   canopy shell (canopyShell.ts) across its band (crowns of SHELL_NEAR_PX … SHELL_FAR_PX on screen).
 * - `Broadleaf` (1): one deciduous tree — a per-instance asymmetry vector, a jittered ring of crowns of
 *   varied size, one or two dominant upper lobes, a slight lean, a broken base on a visible trunk.
 * - `Conifer` (2): sub-crowns stacked into a pointed spire, each whorl tapered (a skirt, never a puck).
 * - `Columnar` (3): poplar / cypress — a narrow column, pointed at the top.
 * - `Holly` (4): a dense, pointed ovoid of dark glossy foliage reaching low.
 * - `Shrub` (5): a low, broken dome without a trunk.
 * - `ConiferStand` (6): a canopy patch of spires (montane forest); retired like `Canopy`.
 * - `Cluster` (7): the S3 cluster layout for records that are never retired (hedges, mallorn tiers).
 * - `CanopyEdge` (8): a canopy patch on the outer ring of a forest — the `Canopy` layout, baked into the
 *   shell's colour and cover like it, but never retired, so a far forest keeps a standing edge (review /
 *   final; the preview tier places these as `Canopy`).
 */
export const Arch = {
  Canopy: 0,
  Broadleaf: 1,
  Conifer: 2,
  Columnar: 3,
  Holly: 4,
  Shrub: 5,
  ConiferStand: 6,
  Cluster: 7,
  CanopyEdge: 8,
} as const;
export type Arch = (typeof Arch)[keyof typeof Arch];

/** archetype from a record's packed shape field (spread + 2·gapQ + 128·arch) */
export function archOf(shape: number): Arch {
  return Math.floor(shape / 128) as Arch;
}

/** spread from a record's packed shape field (128·arch and 2·gapQ are even: the fraction survives) */
export function spreadOf(shape: number): number {
  return shape - 2 * Math.floor(shape / 2);
}

/** records the far canopy shell replaces (forest interiors) */
export function retires(arch: number): boolean {
  return arch === Arch.Canopy || arch === Arch.ConiferStand;
}

/** records whose colour and cover the far canopy shell carries (the retiring patches and the edge ring) */
export function bakes(arch: number): boolean {
  return retires(arch) || arch === Arch.CanopyEdge;
}

/**
 * TYPICAL crown top above the crown bottom in units of vr, per archetype (the layout of foliageMaterial.ts
 * without its per-instance extremes: the shading's crown-height fraction, the stem top, a declared height).
 * The cluster layouts depend on the spread; the tree archetypes are normalised. Height CAPS use
 * archMaxReach (the tallest an instance of the layout can reach).
 */
export function archReach(arch: number, spread: number): number {
  switch (arch) {
    case Arch.Broadleaf:
      return 1.2;
    case Arch.Conifer:
      return 1.8;
    case Arch.Columnar:
      return 2.3;
    case Arch.Holly:
      return 1.75;
    case Arch.Shrub:
      return 0.8;
    case Arch.ConiferStand:
      return 1.15;
    default:
      return 1.8 * (1 - 0.6 * spread);
  }
}

/**
 * The TALLEST crown top an instance of the archetype can reach (units of vr above the crown bottom): the
 * largest sub-crown at its largest stretch, lift and height jitter, plus the silhouette foam (+8 %) — what
 * a tree-height cap must hold (treeCaps.ts). Broadleaf: a dominant lobe (R ≤ 0.5·1.24·1.12, sy ≤ 1.08,
 * lift 0.3, jitter ≤ 0.12) ≈ 1.55; conifer stands: a 2.3-stretched ring spire ≈ 1.5.
 */
export function archMaxReach(arch: number, spread: number): number {
  switch (arch) {
    case Arch.Broadleaf:
      return 1.55;
    case Arch.ConiferStand:
      return 1.5;
    default:
      return archReach(arch, spread);
  }
}
