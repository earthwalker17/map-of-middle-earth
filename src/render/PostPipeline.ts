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
   * split-tone: multiplicative tints (luminance ≈ 1) of the shadows and the highlights, blended by the
   * pixel's luminance l / (l + SPLIT_PIVOT) — cool steel shadows / warm highlights, or a region's own
   */
  splitShadow: uniform(new Vector3(1, 1, 1)),
  splitHighlight: uniform(new Vector3(1, 1, 1)),
  /**
   * soft black point (linear HDR): the colour scales by l / (l + toe) — deep, clean blacks (charcoal
   * Mordor, night) with the mid-tones nearly untouched (−2 % at mid-grey for toe 0.004)
   */
  toe: uniform(0),
  /** saturation multiplier of yellow-green hues (lime grass → olive; cool emerald greens are untouched) */
  greens: uniform(1),
  /** 0..1 hue pull of the same yellow-greens towards green (lime → lush green) */
  greensHue: uniform(0),
  /** halation: red-weighted fringe added from the bloom (no extra pass), strength vs the bloom's luminance */
  halation: uniform(0),
  /** film grain std in display units (mid-tones; final tier only — Engine via PostPipeline.setFrame) */
  grain: uniform(0),
  /** film frame index of the grain (round(t · FILM_FPS)) */
  grainFrame: uniform(0),
};

/** luminance pivot of the split-tone weight l / (l + pivot): 0.5 at mid-grey */
const SPLIT_PIVOT = 0.18;
/** halation colour (linear; the red layer re-exposed through the base, a little green, no blue) */
const HALATION_COLOR = [1.0, 0.3, 0.08] as const;
/** film grain at the final tier: std in display units at mid-grey (≈ 1 %) */
export const FILM_GRAIN = 0.01;
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
 * HDR scene target → (optional) jittered accumulation → one post pass
 * (bloom, grade, vignette, AgX tone map, sRGB, dither) → canvas or RGBA8 target for readback.
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

  constructor(
    private readonly renderer: WebGPURenderer,
    width: number,
    height: number,
    msaa: number,
    useBloom: boolean,
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
        // halation: the bloom's energy again, red-weighted — a warm fringe around bright edges and lights
        c.addAssign(vec3(...HALATION_COLOR).mul(dot(b, vec3(0.2126, 0.7152, 0.0722)).mul(g.halation)));
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
      const satBase = g.saturation.mul(mix(float(1), g.greens, yellowGreen));
      const satRed = mix(satBase, max(satBase, 1.15), redness.mul(g.redKeep));
      const sat = mix(satRed, max(satRed, 1.1), glow);
      c.assign(max(mix(vec3(luma), c, sat), vec3(0))); // saturation > 1 extrapolates: clamp (pow of negatives = NaN)
      // the same yellow-greens lean towards green (`greensHue`: red pulled towards blue) — lush, not lime
      c.r.assign(c.r.sub(c.r.sub(c.b).max(0).mul(g.greensHue.mul(yellowGreen))));
      // contrast pivot at mid-grey (log-ish, gentle)
      const pivot = float(0.18);
      c.assign(c.div(pivot).pow(vec3(g.contrast)).mul(pivot));
      // split-tone (multiplicative: black stays black) and the soft black point, both keyed on luminance
      const ls = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c.mulAssign(mix(g.splitShadow, g.splitHighlight, ls.div(ls.add(SPLIT_PIVOT))));
      c.mulAssign(select(g.toe.greaterThan(0), ls.div(max(ls.add(g.toe), 1e-8)), float(1)));
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
      // film grain (display space, luminance only, mid-tone weighted): a pure function of the pixel and the
      // film frame (hash of round(t · fps)) — off (0) below the final tier, so QA hashes stay put
      If(g.grain.greaterThan(0), () => {
        const p = screenCoordinate.xy.floor();
        const seed = p.x.toUint().mul(uint(1973)).add(p.y.toUint().mul(uint(9277))).add(g.grainFrame.toUint().mul(uint(26699))).toVar();
        // triangular (sum of two uniforms), scaled to unit std
        const n = hash(seed).add(hash(seed.bitXor(uint(0x5bd1e995)))).sub(1).mul(2.449);
        const L = dot(rgb, vec3(0.2126, 0.7152, 0.0722)).clamp(0, 1);
        rgb.addAssign(n.mul(g.grain).mul(L.mul(float(1).sub(L)).mul(4)));
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
