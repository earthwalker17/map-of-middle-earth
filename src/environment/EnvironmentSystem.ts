import { DirectionalLight, HemisphereLight, Vector3, type Mesh } from 'three/webgpu';
import { tsl } from '../materials/tsl.ts';
import type { FrameContext, InitContext, System } from '../core/types.ts';
import { env } from '../materials/environment.ts';
import { SLAB } from '../diorama/slabSpec.ts';
import { daylight, moonDirection, moonIllumination, moonlight, moonPhase, siderealAngle, sunDirection } from './timeOfDay.ts';
import { SkyModel } from './sky.ts';
import { KeyShadow, type ShadowBounds } from './shadows.ts';

const { Fn, abs, clamp, exp, float, fog, length, max, normalize, positionWorld, select } = tsl;

const _focus = new Vector3();

/**
 * Sun / moon / sky / fog from SceneState (tod, dayOfYear, tFx, camera) — continuous, no preset
 * switching. Writes the shared `env` uniforms every material reads and drives the three.js lights:
 *  - one shadow-casting key light: the sun by day, the moon by night (it swaps while both are dark)
 *  - a hemisphere light carrying the sky/ground balance (cool shadows at golden hour)
 *  - the sky dome (Preetham day + twilight/night layer + stars/moon/sun disc + the dark void
 *    around the floating diorama) and an analytic height fog whose colour is the same sky model
 *    evaluated at the horizon, so haze always matches the sky behind it.
 */
export class EnvironmentSystem implements System {
  readonly id = 'environment';
  /** the key light (sun by day, moon by night) — the only shadow-casting light */
  readonly sun = new DirectionalLight(0xffffff, 3);
  readonly hemi = new HemisphereLight(0x9ab8e0, 0x3a3226, 1);
  readonly skyModel = new SkyModel();
  sky!: Mesh;
  shadow!: KeyShadow;
  /** true when the key light is the moon */
  keyIsMoon = false;
  /** the shared uniforms (dev handle for diagnostics scripts) */
  readonly env = env;
  private bounds!: ShadowBounds;

  init(ctx: InitContext): void {
    const { scene, quality } = ctx;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.shadow = new KeyShadow(this.sun, quality.id === 'preview' ? 6 : quality.id === 'review' ? 12 : 16);
    scene.add(this.sun, this.sun.target, this.hemi);

    this.sky = this.skyModel.createDome();
    scene.add(this.sky);

    this.bounds = {
      xMin: SLAB.xMin - SLAB.plinthOut - 1,
      xMax: SLAB.xMax + SLAB.plinthOut + 1,
      zMin: SLAB.zMin - SLAB.plinthOut - 1,
      zMax: SLAB.zMax + SLAB.plinthOut + 1,
      yMin: SLAB.plinthBottom - 1,
      yMax: 62,
    };
    scene.fogNode = fog(this.fogColorNode(), this.fogFactorNode());
  }

  /**
   * Analytic exponential height fog along the view ray + mild distance haze. Only the part of the
   * ray above sea level is hazy: the slab sides and plinth hang in clear museum air, not in fog that
   * would grow exponentially denser below y = 0.
   */
  private fogFactorNode() {
    return Fn(() => {
      const ray = positionWorld.sub(env.cameraPos);
      const d = length(ray);
      const yc = max(env.cameraPos.y, 0);
      const yRaw = positionWorld.y;
      // the haze lives above sea level: clip the ray where it dips below y = 0 (slab sides, plinth
      // and sea floor get only the air in front of them, not an ever-denser fog)
      const frac = select(yRaw.lessThan(0), clamp(yc.div(max(yc.sub(yRaw), 1e-4)), 0, 1), float(1));
      const yp = max(yRaw, 0);
      const dAir = d.mul(frac);
      const k = env.fogHeightFalloff;
      const dy = yp.sub(yc);
      const ec = exp(k.mul(yc).negate());
      const ep = exp(k.mul(yp).negate());
      const integral = select(abs(dy).greaterThan(1e-3), dAir.mul(ec.sub(ep)).div(k.mul(dy)), dAir.mul(ec));
      const total = env.fogHeightDensity.mul(integral).add(env.fogDensity.mul(d));
      return clamp(float(1).sub(exp(total.negate())), 0, 1);
    })();
  }

  /** Fog colour = the sky model's horizon haze in the view azimuth (sun glow, twilight, night). */
  private fogColorNode() {
    return Fn(() => {
      const dir = normalize(positionWorld.sub(env.cameraPos));
      return this.skyModel.horizon(dir);
    })();
  }

  evaluate(frame: FrameContext): void {
    const { state, camera } = frame;
    env.t.value = state.t;
    env.tFx.value = state.tFx;
    env.tod.value = state.tod;
    env.cameraPos.value.copy(camera.position);

    // ---- sun & daylight
    const sunDir = sunDirection(state.tod, state.dayOfYear, env.sunDir.value);
    const dl = daylight(sunDir);
    env.sunColor.value.copy(dl.sunColor);
    env.sunIntensity.value = dl.sunIntensity;
    env.night.value = dl.night;
    env.golden.value = dl.golden;
    env.twilight.value = dl.twilight;

    // ---- moon
    const phase = moonPhase(state.dayOfYear, state.tod);
    const illum = moonIllumination(phase);
    env.moonPhase.value = phase;
    env.moonIllum.value = illum;
    moonDirection(state.tod, state.dayOfYear, phase, env.moonDir.value);
    const ml = moonlight(env.moonDir.value, illum, dl.sunElevationDeg);
    env.moonColor.value.copy(ml.color);
    env.moonIntensity.value = ml.key;

    // ---- key light: sun above −4°, moon below (both are ~0 at the swap, so it never pops)
    this.keyIsMoon = dl.sunElevationDeg < -4;
    const keyDir = this.keyIsMoon ? env.moonDir.value : sunDir;
    env.keyDir.value.copy(keyDir);
    env.keyColor.value.copy(this.keyIsMoon ? ml.color : dl.sunColor);
    env.keyIntensity.value = this.keyIsMoon ? ml.key : dl.sunIntensity;
    this.sun.color.copy(env.keyColor.value);
    this.sun.intensity = env.keyIntensity.value;

    // ---- hemisphere (moonlit sky adds a cool lift at night)
    const skyCol = dl.skyColor.clone();
    skyCol.r += 0.012 * ml.sky;
    skyCol.g += 0.02 * ml.sky;
    skyCol.b += 0.042 * ml.sky;
    env.skyColor.value.copy(skyCol);
    env.groundColor.value.copy(dl.groundColor);
    this.hemi.color.copy(skyCol);
    this.hemi.groundColor.copy(dl.groundColor);
    this.hemi.intensity = dl.hemiIntensity;

    // ---- sky dome
    this.skyModel.update(dl, sunDir, siderealAngle(state.tod, state.dayOfYear), ml.sky);

    // ---- fog / haze / void (the exported haze colour is the sky model's horizon, averaged)
    this.skyModel.horizonAverage(sunDir, env.fogColor.value);
    env.horizonColor.value.copy(env.fogColor.value);
    env.voidColor.value.copy(dl.voidColor);
    env.fogDensity.value = dl.fogDensity;
    env.fogHeightDensity.value = dl.fogHeightDensity;
    env.fogHeightFalloff.value = dl.fogHeightFalloff;
    this.sky.position.copy(camera.position);
    this.sky.updateMatrixWorld();

    // ---- key shadow fitted to the visible slab
    const [tx, ty, tz] = state.camera.target;
    const focusDist = camera.position.distanceTo(_focus.set(tx, ty, tz));
    const softKm = 0.22 + focusDist * 0.00055;
    this.shadow.fit(camera, focusDist, keyDir, this.bounds, softKm);
  }
}
