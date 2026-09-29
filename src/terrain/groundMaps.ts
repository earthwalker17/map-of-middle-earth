import { ClampToEdgeWrapping, Color, DataTexture, LinearFilter, NoColorSpace, RGBAFormat, SRGBColorSpace, UnsignedByteType, Vector4 } from 'three/webgpu';
import { hash32, rand } from '../core/rng.ts';
import { fieldWeight, shireFieldGrid } from '../world/fields.ts';
import type { World } from '../world/World.ts';

/**
 * CPU-built ground masks for the terrain material (init-time, pure functions of the world data +
 * the composited stamp layer):
 *  - stamp mask (RGBA8, half the heightfield resolution ≈ 0.8 km): R = turf (a landmark stamp raised
 *    or levelled ground that was gentle before: its new faces are turf / soil, not slope rock),
 *    G = stamp presence (the baked terrain analysis — AO, valley index — is stale there),
 *    B = lake shore band, A = river bank band;
 *  - Shire field mask (sRGB RGBA8, 0.2 km over the field lattice): rgb = crop colour of the field,
 *    a = patchwork weight (the same rule and lattice as the hedgerows, src/world/fields.ts).
 */
export interface GroundMaps {
  stamp: DataTexture;
  fields: DataTexture;
  /** world xz → field-mask uv: (x0, z0, 1/width, 1/depth) */
  fieldFrame: Vector4;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function makeTexture(data: Uint8Array, w: number, h: number, srgb: boolean, name: string): DataTexture {
  const t = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  t.name = name;
  t.needsUpdate = true;
  return t;
}

/** Separable 3-pass box blur (≈ Gaussian) of a float image, in place. */
function blur(a: Float32Array, w: number, h: number, radius: number): void {
  if (radius <= 0) return;
  const b = new Float32Array(a.length);
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    for (let l = 0; l < lines; l++) {
      const at = (i: number) => src[horizontal ? l * w + Math.min(len - 1, Math.max(0, i)) : Math.min(len - 1, Math.max(0, i)) * w + l];
      let acc = 0;
      for (let k = -radius; k <= radius; k++) acc += at(k);
      for (let i = 0; i < len; i++) {
        dst[horizontal ? l * w + i : i * w + l] = acc / (2 * radius + 1);
        acc += at(i + radius + 1) - at(i - radius);
      }
    }
  };
  for (let it = 0; it < 3; it++) {
    pass(a, b, true);
    pass(b, a, false);
  }
}

/** 3×3 max filter, in place. */
function dilate(a: Float32Array, w: number, h: number): void {
  const src = a.slice();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          m = Math.max(m, src[yy * w + xx]);
        }
      a[y * w + x] = m;
    }
}

/** Stamp turf / presence + shore bands (see GroundMaps). Call after the stamps are composited. */
function buildStampMask(world: World): DataTexture {
  const hf = world.heights;
  const FW = hf.width;
  const FH = hf.height;
  const W = FW >> 1;
  const H = FH >> 1;
  const e = hf.texel;
  const turf = new Float32Array(W * H);
  const pres = new Float32Array(W * H);
  const base = hf.base;
  const comp = hf.data;
  const at = (a: Float32Array, c: number, r: number) => a[Math.min(FH - 1, Math.max(0, r)) * FW + Math.min(FW - 1, Math.max(0, c))];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = x * 2;
      const r = y * 2;
      let delta = 0;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) delta = Math.max(delta, Math.abs(comp[(r + dy) * FW + c + dx] - base[(r + dy) * FW + c + dx]));
      if (delta < 1e-4) continue;
      // slope of the ground BEFORE the stamp (1 − n.y), central differences over 2 texels
      const gx = (at(base, c + 2, r) - at(base, c - 1, r)) / (3 * e);
      const gz = (at(base, c, r + 2) - at(base, c, r - 1)) / (3 * e);
      const baseSlope = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
      pres[y * W + x] = smooth(0.02, 0.3, delta);
      // turf where a moderate stamp built new faces on gentle ground; tall cones (Doom, Erebor) and
      // stamps on rocky ground (Helm's Deep, Moria, the Argonath) keep their rock
      turf[y * W + x] = smooth(0.03, 0.25, delta) * (1 - smooth(0.16, 0.34, baseSlope)) * (1 - smooth(5, 9, delta));
    }
  // grow the masks one texel (a stamp's flanks are its steepest part), then soften
  dilate(turf, W, H);
  dilate(pres, W, H);
  blur(turf, W, H, 1);
  blur(pres, W, H, 1);

  // shore bands just outside lakes / river channels (≈ 1–2 km)
  const wimg = world.water.image as unknown as { data: Uint8Array; width: number; height: number };
  const lake = new Float32Array(W * H);
  const river = new Float32Array(W * H);
  const wd = wimg.data;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let l = 0;
      let rv = 0;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const o = ((y * 2 + dy) * wimg.width + x * 2 + dx) * 4;
          rv = Math.max(rv, wd[o] / 255);
          l = Math.max(l, wd[o + 1] / 255);
        }
      lake[y * W + x] = l;
      river[y * W + x] = rv;
    }
  const lakeBand = lake.slice();
  blur(lakeBand, W, H, 2);
  const riverBand = river.slice();
  blur(riverBand, W, H, 1);

  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = Math.round(Math.min(1, turf[i]) * 255);
    data[i * 4 + 1] = Math.round(Math.min(1, pres[i]) * 255);
    data[i * 4 + 2] = Math.round(Math.min(1, lakeBand[i] * 2.2) * (1 - lake[i]) * 255);
    data[i * 4 + 3] = Math.round(Math.min(1, riverBand[i] * 2.5) * (1 - river[i]) * 255);
  }
  return makeTexture(data, W, H, false, 'terrain-stamp-mask');
}

/** Crop colours of the Shire patchwork (sRGB) and their shares. */
const CROPS: [string, number][] = [
  ['#5b8a33', 0.24], // pasture
  ['#679336', 0.18],
  ['#53792e', 0.12],
  ['#76993f', 0.1], // young crop
  ['#939b4a', 0.1], // hay meadow
  ['#b3a257', 0.1], // wheat
  ['#a39447', 0.06], // barley
  ['#6f5a3c', 0.05], // ploughed
  ['#7b8246', 0.05], // fallow
];
const FIELD_KM = 0.2;

function buildFieldMask(world: World): { texture: DataTexture; frame: Vector4 } {
  const spec = world.spec;
  const seed = spec.json.seeds.world;
  const grid = shireFieldGrid(spec, seed);
  const look = world.look.image as unknown as { data: Uint8Array; width: number; height: number };
  const iShire = world.lookRegions.indexOf('shire' as never);
  const bree = world.places.get('bree');
  const shireAt = (x: number, z: number): number => {
    if (iShire < 0) return 0;
    const [u, v] = spec.worldToUv(x, z);
    const fx = Math.min(look.width - 1, Math.max(0, u * look.width - 0.5));
    const fy = Math.min(look.height - 1, Math.max(0, v * look.height - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(look.width - 1, x0 + 1);
    const y1 = Math.min(look.height - 1, y0 + 1);
    const L = iShire >> 2;
    const c = iShire & 3;
    const g = (xx: number, yy: number) => look.data[((L * look.height + yy) * look.width + xx) * 4 + c] / 255;
    const tx = fx - x0;
    const ty = fy - y0;
    const a = g(x0, y0) + (g(x1, y0) - g(x0, y0)) * tx;
    const b = g(x0, y1) + (g(x1, y1) - g(x0, y1)) * tx;
    return a + (b - a) * ty;
  };
  const weightAt = (x: number, z: number) => fieldWeight(shireAt(x, z), bree ? Math.hypot(x - bree.x, z - bree.z) : Infinity);

  // fields with any weight, and their bounds
  interface Cell {
    q: [number, number][];
    col: Color;
    w: number;
  }
  const cells: Cell[] = [];
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  const totalShare = CROPS.reduce((s, c) => s + c[1], 0);
  for (let j = 0; j <= grid.n; j++)
    for (let i = 0; i <= grid.n; i++) {
      const q = [grid.vert(i, j), grid.vert(i + 1, j), grid.vert(i + 1, j + 1), grid.vert(i, j + 1)];
      const cx = (q[0][0] + q[2][0]) / 2;
      const cz = (q[0][1] + q[2][1]) / 2;
      const w = weightAt(cx, cz);
      if (w <= 0.02) continue;
      const id = hash32(i, j, 205);
      let pick = rand(seed, id, 1) * totalShare;
      let k = 0;
      while (k < CROPS.length - 1 && pick > CROPS[k][1]) pick -= CROPS[k++][1];
      const col = new Color(CROPS[k][0]);
      // per-field tone jitter (the same crop is never quite the same colour twice)
      col.multiplyScalar(0.93 + 0.14 * rand(seed, id, 2));
      cells.push({ q, col, w: w * (0.75 + 0.25 * rand(seed, id, 3)) });
      for (const [x, z] of q) {
        x0 = Math.min(x0, x);
        z0 = Math.min(z0, z);
        x1 = Math.max(x1, x);
        z1 = Math.max(z1, z);
      }
    }
  if (!cells.length) {
    return { texture: makeTexture(new Uint8Array(4), 1, 1, true, 'terrain-fields'), frame: new Vector4(0, 0, 1, 1) };
  }
  const W = Math.ceil((x1 - x0) / FIELD_KM) + 1;
  const H = Math.ceil((z1 - z0) / FIELD_KM) + 1;
  const acc = new Float32Array(W * H * 4);
  const tri = (a: [number, number], b: [number, number], c: [number, number], cell: Cell) => {
    const minX = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - x0) / FIELD_KM));
    const maxX = Math.min(W - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - x0) / FIELD_KM));
    const minZ = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - z0) / FIELD_KM));
    const maxZ = Math.min(H - 1, Math.ceil((Math.max(a[1], b[1], c[1]) - z0) / FIELD_KM));
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-9) return;
    for (let y = minZ; y <= maxZ; y++)
      for (let x = minX; x <= maxX; x++) {
        const px = x0 + (x + 0.5) * FIELD_KM;
        const pz = z0 + (y + 0.5) * FIELD_KM;
        const w0 = ((b[0] - px) * (c[1] - pz) - (c[0] - px) * (b[1] - pz)) / area;
        const w1 = ((c[0] - px) * (a[1] - pz) - (a[0] - px) * (c[1] - pz)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const o = (y * W + x) * 4;
        if (acc[o + 3] > 0) continue; // first field wins on shared edges
        acc[o] = cell.col.r;
        acc[o + 1] = cell.col.g;
        acc[o + 2] = cell.col.b;
        acc[o + 3] = cell.w;
      }
  };
  for (const cell of cells) {
    tri(cell.q[0], cell.q[1], cell.q[2], cell);
    tri(cell.q[0], cell.q[2], cell.q[3], cell);
  }
  // outside the patchwork: carry the nearest field colour (weight 0), so bilinear filtering fades
  // the weight at the edge without darkening the colour
  for (let pass = 0; pass < 2; pass++)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        if (acc[o + 3] > 0 || acc[o] + acc[o + 1] + acc[o + 2] > 0) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const q = (yy * W + xx) * 4;
          if (acc[q] + acc[q + 1] + acc[q + 2] <= 0) continue;
          acc[o] = acc[q];
          acc[o + 1] = acc[q + 1];
          acc[o + 2] = acc[q + 2];
          break;
        }
      }
  const data = new Uint8Array(W * H * 4);
  const toS = (v: number) => {
    const c = Math.min(1, Math.max(0, v));
    return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
  };
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = toS(acc[i * 4]);
    data[i * 4 + 1] = toS(acc[i * 4 + 1]);
    data[i * 4 + 2] = toS(acc[i * 4 + 2]);
    data[i * 4 + 3] = Math.round(Math.min(1, acc[i * 4 + 3]) * 255);
  }
  const frame = new Vector4(x0, z0, 1 / (W * FIELD_KM), 1 / (H * FIELD_KM));
  return { texture: makeTexture(data, W, H, true, 'terrain-fields'), frame };
}

const cache = new WeakMap<World, GroundMaps>();

/** The terrain's CPU ground masks (built once per world; the stamps must be composited first). */
export function groundMaps(world: World): GroundMaps {
  const hit = cache.get(world);
  if (hit) return hit;
  const f = buildFieldMask(world);
  const maps = { stamp: buildStampMask(world), fields: f.texture, fieldFrame: f.frame };
  cache.set(world, maps);
  return maps;
}
