import { ClampToEdgeWrapping, Color, DataTexture, LinearFilter, NoColorSpace, RGBAFormat, SRGBColorSpace, UnsignedByteType, Vector4 } from 'three/webgpu';
import { hash32, rand } from '../core/rng.ts';
import { fieldWeightAt, shireFieldGrid } from '../world/fields.ts';
import { lookNoise } from '../materials/looks.ts';
import type { World } from '../world/World.ts';
import { applyStamp, stampBounds } from '../world/stamps.ts';

/**
 * CPU-built ground masks for the terrain material (init-time, pure functions of the world data +
 * the composited stamp layer):
 *  - stamp mask (RGBA8, half the heightfield resolution ≈ 0.8 km): R = turf (a landmark stamp raised
 *    or levelled ground that was gentle before: its new faces are turf / soil, not slope rock),
 *    G = stamp presence (the baked terrain analysis — AO, valley index — is stale there),
 *    B = lake shore band, A = river bank band;
 *  - Shire field mask (RGBA8 raw bytes, 0.2 km over the field lattice, a zero-weight border so the
 *    clamped sampler reads 0 outside it): rgb = sRGB crop colour of the field (decoded by the terrain;
 *    blue's lowest bit = the field's row axis, S4 W4-S2), a = patchwork weight eased in over the field
 *    margin —
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
  surfaceOverride(world, a, W, H);
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

/**
 * Stamp `surface` overrides on the turf field `a` (half resolution, after dilate + blur): inside the
 * influence of a stamp declaring 'turf' the field goes to 1, for 'rock' to 0 (the terrain's own slope /
 * alpine rock rules then decide), weighted by how much that stamp alone changes the base ground there.
 * Stamps without `surface` (or 'auto') leave the automatic rule untouched — bit-identical masks.
 */
function surfaceOverride(world: World, a: Float32Array, W: number, H: number): void {
  const hf = world.heights;
  const list = hf.stampList.filter((st) => st.surface === 'turf' || st.surface === 'rock');
  if (!list.length) return;
  const spec = world.spec;
  const cell = hf.texel * 2;
  for (const st of list) {
    const [x0, z0, x1, z1] = stampBounds(st);
    const c0 = Math.max(0, Math.floor((x0 - spec.xMin) / cell));
    const c1 = Math.min(W - 1, Math.ceil((x1 - spec.xMin) / cell));
    const r0 = Math.max(0, Math.floor((z0 - spec.zMin) / cell));
    const r1 = Math.min(H - 1, Math.ceil((z1 - spec.zMin) / cell));
    const target = st.surface === 'turf' ? 1 : 0;
    // 'auto' flatten / basin targets: the base ground at the stamp centre (influence only)
    const at = 'at' in st ? st.at : st.path[0];
    const auto = hf.sample(at[0], at[1], 'base');
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const x = spec.xMin + (c + 0.5) * cell;
        const z = spec.zMin + (r + 0.5) * cell;
        const b = hf.sample(x, z, 'base');
        const k = smooth(0.02, 0.25, Math.abs(applyStamp(st, x, z, b, { auto }) - b));
        if (k > 0) a[r * W + c] += (target - a[r * W + c]) * k;
      }
  }
}

/**
 * Crop colours of the Shire patchwork (sRGB) and their shares. S4 W4-S2: a narrow, mostly green palette —
 * pastures and meadows in close greens, a few straw fields, rare fallow / ploughed earth (the S3 lime /
 * olive / brown alternation read as a board game). The first three entries are pasture (the fringe's).
 */
const CROPS: [string, number][] = [
  ['#5c8a37', 0.29], // pasture
  ['#66903b', 0.2],
  ['#557f33', 0.14],
  ['#6f8f3d', 0.12], // young crop
  ['#7d9143', 0.09], // hay meadow
  ['#a39a5c', 0.06], // ripe wheat (straw)
  ['#979257', 0.04], // barley stubble
  ['#6e6a4a', 0.03], // ploughed
  ['#6b7a46', 0.03], // fallow
];
/** S4 W4-S2: the field margins — a field's colour weight fades over this distance (km) inside its border */
const FIELD_EDGE_KM = 0.55;
/** weight kept at the very border (the hedge line between two fields) */
const FIELD_EDGE_MIN = 0.15;
const FIELD_KM = 0.2;
/** zero-weight texels around the patchwork, so the clamped sampler reads 0 outside it */
const FIELD_PAD = 2;
/** the patchwork's organic fringe: ring radius (km) of the "how much around is patchwork" measure */
const FIELD_RING_KM = 16;

/**
 * The hedgerow rule at world (x, z): the raw (bilinear, un-normalised) Shire look weight and the
 * distance to Bree through fieldWeight — vegetation places hedges wherever it is > 0, and the field
 * mask never extends past it.
 */
function hedgerowRule(world: World): (x: number, z: number) => number {
  const spec = world.spec;
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
  const seed = world.spec.json.seeds.world;
  return (x, z) => fieldWeightAt(x, z, shireAt(x, z), bree ? Math.hypot(x - bree.x, z - bree.z) : Infinity, seed);
}

/**
 * Organic fringe of the patchwork (0..1): how much of the ring FIELD_RING_KM around a point is
 * patchwork (the hedgerow rule), shifted by low-frequency noise — 1 well inside, falling over a
 * ~30 km band with lobes at the edge. The field mask drops fields there at random (gone wild),
 * turns crops to pasture and fades the rest, so the quilt frays into the surrounding land instead
 * of ending as a square; it never extends past the hedgerow rule.
 */
export function fieldEdgeWeight(world: World, x: number, z: number, rule = hedgerowRule(world)): number {
  const seed = world.spec.json.seeds.world;
  let s = rule(x, z);
  const N = 8;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2 + 0.3;
    s += rule(x + Math.cos(a) * FIELD_RING_KM, z + Math.sin(a) * FIELD_RING_KM);
  }
  s /= N + 1;
  const dn = lookNoise(x / 40, z / 40, seed + 311) * 0.65 + lookNoise(x / 13, z / 13, seed + 313) * 0.35;
  return smooth(0.3, 0.85, s + 0.3 * dn);
}

function buildFieldMask(world: World): { texture: DataTexture; frame: Vector4 } {
  const spec = world.spec;
  const seed = spec.json.seeds.world;
  const grid = shireFieldGrid(spec, seed);
  const weightAt = hedgerowRule(world);

  // fields with any weight, and their bounds
  interface Cell {
    q: [number, number][];
    col: [number, number, number];
    w: number;
    /** 1 when the field's long axis is the lattice's v axis (its rows run along v), else 0 */
    axis: number;
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
      const rule = weightAt(cx, cz);
      if (rule <= 0.02) continue;
      const edge = fieldEdgeWeight(world, cx, cz, weightAt);
      // fields near the edge go wild at random
      if (rand(seed, id, 4) >= smooth(0.05, 0.7, edge)) continue;
      // …and fade (the ramp is wider than the raw rule's)
      const w = Math.min(rule, edge) * (0.55 + 0.45 * smooth(0.2, 0.9, edge));
      if (w <= 0.02) continue;
      // towards the edge the crops give way to pasture (the first three entries)
      const pasture = rand(seed, id, 5) < (1 - smooth(0.3, 0.95, edge)) * 0.85;
      let pick = rand(seed, id, 1) * (pasture ? CROPS[0][1] + CROPS[1][1] + CROPS[2][1] : totalShare);
      let k = 0;
      while (k < CROPS.length - 1 && pick > CROPS[k][1]) pick -= CROPS[k++][1];
      const col = new Color(CROPS[k][0]);
      // per-field tone jitter (the same crop is never quite the same colour twice)
      col.multiplyScalar(0.93 + 0.14 * rand(seed, id, 2));
      // the long axis: lattice u (i → i + 1) or v (j → j + 1), from the quad's mid-edge spans
      const lu = Math.hypot((q[1][0] + q[2][0] - q[0][0] - q[3][0]) / 2, (q[1][1] + q[2][1] - q[0][1] - q[3][1]) / 2);
      const lv = Math.hypot((q[2][0] + q[3][0] - q[0][0] - q[1][0]) / 2, (q[2][1] + q[3][1] - q[0][1] - q[1][1]) / 2);
      cells.push({ q, col: [toS(col.r), toS(col.g), toS(col.b)], w: w * (0.75 + 0.25 * rand(seed, id, 3)), axis: lv > lu ? 1 : 0 });
      for (const [x, z] of q) {
        x0 = Math.min(x0, x);
        z0 = Math.min(z0, z);
        x1 = Math.max(x1, x);
        z1 = Math.max(z1, z);
      }
    }
  if (!cells.length) {
    return { texture: makeTexture(new Uint8Array(4), 1, 1, false, 'terrain-fields'), frame: new Vector4(0, 0, 1, 1) };
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
    const q = cell.q;
    // distance (km) from a point to the field's border (its four edges)
    const edgeDist = (px: number, pz: number): number => {
      let d = Infinity;
      for (let e = 0; e < 4; e++) {
        const [ax, az] = q[e];
        const [bx, bz] = q[(e + 1) & 3];
        const ex = bx - ax;
        const ez = bz - az;
        const t = Math.min(1, Math.max(0, ((px - ax) * ex + (pz - az) * ez) / (ex * ex + ez * ez || 1)));
        d = Math.min(d, Math.hypot(px - ax - ex * t, pz - az - ez * t));
      }
      return d;
    };
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
        // soft field margins: the weight eases in over FIELD_EDGE_KM inside the border (S4 W4-S2)
        const edge = FIELD_EDGE_MIN + (1 - FIELD_EDGE_MIN) * smooth(0, FIELD_EDGE_KM, edgeDist(px, pz));
        data[o] = cell.col[0];
        data[o + 1] = cell.col[1];
        // the row axis rides in blue's lowest bit (raw bytes: the mask is sampled without an sRGB decode)
        data[o + 2] = (cell.col[2] & 0xfe) | cell.axis;
        data[o + 3] = Math.max(1, Math.round(Math.min(1, cell.w) * edge * 255));
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
  // raw bytes (NoColorSpace): the terrain decodes the sRGB colour itself and reads the row-axis bit
  return { texture: makeTexture(data, W, H, false, 'terrain-fields'), frame };
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
