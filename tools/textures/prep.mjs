#!/usr/bin/env node
// Terrain ground-detail layers: derive the runtime texture arrays from the CC0 Poly Haven sources.
//
//   node tools/textures/prep.mjs [--src <dir>] [--sizes 512,1024] [--check]
//
// Sources: data/textures-src/<asset>/{diffuse,nor_gl,disp}.jpg (fetched by `pnpm data:fetch`, gitignored);
// the legacy location public/textures/<asset>/ is used as a fallback, --src overrides both.
// Output (derived, gitignored, shipped): public/textures/terrain/
//   detail-<size>.bin   raw RGBA8, layers concatenated in LAYERS order, rows top-down:
//                       R, G = tangent-space normal x, y (OpenGL convention, 0.5 = flat)
//                       B    = luminance detail: the high-passed luminance ratio (to the texture's own
//                              local mean), contrast-normalised per layer, stored as ratio / 2
//                       A    = height (the displacement map, 1st–99th percentile → 0..1)
//   detail.json         layer order, sources, sizes, sha256 of every output (pnpm check reads it)
// Deterministic: pure function of the source files (sharp resize, fixed kernels, no randomness).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = join(ROOT, 'public', 'textures', 'terrain');

/** layer order = priority (a tier with N layers keeps the first N; src/terrain/terrainTextures.ts) */
export const LAYERS = [
  { id: 'meadow', source: 'aerial_grass_rock', contrast: 0.2 },
  { id: 'dry', source: 'withered_grass', contrast: 0.24 },
  { id: 'rock', source: 'aerial_rocks_02', contrast: 0.3 },
  { id: 'snow', source: 'snow_field_aerial', contrast: 0.26 },
  { id: 'scree', source: 'river_small_rocks', contrast: 0.26 },
  { id: 'ash', source: 'burned_ground_01', contrast: 0.24 },
];
const DEFAULT_SIZES = [512, 1024];
/** the high-pass keeps structure smaller than this fraction of the tile */
const HIGHPASS = 1 / 10;

function parse(argv) {
  const o = { src: null, sizes: DEFAULT_SIZES, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--src') o.src = argv[++i];
    else if (a === '--sizes') o.sizes = argv[++i].split(',').map(Number);
    else if (a === '--check') o.check = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

function sourceDir(asset, src) {
  const dirs = src ? [join(src, asset)] : [join(ROOT, 'data', 'textures-src', asset), join(ROOT, 'public', 'textures', asset)];
  for (const d of dirs) if (existsSync(join(d, 'diffuse.jpg'))) return d;
  throw new Error(`texture source '${asset}' not found (looked in ${dirs.join(', ')}) — run \`pnpm data:fetch\``);
}

/** Resize a tileable map to size² without edge seams: wrap-extend, resize, crop the centre. */
async function tileResize(sharp, file, size, channels) {
  const meta = await sharp(file).metadata();
  const n = meta.width;
  const m = Math.round(n / 32);
  const ext = await sharp(file)
    .extend({ top: m, bottom: m, left: m, right: m, extendWith: 'repeat' })
    .toBuffer();
  const big = Math.round(((n + 2 * m) * size) / n);
  const off = Math.round((m * size) / n);
  let img = sharp(ext).resize(big, big, { kernel: 'lanczos3' }).extract({ left: off, top: off, width: size, height: size });
  if (channels === 1) img = img.greyscale();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  if (info.width !== size || info.height !== size) throw new Error(`resize ${file}: got ${info.width}×${info.height}`);
  return { data, ch: info.channels };
}

/** Circular (tileable) separable box blur, 3 passes ≈ Gaussian. */
function wrapBlur(a, n, r) {
  const b = new Float32Array(a.length);
  const pass = (src, dst, horizontal) => {
    for (let l = 0; l < n; l++) {
      const at = (i) => src[horizontal ? l * n + ((i % n) + n) % n : (((i % n) + n) % n) * n + l];
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += at(k);
      for (let i = 0; i < n; i++) {
        dst[horizontal ? l * n + i : i * n + l] = acc / (2 * r + 1);
        acc += at(i + r + 1) - at(i - r);
      }
    }
  };
  for (let it = 0; it < 3; it++) {
    pass(a, b, true);
    pass(b, a, false);
  }
}

const lin = (v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

async function layerData(sharp, L, size, src) {
  const dir = sourceDir(L.source, src);
  const n2 = size * size;
  const out = new Uint8Array(n2 * 4);
  // luminance detail
  const dif = await tileResize(sharp, join(dir, 'diffuse.jpg'), size, 3);
  const Y = new Float32Array(n2);
  for (let i = 0; i < n2; i++) {
    const o = i * dif.ch;
    Y[i] = 0.2126 * lin(dif.data[o]) + 0.7152 * lin(dif.data[o + 1]) + 0.0722 * lin(dif.data[o + 2]);
  }
  const low = Y.slice();
  wrapBlur(low, size, Math.max(1, Math.round(size * HIGHPASS * 0.5)));
  const logr = new Float32Array(n2);
  let mean = 0;
  for (let i = 0; i < n2; i++) {
    logr[i] = Math.log(Math.max(1e-4, Y[i]) / Math.max(1e-4, low[i]));
    mean += logr[i];
  }
  mean /= n2;
  let v = 0;
  for (let i = 0; i < n2; i++) v += (logr[i] - mean) ** 2;
  const std = Math.sqrt(v / n2) || 1;
  const k = L.contrast / std;
  // normal
  const nor = await tileResize(sharp, join(dir, 'nor_gl.jpg'), size, 3);
  // height
  const dispFile = existsSync(join(dir, 'disp.jpg')) ? join(dir, 'disp.jpg') : null;
  const H = new Float32Array(n2).fill(0.5);
  if (dispFile) {
    const d = await tileResize(sharp, dispFile, size, 1);
    for (let i = 0; i < n2; i++) H[i] = d.data[i * d.ch] / 255;
    const sorted = Float32Array.from(H).sort();
    const lo = sorted[Math.floor(n2 * 0.01)];
    const hi = sorted[Math.floor(n2 * 0.99)];
    for (let i = 0; i < n2; i++) H[i] = Math.min(1, Math.max(0, (H[i] - lo) / Math.max(1e-3, hi - lo)));
  }
  for (let i = 0; i < n2; i++) {
    const ratio = Math.exp((logr[i] - mean) * k);
    out[i * 4] = nor.data[i * nor.ch];
    out[i * 4 + 1] = nor.data[i * nor.ch + 1];
    out[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, ratio / 2)) * 255);
    out[i * 4 + 3] = Math.round(H[i] * 255);
  }
  return { data: out, stats: { logStd: +std.toFixed(4), gain: +k.toFixed(3) } };
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export async function prepTerrainDetail({ src = null, sizes = DEFAULT_SIZES, log = console.log } = {}) {
  const { default: sharp } = await import('sharp');
  sharp.cache(false);
  sharp.concurrency(1);
  mkdirSync(OUT, { recursive: true });
  const manifest = { version: 1, generator: 'tools/textures/prep.mjs', channels: 'R,G normal xy (0.5 flat) · B luminance detail ratio/2 · A height', layers: LAYERS.map((l) => ({ id: l.id, source: l.source })), sizes, files: {} };
  for (const size of sizes) {
    const parts = [];
    for (const L of LAYERS) {
      const r = await layerData(sharp, L, size, src);
      parts.push(r.data);
      log(`  ${size}: ${L.id} ← ${L.source} (log std ${r.stats.logStd}, gain ${r.stats.gain})`);
    }
    const buf = Buffer.concat(parts);
    const file = `detail-${size}.bin`;
    writeFileSync(join(OUT, file), buf);
    manifest.files[file] = { bytes: buf.length, sha256: sha256(buf) };
  }
  writeFileSync(join(OUT, 'detail.json'), JSON.stringify(manifest, null, 2) + '\n');
  log(`terrain detail: ${sizes.map((s) => `detail-${s}.bin`).join(', ')} → public/textures/terrain`);
  return manifest;
}

/** Verify the derived files against detail.json; returns the number of problems. */
export function checkTerrainDetail() {
  const man = JSON.parse(readFileSync(join(OUT, 'detail.json'), 'utf8'));
  let bad = 0;
  for (const [file, f] of Object.entries(man.files)) {
    const p = join(OUT, file);
    if (!existsSync(p)) {
      console.error(`missing ${file}`);
      bad++;
      continue;
    }
    const got = sha256(readFileSync(p));
    if (got !== f.sha256) {
      console.error(`${file}: sha256 mismatch`);
      bad++;
    }
  }
  console.log(bad ? `${bad} problem(s)` : 'terrain detail OK');
  return bad;
}

// run only when executed directly (fetch-data.mjs imports prepTerrainDetail)
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const o = parse(process.argv.slice(2));
  if (o.check) process.exit(checkTerrainDetail() ? 1 : 0);
  prepTerrainDetail(o).catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
