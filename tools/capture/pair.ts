/**
 * Paired A/B sheets for blind before/after critiques:
 *
 *   node --import tsx tools/capture/pair.ts --a renders/qa/<before> --b renders/qa/<after> [--out renders/pairs/<name>] [--salt s2]
 *
 * For every shot present in both runs (…/shots/<id>.png) writes pair-<id>.png: the two renders side by
 * side, labelled only "1" and "2", with the left/right order shuffled deterministically per shot
 * (FNV-1a of salt + id). The answer key (which side is --a) goes to <out>-key.json, OUTSIDE the
 * sheet folder, so critics given the folder cannot see it.
 * CPU only (sharp), no lock needed.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const a = arg('a');
const b = arg('b');
if (!a || !b) {
  console.error('usage: pair.ts --a <runA> --b <runB> [--out dir] [--salt s]');
  process.exit(2);
}
const salt = arg('salt', 'pair')!;
const out = arg('out', join('renders', 'pairs', `${salt}`))!;
mkdirSync(out, { recursive: true });

const { default: sharp } = await import('sharp');
sharp.cache(false);
sharp.concurrency(2);

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};
const W = 960;
const H = 540;
async function tile(file: string, label: string): Promise<Buffer> {
  const img = await sharp(file).resize(W, H, { fit: 'contain', background: '#101214' }).toBuffer();
  const svg = Buffer.from(
    `<svg width="${W}" height="${H}"><rect x="0" y="0" width="44" height="34" fill="rgba(0,0,0,0.6)"/><text x="12" y="25" font-family="Georgia" font-size="22" fill="#eee4cf">${label}</text></svg>`,
  );
  return sharp(img).composite([{ input: svg }]).png().toBuffer();
}

const ids = readdirSync(join(a, 'shots'))
  .filter((f) => f.endsWith('.png'))
  .map((f) => f.slice(0, -4))
  .filter((id) => existsSync(join(b, 'shots', `${id}.png`)))
  .sort();
const key: Record<string, { left: 'a' | 'b'; a: string; b: string }> = {};
for (const id of ids) {
  const aFirst = fnv(salt + id) % 2 === 0;
  const [l, r] = aFirst ? [join(a, 'shots', `${id}.png`), join(b, 'shots', `${id}.png`)] : [join(b, 'shots', `${id}.png`), join(a, 'shots', `${id}.png`)];
  const tiles = [await tile(l, '1'), await tile(r, '2')];
  await sharp({ create: { width: 2 * W + 8, height: H, channels: 3, background: '#101214' } })
    .composite([
      { input: tiles[0], left: 0, top: 0 },
      { input: tiles[1], left: W + 8, top: 0 },
    ])
    .png()
    .toFile(join(out, `pair-${id}.png`));
  key[id] = { left: aFirst ? 'a' : 'b', a, b };
}
writeFileSync(`${out}-key.json`, JSON.stringify(key, null, 2));
console.log(`[pair] ${ids.length} pairs → ${out} (key: ${out}-key.json)`);
