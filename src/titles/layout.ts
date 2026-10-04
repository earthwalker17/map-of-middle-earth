import type { CameraState } from '../core/types.ts';

/**
 * Caption layout (S5 film): pure math, no three.js objects — the anchor projection from the frame's
 * SceneState camera (never the engine camera: the accumulation jitter and the lens move that one per
 * sub-sample) and the floating label's placement: block, leader polyline and diamond, clamped into the
 * 90 % title-safe area. Pixels, origin top-left, y down; sizes as fractions of the frame height H.
 */

export type Side = 'left' | 'right' | 'above' | 'below';

/** title-safe margin (each side, fraction of the frame) */
export const SAFE = 0.05;

/** label geometry (fractions of H): anchor → block rise, rule → text gap, minimum rise, above / below gap */
export const LABEL = {
  rise: { place: 0.085, pass: 0.055 },
  gapX: 0.014,
  minRise: 0.024,
  gapY: 0.016,
} as const;

export interface ScreenPoint {
  x: number;
  y: number;
  /** view depth (world units along the view axis) */
  depth: number;
}

/**
 * Project a world point with a SceneState camera (lookAt with up +Y — three's Matrix4.lookAt, including its
 * degenerate-up nudge — then the roll about the view axis, the vertical fov and the frame aspect).
 * Null when the point is behind the camera.
 */
export function projectToScreen(cam: CameraState, p: readonly [number, number, number], w: number, h: number): ScreenPoint | null {
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
  const vx = p[0] - ex;
  const vy = p[1] - ey;
  const vz = p[2] - ez;
  const depth = -(vx * zx + vy * zy + vz * zz);
  if (depth <= 1e-3) return null;
  const f = 1 / Math.tan((cam.fov * Math.PI) / 360);
  const ndcX = ((vx * rx + vy * ry + vz * rz) / depth) * (f / (w / h));
  const ndcY = ((vx * yx + vy * yy + vz * yz) / depth) * f;
  return { x: ((ndcX + 1) / 2) * w, y: ((1 - ndcY) / 2) * h, depth };
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
}

/** The text alignment a label side uses (its card is rasterised for it). */
export function alignOf(side: Side): 'left' | 'right' | 'center' {
  return side === 'right' ? 'left' : side === 'left' ? 'right' : 'center';
}

/**
 * Place a floating label beside its anchor A (px). right / left: a vertical hairline rises from the diamond
 * at A and runs up alongside the text block (the block's cap top level with the line's top), the text set
 * against it; above / below: the block centred over / under a short leader. The block is clamped into the
 * title-safe area: the leader bends (A → the shifted rule) or shortens rather than letting text leave it;
 * a right / left label too close to the top flips below the anchor (the line then drops to the block).
 */
export function layoutLabel(kind: 'place' | 'pass', side: Side, A: { x: number; y: number }, block: { w: number; h: number }, W: number, H: number): LabelLayout {
  const sx0 = SAFE * W;
  const sx1 = (1 - SAFE) * W;
  const sy0 = SAFE * H;
  const sy1 = (1 - SAFE) * H;
  const rise = LABEL.rise[kind] * H;
  const minRise = LABEL.minRise * H;
  const gapX = LABEL.gapX * H;
  const gapY = LABEL.gapY * H;
  const clampShift = (lo: number, hi: number, smin: number, smax: number) => (hi > smax ? Math.max(smax - hi, smin - lo) : lo < smin ? smin - lo : 0);
  if (side === 'right' || side === 'left') {
    const right = side === 'right';
    // up: the block's bottom sits `rise` above A (shortened down to minRise near the top of the frame)
    const upTop = A.y - rise - block.h;
    const up = A.y - minRise - block.h >= sy0;
    let top = up ? Math.max(upTop, sy0) : A.y + rise;
    let left = right ? A.x + gapX : A.x - gapX - block.w;
    const dx = clampShift(left, left + block.w, sx0, sx1);
    const dy = clampShift(top, top + block.h, sy0, sy1);
    left += dx;
    top += dy;
    const ruleX = right ? left - gapX : left + block.w + gapX;
    const near = up ? top + block.h : top;
    const far = up ? top : top + block.h;
    const pts: [number, number][] = Math.abs(ruleX - A.x) < 0.5 && (up ? near <= A.y : near >= A.y) ? [[A.x, A.y], [A.x, far]] : [[A.x, A.y], [ruleX, near], [ruleX, far]];
    return { bx: left, by: top, pts, align: right ? 'left' : 'right', dir: right ? 1 : -1 };
  }
  // above / below: a short leader to the centred block
  const above = side === 'above';
  const stem = Math.max(minRise, rise * 0.75);
  let left = A.x - block.w / 2;
  let top = above ? A.y - stem - gapY - block.h : A.y + stem + gapY;
  left += clampShift(left, left + block.w, sx0, sx1);
  top += clampShift(top, top + block.h, sy0, sy1);
  const ex = left + block.w / 2;
  const ey = above ? top + block.h + gapY : top - gapY;
  return { bx: left, by: top, pts: [[A.x, A.y], [ex, ey]], align: 'center', dir: 1 };
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
