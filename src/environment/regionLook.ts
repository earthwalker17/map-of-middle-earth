import { Color, Vector3 } from 'three/webgpu';
import type { SceneState } from '../core/types.ts';
import type { World } from '../world/World.ts';
import { atmoLook, deckLook, DEFAULT_HAZE_RAMP, gradeLook, isLookRegion, sampleRegionWeights, type AtmoLook, type DeckLook, type GradeLook, type GradeSpot } from '../materials/looks.ts';
import { gradeUniforms } from '../render/PostPipeline.ts';
import { env } from '../materials/environment.ts';

/**
 * The base look every region grade is relative to: the S1 look (saturation 1.12, contrast 1.08)
 * a touch less saturated (away from the toy look; the region grades carry the colour) and a touch
 * more contrast (depth). The near field is clear, so no compensation for haze is needed.
 */
const BASE = { saturation: 1.1, contrast: 1.1, bloomStrength: 0.12, bloomRadius: 0.55, bloomThreshold: 2.2 };
/** Night (moonlit) layer: Purkinje-like desaturated blue-grey, a little lift in exposure (contrast
 * held so the moonlit land reads crisp, not murky). S4: +0.62 → +0.4 stops — the moon key doubled and
 * the hemisphere fill dropped (timeOfDay), so the lift no longer has to carry the night read. */
const NIGHT = { saturation: 0.42, tint: new Color(0.85, 0.95, 1.15), exposure: 0.4, contrast: 1.0, redKeep: 0.75 };
/** How strongly SceneState.lookOverride pulls the grade towards its region. */
const OVERRIDE = 0.85;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lum = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** sample offsets on the unit disk (centre, inner ring of 6, outer ring of 10) with weights */
const DISK: [number, number, number][] = [[0, 0, 3]];
for (let i = 0; i < 6; i++) DISK.push([0.5 * Math.cos((i / 6) * Math.PI * 2), 0.5 * Math.sin((i / 6) * Math.PI * 2), 1]);
for (let i = 0; i < 10; i++) DISK.push([Math.cos(((i + 0.5) / 10) * Math.PI * 2), Math.sin(((i + 0.5) / 10) * Math.PI * 2), 0.6]);

const _t = new Vector3();

/**
 * RegionLook: the per-shot global layer of the two-layer grade (the per-pixel layer is the
 * regional haze in the atmosphere). Every frame, a pure function of SceneState:
 *  - region weights are sampled on the CPU over a disk around the camera target on the ground
 *    (radius grows with the camera distance, so the blend is smooth as the camera travels — no
 *    springs or temporal smoothing, which would be hidden state);
 *  - SceneState.lookOverride pulls the blend strongly towards its region;
 *  - place spots (looks.json grade.spots) blend in by the focus distance to the place;
 *  - wide views (the whole slab in frame) fade to the neutral world grade;
 *  - a moonlit night layer desaturates towards blue-grey;
 * and the result drives the post grade uniforms and the sky dome tint.
 */
export class RegionLook {
  private readonly grades: GradeLook[];
  private readonly atmos: AtmoLook[];
  private readonly decks: DeckLook[];
  /** deck spots (looks.json deck.spots) resolved to world positions */
  private readonly deckSpots: { x: number; z: number; r: number; cover: number }[] = [];
  /**
   * The focus-blended ash deck (S4; wide views fade it like the grade): cover 0..1, tone (linear),
   * base height, key shadow — what the dome, the hemisphere and the key light read this frame.
   */
  readonly deck = { cover: 0, tone: new Color(0.25, 0.25, 0.25), height: 40, shadow: 0 };
  /** the focus-blended regional in-scatter tint (atmo.tint; the dome's horizon) */
  readonly horizonTint = new Color(1, 1, 1);
  /** the focus-blended haze distance ramp (atmo.ramp; env.hazeRamp) */
  readonly ramp: [number, number, number, number] = [...DEFAULT_HAZE_RAMP];
  /** place-based grade spots of every region, resolved to world positions */
  private readonly spots: { x: number; z: number; r: number; grade: GradeSpot['grade'] }[] = [];
  private readonly w: Float32Array;
  private readonly acc: Float32Array;
  /** last blended region weights (diagnostics) */
  readonly weights: Float32Array;

  constructor(private readonly world: World) {
    const ids = world.lookRegions;
    this.grades = ids.map((id) => gradeLook(id));
    this.atmos = ids.map((id) => atmoLook(id));
    this.decks = ids.map((id) => deckLook(id));
    for (const d of this.decks)
      for (const s of d.spots) {
        const p = world.places.get(s.place);
        if (p) this.deckSpots.push({ x: p.x, z: p.z, r: s.radiusKm, cover: s.cover });
      }
    for (const g of this.grades)
      for (const s of g.spots) {
        const p = world.places.get(s.place);
        if (p) this.spots.push({ x: p.x, z: p.z, r: s.radiusKm, grade: s.grade });
      }
    this.w = new Float32Array(ids.length);
    this.acc = new Float32Array(ids.length);
    this.weights = new Float32Array(ids.length);
  }

  evaluate(state: SceneState, cameraPos: Vector3, night: number): void {
    const n = this.world.lookRegions.length;
    const [tx, , tz] = state.camera.target;
    const dist = cameraPos.distanceTo(_t.set(tx, state.camera.target[1], tz));
    // ---- spatial blend around the focus
    const r = Math.min(180, Math.max(8, dist * 0.25));
    const acc = this.acc.fill(0);
    let tot = 0;
    for (const [dx, dz, wt] of DISK) {
      sampleRegionWeights(this.world, tx + dx * r, tz + dz * r, this.w);
      let s = 0;
      for (let k = 0; k < n; k++) s += this.w[k];
      if (s <= 0) continue; // off the map
      for (let k = 0; k < n; k++) acc[k] += this.w[k] * wt;
      tot += wt;
    }
    if (tot > 0) for (let k = 0; k < n; k++) acc[k] /= tot;
    // ---- look override
    const ov = isLookRegion(state.lookOverride) ? this.world.lookRegions.indexOf(state.lookOverride) : -1;
    if (ov >= 0) for (let k = 0; k < n; k++) acc[k] = acc[k] * (1 - OVERRIDE) + (k === ov ? OVERRIDE : 0);
    // ---- wide views fade to the neutral world grade
    const regional = 1 - smooth(650, 1600, dist);
    let sum = 0;
    for (let k = 0; k < n; k++) {
      acc[k] *= regional;
      sum += acc[k];
    }
    this.weights.set(acc);
    const neutral = Math.max(0, 1 - sum);

    // ---- blend the region grades (neutral = identity)
    let sat = neutral;
    let con = neutral;
    let expo = 0;
    let red = 0;
    let bloom = 0;
    const tint = new Color(neutral, neutral, neutral);
    const lift = [0, 0, 0];
    const sky = new Color(neutral, neutral, neutral);
    for (let k = 0; k < n; k++) {
      const a = acc[k];
      if (a <= 1e-5) continue;
      const g = this.grades[k];
      const L = lum(g.tint) || 1;
      tint.r += (a * g.tint.r) / L;
      tint.g += (a * g.tint.g) / L;
      tint.b += (a * g.tint.b) / L;
      sat += a * g.saturation;
      con += a * g.contrast;
      expo += a * g.exposure;
      red += a * g.redKeep;
      bloom += a * g.bloom;
      for (let c = 0; c < 3; c++) lift[c] += a * g.lift[c];
      const s = this.atmos[k].sky;
      sky.r += a * s.r;
      sky.g += a * s.g;
      sky.b += a * s.b;
    }

    // ---- the ash deck, the horizon tint and the haze ramp around the focus (S4)
    let dc = 0;
    let dh = 0;
    let ds = 0;
    let dr = 0;
    let dg = 0;
    let db = 0;
    const ht = [neutral, neutral, neutral];
    const ramp = DEFAULT_HAZE_RAMP.map((v) => v * neutral);
    for (let k = 0; k < n; k++) {
      const a = acc[k];
      if (a <= 1e-5) continue;
      const D = this.decks[k];
      const c = a * D.cover;
      dc += c;
      dh += c * D.height;
      ds += c * D.shadow;
      dr += c * D.tone.r;
      dg += c * D.tone.g;
      db += c * D.tone.b;
      const A = this.atmos[k];
      ht[0] += a * A.tint.r;
      ht[1] += a * A.tint.g;
      ht[2] += a * A.tint.b;
      for (let i = 0; i < 4; i++) ramp[i] += a * A.ramp[i];
    }
    const deck = this.deck;
    if (dc > 1e-5) {
      deck.tone.setRGB(dr / dc, dg / dc, db / dc);
      deck.height = dh / dc;
      deck.shadow = ds / dc;
    } else {
      deck.tone.setRGB(0.25, 0.25, 0.25);
      deck.height = 40;
      deck.shadow = 0;
    }
    // deck spots: the cover moves towards the spot's by the focus distance to the place
    for (const sp of this.deckSpots) {
      const q = Math.hypot(tx - sp.x, tz - sp.z) / sp.r;
      const a = Math.exp(-q * q) * regional;
      if (a < 1e-4 || dc <= 1e-5) continue;
      dc += (sp.cover - dc) * a;
    }
    deck.cover = Math.min(1, dc);
    this.horizonTint.setRGB(ht[0], ht[1], ht[2]);
    for (let i = 0; i < 4; i++) this.ramp[i] = ramp[i];

    // ---- place spots (Gaussian in the focus distance to the place; wide views fade them too)
    for (const sp of this.spots) {
      const q = Math.hypot(tx - sp.x, tz - sp.z) / sp.r;
      const a = Math.exp(-q * q) * regional;
      if (a < 1e-4) continue;
      const g = sp.grade;
      const L = lum(g.tint) || 1;
      const mixTo = (v: number, to: number) => v + (to - v) * a;
      tint.r = mixTo(tint.r, g.tint.r / L);
      tint.g = mixTo(tint.g, g.tint.g / L);
      tint.b = mixTo(tint.b, g.tint.b / L);
      sat = mixTo(sat, g.saturation);
      con = mixTo(con, g.contrast);
      expo = mixTo(expo, g.exposure);
      red = mixTo(red, g.redKeep);
      bloom = mixTo(bloom, g.bloom);
      for (let c = 0; c < 3; c++) lift[c] = mixTo(lift[c], g.lift[c]);
    }

    // ---- moonlit night layer
    const nn = night;
    sat *= 1 + (NIGHT.saturation - 1) * nn;
    con *= 1 + (NIGHT.contrast - 1) * nn;
    expo += NIGHT.exposure * nn;
    red = Math.max(red, NIGHT.redKeep * nn);
    tint.r *= 1 + (NIGHT.tint.r - 1) * nn;
    tint.g *= 1 + (NIGHT.tint.g - 1) * nn;
    tint.b *= 1 + (NIGHT.tint.b - 1) * nn;

    const g = gradeUniforms;
    g.saturation.value = BASE.saturation * sat;
    g.contrast.value = BASE.contrast * con;
    g.exposureBias.value = Math.pow(2, expo);
    g.tint.value.set(tint.r, tint.g, tint.b);
    g.lift.value.set(lift[0], lift[1], lift[2]);
    g.redKeep.value = red;
    // lights keep their colour through the night / blue-hour desaturation (0 by day)
    g.glowKeep.value = 0.9 * Math.max(night, env.twilight.value);
    g.bloomStrength.value = BASE.bloomStrength + 0.16 * bloom;
    g.bloomRadius.value = BASE.bloomRadius + 0.2 * bloom;
    g.bloomThreshold.value = BASE.bloomThreshold - 1.4 * bloom;
    env.skyTint.value.copy(sky);
  }
}
