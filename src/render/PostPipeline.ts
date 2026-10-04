import {
  AgXToneMapping,
  HalfFloatType,
  LinearFilter,
  NodeMaterial,
  QuadMesh,
  RenderPipeline,
  RenderTarget,
  NoColorSpace,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn,
  float,
  mix,
  renderOutput,
  screenCoordinate,
  screenUV,
  texture,
  uniform,
  vec3,
  vec4,
  length,
  smoothstep,
  interleavedGradientNoise,
  dot,
  max,
  select,
  exp,
  step,
  hash,
  uint,
  If,
  log2,
  exp2,
  clamp,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

/**
 * Grade parameters. `exposure` is the user's (explorer GUI); everything else is written every
 * frame by RegionLook (src/environment/regionLook.ts) from SceneState — the defaults are the
 * neutral S1 look.
 */
export const gradeUniforms = {
  exposure: uniform(0.9),
  /** region / night exposure bias (linear multiplier, 2^stops) */
  exposureBias: uniform(1),
  saturation: uniform(1.12),
  contrast: uniform(1.08),
  /** multiplicative tint (white balance), linear */
  tint: uniform(new Vector3(1, 1, 1)),
  /** additive lift in linear space (shadows) */
  lift: uniform(new Vector3(0, 0, 0)),
  /** 0..1 hue-selective saturation: reds/oranges (lava, fire, the Eye) keep their colour */
  redKeep: uniform(0),
  /**
   * 0..1 luminance-keyed (hue-agnostic) exemption from the saturation step: bright emitters (amber
   * windows, blue-white elven lamps, Morgul green) keep their colour through the night
   * desaturation. RegionLook sets it ≈ 0.9·max(night, twilight); 0 by day.
   */
  glowKeep: uniform(0),
  vignette: uniform(0.35),
  bloomStrength: uniform(0.12),
  bloomRadius: uniform(0.55),
  bloomThreshold: uniform(2.2),
  // ---- film grade (S4 W3-F; RegionLook writes them, identity defaults)
  /**
   * split-tone: multiplicative tints (luminance ≈ 1) of the shadows and the highlights, weighted
   * (1 − w)² / w² by the pixel's log luminance (w: 0 at SPLIT_LO, 1 at SPLIT_HI) — the two tints never
   * cancel into a neutral mid-grey average; cool steel shadows / warm highlights, or a region's own
   */
  splitShadow: uniform(new Vector3(1, 1, 1)),
  splitHighlight: uniform(new Vector3(1, 1, 1)),
  /**
   * soft black point (linear HDR): the colour scales by (l + TOE_FLOOR·toe) / (l + toe) — denser,
   * cleaner blacks (charcoal Mordor, night) that never fall more than 1.7 stops (a print black, not a
   * void); the mid-tones are untouched (< 1 % at mid-grey)
   */
  toe: uniform(0),
  /**
   * highlight gain in stops, weighted from HI_LO to HI_HI in log luminance (0 in the shadows): the day
   * highlights reach AgX's shoulder and roll off there instead of peaking at half scale. RegionLook
   * fades it out at night.
   */
  highlights: uniform(0),
  /** saturation multiplier of yellow-green hues (lime grass → olive; cool emerald greens are untouched) */
  greens: uniform(1),
  /** 0..1 hue pull of the same yellow-greens towards green (lime → lush green) */
  greensHue: uniform(0),
  /**
   * saturation multiplier of warm hues (orange, beige, taupe: red the largest channel, well above blue;
   * strongly chromatic reds — lava, fire, the Eye — exempt): Mordor's beige plain → charcoal
   */
  warms: uniform(1),
  /**
   * halation: an orange-red fringe from the bloom's RED record (no extra pass) — white lights, lava and
   * fire get it, Morgul's green and the elven blue-white barely any (the halo keeps its hue)
   */
  halation: uniform(0),
  /** film grain std in display units (mid-tones; final tier only — Engine via PostPipeline.setFrame) */
  grain: uniform(0),
  /** film frame index of the grain (round(t · FILM_FPS)) */
  grainFrame: uniform(0),
};

/** log2 luminance range of the split-tone weight (0.004 → 0.35: deep shadows → bright highlights) */
const SPLIT_LO = -8;
const SPLIT_HI = -1.5;
/** log2 luminance range of the highlight gain weight (0.011 → 0.35) */
const HI_LO = -6.5;
const HI_HI = -1.5;
/** the soft black point never scales a colour below this fraction (print black: dense, never a void) */
const TOE_FLOOR = 0.3;
/** halation colour (linear; the red layer re-exposed through the base, a little green, a trace of blue) */
const HALATION_COLOR = [1.0, 0.3, 0.08] as const;
/** film grain at the final tier: std in display units at mid-grey (≈ 1 %) */
export const FILM_GRAIN = 0.01;
/**
 * grain shape: white noise through a 5-tap kernel (centre GRAIN_C, the 4 neighbours GRAIN_N) — grains
 * of ≈ 1.5 px with a stationary variance (no cell grid); GRAIN_NORM rescales the sum to unit std
 */
const GRAIN_C = 0.4;
const GRAIN_N = 0.15;
const GRAIN_NORM = 1 / Math.sqrt((GRAIN_C * GRAIN_C + 4 * GRAIN_N * GRAIN_N) / 12);
/** per-channel (dye-cloud) share of the grain, relative to the luminance grain */
const GRAIN_CHROMA = 0.2;
/** frame rate of the grain clock (the film is 24 fps) */
export const FILM_FPS = 24;

/**
 * Emitter highlight compress (graded linear HDR, night / twilight only): soft knee from GLOW_KNEE towards
 * GLOW_LIMIT on the largest channel. AgX's log encoding flattens channel ratios of bright values (an
 * orange core at 30 renders white), so emitter cores are held low enough for their hue to survive; the
 * bloom (taken before) still carries their energy.
 */
const GLOW_KNEE = 1.5;
const GLOW_LIMIT = 3;

/**
 * S5 film overlay (titles, captions, fades): drawn into the readback target AFTER the post graph, in
 * display (sRGB-encoded) space with premultiplied blending — never graded, tone-mapped or fogged.
 * Still pages never set one, so their frames are untouched. `render` must not clear the target.
 */
export interface OverlayPass {
  /** false = nothing to draw this frame (the pass is skipped entirely) */
  readonly active: boolean;
  /** draw into `target` (the RGBA8 readback target, sRGB-encoded bytes, no depth buffer) */
  render(renderer: WebGPURenderer, target: RenderTarget, width: number, height: number): void;
}

/**
 * HDR scene target → (optional) jittered accumulation → one post pass
 * (bloom, grade, vignette, AgX tone map, sRGB, dither) → canvas or RGBA8 target for readback
 * (→ the optional S5 overlay pass on the readback target).
 */
export class PostPipeline {
  readonly hdr: RenderTarget;
  private readonly accum: [RenderTarget, RenderTarget];
  private readonly out: RenderTarget;
  private readonly accumMaterial: NodeMaterial;
  private readonly accumQuad: QuadMesh;
  private readonly accumPrev = texture(null as unknown as Texture);
  private readonly accumCur = texture(null as unknown as Texture);
  private readonly accumWeight = uniform(1);
  private readonly postInput = texture(null as unknown as Texture);
  private readonly pipeline: RenderPipeline;
  private accumIndex = 0;
  private accumCount = 0;
  width: number;
  height: number;
  /** S5 film titles / captions (src/titles): drawn on the readback target after the post graph */
  overlay: OverlayPass | null = null;
  /** S5 film only (enableRouteKeep): the grade leaves the route line's pixels at saturation 1 */
  private routeKeep = false;

  constructor(
    private readonly renderer: WebGPURenderer,
    width: number,
    height: number,
    msaa: number,
    private readonly useBloom: boolean,
  ) {
    this.width = width;
    this.height = height;
    this.hdr = new RenderTarget(width, height, {
      type: HalfFloatType,
      samples: msaa,
      depthBuffer: true,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    });
    const accumOpts = { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter };
    this.accum = [new RenderTarget(width, height, accumOpts), new RenderTarget(width, height, accumOpts)];
    // The post pass already encodes to sRGB (renderOutput), so the readback target must store the
    // bytes as-is: a SRGBColorSpace RGBA8 target becomes rgba8unorm-srgb and encodes a second time.
    this.out = new RenderTarget(width, height, { type: UnsignedByteType, depthBuffer: false });
    this.out.texture.colorSpace = NoColorSpace;

    // running average: acc_i = mix(acc_{i-1}, cur, 1/(i+1))
    this.accumMaterial = new NodeMaterial();
    // weight 1 (first sample) takes the current sample verbatim: stale/NaN history never leaks in
    this.accumMaterial.fragmentNode = vec4(select(this.accumWeight.greaterThanEqual(0.999), this.accumCur.rgb, mix(this.accumPrev.rgb, this.accumCur.rgb, this.accumWeight)), 1);
    this.accumQuad = new QuadMesh(this.accumMaterial);

    renderer.toneMapping = AgXToneMapping;
    renderer.toneMappingExposure = 1;
    this.postInput.value = this.hdr.texture;
    this.pipeline = new RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false;
    this.pipeline.outputNode = this.buildOutput(useBloom);
  }

  /**
   * S5 film only: the route line (src/route) writes its coverage into the HDR alpha (min(a, 1 − coverage):
   * the scene leaves alpha ≥ 1, veils drawn over the line raise it back), the accumulation carries alpha, and
   * the grade sets the saturation of covered pixels to 1 — the luminous line keeps its gold through grades
   * that grey out warm hues (Mordor's warms 0.4 under the moonlit layer turned it cream-white). Still pages never
   * call this: their accumulation and post graphs stay exactly as before.
   */
  enableRouteKeep(): void {
    if (this.routeKeep) return;
    this.routeKeep = true;
    const first = this.accumWeight.greaterThanEqual(0.999);
    this.accumMaterial.fragmentNode = vec4(
      select(first, this.accumCur.rgb, mix(this.accumPrev.rgb, this.accumCur.rgb, this.accumWeight)),
      select(first, this.accumCur.a, mix(this.accumPrev.a, this.accumCur.a, this.accumWeight)),
    );
    this.accumMaterial.needsUpdate = true;
    this.pipeline.outputNode = this.buildOutput(this.useBloom);
    this.pipeline.needsUpdate = true;
  }

  private buildOutput(useBloom: boolean) {
    const g = gradeUniforms;
    const input = this.postInput;
    const bloomNode = useBloom ? bloom(input, g.bloomStrength, g.bloomRadius, g.bloomThreshold) : null;
    const graded = Fn(() => {
      const ex = g.exposure.mul(g.exposureBias);
      const c = input.rgb.mul(ex).toVar();
      if (bloomNode) {
        const b = bloomNode.rgb.mul(ex).toVar();
        c.addAssign(b);
        // halation: the bloom's red record again, spread into orange — a warm fringe around white lights,
        // lava and fire; green / blue emitters keep their halo's hue
        c.addAssign(vec3(...HALATION_COLOR).mul(b.r.mul(g.halation)));
      }
      // emitter key: luminance before the grade (lights and their bloom halo are the only things
      // this bright at night; by day glowKeep is 0)
      const glow = smoothstep(1.2, 4.0, dot(c, vec3(0.2126, 0.7152, 0.0722))).mul(g.glowKeep);
      c.assign(c.mul(g.tint).add(g.lift));
      // saturation around luminance; reds/oranges can be exempt (Lesnie's "desaturated, with
      // strong reds providing colour separation" for Mordor and Doom)
      const luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // only strongly chromatic reds/oranges (lava, fire, embers), never brown earth or rock
      const redness = smoothstep(0.5, 0.8, c.r.sub(max(c.g, c.b)).div(max(c.r, 1e-4)));
      // yellow-green hues (green the largest channel, red well above blue: lime, sunlit grass) take the
      // `greens` multiplier; blue-greens, olive-greys, earth and rock keep the region saturation
      const gInv = float(1).div(max(c.g, 1e-4));
      const yellowGreen = smoothstep(0.04, 0.25, c.g.sub(max(c.r, c.b)).mul(gInv)).mul(smoothstep(0.15, 0.55, c.r.sub(c.b).mul(gInv))).toVar();
      // warm hues (red the largest channel, well above blue: beige, taupe, orange earth) take `warms`;
      // the strongly chromatic reds are exempt (and keep their colour through redKeep below)
      const rInv = float(1).div(max(c.r, 1e-4));
      const warm = smoothstep(0.08, 0.3, c.r.sub(c.b).mul(rInv)).mul(smoothstep(-0.02, 0.04, c.r.sub(c.g).mul(rInv))).mul(float(1).sub(redness));
      const satBase = g.saturation.mul(mix(float(1), g.greens, yellowGreen)).mul(mix(float(1), g.warms, warm));
      const satRed = mix(satBase, max(satBase, 1.15), redness.mul(g.redKeep));
      const satGlow = mix(satRed, max(satRed, 1.1), glow);
      // film route line (enableRouteKeep): its coverage rides in the alpha; covered pixels keep saturation 1
      const sat = this.routeKeep ? mix(satGlow, float(1), clamp(float(1).sub(input.a), 0, 1)) : satGlow;
      c.assign(max(mix(vec3(luma), c, sat), vec3(0))); // saturation > 1 extrapolates: clamp (pow of negatives = NaN)
      // the same yellow-greens lean towards green (`greensHue`: red pulled towards blue) — lush, not lime
      c.r.assign(c.r.sub(c.r.sub(c.b).max(0).mul(g.greensHue.mul(yellowGreen))));
      // contrast pivot at mid-grey (log-ish, gentle)
      const pivot = float(0.18);
      c.assign(c.div(pivot).pow(vec3(g.contrast)).mul(pivot));
      // split-tone, highlight gain and soft black point — all multiplicative (black stays black), all keyed
      // on the graded luminance
      const ls = dot(c, vec3(0.2126, 0.7152, 0.0722)).toVar();
      const lw = log2(max(ls, 1e-6));
      const ws = smoothstep(SPLIT_LO, SPLIT_HI, lw);
      const wsh = float(1).sub(ws);
      const split = vec3(1, 1, 1).add(g.splitShadow.sub(1).mul(wsh.mul(wsh))).add(g.splitHighlight.sub(1).mul(ws.mul(ws)));
      const gain = exp2(g.highlights.mul(smoothstep(HI_LO, HI_HI, lw)));
      const toeK = ls.add(g.toe.mul(TOE_FLOOR)).div(max(ls.add(g.toe), 1e-8));
      c.mulAssign(split.mul(gain.mul(toeK)));
      // vignette
      const d = length(screenUV.sub(0.5).mul(vec3(1.0, 0.8, 0).xy));
      c.assign(c.mul(float(1).sub(smoothstep(0.35, 0.95, d).mul(g.vignette))));
      // hue-preserving highlight compress at night (glowKeep): scaling the whole colour by its largest
      // channel (soft knee GLOW_KNEE → GLOW_LIMIT) keeps the hue of Morgul green, fire and windows instead
      // of AgX's white; identity below the knee
      const peakCh = max(c.r, max(c.g, c.b));
      const over = max(peakCh.sub(GLOW_KNEE), 0);
      const squeezed = float(GLOW_KNEE).add(float(GLOW_LIMIT - GLOW_KNEE).mul(float(1).sub(exp(over.div(-(GLOW_LIMIT - GLOW_KNEE))))));
      c.assign(c.mul(mix(float(1), squeezed.div(max(peakCh, 1e-4)), g.glowKeep.mul(step(GLOW_KNEE, peakCh)))));
      return c;
    })();
    const display = renderOutput(vec4(graded, 1), AgXToneMapping, SRGBColorSpace);
    // blue-noise-like dither before 8-bit quantisation (kills sky/fog banding)
    const dither = interleavedGradientNoise(screenCoordinate.xy).sub(0.5).div(255);
    const out = Fn(() => {
      const rgb = display.rgb.add(dither).toVar();
      // film grain (display space, mid-tone weighted): a pure function of the pixel and the film frame
      // (hash of round(t · fps)) — off (0) below the final tier, so QA hashes stay put. Grains of ≈ 1.5 px
      // (5-tap filtered white noise), luminance plus a GRAIN_CHROMA share per channel.
      If(g.grain.greaterThan(0), () => {
        const p = screenCoordinate.xy.floor().add(1); // +1: the neighbours' seeds stay non-negative
        const frame = g.grainFrame.toUint().mul(uint(26699)).toVar();
        const seedAt = (dx: number, dy: number) => p.x.add(dx).toUint().mul(uint(1973)).add(p.y.add(dy).toUint().mul(uint(9277))).add(frame);
        const s0 = seedAt(0, 0).toVar();
        const nb = hash(seedAt(1, 0)).add(hash(seedAt(-1, 0))).add(hash(seedAt(0, 1))).add(hash(seedAt(0, -1))).sub(2);
        const lumN = hash(s0).sub(0.5).mul(GRAIN_C).add(nb.mul(GRAIN_N)).mul(GRAIN_NORM);
        const chroma = vec3(hash(s0.bitXor(uint(0x5bd1e995))), hash(s0.bitXor(uint(0x27d4eb2f))), hash(s0.bitXor(uint(0x165667b1)))).sub(0.5).mul(Math.sqrt(12) * GRAIN_CHROMA);
        const L = dot(rgb, vec3(0.2126, 0.7152, 0.0722)).clamp(0, 1);
        rgb.addAssign(vec3(lumN, lumN, lumN).add(chroma).mul(g.grain.mul(L.mul(float(1).sub(L)).mul(4))));
      });
      return rgb;
    })();
    return vec4(out, 1);
  }

  /**
   * The frame's film clock and tier: grain only at the final tier (stills, film), keyed on the film
   * frame round(t · FILM_FPS) — two renders of the same frame are identical.
   */
  setFrame(t: number, final: boolean): void {
    gradeUniforms.grain.value = final ? FILM_GRAIN : 0;
    gradeUniforms.grainFrame.value = Math.max(0, Math.round(t * FILM_FPS));
  }

  setSize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.hdr.setSize(width, height);
    this.accum[0].setSize(width, height);
    this.accum[1].setSize(width, height);
    this.out.setSize(width, height);
  }

  /** Begin a new accumulated frame. */
  beginAccumulation(): void {
    this.accumCount = 0;
  }

  /** Fold the current contents of `hdr` into the running average. */
  accumulate(): void {
    const r = this.renderer;
    const dst = this.accum[this.accumIndex];
    const src = this.accum[1 - this.accumIndex];
    this.accumPrev.value = src.texture;
    this.accumCur.value = this.hdr.texture;
    this.accumWeight.value = 1 / (this.accumCount + 1);
    r.setRenderTarget(dst);
    this.accumQuad.render(r);
    r.setRenderTarget(null);
    this.postInput.value = dst.texture;
    this.accumIndex = 1 - this.accumIndex;
    this.accumCount++;
  }

  /** Post-process into the canvas (target = null) or into the readback target. */
  present(toReadback: boolean, useAccumulated: boolean): void {
    if (!useAccumulated) this.postInput.value = this.hdr.texture;
    const r = this.renderer;
    r.setRenderTarget(toReadback ? this.out : null);
    this.pipeline.render();
    // S5: captured film frames only (the explorer canvas path has its own output transform)
    if (toReadback && this.overlay?.active) {
      const autoClear = r.autoClear;
      r.autoClear = false;
      r.setRenderTarget(this.out);
      this.overlay.render(r, this.out, this.width, this.height);
      r.autoClear = autoClear;
    }
    r.setRenderTarget(null);
  }

  /** Read the last `present(true, …)` result as tightly packed RGBA8 rows (top row first). */
  async readPixels(): Promise<Uint8Array> {
    const w = this.width;
    const h = this.height;
    const raw = (await this.renderer.readRenderTargetPixelsAsync(this.out, 0, 0, w, h)) as Uint8Array;
    const stride = Math.ceil((w * 4) / 256) * 256;
    if (stride === w * 4) return new Uint8Array(raw.buffer, raw.byteOffset, w * h * 4);
    const packed = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) packed.set(raw.subarray(y * stride, y * stride + w * 4), y * w * 4);
    return packed;
  }
}
