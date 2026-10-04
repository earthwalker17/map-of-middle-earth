import type { CameraState } from '../core/types.ts';

/**
 * Caption layout (S5 film): pure math, no three.js objects — the anchor projection from the frame's
 * SceneState camera (never the engine camera: the accumulation jitter and the lens move that one per
 * sub-sample), the floating label's placement (block, leader polyline and diamond, clamped into the 90 %
 * title-safe area), the subject's screen mask (its silhouette LOD rasterised into a coarse grid: where a
 * label must not sit) and the HeightField occlusion of a point. Pixels, origin top-left, y down; sizes as
 * fractions of the frame height H.
 */

export type Side = 'left' | 'right' | 'above' | 'below';
export type V3 = readonly [number, number, number];

/** title-safe margin (each side, fraction of the frame) */
export const SAFE = 0.05;

/** label geometry (fractions of H): anchor → block rise, rule → text gap, minimum rise, above / below gap */
export const LABEL = {
  rise: { place: 0.085, pass: 0.055 },
  gapX: 0.014,
  minRise: 0.024,
  gapY: 0.016,
} as const;

/** Where a label sits relative to its anchor (chosen once per caption — see choosePlacement). */
export interface Placement {
  side: Side;
  /** anchor → block distance (fraction of H): a right / left label's rise, an above / below label's stem */
  rise: number;
  /** right / left: the rule's horizontal offset away from the anchor (fraction of H; the leader bends to it) */
  dx: number;
}

/** The plain placement of a side (the default rise, no offset). */
export function defaultPlacement(kind: 'place' | 'pass', side: Side): Placement {
  const r = LABEL.rise[kind];
  return { side, rise: side === 'above' || side === 'below' ? r * 0.75 : r, dx: 0 };
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** view depth (world units along the view axis) */
  depth: number;
}

/** A SceneState camera's view basis (three's Matrix4.lookAt with up +Y, its degenerate-up nudge, then the roll). */
export interface CameraBasis {
  e: V3;
  /** right, up, back (z = normalize(eye − target)) */
  x: V3;
  y: V3;
  z: V3;
  /** 1 / tan(fov / 2) */
  f: number;
}

export function cameraBasis(cam: CameraState): CameraBasis {
  const [ex, ey, ez] = cam.position;
  const [tx, ty, tz] = cam.target;
  // z = normalize(eye − target)
  let zx = ex - tx;
  let zy = ey - ty;
  let zz = ez - tz;
  if (zx * zx + zy * zy + zz * zz === 0) zz = 1;
  let l = Math.hypot(zx, zy, zz);
  zx /= l;
  zy /= l;
  zz /= l;
  // x = normalize(up × z), up = (0, 1, 0) → (z.z, 0, −z.x)
  let xx = zz;
  let xz = -zx;
  if (xx * xx + xz * xz === 0) {
    zz += 0.0001;
    l = Math.hypot(zx, zy, zz);
    zx /= l;
    zy /= l;
    zz /= l;
    xx = zz;
    xz = -zx;
  }
  l = Math.hypot(xx, xz);
  xx /= l;
  xz /= l;
  const xy = 0;
  // y = z × x
  let yx = zy * xz - zz * xy;
  let yy = zz * xx - zx * xz;
  let yz = zx * xy - zy * xx;
  // roll (Object3D.rotateZ): x' = x·cos + y·sin, y' = −x·sin + y·cos
  let rx = xx;
  let ry = xy;
  let rz = xz;
  if (cam.roll) {
    const a = (cam.roll * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    rx = xx * c + yx * s;
    ry = xy * c + yy * s;
    rz = xz * c + yz * s;
    const ux = -xx * s + yx * c;
    const uy = -xy * s + yy * c;
    const uz = -xz * s + yz * c;
    yx = ux;
    yy = uy;
    yz = uz;
  }
  return { e: [ex, ey, ez], x: [rx, ry, rz], y: [yx, yy, yz], z: [zx, zy, zz], f: 1 / Math.tan((cam.fov * Math.PI) / 360) };
}

/** Project a world point with a camera basis; null when it is behind the camera. */
export function projectWith(b: CameraBasis, p: V3, w: number, h: number): ScreenPoint | null {
  const vx = p[0] - b.e[0];
  const vy = p[1] - b.e[1];
  const vz = p[2] - b.e[2];
  const depth = -(vx * b.z[0] + vy * b.z[1] + vz * b.z[2]);
  if (depth <= 1e-3) return null;
  const ndcX = ((vx * b.x[0] + vy * b.x[1] + vz * b.x[2]) / depth) * (b.f / (w / h));
  const ndcY = ((vx * b.y[0] + vy * b.y[1] + vz * b.y[2]) / depth) * b.f;
  return { x: ((ndcX + 1) / 2) * w, y: ((1 - ndcY) / 2) * h, depth };
}

/**
 * Project a world point with a SceneState camera (lookAt with up +Y — three's Matrix4.lookAt, including its
 * degenerate-up nudge — then the roll about the view axis, the vertical fov and the frame aspect).
 * Null when the point is behind the camera.
 */
export function projectToScreen(cam: CameraState, p: V3, w: number, h: number): ScreenPoint | null {
  return projectWith(cameraBasis(cam), p, w, h);
}

export interface LabelLayout {
  /** the text block's top-left (px) */
  bx: number;
  by: number;
  /** leader polyline from the anchor (px): 2 or 3 points */
  pts: [number, number][];
  /** text alignment in the card */
  align: 'left' | 'right' | 'center';
  /** wipe direction across the card: +1 left → right, −1 right → left */
  dir: 1 | -1;
  /** how far the title-safe clamp moved the block (px) */
  shift: number;
}

/** The text alignment a label side uses (its card is rasterised for it). */
export function alignOf(side: Side): 'left' | 'right' | 'center' {
  return side === 'right' ? 'left' : side === 'left' ? 'right' : 'center';
}

/**
 * Place a floating label beside its anchor A (px). right / left: a hairline rises from the diamond at A
 * (straight up, or bent out to a rule `dx` away) and runs up alongside the text block (the block's cap top
 * level with the line's top), the text set against it; above / below: the block centred over / under a
 * leader of length `rise`. The block is clamped into the title-safe area: the leader bends or shortens
 * rather than letting text leave it; a right / left label too close to the top flips below the anchor.
 */
export function layoutLabel(kind: 'place' | 'pass', p: Placement, A: { x: number; y: number }, block: { w: number; h: number }, W: number, H: number): LabelLayout {
  void kind;
  const sx0 = SAFE * W;
  const sx1 = (1 - SAFE) * W;
  const sy0 = SAFE * H;
  const sy1 = (1 - SAFE) * H;
  const rise = p.rise * H;
  const minRise = LABEL.minRise * H;
  const gapX = LABEL.gapX * H;
  const gapY = LABEL.gapY * H;
  const clampShift = (lo: number, hi: number, smin: number, smax: number) => (hi > smax ? Math.max(smax - hi, smin - lo) : lo < smin ? smin - lo : 0);
  if (p.side === 'right' || p.side === 'left') {
    const right = p.side === 'right';
    // up: the block's bottom sits `rise` above A (shortened down to minRise near the top of the frame)
    const upTop = A.y - rise - block.h;
    const up = A.y - minRise - block.h >= sy0;
    let top = up ? Math.max(upTop, sy0) : A.y + rise;
    const rule0 = right ? A.x + p.dx * H : A.x - p.dx * H;
    let left = right ? rule0 + gapX : rule0 - gapX - block.w;
    const dx = clampShift(left, left + block.w, sx0, sx1);
    const dy = clampShift(top, top + block.h, sy0, sy1);
    left += dx;
    top += dy;
    const ruleX = right ? left - gapX : left + block.w + gapX;
    const near = up ? top + block.h : top;
    const far = up ? top : top + block.h;
    const pts: [number, number][] = Math.abs(ruleX - A.x) < 0.5 && (up ? near <= A.y : near >= A.y) ? [[A.x, A.y], [A.x, far]] : [[A.x, A.y], [ruleX, near], [ruleX, far]];
    return { bx: left, by: top, pts, align: right ? 'left' : 'right', dir: right ? 1 : -1, shift: Math.hypot(dx, dy) };
  }
  // above / below: a leader to the centred block
  const above = p.side === 'above';
  const stem = Math.max(minRise, rise);
  let left = A.x - block.w / 2;
  let top = above ? A.y - stem - gapY - block.h : A.y + stem + gapY;
  const dx = clampShift(left, left + block.w, sx0, sx1);
  const dy = clampShift(top, top + block.h, sy0, sy1);
  left += dx;
  top += dy;
  const ex = left + block.w / 2;
  const ey = above ? top + block.h + gapY : top - gapY;
  return { bx: left, by: top, pts: [[A.x, A.y], [ex, ey]], align: 'center', dir: 1, shift: Math.hypot(dx, dy) };
}

/** Total length of a polyline (px). */
export function polyLength(pts: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

/** Fade of a label whose anchor leaves the frame (1 inside, 0 beyond `margin` px outside). */
export function onScreen(p: { x: number; y: number }, W: number, H: number, margin: number): number {
  const out = Math.max(0, -p.x, p.x - W, -p.y, p.y - H);
  const t = Math.min(1, out / Math.max(1e-6, margin));
  return 1 - t * t * (3 - 2 * t);
}

// ───────────────────────────── subject mask (where a label must not sit) ─────────────────────────────

/** A coarse screen grid marking the cells a subject (landmark silhouette) covers. */
export interface ScreenMask {
  cols: number;
  rows: number;
  /** cell size, px */
  cell: number;
  data: Uint8Array;
}

/** grid columns of the subject mask */
export const MASK_COLS = 64;

/**
 * Rasterise world-space triangles (x, y, z × 3 per triangle) into a coarse screen mask, dilated by one
 * cell. Triangles with a vertex behind the camera are skipped.
 */
export function subjectMask(cam: CameraState, tris: Float32Array, W: number, H: number, cols = MASK_COLS): ScreenMask {
  const b = cameraBasis(cam);
  const cell = W / cols;
  const rows = Math.ceil(H / cell);
  const raw = new Uint8Array(cols * rows);
  const P: ScreenPoint[] = [];
  for (let t = 0; t + 8 < tris.length; t += 9) {
    P.length = 0;
    for (let v = 0; v < 3; v++) {
      const q = projectWith(b, [tris[t + v * 3], tris[t + v * 3 + 1], tris[t + v * 3 + 2]], W, H);
      if (!q) break;
      P.push(q);
    }
    if (P.length < 3) continue;
    const [a, c, d] = P;
    const c0 = Math.max(0, Math.floor(Math.min(a.x, c.x, d.x) / cell));
    const c1 = Math.min(cols - 1, Math.floor(Math.max(a.x, c.x, d.x) / cell));
    const r0 = Math.max(0, Math.floor(Math.min(a.y, c.y, d.y) / cell));
    const r1 = Math.min(rows - 1, Math.floor(Math.max(a.y, c.y, d.y) / cell));
    if (c0 > c1 || r0 > r1) continue;
    const area = (c.x - a.x) * (d.y - a.y) - (d.x - a.x) * (c.y - a.y);
    for (let r = r0; r <= r1; r++)
      for (let k = c0; k <= c1; k++) {
        // the cell's centre (or the whole small triangle inside one cell)
        if (c0 === c1 && r0 === r1) {
          raw[r * cols + k] = 1;
          continue;
        }
        const px = (k + 0.5) * cell;
        const py = (r + 0.5) * cell;
        const w0 = (c.x - px) * (d.y - py) - (d.x - px) * (c.y - py);
        const w1 = (d.x - px) * (a.y - py) - (a.x - px) * (d.y - py);
        const w2 = (a.x - px) * (c.y - py) - (c.x - px) * (a.y - py);
        if (area > 0 ? w0 >= 0 && w1 >= 0 && w2 >= 0 : w0 <= 0 && w1 <= 0 && w2 <= 0) raw[r * cols + k] = 1;
      }
  }
  const data = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < cols; k++) {
      let m = 0;
      for (let dr = -1; dr <= 1 && !m; dr++)
        for (let dk = -1; dk <= 1 && !m; dk++) {
          const rr = r + dr;
          const kk = k + dk;
          if (rr >= 0 && rr < rows && kk >= 0 && kk < cols && raw[rr * cols + kk]) m = 1;
        }
      data[r * cols + k] = m;
    }
  return { cols, rows, cell, data };
}

/** Share (0..1) of a screen rectangle the mask covers (sampled at the cells' centres inside it). */
export function maskCover(m: ScreenMask, x: number, y: number, w: number, h: number): number {
  const c0 = Math.max(0, Math.floor(x / m.cell));
  const c1 = Math.min(m.cols - 1, Math.floor((x + w) / m.cell));
  const r0 = Math.max(0, Math.floor(y / m.cell));
  const r1 = Math.min(m.rows - 1, Math.floor((y + h) / m.cell));
  let n = 0;
  let on = 0;
  for (let r = r0; r <= r1; r++)
    for (let k = c0; k <= c1; k++) {
      n++;
      on += m.data[r * m.cols + k];
    }
  return n > 0 ? on / n : 0;
}

/** One moment of a caption the placement is judged at: the anchor on screen and the subject's mask. */
export interface PlacementSample {
  A: { x: number; y: number };
  mask: ScreenMask | null;
}

/** placement candidates: rises (fractions of H) per kind, bend offsets, and the preference costs */
const RISES = { place: [0.085, 0.14, 0.2], pass: [0.055, 0.1, 0.15] } as const;
const STEMS = { place: [0.064, 0.12, 0.18, 0.26], pass: [0.042, 0.09, 0.14, 0.2] } as const;
const OFFSETS = [0, 0.06, 0.12, 0.2] as const;
const SIDE_COST: Record<Side, number> = { right: 0, left: 0.03, above: 0.05, below: 0.12 };

/**
 * Choose a label's placement so its text block stays off its subject (the mask) at the given moments:
 * right / left at three rises and four bend offsets, above at four stems, below at two — scored by the
 * mean share of the block the subject covers, plus small costs for leaving the default (side, longer
 * leader, bend) and for the title-safe clamp pushing the block about. `side` fixes the side.
 */
export function choosePlacement(kind: 'place' | 'pass', side: Side | undefined, block: { w: number; h: number }, samples: PlacementSample[], W: number, H: number): Placement {
  const cands: Placement[] = [];
  const sides: Side[] = side ? [side] : ['right', 'left', 'above', 'below'];
  for (const s of sides) {
    if (s === 'right' || s === 'left') {
      for (const rise of RISES[kind]) for (const dx of OFFSETS) cands.push({ side: s, rise, dx });
    } else for (const rise of s === 'above' ? STEMS[kind] : STEMS[kind].slice(0, 2)) cands.push({ side: s, rise, dx: 0 });
  }
  if (!samples.length) return side ? defaultPlacement(kind, side) : defaultPlacement(kind, 'right');
  let best = cands[0];
  let bestScore = Infinity;
  for (const c of cands) {
    let cover = 0;
    let shift = 0;
    for (const sm of samples) {
      const lay = layoutLabel(kind, c, sm.A, block, W, H);
      if (sm.mask) cover += maskCover(sm.mask, lay.bx, lay.by, block.w, block.h);
      shift += lay.shift / H;
    }
    const n = samples.length;
    const r0 = c.side === 'above' || c.side === 'below' ? STEMS[kind][0] : RISES[kind][0];
    const score = cover / n + SIDE_COST[c.side] + 0.25 * (c.rise - r0) + 0.3 * c.dx + 0.5 * (shift / n);
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// ───────────────────────────── occlusion ─────────────────────────────

/**
 * Visibility (0..1) of a world point from a camera position against the ground: the smallest clearance of
 * the sight line over the HeightField (`heightAt`, ≥ 0 = sea level), softened over a margin that grows with
 * the distance. The last `skipKm` of the line (the subject's own ground and stamps) is not tested.
 */
export function visibility(eye: V3, p: V3, heightAt: (x: number, z: number) => number, skipKm = 0.6, samples = 48): number {
  const dx = p[0] - eye[0];
  const dy = p[1] - eye[1];
  const dz = p[2] - eye[2];
  const dist = Math.hypot(dx, dy, dz);
  if (dist <= skipKm + 1e-3) return 1;
  const tMax = 1 - skipKm / dist;
  let minC = Infinity;
  for (let i = 1; i <= samples; i++) {
    const t = (tMax * i) / samples;
    const x = eye[0] + dx * t;
    const z = eye[2] + dz * t;
    minC = Math.min(minC, eye[1] + dy * t - Math.max(0, heightAt(x, z)));
  }
  const m = 0.02 + 0.003 * dist;
  const u = Math.min(1, Math.max(0, (minC + m) / (2 * m)));
  return u * u * (3 - 2 * u);
}
