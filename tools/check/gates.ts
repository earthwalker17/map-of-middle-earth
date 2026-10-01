/**
 * Light-gate and spill gates (CPU, no world load), part of `pnpm check` (S4 W2-D):
 *  - the gate table (src/materials/gates.ts): event slots unique and inside env.events; every kind whose
 *    default gate is 'event' has a default channel; gateCPU gives the documented values at day / dusk /
 *    night and reads the event channels; the emission sprites' packing (code + 8 · wide class) and the glow
 *    vertices' byte (code × 32) decode back to every code
 *  - every `event: '…'` channel named in the landmark sources and every `events` channel of the QA shots
 *    and landmark bookmarks is a known channel (an unknown one would never light: error)
 *  - the spill tables (src/emission/spillSources.ts) cover every light kind
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { CheckResult } from './world.ts';

const ROOT = process.cwd();

function walk(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}

export async function checkGates(): Promise<CheckResult> {
  const out: CheckResult = { errors: [], warnings: [], info: [] };
  const G = await import('../../src/materials/gates.ts');
  const { DEFAULT_GATE } = await import('../../src/landmarks/records.ts');
  const S = await import('../../src/emission/spillSources.ts');
  const kinds = Object.keys(DEFAULT_GATE) as (keyof typeof DEFAULT_GATE)[];

  // ---- the table
  const slots = Object.values(G.EVENT_SLOT);
  if (new Set(slots).size !== slots.length) out.errors.push(`gates: EVENT_SLOT has duplicate slots (${JSON.stringify(G.EVENT_SLOT)})`);
  for (const [ch, s] of Object.entries(G.EVENT_SLOT)) if (!(s >= 0 && s < G.EVENT_SLOTS)) out.errors.push(`gates: event channel '${ch}' slot ${s} outside env.events (0..${G.EVENT_SLOTS - 1})`);
  for (const k of kinds) {
    if (DEFAULT_GATE[k] !== 'event') continue;
    const ch = G.DEFAULT_EVENT[k];
    if (!ch || G.eventSlot(ch) < 0) out.errors.push(`gates: kind '${k}' is event-gated by default but has no known default channel`);
  }

  // ---- gateCPU at day / golden / blue hour / night, with and without events
  const env = (night: number, twilight: number, golden: number, events = [0, 0, 0, 0]) => ({ night, twilight, golden, events });
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const expect: [string, number, ReturnType<typeof env>, number][] = [
    ['night @ day', G.GATE.night, env(0, 0, 0), 0],
    ['night @ night', G.GATE.night, env(1, 0, 0), 1],
    ['nightDim @ night', G.GATE.nightDim, env(1, 0, 0), 1],
    ['nightDim @ blue hour', G.GATE.nightDim, env(0.3, 1, 0), 0],
    ['dusk @ day', G.GATE.dusk, env(0, 0, 0), 0.25],
    ['dusk @ golden', G.GATE.dusk, env(0, 0, 1), 1],
    ['always @ day', G.GATE.always, env(0, 0, 0), 1],
    ['event off', G.gateCode('event', 'beacon'), env(1, 0, 0), 0],
    ['event on', G.gateCode('event', 'beacon'), env(0, 0, 0, [1, 0, 0, 0]), 1],
    ['event other channel', G.gateCode('event', undefined, 'morgul-beam'), env(0, 0, 0, [1, 0.5, 0, 0]), 0.5],
  ];
  for (const [name, code, e, v] of expect) {
    const g = G.gateCPU(code, e);
    if (!near(g, v)) out.errors.push(`gates: gateCPU ${name} = ${g} (expected ${v})`);
  }

  // ---- encodings: sprite instance (code + 8 · wide class, decoded with floor((x + 0.5) / 8)) and glow byte
  for (let code = 0; code <= G.GATE_CODE_MAX; code++) {
    for (let wide = 0; wide < 4; wide++) {
      const x = Math.fround(code + 8 * wide);
      const w = Math.floor((x + 0.5) / 8);
      if (w !== wide || Math.round(x - 8 * w) !== code) out.errors.push(`gates: sprite packing of code ${code} / wide ${wide} does not decode`);
    }
    const byte = code * 32;
    if (byte > 255) out.errors.push(`gates: glow byte of code ${code} overflows`);
    const back = Math.round(Math.fround(Math.fround(byte / 255) * (255 / 32)));
    if (back !== code) out.errors.push(`gates: glow byte of code ${code} decodes to ${back}`);
  }

  // ---- event channels named in the landmark sources, the QA shots and the bookmarks
  let named = 0;
  for (const f of walk(join(ROOT, 'src/landmarks'), '.ts')) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bevent:\s*'([^']+)'/g)) {
      named++;
      if (G.eventSlot(m[1]) < 0) out.errors.push(`gates: ${relative(ROOT, f).replace(/\\/g, '/')} names unknown event channel '${m[1]}' (materials/gates.ts EVENT_SLOT)`);
    }
    for (const m of src.matchAll(/\bevents:\s*\{([^}]*)\}/g))
      for (const c of m[1].matchAll(/['"]?([\w-]+)['"]?\s*:/g)) {
        named++;
        if (G.eventSlot(c[1]) < 0) out.errors.push(`gates: ${relative(ROOT, f).replace(/\\/g, '/')} bookmark event '${c[1]}' is not a known channel`);
      }
  }
  const shotFiles = [join(ROOT, 'data/qa/shots.json'), ...walk(join(ROOT, 'data/qa/shots.d'), '.json')];
  for (const f of shotFiles) {
    const doc = JSON.parse(readFileSync(f, 'utf8')) as { shots?: { id: string; events?: Record<string, number> }[] };
    for (const s of doc.shots ?? [])
      for (const ch of Object.keys(s.events ?? {})) {
        named++;
        if (G.eventSlot(ch) < 0) out.errors.push(`gates: shot ${s.id} (${relative(ROOT, f).replace(/\\/g, '/')}) uses unknown event channel '${ch}'`);
      }
  }

  // ---- spill tables
  for (const [name, table] of [
    ['SPILL_KM', S.SPILL_KM],
    ['SPILL_GAIN', S.SPILL_GAIN],
    ['HALO_GAIN', S.HALO_GAIN],
    ['GLINT_GAIN', S.GLINT_GAIN],
  ] as const)
    for (const k of kinds) if (!(k in table) || !Number.isFinite(table[k])) out.errors.push(`gates: spill table ${name} has no finite entry for kind '${k}'`);

  out.info.push(`gates: ${G.GATE_CODE_MAX + 1} codes, ${slots.length} event channels (${Object.keys(G.EVENT_SLOT).join(', ')}), ${named} channel references checked`);
  return out;
}
