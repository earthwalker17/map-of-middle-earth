import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { tsl, type TslNode } from '../materials/tsl.ts';
import { env } from '../materials/environment.ts';
import { atmosphere, type DeckSample } from '../materials/atmosphere.ts';
import { deckLook } from '../materials/looks.ts';
import type { QualityTier } from '../core/quality.ts';
import type { World } from '../world/World.ts';
import { SLAB } from '../diorama/slabSpec.ts';
import { CLOUD_CAPS, CloudField, DETAIL, PERIOD_X, PERIOD_Z } from './clouds.ts';

type N = TslNode;
const { Fn, abs, attribute, clamp, float, max, mix, normalize, positionWorld, smoothstep, texture, vec2, vec3, vec4 } = tsl;

/** grid cell of the ash-deck mesh (km) and the cover below which a cell is not drawn */
const DECK_CELL_KM = 4;
const DECK_MIN_COVER = 0.02;
/** the deck's mottling repeats this much faster than the cloud field (masses of ~15–40 km) */
const DECK_SCALE = 2.2;
/** the deck drifts slower than the cumulus (a heavy pall) */
const DECK_DRIFT = 0.45;
/**
 * The deck's red underglow: radiance per unit of looks.json glow strength. The glow is absolute
 * light (the fires below), so it dominates the dim dusk / night underside and only warms the
 * bright daytime one.
 */
const GLOW_RADIANCE = 0.3;
/** the glow sees the haze's transmittance to this power (it lights the ash around it) */
const DECK_GLOW_FOG = 0.35;
/** opacity of the deck seen from below at full cover (a little light leaks through the thinnest parts) */
const DECK_UNDER_OPACITY = 0.97;
/** visible cumulus: self-shadow probe distance towards the light (km) */
const CUMULUS_PROBE_KM = 7;
/** opacity of the cumulus seen from above (a veil; the land stays the subject) */
const CUMULUS_TOP_OPACITY = 0.1;
/** soft fade of the cumulus sheet inside the slab edges (km): no cloud ever overhangs the void */
const CUMULUS_EDGE_KM = 25;

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

  constructor(
    private readonly world: World,
    private readonly clouds: CloudField,
  ) {}

  /** Build the meshes (after atmosphere.bindWorld, which bakes the deck field). */
  build(quality: QualityTier): Mesh[] {
    const out: Mesh[] = [];
    this.deck = this.buildDeck();
    if (this.deck) out.push(this.deck);
    if (quality.clouds.layer) {
      this.cumulus = this.buildCumulus(quality);
      out.push(this.cumulus);
    }
    return out;
  }

  /** Per frame: the cumulus sheet rides at env.cloudHeight. */
  evaluate(): void {
    if (this.cumulus) {
      this.cumulus.position.y = env.cloudHeight.value;
      this.cumulus.updateMatrixWorld();
    }
  }

  // ---------------------------------------------------------------- ash deck

  private buildDeck(): Mesh | null {
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
    const glows: { x: number; z: number; r: number; c: [number, number, number] }[] = [];
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
        let gr = 0;
        let gg = 0;
        let gb = 0;
        for (const g of glows) {
          const q = Math.hypot(x - g.x, z - g.z) / g.r;
          if (q > 3) continue;
          const w = Math.exp(-q * q);
          gr += g.c[0] * w;
          gg += g.c[1] * w;
          gb += g.c[2] * w;
        }
        b[v * 4] = gr;
        b[v * 4 + 1] = gg;
        b[v * 4 + 2] = gb;
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
    mat.fog = false; // the shader applies the aerial perspective itself (the glow survives it)
    const shade = this.deckShade();
    mat.colorNode = shade.rgb;
    mat.opacityNode = shade.a;
    const mesh = new Mesh(geo, mat);
    mesh.name = 'ash-deck';
    mesh.renderOrder = 30;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  /** The deck's radiance (rgb) and opacity (a). */
  private deckShade(): N {
    const tex = this.clouds.texture;
    return Fn(() => {
      const P = positionWorld;
      const A = attribute('deckA', 'vec4');
      const B = attribute('deckB', 'vec4');
      const cam = env.cameraPos;
      const cover = A.x;
      const tone = A.yzw;
      // 1 when the camera is under the deck (its ceiling), 0 above it (its sunlit top)
      const below = smoothstep(-1.5, 1.5, P.y.sub(cam.y));
      // mottling: one tap of the cloud field — R = the equalised masses, G = finer detail
      const q = P.xz.sub(env.wind.mul(env.tFx).mul(DECK_DRIFT));
      const t = texture(tex, vec2(q.x.mul(DECK_SCALE / PERIOD_X), q.y.mul(DECK_SCALE / PERIOD_Z)));
      const n = t.r.mul(0.62).add(t.g.mul(0.38));
      // ragged edges and thin spots: the mottling thresholded by the cover (cover 0.95 → solid)
      const th = float(1).sub(cover);
      const dens = smoothstep(th.sub(0.14), th.add(0.22), n.mul(0.85).add(cover.mul(0.15)));
      const thick = clamp(dens.mul(n.mul(0.7).add(0.5)), 0, 1);

      // light: the key on a horizontal plane, the clear sky above, the ground bounce below
      const eKey = env.keyColor.mul(env.keyIntensity).mul(max(env.keyDir.y, 0));
      const eSky = env.clearSkyColor.mul(env.hemiIntensity);
      const eGnd = env.groundColor.mul(env.hemiIntensity);
      // underside: what the pall lets through (thin parts glow brighter) + a little of the ground
      // (the sky light arrives diffused through the ash: grey, not blue)
      const skyGrey = mix(vec3(eSky.dot(vec3(0.2126, 0.7152, 0.0722))), eSky, 0.1);
      const trans = mix(float(0.3), float(0.1), thick);
      const under = tone.mul(eKey.mul(trans).add(skyGrey.mul(mix(float(0.55), float(0.4), thick))).add(eGnd.mul(0.45)));
      // the fires below light the underside (thicker cloud scatters more of it back)
      const glow = B.xyz.mul(env.deckGlow).mul(thick.mul(0.5).add(0.6));
      // top: sunlit ash cloud with a faint key rim where it thins
      const rim = float(1).sub(dens).mul(0.4).add(0.6);
      const top = tone.mul(1.4).mul(eKey.mul(n.mul(0.45).add(0.55)).mul(rim).add(eSky.mul(0.55)));
      const surf = mix(top, under.mul(n.mul(-0.35).add(1.12)), below);
      // fogged here (the material has fog off) so the fires' glow takes only part of the veil
      const col = atmosphere.apply(surf, env.cameraPos, P, true, false, true, mix(glow.mul(0.25), glow, below), DECK_GLOW_FOG);
      // opacity: dense from below; from above the authored top opacity, relaxed for high eyes so
      // the whole-table views read the plateau and Doom's ember through a trace of the pall
      const table = float(1).sub(smoothstep(250, 1000, cam.y).mul(0.88));
      // from above the pall breaks into masses with the plateau between them
      const aAbove = smoothstep(th.add(0.12), th.add(0.6), n).mul(dens).mul(B.w).mul(table);
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
      const eSky = env.clearSkyColor.mul(env.hemiIntensity);
      const eGnd = env.groundColor.mul(env.hemiIntensity);
      const albedo = vec3(0.86, 0.87, 0.88);
      const top = albedo.mul(eKey.mul(lit.mul(0.75).add(0.25)).add(eSky.mul(0.75)));
      // underside: grey in the body, bright at the thin edges (light through them)
      const under = albedo.mul(eSky.mul(0.55).add(eGnd.mul(0.6)).add(eKey.mul(float(1).sub(body).mul(0.45).add(0.06))));
      const below = smoothstep(-0.5, 0.5, P.y.sub(cam.y));
      const col = mix(top, under, below);
      // seen from above the cumulus are a faint veil over their shadows (the land stays the
      // subject: no cotton wool over the model), and the nearest ones fade out of the lens
      const camDist = P.sub(cam).length();
      const fromAbove = mix(float(CUMULUS_TOP_OPACITY).mul(smoothstep(25, 110, camDist)), float(1), below);

      // no cloud over the void (soft inside the slab edges), none inside the ash deck, none
      // edge-on (the sheet has no thickness), and env.cloudVis for the framing
      const ex = smoothstep(0, CUMULUS_EDGE_KM, P.x.sub(SLAB.xMin)).mul(smoothstep(0, CUMULUS_EDGE_KM, float(SLAB.xMax).sub(P.x)));
      const ez = smoothstep(0, CUMULUS_EDGE_KM, P.z.sub(SLAB.zMin)).mul(smoothstep(0, CUMULUS_EDGE_KM, float(SLAB.zMax).sub(P.z)));
      const noDeck = float(1).sub(smoothstep(0.05, 0.4, f2.r));
      const edgeOn = smoothstep(0.4, 3, abs(P.y.sub(cam.y)));
      // (a camera under the ash deck sees none: the pall hides the sky beyond)
      const a = dens.mul(0.9).mul(ex).mul(ez).mul(noDeck).mul(edgeOn).mul(fromAbove).mul(env.cloudVis).mul(float(1).sub(env.deck));
      return vec4(col, a);
    })();
  }
}

/** Underside radiance of an overcast deck of linear tone (r, g, b) for the dome (CPU mirror of the shader at mean thickness). */
export function deckUnderside(
  tone: { r: number; g: number; b: number },
  key: { r: number; g: number; b: number },
  keyI: number,
  keyY: number,
  sky: { r: number; g: number; b: number },
  gnd: { r: number; g: number; b: number },
  hemiI: number,
  out: { setRGB(r: number, g: number, b: number): unknown },
): void {
  const k = keyI * Math.max(keyY, 0) * 0.22;
  const ch = (t: number, kc: number, s: number, g: number) => t * (kc * k + s * hemiI * 0.52 + g * hemiI * 0.45) * 0.96;
  out.setRGB(ch(tone.r, key.r, sky.r, gnd.r), ch(tone.g, key.g, sky.g, gnd.g), ch(tone.b, key.b, sky.b, gnd.b));
}
