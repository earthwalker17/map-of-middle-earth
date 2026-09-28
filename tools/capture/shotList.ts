import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ShotSpecInput } from '../../src/camera/shots.ts';

/** data/qa/shots.json + data/qa/shots.d/*.json (per-module shot sets, avoids merge conflicts). */
export function loadShots(): ShotSpecInput[] {
  const dir = join(process.cwd(), 'data', 'qa');
  const files = [join(dir, 'shots.json')];
  const extra = join(dir, 'shots.d');
  if (existsSync(extra)) for (const f of readdirSync(extra).sort()) if (f.endsWith('.json')) files.push(join(extra, f));
  const shots: ShotSpecInput[] = [];
  for (const f of files) if (existsSync(f)) shots.push(...(JSON.parse(readFileSync(f, 'utf8')) as { shots: ShotSpecInput[] }).shots);
  return shots;
}
