import { CanvasTexture, LinearFilter, Mesh, NoColorSpace, OrthographicCamera, PlaneGeometry, Scene, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import type { FrameContext, System } from '../core/types.ts';
import type { OverlayPass } from '../render/PostPipeline.ts';
import type { CaptionDef } from '../tour/schema.ts';
import { alignOf, layoutLabel, onScreen, polyLength, projectToScreen, type Side } from './layout.ts';
import { createCardMaterial, createDiamondMaterial, createFadeMaterial, createLineMaterial, type CardMaterial, type DiamondMaterial, type FadeMaterial, type LineMaterial } from './overlayMaterial.ts';
import { assertCanvasFonts, rasterCard, type Card } from './raster.ts';

/** overlay draw order: leader lines, diamonds, label cards, title / end cards, the fade on top */
const ORDER = { line: 1, diamond: 2, label: 3, card: 4, fade: 9 } as const;
/** title card: block centre (fraction of H from the top) and its slow "breath" (scale over its life) */
const TITLE_Y = 0.46;
const TITLE_BREATH = 0.02;
/** end / credits card centre */
const END_Y = 0.5;
/** hairline half-width (px at 1080p; a thinner line keeps ≥ 1 px of coverage with a lower alpha) and halo σ */
const LINE_HALF = 0.7;
const HALO_SIGMA = 2.6;
/** anchor diamond half-diagonal (px at 1080p) */
const DIAMOND = 6.5;
/** the label fades out as its anchor leaves the frame (px beyond the edge, fraction of H) */
const OFFSCREEN_FADE = 0.04;
/**
 * reveal choreography (fractions of the reveal 0..1 while fading in): the diamond pops in, the leader draws
 * up from it, then the text wipes in across the card (from the leader side); fading out, all go together
 */
const CHOREO = {
  place: { diamond: [0, 0.16], leader: [0.02, 0.5], wipe: [0.32, 1] },
  pass: { diamond: [0, 0.14], leader: [0.02, 0.4], wipe: [0.22, 1] },
} as const;
const WIPE_SOFT = 0.35;

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

interface CardVisual {
  card: Card;
  tex: CanvasTexture<OffscreenCanvas>;
  mat: CardMaterial;
  mesh: Mesh;
}

interface Visual {
  def: CaptionDef;
  key: string;
  card: CardVisual | null;
  lines: { mat: LineMaterial; mesh: Mesh }[];
  diamond: { mat: DiamondMaterial; mesh: Mesh } | null;
  fade: { mat: FadeMaterial; mesh: Mesh } | null;
}

export interface TitleOptions {
  /** film frame rate: the overlay's animation clock is the frame time floor(t·fps)/fps (as the reveals) */
  fps: number;
}

/**
 * TitleSystem (S5 film only): the title card, floating landmark labels (name + italic subtitle beside a
 * hairline leader that drops to a small diamond at the anchor), pass labels, end words / credits and fades —
 * drawn by the PostPipeline's overlay pass over the finished frame (display space, after grade and grain:
 * the type is crisp), never DOM. Cards are CPU-rasterised canvases (raster.ts) built lazily per (caption,
 * frame size) and cached; evaluate() only positions quads and sets opacities from the state: the visible
 * captions (SceneState.annotations: id + reveal), the frame time and the state's camera (anchor projection,
 * layout.ts). A pure function of the state: no animation state is carried between frames.
 */
export class TitleSystem implements System, OverlayPass {
  readonly id = 'titles';
  readonly stats = { visible: 0, cards: 0 };
  active = false;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(0, 1, 0, -1, -10, 10);
  private readonly defs = new Map<string, CaptionDef>();
  private readonly visuals = new Map<string, Visual>();
  private readonly quad = new PlaneGeometry(1, 1);
  private W = 0;
  private H = 0;

  constructor(
    captions: CaptionDef[],
    private readonly opts: TitleOptions,
  ) {
    for (const c of captions) this.defs.set(c.id, c);
    this.scene.name = 'titles-overlay';
  }

  /** The film fonts must be loaded before (boot awaits loadFilmFonts()); a fallback face fails here. */
  init(): void {
    assertCanvasFonts();
  }

  evaluate(frame: FrameContext): void {
    const { state, viewport } = frame;
    const W = viewport.width;
    const H = viewport.height;
    if (W !== this.W || H !== this.H) this.resize(W, H);
    for (const v of this.visuals.values()) this.hide(v);
    const tF = Math.floor(state.t * this.opts.fps + 1e-6) / this.opts.fps;
    let n = 0;
    for (const a of state.annotations) {
      const def = this.defs.get(a.id);
      if (!def || !(a.reveal > 0)) continue;
      const r = Math.min(1, a.reveal);
      const fadingIn = tF < (def.t0 + def.t1) / 2;
      const v = this.visual(def, W, H);
      if (this.show(v, r, fadingIn, tF, frame)) n++;
    }
    this.active = n > 0;
    this.stats.visible = n;
  }

  render(renderer: WebGPURenderer, _target: RenderTarget, width: number, height: number): void {
    if (width !== this.W || height !== this.H) return; // (evaluated for another size: draw nothing stale)
    renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------- per caption

  private resize(W: number, H: number): void {
    for (const v of this.visuals.values()) this.disposeVisual(v);
    this.visuals.clear();
    this.W = W;
    this.H = H;
    this.camera.left = 0;
    this.camera.right = W;
    this.camera.top = 0;
    this.camera.bottom = -H;
    this.camera.updateProjectionMatrix();
  }

  private sideOf(def: CaptionDef): Side {
    return def.side ?? 'right';
  }

  /** the caption's quads (built on first use for this frame size) */
  private visual(def: CaptionDef, W: number, H: number): Visual {
    const key = `${def.id}|${W}x${H}`;
    const have = this.visuals.get(def.id);
    if (have && have.key === key) return have;
    if (have) this.disposeVisual(have);
    const v: Visual = { def, key, card: null, lines: [], diamond: null, fade: null };
    if (def.kind === 'fade') {
      const mat = createFadeMaterial();
      const mesh = this.mesh(mat.material, ORDER.fade);
      mesh.scale.set(W, H, 1);
      mesh.position.set(W / 2, -H / 2, 0);
      v.fade = { mat, mesh };
    } else {
      const align = def.kind === 'place' || def.kind === 'pass' ? alignOf(this.sideOf(def)) : 'center';
      const card = rasterCard(def, W, H, align);
      const tex = new CanvasTexture(card.canvas);
      tex.colorSpace = NoColorSpace;
      tex.premultiplyAlpha = true;
      tex.generateMipmaps = false;
      tex.minFilter = LinearFilter;
      tex.magFilter = LinearFilter;
      tex.needsUpdate = true;
      const mat = createCardMaterial(tex);
      const mesh = this.mesh(mat.material, def.kind === 'place' || def.kind === 'pass' ? ORDER.label : ORDER.card);
      v.card = { card, tex, mat, mesh };
      this.stats.cards++;
      if (def.kind === 'place' || def.kind === 'pass') {
        for (let i = 0; i < 2; i++) {
          const lm = createLineMaterial();
          v.lines.push({ mat: lm, mesh: this.mesh(lm.material, ORDER.line) });
        }
        const dm = createDiamondMaterial();
        v.diamond = { mat: dm, mesh: this.mesh(dm.material, ORDER.diamond) };
      }
    }
    this.visuals.set(def.id, v);
    return v;
  }

  private mesh(material: Mesh['material'], order: number): Mesh {
    const m = new Mesh(this.quad, material);
    m.renderOrder = order;
    m.frustumCulled = false;
    m.visible = false;
    this.scene.add(m);
    return m;
  }

  private hide(v: Visual): void {
    if (v.card) v.card.mesh.visible = false;
    for (const l of v.lines) l.mesh.visible = false;
    if (v.diamond) v.diamond.mesh.visible = false;
    if (v.fade) v.fade.mesh.visible = false;
  }

  /** Place the card's canvas so its text block's top-left lands at (bx, by) px; `scale` about the block centre. */
  private placeCard(c: CardVisual, bx: number, by: number, scale = 1, snap = false): void {
    const { card } = c;
    let x0 = bx - card.block.x;
    let y0 = by - card.block.y;
    if (snap) {
      x0 = Math.round(x0);
      y0 = Math.round(y0);
    }
    const bcx = bx + card.block.w / 2;
    const bcy = by + card.block.h / 2;
    const cx = bcx + (x0 + card.width / 2 - bcx) * scale;
    const cy = bcy + (y0 + card.height / 2 - bcy) * scale;
    c.mesh.position.set(cx, -cy, 0);
    c.mesh.scale.set(card.width * scale, card.height * scale, 1);
    c.mesh.visible = true;
  }

  /** A leader segment from p to q (px), drawn over `frac` of its length from p. */
  private segment(l: { mat: LineMaterial; mesh: Mesh }, p: [number, number], q: [number, number], frac: number, opacity: number): void {
    const s = this.H / 1080;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]) * Math.min(1, Math.max(0, frac));
    if (len < 0.25 || opacity <= 0) return;
    const half = Math.max(0.5, LINE_HALF * s);
    const thin = Math.min(1, (LINE_HALF * s) / 0.5);
    const sigma = Math.max(0.8, HALO_SIGMA * s);
    const pad = Math.ceil(sigma * 3 + 1);
    const ang = Math.atan2(-(q[1] - p[1]), q[0] - p[0]);
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const sx = len + 2 * pad;
    const sy = 2 * (half + pad);
    l.mesh.position.set(p[0] + (ux * len) / 2, -p[1] + (uy * len) / 2, 0);
    l.mesh.rotation.set(0, 0, ang);
    l.mesh.scale.set(sx, sy, 1);
    l.mat.size.value.set(sx, sy);
    l.mat.shape.value.set(len, half, sigma, thin);
    l.mat.opacity.value = opacity;
    l.mesh.visible = true;
  }

  private show(v: Visual, r: number, fadingIn: boolean, tF: number, frame: FrameContext): boolean {
    const { W, H } = this;
    const def = v.def;
    if (v.fade) {
      v.fade.mat.opacity.value = r;
      v.fade.mesh.visible = true;
      return true;
    }
    const c = v.card!;
    if (def.kind === 'title' || def.kind === 'end') {
      const life = def.t1 > def.t0 ? Math.min(1, Math.max(0, (tF - def.t0) / (def.t1 - def.t0))) : 0;
      const scale = def.kind === 'title' ? 1 + TITLE_BREATH * life : 1;
      const cy = (def.kind === 'title' ? TITLE_Y : END_Y) * H;
      this.placeCard(c, W / 2 - c.card.block.w / 2, cy - c.card.block.h / 2, scale, scale === 1);
      c.mat.opacity.value = r;
      c.mat.wipe.value.set(0, 1, WIPE_SOFT, 0);
      return true;
    }
    // place / pass: anchored to the landmark
    if (!def.anchor) return false;
    const A = projectToScreen(frame.state.camera, def.anchor, W, H);
    if (!A) return false;
    const vis = onScreen(A, W, H, OFFSCREEN_FADE * H);
    if (vis <= 0) return false;
    const side = this.sideOf(def);
    const lay = layoutLabel(def.kind === 'pass' ? 'pass' : 'place', side, A, c.card.block, W, H);
    const ch = CHOREO[def.kind === 'pass' ? 'pass' : 'place'];
    const kIn = fadingIn ? 1 : r;
    const pDiamond = fadingIn ? smooth(ch.diamond[0], ch.diamond[1], r) : 1;
    const pLeader = fadingIn ? smooth(ch.leader[0], ch.leader[1], r) : 1;
    const pWipe = fadingIn ? smooth(ch.wipe[0], ch.wipe[1], r) : 1;
    const op = vis * kIn;
    // leader: draw `pLeader` of the polyline's length from the anchor
    const total = polyLength(lay.pts);
    let left = pLeader * total;
    for (let i = 0; i < v.lines.length; i++) {
      const p = lay.pts[i];
      const q = lay.pts[i + 1];
      if (!q) continue;
      const segLen = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const frac = segLen > 0 ? Math.min(1, left / segLen) : 0;
      left = Math.max(0, left - segLen);
      this.segment(v.lines[i], p, q, frac, op);
    }
    // diamond (pops in with a slight scale)
    const d = v.diamond!;
    const s = H / 1080;
    const rd = DIAMOND * s * (0.6 + 0.4 * pDiamond);
    const sigma = Math.max(0.8, HALO_SIGMA * s);
    const size = 2 * (rd + 3 * sigma + 1);
    d.mesh.position.set(A.x, -A.y, 0);
    d.mesh.scale.set(size, size, 1);
    d.mat.shape.value.set(size, rd, sigma, 0);
    d.mat.opacity.value = op * pDiamond;
    d.mesh.visible = pDiamond > 0;
    // text
    this.placeCard(c, lay.bx, lay.by);
    c.mat.opacity.value = op;
    c.mat.wipe.value.set(lay.dir, pWipe, WIPE_SOFT, 0);
    c.mesh.visible = pWipe > 0;
    return true;
  }

  private disposeVisual(v: Visual): void {
    for (const m of [v.card?.mesh, ...v.lines.map((l) => l.mesh), v.diamond?.mesh, v.fade?.mesh]) {
      if (!m) continue;
      m.removeFromParent();
      (m.material as { dispose(): void }).dispose();
    }
    v.card?.tex.dispose();
  }

  dispose(): void {
    for (const v of this.visuals.values()) this.disposeVisual(v);
    this.visuals.clear();
    this.quad.dispose();
  }
}
