/**
 * QA sheets:  pnpm qa [--spp 2] [--w 1600 --h 900] [--only id1,id2] [--tod 17]
 * Renders every QA shot (data/qa/shots.json + shots.d/*.json) and composes:
 *  - contact.png           all shots in a labelled grid
 *  - compare-<shot>.png     the render next to its reference images (`compare` field)
 * into renders/qa/<stamp>/ (mirrored to renders/qa/latest/).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import sharp from 'sharp';
import { loadShots } from './shotList.ts';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const out = join('renders', 'qa', stamp);
mkdirSync(out, { recursive: true });
const shots = loadShots();
const only = arg('only')?.split(',');
const selected = only ? shots.filter((s) => only.includes(s.id)) : shots;
const extraIds = only ? only.filter((id) => !shots.some((s) => s.id === id)) : [];

const shotArgs = ['tools/capture/shots.ts', '--out', join(out, 'shots'), '--spp', arg('spp', '2')!, '--w', arg('w', '1600')!, '--h', arg('h', '900')!];
if (arg('tod')) shotArgs.push('--tod', arg('tod')!);
for (const s of selected) shotArgs.push('--shot', s.id);
for (const id of extraIds) shotArgs.push('--shot', id);
const run = spawnSync(process.execPath, ['--import', 'tsx', ...shotArgs], { stdio: 'inherit', shell: false });
if (run.status !== 0) console.warn('[qa] shots reported errors — composing what exists');

const IMG = /\.(png|jpe?g|webp)$/i;
function refImages(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isDirectory())
    return readdirSync(path)
      .filter((f) => IMG.test(f))
      .sort()
      .slice(0, 2)
      .map((f) => join(path, f));
  return IMG.test(extname(path)) ? [path] : [];
}

async function tile(file: string, w: number, h: number, label: string): Promise<Buffer> {
  const img = await sharp(file).resize(w, h, { fit: 'contain', background: '#101214' }).toBuffer();
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}"><rect x="0" y="${h - 26}" width="${w}" height="26" fill="rgba(0,0,0,0.55)"/><text x="8" y="${h - 8}" font-family="Georgia" font-size="16" fill="#eee4cf">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`,
  );
  return sharp(img).composite([{ input: svg }]).png().toBuffer();
}

async function grid(tiles: Buffer[], cols: number, w: number, h: number, file: string): Promise<void> {
  const rows = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: cols * w, height: rows * h, channels: 3, background: '#101214' } })
    .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * w, top: Math.floor(i / cols) * h })))
    .png()
    .toFile(file);
}

const TW = 640;
const TH = 360;
const rendered = [...selected.map((s) => s.id), ...extraIds].filter((id) => existsSync(join(out, 'shots', `${id}.png`)));
const tiles = await Promise.all(rendered.map((id) => tile(join(out, 'shots', `${id}.png`), TW, TH, id)));
if (tiles.length) await grid(tiles, 3, TW, TH, join(out, 'contact.png'));
let compares = 0;
for (const s of selected) {
  const refs = (s.compare ?? []).flatMap(refImages).slice(0, 3);
  const shotFile = join(out, 'shots', `${s.id}.png`);
  if (!refs.length || !existsSync(shotFile)) continue;
  const parts = [await tile(shotFile, TW, TH, `${s.id} (render)`), ...(await Promise.all(refs.map((r) => tile(r, TW, TH, r.replace(/\\/g, '/').split('/').slice(-2).join('/')))))];
  await grid(parts, parts.length, TW, TH, join(out, `compare-${s.id}.png`));
  compares++;
}
writeFileSync(join(out, 'README.md'), `# QA ${stamp}\n\n- contact.png (${tiles.length} shots)\n- ${compares} compare sheets\n`);
const latest = join('renders', 'qa', 'latest');
rmSync(latest, { recursive: true, force: true });
cpSync(out, latest, { recursive: true });
console.log(`[qa] ${tiles.length} shots, ${compares} compare sheets → ${out}`);
