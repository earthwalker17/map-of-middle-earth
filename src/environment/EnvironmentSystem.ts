import { DirectionalLight, HemisphereLight, Matrix4, Object3D, Vector3 } from 'three/webgpu';
import { tsl } from '../materials/tsl.ts';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import type { FrameContext, InitContext, System } from '../core/types.ts';
import { env } from '../materials/environment.ts';
import { daylight, moonDirection, sunDirection } from './timeOfDay.ts';

const { Fn, clamp, dot, exp, float, fog, length, max, mix, normalize, positionWorld, pow, select, abs, vec4 } = tsl;

const _v = new Vector3();
const _t = new Vector3();
const _m = new Matrix4();

/**
 * Sun/moon/sky/fog from SceneState.tod — continuous, no preset switching. Writes the shared
 * `env` uniforms that every material reads, and drives the three.js lights.
 */
export class EnvironmentSystem implements System {
  readonly id = 'environment';
  readonly sun = new DirectionalLight(0xffffff, 3);
  readonly moon = new DirectionalLight(0x9fb4d9, 0);
  readonly hemi = new HemisphereLight(0x9ab8e0, 0x3a3226, 1);
  sky!: SkyMesh;
  private readonly sunTarget = new Object3D();
  readonly skyGain = tsl.uniform(0.2);

  init(ctx: InitContext): void {
    const { scene, quality } = ctx;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.target = this.sunTarget;
    scene.add(this.sun, this.sunTarget, this.moon, this.hemi);

    this.sky = new SkyMesh();
    this.sky.scale.setScalar(6000);
    this.sky.turbidity.value = 3.2;
    this.sky.rayleigh.value = 1.4;
    this.sky.mieCoefficient.value = 0.004;
    this.sky.mieDirectionalG.value = 0.82;
    this.sky.cloudCoverage.value = 0; // SkyMesh clouds animate on wall-clock time → disabled (determinism)
    this.sky.cloudSpeed.value = 0;
    this.sky.material.fog = false;
    this.sky.frustumCulled = false;
    // SkyMesh pins depth to 1 (the far plane for standard depth); with our reversed-Z buffer the far
    // plane is 0 — keep the sky just inside it so terrain always occludes it.
    // Preetham radiance is far brighter than our lit terrain; scale it into the same exposure range
    this.sky.material.colorNode = vec4(vec4(this.sky.material.colorNode).rgb.mul(this.skyGain), 1);
    const skyVertex = this.sky.material.vertexNode;
    this.sky.material.vertexNode = Fn(() => {
      const p = vec4(skyVertex).toVar();
      p.z.assign(p.w.mul(1e-7));
      return p;
    })();
    scene.add(this.sky);

    scene.fogNode = fog(this.fogColorNode(), this.fogFactorNode());
  }

  /** Analytic exponential height fog along the view ray + mild distance haze. */
  private fogFactorNode() {
    return Fn(() => {
      const ray = positionWorld.sub(env.cameraPos);
      const d = length(ray);
      const yc = env.cameraPos.y;
      const yp = positionWorld.y;
      const k = env.fogHeightFalloff;
      const dy = yp.sub(yc);
      const ec = exp(k.mul(yc).negate());
      const ep = exp(k.mul(yp).negate());
      const integral = select(abs(dy).greaterThan(1e-3), d.mul(ec.sub(ep)).div(k.mul(dy)), d.mul(ec));
      const total = env.fogHeightDensity.mul(integral).add(env.fogDensity.mul(d));
      return clamp(float(1).sub(exp(total.negate())), 0, 1);
    })();
  }

  private fogColorNode() {
    return Fn(() => {
      const dir = normalize(positionWorld.sub(env.cameraPos));
      const sunAmt = pow(max(dot(dir, env.sunDir), 0), 6).mul(float(1).sub(env.night));
      return mix(env.fogColor, env.sunColor.mul(1.2), sunAmt.mul(0.45));
    })();
  }

  evaluate(frame: FrameContext): void {
    const { state, camera } = frame;
    env.t.value = state.t;
    env.tFx.value = state.tFx;
    env.tod.value = state.tod;
    env.cameraPos.value.copy(camera.position);

    const sunDir = sunDirection(state.tod, state.dayOfYear, env.sunDir.value);
    const dl = daylight(sunDir);
    env.sunColor.value.copy(dl.sunColor);
    env.sunIntensity.value = dl.sunIntensity;
    env.night.value = dl.night;
    env.golden.value = dl.golden;
    env.skyColor.value.copy(dl.skyColor);
    env.groundColor.value.copy(dl.groundColor);
    env.fogColor.value.copy(dl.fogColor);

    moonDirection(state.tod, state.dayOfYear, 0.5, env.moonDir.value);
    const moonUp = Math.max(0, env.moonDir.value.y);
    env.moonIntensity.value = dl.night * Math.min(1, moonUp * 3) * 0.35;

    // lights
    this.sun.color.copy(dl.sunColor);
    this.sun.intensity = dl.sunIntensity;
    this.moon.intensity = env.moonIntensity.value;
    this.moon.position.copy(env.moonDir.value).multiplyScalar(1000);
    this.hemi.color.copy(dl.skyColor);
    this.hemi.groundColor.copy(dl.groundColor);
    this.hemi.intensity = dl.hemiIntensity;
    this.sky.sunPosition.value.copy(sunDir);
    this.sky.showSunDisc.value = 1;

    // view-fitted sun shadow, snapped to shadow texels (no shimmer between frames)
    const [tx, ty, tz] = state.camera.target;
    const focus = _t.set(tx, ty, tz);
    const dist = camera.position.distanceTo(focus);
    const radius = Math.min(1150, Math.max(18, dist * Math.tan((camera.fov * Math.PI) / 360) * 2.4));
    const cam = this.sun.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = 1;
    cam.far = radius * 4 + 600;
    cam.updateProjectionMatrix();
    const texel = (2 * radius) / this.sun.shadow.mapSize.x;
    _m.lookAt(_v.set(0, 0, 0), _v.copy(sunDir).negate(), new Vector3(0, 1, 0));
    const inv = _m.clone().invert();
    focus.applyMatrix4(inv);
    focus.x = Math.round(focus.x / texel) * texel;
    focus.y = Math.round(focus.y / texel) * texel;
    focus.applyMatrix4(_m);
    this.sunTarget.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(sunDir, radius * 2 + 300);
    this.sunTarget.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    this.sun.castShadow = dl.sunIntensity > 0.01;
  }
}
