/**
 * Where the river guard bites a landmark's stamps: `node --import tsx tools/check/stamploss.ts [landmark-id...]`
 * Prints the stamp-loss totals and the cells with the largest corrections, with the nearest river line
 * (MOME_WORLD_DIR or data/baked). CPU only.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bakedDir, loadWorld, ROOT } from './baked.ts';

const ids = process.argv.slice(2);
const { world, landmarks } = await loadWorld(bakedDir());
const { landmarkStamps } = (await import(pathToFileURL(join(ROOT, 'src/landmarks/world.ts')).href)) as typeof import('../../src/landmarks/world.ts');
const hf = world.heights;

function nearestLine(x: number, z: number): { d: number; id: string; level: number } {
  let best = { d: Infinity, id: '', level: 0 };
  for (const r of world.rivers)
    for (let i = 1; i < r.points.length; i++) {
      const [ax, az] = r.points[i - 1];
      const ex = r.points[i][0] - ax;
      const ez = r.points[i][1] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
      const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t));
      if (d < best.d) best = { d, id: r.id ?? r.name ?? '', level: r.level ? r.level[i - 1] + (r.level[i] - r.level[i - 1]) * t : NaN };
    }
  return best;
}

for (const d of landmarks.filter((l) => !ids.length || ids.includes(l.id))) {
  if (!d.stamps?.length) continue;
  const p = world.place(d.placeId);
  const cells: { x: number; z: number; stamped: number; guarded: number }[] = [];
  const loss = hf.stampLoss(landmarkStamps(world, [d]), (x, z, stamped, guarded) => cells.push({ x, z, stamped, guarded }));
  console.log(`${d.id}: stamp volume ${loss.stampVolume.toFixed(2)}, guard took ${loss.lostVolume.toFixed(2)} (${((100 * loss.lostVolume) / Math.max(1e-9, loss.stampVolume)).toFixed(1)} %), ${loss.cells} cells, max ${loss.maxLost.toFixed(2)}`);
  const n0 = nearestLine(p.x, p.z);
  console.log(`  display point: nearest line ${n0.id} at ${n0.d.toFixed(2)} km (level ${n0.level.toFixed(2)}), ground ${hf.sample(p.x, p.z, 'base').toFixed(2)}`);
  for (const c of cells.sort((a, b) => Math.abs(b.stamped - b.guarded) - Math.abs(a.stamped - a.guarded)).slice(0, 4)) {
    const n = nearestLine(c.x, c.z);
    console.log(`  local (${(c.x - p.x).toFixed(1)}, ${(c.z - p.z).toFixed(1)}): stamped ${c.stamped.toFixed(2)} → ${c.guarded.toFixed(2)}; nearest line ${n.id} at ${n.d.toFixed(2)} km (level ${n.level.toFixed(2)})`);
  }
}
