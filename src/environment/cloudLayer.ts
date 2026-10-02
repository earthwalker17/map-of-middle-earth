import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Vector2 } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import { env } from '../materials/environment.ts';
import { atmosphere, type DeckSample } from '../materials/atmosphere.ts';
import { deckLook } from '../materials/looks.ts';
import type { QualityTier } from '../core/quality.ts';
import type { World } from '../world/World.ts';
import { SLAB } from '../diorama/slabSpec.ts';
import { CLOUD_CAPS, CloudField, DETAIL, PERIOD_X, PERIOD_Z } from './clouds.ts';

type N = TslNode;
const { Fn, abs, attribute, clamp, dot, float, max, mix, normalize, positionWorld, smoothstep, texture, uniform, varying, vec2, vec3, vec4 } = tsl;

const _glow: [number, number, number] = [0, 0, 0];
/** grid cell of the ash-deck mesh (km) and the cover below which a cell is not drawn */
const DECK_CELL_KM = 4;
const DECK_MIN_COVER = 0.02;
/** the deck's mottling repeats this much faster than the cloud field (masses of ~15–40 km) */
const DECK_SCALE = 2.2;
/** the deck drifts slower than the cumulus (a heavy pall) */
const DECK_DRIFT = 0.45;
/** billows (review / final): a second, domain-warped tap this much finer than the masses */
const DECK_BILLOW_SCALE = 3.4;
const DECK_BILLOW = 0.4;
/**
 * The deck's red underglow: radiance per unit of looks.json glow strength. The glow is absolute
 * light (the fires below), so it dominates the dim dusk / night underside and only warms the
 * bright daytime one.
 */
const GLOW_RADIANCE = 0.3;
/** the glow's Gaussian is windowed to 0 between these multiples of its radius */
const GLOW_CUT = [1.4, 2.2] as const;
/** the glow sees the haze's transmittance to this power (it lights the ash around it; < 1 survives the veil) */
const DECK_GLOW_FOG = 0.7;
/**
 * The deck underside's light model, shared by the shader and its CPU mirror (deckUnderside, the
 * overcast dome's colour): transmitted key light and grey sky light (thin → thick cloud), the
 * ground bounce, the mottling's brightness (base + slope · n) and the saturation it keeps (the
 * film's desaturated steel overcast). The mirror evaluates it at the mean thickness / mottling.
 */
const UNDER = { trans: [0.3, 0.1], sky: [0.55, 0.4], skySat: 0.1, gnd: 0.45, nBase: 1.12, nSlope: -0.35, sat: 0.35, meanThick: 0.6, meanN: 0.5 } as const;
/** the sunlit top's brightness on the deck tone (charcoal-brown ash from above, not cream cotton) */
const DECK_TOP_GAIN = 0.5;
/**
 * S4 W4-S2: the deck seen from above shades its masses as a lit volume (review / final: one probe tap
 * DECK_PROBE_KM towards the key light; the slope gain / key elevation sets the billow contrast)
 */
const DECK_VOLUME = true;
const DECK_PROBE_KM = 6;
const DECK_VOLUME_GAIN = 2.4;
/** view elevation (|sin|) below which the underside flattens into the overcast dome colour (no grazing streaks) */
const DECK_GRAZE = [0.02, 0.14] as const;
/** opacity of the deck seen from below at full cover (a little light leaks through the thinnest parts) */
const DECK_UNDER_OPACITY = 0.97;
/** visible cumulus: self-shadow probe distance towards the light (km) */
const CUMULUS_PROBE_KM = 7;
/** opacity of the cumulus seen from above (a veil; the land stays the subject) */
const CUMULUS_TOP_OPACITY = 0.05;
/** soft fade of the cumulus sheet inside the slab edges (km): no cloud ever overhangs the void */
const CUMULUS_EDGE_KM = 25;
/** the cumulus fade out towards their own horizon (view |sin elevation| to the sheet): no hard far edge */
const CUMULUS_GRAZE = [0.03, 0.14] as const;
/** the cumulus fade out with the night (flat sheets read as painted strokes under a moon) */
const CUMULUS_NIGHT_FADE = 1;

/**
 * The environment's visible cloud layers (S4), both in the shared environment material family:
 *  - the ash DECK: an overcast ceiling over the regions with a looks.json `deck` (Mordor, the
 *    Dagorlad) — a static grid mesh over the deck's footprint at the deck height whose vertices
 *    carry the deck field baked on the CPU from the atmosphere's LookField weights (cover, tone,
 *    the red underglow around Mount Doom, the opacity seen from above), mottled by ONE tap of the
 *    cloud field. Seen from below it is a dense grey-steel ceiling lit by the light it lets
 *    through, the sky and the ground bounce, glowing red above Doom at dusk and night; seen from
 *    above it thins to `topOpacity`, relaxed further with the eye height like the haze table, so
 *    overviews still read the plateau and Doom's ember. Transparent, fogged, renderOrder 30
 *    (below the emission sprites, so the Eye and Doom's ember survive it). All tiers.
 *  - visible CUMULUS (quality.clouds.layer: review / final): a sheet over the slab at
 *    env.cloudHeight whose cover is exactly the cloud-shadow field (same uv, wind and coverage —
 *    clouds sit over their shadows), lit by the key light with a one-tap self-shadow towards it
 *    and by the sky, fogged; env.cloudVis fades it out for wide views (overviews stay a clean
 *    model) and atmo2.R keeps it out of the ash deck.
 * Both are pure functions of the env uniforms (camera, tod, tFx, weather): no state.
 */
export class CloudLayer {
  deck: Mesh | null = null;
  cumulus: Mesh | null = null;
  /**
   * Near fade of the deck seen from above (km from the camera, per frame from the shot's focus
   * distance): the pall nearer than the subject thins out so it never veils the foreground.
   */
  private readonly deckNear = uniform(new Vector2(0, 1));

  constructor(
    private readonly world: World,
    private readonly clouds: CloudField,
  ) {}

  /** Build the meshes (after atmosphere.bindWorld, which bakes the deck field). */
  build(quality: QualityTier): Mesh[] {
    const out: Mesh[] = [];
    this.deck = this.buildDeck(quality);
    if (this.deck) out.push(this.deck);
    if (quality.clouds.layer) {
      this.cumulus = this.buildCumulus(quality);
      out.push(this.cumulus);
    }
    return out;
  }

  /**
   * Per frame (after the env uniforms are written): the cumulus sheet rides at env.cloudHeight and
   * is skipped entirely when its gate is closed (whole-table views, a camera under the deck) — a
   * pure function of the frame's uniforms.
   */
  evaluate(focusDist: number): void {
    this.deckNear.value.set(0.35 * focusDist, 0.85 * focusDist);
    if (this.cumulus) {
      this.cumulus.position.y = env.cloudHeight.value;
      this.cumulus.updateMatrixWorld();
      this.cumulus.visible =
        env.cloudVis.value > 1e-3 && env.deck.value < 0.999 && env.cloudCoverage.value > 1e-3 && env.night.value * CUMULUS_NIGHT_FADE < 0.999;
    }
  }

  /** the decks' red underglows (looks.json deck.glow, resolved at build) */
  private readonly glows: { x: number; z: number; r: number; c: [number, number, number] }[] = [];

  /**
   * The underglow radiance on the pall over world (x, z) (before the time-of-day gain env.deckGlow):
   * a Gaussian around each glow place with a windowed tail — the fires light the pall over Doom,
   * not the far night ceiling (Minas Morgul's sky stays cold). CPU; the deck mesh bakes it.
   */
  glowAt(x: number, z: number, out: [number, number, number]): [number, number, number] {
    out[0] = out[1] = out[2] = 0;
    for (const g of this.glows) {
      const q = Math.hypot(x - g.x, z - g.z) / g.r;
      if (q > GLOW_CUT[1]) continue;
      const c = Math.min(1, Math.max(0, (q - GLOW_CUT[0]) / (GLOW_CUT[1] - GLOW_CUT[0])));
      const w = Math.exp(-q * q) * (1 - c * c * (3 - 2 * c));
      out[0] += g.c[0] * w;
      out[1] += g.c[1] * w;
      out[2] += g.c[2] * w;
    }
    return out;
  }

  // ---------------------------------------------------------------- ash deck

  private buildDeck(quality: QualityTier): Mesh | null {
    if (!atmosphere.hasDeck) return null;
    const s: DeckSample = { cover: 0, r: 0, g: 0, b: 0, height: 0, topOpacity: 0 };
    // footprint of the deck (cells with any cover), inside the slab top
    const x0 = SLAB.xMin + 2;
    const z0 = SLAB.zMin + 2;
    const nx = Math.floor((SLAB.xMax - 2 - x0) / DECK_CELL_KM);
    const nz = Math.floor((SLAB.zMax - 2 - z0) / DECK_CELL_KM);
    let i0 = nx;
    let i1 = -1;
    let j0 = nz;
    let j1 = -1;
    for (let j = 0; j <= nz; j++)
      for (let i = 0; i <= nx; i++) {
        atmosphere.deckAt(x0 + i * DECK_CELL_KM, z0 + j * DECK_CELL_KM, s);
        if (s.cover < DECK_MIN_COVER) continue;
        i0 = Math.min(i0, i);
        i1 = Math.max(i1, i);
        j0 = Math.min(j0, j);
        j1 = Math.max(j1, j);
      }
    if (i1 < i0 || j1 < j0) return null;
    i0 = Math.max(0, i0 - 1);
    j0 = Math.max(0, j0 - 1);
    i1 = Math.min(nx, i1 + 1);
    j1 = Math.min(nz, j1 + 1);
    const W = i1 - i0 + 1;
    const H = j1 - j0 + 1;

    // glows of every deck (deduplicated): Gaussian red light under the pall around a place
    const glows = this.glows;
    glows.length = 0;
    const seen = new Set<string>();
    for (const id of this.world.lookRegions) {
      const g = deckLook(id).glow;
      if (!g) continue;
      const key = `${g.place}|${g.radiusKm}|${g.strength}`;
      const p = this.world.places.get(g.place);
      if (!p || seen.has(key)) continue;
      seen.add(key);
      glows.push({ x: p.x, z: p.z, r: g.radiusKm, c: [g.color.r * g.strength * GLOW_RADIANCE, g.color.g * g.strength * GLOW_RADIANCE, g.color.b * g.strength * GLOW_RADIANCE] });
    }

    const pos = new Float32Array(W * H * 3);
    const a = new Float32Array(W * H * 4);
    const b = new Float32Array(W * H * 4);
    const covers = new Float32Array(W * H);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const v = j * W + i;
        const x = x0 + (i0 + i) * DECK_CELL_KM;
        const z = z0 + (j0 + j) * DECK_CELL_KM;
        atmosphere.deckAt(x, z, s);
        pos[v * 3] = x;
        pos[v * 3 + 1] = s.height;
        pos[v * 3 + 2] = z;
        a[v * 4] = s.cover;
        a[v * 4 + 1] = s.r;
        a[v * 4 + 2] = s.g;
        a[v * 4 + 3] = s.b;
        const gl = this.glowAt(x, z, _glow);
        b[v * 4] = gl[0];
        b[v * 4 + 1] = gl[1];
        b[v * 4 + 2] = gl[2];
        b[v * 4 + 3] = s.topOpacity;
        covers[v] = s.cover;
      }
    const idx: number[] = [];
    for (let j = 0; j < H - 1; j++)
      for (let i = 0; i < W - 1; i++) {
        const v = j * W + i;
        // skip cells without any cover (no empty fragments)
        if (Math.max(covers[v], covers[v + 1], covers[v + W], covers[v + W + 1]) < DECK_MIN_COVER) continue;
        idx.push(v, v + W, v + 1, v + 1, v + W, v + W + 1);
      }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('deckA', new BufferAttribute(a, 4));
    geo.setAttribute('deckB', new BufferAttribute(b, 4));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();

    const mat = new MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = DoubleSide;
    mat.forceSinglePass = true; // a flat sheet: one pass, one pipeline (not back then front)
    mat.fog = false; // the shader applies the aerial perspective itself (the glow survives it)
    const shade = this.deckShade(quality.id !== 'preview');
    mat.colorNode = shade.rgb;
    mat.opacityNode = shade.a;
    const mesh = new Mesh(geo, mat);
    mesh.name = 'ash-deck';
    mesh.renderOrder = 30;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  /** The deck's radiance (rgb) and opacity (a). `billows` (review / final) adds the finer, warped tap. */
  private deckShade(billows: boolean): N {
    const tex = this.clouds.texture;
    const near = this.deckNear;
    // preview (S4 W4-S2 perf): the aerial perspective per VERTEX of the 4 km deck grid (T, S varyings,
    // one applySplit) instead of the full haze per fragment of a sheet that can fill the frame; review /
    // final keep it per fragment
    const vFog = billows ? null : atmosphere.applySplit(env.cameraPos, positionWorld, true, true, true, false);
    const vT = vFog ? varying(vFog.T, 'vDeckT') : null;
    const vS = vFog ? varying(vFog.S, 'vDeckS') : null;
    return Fn(() => {
      const P = positionWorld;
      const A = attribute('deckA', 'vec4');
      const B = attribute('deckB', 'vec4');
      const cam = env.cameraPos;
      const cover = A.x;
      const tone = A.yzw;
      const lumW = vec3(0.2126, 0.7152, 0.0722);
      // 1 when the camera is under the deck (its ceiling), 0 above it (its sunlit top)
      const below = smoothstep(-1.5, 1.5, P.y.sub(cam.y));
      // mottling: one tap of the cloud field — R = the equalised masses, G = finer detail
      const q = P.xz.sub(env.wind.mul(env.tFx).mul(DECK_DRIFT));
      const t = texture(tex, vec2(q.x.mul(DECK_SCALE / PERIOD_X), q.y.mul(DECK_SCALE / PERIOD_Z)));
      let n: N = t.r.mul(0.62).add(t.g.mul(0.38));
      if (billows) {
        // billows: a finer tap, its domain warped by the first (roiling, not airbrushed), widening
        // the density range of the pall
        const w = vec2(t.g.sub(0.5), t.r.sub(0.5)).mul(0.06);
        const uv2 = vec2(q.x.mul((DECK_SCALE * DECK_BILLOW_SCALE) / PERIOD_X), q.y.mul((DECK_SCALE * DECK_BILLOW_SCALE) / PERIOD_Z)).add(w).add(vec2(0.31, 0.17));
        const t2 = texture(tex, uv2);
        n = clamp(n.add(t2.r.sub(0.5).mul(DECK_BILLOW)).add(t2.g.sub(0.5).mul(DECK_BILLOW * 0.5)), 0, 1);
      }
      // ragged edges and thin spots: the mottling thresholded by the cover (cover 0.95 → solid)
      const th = float(1).sub(cover);
      const dens = smoothstep(th.sub(0.14), th.add(0.22), n.mul(0.85).add(cover.mul(0.15)));
      const thick = clamp(dens.mul(n.mul(0.7).add(0.5)), 0, 1);

      // light: the key on a horizontal plane, the clear sky above (env.clearSkyColor: irradiance),
      // the ground bounce below
      const eKey = env.keyColor.mul(env.keyIntensity).mul(max(env.keyDir.y, 0));
      const eSky = vec3(env.clearSkyColor);
      const eGnd = env.groundColor.mul(env.hemiIntensity);
      // underside (UNDER, mirrored on the CPU for the dome): what the pall lets through (thin parts
      // glow brighter), the sky light diffused grey through the ash and a little of the ground,
      // desaturated to the film's steel overcast
      const skyGrey = mix(vec3(dot(eSky, lumW)), eSky, UNDER.skySat);
      const trans = mix(float(UNDER.trans[0]), float(UNDER.trans[1]), thick);
      const skyW = mix(float(UNDER.sky[0]), float(UNDER.sky[1]), thick);
      const under0 = tone.mul(eKey.mul(trans).add(skyGrey.mul(skyW)).add(eGnd.mul(UNDER.gnd))).mul(n.mul(UNDER.nSlope).add(UNDER.nBase));
      const underM = mix(vec3(dot(under0, lumW)), under0, UNDER.sat);
      // grazing views flatten into the overcast dome's colour: no stretched streaks towards the horizon
      const camDist = max(P.sub(cam).length(), 1e-3);
      const vSin = abs(P.y.sub(cam.y)).div(camDist);
      const under = mix(vec3(env.deckSky), underM, smoothstep(DECK_GRAZE[0], DECK_GRAZE[1], vSin));
      // the fires below light the underside (thicker cloud scatters more of it back)
      const glow = B.xyz.mul(env.deckGlow).mul(thick.mul(0.5).add(0.6));
      // top: sunlit charcoal-brown ash with a faint key rim where it thins
      const rim = float(1).sub(dens).mul(0.4).add(0.6);
      // (S4 W4-S2) a cloud-volume read from above: the masses shaded as a height field lit by the key —
      // review / final probe the masses DECK_PROBE_KM towards the light (billows rising to the sun lit,
      // their lee in shade); the sky light is weaker in the troughs between them (darker billows)
      let keyTop: N = n.mul(0.45).add(0.55);
      if (billows && DECK_VOLUME) {
        const L = env.keyDir;
        const lxz = normalize(vec2(L.x, L.z).add(vec2(1e-4, 0)));
        const qL = q.add(lxz.mul(DECK_PROBE_KM));
        const tL = texture(tex, vec2(qL.x.mul(DECK_SCALE / PERIOD_X), qL.y.mul(DECK_SCALE / PERIOD_Z)));
        const nL = tL.r.mul(0.62).add(tL.g.mul(0.38));
        // the slope towards the light (the base tap's masses, before the billows), steeper with a low sun
        const rise = t.r.mul(0.62).add(t.g.mul(0.38)).sub(nL).mul(float(DECK_VOLUME_GAIN).div(max(L.y, 0.2)));
        keyTop = clamp(rise.add(0.62).add(n.sub(0.5).mul(0.4)), 0.12, 1.35);
      }
      const skyTop = n.mul(0.5).add(0.6);
      const top0 = tone.mul(DECK_TOP_GAIN).mul(eKey.mul(keyTop).mul(rim).add(eSky.mul(0.55).mul(skyTop)));
      const top = mix(vec3(dot(top0, lumW)), top0, UNDER.sat);
      const surf = mix(top, under, below);
      // fogged here (the material has fog off) so the fires' glow takes only part of the veil
      const em = mix(glow.mul(0.25), glow, below);
      const col =
        vT && vS
          ? surf.mul(vT).add(vS).add(em.mul(vT.pow(DECK_GLOW_FOG)))
          : atmosphere.apply(surf, env.cameraPos, P, true, false, true, em, DECK_GLOW_FOG, billows);
      // opacity: dense from below; from above the authored top opacity, relaxed for high eyes so
      // the whole-table views read the plateau and Doom's ember through a trace of the pall, and
      // faded nearer than the subject (the pall never veils the foreground)
      const table = float(1).sub(smoothstep(250, 1000, cam.y).mul(0.94));
      const nearFade = smoothstep(near.x, near.y, camDist);
      // from above the pall breaks into masses with the plateau between them
      // (S4 W4-S2: denser masses — 0.12 → 0.6 read as a translucent smoke smear from above)
      const aAbove = smoothstep(th.add(0.06), th.add(0.42), n).mul(dens).mul(B.w).mul(table).mul(nearFade);
      const aBelow = dens.mul(DECK_UNDER_OPACITY);
      return vec4(col, clamp(mix(aAbove, aBelow, below), 0, 1));
    })();
  }

  // ---------------------------------------------------------------- visible cumulus

  private buildCumulus(quality: QualityTier): Mesh {
    const geo = new PlaneGeometry(SLAB.xMax - SLAB.xMin, SLAB.zMax - SLAB.zMin, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate((SLAB.xMin + SLAB.xMax) / 2, 0, (SLAB.zMin + SLAB.zMax) / 2);
    const mat = new MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = DoubleSide;
    mat.forceSinglePass = true; // a flat sheet: one pass, one pipeline
    const shade = this.cumulusShade(quality.id === 'final');
    mat.colorNode = shade.rgb;
    mat.opacityNode = shade.a;
    const mesh = new Mesh(geo, mat);
    mesh.name = 'cumulus';
    mesh.renderOrder = 31;
    mesh.frustumCulled = false;
    mesh.position.y = env.cloudHeight.value;
    return mesh;
  }

  private cumulusShade(detail: boolean): N {
    const tex = this.clouds.texture;
    return Fn(() => {
      const P = positionWorld;
      const cam = env.cameraPos;
      // the cloud-shadow field at its own deck (CloudField.cover with the ray length 0)
      const q = P.xz.sub(env.wind.mul(env.tFx));
      const uv = vec2(q.x.div(PERIOD_X), q.y.div(PERIOD_Z));
      const m = texture(tex, uv);
      const dv = texture(tex, uv.mul(DETAIL).add(vec2(0.37, 0.61))).g.sub(0.5);
      const v = m.r.add(dv.mul(detail ? 0.16 : 0.12));
      const c = env.cloudCoverage;
      const f2 = atmosphere.field2(P.xz);
      const cl = clamp(c.mul(m.b.mul(1.3).add(0.35)).add(f2.a.mul(CLOUD_CAPS)), 0, 1);
      const th = float(1).sub(cl);
      // a little crisper than the shadow's wide penumbra: the cloud body over its soft shadow
      const dens = smoothstep(th.sub(0.02), th.add(0.13), v).mul(clamp(c.mul(40), 0, 1));
      // self-shadow: denser cloud towards the light shades this point (one tap, main field)
      const L = env.keyDir;
      const lxz = normalize(vec2(L.x, L.z).add(vec2(1e-4, 0)));
      const v2 = texture(tex, uv.add(vec2(lxz.x.mul(CUMULUS_PROBE_KM / PERIOD_X), lxz.y.mul(CUMULUS_PROBE_KM / PERIOD_Z)))).r;
      const lit = clamp(float(1).sub(v2.sub(m.r).mul(4)), 0.25, 1);
      const body = smoothstep(th, th.add(0.3), v);

      const eKey = env.keyColor.mul(env.keyIntensity).mul(max(L.y, 0.05));
      const eSky = vec3(env.clearSkyColor);
      const eGnd = env.groundColor.mul(env.hemiIntensity);
      const albedo = vec3(0.86, 0.87, 0.88);
      const top = albedo.mul(eKey.mul(lit.mul(0.75).add(0.25)).add(eSky.mul(0.75)));
      // underside: grey in the body, brighter at the thin edges (light through them; no bright
      // rims under a moon — moonlit cloud is dim grey)
      const rimK = float(1).sub(body).mul(0.45).mul(float(1).sub(env.night)).add(0.06);
      const under = albedo.mul(eSky.mul(0.55).add(eGnd.mul(0.6)).add(eKey.mul(rimK)));
      const below = smoothstep(-0.5, 0.5, P.y.sub(cam.y));
      const col = mix(top, under, below);
      // seen from above the cumulus are a faint veil over their shadows (the land stays the
      // subject: no cotton wool over the model), and the nearest ones fade out of the lens
      const camDist = max(P.sub(cam).length(), 1e-3);
      const fromAbove = mix(float(CUMULUS_TOP_OPACITY).mul(smoothstep(25, 110, camDist)), float(1), below);
      // towards the sheet's own horizon the flat layer fades (no hard far edge, no streaks)
      const graze = smoothstep(CUMULUS_GRAZE[0], CUMULUS_GRAZE[1], abs(P.y.sub(cam.y)).div(camDist));
      const nightFade = float(1).sub(env.night.mul(CUMULUS_NIGHT_FADE));

      // no cloud over the void (soft inside the slab edges), none inside the ash deck, none
      // edge-on (the sheet has no thickness), and env.cloudVis for the framing
      const ex = smoothstep(0, CUMULUS_EDGE_KM, P.x.sub(SLAB.xMin)).mul(smoothstep(0, CUMULUS_EDGE_KM, float(SLAB.xMax).sub(P.x)));
      const ez = smoothstep(0, CUMULUS_EDGE_KM, P.z.sub(SLAB.zMin)).mul(smoothstep(0, CUMULUS_EDGE_KM, float(SLAB.zMax).sub(P.z)));
      const noDeck = float(1).sub(smoothstep(0.02, 0.2, f2.r));
      const edgeOn = smoothstep(0.4, 3, abs(P.y.sub(cam.y)));
      // (a camera under the ash deck sees none: the pall hides the sky beyond)
      const a = dens.mul(0.9).mul(ex).mul(ez).mul(noDeck).mul(edgeOn).mul(fromAbove).mul(graze).mul(nightFade).mul(env.cloudVis).mul(float(1).sub(env.deck));
      return vec4(col, a);
    })();
  }
}

/**
 * Underside radiance of an overcast deck of linear tone (r, g, b) — the overcast dome's colour and
 * the haze under the deck: the CPU mirror of the deck shader's underside (UNDER) at the mean
 * thickness and mottling. `sky` and `gnd` are the sky / ground irradiance (colour × intensity).
 */
export function deckUnderside(
  tone: { r: number; g: number; b: number },
  key: { r: number; g: number; b: number },
  keyI: number,
  keyY: number,
  sky: { r: number; g: number; b: number },
  gnd: { r: number; g: number; b: number },
  out: { setRGB(r: number, g: number, b: number): unknown },
): void {
  const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const t = UNDER.meanThick;
  const trans = UNDER.trans[0] + (UNDER.trans[1] - UNDER.trans[0]) * t;
  const skyW = UNDER.sky[0] + (UNDER.sky[1] - UNDER.sky[0]) * t;
  const ls = lum(sky.r, sky.g, sky.b);
  const grey = (c: number) => ls + (c - ls) * UNDER.skySat;
  const k = keyI * Math.max(keyY, 0) * trans;
  const m = UNDER.nBase + UNDER.nSlope * UNDER.meanN;
  const ch = (tc: number, kc: number, sc: number, gc: number) => tc * (kc * k + grey(sc) * skyW + gc * UNDER.gnd) * m;
  const r = ch(tone.r, key.r, sky.r, gnd.r);
  const g = ch(tone.g, key.g, sky.g, gnd.g);
  const b = ch(tone.b, key.b, sky.b, gnd.b);
  const l = lum(r, g, b);
  const sat = (c: number) => l + (c - l) * UNDER.sat;
  out.setRGB(sat(r), sat(g), sat(b));
}
