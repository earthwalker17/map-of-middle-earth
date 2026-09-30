/**
 * Shot-list + bookmark framing gates (CPU camera probe, tools/check/probe.ts).
 *
 * data/tour/shotlist.json: every landmark present; segments reference known landmarks; the film draft
 * totals 180–240 s. Per landmark whose shot-list `status` is "s3" (rebuilt in Session 3) the gates are
 * ERRORS, otherwise warnings (the S1/S2 proxies are rebuilt wave by wave):
 *  - `<id>-close` exists, its distance within ±35 % of `heroKm`; `<id>-wide` exists when `contextKm` is set
 *  - `-close` framing: subject ≥ 25 % of frame height (225 px at 1600×900, `expect.minSubjectPx`), ≥ 60 %
 *    of the subject visible, no void / cut face in the top 15 % of rows (≤ 1 %, `expect.maxTopVoid`),
 *    void ≤ 3 %, sky ≤ 45 % (`expect.sky`), line of sight to the target ground and subject mid height
 *  - `-wide` framing: projected extent ≥ places.json `wideShotPxTarget[tier]`, top void ≤ 1 %
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { World } from '../../src/world/World.ts';
import type { LandmarkDefinition } from '../../src/landmarks/types.ts';
import type { CheckResult } from './world.ts';
import { ROOT } from './baked.ts';

interface ShotListLandmark {
  segment: string | null;
  role: string;
  heroClass: string;
  heroKm: number;
  contextKm: number | null;
  status?: 's2' | 's3';
}
interface ShotList {
  segments: { id: string; seconds: number; landmarks: string[] }[];
  landmarks: Record<string, ShotListLandmark>;
}

export async function checkBookmarks(world: World, landmarks: LandmarkDefinition[]): Promise<CheckResult> {
  const out: CheckResult = { errors: [], warnings: [], info: [] };
  const doc = JSON.parse(readFileSync(join(ROOT, 'data/tour/shotlist.json'), 'utf8')) as ShotList;
  const places = JSON.parse(readFileSync(join(ROOT, 'data/world/places.json'), 'utf8')) as { wideShotPxTarget: { A: number; B: number } };
  const ids = new Set(landmarks.map((d) => d.id));

  // ---- the shot-list document
  for (const id of ids) if (!doc.landmarks[id]) out.errors.push(`shotlist: landmark ${id} missing`);
  for (const id of Object.keys(doc.landmarks)) if (!ids.has(id)) out.errors.push(`shotlist: ${id} is not a landmark`);
  for (const s of doc.segments) for (const l of s.landmarks) if (!ids.has(l)) out.errors.push(`shotlist: segment ${s.id} names unknown landmark ${l}`);
  const seconds = doc.segments.reduce((a, s) => a + s.seconds, 0);
  if (seconds < 180 || seconds > 240) out.errors.push(`shotlist: film draft ${seconds} s outside 180–240 s`);

  // ---- bookmarks through the probe
  const { createProbeContext, probeShot, bookmarkShots, fmtProbe } = await import('./probe.ts');
  const ctx = await createProbeContext(undefined, { world, landmarks, stamps: [] });
  const shots = bookmarkShots(ctx.landmarks);
  let s3 = 0;
  let framed = 0;
  for (const def of landmarks) {
    const sl = doc.landmarks[def.id];
    if (!sl) continue;
    const strict = sl.status === 's3';
    if (strict) s3++;
    const report = (msg: string) => (strict ? out.errors : out.warnings).push(`bookmarks: ${msg}`);
    const mine = shots.filter((b) => b.def.id === def.id);
    const close = mine.find((b) => b.suffix === 'close');
    const wide = mine.find((b) => b.suffix === 'wide');
    if (!close) report(`${def.id} has no ${def.id}-close bookmark (hero ${sl.heroClass} ${sl.heroKm} km)`);
    if (sl.contextKm && !wide) report(`${def.id} has no ${def.id}-wide bookmark (context ${sl.contextKm} km)`);
    for (const b of [close, wide]) {
      if (!b) continue;
      const orbit = (b.shot.camera as { orbit: { distanceKm: number } }).orbit;
      const bm = def.bookmarks!.find((x) => x.id === b.shot.id)!;
      const want = b.suffix === 'close' ? sl.heroKm : sl.contextKm;
      if (want && Math.abs(orbit.distanceKm / want - 1) > 0.35) report(`${b.shot.id} distance ${orbit.distanceKm} km vs shot list ${want} km (±35 %)`);
      const r = probeShot(ctx, b.shot, { subject: def.id });
      const s = r.subject;
      const fails: string[] = [];
      const maxTopVoid = bm.expect?.maxTopVoid ?? 0.01;
      if (r.topVoid > maxTopVoid) fails.push(`top void ${(r.topVoid * 100).toFixed(0)} %`);
      if (b.suffix === 'close') {
        const minPx = bm.expect?.minSubjectPx ?? 225;
        const sky = bm.expect?.sky ?? [0, 0.45];
        if (!s || s.pxH < minPx) fails.push(`subject ${s ? s.pxH.toFixed(0) : 0} px < ${minPx}`);
        if (s && s.visible < 0.6) fails.push(`subject ${(s.visible * 100).toFixed(0)} % visible`);
        if (r.void > 0.03) fails.push(`void ${(r.void * 100).toFixed(0)} %`);
        if (r.sky < sky[0] || r.sky > sky[1]) fails.push(`sky ${(r.sky * 100).toFixed(0)} % outside ${sky.map((v) => v * 100).join('–')} %`);
        if (bm.expect?.los !== false && (r.losGround > -0.1 || r.losMid > 0)) fails.push(`line of sight blocked (ground ${r.losGround.toFixed(2)}, mid ${r.losMid.toFixed(2)})`);
      } else {
        const need = places.wideShotPxTarget[def.tier];
        if (!s || Math.max(s.pxH, s.pxW) < need) fails.push(`extent ${s ? Math.max(s.pxH, s.pxW).toFixed(0) : 0} px < wideShotPxTarget ${need}`);
      }
      if (fails.length) report(`${b.shot.id}: ${fails.join(', ')} — ${fmtProbe(r).replace(/\s+/g, ' ')}`);
      else framed++;
    }
  }
  const nb = shots.length;
  out.info.push(`bookmarks: ${nb} landmark bookmarks, ${framed} meet their framing gates; ${s3}/${ids.size} landmarks at shot-list status s3 (strict); film draft ${seconds} s`);
  return out;
}
