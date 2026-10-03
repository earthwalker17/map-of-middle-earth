/**
 * QA run manifests, read on the CPU — shared by `lock.ts` (pixel-hash lock) and `showcase.ts` (README images).
 * Importable: no top-level work.
 *
 * A run = a QA run folder (renders/qa/<stamp>) or its shots/ folder (any folder holding the per-batch
 * manifests `manifest(-N).json` with `results[]` = { name, sha256, width, height, spp }, top-level `chrome`,
 * `info` (GPU, quality tier, three) and `args` (a `tod` override)).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export interface Settings {
  w: number;
  h: number;
  spp: number;
  quality: string;
  /** a --tod override of the run (null = each shot's own time of day) */
  tod: number | null;
}
export interface Shot {
  id: string;
  sha256: string;
  settings: Settings;
  chrome: string;
  gpu: unknown;
  three: string | null;
  driver: string | null;
}
export interface Run {
  dir: string;
  shots: Map<string, Shot>;
}

export const fwd = (p: string) => p.replace(/\\/g, '/');
/** a path relative to the working directory (the repo) when inside it, else absolute (forward slashes) */
export const showPath = (p: string) => {
  const r = relative(process.cwd(), resolve(p));
  return fwd(r && !r.startsWith('..') && !/^[a-zA-Z]:/.test(r) ? r : resolve(p));
};

const MANIFEST_RE = /^manifest(?:-(\d+))?\.json$/;
/** batch number of a manifest file name (manifest.json = -1, so it sorts first) */
const batchOf = (f: string) => Number(MANIFEST_RE.exec(f)?.[1] ?? -1);

function hasResults(file: string): boolean {
  try {
    return Array.isArray((JSON.parse(readFileSync(file, 'utf8')) as { results?: unknown }).results);
  } catch {
    return false;
  }
}
/** the folder holding the run's manifests: <run>/shots, else <run> itself */
export function shotsFolder(run: string): string {
  const has = (d: string) => existsSync(d) && readdirSync(d).some((f) => MANIFEST_RE.test(f) && hasResults(join(d, f)));
  if (has(join(run, 'shots'))) return join(run, 'shots');
  if (has(run)) return run;
  throw new Error(`no run manifests (manifest(-N).json with results[]) in ${run} or ${join(run, 'shots')}`);
}

/** every rendered shot of a run (a later batch — higher manifest number — wins), with its settings and environment */
export function readRun(run: string): Run {
  const dir = shotsFolder(run);
  const shots = new Map<string, Shot>();
  const files = readdirSync(dir)
    .filter((x) => MANIFEST_RE.test(x))
    .sort((a, b) => batchOf(a) - batchOf(b));
  for (const f of files) {
    const m = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
      chrome?: string;
      driver?: string;
      info?: { quality?: string; gpu?: unknown; three?: string; driver?: string };
      args?: { tod?: number | string };
      results?: { name: string; sha256: string; width: number; height: number; spp: number }[];
    };
    if (!Array.isArray(m.results)) continue;
    const tod = m.args?.tod === undefined || m.args.tod === null ? null : Number(m.args.tod);
    for (const r of m.results) {
      if (!r.sha256) continue; // a failed shot
      shots.set(r.name, {
        id: r.name,
        sha256: r.sha256,
        settings: { w: r.width, h: r.height, spp: r.spp, quality: m.info?.quality ?? 'unknown', tod },
        chrome: m.chrome ?? 'unknown',
        gpu: m.info?.gpu ?? null,
        three: m.info?.three ?? null,
        // forward-compatible: a run that records its driver wins over the one queried at lock time
        driver: m.driver ?? m.info?.driver ?? null,
      });
    }
  }
  return { dir, shots };
}
