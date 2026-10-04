import { AddEquation, CustomBlending, NodeMaterial, OneFactor, OneMinusSrcAlphaFactor, Vector2, Vector4, type Texture } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { tsl } from '../materials/tsl.ts';

const { Fn, abs, clamp, exp, float, length, max, min, select, texture, uv, vec2, vec3, vec4 } = tsl;

/**
 * Overlay materials (S5 film titles): premultiplied "over" in DISPLAY space — the overlay draws into the
 * RGBA8 readback target, whose bytes are already sRGB-encoded after the post graph (no tone mapping, no
 * colour transform: the renderer treats a non-output target as working space, and every value here is a
 * display value), exactly like 2D canvas compositing. No depth, no fog.
 */

/** ivory-gold of the leader lines and diamonds (sRGB display values, as the cards' #ebd9a8) */
const LINE_RGB: [number, number, number] = [0xeb / 255, 0xd9 / 255, 0xa8 / 255];
/**
 * peak alpha of the soft dark halo under the leader lines (its σ is set per segment: ≈ the hairline's own
 * width, so the line stays a fine ivory thread, never a grey stick) and under the diamonds
 */
const HALO_ALPHA_LINE = 0.36;
const HALO_ALPHA_DIAMOND = 0.42;
const HALO_SIGMA = 1.2;

function over(m: NodeMaterial): NodeMaterial {
  m.transparent = true;
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  m.blendEquation = AddEquation;
  m.blendSrcAlpha = OneFactor;
  m.blendDstAlpha = OneMinusSrcAlphaFactor;
  m.blendEquationAlpha = AddEquation;
  m.depthTest = false;
  m.depthWrite = false;
  m.fog = false;
  m.toneMapped = false;
  return m;
}

export interface CardMaterial {
  material: NodeMaterial;
  /** overall opacity */
  opacity: { value: number };
  /** one frame pixel in the card's uv (1 / card width, 1 / card height in frame px): the supersampling taps */
  px: { value: Vector2 };
  /** wipe: x = direction (+1 left → right, −1 right → left, 0 none), y = progress 0..1, z = soft edge (card widths) */
  wipe: { value: Vector4 };
}

/**
 * A caption card: its premultiplied canvas texture × opacity × the wipe mask. A supersampled card (`ss` > 1
 * canvas px per frame px) is resampled with an ss × ss box over each frame pixel (bilinear taps at the
 * sub-pixel centres): its sharpness hardly depends on where between pixels the card sits.
 */
export function createCardMaterial(map: Texture, ss = 1): CardMaterial {
  const opacity = uniform(1);
  const wipe = uniform(new Vector4(0, 1, 0.3, 0));
  const px = uniform(new Vector2(0, 0));
  const m = new NodeMaterial();
  m.name = 'title-card';
  m.fragmentNode = Fn(() => {
    let c = texture(map, uv());
    if (ss > 1) {
      c = vec4(0);
      for (let j = 0; j < ss; j++)
        for (let i = 0; i < ss; i++) c = c.add(texture(map, uv().add(px.mul(vec2((i + 0.5) / ss - 0.5, (j + 0.5) / ss - 0.5)))));
      c = c.div(ss * ss);
    }
    const x = select(wipe.x.lessThan(0), float(1).sub(uv().x), uv().x);
    const soft = max(wipe.z, 1e-3);
    const mask = select(abs(wipe.x).lessThan(0.5), float(1), clamp(wipe.y.mul(soft.add(1)).sub(x).div(soft), 0, 1));
    return c.mul(opacity.mul(mask));
  })();
  return { material: over(m), opacity, px, wipe };
}

export interface LineMaterial {
  material: NodeMaterial;
  opacity: { value: number };
  /** quad size, px (x along the segment, y across) */
  size: { value: Vector2 };
  /** x = visible length (px), y = line half-width (px), z = halo σ (px), w = thin-line alpha scale */
  shape: { value: Vector4 };
}

/**
 * A hairline segment on a quad (the mesh is scaled to `size` and rotated along the segment): an anti-aliased
 * capsule of half-width shape.y over the visible length, over a soft dark halo.
 */
export function createLineMaterial(): LineMaterial {
  const opacity = uniform(1);
  const size = uniform(new Vector2(1, 1));
  const shape = uniform(new Vector4(0, 0.5, HALO_SIGMA, 1));
  const m = new NodeMaterial();
  m.name = 'title-line';
  m.fragmentNode = Fn(() => {
    const p = uv().sub(0.5).mul(size);
    const ax = max(abs(p.x).sub(shape.x.mul(0.5)), 0);
    const d = length(vec2(ax, p.y));
    const a = clamp(shape.y.add(0.5).sub(d), 0, 1).mul(shape.w);
    const halo = exp(d.mul(d).div(shape.z.mul(shape.z)).mul(-0.5)).mul(HALO_ALPHA_LINE);
    const alpha = a.add(halo.mul(float(1).sub(a)));
    return vec4(vec3(...LINE_RGB).mul(a), alpha).mul(opacity);
  })();
  return { material: over(m), opacity, size, shape };
}

export interface DiamondMaterial {
  material: NodeMaterial;
  opacity: { value: number };
  /** x = quad size (px), y = half-diagonal (px), z = halo σ (px) */
  shape: { value: Vector4 };
}

/** The small diamond marking a label's anchor (L1 disc), anti-aliased, over a soft dark halo. */
export function createDiamondMaterial(): DiamondMaterial {
  const opacity = uniform(1);
  const shape = uniform(new Vector4(16, 5, HALO_SIGMA, 0));
  const m = new NodeMaterial();
  m.name = 'title-diamond';
  m.fragmentNode = Fn(() => {
    const p = uv().sub(0.5).mul(shape.x);
    const l1 = abs(p.x).add(abs(p.y));
    const d = l1.sub(shape.y).mul(Math.SQRT1_2);
    const a = clamp(float(0.5).sub(d), 0, 1);
    const dh = max(d, 0);
    const halo = exp(dh.mul(dh).div(shape.z.mul(shape.z)).mul(-0.5)).mul(HALO_ALPHA_DIAMOND);
    const alpha = a.add(halo.mul(float(1).sub(a)));
    return vec4(vec3(...LINE_RGB).mul(a), min(alpha, 1)).mul(opacity);
  })();
  return { material: over(m), opacity, shape };
}

export interface FadeMaterial {
  material: NodeMaterial;
  opacity: { value: number };
}

export interface BandMaterial {
  material: NodeMaterial;
  opacity: { value: number };
  /** x = quad height (px), y = Gaussian σ (px) of the band across */
  shape: { value: Vector2 };
}

/**
 * A soft horizontal band of darkness (premultiplied black, Gaussian across, full width): the end line's
 * scrim — the world dims behind the words, never a plate.
 */
export function createBandMaterial(): BandMaterial {
  const opacity = uniform(0);
  const shape = uniform(new Vector2(100, 20));
  const m = new NodeMaterial();
  m.name = 'title-band';
  m.fragmentNode = Fn(() => {
    const y = uv().y.sub(0.5).mul(shape.x);
    const a = exp(y.mul(y).div(shape.y.mul(shape.y)).mul(-0.5)).mul(opacity);
    return vec4(0, 0, 0, a);
  })();
  return { material: over(m), opacity, shape };
}

/** Full-frame black (fades to / from black). */
export function createFadeMaterial(): FadeMaterial {
  const opacity = uniform(0);
  const m = new NodeMaterial();
  m.name = 'title-fade';
  m.fragmentNode = vec4(0, 0, 0, opacity);
  return { material: over(m), opacity };
}
