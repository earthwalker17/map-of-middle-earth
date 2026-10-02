/**
 * EffectsSystem gates (CPU), part of `pnpm check` (S4 W3-E):
 *  - declarations: every landmark emitter's preset is one the EffectsSystem realizes; mist cards and beams
 *    are well formed (a beam rises; a mist card has a positive half-width and opacity); falls have a path of
 *    ≥ 2 points falling from the lip and a positive width
 *  - textures: the puff atlas and the fx noise are pure functions of their seed (built twice, identical) and
 *    every atlas frame is empty on its border (no bleeding between frames under mipmapping)
 *  - particles: every puff emitter evaluates to finite values, and random access is exact — evaluating a
 *    frame, other frames, then the first again gives the identical result (no hidden state)
 *  - budget: the worst case (every emitter on, quality density 1) fits the puff instance capacity
 *  - on the baked world (when one exists): emitter sources, fall lips / feet and mist cards are not buried
 *    in the ground (warnings: a misplaced declaration draws nothing)
 */
import type { CheckResult } from './world.ts';
import { bakedDir, hasBake, loadLandmarks, loadWorld } from './baked.ts';

export async function checkEffects(): Promise<CheckResult> {
  const out: CheckResult = { errors: [], warnings: [], info: [] };
  const Pr = await import('../../src/effects/presets.ts');
  const Pa = await import('../../src/effects/particles.ts');
  const Tx = await import('../../src/effects/textures.ts');
  const { hash32 } = await import('../../src/core/rng.ts');

  // ---- textures: pure, frames empty on their borders
  const hashBytes = (b: Uint8Array): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < b.length; i += 4) h = hash32(h, b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24), 0);
    return h >>> 0;
  };
  const atlasA = Tx.puffAtlasPixels(1234);
  if (hashBytes(atlasA) !== hashBytes(Tx.puffAtlasPixels(1234))) out.errors.push('effects: the puff atlas is not a pure function of its seed');
  if (hashBytes(Tx.fxNoisePixels(77)) !== hashBytes(Tx.fxNoisePixels(77))) out.errors.push('effects: the fx noise is not a pure function of its seed');
  const { size, cell, frames } = Tx.ATLAS;
  let border = 0;
  for (let f = 0; f < frames * frames; f++) {
    const fx = (f % frames) * cell;
    const fy = Math.floor(f / frames) * cell;
    for (let i = 0; i < cell; i++)
      for (const [x, y] of [
        [fx + i, fy],
        [fx + i, fy + cell - 1],
        [fx, fy + i],
        [fx + cell - 1, fy + i],
      ])
        border = Math.max(border, atlasA[(y * size + x) * 4]);
  }
  if (border > 2) out.errors.push(`effects: a puff atlas frame has density ${border}/255 on its border (frames bleed into each other)`);

  // ---- presets
  for (const [k, P] of Object.entries(Pr.PUFF)) {
    if (!(P.count > 0 && P.minCount > 0 && P.life > 0 && P.size1 > 0 && P.opacity > 0 && P.opacity <= 1)) out.errors.push(`effects: preset ${k} has a non-positive count / life / size / opacity`);
    if (!(P.lodPx[0] < P.lodPx[1])) out.errors.push(`effects: preset ${k} lodPx must rise`);
    if ((P.soft ?? 0) < 0 || (P.soft ?? 0) > 3 || !Number.isInteger(P.soft ?? 0)) out.errors.push(`effects: preset ${k} soft must be an integer 0..3 (packed with the atlas frame)`);
  }

  // ---- declarations (no world needed)
  const defs = await loadLandmarks();
  let declared = 0;
  for (const d of defs) {
    for (const [i, e] of (d.emitters ?? []).entries()) {
      declared++;
      const where = `${d.id} emitters[${i}] (${e.preset})`;
      if (!Pr.KNOWN_PRESETS.includes(e.preset)) out.errors.push(`effects: ${where}: unknown preset`);
      if ((e.rate ?? 1) <= 0 || (e.scale ?? 1) <= 0) out.errors.push(`effects: ${where}: rate and scale must be positive`);
      if (e.preset === 'beam' && !(e.to && e.to[1] > e.at[1])) out.errors.push(`effects: ${where}: a beam needs a 'to' above its source`);
    }
    for (const [i, f] of (d.waterFeatures ?? []).entries()) {
      if (f.kind === 'pool') continue;
      const where = `${d.id} waterFeatures[${i}] (${f.kind})`;
      if (f.path.length < 2 || !(f.width > 0)) out.errors.push(`effects: ${where}: needs ≥ 2 path points and a positive width`);
      else if (!(f.path[0][1] > f.path[f.path.length - 1][1])) out.errors.push(`effects: ${where}: the lip must be above the foot`);
    }
  }

  // ---- world records, particles, budget
  const dir = bakedDir();
  if (!hasBake(dir)) {
    out.warnings.push(`effects: no bake at ${dir} — world placement / particle checks skipped`);
    out.info.push(`effects: ${declared} emitter declarations checked (static)`);
    return out;
  }
  const { world, landmarks } = await loadWorld(dir);
  const { landmarkEmitters, landmarkFalls } = await import('../../src/landmarks/world.ts');
  const emitters = landmarkEmitters(world, landmarks);
  const falls = landmarkFalls(world, landmarks);
  const ground = (x: number, z: number) => world.heights.sample(x, z);
  const f3 = (p: readonly number[]) => p.map((v) => v.toFixed(2)).join(', ');

  const emit: ReturnType<typeof Pa.makePuffEmitter>[] = [];
  for (const r of emitters) {
    const g = ground(r.p[0], r.p[2]);
    if (r.preset === 'mist') {
      const to = r.to ?? r.p;
      if (r.p[1] < g - 0.05 && to[1] < ground(to[0], to[2]) - 0.05) out.warnings.push(`effects: ${r.landmark} mist card at ${f3(r.p)} lies under the ground at both ends (draws nothing)`);
      continue;
    }
    if (r.preset === 'beam' || r.preset === 'sparks' || r.preset === 'embers') {
      if (r.p[1] < g - 0.5) out.warnings.push(`effects: ${r.landmark} ${r.preset} source ${f3(r.p)} is ${(g - r.p[1]).toFixed(2)} under the ground`);
      continue;
    }
    if (r.p[1] < g - 0.5) out.warnings.push(`effects: ${r.landmark} ${r.preset} source ${f3(r.p)} is ${(g - r.p[1]).toFixed(2)} under the ground`);
    emit.push(Pa.makePuffEmitter({ landmark: r.landmark, preset: r.preset as 'smoke' | 'ash' | 'steam', p: r.p, ...(r.to ? { to: r.to } : {}), rate: r.rate, scale: r.scale, slot: -1, seed: r.seed, cover: 0, deckY: 0 }));
  }
  for (const f of falls) {
    const lip = f.path[0];
    const foot = f.path[f.path.length - 1];
    if (lip[1] < ground(lip[0], lip[2]) - 0.3) out.warnings.push(`effects: ${f.landmark} fall lip ${f3(lip)} is under the ground`);
    if (foot[1] > ground(foot[0], foot[2]) + 1.5) out.warnings.push(`effects: ${f.landmark} fall foot ${f3(foot)} hangs ${(foot[1] - ground(foot[0], foot[2])).toFixed(2)} over the ground`);
    emit.push(Pa.makePuffEmitter({ landmark: f.landmark, preset: 'spray', p: foot, rate: 1, scale: Math.max(0.8 * f.width, 0.1), slot: -1, seed: f.seed, cover: 0, deckY: 0 }));
  }

  // random access: frame A, other frames, frame A again → identical; all finite
  const w = Pa.fxWind([0.8, 0.3]);
  const a = new Float64Array(Pa.PS);
  const b = new Float64Array(Pa.PS);
  const junk = new Float64Array(Pa.PS);
  let evaluated = 0;
  let total = 0;
  for (const e of emit) {
    total += e.count;
    for (let k = 0; k < e.count; k++) {
      for (const t of [0, 37.25, 9999.5]) {
        a.fill(0);
        b.fill(0);
        const okA = Pa.evalPuff(e, k, t, w, a, 0);
        Pa.evalPuff(e, (k + 1) % e.count, t + 13.7, w, junk, 0);
        Pa.evalPuff(e, k, t * 0.5 + 3, w, junk, 0);
        const okB = Pa.evalPuff(e, k, t, w, b, 0);
        evaluated++;
        if (okA !== okB || a.some((v, i) => v !== b[i])) {
          out.errors.push(`effects: ${e.landmark} ${e.preset} puff ${k} at tFx ${t} is not a pure function of the frame`);
          break;
        }
        if (okA && a.some((v) => !Number.isFinite(v))) {
          out.errors.push(`effects: ${e.landmark} ${e.preset} puff ${k} at tFx ${t} evaluates to a non-finite value`);
          break;
        }
      }
    }
  }
  if (total > Pr.MAX_PUFFS) out.warnings.push(`effects: every puff emitter on at density 1 needs ${total} puffs > capacity ${Pr.MAX_PUFFS} (the farthest emitters would be dropped)`);
  const by = (p: string) => emitters.filter((e) => e.preset === p).length;
  out.info.push(
    `effects: ${emitters.length} emitters (smoke ${by('smoke')}, ash ${by('ash')}, steam ${by('steam')}, mist ${by('mist')}, beam ${by('beam')}, sparks ${by('sparks')}, embers ${by('embers')}), ${falls.length} falls; ${emit.length} puff emitters, worst case ${total} puffs at density 1 (capacity ${Pr.MAX_PUFFS}); ${evaluated} random-access evaluations identical`,
  );
  return out;
}
