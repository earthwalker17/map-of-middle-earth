/**
 * Geometry report: the current bake (MOME_WORLD_DIR or data/baked) against a baseline bake
 * (MOME_BASELINE_DIR, default data/baked-s1 — the frozen S1 bake). CPU only, no lock.
 *
 *   node --import tsx tools/check/geometry.ts [--json out.json]
 *
 * Coastline IoU, lakes (wetted area = terrain below the level inside the polygon, dry land below the
 * level just outside it, shore rims raised by the bake, levels, shore walls 0.4 km outside), carved
 * channel vs centreline, river ribbon stats, landmark ground heights, named peaks, snow/tree line
 * areas, relief steepness. Exit code 1 when a hard gate fails (coast IoU < 0.99, wetted lake area off
 * the polygon by > 5 % or, for lakes > 10 km², > 5 % of it spilling outside, channel misaligned > 1 px
 * on > 2 % of samples,
 * dry river centres ≥ 1 %).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LakePoly, RiverLine } from '../../src/world/World.ts';
import { bakedDir, loadWorld, readHeight, readManifest, readMaskChannel, ROOT, type Raster } from './baked.ts';

const cur = bakedDir();
const base = process.env.MOME_BASELINE_DIR ?? join(ROOT, 'data/baked-s1');
if (!existsSync(join(base, 'manifest.json'))) {
  console.error(`[geometry] no baseline bake at ${base} (set MOME_BASELINE_DIR)`);
  process.exit(2);
}
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const report: Record<string, unknown> = { current: cur, baseline: base };
const gates: string[] = [];

const A = readHeight(base);
const B = readHeight(cur);
const mB = readManifest(cur);
const px = mB.kmPerPixel;
const { xMin, zMin } = mB.world;
const bil = (r: Raster, x: number, z: number): number => {
  const fx = Math.min(r.w - 1, Math.max(0, (x - xMin) / px - 0.5));
  const fz = Math.min(r.h - 1, Math.max(0, (z - zMin) / px - 0.5));
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(r.w - 1, x0 + 1);
  const z1 = Math.min(r.h - 1, z0 + 1);
  const tx = fx - x0;
  const tz = fz - z0;
  const d = r.data;
  const a = d[z0 * r.w + x0] + (d[z0 * r.w + x1] - d[z0 * r.w + x0]) * tx;
  const b = d[z1 * r.w + x0] + (d[z1 * r.w + x1] - d[z1 * r.w + x0]) * tx;
  return a + (b - a) * tz;
};
const inRing = (r: [number, number][], x: number, z: number) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const ringDist = (r: [number, number][], x: number, z: number) => {
  let best = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, az] = r[j];
    const ex = r[i][0] - ax;
    const ez = r[i][1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    best = Math.min(best, Math.hypot(x - (ax + ex * t), z - (az + ez * t)));
  }
  return best;
};
const pct = (v: number[], q: number) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

// ------------------------------------------------------------------ coastline
{
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < A.data.length; i++) {
    const a = A.data[i] > 0;
    const b = B.data[i] > 0;
    if (a && b) inter++;
    if (a || b) uni++;
  }
  const iou = inter / uni;
  report.coastIoU = iou;
  console.log(`[geometry] coastline (land = h > 0) IoU ${iou.toFixed(4)}`);
  if (iou < 0.99) gates.push(`coast IoU ${iou.toFixed(4)} < 0.99`);
}

// ------------------------------------------------------------------ lakes
{
  const lakes = JSON.parse(readFileSync(join(cur, mB.files.lakes.file), 'utf8')) as LakePoly[];
  const lakesA = JSON.parse(readFileSync(join(base, readManifest(base).files.lakes.file), 'utf8')) as LakePoly[];
  const chanMask = readMaskChannel(cur, 'water', 0);
  // shore rims the bake raised (report.json lakeRims, bake v2)
  const rims = new Map<string, { over05Km2: number; max: number }>();
  const repFile = (mB.files as { report?: { file: string } }).report;
  if (repFile) for (const r of (JSON.parse(readFileSync(join(cur, repFile.file), 'utf8')) as { lakeRims: { key: string; over05Km2: number; max: number }[] }).lakeRims) rims.set(r.key, r);
  const rows: Record<string, unknown>[] = [];
  const byKey = new Map<string, LakePoly[]>();
  for (const l of lakes) byKey.set(l.key, [...(byKey.get(l.key) ?? []), l]);
  for (const [key, polys] of byKey) {
    const level = polys[0].level;
    if (level === null) continue;
    let poly = 0;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of polys) {
      let a = 0;
      for (let i = 0, j = p.ring.length - 1; i < p.ring.length; j = i++) a += p.ring[j][0] * p.ring[i][1] - p.ring[i][0] * p.ring[j][1];
      poly += Math.abs(a) / 2;
      for (const [x, z] of p.ring) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
    }
    // wetted area: terrain below the level inside the polygon (what the lake surface really covers);
    // spill: dry land below the level within SPILL_KM outside the polygon, river channels aside (a hole
    // in the shore the drawn lake surface does not reach — the lake edge would hang over it)
    const SPILL_KM = 0.5;
    let wetCells = 0;
    let spillCells = 0;
    let dry = 0;
    let depth = 0;
    let n = 0;
    for (let r = Math.floor((z0 - SPILL_KM - zMin) / px); r <= Math.ceil((z1 + SPILL_KM - zMin) / px); r++)
      for (let c = Math.floor((x0 - SPILL_KM - xMin) / px); c <= Math.ceil((x1 + SPILL_KM - xMin) / px); c++) {
        if (r < 0 || c < 0 || r >= B.h || c >= B.w) continue;
        const x = xMin + (c + 0.5) * px;
        const z = zMin + (r + 0.5) * px;
        const h = B.data[r * B.w + c];
        if (polys.some((p) => inRing(p.ring, x, z))) {
          n++;
          if (h > level - 0.01) dry++;
          else wetCells++;
          depth += level - h;
        } else if (h < level - 0.01 && h > 0 && chanMask.data[r * B.w + c] < 128 && polys.some((p) => ringDist(p.ring, x, z) < SPILL_KM)) spillCells++;
      }
    const area = wetCells * px * px;
    const spill = spillCells * px * px;
    // shore walls: terrain 0.4 km outside the polygon along each edge's outward normal
    const walls: number[] = [];
    const wallsA: number[] = [];
    const levelA = lakesA.find((l) => l.key === key)?.level ?? null;
    for (const p of polys)
      for (let i = 0, j = p.ring.length - 1; i < p.ring.length; j = i++) {
        const [ax, az] = p.ring[j];
        const [bx, bz] = p.ring[i];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1e-6) continue;
        let nx = -(bz - az) / L;
        let nz = (bx - ax) / L;
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        if (inRing(p.ring, mx + nx * 0.05, mz + nz * 0.05)) {
          nx = -nx;
          nz = -nz;
        }
        walls.push(bil(B, mx + nx * 0.4, mz + nz * 0.4) - level);
        if (levelA !== null) wallsA.push(bil(A, mx + nx * 0.4, mz + nz * 0.4) - levelA);
      }
    const off = (area - poly) / poly;
    const rim = rims.get(key);
    rows.push({ key, level, levelS1: levelA, polygonKm2: +poly.toFixed(1), wetKm2: +area.toFixed(1), areaErr: +off.toFixed(3), spillKm2: +spill.toFixed(1), rimRaisedKm2: rim?.over05Km2 ?? null, rimMax: rim?.max ?? null, dryPct: +((100 * dry) / Math.max(1, n)).toFixed(1), meanDepth: +(depth / Math.max(1, n)).toFixed(2), wallMedian: +pct(walls, 0.5).toFixed(2), wallP90: +pct(walls, 0.9).toFixed(2), wallMedianS1: +pct(wallsA, 0.5).toFixed(2), wallP90S1: +pct(wallsA, 0.9).toFixed(2) });
    if (poly > 2 && Math.abs(off) > 0.05) gates.push(`lake ${key} wetted ${area.toFixed(1)} km² vs polygon ${poly.toFixed(1)} km² (${(off * 100).toFixed(1)} %)`);
    // (small lakes are dominated by the 0.4 km pixel against the simplified runtime ring)
    if (poly > 10 && spill / poly > 0.05) gates.push(`lake ${key}: ${spill.toFixed(1)} km² of dry land below the level within ${SPILL_KM} km outside the shore (${((100 * spill) / poly).toFixed(1)} % of the lake)`);
  }
  report.lakes = rows;
  console.log('[geometry] lakes (wetted = terrain below the level inside the polygon; spill = dry land below the level ≤ 0.5 km outside (channels aside); rim = shore raised > 0.5 by the bake; walls = terrain 0.4 km outside the polygon above the level; S1 in brackets)');
  for (const r of rows)
    console.log(
      `  ${String(r.key).padEnd(14)} level ${f(r.level as number)} [${f((r.levelS1 as number) ?? NaN)}]  wetted ${r.wetKm2}/${r.polygonKm2} km² (${((r.areaErr as number) * 100).toFixed(1)} %)  spill ${r.spillKm2} km²  rim ${r.rimRaisedKm2 ?? '—'} km² (max ${r.rimMax ?? '—'})  dry ${r.dryPct} %  depth ${r.meanDepth}  walls median ${r.wallMedian} p90 ${r.wallP90} [${r.wallMedianS1} / ${r.wallP90S1}]`,
    );
}

// ------------------------------------------------------------------ rivers: channel alignment + ribbons
const { world, stamps } = await loadWorld(cur);
{
  const rivers = world.rivers as RiverLine[];
  let samples = 0;
  let off = 0;
  for (const r of rivers) {
    if (!r.level) continue;
    const p = r.points;
    for (let i = 2; i + 2 < p.length; i += 2) {
      if (r.level[i] < 0.05 || world.waterLevelAt(p[i][0], p[i][1]) !== null) continue;
      const tx = p[i + 1][0] - p[i - 1][0];
      const tz = p[i + 1][1] - p[i - 1][1];
      const L = Math.hypot(tx, tz) || 1;
      const nx = -tz / L;
      const nz = tx / L;
      let best = Infinity;
      let bo = 0;
      // search across the carved channel itself (core half width + 1 px), not the whole valley
      const span = Math.max(r.widthKm / 2, 0.5) + px;
      for (let o = -span; o <= span + 1e-4; o += 0.1) {
        const h = bil(B, p[i][0] + nx * o, p[i][1] + nz * o);
        if (h < best - 1e-6) {
          best = h;
          bo = o;
        }
      }
      samples++;
      // misaligned: the section's lowest point lies > 1 px off the centreline AND is measurably lower
      // than the centre (a flat-bottomed wide channel is aligned wherever its minimum happens to fall)
      if (Math.abs(bo) > px + 1e-6 && bil(B, p[i][0], p[i][1]) - best > 0.02) off++;
    }
  }
  const share = off / Math.max(1, samples);
  report.channelMisaligned = { samples, off, share };
  console.log(`[geometry] carved channel: ${samples} cross-sections, lowest point > 1 px (${px} km) off the centreline in ${off} (${(share * 100).toFixed(2)} %)`);
  if (share > 0.02) gates.push(`channel misaligned in ${(share * 100).toFixed(1)} % of cross-sections`);

  const { buildRiverGeometry } = (await import('../../src/water/rivers.ts')) as typeof import('../../src/water/rivers.ts');
  const { lakeInfos } = (await import('../../src/water/lakes.ts')) as typeof import('../../src/water/lakes.ts');
  for (const includeStreams of [false, true]) {
    const { stats } = buildRiverGeometry(world, lakeInfos(world), { includeStreams, widthScale: world.spec.json.rivers.ribbonScale, marginKm: world.spec.json.rivers.ribbonMarginKm });
    report[includeStreams ? 'riverStatsAll' : 'riverStats'] = stats;
    console.log(`[geometry] ribbons${includeStreams ? ' (+streams)' : ''}: ${stats.lines} lines, ${stats.lengthKm} km, ${stats.vertices} vertices, rapids outside falls ${stats.rapidKm} km, at falls ${stats.fallKm ?? 0} km, dry centres ${stats.dryCentrePct} %`);
    if (stats.dryCentrePct >= 1) gates.push(`dry river centres ${stats.dryCentrePct} %`);
  }
}

// ------------------------------------------------------------------ river lengths vs the baseline
{
  // per named river (all its lines together; the unnamed streams as one group): the canon length the bake
  // keeps against the baseline (S1: the raw ME-GIS geometry clipped to the frame) — source trims, core
  // clips at confluences and absorbed side channels show up as the difference
  const cur = JSON.parse(readFileSync(join(bakedDir(), mB.files.rivers.file), 'utf8')) as RiverLine[];
  const baseRivers = JSON.parse(readFileSync(join(base, readManifest(base).files.rivers.file), 'utf8')) as RiverLine[];
  const len = (p: [number, number][]) => p.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
  const key = (s: string | null) => (s ?? '').trim() || '(unnamed streams)';
  const sum = (ls: RiverLine[]) => {
    const m = new Map<string, number>();
    for (const l of ls) m.set(key(l.name), (m.get(key(l.name)) ?? 0) + len(l.points));
    return m;
  };
  const A0 = sum(baseRivers);
  const B0 = sum(cur);
  const rows = [...new Set([...A0.keys(), ...B0.keys()])].map((k) => ({ name: k, base: A0.get(k) ?? 0, now: B0.get(k) ?? 0 }));
  const tot = (k: 'base' | 'now') => rows.reduce((a, r) => a + r[k], 0);
  report.riverLengths = { baseKm: +tot('base').toFixed(1), nowKm: +tot('now').toFixed(1), rivers: rows.map((r) => ({ name: r.name, baseKm: +r.base.toFixed(1), nowKm: +r.now.toFixed(1) })) };
  const worst = [...rows].sort((a, b) => a.now - a.base - (b.now - b.base)).slice(0, 10);
  console.log(`[geometry] river lengths vs the baseline (per named river): ${tot('base').toFixed(0)} → ${tot('now').toFixed(0)} km; largest changes ${worst.map((r) => `${r.name} ${(r.now - r.base).toFixed(1)}`).join(', ')}`);
}

// ------------------------------------------------------------------ landmarks + peaks
{
  const rows: string[] = [];
  const lm: Record<string, unknown>[] = [];
  const hf = world.heights;
  for (const p of world.places.values()) {
    if (p.kind !== 'landmark') continue;
    const a = bil(A, p.x, p.z);
    const b = hf.sample(p.x, p.z, 'base');
    const c = hf.sample(p.x, p.z);
    const aCanon = bil(A, p.cx, p.cz);
    lm.push({ id: p.id, baseS1: +a.toFixed(2), base: +b.toFixed(2), composite: +c.toFixed(2), s1AtCanonical: +aCanon.toFixed(2), offsetKm: p.displayOffsetKm ?? [0, 0] });
    rows.push(`  ${p.id.padEnd(14)} ground S1 ${f(a)} → ${f(b)} (stamped ${f(c)})${(p.displayOffsetKm ?? [0, 0]).some((v) => v !== 0) ? `  display offset ${JSON.stringify(p.displayOffsetKm)} (S1 at canonical ${f(aCanon)})` : ''}`);
  }
  report.landmarks = lm;
  console.log(`[geometry] landmark ground (base, at the display position; ${stamps.length} stamps)`);
  for (const r of rows) console.log(r);

  const peaks: [string, number, number][] = [
    ['Caradhras', 872, 934],
    ['Celebdil', 890, 915],
    ['Fanuidhol', 905, 940],
    ['Methedras', 815, 832],
    ['Mindolluin', 1105, 622],
    ['Erebor (DEM)', 1261.3, 1188.5],
    ['Mount Doom', 1240.1, 663.4],
    ['Amon Hen', 1072.6, 742.7],
    ['Weathertop', 673.2, 1049.1],
    ['Starkhorn', 862, 700],
    ['Gundabad (N Misty)', 940, 1330],
  ];
  const pk: Record<string, unknown>[] = [];
  console.log('[geometry] named peaks: max base height within 5 km (S1 → now; stamped)');
  for (const [name, kx, ky] of peaks) {
    const [x, z] = world.spec.kmToWorld(kx, ky);
    let a = -Infinity;
    let b = -Infinity;
    let c = -Infinity;
    for (let dz = -5; dz <= 5; dz += px)
      for (let dx = -5; dx <= 5; dx += px) {
        if (dx * dx + dz * dz > 25) continue;
        a = Math.max(a, bil(A, x + dx, z + dz));
        b = Math.max(b, hf.sample(x + dx, z + dz, 'base'));
        c = Math.max(c, hf.sample(x + dx, z + dz));
      }
    pk.push({ name, s1: +a.toFixed(2), now: +b.toFixed(2), stamped: +c.toFixed(2) });
    console.log(`  ${name.padEnd(20)} ${f(a)} → ${f(b)} (${f(b - a)})  stamped ${f(c)}`);
  }
  report.peaks = pk;
}

// ------------------------------------------------------------------ snow / tree line + steepness
{
  const W = B.w;
  const D = mB.world.zMax - mB.world.zMin;
  let snowA = 0, snowB = 0, snowMoved = 0, treeA = 0, treeB = 0, treeMoved = 0;
  let mount = 0, steepA = 0, steepB = 0;
  const cell = px * px;
  for (let r = 1; r < B.h - 1; r++) {
    const southness = (r + 0.5) / B.h;
    const snowLine = 23 + 13 * southness; // terrainMaterial.ts, without its noise terms
    void D;
    for (let c = 1; c < W - 1; c++) {
      const i = r * W + c;
      const a = A.data[i];
      const b = B.data[i];
      const sa = a > snowLine;
      const sb = b > snowLine;
      if (sa) snowA++;
      if (sb) snowB++;
      if (sa !== sb) snowMoved++;
      const ta = a > 23;
      const tb = b > 23;
      if (ta) treeA++;
      if (tb) treeB++;
      if (ta !== tb) treeMoved++;
      if (a > 12 || b > 12) {
        mount++;
        const ga = Math.hypot(A.data[i + 1] - A.data[i - 1], A.data[i + W] - A.data[i - W]) / (2 * px);
        const gb = Math.hypot(B.data[i + 1] - B.data[i - 1], B.data[i + W] - B.data[i - W]) / (2 * px);
        if (ga > Math.sqrt(3)) steepA++;
        if (gb > Math.sqrt(3)) steepB++;
      }
    }
  }
  const km = (n: number) => Math.round(n * cell);
  report.snow = { s1Km2: km(snowA), nowKm2: km(snowB), movedKm2: km(snowMoved) };
  report.treeline = { s1Km2: km(treeA), nowKm2: km(treeB), movedKm2: km(treeMoved) };
  report.steep = { mountainKm2: km(mount), s1Pct: (100 * steepA) / mount, nowPct: (100 * steepB) / mount };
  console.log(`[geometry] snowline (23 + 13·southness): ${km(snowA)} → ${km(snowB)} km² above; ${km(snowMoved)} km² moved across`);
  console.log(`[geometry] treeline (23): ${km(treeA)} → ${km(treeB)} km² above; ${km(treeMoved)} km² moved across`);
  console.log(`[geometry] steepness: slope > 60° on ${f((100 * steepA) / mount, 1)} % → ${f((100 * steepB) / mount, 1)} % of mountain land (h > 12)`);
}

report.gates = gates;
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 1));
console.log(gates.length ? `[geometry] GATES FAILED: ${gates.join('; ')}` : '[geometry] gates OK');
process.exit(gates.length ? 1 : 0);
