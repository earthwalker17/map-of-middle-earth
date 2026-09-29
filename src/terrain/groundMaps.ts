import { ClampToEdgeWrapping, Color, DataTexture, LinearFilter, NoColorSpace, RGBAFormat, SRGBColorSpace, UnsignedByteType, Vector4 } from 'three/webgpu';
import { hash32, rand } from '../core/rng.ts';
import { fieldWeight, shireFieldGrid } from '../world/fields.ts';
import { lookField, lookNoise } from '../materials/looks.ts';
import type { World } from '../world/World.ts';

/**
 * CPU-built ground masks for the terrain material (init-time, pure functions of the world data +
 * the composited stamp layer):
 *  - stamp mask (RGBA8, half the heightfield resolution ≈ 0.8 km): R = turf (a landmark stamp raised
 *    or levelled ground that was gentle before: its new faces are turf / soil, not slope rock),
 *    G = stamp presence (the baked terrain analysis — AO, valley index — is stale there),
 *    B = lake shore band, A = river bank band;
 *  - Shire field mask (sRGB RGBA8, 0.2 km over the field lattice, a zero-weight border so the
 *    clamped sampler reads 0 outside it): rgb = crop colour of the field, a = patchwork weight —
 *    the lattice and hedgerow rule of src/world/fields.ts, faded organically towards its edge
 *    (fieldEdgeWeight: never beyond the hedgerow rule).
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

/** Separable 3-pass box blur (≈ Gaussian) of a float image, in place (`b`: scratch of the same size). */
function blur(a: Float32Array, w: number, h: number, radius: number, b: Float32Array): void {
  if (radius <= 0) return;
  const inv = 1 / (2 * radius + 1);
  const pass = (src: Float32Array, dst: Float32Array, lines: number, lineStep: number, len: number, step: number) => {
    for (let l = 0; l < lines; l++) {
      const o = l * lineStep;
      const last = o + (len - 1) * step;
      let acc = 0;
      for (let k = -radius; k <= radius; k++) acc += src[o + Math.min(len - 1, Math.max(0, k)) * step];
      for (let i = 0; i < len; i++) {
        dst[o + i * step] = acc * inv;
        const add = i + radius + 1;
        const sub = i - radius;
        acc += (add < len ? src[o + add * step] : src[last]) - (sub > 0 ? src[o + sub * step] : src[o]);
      }
    }
  };
  for (let it = 0; it < 3; it++) {
    pass(a, b, h, w, w, 1);
    pass(b, a, w, 1, h, w);
  }
}

/** 3×3 max filter of `a`, in place (separable: a row max into `tmp`, then a column max; edges clamped). */
function dilate(a: Float32Array, w: number, h: number, tmp: Float32Array): void {
  // rows: tmp = max over x−1..x+1
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const l = a[o + (x > 0 ? x - 1 : 0)];
      const c = a[o + x];
      const r = a[o + (x < w - 1 ? x + 1 : x)];
      tmp[o + x] = l > c ? (l > r ? l : r) : c > r ? c : r;
    }
  }
  // columns: a = max over y−1..y+1 of the row maxima
  for (let y = 0; y < h; y++) {
    const u = (y > 0 ? y - 1 : 0) * w;
    const o = y * w;
    const d = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const p = tmp[u + x];
      const c = tmp[o + x];
      const q = tmp[d + x];
      a[o + x] = p > c ? (p > q ? p : q) : c > q ? c : q;
    }
  }
}

/**
 * Stamp turf / presence + shore bands (see GroundMaps). Call after the stamps are composited.
 * One channel at a time through two reused float buffers (≈ 2 × 9.6 MB transient instead of six
 * full-size fields plus copies), each written to the RGBA8 output as soon as it is done.
 */
function buildStampMask(world: World): DataTexture {
  const hf = world.heights;
  const FW = hf.width;
  const FH = hf.height;
  const W = FW >> 1;
  const H = FH >> 1;
  const e = hf.texel;
  const base = hf.base;
  const comp = hf.data;
  const at = (a: Float32Array, c: number, r: number) => a[Math.min(FH - 1, Math.max(0, r)) * FW + Math.min(FW - 1, Math.max(0, c))];
  const data = new Uint8Array(W * H * 4);
  const a = new Float32Array(W * H);
  const b = new Float32Array(W * H);
  const put = (src: Float32Array, ch: number, k = 1) => {
    for (let i = 0; i < W * H; i++) data[i * 4 + ch] = Math.round(Math.min(1, src[i] * k) * 255);
  };

  // R = turf, G = presence: where a stamp changed the ground (the same per-texel rule for both)
  const stampField = (turf: boolean) => {
    a.fill(0);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = x * 2;
        const r = y * 2;
        let delta = 0;
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) delta = Math.max(delta, Math.abs(comp[(r + dy) * FW + c + dx] - base[(r + dy) * FW + c + dx]));
        if (delta < 1e-4) continue;
        if (!turf) {
          a[y * W + x] = smooth(0.02, 0.3, delta);
          continue;
        }
        // slope of the ground BEFORE the stamp (1 − n.y), central differences over 2 texels
        const gx = (at(base, c + 2, r) - at(base, c - 1, r)) / (3 * e);
        const gz = (at(base, c, r + 2) - at(base, c, r - 1)) / (3 * e);
        const baseSlope = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
        // turf where a moderate stamp built new faces on gentle ground; tall cones (Doom, Erebor) and
        // stamps on rocky ground (Helm's Deep, Moria, the Argonath) keep their rock
        a[y * W + x] = smooth(0.03, 0.25, delta) * (1 - smooth(0.16, 0.34, baseSlope)) * (1 - smooth(5, 9, delta));
      }
    // grow the mask one texel (a stamp's flanks are its steepest part), then soften
    dilate(a, W, H, b);
    blur(a, W, H, 1, b);
  };
  stampField(true);
  put(a, 0);
  stampField(false);
  put(a, 1);

  // B / A: shore bands just outside lakes / river channels (≈ 1–2 km)
  const wimg = world.water.image as unknown as { data: Uint8Array; width: number; height: number };
  const wd = wimg.data;
  const WW = wimg.width;
  const inside = new Uint8Array(W * H);
  const band = (ch: number, radius: number, gain: number) => {
    // max of the 2×2 full-resolution texels (bytes), kept for the "outside only" factor
    for (let y = 0; y < H; y++) {
      const r0 = y * 2 * WW * 4 + ch;
      const r1 = r0 + WW * 4;
      for (let x = 0; x < W; x++) {
        const o = x * 8;
        let m = wd[r0 + o];
        if (wd[r0 + o + 4] > m) m = wd[r0 + o + 4];
        if (wd[r1 + o] > m) m = wd[r1 + o];
        if (wd[r1 + o + 4] > m) m = wd[r1 + o + 4];
        inside[y * W + x] = m;
        a[y * W + x] = m / 255;
      }
    }
    blur(a, W, H, radius, b);
    for (let i = 0; i < W * H; i++) a[i] = Math.min(1, a[i] * gain) * (1 - inside[i] / 255);
  };
  band(1, 2, 2.2);
  put(a, 2);
  band(0, 1, 2.5);
  put(a, 3);
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
/** zero-weight texels around the patchwork, so the clamped sampler reads 0 outside it */
const FIELD_PAD = 2;

/**
 * Organic fade of the patchwork towards its edge (0..1, ≤ the hedgerow rule): the Shire weight of
 * the shared look field (the ground look's own, slightly warped border) plus low-frequency noise
 * on the weight and on the Bree radius, and fields near the edge dropping out at random (gone
 * wild / fallow), so the quilt frays into the surrounding land instead of ending as a square.
 */
export function fieldEdgeWeight(world: World, x: number, z: number, cellId: number): number {
  const field = lookField(world);
  const iShire = world.lookRegions.indexOf('shire' as never);
  const bree = world.places.get('bree');
  const seed = world.spec.json.seeds.world;
  const w = iShire >= 0 ? field.weights(x, z, new Float32Array(field.n))[iShire] : 0;
  const dn = lookNoise(x / 21, z / 21, seed + 311) * 0.7 + lookNoise(x / 8, z / 8, seed + 313) * 0.3;
  const edge = fieldWeight(w + 0.24 * dn, bree ? Math.hypot(x - bree.x, z - bree.z) + 8 * dn : Infinity);
  const keep = rand(seed, cellId, 4) < smooth(0.05, 0.6, edge) ? 1 : 0;
  return edge * keep;
}

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
  // the hedgerow rule (vegetation places hedges wherever it is > 0): fields never extend past it
  const weightAt = (x: number, z: number) => fieldWeight(shireAt(x, z), bree ? Math.hypot(x - bree.x, z - bree.z) : Infinity);

  // fields with any weight, and their bounds
  interface Cell {
    q: [number, number][];
    col: [number, number, number];
    w: number;
  }
  const cells: Cell[] = [];
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  const totalShare = CROPS.reduce((s, c) => s + c[1], 0);
  const toS = (v: number) => {
    const c = Math.min(1, Math.max(0, v));
    return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
  };
  for (let j = 0; j <= grid.n; j++)
    for (let i = 0; i <= grid.n; i++) {
      const q = [grid.vert(i, j), grid.vert(i + 1, j), grid.vert(i + 1, j + 1), grid.vert(i, j + 1)];
      const cx = (q[0][0] + q[2][0]) / 2;
      const cz = (q[0][1] + q[2][1]) / 2;
      const id = hash32(i, j, 205);
      const w = Math.min(weightAt(cx, cz), fieldEdgeWeight(world, cx, cz, id));
      if (w <= 0.02) continue;
      let pick = rand(seed, id, 1) * totalShare;
      let k = 0;
      while (k < CROPS.length - 1 && pick > CROPS[k][1]) pick -= CROPS[k++][1];
      const col = new Color(CROPS[k][0]);
      // per-field tone jitter (the same crop is never quite the same colour twice)
      col.multiplyScalar(0.93 + 0.14 * rand(seed, id, 2));
      cells.push({ q, col: [toS(col.r), toS(col.g), toS(col.b)], w: w * (0.75 + 0.25 * rand(seed, id, 3)) });
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
  x0 -= FIELD_PAD * FIELD_KM;
  z0 -= FIELD_PAD * FIELD_KM;
  const W = Math.ceil((x1 - x0) / FIELD_KM) + 1 + FIELD_PAD;
  const H = Math.ceil((z1 - z0) / FIELD_KM) + 1 + FIELD_PAD;
  // sRGB crop colour + weight, rasterised straight into the texture bytes
  const data = new Uint8Array(W * H * 4);
  const tri = (a: [number, number], b: [number, number], c: [number, number], cell: Cell) => {
    const minX = Math.max(FIELD_PAD, Math.floor((Math.min(a[0], b[0], c[0]) - x0) / FIELD_KM));
    const maxX = Math.min(W - 1 - FIELD_PAD, Math.ceil((Math.max(a[0], b[0], c[0]) - x0) / FIELD_KM));
    const minZ = Math.max(FIELD_PAD, Math.floor((Math.min(a[1], b[1], c[1]) - z0) / FIELD_KM));
    const maxZ = Math.min(H - 1 - FIELD_PAD, Math.ceil((Math.max(a[1], b[1], c[1]) - z0) / FIELD_KM));
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-9) return;
    const wa = Math.max(1, Math.round(Math.min(1, cell.w) * 255));
    for (let y = minZ; y <= maxZ; y++)
      for (let x = minX; x <= maxX; x++) {
        const px = x0 + (x + 0.5) * FIELD_KM;
        const pz = z0 + (y + 0.5) * FIELD_KM;
        const w0 = ((b[0] - px) * (c[1] - pz) - (c[0] - px) * (b[1] - pz)) / area;
        const w1 = ((c[0] - px) * (a[1] - pz) - (a[0] - px) * (c[1] - pz)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const o = (y * W + x) * 4;
        if (data[o + 3] > 0) continue; // first field wins on shared edges
        data[o] = cell.col[0];
        data[o + 1] = cell.col[1];
        data[o + 2] = cell.col[2];
        data[o + 3] = wa;
      }
  };
  for (const cell of cells) {
    tri(cell.q[0], cell.q[1], cell.q[2], cell);
    tri(cell.q[0], cell.q[2], cell.q[3], cell);
  }
  // outside the patchwork (and in the zero border): carry the nearest field colour (weight 0), so
  // bilinear filtering fades the weight at the edge without darkening the colour
  for (let pass = 0; pass < 2 + FIELD_PAD; pass++)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        if (data[o + 3] > 0 || data[o] + data[o + 1] + data[o + 2] > 0) continue;
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
          if (data[q] + data[q + 1] + data[q + 2] <= 0) continue;
          data[o] = data[q];
          data[o + 1] = data[q + 1];
          data[o + 2] = data[q + 2];
          break;
        }
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
