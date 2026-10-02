import { Color, DirectionalLight, HemisphereLight, Vector3, type Mesh } from 'three/webgpu';
import { tsl } from '../materials/tsl.ts';
import type { FrameContext, InitContext, System } from '../core/types.ts';
import type { World } from '../world/World.ts';
import { env } from '../materials/environment.ts';
import { atmosphere } from '../materials/atmosphere.ts';
import { SLAB } from '../diorama/slabSpec.ts';
import { daylight, moonDirection, moonIllumination, moonlight, moonPhase, NIGHT_SHADOW_FLOOR, siderealAngle, sunDirection } from './timeOfDay.ts';
import { SkyModel } from './sky.ts';
import { KeyShadow, type ShadowBounds } from './shadows.ts';
import { CloudField } from './clouds.ts';
import { RegionLook } from './regionLook.ts';
import { CloudLayer, deckUnderside } from './cloudLayer.ts';
import { writeEvents } from '../materials/gates.ts';

const { positionWorld } = tsl;

/** the authored haze ramps (looks.json atmo.ramp) are for a camera this far from its focus (km) */
const RAMP_FOCUS_KM = 250;
/** clamp of the ramp's distance scale (mid shots … whole-table views) */
const RAMP_SCALE = [0.25, 1.3] as const;
/** extra air gain for mid and regional shots (env.hazeGain = 1 + this at close range) */
const FILM_AIR = 1.5;
/**
 * Overcast fill: under the deck the light the pall takes from the key comes back as diffuse sky
 * light — the hemisphere fill rises by DECK_FILL × focus cover × deck shadow (flat, shadowless
 * grey-steel light under the pall: lit : shadow ≈ 1.4 at the Black Gate instead of 2.1).
 */
const DECK_FILL = 0.8;
/** the ash haze ramp (km) as multiples of the focus distance: the subject clear, the world behind it gone */
const ASH_RAMP_K = [1.1, 2.0] as const;

const _focus = new Vector3();
const _tone = new Color();
const _gnd = new Color();
const lumC = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
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
 *  - S4: the ash deck over Mordor and the Dagorlad and the visible cumulus (CloudLayer), the
 *    overcast they bring (key light under the deck, hemisphere pulled to the deck tone, an overcast
 *    dome, stars and sun hidden), the focus-blended haze ramp and horizon tint.
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
  readonly cloudLayer: CloudLayer;
  private bounds!: ShadowBounds;
  private readonly radiance = this.skyModel.radianceCPU.bind(this.skyModel);

  constructor(readonly world: World) {
    this.regionLook = new RegionLook(world);
    this.cloudLayer = new CloudLayer(world, this.clouds);
  }

  init(ctx: InitContext): void {
    const { scene, quality } = ctx;
    // preview graphs leave out the review / final-only atmosphere terms (halos, valley mist)
    atmosphere.full = quality.id !== 'preview';
    atmosphere.bindWorld(this.world);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.shadow = new KeyShadow(this.sun, quality.id === 'preview' ? 6 : quality.id === 'review' ? 12 : 16);
    // cloud shadows and the ash deck's overcast ride on the key light's colour (a custom colorNode
    // replaces color × intensity)
    (this.sun as unknown as { colorNode: unknown }).colorNode = env.keyColor
      .mul(env.keyIntensity)
      .mul(this.clouds.lightFactor(positionWorld, quality.id !== 'preview', quality.clouds.shadows));
    scene.add(this.sun, this.sun.target, this.hemi);
    // visible cloud layers (the deck in every tier, cumulus in review / final)
    for (const m of this.cloudLayer.build(quality)) scene.add(m);

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
    // (preview: the along-ray regional haze skips its mid-point tap)
    scene.fogNode = atmosphere.fogNode(quality.atmosphere.inScatter, quality.id !== 'preview');
  }

  evaluate(frame: FrameContext): void {
    const { state, camera } = frame;
    env.t.value = state.t;
    env.tFx.value = state.tFx;
    env.cloudCoverage.value = state.weather.cloudCoverage;
    env.wind.value.set(state.weather.wind[0], state.weather.wind[1]);
    env.tod.value = state.tod;
    writeEvents(state.events, env.events.value);
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
    // moonlit cast shadows keep a floor (S4 W4-S2): no black holes behind the ranges at night
    this.sun.shadow.intensity = 1 - NIGHT_SHADOW_FLOOR * dl.night;
    // cloud shadows: full strength at regional range; wide views of the whole slab keep only a
    // trace, so the map's geography stays clean (the same framing rule as the regional grade)
    const [tx, ty, tz] = state.camera.target;
    const focusDist = camera.position.distanceTo(_focus.set(tx, ty, tz));
    const wide = smooth(500, 1600, focusDist);
    env.cloudShadow.value = dl.cloudShadow * (1 - 0.7 * wide);
    // visible cumulus: regional and closer shots only (overviews stay a clean physical model)
    env.cloudVis.value = 1 - smooth(260, 700, focusDist);

    // ---- region grade + sky tint + ash deck around the camera focus (pure in SceneState)
    this.regionLook.evaluate(state, camera.position, dl.night);
    const deck = this.regionLook.deck;
    // the key light under the pall: per fragment atmo2.R × this (relaxed for the whole-table views;
    // the focus blend is continuous — RegionLook leans on the strongest deck as its weight → 0)
    env.deckShadow.value = deck.shadow * (1 - 0.5 * wide);
    env.deckTone.value.copy(deck.tone);
    // the dome turns overcast only while the camera is under the deck
    env.deck.value = smooth(0.1, 0.5, deck.cover) * (1 - smooth(deck.height - 6, deck.height + 4, camera.position.y));
    // the red underglow wakes with dusk and night (the fires are the only light then)
    env.deckGlow.value = 0.45 + 0.55 * Math.max(dl.night, dl.twilight, dl.golden * 0.6);
    env.horizonTint.value.copy(this.regionLook.horizonTint);
    // the haze ramp (focus-blended looks.json atmo.ramp, authored for a regional focus) scales its
    // distances with the shot: a mid shot's subject stays crisp while the land 2–3 × beyond it
    // veils (film air, env.hazeGain), the whole-table views keep the S3 ramp (≈ 45 → 900 km)
    const r = this.regionLook.ramp;
    const k = Math.min(RAMP_SCALE[1], Math.max(RAMP_SCALE[0], focusDist / RAMP_FOCUS_KM));
    env.hazeRamp.value.set(r[0] * k, r[1] * k, r[2], r[3]);
    env.hazeGain.value = 1 + FILM_AIR * (1 - smooth(60, 320, focusDist));
    const a0 = Math.min(170, Math.max(10, ASH_RAMP_K[0] * focusDist));
    atmosphere.ashRamp.value.set(a0, Math.min(320, Math.max(a0 + 20, ASH_RAMP_K[1] * focusDist)));
    atmosphere.updateEye(camera.position, deck.height);
    // valley mist: regional and closer shots only (no channel ribbons in the wide views)
    atmosphere.mistVis.value = 1 - smooth(170, 380, focusDist);

    // ---- hemisphere (moonlit sky adds a cool lift at night); under the deck the sky fill turns
    // flat grey-steel: desaturated towards the deck tone and dimmed (diffuse overcast light)
    const skyCol = dl.skyColor.clone();
    skyCol.r += 0.012 * ml.sky;
    skyCol.g += 0.02 * ml.sky;
    skyCol.b += 0.042 * ml.sky;
    env.clearSkyColor.value.copy(skyCol).multiplyScalar(dl.hemiIntensity);
    if (deck.cover > 0) {
      const L = lumC(skyCol);
      const tl = lumC(deck.tone) || 1;
      _tone.copy(deck.tone).multiplyScalar((L * 0.78) / tl);
      skyCol.lerp(_tone, 0.85 * deck.cover);
    }
    env.skyColor.value.copy(skyCol);
    env.groundColor.value.copy(dl.groundColor);
    this.hemi.color.copy(skyCol);
    this.hemi.groundColor.copy(dl.groundColor);
    // overcast fill: what the pall takes from the key comes back as diffuse light
    const hemiI = dl.hemiIntensity * (1 + DECK_FILL * deck.cover * env.deckShadow.value);
    this.hemi.intensity = hemiI;
    env.hemiIntensity.value = hemiI;
    // the overcast dome's colour: the deck underside's radiance (CPU mirror of the deck shader)
    _gnd.copy(dl.groundColor).multiplyScalar(hemiI);
    deckUnderside(deck.tone, env.keyColor.value, env.keyIntensity.value, env.keyDir.value.y, env.clearSkyColor.value, _gnd, env.deckSky.value);
    this.cloudLayer.evaluate(focusDist);

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

    // ---- key shadow fitted to the visible slab
    const softKm = 0.22 + focusDist * 0.00055;
    this.shadow.fit(camera, focusDist, keyDir, this.bounds, softKm);
  }
}
