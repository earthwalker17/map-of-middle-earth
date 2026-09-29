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
  clamp,
  select,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

/**
 * Grade parameters. xposure is the user's (explorer GUI); everything else is written every
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
  vignette: uniform(0.35),
  bloomStrength: uniform(0.12),
  bloomRadius: uniform(0.55),
  bloomThreshold: uniform(2.2),
};

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
      if (bloomNode) c.addAssign(bloomNode.rgb.mul(ex));
      c.assign(c.mul(g.tint).add(g.lift));
      // saturation around luminance; reds/oranges can be exempt (Lesnie's "desaturated, with
      // strong reds providing colour separation" for Mordor and Doom)
      const luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // only strongly chromatic reds/oranges (lava, fire, embers), never brown earth or rock
      const redness = smoothstep(0.5, 0.8, c.r.sub(max(c.g, c.b)).div(max(c.r, 1e-4)));
      const sat = mix(g.saturation, max(g.saturation, 1.15), redness.mul(g.redKeep));
      c.assign(max(mix(vec3(luma), c, sat), vec3(0))); // saturation > 1 extrapolates: clamp (pow of negatives = NaN)
      // contrast pivot at mid-grey (log-ish, gentle)
      const pivot = float(0.18);
      c.assign(c.div(pivot).pow(vec3(g.contrast)).mul(pivot));
      // vignette
      const d = length(screenUV.sub(0.5).mul(vec3(1.0, 0.8, 0).xy));
      c.assign(c.mul(float(1).sub(smoothstep(0.35, 0.95, d).mul(g.vignette))));
      return c;
    })();
    const display = renderOutput(vec4(graded, 1), AgXToneMapping, SRGBColorSpace);
    // blue-noise-like dither before 8-bit quantisation (kills sky/fog banding)
    const dither = interleavedGradientNoise(screenCoordinate.xy).sub(0.5).div(255);
    return vec4(display.rgb.add(dither), 1);
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
