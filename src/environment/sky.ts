import { BackSide, Color, Matrix3, Matrix4, Mesh, MeshBasicNodeMaterial, SphereGeometry, Vector3 } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import { env } from '../materials/environment.ts';
import { celestialPole, type Daylight } from './timeOfDay.ts';

type N = TslNode;

const {
  Fn,
  If,
  acos,
  cameraPosition,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  mx_noise_float,
  normalize,
  positionWorld,
  pow,
  sin,
  smoothstep,
  sqrt,
  step,
  uniform,
  vec2,
  vec3,
  vec4,
} = tsl;

// Preetham constants (three.js Sky / SkyMesh)
const TOTAL_RAYLEIGH = new Vector3(5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5);
const MIE_CONST = new Vector3(1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14);
const CUTOFF = 1.6110731556870734;
const STEEPNESS = 1.5;
const EE = 1000;

/** angular radii (radians) — both a little larger than life, as a film would frame them */
const SUN_RADIUS = 0.0082;
const MOON_RADIUS = 0.0118;

const _pole = new Vector3();

/** Reinhard-style shoulder on luminance, hue-preserving: c / (1 + L / lmax). */
function compress(c: N, lmax: number): N {
  return c.div(float(1).add(dot(c, vec3(0.2126, 0.7152, 0.0722)).div(lmax)));
}
const _m4 = new Matrix4();

/**
 * Analytic sky: Preetham daylight (ported so it can be evaluated anywhere, e.g. for fog) + a
 * parametric twilight/night layer (blue hour, afterglow, Belt of Venus) + stars, moon and sun disc
 * on the dome, and a dark atmospheric void below the horizon for the floating diorama.
 * Every input is a uniform written from SceneState — no wall-clock time anywhere.
 */
export class SkyModel {
  readonly u = {
    betaR: uniform(new Vector3()),
    betaM: uniform(new Vector3()),
    sunE: uniform(0),
    mieG: uniform(0.78),
    gain: uniform(0.12),
    dayWeight: uniform(1),
    twiZenith: uniform(new Color()),
    twiHorizon: uniform(new Color()),
    twiGlow: uniform(new Color()),
    twiBelt: uniform(new Color()),
    glowPower: uniform(3),
    glowHeight: uniform(0.12),
    /** moonlit sky brightening */
    moonSky: uniform(new Color()),
    /** depth (in −sin elevation) at which the haze band has fully become the void */
    voidFalloff: uniform(0.34),
    stars: uniform(0),
    starMatrix: uniform(new Matrix3()),
    sunDisc: uniform(30),
    sunAureole: uniform(1),
    /** wide warm glow around a low sun */
    sunGlow: uniform(0.1),
    moonDisc: uniform(2),
    moonGlow: uniform(0.3),
  };

  turbidity = 3;
  rayleigh = 1.25;
  mieCoefficient = 0.0045;

  /** Update the uniforms from the daylight model (CPU, once per evaluate). */
  update(dl: Daylight, sunDir: Vector3, siderealRad: number, moonSky: number): void {
    const u = this.u;
    const zen = Math.acos(Math.min(1, Math.max(-1, sunDir.y)));
    u.sunE.value = EE * Math.max(0, 1 - Math.exp(-(CUTOFF - zen) / STEEPNESS));
    this.turbidity = dl.turbidity;
    u.betaR.value.copy(TOTAL_RAYLEIGH).multiplyScalar(this.rayleigh);
    u.betaM.value.copy(MIE_CONST).multiplyScalar(0.434 * 0.2 * this.turbidity * 1e-17 * this.mieCoefficient);
    u.gain.value = dl.skyGain;
    u.dayWeight.value = dl.dayWeight;
    u.twiZenith.value.copy(dl.twiZenith);
    u.twiHorizon.value.copy(dl.twiHorizon);
    u.twiGlow.value.copy(dl.twiGlow);
    u.twiBelt.value.copy(dl.twiBelt);
    u.glowPower.value = dl.glowPower;
    u.glowHeight.value = dl.glowHeight;
    u.moonSky.value.setRGB(0.0045, 0.0075, 0.016).multiplyScalar(moonSky);
    u.stars.value = dl.stars * (1 - 0.55 * moonSky);
    u.sunDisc.value = dl.sunDisc;
    u.sunAureole.value = dl.dayWeight;
    u.sunGlow.value = (0.08 + 0.4 * dl.golden) * dl.dayWeight;
    u.moonDisc.value = 0.3 + 0.62 * dl.night;
    u.moonGlow.value = 0.15 + 0.85 * dl.night;
    // stars turn about the celestial pole once per sidereal day
    celestialPole(_pole);
    _m4.makeRotationAxis(_pole, -siderealRad);
    u.starMatrix.value.setFromMatrix4(_m4);
  }

  /**
   * CPU mirror of `horizon()` averaged over 16 azimuths — the one haze colour exported as
   * env.fogColor / env.horizonColor for systems that need a single value (call after update()).
   */
  horizonAverage(sunDir: Vector3, out: Color): Color {
    const u = this.u;
    const bR = u.betaR.value;
    const bM = u.betaM.value;
    const g = u.mieG.value;
    const sunE = u.sunE.value;
    const lum = (r: number, gg: number, b: number) => 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    // horizon optical length (zenith angle 90°)
    const inv = 1 / (Math.cos(Math.PI / 2) + 0.15 * Math.pow(93.885 - 90, -1.253));
    const Fex = [0, 1, 2].map((i) => Math.exp(-([bR.x, bR.y, bR.z][i] * inv * 8400 + [bM.x, bM.y, bM.z][i] * inv * 1250)));
    const sh = Math.hypot(sunDir.x, sunDir.z) || 1;
    const shx = sunDir.x / sh;
    const shz = sunDir.z / sh;
    const mixF = Math.min(1, Math.max(0, Math.pow(Math.max(0, 1 - sunDir.y), 5)));
    let ar = 0;
    let ag = 0;
    let ab = 0;
    const N = 16;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const cosTheta = dx * sunDir.x + dz * sunDir.z;
      const c = cosTheta * 0.5 + 0.5;
      const rPhase = 0.05968310365946075 * (1 + c * c);
      const mPhase = (0.07957747154594767 * (1 - g * g)) / Math.pow(1 - 2 * g * cosTheta + g * g, 1.5);
      const day = [0, 1, 2].map((i) => {
        const br = [bR.x, bR.y, bR.z][i];
        const bm = [bM.x, bM.y, bM.z][i];
        const ratio = (br * rPhase + bm * mPhase) / (br + bm);
        let lin = Math.pow(Math.max(0, sunE * ratio * (1 - Fex[i])), 1.5);
        lin *= 1 + (Math.sqrt(Math.max(0, sunE * ratio * Fex[i])) - 1) * mixF;
        return ((lin + Fex[i] * 0.1) * 0.04 + [0, 0.0003, 0.00075][i]) * u.gain.value * u.dayWeight.value;
      });
      const cosAz = Math.max(-1, Math.min(1, dx * shx + dz * shz));
      const anti = Math.max(0, -cosAz);
      const beltW = Math.exp(-((0.075 / 0.055) ** 2)) * (anti * 0.7 + 0.3);
      const shadow = 1 - anti * 0.35 * (u.twiBelt.value.r > 0.0001 ? 1 : 0);
      const glowW = Math.pow(Math.max(0, Math.min(1, cosAz * 0.5 + 0.5)), u.glowPower.value);
      const tw = (ch: 'r' | 'g' | 'b') => u.twiHorizon.value[ch] * shadow + u.twiBelt.value[ch] * beltW + u.twiGlow.value[ch] * glowW;
      let r = day[0] + tw('r') + u.moonSky.value.r;
      let gg = day[1] + tw('g') + u.moonSky.value.g;
      let b = day[2] + tw('b') + u.moonSky.value.b;
      let k1 = 1 / (1 + lum(r, gg, b) / 1.6);
      r *= k1;
      gg *= k1;
      b *= k1;
      k1 = 1 / (1 + lum(r, gg, b) / 0.7);
      ar += r * k1;
      ag += gg * k1;
      ab += b * k1;
    }
    return out.setRGB(ar / N, ag / N, ab / N);
  }

  // ---------------------------------------------------------------- shader functions

  /** Preetham daylight radiance for a direction at or above the horizon (unscaled). */
  readonly preetham = Fn(([dir]: [N]) => {
    const u = this.u;
    const sunDir = env.sunDir;
    const zenithAngle = acos(clamp(dir.y, 0, 1));
    const inv = float(1).div(cos(zenithAngle).add(float(0.15).mul(pow(float(93.885).sub(zenithAngle.mul(57.29577951)), -1.253))));
    const Fex = exp(u.betaR.mul(inv.mul(8400)).add(u.betaM.mul(inv.mul(1250))).negate());
    const cosTheta = dot(dir, sunDir);
    const c = cosTheta.mul(0.5).add(0.5);
    const rPhase = float(0.05968310365946075).mul(float(1).add(c.mul(c)));
    const g = u.mieG;
    const g2 = g.mul(g);
    const mPhase = float(0.07957747154594767).mul(float(1).sub(g2)).div(pow(float(1).sub(g.mul(2).mul(cosTheta)).add(g2), 1.5));
    const ratio = u.betaR.mul(rPhase).add(u.betaM.mul(mPhase)).div(u.betaR.add(u.betaM));
    const Lin = pow(max(u.sunE.mul(ratio).mul(float(1).sub(Fex)), vec3(0)), vec3(1.5)).toVar();
    Lin.mulAssign(mix(vec3(1), pow(max(u.sunE.mul(ratio).mul(Fex), vec3(0)), vec3(0.5)), clamp(pow(clamp(float(1).sub(sunDir.y), 0, 2), 5), 0, 1)));
    return Lin.add(Fex.mul(0.1)).mul(0.04).add(vec3(0, 0.0003, 0.00075));
  });

  /** Parametric twilight / night layer: horizon→zenith gradient, afterglow, Belt of Venus. */
  readonly twilight = Fn(([dir]: [N]) => {
    const u = this.u;
    const h = max(dir.y, 0);
    const dh = normalize(vec2(dir.x, dir.z.add(1e-5)));
    const sh = normalize(vec2(env.sunDir.x, env.sunDir.z.add(1e-5)));
    const cosAz = clamp(dot(dh, sh), -1, 1);
    const base = mix(u.twiHorizon, u.twiZenith, smoothstep(0, 1, sqrt(h)));
    const anti = clamp(cosAz.negate(), 0, 1);
    const bh = h.sub(0.075).div(0.055);
    const belt = u.twiBelt.mul(exp(bh.mul(bh).negate())).mul(anti.mul(0.7).add(0.3));
    // the Earth's shadow: bluish band hugging the anti-solar horizon, under the belt
    const shadow = float(1).sub(anti.mul(0.35).mul(float(1).sub(smoothstep(0.0, 0.07, h))).mul(step(0.0001, u.twiBelt.r)));
    const glow = u.twiGlow.mul(pow(clamp(cosAz.mul(0.5).add(0.5), 0, 1), u.glowPower)).mul(exp(h.div(u.glowHeight).negate()));
    return base.mul(shadow).add(belt).add(glow);
  });

  /** Diffuse sky radiance for a direction (below-horizon directions see the horizon). */
  readonly skyBase = Fn(([dirIn]: [N]) => {
    const u = this.u;
    const dir = normalize(vec3(dirIn.x, max(dirIn.y, 0), dirIn.z.add(1e-6)));
    const day = this.preetham(dir).mul(u.gain.mul(u.dayWeight));
    const moonSky = u.moonSky.mul(float(1).sub(dir.y.mul(0.5)));
    // soft highlight shoulder: the Mie peak around a low sun is hundreds of times brighter than
    // the rest of the sky — keep it bright but inside the exposure range
    return compress(day.add(this.twilight(dir)).add(moonSky), 1.6);
  });

  /**
   * Horizon haze colour in the azimuth of `dir` — the fog colour, consistent with the sky (with a
   * lower shoulder: haze towards a low sun glows, it must not white out the land).
   */
  readonly horizon = Fn(([dir]: [N]) => compress(this.skyBase(vec3(dir.x, 0, dir.z)), 0.7));

  private hash33 = Fn(([p]: [N]) => {
    const q = fract(p.mul(vec3(0.1031, 0.103, 0.0973))).toVar();
    q.addAssign(dot(q, q.yxz.add(33.33)));
    return fract(q.xxy.add(q.yxx).mul(q.zyx));
  });

  /** One layer of point stars on a 3D cell lattice (one hash per pixel, no neighbour search). */
  private starLayer(dc: N, scale: number, density: number, gain: number, seed: number): N {
    const p = dc.mul(scale);
    const cell = floor(p);
    const r1 = this.hash33(cell.add(seed));
    const r2 = this.hash33(cell.add(seed + 19.19));
    const sp = cell.add(r1.mul(0.6).add(0.2));
    const d = length(p.sub(sp));
    const px = max(length(fwidth(p)), 1e-5);
    const sigma = max(px.mul(0.5), 0.03);
    const core = exp(d.mul(d).div(sigma.mul(sigma).mul(-2)));
    const energy = float(0.03).div(sigma).pow(2);
    const mag = pow(r2.y, 7);
    const present = step(r2.x, density);
    const tint = mix(vec3(1.0, 0.8, 0.62), vec3(0.74, 0.85, 1.0), r2.z);
    const twinkle = float(1).add(sin(env.tFx.mul(r1.x.mul(4.3).add(1.7)).add(r1.y.mul(40))).mul(0.3));
    return tint.mul(core.mul(energy).mul(mag).mul(present).mul(twinkle).mul(gain));
  }

  /** Stars + a faint Milky Way, in the rotating celestial frame. */
  private starField(dir: N): N {
    const dc = this.u.starMatrix.mul(dir);
    const stars = this.starLayer(dc, 95, 0.85, 9, 0).add(this.starLayer(dc, 230, 0.8, 3.2, 71.3));
    const G = vec3(0.34, 0.25, 0.906);
    const gb = dot(dc, G);
    const band = exp(gb.mul(gb).div(-0.028));
    const clumps = mx_noise_float(dc.mul(4.5)).mul(0.5).add(0.5).mul(mx_noise_float(dc.mul(12)).mul(0.35).add(0.65));
    const rift = smoothstep(0.25, 0.7, mx_noise_float(dc.mul(6.5).add(3.1)));
    const milky = vec3(0.55, 0.6, 0.78).mul(band.mul(clumps).mul(float(1).sub(rift.mul(0.65))).mul(0.0065));
    return stars.add(milky);
  }

  /** Sun disc with limb darkening + aureole; moon disc with phase, maria and glow. */
  private bodies(dir: N): N {
    const u = this.u;
    const h = dir.y;
    // --- sun
    const s = env.sunDir;
    const ts = length(dir.sub(s));
    const rho = ts.div(SUN_RADIUS);
    const aa = fwidth(rho).add(0.02);
    const disc = float(1).sub(smoothstep(float(1).sub(aa), float(1).add(aa), rho));
    const limb = float(1).sub(float(1).sub(sqrt(max(float(1).sub(rho.mul(rho)), 0))).mul(0.55));
    const sunVis = smoothstep(-0.004, 0.014, h);
    const sunCol = env.sunColor.mul(u.sunDisc.mul(limb).mul(disc).mul(sunVis));
    const aureole = env.sunColor
      .mul(exp(ts.div(-0.01)).mul(0.7).mul(u.sunAureole).add(exp(ts.div(-0.05)).mul(u.sunGlow)).add(exp(ts.div(-0.16)).mul(u.sunGlow.mul(0.18))))
      .mul(sunVis);

    // --- moon
    const m = env.moonDir;
    const cosA = dot(dir, m);
    const o = dir.sub(m.mul(cosA));
    const mr = length(o).div(MOON_RADIUS);
    const maa = fwidth(mr).add(0.02);
    const mdisc = float(1).sub(smoothstep(float(1).sub(maa), float(1).add(maa), mr)).mul(step(0, cosA));
    const z = sqrt(max(float(1).sub(mr.mul(mr)), 0));
    const n = o.div(MOON_RADIUS).sub(m.mul(z));
    const lit = smoothstep(-0.07, 0.16, dot(n, env.sunDir));
    const right = normalize(cross(m, vec3(0, 1, 0)).add(vec3(1e-5, 0, 0)));
    const upT = cross(right, m);
    const muv = vec2(dot(o, right), dot(o, upT)).div(MOON_RADIUS);
    const mare = smoothstep(-0.05, 0.4, mx_noise_float(vec3(muv.mul(1.45), 1.7)).add(mx_noise_float(vec3(muv.mul(3.1), 5.3)).mul(0.35)));
    const albedo = float(0.92).sub(mare.mul(0.42)).mul(mx_noise_float(vec3(muv.mul(11), 2.2)).mul(0.07).add(0.95)).mul(mix(0.82, 1, z));
    const moonVis = smoothstep(-0.004, 0.02, h);
    const moonTint = vec3(0.9, 0.93, 1.0);
    const moonCol = moonTint.mul(albedo.mul(lit.add(0.012)).mul(mdisc).mul(u.moonDisc).mul(moonVis));
    const tm = length(dir.sub(m));
    const mglow = moonTint.mul(exp(tm.div(-0.022)).mul(0.22).add(exp(tm.div(-0.17)).mul(0.035))).mul(env.moonIllum.mul(u.moonGlow).mul(moonVis));

    const starMask = float(1).sub(mdisc).mul(smoothstep(0.0, 0.14, h)).mul(u.stars);
    const stars = vec3(0).toVar();
    If(u.stars.greaterThan(0.002).and(h.greaterThan(0)), () => {
      stars.assign(this.starField(dir).mul(starMask));
    });
    return sunCol.add(aureole).add(moonCol).add(mglow).add(stars);
  }

  /** Full dome radiance: sky above, bodies, and the dark void below the horizon. */
  readonly dome = Fn(() => {
    const u = this.u;
    const dir = normalize(positionWorld.sub(cameraPosition));
    const h = dir.y;
    const base = this.skyBase(dir);
    // void: dark, slightly lighter towards the horizon and on the sun side, darkest straight down
    const dh = normalize(vec2(dir.x, dir.z.add(1e-5)));
    const sh = normalize(vec2(env.sunDir.x, env.sunDir.z.add(1e-5)));
    const az = clamp(dot(dh, sh).mul(0.5).add(0.5), 0, 1);
    // the void is faintly lit on the sun's side, most of all just under a low sun
    const nearH = float(1).sub(smoothstep(0.0, 0.12, h.negate()));
    const sunSide = pow(az, 3).mul(0.3).add(1).add(pow(az, 10).mul(nearH).mul(u.sunGlow.mul(6)));
    const down = float(1).sub(smoothstep(0.15, 1.0, h.negate()).mul(0.55));
    const voidCol = env.voidColor.mul(sunSide.mul(down));
    // haze band just below the horizon, fully void by ~12° down (no residual haze in the void)
    const sd = clamp(h.negate().div(u.voidFalloff), 0, 1);
    const t = float(1).sub(pow(float(1).sub(sd), 3));
    // blend in log space: an even, atmospheric falloff from bright haze into the dark void
    const lb = tsl.log(max(base, vec3(1e-6)));
    const lv = tsl.log(max(voidCol, vec3(1e-6)));
    const col = tsl.exp(mix(lb, lv, t)).toVar();
    If(h.greaterThan(-0.02), () => {
      col.addAssign(this.bodies(dir));
    });
    return vec4(col, 1);
  });

  /** Camera-centred sky sphere pinned just inside the (reversed-Z) far plane. */
  createDome(): Mesh {
    const mat = new MeshBasicNodeMaterial();
    mat.side = BackSide;
    mat.depthWrite = false;
    mat.fog = false;
    mat.colorNode = this.dome();
    mat.vertexNode = Fn(() => {
      const p = vec4(tsl.modelViewProjection).toVar();
      // reversed-Z: far plane is 0 — keep the sky just in front of it so everything occludes it
      p.z.assign(p.w.mul(1e-7));
      return p;
    })();
    const mesh = new Mesh(new SphereGeometry(1000, 48, 24), mat);
    mesh.name = 'sky';
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    return mesh;
  }
}

