import { Matrix4, Vector2, Vector3, type DirectionalLight, type PerspectiveCamera } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';

type N = TslNode;
const { Fn, cameraPosition, cameraProjectionMatrix, float, fract, interleavedGradientNoise, length, min, mix, positionWorld, screenCoordinate, smoothstep, texture, uniform, vogelDiskSample } = tsl;

/**
 * Fit modes. 'snap' (every still): the extent is quantized to 2^(1/8) steps and the centre texel-snapped, so
 * a static camera's shadow edges never shimmer — but a moving camera sees the frustum jump a step at a time
 * (its border, the texel size and the texel-scaled penumbra / bias all pop together). 'smooth' (S5 film, set
 * by the film boot): a continuous extent and centre (edges may swim by a fraction of a texel, softened by the
 * rotated PCF and the accumulation), and the far end of the shadowed range fades out radially just beyond the
 * fit's reach (FAR_FADE) instead of at the frustum border — so the far terrain leaves the shadow map gradually
 * while the reach shrinks with the camera (a descent), not as a moving hard edge.
 */
export type ShadowFitMode = 'snap' | 'smooth';
/**
 * 'smooth': the radial fade band beyond the fit's reach (a share of dMax): full shadows out to dMax (as every
 * snap fit guarantees), fading to none at dMax·(1 + FAR_FADE); the frustum is fitted out to the band's end
 */
export const FAR_FADE = 0.2;

/** World-space box that contains every shadow caster/receiver (the slab incl. plinth + landmarks). */
export interface ShadowBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
}

const ORIGIN = new Vector3();
const UP = new Vector3(0, 1, 0);
const _m = new Matrix4();
const _X = new Vector3();
const _Y = new Vector3();
const _Z = new Vector3();
const _o = new Vector3();
const _d = new Vector3();
const _p = new Vector3();
const _inv = new Matrix4();
const _fwd = new Vector3();
const _q = new Vector3();

/** round up to a step of 2^(1/8) so the fitted extent (and texel size) only changes in small jumps */
function quantizeUp(v: number): number {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(v, 1e-3)) * 8) / 8);
}

/**
 * The key light's shadow: an orthographic frustum fitted to the part of the slab the camera sees
 * (rays through a 9×9 grid of the view clipped to the slab box, limited to a few focus distances),
 * texel-snapped and size-quantized for stability ('snap'; the film fits continuously: 'smooth', see
 * ShadowFitMode), with texel-scaled normal/depth bias and a soft rotated-Vogel PCF whose rotation also
 * changes per accumulation sub-sample (smooth penumbrae).
 */
export class KeyShadow {
  /** PCF radius in shadow texels */
  readonly radius = uniform(2);
  private readonly invMapSize = uniform(1 / 2048);
  /** 'smooth' only: the radial far fade [start, end] (km from the camera) */
  private readonly farFade = uniform(new Vector2(1e6, 2e6));
  texel = 1;
  private mode: ShadowFitMode = 'snap';

  constructor(
    private readonly light: DirectionalLight,
    private readonly taps: number,
  ) {
    this.invMapSize.value = 1 / light.shadow.mapSize.x;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (light.shadow as any).filterNode = this.filter(false);
  }

  get fitMode(): ShadowFitMode {
    return this.mode;
  }

  /**
   * Switch the fit mode (S5: the film boot sets 'smooth' before the first compile; still pages never call
   * this, so their filter graph and fit stay exactly as before). The filter is rebuilt for the mode.
   */
  setMode(mode: ShadowFitMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.light.shadow as any).filterNode = this.filter(mode === 'smooth');
  }

  private filter(radialFade: boolean) {
    const taps = this.taps;
    const radius = this.radius;
    const size = this.invMapSize;
    const far = this.farFade;
    return Fn(({ depthTexture, shadowCoord }: { depthTexture: N; shadowCoord: N }) => {
      // per-pixel rotation (IGN) + per-sub-sample offset from the projection jitter terms, so the
      // accumulation averages different tap patterns instead of freezing one noise pattern
      const jit = cameraProjectionMatrix.element(2).xy;
      const seed = fract(jit.x.mul(7919.3).add(jit.y.mul(6197.7)));
      const phi = fract(interleavedGradientNoise(screenCoordinate.xy).add(seed)).mul(6.28318530718);
      const r = radius.mul(size);
      let sum: N = float(0);
      for (let i = 0; i < taps; i++) {
        const uv = shadowCoord.xy.add(vogelDiskSample(i, taps, phi).mul(r));
        sum = sum.add(texture(depthTexture, uv).compare(shadowCoord.z));
      }
      const s = sum.div(taps);
      // fade out towards the frustum border instead of a hard cut
      const edge = min(min(shadowCoord.x, float(1).sub(shadowCoord.x)), min(shadowCoord.y, float(1).sub(shadowCoord.y)));
      if (!radialFade) return mix(float(1), s, smoothstep(0.0, 0.035, edge));
      // 'smooth' (film): and radially towards the end of the fit's reach
      const reach = float(1).sub(smoothstep(far.x, far.y, length(positionWorld.sub(cameraPosition))));
      return mix(float(1), s, smoothstep(0.0, 0.035, edge).mul(reach));
    });
  }

  /**
   * Fit the shadow frustum. `keyDir` = direction TO the light; `focusDist` = camera→target distance.
   * Pure function of its inputs (deterministic per frame).
   */
  fit(camera: PerspectiveCamera, focusDist: number, keyDir: Vector3, box: ShadowBounds, softKm: number): void {
    const light = this.light;
    const shadow = light.shadow;
    const cam = shadow.camera;
    const mapSize = shadow.mapSize.x;
    _m.lookAt(keyDir, ORIGIN, UP);
    _m.extractBasis(_X, _Y, _Z);

    // --- receivers: visible part of the slab box
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    const addPoint = (p: Vector3) => {
      const x = p.dot(_X);
      const y = p.dot(_Y);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    };
    const dMax = Math.max(focusDist * 3.5, 60);
    // 'smooth' fits out to the end of its radial fade band (full shadows to dMax, fading beyond)
    const reach = this.mode === 'snap' ? dMax : dMax * (1 + FAR_FADE);
    _o.copy(camera.position);
    _inv.copy(camera.projectionMatrixInverse);
    camera.getWorldDirection(_fwd);
    const G = 8;
    for (let j = 0; j <= G; j++)
      for (let i = 0; i <= G; i++) {
        _d.set((i / G) * 2 - 1, (j / G) * 2 - 1, 0.5).applyMatrix4(_inv).transformDirection(camera.matrixWorld);
        // ray / box slab test
        let tIn = 0;
        let tOut = reach;
        const axes: [number, number, number, number][] = [
          [_o.x, _d.x, box.xMin, box.xMax],
          [_o.y, _d.y, box.yMin, box.yMax],
          [_o.z, _d.z, box.zMin, box.zMax],
        ];
        for (const [o, d, lo, hi] of axes) {
          if (Math.abs(d) < 1e-9) {
            if (o < lo || o > hi) tOut = -1;
            continue;
          }
          let ta = (lo - o) / d;
          let tb = (hi - o) / d;
          if (ta > tb) [ta, tb] = [tb, ta];
          tIn = Math.max(tIn, ta);
          tOut = Math.min(tOut, tb);
        }
        if (tIn < tOut) {
          addPoint(_p.copy(_d).multiplyScalar(tIn).add(_o));
          addPoint(_p.copy(_d).multiplyScalar(tOut).add(_o));
        }
      }
    // box corners inside the view (cheap: test by projecting)
    let zTop = -Infinity;
    let zBot = Infinity;
    for (let k = 0; k < 8; k++) {
      _p.set(k & 1 ? box.xMax : box.xMin, k & 2 ? box.yMax : box.yMin, k & 4 ? box.zMax : box.zMin);
      const z = _p.dot(_Z);
      zTop = Math.max(zTop, z);
      zBot = Math.min(zBot, z);
      const dist = _p.distanceTo(camera.position);
      if (dist > reach) continue;
      if (_d.copy(_p).sub(camera.position).dot(_fwd) <= 0) continue;
      const q = _q.copy(_p).project(camera);
      if (q.z >= -1 && q.z <= 1 && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1) addPoint(_p);
    }
    if (!Number.isFinite(x0)) {
      // nothing of the slab in view — keep a small frustum around the camera target direction
      x0 = y0 = -50;
      x1 = y1 = 50;
    }
    // margin for the filter + the grid's sampling error
    const padX = (x1 - x0) * 0.04 + softKm * 2 + 1;
    const padY = (y1 - y0) * 0.04 + softKm * 2 + 1;
    x0 -= padX;
    x1 += padX;
    y0 -= padY;
    y1 += padY;
    // 'snap': quantized extent, texel-snapped centre (stills) · 'smooth': continuous (film)
    const snap = this.mode === 'snap';
    const w = snap ? quantizeUp(x1 - x0) : x1 - x0;
    const h = snap ? quantizeUp(y1 - y0) : y1 - y0;
    const tx = w / mapSize;
    const ty = h / mapSize;
    const cx = snap ? Math.round((x0 + x1) / 2 / tx) * tx : (x0 + x1) / 2;
    const cy = snap ? Math.round((y0 + y1) / 2 / ty) * ty : (y0 + y1) / 2;
    this.texel = Math.max(tx, ty);
    if (!snap) this.farFade.value.set(dMax, reach);

    cam.left = -w / 2;
    cam.right = w / 2;
    cam.bottom = -h / 2;
    cam.top = h / 2;
    const margin = 5;
    cam.near = 0.5;
    cam.far = zTop - zBot + 2 * margin + 0.5;
    cam.updateProjectionMatrix();
    light.position.copy(_X).multiplyScalar(cx).addScaledVector(_Y, cy).addScaledVector(_Z, zTop + margin);
    light.target.position.copy(_X).multiplyScalar(cx).addScaledVector(_Y, cy).addScaledVector(_Z, zBot - margin);
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();

    // bias scaled to the texel: normal offset grows with the filter footprint (grazing sun needs it)
    const r = Math.min(5, Math.max(1, softKm / this.texel));
    this.radius.value = r;
    shadow.normalBias = (1.1 + 0.55 * r) * this.texel;
    shadow.bias = -(0.6 * this.texel) / (cam.far - cam.near);
  }
}
