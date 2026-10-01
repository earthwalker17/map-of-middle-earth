import type { TreeCapRecord } from '../landmarks/records.ts';
import { archOf, spreadOf } from './archetypes.ts';
import { crownMaxReach } from './authored.ts';

/**
 * Tree-height caps (landmark `treeCaps`, world circles): every instance record whose tallest possible crown
 * top (crownMaxReach: the layout's extremes, not the typical top) stands
 * higher than a cap's maxHeightKm inside its circle is scaled down to it — crown and stem together, so
 * the tree keeps its proportions. The cap fades out over ±15 % of the radius (no ring of stunted trees
 * against full-size ones). Pure function of (records, caps); edits the records in place.
 */
export function applyTreeCaps(recs: { [i: number]: number; length: number }, F: number, caps: readonly TreeCapRecord[]): number {
  if (!caps.length) return 0;
  let changed = 0;
  const count = recs.length / F;
  for (let k = 0; k < count; k++) {
    const s = k * F;
    const x = recs[s];
    const z = recs[s + 1];
    let scale = 1;
    for (const c of caps) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d >= c.r * 1.15) continue;
      const shape = recs[s + 8];
      const top = recs[s + 4] + crownMaxReach(spreadOf(shape), archOf(shape)) * recs[s + 3];
      if (!(top > c.maxHeightKm)) continue;
      const t = Math.min(1, Math.max(0, (d - 0.85 * c.r) / (0.3 * c.r)));
      const w = 1 - t * t * (3 - 2 * t);
      scale = Math.min(scale, 1 - w * (1 - c.maxHeightKm / top));
    }
    if (scale < 1) {
      recs[s + 2] *= scale;
      recs[s + 3] *= scale;
      recs[s + 4] *= scale;
      changed++;
    }
  }
  return changed;
}
