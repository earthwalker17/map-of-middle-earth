import { CanvasTexture, LinearFilter, Mesh, NoColorSpace, OrthographicCamera, PlaneGeometry, Scene, type BufferGeometry, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import type { FrameContext, SceneState, System } from '../core/types.ts';
import type { BuiltLandmark } from '../landmarks/records.ts';
import type { OverlayPass } from '../render/PostPipeline.ts';
import type { CaptionDef } from '../tour/schema.ts';
import { alignOf, choosePlacement, defaultPlacement, layoutLabel, onScreen, polyLength, projectToScreen, subjectMask, visibility, type Placement, type PlacementSample, type V3 } from './layout.ts';
import { createBandMaterial, createCardMaterial, createDiamondMaterial, createFadeMaterial, createLineMaterial, type BandMaterial, type CardMaterial, type DiamondMaterial, type FadeMaterial, type LineMaterial } from './overlayMaterial.ts';
import { assertCanvasFonts, cardBlock, rasterCard, type Card } from './raster.ts';

/** overlay draw order: leader lines, diamonds, label cards, the credits' dim and the end line's band, title / end cards, the fade on top */
const ORDER = { line: 1, diamond: 2, label: 3, dim: 3.5, band: 3.6, card: 4, fade: 9 } as const;
/** title card: block centre (fraction of H from the top) and its slow "breath" (scale over its life) */
const TITLE_Y = 0.46;
const TITLE_BREATH = 0.02;
/** credits card centre; the world dims behind it to 1 − DIM_CREDITS (the route line with it) */
const END_Y = 0.5;
const DIM_CREDITS = 0.65;
/** the end line: in the dark band under the diorama, over a soft band scrim (peak alpha, σ as a fraction of H) */
const END_LINE_Y = 0.915;
const BAND_ALPHA = 0.4;
const BAND_SIGMA = 0.05;
/** hairline half-width (px at 1080p; a thinner line keeps ≥ 1 px of coverage with a lower alpha) and halo σ ≈ its width */
const LINE_HALF = 0.7;
const LINE_HALO = 1.1;
/** anchor diamond half-diagonal and its halo σ (px at 1080p) */
const DIAMOND = 6.5;
const DIAMOND_HALO = 1.6;
/** the label fades out as its anchor leaves the frame (px beyond the edge, fraction of H) */
const OFFSCREEN_FADE = 0.04;
/**
 * reveal (film seconds: the caption's own fadeIn / fadeOut — the times its SceneState reveal uses — never
 * shorter than MIN_IN_S / MIN_OUT_S, the choreography's own pace, and at most IN_SHARE / OUT_SHARE of its
 * window): fading in, the diamond pops in, the leader draws up from it, then the text wipes in across the
 * card from the leader side (fractions of the in-time); fading out, all go together. A caption can slow its
 * reveal down (a longer fade), never rush it: the wipe over ~5 frames reads as a cut.
 */
const MIN_IN_S = { place: 1.4, pass: 0.8 } as const;
const MIN_OUT_S = { place: 1.0, pass: 0.6 } as const;
const IN_SHARE = 0.4;
const OUT_SHARE = 0.3;
const CHOREO = { diamond: [0, 0.12], leader: [0.05, 0.45], wipe: [0.3, 1] } as const;
const WIPE_SOFT = 0.35;
/** a caption's subject: the landmark within this distance (km, XZ) of its anchor */
const SUBJECT_KM = 1.5;
/**
 * the floating labels' cards are rasterised at LABEL_SS× the frame's pixel density and box-resampled (they
 * glide by fractions of a pixel: a 1× card's sharpness would pulse with the sub-pixel offset); the title and
 * end cards stand still (1×)
 */
const LABEL_SS = 2;
/** cards of captions this far (film s) outside their window are released (rebuilt identically if needed) */
const KEEP_S = 4;

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** A landmark as the titles see it: where it stands and its silhouette (for placement and occlusion). */
export interface TitleSubject {
  id: string;
  /** world position of its local origin (display position, on the ground / water) */
  origin: V3;
  /** bounds: centre, horizontal radius, height above the origin (km) */
  center: V3;
  r: number;
  h: number;
  /** world-space triangles of its coarsest LOD (x, y, z × 3 per triangle; the largest ≤ SUBJECT_TRIS) */
  tris: Float32Array;
}

const SUBJECT_TRIS = 3000;

/**
 * TitleSubjects from the built landmarks (film boot): each landmark's coarsest LOD placed in the world
 * (scale, heading, origin — as the LandmarkSystem's group), its largest triangles kept, plus its authored
 * trees as crossed crown-wide boards (Caras Galadhon is its mallorns). Pure and deterministic (the build is).
 */
export function titleSubjects(built: BuiltLandmark[], heightAt: (x: number, z: number) => number = () => 0): TitleSubject[] {
  return built.map((b) => {
    const lod = b.lods[b.lods.length - 1];
    const tris: { a: number; v: number[] }[] = [];
    const th = (-b.headingDeg * Math.PI) / 180;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const world = (g: BufferGeometry, i: number): number[] => {
      const p = g.attributes.position;
      const x = p.getX(i) * b.scale;
      const y = p.getY(i) * b.scale;
      const z = p.getZ(i) * b.scale;
      return [x * c + z * s + b.origin[0], y + b.origin[1], -x * s + z * c + b.origin[2]];
    };
    if (lod)
      for (const g of lod.values()) {
        const n = g.index ? g.index.count : g.attributes.position.count;
        for (let t = 0; t + 2 < n; t += 3) {
          const ids = [0, 1, 2].map((k) => (g.index ? g.index.getX(t + k) : t + k));
          const [p0, p1, p2] = ids.map((i) => world(g, i));
          const ux = p1[0] - p0[0];
          const uy = p1[1] - p0[1];
          const uz = p1[2] - p0[2];
          const vx = p2[0] - p0[0];
          const vy = p2[1] - p0[1];
          const vz = p2[2] - p0[2];
          const a = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
          tris.push({ a, v: [...p0, ...p1, ...p2] });
        }
      }
    // authored trees: two crossed boards, crown-wide, ground → top
    for (const t of b.trees) {
      const y0 = Math.max(0, heightAt(t.x, t.z));
      const y1 = y0 + (t.heightKm ?? t.crownKm * 3);
      const r = t.crownKm;
      for (const [ux, uz] of [
        [r, 0],
        [0, r],
      ]) {
        const a = [t.x - ux, y0, t.z - uz];
        const c = [t.x + ux, y0, t.z + uz];
        const d = [t.x + ux, y1, t.z + uz];
        const e = [t.x - ux, y1, t.z - uz];
        const area = 2 * r * (y1 - y0);
        tris.push({ a: area, v: [...a, ...c, ...d] }, { a: area, v: [...a, ...d, ...e] });
      }
    }
    // the largest triangles (a stable sort: ties keep the build order)
    const kept = tris
      .map((t, i) => ({ ...t, i }))
      .sort((p, q) => q.a - p.a || p.i - q.i)
      .slice(0, SUBJECT_TRIS);
    const out = new Float32Array(kept.length * 9);
    kept.forEach((t, i) => out.set(t.v, i * 9));
    return { id: b.id, origin: b.origin, center: b.bounds.center, r: b.bounds.r, h: b.bounds.h, tris: out };
  });
}

interface CardVisual {
  card: Card;
  tex: CanvasTexture<OffscreenCanvas>;
  mat: CardMaterial;
  mesh: Mesh;
}

interface Visual {
  def: CaptionDef;
  key: string;
  placement: Placement | null;
  card: CardVisual | null;
  lines: { mat: LineMaterial; mesh: Mesh }[];
  diamond: { mat: DiamondMaterial; mesh: Mesh } | null;
  fade: { mat: FadeMaterial; mesh: Mesh } | null;
  band: { mat: BandMaterial; mesh: Mesh } | null;
}

export interface TitleOptions {
  /** film frame rate: the overlay's animation clock is the frame time floor(t·fps)/fps (as the reveals) */
  fps: number;
  /**
   * the film's shutter (fraction of the frame): with motion blur, labels are laid out at the shutter's
   * centre (stateAt) — the blur's centroid — the same for every sub-sample of a frame. A capture's own
   * centre (SceneState.shutterCentre, its actual shutter) wins; this is the fallback.
   */
  shutter?: number;
  /** the film's state at time t (pure): the layout at the shutter centre and each label's placement */
  stateAt?: (t: number) => SceneState;
  /** ground height (HeightField, world units): a label fades while its subject is hidden behind terrain */
  heightAt?: (x: number, z: number) => number;
  /** landmark silhouettes: labels are placed off their subject */
  subjects?: TitleSubject[];
  /** the route head as drawn (RouteSystem.headPoint): a label whose subject the head rests on marks the head */
  headAt?: (state: SceneState, out: [number, number, number]) => [number, number, number] | null;
}

/**
 * TitleSystem (S5 film only): the title card, floating landmark labels (name + italic subtitle beside a
 * hairline leader that drops to a small diamond at the anchor), pass labels, end words / credits and fades —
 * drawn by the PostPipeline's overlay pass over the finished frame (display space, after grade and grain:
 * the type is crisp), never DOM. Cards are CPU-rasterised canvases (raster.ts) built lazily per (caption,
 * frame size) and cached, each label's side and leader chosen once per caption from the film's camera at
 * three moments of its window (off its subject's silhouette — layout.ts); evaluate() only positions quads
 * and sets opacities from the state: the visible captions (SceneState.annotations), the frame time, the
 * camera at the shutter's centre (anchor projection), the subject's visibility over the HeightField. A pure
 * function of the state: no animation state is carried between frames.
 */
export class TitleSystem implements System, OverlayPass {
  readonly id = 'titles';
  readonly stats = { visible: 0, cards: 0 };
  active = false;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(0, 1, 0, -1, -10, 10);
  private readonly defs = new Map<string, CaptionDef>();
  private readonly visuals = new Map<string, Visual>();
  private readonly subjectOf = new Map<string, TitleSubject | null>();
  private readonly quad = new PlaneGeometry(1, 1);
  private readonly headTmp: [number, number, number] = [0, 0, 0];
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
    // release the cards of captions far from now (a card is a pure function of its caption and the frame
    // size: one rebuilt later is the same — this only bounds the textures held at once)
    for (const [id, v] of this.visuals)
      if (tF < v.def.t0 - KEEP_S || tF > v.def.t1 + KEEP_S) {
        this.disposeVisual(v);
        this.visuals.delete(id);
      }
    let n = 0;
    let ls: SceneState | null = null;
    for (const a of state.annotations) {
      const def = this.defs.get(a.id);
      if (!def || !(a.reveal > 0)) continue;
      ls ??= this.layoutState(state, tF);
      const r = Math.min(1, a.reveal);
      const v = this.visual(def, W, H);
      if (this.show(v, r, tF, ls)) n++;
    }
    this.active = n > 0;
    this.stats.visible = n;
  }

  render(renderer: WebGPURenderer, _target: RenderTarget, width: number, height: number): void {
    if (width !== this.W || height !== this.H) return; // (evaluated for another size: draw nothing stale)
    renderer.render(this.scene, this.camera);
  }

  /**
   * The state the labels are laid out from: the frame's own (no motion blur: every sub-sample is at the
   * frame time) or the film's state at the shutter's centre (a sub-sample inside an open shutter) — the
   * same for all sub-samples of a frame, whatever their count or order. The centre is the capture's
   * (SceneState.shutterCentre: its actual shutter) or, without one, the film's own shutter's.
   */
  private layoutState(state: SceneState, tF: number): SceneState {
    const sh = this.opts.shutter ?? 0;
    // (without a capture's centre: a sub-sample at the frame time itself is an unblurred frame)
    const tc = state.shutterCentre ?? (sh > 0 && Math.abs(state.t - tF) >= 1e-6 ? tF + (0.5 * sh) / this.opts.fps : state.t);
    if (!this.opts.stateAt || Math.abs(state.t - tc) < 1e-6) return state;
    return this.opts.stateAt(tc);
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

  /** the landmark a label is about: the subject nearest its anchor (XZ, within SUBJECT_KM) */
  private subject(def: CaptionDef): TitleSubject | null {
    if (this.subjectOf.has(def.id)) return this.subjectOf.get(def.id)!;
    let best: TitleSubject | null = null;
    let bd = SUBJECT_KM;
    if (def.anchor)
      for (const s of this.opts.subjects ?? []) {
        const d = Math.hypot(s.origin[0] - def.anchor[0], s.origin[2] - def.anchor[2]);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
    this.subjectOf.set(def.id, best);
    return best;
  }

  /**
   * The diamond's world point in a state: the caption's anchor — or, while the route head rests on the
   * subject (within half its radius, 1–4 km, blended), the head as the line draws it: one marker, not two.
   */
  private anchorPoint(def: CaptionDef, st: SceneState): V3 {
    const a = def.anchor!;
    const subj = this.subject(def);
    if (!subj || !this.opts.headAt) return a;
    const hp = this.opts.headAt(st, this.headTmp);
    if (!hp) return a;
    const R = Math.min(4, Math.max(1, subj.r * 0.5));
    const w = 1 - smooth(0.3 * R, R, Math.hypot(hp[0] - subj.origin[0], hp[2] - subj.origin[2]));
    return [a[0] + (hp[0] - a[0]) * w, a[1] + (hp[1] - a[1]) * w, a[2] + (hp[2] - a[2]) * w];
  }

  /**
   * visibility of the label's subject from the state's camera over the HeightField: its top, its middle and
   * the diamond's point, each tested up to the subject's own footprint (its radius: its own ground and
   * stamps never hide it); the anchor alone without a subject
   */
  private subjectVisible(def: CaptionDef, st: SceneState, anchor: V3): number {
    const hAt = this.opts.heightAt;
    if (!hAt) return 1;
    const eye = st.camera.position;
    const subj = this.subject(def);
    if (!subj) return visibility(eye, anchor, hAt);
    const skip = Math.max(0.6, subj.r);
    const top: V3 = [subj.center[0], subj.origin[1] + 0.9 * subj.h, subj.center[2]];
    const mid: V3 = [subj.center[0], subj.origin[1] + 0.5 * subj.h, subj.center[2]];
    return Math.max(visibility(eye, top, hAt, skip), visibility(eye, mid, hAt, skip), visibility(eye, anchor, hAt, skip));
  }

  /**
   * the reveal windows of a label (s): in, out — the caption's fades (at least the choreography's minimum),
   * capped by the shares of its window
   */
  private times(def: CaptionDef): [number, number] {
    const k = def.kind === 'pass' ? 'pass' : 'place';
    const span = Math.max(0, def.t1 - def.t0);
    return [Math.min(Math.max(MIN_IN_S[k], def.fadeIn), span * IN_SHARE), Math.min(Math.max(MIN_OUT_S[k], def.fadeOut), span * OUT_SHARE)];
  }

  /** a label's side and leader: off its subject at three moments of its window (film camera), else the default */
  private placementOf(def: CaptionDef, W: number, H: number): Placement {
    const kind = def.kind === 'pass' ? 'pass' : 'place';
    const stateAt = this.opts.stateAt;
    if (!stateAt || !def.anchor) return defaultPlacement(kind, def.side ?? 'right');
    const subj = this.subject(def);
    const [tin, tout] = this.times(def);
    const ts = [def.t0 + tin, (def.t0 + def.t1) / 2, def.t1 - tout];
    const samples: PlacementSample[] = [];
    for (const t of ts) {
      const st = stateAt(t);
      const A = projectToScreen(st.camera, this.anchorPoint(def, st), W, H);
      if (!A) continue;
      samples.push({ A, mask: subj && subj.tris.length ? subjectMask(st.camera, subj.tris, W, H) : null });
    }
    return choosePlacement(kind, def.side, cardBlock(def, W, H), samples, W, H);
  }

  /** the caption's quads (built on first use for this frame size) */
  private visual(def: CaptionDef, W: number, H: number): Visual {
    const key = `${def.id}|${W}x${H}`;
    const have = this.visuals.get(def.id);
    if (have && have.key === key) return have;
    if (have) this.disposeVisual(have);
    const v: Visual = { def, key, placement: null, card: null, lines: [], diamond: null, fade: null, band: null };
    if (def.kind === 'fade') {
      v.fade = this.fadeQuad(ORDER.fade, W, H);
    } else {
      const label = def.kind === 'place' || def.kind === 'pass';
      if (label) v.placement = this.placementOf(def, W, H);
      const card = rasterCard(def, W, H, v.placement ? alignOf(v.placement.side) : 'center', label ? LABEL_SS : 1);
      const tex = new CanvasTexture(card.canvas);
      tex.colorSpace = NoColorSpace;
      tex.premultiplyAlpha = true;
      tex.generateMipmaps = false;
      tex.minFilter = LinearFilter;
      tex.magFilter = LinearFilter;
      tex.needsUpdate = true;
      const mat = createCardMaterial(tex, card.ss);
      mat.px.value.set(1 / card.width, 1 / card.height);
      const mesh = this.mesh(mat.material, label ? ORDER.label : ORDER.card);
      v.card = { card, tex, mat, mesh };
      this.stats.cards++;
      if (label) {
        for (let i = 0; i < 2; i++) {
          const lm = createLineMaterial();
          v.lines.push({ mat: lm, mesh: this.mesh(lm.material, ORDER.line) });
        }
        const dm = createDiamondMaterial();
        v.diamond = { mat: dm, mesh: this.mesh(dm.material, ORDER.diamond) };
      } else if (def.kind === 'end') {
        if (def.lines?.length) v.fade = this.fadeQuad(ORDER.dim, W, H);
        else {
          const bm = createBandMaterial();
          const mesh = this.mesh(bm.material, ORDER.band);
          const sigma = BAND_SIGMA * H;
          mesh.scale.set(W, 8 * sigma, 1);
          mesh.position.set(W / 2, -END_LINE_Y * H, 0);
          bm.shape.value.set(8 * sigma, sigma);
          v.band = { mat: bm, mesh };
        }
      }
    }
    this.visuals.set(def.id, v);
    return v;
  }

  private fadeQuad(order: number, W: number, H: number): { mat: FadeMaterial; mesh: Mesh } {
    const mat = createFadeMaterial();
    const mesh = this.mesh(mat.material, order);
    mesh.scale.set(W, H, 1);
    mesh.position.set(W / 2, -H / 2, 0);
    return { mat, mesh };
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
    if (v.band) v.band.mesh.visible = false;
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
    const sigma = Math.max(0.7, LINE_HALO * s);
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

  private show(v: Visual, r: number, tF: number, ls: SceneState): boolean {
    const { W, H } = this;
    const def = v.def;
    if (def.kind === 'fade') {
      v.fade!.mat.opacity.value = r;
      v.fade!.mesh.visible = true;
      return true;
    }
    const c = v.card!;
    if (def.kind === 'title' || def.kind === 'end') {
      const life = def.t1 > def.t0 ? Math.min(1, Math.max(0, (tF - def.t0) / (def.t1 - def.t0))) : 0;
      const scale = def.kind === 'title' ? 1 + TITLE_BREATH * life : 1;
      const cy = (def.kind === 'title' ? TITLE_Y : def.lines?.length ? END_Y : END_LINE_Y) * H;
      this.placeCard(c, W / 2 - c.card.block.w / 2, cy - c.card.block.h / 2, scale, scale === 1);
      c.mat.opacity.value = r;
      c.mat.wipe.value.set(0, 1, WIPE_SOFT, 0);
      if (v.fade) {
        v.fade.mat.opacity.value = DIM_CREDITS * r;
        v.fade.mesh.visible = true;
      }
      if (v.band) {
        v.band.mat.opacity.value = BAND_ALPHA * r;
        v.band.mesh.visible = true;
      }
      return true;
    }
    // place / pass: anchored to the landmark
    if (!def.anchor) return false;
    const P = this.anchorPoint(def, ls);
    const A = projectToScreen(ls.camera, P, W, H);
    if (!A) return false;
    const vis = onScreen(A, W, H, OFFSCREEN_FADE * H) * this.subjectVisible(def, ls, P);
    if (vis <= 0) return false;
    const lay = layoutLabel(def.kind === 'pass' ? 'pass' : 'place', v.placement!, A, c.card.block, W, H);
    // reveal from the frame time: in (choreographed), out (together)
    const [tin, tout] = this.times(def);
    const pIn = tin > 0 ? Math.min(1, Math.max(0, (tF - def.t0) / tin)) : 1;
    const pOut = tout > 0 ? Math.min(1, Math.max(0, (def.t1 - tF) / tout)) : 1;
    const pDiamond = smooth(CHOREO.diamond[0], CHOREO.diamond[1], pIn);
    const pLeader = smooth(CHOREO.leader[0], CHOREO.leader[1], pIn);
    const pWipe = smooth(CHOREO.wipe[0], CHOREO.wipe[1], pIn);
    const op = vis * smooth(0, 1, pOut);
    if (op <= 0) return false;
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
    const sigma = Math.max(0.8, DIAMOND_HALO * s);
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
    for (const m of [v.card?.mesh, ...v.lines.map((l) => l.mesh), v.diamond?.mesh, v.fade?.mesh, v.band?.mesh]) {
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
