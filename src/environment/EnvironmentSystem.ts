import { DirectionalLight, HemisphereLight, Vector3, type Mesh } from 'three/webgpu';
import { tsl } from '../materials/tsl.ts';
import type { FrameContext, InitContext, System } from '../core/types.ts';
import type { World } from '../world/World.ts';
import { env } from '../materials/environment.ts';
import { atmosphere } from '../materials/atmosphere.ts';
import { SLAB } from '../diorama/slabSpec.ts';
import { daylight, moonDirection, moonIllumination, moonlight, moonPhase, siderealAngle, sunDirection } from './timeOfDay.ts';
import { SkyModel } from './sky.ts';
import { KeyShadow, type ShadowBounds } from './shadows.ts';
import { CloudField } from './clouds.ts';
import { RegionLook } from './regionLook.ts';

const { positionWorld } = tsl;

const _focus = new Vector3();
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Sun / moon / sky / atmosphere / grade from SceneState (tod, dayOfYear, tFx, camera, weather,
 * lookOverride) — continuous, no preset switching. Writes the shared `env` uniforms every
 * material reads and drives the three.js lights:
 *  - one shadow-casting key light: the sun by day, the moon by night (it swaps while both are
 *    dark), dimmed under drifting cloud shadows (quality.clouds.shadows)
 *  - a hemisphere light carrying the sky/ground balance (cool slate sky fill + warm ground bounce)
 *  - the sky dome (Preetham day + twilight/night layer + stars/moon/sun disc + the studio void
 *    around the floating diorama)
 *  - aerial perspective on every surface (materials/atmosphere.ts) whose in-scatter is the same
 *    sky model tabulated per frame, so haze always matches the sky behind it
 *  - RegionLook: the per-shot colour grade blended from the regions around the camera focus.
 *
 * `world` (static data) is bound explicitly: it feeds the RegionLook grade and, at init, the
 * atmosphere's regional haze texture.
 */
export class EnvironmentSystem implements System {
  readonly id = 'environment';
  /** the key light (sun by day, moon by night) — the only shadow-casting light */
  readonly sun = new DirectionalLight(0xffffff, 3);
  readonly hemi = new HemisphereLight(0x9ab8e0, 0x3a3226, 1);
  readonly skyModel = new SkyModel();
  readonly clouds = new CloudField();
  readonly atmosphere = atmosphere;
  sky!: Mesh;
  shadow!: KeyShadow;
  /** true when the key light is the moon */
  keyIsMoon = false;
  /** the shared uniforms (dev handle for diagnostics scripts) */
  readonly env = env;
  readonly regionLook: RegionLook;
  private bounds!: ShadowBounds;
  private readonly radiance = this.skyModel.radianceCPU.bind(this.skyModel);

  constructor(readonly world: World) {
    this.regionLook = new RegionLook(world);
  }

  init(ctx: InitContext): void {
    const { scene, quality } = ctx;
    atmosphere.bindWorld(this.world);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.shadow = new KeyShadow(this.sun, quality.id === 'preview' ? 6 : quality.id === 'review' ? 12 : 16);
    // cloud shadows ride on the key light's colour (a custom colorNode replaces color × intensity)
    if (quality.clouds.shadows) {
      (this.sun as unknown as { colorNode: unknown }).colorNode = env.keyColor.mul(env.keyIntensity).mul(this.clouds.lightFactor(positionWorld, quality.id !== 'preview'));
    }
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
    scene.fogNode = atmosphere.fogNode(quality.atmosphere.inScatter);
  }

  evaluate(frame: FrameContext): void {
    const { state, camera } = frame;
    env.t.value = state.t;
    env.tFx.value = state.tFx;
    env.cloudCoverage.value = state.weather.cloudCoverage;
    env.wind.value.set(state.weather.wind[0], state.weather.wind[1]);
    env.tod.value = state.tod;
    env.cameraPos.value.copy(camera.position);
    // projected-size scale shared by every system that sizes things in pixels (emission sprites,
    // vegetation LOD): px per km at 1 km view depth for the render target being drawn
    env.viewportH.value = frame.viewport.height;
    env.pxPerKm.value = frame.viewport.height / (2 * Math.tan((camera.fov * Math.PI) / 360));

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
    // cloud shadows: full strength at regional range; wide views of the whole slab keep only a
    // trace, so the map's geography stays clean (the same framing rule as the regional grade)
    const [tx, ty, tz] = state.camera.target;
    const focusDist = camera.position.distanceTo(_focus.set(tx, ty, tz));
    env.cloudShadow.value = dl.cloudShadow * (1 - 0.7 * smooth(500, 1600, focusDist));

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
    env.hemiIntensity.value = dl.hemiIntensity;

    // ---- sky dome + the atmosphere's in-scatter table (the same model, per frame)
    this.skyModel.update(dl, sunDir, siderealAngle(state.tod, state.dayOfYear), ml.sky);
    atmosphere.updateInScatter(this.radiance, this.skyModel.radianceKey());

    // ---- haze / void (the exported haze colour is the horizon in-scatter, averaged)
    atmosphere.horizonAverage(env.fogColor.value);
    env.horizonColor.value.copy(env.fogColor.value);
    env.voidColor.value.copy(dl.voidColor);
    env.fogDensity.value = dl.fogDensity;
    env.fogHeightDensity.value = dl.fogHeightDensity;
    env.fogHeightFalloff.value = dl.fogHeightFalloff;
    env.airDensity.value = dl.airDensity;
    env.airFalloff.value = dl.airFalloff;
    this.sky.position.copy(camera.position);
    this.sky.updateMatrixWorld();

    // ---- region grade + sky tint around the camera focus
    this.regionLook.evaluate(state, camera.position, dl.night);

    // ---- key shadow fitted to the visible slab
    const softKm = 0.22 + focusDist * 0.00055;
    this.shadow.fit(camera, focusDist, keyDir, this.bounds, softKm);
  }
}
