import { Euler, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three/webgpu';
import { hash32, rand } from '../../core/rng.ts';
import { FAMILY, NOISE, aoFloor, familyKey, familyVertex, paintLinear, type FamilyId, type GlowOverride, type MaterialKey } from '../../materials/families.ts';
import { lightExtras, type LightExtras, type LightGate, type LightKind, type LodGeometry, type TreeKind, type V2, type V3 } from '../records.ts';
import { Geo, area2, boxGeo, cross3, face, icoGeo, latheGeo, noise3, packGeometry, prismGeo, sub3, type PackItem } from './geom.ts';

export type { V2, V3 } from '../records.ts';
export type { FamilyId } from '../../materials/families.ts';

/** LOD level: 0 finest … 2 silhouette. */
export type LodLevel = 0 | 1 | 2;

/**
 * Options every geometry primitive takes.
 *
 * Paint: the family preset albedo by default; `color` = ABSOLUTE sRGB paint; `shade` multiplies (0.5–1.6,
 * may lighten; never pushes albedo outside [0.02, 0.85]); `tint` = legacy S1 multiply on the preset.
 */
export interface PartOpts {
  /** position of the part's BASE centre (spheres / rocks / blobs: the centre), local km */
  at?: V3;
  /**
   * rotation in degrees (x, y, z; Euler XYZ) — y is the yaw (counter-clockwise seen from above). Composite
   * and ground-following primitives (`house`, `extrude` with followGround, `wallPath`, `cliff`, `mound`,
   * `stairs`) use the yaw only; x / z are ignored there.
   */
  rot?: V3;
  /** absolute paint, sRGB hex (overrides the family preset) */
  color?: number;
  /** paint multiplier 0.5–1.6 (can lighten; albedo clamped to [0.02, 0.85]) */
  shade?: number;
  /** legacy (S1): multiplies the family preset albedo */
  tint?: number;
  /** surface noise amplitude 0..1 (default: the family's grain) */
  grain?: number;
  /** coarsest LOD still containing the part (default: automatic by size, see `buildLods`) */
  lod?: LodLevel;
  /**
   * Sit on the ground: the part's lowest point goes to the minimum (or mean) ground under its footprint,
   * sunk 0.02 km, and a contact is recorded (seating gate). `at[1]` then becomes an offset above that.
   */
  seat?: boolean | 'min' | 'mean';
  /** glow families only: strength / gate / flicker overrides of the preset */
  glow?: GlowOverride;
}

/** Window lights on a wall rectangle (records only — EmissionSystem draws them). */
export interface WindowOpts {
  /** number of window slots (default: from `density`, else 4) */
  count?: number;
  /** slots per km² of the rectangle (used when `count` is absent) */
  density?: number;
  /** sRGB hex (default warm #e2a452) */
  color?: number;
  kind?: 'window' | 'lamp';
  /** lit fraction 0..1 (default 0.7): unlit slots produce no record */
  on?: number;
  /** light radius, km (default 0.012) */
  size?: number;
  /** relative brightness (default 1) */
  intensity?: number;
}

/** A wall rectangle for `windows`: centre, width (horizontal), height, outward normal (local). */
export interface WindowRect {
  at: V3;
  w: number;
  h: number;
  normal: V3;
}

export interface LightOpts extends LightExtras {
  /** sRGB hex (default #ffb060) */
  color?: number;
  /** relative brightness (default 1) */
  intensity?: number;
  /** physical radius, km (default 0.02) */
  radius?: number;
  kind?: LightKind;
  /** default by kind (records.ts DEFAULT_GATE) */
  gate?: LightGate;
  /** 0..1 */
  flicker?: number;
}

export interface TreeOpts {
  /** crown radius, km (default 0.06) */
  crownKm?: number;
  heightKm?: number;
  /** sRGB hex */
  color?: number;
  yawDeg?: number;
}

export type RoofKind = 'gable' | 'hip' | 'flat' | 'dome' | 'cone' | 'round';

export interface HouseOpts extends PartOpts {
  roof?: RoofKind;
  /** roof pitch in degrees (default 42; ignored by flat / dome) */
  pitch?: number;
  /** eave overhang, km (default 8 % of the smaller side) */
  overhang?: number;
  /** absolute roof paint, sRGB hex */
  roofColor?: number;
  roofShade?: number;
  /** surface noise amplitude of the roof (0..1, default: the roof family's grain) */
  roofGrain?: number;
  /** a ridge cap along the ridge (gable roofs; LOD0): thatch roll, turf or gilded trim */
  ridge?: { fam?: FamilyId; color?: number; size?: number };
  /**
   * crossed gable boards at both gable ends (gable roofs), running up the verges and past the ridge as
   * horns by `horn` km (default 0.25·size·10): `size` = board thickness (default 0.35·overhang + 0.004);
   * LOD0 unless `lod`
   */
  gableBoards?: { fam?: FamilyId; color?: number; size?: number; horn?: number; lod?: LodLevel };
  /** family of the gable-end triangles (default: the walls) */
  gableFam?: FamilyId;
  /** foundation family on slopes (default 'weathered', shaded 0.72) */
  plinthFam?: FamilyId;
  /** absolute foundation paint (e.g. turf, so a steep-slope plinth reads as a terrace bank) */
  plinthColor?: number;
  /** foundation footprint scale vs the walls (default 1.03; > 1 = a terrace ledge round the house) */
  plinthGrow?: number;
  /** how deep the body may dig into the uphill side, in wall heights (default 0.5) */
  dig?: number;
  /**
   * A terrace bank instead of the vertical plinth: a sloped turf skirt from the floor (plus a level
   * `ledge` round the walls, default 0.01 km) down to the ground on the downhill side, `slope` degrees
   * steep (default 50; its run is capped at `maxRun`, default 0.6·min(w, d), so on steeper ground it gets
   * steeper), so a house on a steep flank sits on a shelf instead of a pillar. LOD0 only; at LOD1/2 the
   * ground-following wall column takes the bank's paint (distant towns read as roofs on turf).
   */
  bank?: { fam?: FamilyId; color?: number; shade?: number; slope?: number; ledge?: number; maxRun?: number };
  /** window lights on the long sides */
  windows?: WindowOpts & { sides?: 1 | 2 };
  /** a stone chimney on the roof */
  chimney?: boolean;
}

export type TowerRoof = 'cone' | 'spire' | 'crenel' | 'dome' | 'none';

export interface TowerOpts extends PartOpts {
  /** sides (default 16; ≤ 8 = faceted) */
  sides?: number;
  /** top radius = r·(1 − taper) */
  taper?: number;
  roof?: TowerRoof;
  roofFam?: FamilyId;
  /** roof height, km (cone 1.2·r, spire 3·r, dome r) */
  roofH?: number;
  roofColor?: number;
  /** window lights in rows around the tower */
  windows?: WindowOpts & { rows?: number };
}

export interface CrenelOpts {
  /** merlon width, height and the gap between merlons, km */
  w: number;
  h: number;
  gap: number;
  /** 'box' merlons or 'point' stakes (palisades) */
  shape?: 'box' | 'point';
  /** coarsest LOD keeping them (default 1; palisade stakes: 0) */
  lod?: LodLevel;
  fam?: FamilyId;
  color?: number;
}

export interface WallPathOpts extends PartOpts {
  closed?: boolean;
  crenel?: CrenelOpts;
  /** top thickness = thickness·(1 − batter) */
  batter?: number;
  /** bottom follows the ground under every sample (≤ `step` km apart), top follows the bottom */
  followGround?: boolean;
  /** resample step for followGround, km (default 0.1) */
  step?: number;
  /** per-segment paint jitter (0.1 → shade 0.9–1.1 per segment: weathered timber, patched stone) */
  shadeJitter?: number;
  towers?: { every: number; r: number; h: number; fam?: FamilyId; sides?: number; roof?: TowerRoof; roofFam?: FamilyId; roofColor?: number; color?: number };
}

export interface CliffOpts extends PartOpts {
  /** horizontal depth of the rock body behind the face, km (default 0.6·height) */
  depth?: number;
  /** face roughness 0..1 (default 0.35) */
  rough?: number;
  /** strata banding 0..1 (default 0.3) */
  strata?: number;
  /** top overhang as a fraction of the height (default 0; negative = leans back more) */
  overhang?: number;
  /** bottom follows the ground (default true) */
  followGround?: boolean;
  /**
   * taper both ends down to nothing, sunk below the ground over this arc length, km (default
   * max(0.1, 1.2 × the tallest height), at most a quarter of the path); 0 = keep the ends at full height
   * (then they are closed by fanned caps with per-triangle normals)
   */
  taper?: number;
  /** 0 = fully faceted rock, 1 = smooth normals; default 0.55 (fractured stone) */
  soft?: number;
}

export type ScatterArea =
  | { circle: { at: V2; r: number } }
  | { polygon: V2[] }
  /** a0/a1: compass bearings in degrees (0 = local north −z, 90 = east +x), clockwise from a0 to a1 */
  | { annulus: { at: V2; r0: number; r1: number; a0?: number; a1?: number } };

export interface ScatterOpts {
  /** minimum distance between placed points, km */
  minSpacing?: number;
  /** keep-out circles or polygons */
  avoid?: ({ at: V2; r: number } | V2[])[];
  /** candidate attempts per point (default 30) */
  tries?: number;
}

/** A light recorded by the kit, local km (build.ts converts to a world LightRecord). */
export interface KitLight extends LightExtras {
  at: V3;
  color: number;
  intensity: number;
  radius: number;
  kind: LightKind;
  gate?: LightGate;
  flicker: number;
}

/** A hero tree recorded by the kit, local km. */
export interface KitTree {
  at: V2;
  kind: TreeKind;
  crownKm: number;
  heightKm?: number;
  color?: number;
  yawDeg?: number;
}

/** A seating contact, local km (baseY = lowest point of the seated part; groundY = ground there). */
export interface KitContact {
  x: number;
  z: number;
  baseY: number;
  groundY: number;
  h: number;
}

export interface KitOutput {
  /** LOD0 … LODn (1–3), one merged geometry per material key; `_contactH` still attached (AO bake) */
  lods: LodGeometry[];
  lights: KitLight[];
  trees: KitTree[];
  contacts: KitContact[];
  /** local bounds of LOD0 (null when empty) */
  bbox: { min: V3; max: V3 } | null;
  /** parts per LOD (diagnostics) */
  parts: number[];
}

interface Part {
  key: MaterialKey;
  gen: (detail: number) => Geo;
  detailed: boolean;
  m: Matrix4 | null;
  g0: Geo;
  group: number;
  lod?: LodLevel;
  cap: LodLevel;
  paint: [number, number, number];
  /** paint at LOD >= 1 (a house column taking its terrace bank's paint) */
  paintCoarse?: [number, number, number];
  surf: [number, number, number, number];
  h: number;
  aoMin: number;
}

/** sink of seated parts into the ground, km */
export const SINK = 0.02;
/** segment-count factor per LOD */
export const LOD_DETAIL = [1, 0.5, 0.25] as const;
/** automatic LOD membership: extent ≥ share of the landmark bbox diagonal */
export const LOD_SHARE = { lod2: 0.08, lod1: 0.02 } as const;

const DEG = Math.PI / 180;

/**
 * ProxyKit v2 — the procedural landmark builder (TS kit). Primitives in LOCAL km, collected as parts
 * and merged per material key ('structure' / 'glow') per LOD into indexed geometry with packed family
 * bytes (families.ts). Parts are placed by their BASE centre (spheres/rocks by the centre).
 *
 * Randomness: `k.r()` is the author's stream (own counter, identical to S1); every primitive draws from
 * a separate kit stream keyed by an internal part index, so kit internals never shift author values.
 *
 * LOD: a part's (or a composite's) extent ≥ 8 % of the landmark bbox diagonal → in LOD2 (silhouette)
 * too; ≥ 2 % → LOD1; smaller → LOD0 only (`lod` overrides). A composite (a house, a wall path WITH its
 * towers and crenels, a bridge, an arcade) is ONE group: nested composites join the outermost open group,
 * so a wall's towers are sized and dropped together with the wall. LOD1 / LOD2 regenerate detailed parts
 * with ½ / ¼ of the segments; crenels and steps stop at LOD1.
 *
 * Records (no geometry): `light`, `windows`, `tree` — local km, converted to world records by build.ts.
 */
export class ProxyKit {
  private readonly list: Part[] = [];
  private n = 0;
  private part = 0;
  private readonly kseed: number;
  private groupStack: number[] = [];
  private groups = 0;
  readonly lights: KitLight[] = [];
  readonly trees: KitTree[] = [];
  readonly contacts: KitContact[] = [];

  /**
   * @param groundFn local terrain height at local (x, z) relative to the origin's ground (y = 0),
   *                 after stamps — use `k.ground(x, z)` to sit parts on slopes.
   */
  constructor(
    readonly seed: number,
    private readonly groundFn: (x: number, z: number) => number = () => 0,
  ) {
    this.kseed = hash32(seed, 0x6b697432);
  }

  /** Local terrain height under local (x, z) (after stamps). */
  ground(x: number, z: number): number {
    return this.groundFn(x, z);
  }

  /** The author's uniform [0,1) random stream (stateless per call index; unaffected by kit internals). */
  r(k = 0): number {
    return rand(this.seed, this.n++, k);
  }

  // ---------------------------------------------------------------- internals

  /** kit-internal random for part `p` */
  private q(p: number, k: number): number {
    return rand(this.kseed, p, k);
  }

  private begin(): number {
    return ++this.part;
  }

  private group(): number {
    return this.groupStack.length ? this.groupStack[this.groupStack.length - 1] : ++this.groups;
  }

  /** open a composite group; nested composites (a wall path's towers) join the outermost open group */
  private open(): void {
    this.groupStack.push(this.groupStack.length ? this.groupStack[0] : ++this.groups);
  }

  private close(): void {
    this.groupStack.pop();
  }

  private matrix(at: V3, rot?: V3, scale?: V3): Matrix4 {
    const q = new Quaternion().setFromEuler(new Euler(...((rot ?? [0, 0, 0]).map((d) => d * DEG) as V3)));
    return new Matrix4().compose(new Vector3(...at), q, new Vector3(...(scale ?? [1, 1, 1])));
  }

  /** register a part; `m` = null means `gen` already returns landmark-local geometry */
  private addPart(fam: FamilyId, gen: (detail: number) => Geo, m: Matrix4 | null, o: PartOpts, x: { detailed?: boolean; cap?: LodLevel; h?: number } = {}): Part {
    const g0 = gen(1);
    if (m) g0.transform(m);
    const b = g0.bounds();
    const fv = familyVertex(fam, undefined, 1, undefined, o.glow);
    if (o.grain !== undefined && familyKey(fam) === 'structure') fv.surf[2] = Math.round(Math.min(1, Math.max(0, o.grain)) * 255);
    const p: Part = {
      key: familyKey(fam),
      gen,
      detailed: x.detailed ?? false,
      m,
      g0,
      group: this.group(),
      lod: o.lod,
      cap: x.cap ?? 2,
      paint: paintLinear(fam, o.color, o.shade ?? 1, o.tint),
      surf: fv.surf,
      h: x.h ?? Math.max(1e-3, b.max[1] - b.min[1]),
      aoMin: aoFloor(fam),
    };
    this.list.push(p);
    return p;
  }

  /**
   * S4 W4-S1: tag a roof part (house / tower roofs) with the structure shader's roof class — courses
   * along the slope, dark eaves on its fascia / soffit faces, slate jitter, moss — whatever its family
   * (Lake-town roofs are darkStone, its huts' shingles wood). Thatch keeps its fibre class; smooth families
   * (plaster, gold, metal domes) and glow skins keep theirs. The contact bits stay.
   */
  private tagRoof(part: Part, fam: FamilyId): Part {
    const cls = FAMILY[fam].noise;
    if (part.key === 'structure' && (cls === NOISE.stone || cls === NOISE.wood || cls === NOISE.roof))
      part.surf = [part.surf[0], part.surf[1], part.surf[2], NOISE.roof * 32 + (part.surf[3] % 32)];
    return part;
  }

  /** a roof part: addPart + tagRoof */
  private roofPart(fam: FamilyId, gen: (detail: number) => Geo, m: Matrix4 | null, o: PartOpts, x: { detailed?: boolean; cap?: LodLevel; h?: number } = {}): Part {
    return this.tagRoof(this.addPart(fam, gen, m, o, x), fam);
  }

  /**
   * Footprint samples (x, z) of a geometry, centre LAST: its lowest vertices (≤ 8, spread) or, for a
   * centred part (rock, sphere), a ring at 70 % of its horizontal extent.
   */
  private footprint(g: Geo, centred = false): { pts: V2[]; minY: number; maxY: number } {
    const b = g.bounds();
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;
    const pts: V2[] = [];
    if (centred) {
      const rx = (b.max[0] - b.min[0]) * 0.35;
      const rz = (b.max[2] - b.min[2]) * 0.35;
      for (let k = 0; k < 8; k++) pts.push([cx + Math.cos((k / 8) * Math.PI * 2) * rx, cz + Math.sin((k / 8) * Math.PI * 2) * rz]);
    } else {
      const tol = Math.max(1e-4, (b.max[1] - b.min[1]) * 0.02);
      const low: V2[] = [];
      for (let k = 0; k < g.p.length; k += 3) if (g.p[k + 1] <= b.min[1] + tol) low.push([g.p[k], g.p[k + 2]]);
      const step = Math.max(1, Math.floor(low.length / 8));
      for (let k = 0; k < low.length && pts.length < 8; k += step) pts.push(low[k]);
    }
    pts.push([cx, cz]);
    return { pts, minY: b.min[1], maxY: b.max[1] };
  }

  /** seat height over footprint points: minimum (default) or mean ground, sunk SINK, + offset */
  private seatAt(pts: V2[], mode: PartOpts['seat'], offset: number): { y: number; gs: number[] } {
    const gs = pts.map(([x, z]) => this.ground(x, z));
    const g = mode === 'mean' ? gs.reduce((a, b) => a + b, 0) / gs.length : Math.min(...gs);
    return { y: g - SINK + offset, gs };
  }

  /**
   * Seating contacts of one part (centre = last point): the footprint centre (buried check) and its
   * lowest-ground point (floating check), each with baseY = the bottom of the solid there.
   */
  private contactPair(pts: V2[], gs: number[], baseAt: (k: number) => number, h: number): void {
    const c = pts.length - 1;
    let lo = 0;
    for (let k = 1; k < pts.length; k++) if (gs[k] < gs[lo]) lo = k;
    for (const k of lo === c ? [c] : [c, lo]) this.contacts.push({ x: pts[k][0], z: pts[k][1], baseY: baseAt(k), groundY: gs[k], h });
  }

  /** place a part-space generator by at / rot (+ seating) */
  private place(fam: FamilyId, gen: (detail: number) => Geo, o: PartOpts, x: { detailed?: boolean; cap?: LodLevel; centred?: boolean } = {}): Part {
    const at: V3 = o.at ?? [0, 0, 0];
    let m = this.matrix(at, o.rot);
    if (o.seat) {
      const probe = gen(1).transform(this.matrix([at[0], 0, at[2]], o.rot));
      const fp = this.footprint(probe, x.centred);
      const hgt = fp.maxY - fp.minY;
      let base: number;
      let gs: number[];
      if (x.centred) {
        // a centred part (rock) settles a quarter of its height into the mean ground under it, and at
        // least deep enough that its flank meets the ground on the downhill side (ring at 70 % of its
        // extent: the ellipsoid's lower surface there is 0.143·h above its bottom). Boulders are meant
        // to be partly buried, so only the floating side is recorded.
        gs = fp.pts.map(([px, pz]) => this.ground(px, pz));
        const mode = o.seat === true ? 'mean' : o.seat;
        const gMin = Math.min(...gs);
        const g = mode === 'min' ? gMin : gs.reduce((a, b) => a + b, 0) / gs.length;
        base = Math.min(g - 0.25 * hgt, gMin - 0.143 * hgt - 0.005) + (o.at?.[1] ?? 0);
        const lo = gs.indexOf(gMin);
        this.contacts.push({ x: fp.pts[lo][0], z: fp.pts[lo][1], baseY: base + 0.143 * hgt, groundY: gMin, h: hgt });
      } else {
        const st = this.seatAt(fp.pts, o.seat, o.at?.[1] ?? 0);
        base = st.y;
        gs = st.gs;
        this.contactPair(fp.pts, gs, () => base, hgt);
      }
      m = this.matrix([at[0], base - fp.minY, at[2]], o.rot);
    }
    return this.addPart(fam, gen, m, o, x);
  }

  private segs(seg: number, detail: number, min = 6): number {
    return seg <= 8 ? seg : Math.max(min, Math.round(seg * detail));
  }

  // ---------------------------------------------------------------- v1-compatible primitives

  /** Box w × h × d (x, y, z), base centre at `at`. */
  box(fam: FamilyId, w: number, h: number, d: number, o: PartOpts = {}): this {
    this.begin();
    this.place(fam, () => boxGeo(w, h, d), o);
    return this;
  }

  /**
   * Cylinder / truncated cone, base centre at `at`. Smooth normals like S1/S2 (three's CylinderGeometry)
   * unless `faceted` (default: only `seg` ≤ 5); LOD1/2 halve / quarter `seg` > 8.
   */
  cylinder(fam: FamilyId, rTop: number, rBottom: number, h: number, o: PartOpts & { seg?: number; faceted?: boolean } = {}): this {
    this.begin();
    const seg = o.seg ?? 24;
    const faceted = o.faceted ?? seg <= 5;
    this.place(
      fam,
      (d) =>
        latheGeo(
          [
            [rBottom, 0],
            [rTop, h],
          ],
          { seg: this.segs(seg, d), faceted },
        ),
      o,
      { detailed: seg > 8 },
    );
    return this;
  }

  /**
   * Cone of base radius `r`, base centre at `at` (`seg` 4 + rot 45 = pyramid). Smooth normals like S1/S2
   * unless `faceted` (default: only `seg` ≤ 5).
   */
  cone(fam: FamilyId, r: number, h: number, o: PartOpts & { seg?: number; faceted?: boolean } = {}): this {
    this.begin();
    const seg = o.seg ?? 24;
    const faceted = o.faceted ?? seg <= 5;
    this.place(
      fam,
      (d) =>
        latheGeo(
          [
            [r, 0],
            [0, h],
          ],
          { seg: this.segs(seg, d), faceted },
        ),
      o,
      { detailed: seg > 8 },
    );
    return this;
  }

  /** Smooth sphere of radius `r` CENTRED at `at` (`squash` scales y). */
  sphere(fam: FamilyId, r: number, o: PartOpts & { squash?: number } = {}): this {
    this.begin();
    const sq = o.squash ?? 1;
    this.place(
      fam,
      (d) => {
        const rings = Math.max(4, Math.round(12 * d));
        const prof: V2[] = [];
        for (let k = 0; k <= rings; k++) {
          const t = -Math.PI / 2 + (k / rings) * Math.PI;
          prof.push([Math.cos(t) * r, Math.sin(t) * r * sq]);
        }
        prof[0][0] = 0;
        prof[rings][0] = 0;
        return latheGeo(prof, { seg: Math.max(6, Math.round(20 * d)), faceted: false, crease: 80 });
      },
      o,
      { detailed: true, centred: true },
    );
    return this;
  }

  /**
   * Lumpy rock with smooth normals (indexed icosphere displaced by 3D value noise of the direction — no
   * cracks), CENTRED at `at`. `detail` 0–3 (default 2: 320 tris; LOD1/2 one / two levels coarser).
   * With `seat`, a third of it sinks into the ground.
   *
   * `leafy` (default for the 'foliage' family): a leaf mass instead of a stone — from r ≥ 0.3 km a lumpy
   * core (0.78·r) with 6 smooth sub-crowns bulging from its upper part, so hero crowns read as clumped
   * foliage (like the canopy clusters) rather than a lollipop sphere; 800 tris at LOD0, the core alone
   * (20 tris) at LOD2.
   */
  rock(fam: FamilyId, r: number, o: PartOpts & { squash?: number; lump?: number; detail?: number; leafy?: boolean } = {}): this {
    const p = this.begin();
    const sq = o.squash ?? 1;
    const lump = o.lump ?? 0.22;
    const leafy = o.leafy ?? fam === 'foliage';
    const det = Math.min(3, Math.max(0, Math.round(o.detail ?? 2)));
    const nseed = hash32(this.kseed, p, 77);
    const ox = this.q(p, 1) * 10;
    const lumpy = (level: number, R: number, cx: number, cy: number, cz: number, k: number, amp: number): Geo => {
      const g = icoGeo(level);
      for (let v = 0; v < g.p.length; v += 3) {
        const x = g.p[v];
        const y = g.p[v + 1];
        const z = g.p[v + 2];
        const n = 0.65 * noise3(x * 1.7 + ox + k * 3.1, y * 1.7, z * 1.7, nseed) + 0.35 * noise3(x * 3.6, y * 3.6 + ox, z * 3.6 + k, nseed + 1);
        const s = R * (1 + amp * (2 * n - 1));
        g.p[v] = cx + x * s;
        g.p[v + 1] = (cy + y * s) * sq;
        g.p[v + 2] = cz + z * s;
      }
      return g.smoothNormals();
    };
    const lobes = leafy && r >= 0.3 ? 6 : 0;
    const lobe = Array.from({ length: lobes }, (_, k) => {
      // golden-angle spiral over the upper ~2/3 of the crown
      const t = (k + 0.5) / lobes;
      const cy = 1 - t * 1.35;
      const sy = Math.sqrt(Math.max(0, 1 - cy * cy));
      const ph = k * 2.39996 + ox;
      return { c: [Math.cos(ph) * sy * 0.6 * r, cy * 0.6 * r, Math.sin(ph) * sy * 0.6 * r] as V3, R: 0.42 * r * (0.85 + 0.3 * this.q(p, 10 + k)) };
    });
    this.place(
      fam,
      (d) => {
        const level = Math.max(0, det - (d < 1 ? (d < 0.5 ? 2 : 1) : 0));
        if (!lobes || d < 0.5) return lumpy(level, r, 0, 0, 0, 0, lump);
        const g = lumpy(level, 0.78 * r, 0, 0, 0, 0, lump * 0.7);
        lobe.forEach((lb, k) => g.append(lumpy(Math.max(0, level - 1), lb.R, lb.c[0], lb.c[1], lb.c[2], k + 1, lump * 0.6)));
        return g;
      },
      o,
      { detailed: det > 0, centred: true },
    );
    return this;
  }

  /** Legacy (S1) lumpy blob: now an alias of `rock` (smooth normals, no cracks). */
  blob(fam: FamilyId, r: number, o: PartOpts & { squash?: number; lump?: number } = {}): this {
    return this.rock(fam, r, { ...o, lump: o.lump ?? 0.18 });
  }

  /**
   * Ring wall (full or partial arc) of `radius` (centre line) and `thickness`, base at y = 0. A partial
   * arc starts at +x and runs counter-clockwise seen from above (towards −z, north), as in S1. Flat
   * facets like S1/S2 (an extruded shape: the facet lines read as masonry panels).
   */
  ring(fam: FamilyId, radius: number, thickness: number, h: number, o: PartOpts & { arcDeg?: number; seg?: number } = {}): this {
    this.begin();
    const r0 = radius - thickness / 2;
    const r1 = radius + thickness / 2;
    const seg = o.seg ?? 48;
    this.place(
      fam,
      (d) =>
        latheGeo(
          [
            [r0, 0],
            [r1, 0],
            [r1, h],
            [r0, h],
            [r0, 0],
          ],
          { seg: this.segs(seg, d, 8), arcDeg: o.arcDeg, faceted: true },
        ).transform(new Matrix4().makeScale(1, 1, -1)),
      o,
      { detailed: seg > 8 },
    );
    return this;
  }

  /** Torus lying flat (major radius `radius`, tube radius `tube`), base at y = 0. */
  torus(fam: FamilyId, radius: number, tube: number, o: PartOpts = {}): this {
    this.begin();
    this.place(
      fam,
      (d) => {
        const n = Math.max(6, Math.round(10 * d));
        const prof: V2[] = [];
        for (let k = 0; k <= n; k++) {
          const t = -Math.PI / 2 + (k / n) * Math.PI * 2;
          prof.push([radius + Math.cos(t) * tube, tube + Math.sin(t) * tube]);
        }
        return latheGeo(prof, { seg: Math.max(12, Math.round(48 * d)), crease: 80, caps: false });
      },
      o,
      { detailed: true },
    );
    return this;
  }

  /** Straight wall between two local points (x, z), base at y = 0 (plus `at`). */
  wall(fam: FamilyId, a: V2, b: V2, h: number, thickness: number, o: PartOpts = {}): this {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const yaw = (-Math.atan2(dz, dx) * 180) / Math.PI;
    const at = o.at ?? [0, 0, 0];
    return this.box(fam, len, h, thickness, { ...o, at: [(a[0] + b[0]) / 2 + at[0], at[1], (a[1] + b[1]) / 2 + at[2]], rot: [0, yaw, 0] });
  }

  // ---------------------------------------------------------------- v2 primitives

  /**
   * Surface of revolution around +y from a [radius, y] profile (bottom → top), base at `at`. Profile
   * joints sharper than 35° are hard edges; radius-0 points close to an apex; open ends get flat caps.
   * `seg` ≤ 8 → faceted (LOD1/2: ½ / ¼ of the segments for round shapes).
   */
  lathe(fam: FamilyId, profile: V2[], o: PartOpts & { seg?: number; arcDeg?: number } = {}): this {
    this.begin();
    const seg = o.seg ?? 24;
    this.place(fam, (d) => latheGeo(profile, { seg: this.segs(seg, d), arcDeg: o.arcDeg, faceted: seg <= 8 }), o, { detailed: seg > 8 });
    return this;
  }

  /**
   * An earth mound draped on the terrain (barrows, burial mounds, earthworks): a dome of radius `r` and
   * height `h` whose every vertex rides `h·profile` above the local ground (the rim sinks 0.02), so it
   * never floats or buries on a slope. Smooth normals; LOD1/2 use fewer segments.
   */
  mound(fam: FamilyId, r: number, h: number, o: PartOpts & { seg?: number } = {}): this {
    this.begin();
    const at: V3 = o.at ?? [0, 0, 0];
    const seg = o.seg ?? 16;
    const prof = (t: number) => Math.cos((t * Math.PI) / 2) ** 1.5; // t = ρ / r
    const gen = (d: number): Geo => {
      const g = new Geo();
      const n = Math.max(6, Math.round(seg * d));
      const rings = Math.max(2, Math.round(4 * d));
      const top = g.v(at[0], this.ground(at[0], at[2]) + h + at[1], at[2]);
      let prev: number[] = [];
      for (let k = 1; k <= rings; k++) {
        const t = k / rings;
        const ring: number[] = [];
        for (let j = 0; j < n; j++) {
          const a = (j / n) * Math.PI * 2;
          const x = at[0] + Math.cos(a) * r * t;
          const z = at[2] + Math.sin(a) * r * t;
          ring.push(g.v(x, this.ground(x, z) + h * prof(t) + at[1] - (k === rings ? SINK : 0), z));
        }
        for (let j = 0; j < n; j++) {
          const j1 = (j + 1) % n;
          if (k === 1) g.tri(top, ring[j1], ring[j]);
          else g.quad(prev[j], prev[j1], ring[j1], ring[j]);
        }
        prev = ring;
      }
      return g.smoothNormals();
    };
    const body: PartOpts = { lod: o.lod, color: o.color, shade: o.shade, tint: o.tint };
    this.addPart(fam, gen, null, body, { detailed: true, h });
    const gc = this.ground(at[0], at[2]);
    this.contacts.push({ x: at[0], z: at[2], baseY: gc + at[1] - SINK, groundY: gc, h: h + SINK });
    return this;
  }

  /**
   * Vertical prism over a polygon outline (local x, z around `at`), `height` tall, optional `taper`
   * (top scaled towards the centroid) and `holes`. `followGround`: every outline vertex's bottom drops
   * to the ground there (−0.02), and the flat top sits `height` above the HIGHEST ground under the
   * outline (+ at[1]) — platforms, terraces, plinths. Rotation: yaw only with followGround.
   */
  extrude(fam: FamilyId, outline: V2[], height: number, o: PartOpts & { taper?: number; holes?: V2[][]; followGround?: boolean } = {}): this {
    this.begin();
    const at: V3 = o.at ?? [0, 0, 0];
    if (!o.followGround) {
      this.place(fam, () => prismGeo(outline, height, { taper: o.taper, holes: o.holes }), o);
      return this;
    }
    const yaw = (o.rot?.[1] ?? 0) * DEG;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // three's +yaw rotates x towards −z
    const tr = (q: V2): V2 => [at[0] + q[0] * c + q[1] * s, at[2] - q[0] * s + q[1] * c];
    const ol = outline.map(tr);
    const holes = o.holes?.map((hl) => hl.map(tr));
    const gs = ol.map(([x, z]) => this.ground(x, z));
    const top = Math.max(...gs) + height + at[1];
    const bottom = (x: number, z: number) => this.ground(x, z) - SINK;
    this.addPart(fam, () => prismGeo(ol, top, { taper: o.taper, holes, bottomAt: bottom }), null, o);
    let cx = 0;
    let cz = 0;
    for (const q of ol) {
      cx += q[0] / ol.length;
      cz += q[1] / ol.length;
    }
    const cpts: V2[] = [...ol, [cx, cz]];
    const cgs = [...gs, this.ground(cx, cz)];
    this.contactPair(cpts, cgs, (k) => cgs[k] - SINK, top - Math.min(...gs) + SINK);
    return this;
  }

  /**
   * A house: walls box `w` (local x, the ridge direction) × `d` × `h` with a roof — gable (default),
   * hip, flat, dome, cone (pyramid) or round (barrel) — at `pitch`° with `overhang`. SEATED by default
   * (`seat: false` to place it at `at[1]`): the body stands on the minimum ground under its corners or,
   * on steep ground, is dug in at most `dig` (default 50 %) of its wall height on the uphill side,
   * with a ground-following plinth below the downhill side (`plinthFam` / `plinthColor` — stone, or turf
   * with `plinthGrow` > 1 for a terrace ledge) or, with `bank`, a sloped turf terrace bank. `windows`
   * records window lights on the long sides; `chimney` adds a stone stack. Only the yaw of `rot` is used.
   * Seating contacts: the footprint centre (buried), the lowest corner (floating) and the highest corner
   * (the dug-in uphill side, buried).
   */
  house(walls: FamilyId, roof: FamilyId, w: number, d: number, h: number, o: HouseOpts = {}): this {
    const p = this.begin();
    this.open();
    const at: V3 = o.at ?? [0, 0, 0];
    const yawDeg = o.rot?.[1] ?? 0;
    const yaw = yawDeg * DEG;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const loc = (x: number, z: number): V2 => [at[0] + x * c + z * s, at[2] - x * s + z * c];
    const corners: V2[] = [loc(-w / 2, -d / 2), loc(w / 2, -d / 2), loc(w / 2, d / 2), loc(-w / 2, d / 2)];
    const seat = o.seat ?? true;
    let base = at[1];
    const common: PartOpts = { lod: o.lod };
    if (seat) {
      const gs = corners.map(([x, z]) => this.ground(x, z));
      const gc = this.ground(at[0], at[2]);
      const gMin = Math.min(...gs, gc);
      const gMax = Math.max(...gs, gc);
      base = Math.max(gMin, gMax - (o.dig ?? 0.5) * h) - SINK + at[1];
      if (o.bank && base - (gMin - SINK) > 0.004) this.bankPart(o.bank, loc, w, d, base, common);
      else if (base - (gMin - SINK) > 0.004) {
        // ground-following plinth (every corner reaches into the ground)
        const pf = o.plinthFam ?? 'weathered';
        const grow = o.plinthGrow ?? 1.03;
        const pl: V2[] = [loc((-w / 2) * grow, (-d / 2) * grow), loc((w / 2) * grow, (-d / 2) * grow), loc((w / 2) * grow, (d / 2) * grow), loc((-w / 2) * grow, (d / 2) * grow)];
        const topY = base + SINK;
        // LOD0 only: from LOD1 on the walls themselves reach down to the ground
        const pp: PartOpts = o.plinthColor !== undefined ? { ...common, color: o.plinthColor } : { ...common, shade: 0.72 };
        this.addPart(pf, () => prismGeo(pl, topY, { bottomAt: (x, z) => this.ground(x, z) - SINK }), null, pp, { cap: 0 });
      }
      // the plinth (when there is one) is a ground-following foundation: the solid reaches the ground
      const plinth = base - (gMin - SINK) > 0.004;
      const roofH = this.roofRise(o.roof ?? 'gable', w, d, o);
      const cpts: V2[] = [...corners, [at[0], at[2]]];
      const cgs = [...gs, gc];
      const H = h + roofH + Math.max(0, base - gMin);
      this.contactPair(cpts, cgs, (k) => (plinth ? cgs[k] - SINK : base), H);
      // the dug-in uphill side: the wall bottom under the highest corner (burial gate)
      const hi = gs.indexOf(Math.max(...gs));
      if (gs[hi] > base + SINK + 1e-4) this.contacts.push({ x: corners[hi][0], z: corners[hi][1], baseY: base, groundY: gs[hi], h: H });
    }
    const m = this.matrix([at[0], base, at[2]], [0, yawDeg, 0]);
    const paint: PartOpts = { ...common, color: o.color, shade: o.shade, tint: o.tint };
    const rect: V2[] = [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ];
    // LOD1/2 (seated): one ground-following column of wall instead of plinth + walls
    const column = (): Geo =>
      prismGeo(rect, h, {
        bottomAt: (x, z) => {
          const [lx, lz] = loc(x, z);
          return this.ground(lx, lz) - SINK - base;
        },
        bottom: false,
      });
    const wp = this.addPart(walls, (dd) => (dd < 1 && seat ? column() : boxGeo(w, h, d, false)), m, paint, { detailed: !!seat });
    if (seat && o.bank) wp.paintCoarse = paintLinear(o.bank.fam ?? 'foliage', o.bank.color, o.bank.shade ?? 1);
    this.roof(walls, roof, w, d, h, o, m, common);
    if (o.chimney) {
      const cw = Math.min(w, d) * 0.14;
      const rise = this.roofRise(o.roof ?? 'gable', w, d, o);
      this.addPart('weathered', () => boxGeo(cw, h * 0.2 + rise * 0.95, cw).translate(w * 0.28, h * 0.8, d * 0.12), m, { ...common, shade: 0.8 }, { cap: 0 });
    }
    if (o.windows) {
      const wo = o.windows;
      const sides = wo.sides ?? 2;
      for (let sd = 0; sd < sides; sd++) {
        const zs = sd === 0 ? d / 2 : -d / 2;
        const [cx, cz] = loc(0, zs);
        const nrm: V3 = [Math.sin(yaw) * (zs > 0 ? 1 : -1), 0, Math.cos(yaw) * (zs > 0 ? 1 : -1)];
        this.windowsFor(hash32(p, 17 + sd), { at: [cx, base + h * 0.55, cz], w: w * 0.7, h: h * 0.3, normal: nrm }, { count: 2, ...wo });
      }
    }
    this.close();
    return this;
  }

  /**
   * The terrace bank of a seated house (landmark-local geometry): a level top at the floor (walls grown
   * by the ledge) and sloped sides down to the ground, two facets per side, each corner / mid point
   * pushed out (iteratively, so it lands on the slope) by drop / tan(slope), capped at maxRun.
   */
  private bankPart(bk: NonNullable<HouseOpts['bank']>, loc: (x: number, z: number) => V2, w: number, d: number, base: number, common: PartOpts): void {
    const ledge = bk.ledge ?? 0.01;
    const tanS = Math.tan((bk.slope ?? 50) * DEG);
    const maxRun = bk.maxRun ?? 0.6 * Math.min(w, d);
    const hw = w / 2 + ledge;
    const hd = d / 2 + ledge;
    const topY = base + 0.002;
    // ring of 8 top points (corners and side midpoints) in house space, with each one's outward push
    const ring: { x: number; z: number; ux: number; uz: number }[] = [
      { x: -hw, z: -hd, ux: -1, uz: -1 },
      { x: 0, z: -hd, ux: 0, uz: -1 },
      { x: hw, z: -hd, ux: 1, uz: -1 },
      { x: hw, z: 0, ux: 1, uz: 0 },
      { x: hw, z: hd, ux: 1, uz: 1 },
      { x: 0, z: hd, ux: 0, uz: 1 },
      { x: -hw, z: hd, ux: -1, uz: 1 },
      { x: -hw, z: 0, ux: -1, uz: 0 },
    ];
    const gen = (): Geo => {
      const g = new Geo();
      const top: V3[] = [];
      const bot: V3[] = [];
      for (const q of ring) {
        let run = 0;
        for (let it = 0; it < 4; it++) {
          const [x, z] = loc(q.x + q.ux * run, q.z + q.uz * run);
          run = Math.min(maxRun, Math.max(0, (topY - this.ground(x, z)) / tanS));
        }
        const [tx, tz] = loc(q.x, q.z);
        const [bx, bz] = loc(q.x + q.ux * run, q.z + q.uz * run);
        top.push([tx, topY, tz]);
        bot.push([bx, Math.min(topY - 0.002, this.ground(bx, bz) - SINK), bz]);
      }
      face(g, [top[0], top[2], top[4], top[6]], [0, 1, 0]);
      const [cx, cz] = loc(0, 0);
      for (let k = 0; k < ring.length; k++) {
        const k1 = (k + 1) % ring.length;
        if (topY - bot[k][1] < 0.003 && topY - bot[k1][1] < 0.003) continue; // buried uphill side
        const quad = [top[k], top[k1], bot[k1], bot[k]];
        // outward = away from the house centre: orient the facet's own normal that way
        const mx = (top[k][0] + top[k1][0]) / 2 - cx;
        const mz = (top[k][2] + top[k1][2]) / 2 - cz;
        let n = newell(quad);
        if (n[0] * mx + n[2] * mz < 0) n = [-n[0], -n[1], -n[2]];
        const v0 = g.vertexCount;
        face(g, quad, n);
        // shade the bank like the hillside it continues (the terrain normal, not the steeper facet's):
        // the terrace reads by its ledge and the house on it, not as a lit box
        for (let v = v0; v < g.vertexCount; v++) {
          const x = g.p[v * 3];
          const z = g.p[v * 3 + 2];
          const e = 0.03;
          const tn = norm2([-(this.ground(x + e, z) - this.ground(x - e, z)) / (2 * e), 1, -(this.ground(x, z + e) - this.ground(x, z - e)) / (2 * e)]);
          g.n[v * 3] = tn[0];
          g.n[v * 3 + 1] = tn[1];
          g.n[v * 3 + 2] = tn[2];
        }
      }
      return g;
    };
    const bp: PartOpts = { ...common, color: bk.color, shade: bk.shade };
    this.addPart(bk.fam ?? 'foliage', gen, null, bp, { cap: 0 });
  }

  private roofRise(kind: RoofKind, w: number, d: number, o: HouseOpts): number {
    const pitch = (o.pitch ?? 42) * DEG;
    const ov = o.overhang ?? Math.min(w, d) * 0.08;
    switch (kind) {
      case 'flat':
        return Math.min(w, d) * 0.06;
      case 'dome':
        return Math.min(w, d) / 2 + ov;
      case 'cone':
        return (Math.min(w, d) / 2 + ov) * Math.tan(pitch);
      default:
        return (d / 2) * Math.tan(pitch);
    }
  }

  /** roof parts of a house (roof space: wall top at y = h, ridge along x) */
  private roof(walls: FamilyId, fam: FamilyId, w: number, d: number, h: number, o: HouseOpts, m: Matrix4, common: PartOpts): void {
    const kind = o.roof ?? 'gable';
    const pitch = (o.pitch ?? 42) * DEG;
    const ov = o.overhang ?? Math.min(w, d) * 0.08;
    const t = Math.max(0.002, Math.min(w, d) * 0.04); // eave (fascia) thickness
    const rp: PartOpts = { ...common, color: o.roofColor, shade: o.roofShade, grain: o.roofGrain };
    const gp: PartOpts = { ...common, color: o.gableFam ? undefined : o.color, shade: o.shade, tint: o.gableFam ? undefined : o.tint };
    const gf = o.gableFam ?? walls;
    const tan = Math.tan(pitch);
    const W = w / 2 + ov * 0.7;
    const S = d / 2 + ov;
    const ye = h - ov * tan;
    const R = h + (d / 2) * tan;
    switch (kind) {
      case 'gable': {
        this.roofPart(
          fam,
          (dd) => {
            const g = new Geo();
            const inner: V3 = [0, (ye + R) / 2 - t, 0];
            if (dd < 1) {
              // LOD1/2: a closed prism (roof-coloured ends, no fascia): 6 triangles
              faceOut(g, [[-W, R, 0], [W, R, 0], [W, ye, S], [-W, ye, S]], inner);
              faceOut(g, [[-W, R, 0], [W, R, 0], [W, ye, -S], [-W, ye, -S]], inner);
              for (const sx of [-1, 1]) face(g, [[sx * W, R, 0], [sx * W, ye, S], [sx * W, ye, -S]], [sx, 0, 0]);
              return g;
            }
            faceOut(g, [[-W, R, 0], [W, R, 0], [W, ye, S], [-W, ye, S]], inner);
            faceOut(g, [[-W, R, 0], [W, R, 0], [W, ye, -S], [-W, ye, -S]], inner);
            faceOut(g, [[-W, ye, S], [W, ye, S], [W, ye - t, S], [-W, ye - t, S]], inner);
            faceOut(g, [[-W, ye, -S], [W, ye, -S], [W, ye - t, -S], [-W, ye - t, -S]], inner);
            faceOut(g, [[-W, ye - t, S], [W, ye - t, S], [W, ye - t, -S], [-W, ye - t, -S]], inner);
            return g;
          },
          m,
          rp,
          { detailed: true },
        );
        this.addPart(
          gf,
          () => {
            const g = new Geo();
            for (const sx of [-1, 1]) face(g, [[sx * W, R, 0], [sx * W, ye, S], [sx * W, ye - t, S], [sx * W, ye - t, -S], [sx * W, ye, -S]], [sx, 0, 0]);
            return g;
          },
          m,
          gp,
          { cap: 0 },
        );
        if (o.ridge) {
          const rs = o.ridge.size ?? Math.max(0.004, d * 0.08);
          this.addPart(o.ridge.fam ?? fam, () => boxGeo(2 * W, rs, rs * 1.5).translate(0, R - rs * 0.4, 0), m, { ...common, color: o.ridge.color ?? o.roofColor, shade: o.ridge.color === undefined ? 0.75 : 1 }, { cap: 0 });
        }
        if (o.gableBoards) {
          const gb = o.gableBoards;
          const bt = gb.size ?? 0.35 * ov + 0.004;
          const horn = gb.horn ?? bt * 2.5;
          const len = Math.hypot(S, R - ye);
          this.addPart(
            gb.fam ?? walls,
            () => {
              const g = new Geo();
              for (const sx of [-1, 1])
                for (const sg of [-1, 1]) {
                  const phi = Math.atan2(-sg * S, R - ye);
                  g.append(
                    boxGeo(bt, len + horn, bt * 1.3)
                      .transform(new Matrix4().makeRotationX(phi))
                      .translate(sx * (W + bt * 0.5), ye - t, sg * S),
                  );
                }
              return g;
            },
            m,
            { lod: gb.lod ?? common.lod, color: gb.color, shade: 1 },
            { cap: gb.lod ?? 0 },
          );
        }
        break;
      }
      case 'hip': {
        const hl = Math.max(0, W - S);
        const Rh = ye + S * tan;
        this.roofPart(
          fam,
          () => {
            const g = new Geo();
            const inner: V3 = [0, (ye + Rh) / 2 - t, 0];
            const E: V3[] = [[-W, ye, -S], [W, ye, -S], [W, ye, S], [-W, ye, S]];
            const P1: V3 = [-hl, Rh, 0];
            const P2: V3 = [hl, Rh, 0];
            if (hl > 1e-6) {
              faceOut(g, [E[3], E[2], P2, P1], inner);
              faceOut(g, [E[0], E[1], P2, P1], inner);
            } else {
              faceOut(g, [E[3], E[2], P1], inner);
              faceOut(g, [E[0], E[1], P1], inner);
            }
            faceOut(g, [E[1], E[2], P2], inner);
            faceOut(g, [E[0], E[3], P1], inner);
            faceOut(g, [[-W, ye, S], [W, ye, S], [W, ye - t, S], [-W, ye - t, S]], inner);
            faceOut(g, [[-W, ye, -S], [W, ye, -S], [W, ye - t, -S], [-W, ye - t, -S]], inner);
            faceOut(g, [[W, ye, -S], [W, ye, S], [W, ye - t, S], [W, ye - t, -S]], inner);
            faceOut(g, [[-W, ye, -S], [-W, ye, S], [-W, ye - t, S], [-W, ye - t, -S]], inner);
            faceOut(g, [[-W, ye - t, S], [W, ye - t, S], [W, ye - t, -S], [-W, ye - t, -S]], inner);
            return g;
          },
          m,
          rp,
        );
        break;
      }
      case 'flat': {
        const th = Math.min(w, d) * 0.06;
        this.roofPart(fam, () => boxGeo(w + 2 * ov, th, d + 2 * ov).translate(0, h, 0), m, rp);
        break;
      }
      case 'dome': {
        const rd = Math.min(w, d) / 2 + ov;
        this.roofPart(
          fam,
          (dd) => {
            const n = Math.max(3, Math.round(7 * dd));
            const prof: V2[] = [];
            for (let k = 0; k <= n; k++) {
              const a = (k / n) * (Math.PI / 2);
              prof.push([Math.cos(a) * rd, h + Math.sin(a) * rd]);
            }
            prof[n][0] = 0;
            return latheGeo(prof, { seg: Math.max(8, Math.round(20 * dd)), crease: 80 });
          },
          m,
          rp,
          { detailed: true },
        );
        break;
      }
      case 'cone': {
        const a = w / 2 + ov;
        const b = d / 2 + ov;
        const rise = (Math.min(w, d) / 2 + ov) * tan;
        this.roofPart(
          fam,
          () => {
            const g = latheGeo(
              [
                [Math.SQRT2, 0],
                [0, 1],
              ],
              { seg: 4, faceted: true },
            );
            return g.transform(new Matrix4().makeRotationY(Math.PI / 4)).transform(new Matrix4().makeScale(a, rise, b)).translate(0, h, 0);
          },
          m,
          rp,
        );
        break;
      }
      case 'round': {
        const rise = (d / 2) * tan;
        this.roofPart(
          fam,
          (dd) => {
            const g = new Geo();
            const n = Math.max(3, Math.round(8 * dd));
            const L: number[] = [];
            const Rr: number[] = [];
            for (let k = 0; k <= n; k++) {
              const a = (k / n) * Math.PI;
              const z = Math.cos(a) * S;
              const y = ye + Math.sin(a) * (R - ye + rise * 0.1);
              const nz = Math.cos(a) / S;
              const ny = Math.sin(a) / Math.max(1e-6, R - ye);
              const l = Math.hypot(nz, ny) || 1;
              L.push(g.v(-W, y, z, 0, ny / l, nz / l));
              Rr.push(g.v(W, y, z, 0, ny / l, nz / l));
            }
            for (let k = 0; k < n; k++) g.quad(L[k], Rr[k], Rr[k + 1], L[k + 1]);
            faceOut(g, [[-W, ye, S], [W, ye, S], [W, ye, -S], [-W, ye, -S]], [0, ye + 1, 0]);
            return fixWinding(g, [0, ye, 0]);
          },
          m,
          rp,
          { detailed: true },
        );
        this.addPart(
          gf,
          (dd) => {
            const g = new Geo();
            const n = Math.max(3, Math.round(8 * dd));
            for (const sx of [-1, 1]) {
              const pts: V3[] = [];
              for (let k = 0; k <= n; k++) {
                const a = (k / n) * Math.PI;
                pts.push([sx * W, ye + Math.sin(a) * (R - ye + rise * 0.1), Math.cos(a) * S]);
              }
              face(g, pts, [sx, 0, 0]);
            }
            return g;
          },
          m,
          gp,
          { detailed: true },
        );
        break;
      }
    }
  }

  /**
   * A tower: `sides`-gon (≤ 8 faceted, default 16 round) of radius `r`, height `h`, optional `taper`,
   * with a roof — cone (default), spire, crenel (parapet + merlons, LOD ≤ 1), dome or none — in
   * `roofFam` (default slate). `seat` sits it on the ground. `windows` records lights in rows around it.
   */
  tower(fam: FamilyId, r: number, h: number, o: TowerOpts = {}): this {
    const p = this.begin();
    this.open();
    const at: V3 = o.at ?? [0, 0, 0];
    const sides = o.sides ?? 16;
    const rt = r * (1 - (o.taper ?? 0));
    let base = at[1];
    if (o.seat) {
      const pts: V2[] = [];
      for (let k = 0; k < 8; k++) pts.push([at[0] + Math.cos((k / 8) * Math.PI * 2) * r, at[2] + Math.sin((k / 8) * Math.PI * 2) * r]);
      pts.push([at[0], at[2]]);
      const st = this.seatAt(pts, o.seat, at[1]);
      base = st.y;
      this.contactPair(pts, st.gs, () => base, h + (o.roofH ?? rt));
    }
    const m = this.matrix([at[0], base, at[2]], o.rot);
    const roof = o.roof ?? 'cone';
    const body: PartOpts = { lod: o.lod, color: o.color, shade: o.shade, tint: o.tint };
    this.addPart(
      fam,
      (d) =>
        latheGeo(
          [
            [r, 0],
            [rt, h],
          ],
          { seg: this.segs(sides, d), faceted: sides <= 8, caps: true },
        ),
      m,
      body,
      { detailed: sides > 8 },
    );
    const rf = o.roofFam ?? 'slate';
    const rp: PartOpts = { lod: o.lod, color: o.roofColor };
    if (roof === 'cone' || roof === 'spire') {
      const rh = o.roofH ?? (roof === 'cone' ? 1.2 : 3) * rt;
      const rr = rt * (roof === 'cone' ? 1.18 : 1.05);
      this.roofPart(
        rf,
        (d) =>
          latheGeo(
            [
              [rr, h],
              [0, h + rh],
            ],
            { seg: this.segs(sides, d), faceted: sides <= 8 },
          ),
        m,
        rp,
        { detailed: sides > 8 },
      );
    } else if (roof === 'dome') {
      const rh = o.roofH ?? rt;
      this.roofPart(
        rf,
        (d) => {
          const n = Math.max(3, Math.round(7 * d));
          const prof: V2[] = [];
          for (let k = 0; k <= n; k++) {
            const a = (k / n) * (Math.PI / 2);
            prof.push([Math.cos(a) * rt, h + Math.sin(a) * rh]);
          }
          prof[n][0] = 0;
          return latheGeo(prof, { seg: this.segs(Math.max(sides, 12), d), crease: 80 });
        },
        m,
        rp,
        { detailed: true },
      );
    } else if (roof === 'crenel') {
      const pr = rt * 1.12;
      const ph = Math.max(0.01, rt * 0.35);
      this.addPart(
        fam,
        (d) =>
          latheGeo(
            [
              [rt * 0.8, h],
              [pr, h],
              [pr, h + ph],
              [rt * 0.8, h + ph],
              [rt * 0.8, h],
            ],
            { seg: this.segs(sides, d), faceted: sides <= 8 },
          ),
        m,
        body,
        { detailed: sides > 8 },
      );
      const nm = Math.max(4, Math.round((2 * Math.PI * pr) / (ph * 1.6)));
      this.addPart(
        fam,
        () => {
          const g = new Geo();
          for (let k = 0; k < nm; k += 1) {
            const a = ((k + 0.5) / nm) * Math.PI * 2;
            const mw = ((2 * Math.PI * pr) / nm) * 0.5;
            const b = boxGeo(mw, ph * 0.7, (pr - rt * 0.8) * 1.05);
            b.transform(new Matrix4().makeRotationY(-a + Math.PI / 2)).translate(Math.cos(a) * (pr + rt * 0.8) * 0.5, h + ph, Math.sin(a) * (pr + rt * 0.8) * 0.5);
            g.append(b);
          }
          return g;
        },
        m,
        body,
        { cap: 1 },
      );
    }
    if (o.windows) {
      const wo = o.windows;
      const rows = wo.rows ?? 2;
      const per = wo.count ?? 4;
      let slot = 0;
      for (let row = 0; row < rows; row++) {
        const y = base + h * (rows > 1 ? 0.35 + (0.5 * row) / (rows - 1) : 0.55);
        for (let k = 0; k < per; k++) {
          const a = ((k + 0.5 * (row % 2)) / per) * Math.PI * 2 + this.q(p, 3) * 6.28;
          const rr = r + (rt - r) * ((y - base) / h) + 0.004;
          const lit = this.q(p, 100 + slot++) < (wo.on ?? 0.7);
          if (!lit) continue;
          this.lights.push({ at: [at[0] + Math.cos(a) * rr, y, at[2] + Math.sin(a) * rr], color: wo.color ?? 0xe2a452, intensity: wo.intensity ?? 1, radius: wo.size ?? 0.012, kind: wo.kind ?? 'window', flicker: 0 });
        }
      }
    }
    this.close();
    return this;
  }

  /**
   * A wall along a local polyline (x, z; + `at`), `h` tall and `thickness` thick, optional `batter`
   * (narrower top), `crenel` merlons / 'point' stakes (LOD ≤ 1) and `towers` every N km of its length.
   * `followGround`: the bottom follows the ground under both faces (resampled every `step` km, −0.02),
   * the top follows the bottom — palisades and curtain walls over hills. Leave a gap for a gate by
   * using an open path. Faces are flat per segment.
   */
  wallPath(fam: FamilyId, path: V2[], h: number, thickness: number, o: WallPathOpts = {}): this {
    const part = this.begin();
    this.open();
    const jitter = o.shadeJitter ?? 0;
    const at: V3 = o.at ?? [0, 0, 0];
    const pts: V2[] = path.map((q) => [q[0] + at[0], q[1] + at[2]]);
    const closed = o.closed ?? false;
    const fg = o.followGround ?? false;
    const tt = thickness * (1 - (o.batter ?? 0));
    const sample = (d: number): V2[] => {
      const step = (o.step ?? 0.1) / d;
      const out: V2[] = [];
      const nSeg = closed ? pts.length : pts.length - 1;
      for (let k = 0; k < nSeg; k++) {
        const a = pts[k];
        const b = pts[(k + 1) % pts.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = fg ? Math.max(1, Math.ceil(len / step)) : 1;
        for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
      }
      if (!closed) out.push(pts[pts.length - 1]);
      return out;
    };
    const bottomAt = (x: number, z: number, nx: number, nz: number) =>
      fg ? Math.min(this.ground(x + nx * thickness * 0.5, z + nz * thickness * 0.5), this.ground(x - nx * thickness * 0.5, z - nz * thickness * 0.5)) - SINK : at[1];
    const ribbon = (d: number): Geo => {
      const s = sample(d);
      const g = new Geo();
      const N = s.length;
      const segCount = closed ? N : N - 1;
      // per-point miter normals (right side of the walking direction: (−dz, dx))
      const dir = (k: number): V2 => {
        const a = s[k % N];
        const b = s[(k + 1) % N];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      };
      const miter: V2[] = [];
      const bot: number[] = [];
      for (let k = 0; k < N; k++) {
        const d1 = !closed && k === N - 1 ? dir(k - 1) : dir(k);
        const d0 = !closed && k === 0 ? d1 : dir((k - 1 + N) % N);
        let mx = -(d0[1] + d1[1]);
        let mz = d0[0] + d1[0];
        const ml = Math.hypot(mx, mz) || 1;
        mx /= ml;
        mz /= ml;
        const cosH = Math.max(0.5, mx * -d1[1] + mz * d1[0]);
        miter.push([mx / cosH, mz / cosH]);
        bot.push(bottomAt(s[k][0], s[k][1], mx, mz));
      }
      const top = (k: number) => bot[k] + h + (fg ? SINK : 0);
      for (let k = 0; k < segCount; k++) {
        const k1 = (k + 1) % N;
        const [ax, az] = s[k];
        const [bx, bz] = s[k1];
        const ma = miter[k];
        const mb = miter[k1];
        const dd = dir(k);
        const nr: V3 = [-dd[1], 0, dd[0]];
        const rb = (q: V2, m: V2, half: number, y: number): V3 => [q[0] + m[0] * half, y, q[1] + m[1] * half];
        const lb = (q: V2, m: V2, half: number, y: number): V3 => [q[0] - m[0] * half, y, q[1] - m[1] * half];
        const lean = (thickness - tt) / 2;
        const tiltR: V3 = [nr[0] * h, lean, nr[2] * h];
        const tiltL: V3 = [-nr[0] * h, lean, -nr[2] * h];
        const v0 = g.vertexCount;
        face(g, [rb(s[k], ma, thickness / 2, bot[k]), rb(s[k1], mb, thickness / 2, bot[k1]), rb(s[k1], mb, tt / 2, top(k1)), rb(s[k], ma, tt / 2, top(k))], tiltR);
        face(g, [lb(s[k], ma, thickness / 2, bot[k]), lb(s[k1], mb, thickness / 2, bot[k1]), lb(s[k1], mb, tt / 2, top(k1)), lb(s[k], ma, tt / 2, top(k))], tiltL);
        const up: V3 = [-(top(k1) - top(k)) * dd[0], Math.hypot(bx - ax, bz - az), -(top(k1) - top(k)) * dd[1]];
        face(g, [rb(s[k], ma, tt / 2, top(k)), rb(s[k1], mb, tt / 2, top(k1)), lb(s[k1], mb, tt / 2, top(k1)), lb(s[k], ma, tt / 2, top(k))], up);
        if (jitter) {
          const sh = 1 + (this.q(part, 7000 + k) - 0.5) * 2 * jitter;
          for (let v = v0; v < g.vertexCount; v++) g.shade(v, sh);
        }
      }
      if (!closed) {
        for (const [k, sg] of [
          [0, -1],
          [N - 1, 1],
        ] as [number, number][]) {
          const dd = dir(k === 0 ? 0 : N - 2);
          const m = miter[k];
          face(
            g,
            [
              [s[k][0] + m[0] * thickness * 0.5, bot[k], s[k][1] + m[1] * thickness * 0.5],
              [s[k][0] - m[0] * thickness * 0.5, bot[k], s[k][1] - m[1] * thickness * 0.5],
              [s[k][0] - m[0] * tt * 0.5, top(k), s[k][1] - m[1] * tt * 0.5],
              [s[k][0] + m[0] * tt * 0.5, top(k), s[k][1] + m[1] * tt * 0.5],
            ],
            [dd[0] * sg, 0, dd[1] * sg],
          );
        }
      }
      return g;
    };
    const body: PartOpts = { lod: o.lod, color: o.color, shade: o.shade, tint: o.tint };
    this.addPart(fam, ribbon, null, body, { detailed: fg, h });
    // arc-length parametrisation of the (LOD0) centre line for crenels, towers and contacts
    const s0 = sample(1);
    const segs: { a: V2; b: V2; len: number; s: number }[] = [];
    let total = 0;
    const nSeg = closed ? s0.length : s0.length - 1;
    for (let k = 0; k < nSeg; k++) {
      const a = s0[k];
      const b = s0[(k + 1) % s0.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      segs.push({ a, b, len, s: total });
      total += len;
    }
    const at_ = (t: number): { x: number; z: number; dx: number; dz: number } => {
      const sg = segs.find((q) => t <= q.s + q.len) ?? segs[segs.length - 1];
      const f = sg.len > 0 ? (t - sg.s) / sg.len : 0;
      return { x: sg.a[0] + (sg.b[0] - sg.a[0]) * f, z: sg.a[1] + (sg.b[1] - sg.a[1]) * f, dx: (sg.b[0] - sg.a[0]) / (sg.len || 1), dz: (sg.b[1] - sg.a[1]) / (sg.len || 1) };
    };
    const topAt = (x: number, z: number, dx: number, dz: number) => bottomAt(x, z, -dz, dx) + h + (fg ? SINK : 0);
    if (o.crenel) {
      const cr = o.crenel;
      const pitch = cr.w + cr.gap;
      const n = Math.floor(total / pitch);
      this.addPart(
        cr.fam ?? fam,
        () => {
          const g = new Geo();
          for (let k = 0; k < n; k++) {
            const q = at_((k + 0.5) * pitch);
            const y = topAt(q.x, q.z, q.dx, q.dz) - 0.002;
            const yaw = -Math.atan2(q.dz, q.dx);
            const mm = new Matrix4().compose(new Vector3(q.x, y, q.z), new Quaternion().setFromEuler(new Euler(0, yaw, 0)), new Vector3(1, 1, 1));
            const merlon = cr.shape === 'point' ? stakeGeo(cr.w, cr.h, tt * 1.02) : boxGeo(cr.w, cr.h, tt * 1.02, false);
            g.append(merlon.transform(mm));
          }
          return g;
        },
        null,
        { lod: cr.lod ?? o.lod, color: cr.color ?? o.color, shade: o.shade, tint: o.tint },
        { cap: 1, h: cr.h },
      );
    }
    if (o.towers) {
      const tw = o.towers;
      const count = Math.max(1, Math.floor(total / tw.every + 1e-6));
      const n = closed ? count : count + 1;
      for (let k = 0; k < n; k++) {
        const t = closed ? (k * total) / count : Math.min(total, k * tw.every);
        const q = at_(t);
        this.tower(tw.fam ?? fam, tw.r, tw.h, {
          at: [q.x, fg ? 0 : at[1], q.z],
          seat: fg,
          sides: tw.sides ?? 12,
          roof: tw.roof ?? 'crenel',
          roofFam: tw.roofFam,
          roofColor: tw.roofColor,
          color: tw.color ?? o.color,
          lod: o.lod,
        });
      }
    }
    if (fg) {
      // the solid: sink + visible height + merlons
      const solid = h + SINK + (o.crenel?.h ?? 0);
      for (let t = 0; t <= total; t += 0.25) {
        const q = at_(t);
        const b = bottomAt(q.x, q.z, -q.dz, q.dx);
        this.contacts.push({ x: q.x, z: q.z, baseY: b, groundY: this.ground(q.x, q.z), h: solid });
      }
    }
    this.close();
    return this;
  }

  /**
   * A rock face along a local polyline (x, z; + `at`) — cliffs narrower than the 0.4 km heightfield
   * can express. The face looks to the RIGHT of the walking direction; `height` is constant or one
   * value per path point (the skyline is jagged by noise). Faceted rock (flat triangles, per-facet
   * shade), buttresses and gullies (`rough`), strata bands, an optional `overhang`; the rock body slopes
   * back `depth` km into the ground. Bottom follows the ground by default. The ends taper to nothing
   * below the ground (`taper`), so no end slab ever faces the camera; merge neighbouring crags into one
   * path rather than placing several short ones.
   */
  cliff(fam: FamilyId, path: V2[], height: number | number[], o: CliffOpts = {}): this {
    const p = this.begin();
    const at: V3 = o.at ?? [0, 0, 0];
    const pts: V2[] = path.map((q) => [q[0] + at[0], q[1] + at[2]]);
    const hs = typeof height === 'number' ? pts.map(() => height) : height;
    const rough = o.rough ?? 0.35;
    const strata = o.strata ?? 0.3;
    const over = o.overhang ?? 0;
    const fg = o.followGround ?? true;
    const nseed = hash32(this.kseed, p, 91);
    let total = 0;
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push((total += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])));
    const hmax = Math.max(...hs);
    // right-hand normals per path vertex (averaged over the adjacent segments)
    const sn: V2[] = [];
    for (let k = 1; k < pts.length; k++) {
      const dl = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]) || 1;
      sn.push([-(pts[k][1] - pts[k - 1][1]) / dl, (pts[k][0] - pts[k - 1][0]) / dl]);
    }
    const pn: V2[] = pts.map((_, k) => {
      const a = sn[Math.max(0, k - 1)];
      const b = sn[Math.min(sn.length - 1, k)];
      const l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
      return [(a[0] + b[0]) / l, (a[1] + b[1]) / l];
    });
    const depth = o.depth ?? 0.6 * hmax;
    const taper = Math.min(total / 4, o.taper ?? Math.max(0.1, 1.2 * hmax));
    const soft = Math.min(1, Math.max(0, o.soft ?? 0.55));
    const ends: number[] = [];
    const gen = (d: number): Geo => {
      const g = new Geo();
      const nu = Math.max(2, Math.ceil(total / (Math.max(0.02, hmax * 0.06) / d)));
      const nv = Math.max(2, Math.round(10 * d));
      // grid of points (u along the path, v up the face, then 2 rows over the top and down the back)
      const P: V3[][] = [];
      const S: number[][] = [];
      for (let iu = 0; iu <= nu; iu++) {
        const t = (iu / nu) * total;
        let k = 1;
        while (k < pts.length - 1 && cum[k] < t) k++;
        const f = (t - cum[k - 1]) / Math.max(1e-9, cum[k] - cum[k - 1]);
        const x = pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f;
        const z = pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f;
        // face normal blended between the path vertices' averaged normals (no fold at joints)
        let nx = pn[k - 1][0] + (pn[k][0] - pn[k - 1][0]) * f;
        let nz = pn[k - 1][1] + (pn[k][1] - pn[k - 1][1]) * f;
        const nl = Math.hypot(nx, nz) || 1;
        nx /= nl;
        nz /= nl;
        const hh = hs[k - 1] + (hs[k] - hs[k - 1]) * f;
        // taper the ends to nothing so the face grows out of the slope; a jagged skyline along the top
        const endT = taper > 0 ? smoothstep01(Math.min(t, total - t) / taper) : 1;
        // a jagged skyline: broad steps plus sharper teeth
        const H = hh * endT * (0.66 + 0.5 * noise3(t * 3.1, 0.3, 4.2, nseed) + 0.3 * (noise3(t * 12.5, 1.3, 2.2, nseed) - 0.5));
        if (iu === 0 || iu === nu) ends[iu === 0 ? 0 : 1] = H;
        const y0 = (fg ? this.ground(x - nx * 0.02, z - nz * 0.02) - SINK : at[1]) - (1 - endT) * SINK * 2;
        // buttresses and gullies: a column-wise bulge, plus two octaves of face noise
        const col = (noise3(t * 9, 0.7, 3.3, nseed) - 0.5) * rough * H * 0.3;
        const row: V3[] = [];
        const sh: number[] = [];
        for (let iv = 0; iv <= nv; iv++) {
          const v = iv / nv;
          const nn = noise3(t * 5, v * 2.2, 0.5, nseed) - 0.5 + 0.5 * (noise3(t * 13, v * 5, 7.5, nseed) - 0.5);
          const off = H * (over * v * v - 0.18 * v) + (rough * H * 0.45 * nn + col) * (0.35 + 0.65 * Math.sin(v * Math.PI));
          const y = y0 + v * H;
          row.push([x + nx * off, y, z + nz * off]);
          sh.push(1 + strata * 0.35 * Math.sin(y * 38 + noise3(t * 2, y * 3, 1.5, nseed) * 4) + 0.18 * (noise3(t * 7, v * 4, 9.5, nseed) - 0.5));
        }
        // the rock body rounds over the top and slopes back into the ground (monotone down: no folds;
        // on a hillside the back simply ends up buried in the uphill slope)
        const bx = x - nx * depth;
        const bz = z - nz * depth;
        const yb = fg ? this.ground(bx, bz) - SINK : at[1];
        const topY = y0 + H;
        row.push([x - nx * depth * 0.4, topY - H * 0.12, z - nz * depth * 0.4]);
        row.push([bx, Math.min(yb, topY - H * 0.4), bz]);
        sh.push(0.95, 0.9);
        P.push(row);
        S.push(sh);
      }
      // broken rock: every triangle keeps its own vertices, its normal a blend of the flat facet normal
      // and the smoothed surface normal (`soft`), so the face reads as fractured stone, not folded paper
      // (quad order A→B→C→D faces the right-hand side)
      const m = P[0].length;
      const SN: V3[][] = P.map((row) => row.map((): V3 => [0, 0, 0]));
      const acc = (iu: number, iv: number, n: V3) => {
        const q = SN[iu][iv];
        q[0] += n[0];
        q[1] += n[1];
        q[2] += n[2];
      };
      for (let iu = 0; iu < nu; iu++)
        for (let iv = 0; iv + 1 < m; iv++) {
          const n1 = cross3(sub3(P[iu + 1][iv], P[iu][iv]), sub3(P[iu + 1][iv + 1], P[iu][iv]));
          const n2 = cross3(sub3(P[iu + 1][iv + 1], P[iu][iv]), sub3(P[iu][iv + 1], P[iu][iv]));
          acc(iu, iv, n1);
          acc(iu + 1, iv, n1);
          acc(iu + 1, iv + 1, n1);
          acc(iu, iv, n2);
          acc(iu + 1, iv + 1, n2);
          acc(iu, iv + 1, n2);
        }
      const tri = (a: V3, b: V3, c: V3, k: number, sa?: V3, sb?: V3, sc?: V3) => {
        const n = cross3(sub3(b, a), sub3(c, a));
        const l = Math.hypot(n[0], n[1], n[2]);
        if (l < 1e-12) return;
        const f: V3 = [n[0] / l, n[1] / l, n[2] / l];
        const blend = (sv?: V3): V3 => {
          if (!sv) return f;
          const sl = Math.hypot(sv[0], sv[1], sv[2]) || 1;
          return norm2([f[0] * (1 - soft) + (sv[0] / sl) * soft, f[1] * (1 - soft) + (sv[1] / sl) * soft, f[2] * (1 - soft) + (sv[2] / sl) * soft]);
        };
        const i0 = g.v(a[0], a[1], a[2], ...blend(sa));
        g.v(b[0], b[1], b[2], ...blend(sb));
        g.v(c[0], c[1], c[2], ...blend(sc));
        g.shade(i0, k);
        g.shade(i0 + 1, k);
        g.shade(i0 + 2, k);
        g.tri(i0, i0 + 1, i0 + 2);
      };
      for (let iu = 0; iu < nu; iu++)
        for (let iv = 0; iv + 1 < m; iv++) {
          const A = P[iu][iv];
          const B = P[iu + 1][iv];
          const C = P[iu + 1][iv + 1];
          const D = P[iu][iv + 1];
          const k = (S[iu][iv] + S[iu + 1][iv] + S[iu + 1][iv + 1] + S[iu][iv + 1]) / 4;
          tri(A, B, C, k, SN[iu][iv], SN[iu + 1][iv], SN[iu + 1][iv + 1]);
          tri(A, C, D, k * 0.96, SN[iu][iv], SN[iu + 1][iv + 1], SN[iu][iv + 1]);
        }
      // end caps: only where an end stays tall (taper 0) — a fan from the section's centroid with
      // per-triangle normals (the section is not planar), each facing out along the path
      for (const iu of [0, nu]) {
        if ((ends[iu === 0 ? 0 : 1] ?? 0) < 0.02) continue;
        const k = iu === 0 ? 1 : pts.length - 1;
        const dx = pts[k][0] - pts[k - 1][0];
        const dz = pts[k][1] - pts[k - 1][1];
        const sgn = iu === 0 ? -1 : 1;
        const ring = P[iu];
        const c = ring.reduce((acc, q) => [acc[0] + q[0] / ring.length, acc[1] + q[1] / ring.length, acc[2] + q[2] / ring.length], [0, 0, 0] as V3);
        for (let j = 0; j < ring.length; j++) {
          const a = ring[j];
          const b = ring[(j + 1) % ring.length];
          const n = cross3(sub3(a, c), sub3(b, c));
          if (n[0] * dx * sgn + n[2] * dz * sgn >= 0) tri(c, a, b, 0.92);
          else tri(c, b, a, 0.92);
        }
      }
      return g;
    };
    const body: PartOpts = { lod: o.lod, color: o.color, shade: o.shade, tint: o.tint };
    const part = this.addPart(fam, gen, null, body, { detailed: true, h: hmax });
    // rock faces: the families' rock noise class (stone noise without masonry courses + the shared strata,
    // so kit cliffs band with the terrain's bedding); the contact bits stay
    if (part.key === 'structure') part.surf = [part.surf[0], part.surf[1], part.surf[2], NOISE.rock * 32 + (part.surf[3] % 32)];
    return this;
  }

  /**
   * Deterministic scatter: up to `n` points in a circle / polygon / annulus (compass bearings), at least
   * `minSpacing` apart and outside `avoid`; calls `fn(i, x, z, u)` with a stable random `u` ∈ [0, 1).
   * Uses the kit stream (never shifts `k.r()`). Returns the number placed.
   */
  scatter(area: ScatterArea, n: number, fn: (i: number, x: number, z: number, u: number) => void, o: ScatterOpts = {}): number {
    const p = this.begin();
    const tries = n * (o.tries ?? 30);
    const placed: V2[] = [];
    const minS = o.minSpacing ?? 0;
    let box: [number, number, number, number];
    if ('circle' in area) box = [area.circle.at[0] - area.circle.r, area.circle.at[1] - area.circle.r, area.circle.at[0] + area.circle.r, area.circle.at[1] + area.circle.r];
    else if ('polygon' in area) {
      const xs = area.polygon.map((q) => q[0]);
      const zs = area.polygon.map((q) => q[1]);
      box = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
    } else box = [0, 0, 0, 0];
    for (let t = 0; t < tries && placed.length < n; t++) {
      const u1 = this.q(p, 2 * t);
      const u2 = this.q(p, 2 * t + 1);
      let x: number;
      let z: number;
      if ('annulus' in area) {
        const an = area.annulus;
        const r = Math.sqrt(an.r0 * an.r0 + u1 * (an.r1 * an.r1 - an.r0 * an.r0));
        const a0 = an.a0 ?? 0;
        let a1 = an.a1 ?? 360;
        if (a1 <= a0) a1 += 360;
        const b = (a0 + u2 * (a1 - a0)) * DEG;
        x = an.at[0] + Math.sin(b) * r;
        z = an.at[1] - Math.cos(b) * r;
      } else if ('circle' in area) {
        const r = Math.sqrt(u1) * area.circle.r;
        const b = u2 * Math.PI * 2;
        x = area.circle.at[0] + Math.cos(b) * r;
        z = area.circle.at[1] + Math.sin(b) * r;
      } else {
        x = box[0] + u1 * (box[2] - box[0]);
        z = box[1] + u2 * (box[3] - box[1]);
        if (!inside(area.polygon, x, z)) continue;
      }
      if (minS > 0 && placed.some((q) => Math.hypot(q[0] - x, q[1] - z) < minS)) continue;
      if (o.avoid?.some((av) => (Array.isArray(av) ? inside(av, x, z) : Math.hypot(x - av.at[0], z - av.at[1]) < av.r))) continue;
      placed.push([x, z]);
      fn(placed.length - 1, x, z, this.q(p, 1_000_000 + placed.length));
    }
    return placed.length;
  }

  /**
   * Stairs along a local 3D path (x, y, z; y = NaN → the ground there): one step every `stepKm`
   * (default 0.03), `width` across, each a column down to the ground (never floating). LOD1 turns the
   * flight into a ramp; LOD2 drops it.
   */
  stairs(fam: FamilyId, path: V3[], width: number, o: PartOpts & { stepKm?: number } = {}): this {
    this.begin();
    const stepKm = o.stepKm ?? 0.03;
    const pts: V3[] = path.map((q) => [q[0], Number.isNaN(q[1]) ? this.ground(q[0], q[2]) : q[1], q[2]]);
    const gen = (d: number): Geo => {
      const g = new Geo();
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const dx = (b[0] - a[0]) / (L || 1);
        const dz = (b[2] - a[2]) / (L || 1);
        const nx = -dz;
        const nz = dx;
        const n = d < 1 ? 1 : Math.max(1, Math.round(L / stepKm));
        for (let i = 0; i < n; i++) {
          const t0 = i / n;
          const t1 = (i + 1) / n;
          const ya = d < 1 ? a[1] : a[1] + (b[1] - a[1]) * t1;
          const yb = d < 1 ? b[1] : ya;
          const P = (t: number, side: number): V2 => [a[0] + (b[0] - a[0]) * t + nx * side * width * 0.5, a[2] + (b[2] - a[2]) * t + nz * side * width * 0.5];
          const c: V2[] = [P(t0, 1), P(t1, 1), P(t1, -1), P(t0, -1)];
          const tops = [ya, yb, yb, ya];
          const bots = c.map((q, j) => Math.min(this.ground(q[0], q[1]) - SINK, tops[j] - 0.004));
          const T = c.map((q, j): V3 => [q[0], tops[j], q[1]]);
          const B = c.map((q, j): V3 => [q[0], bots[j], q[1]]);
          face(g, T, [-(yb - ya) * dx, (t1 - t0) * L, -(yb - ya) * dz]);
          face(g, [B[0], B[1], T[1], T[0]], [nx, 0, nz]);
          face(g, [B[3], B[2], T[2], T[3]], [-nx, 0, -nz]);
          face(g, [B[1], B[2], T[2], T[1]], [dx, 0, dz]);
          face(g, [B[0], B[3], T[3], T[0]], [-dx, 0, -dz]);
        }
      }
      return g;
    };
    const body: PartOpts = { lod: o.lod, color: o.color, shade: o.shade, tint: o.tint };
    this.addPart(fam, gen, null, body, { detailed: true, cap: 1 });
    return this;
  }

  /**
   * A bridge deck from `a` to `b` (local x, y, z; deck top), `width` wide, on `arches` spans with piers
   * down to the ground; `missing` lists broken span indices (no deck there).
   */
  bridge(fam: FamilyId, a: V3, b: V3, o: PartOpts & { width?: number; arches?: number; missing?: number[]; deck?: number } = {}): this {
    this.begin();
    this.open();
    const width = o.width ?? 0.08;
    const n = Math.max(1, o.arches ?? 3);
    const deck = o.deck ?? width * 0.35;
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const yaw = (-Math.atan2(b[2] - a[2], b[0] - a[0]) * 180) / Math.PI;
    const body: PartOpts = { lod: o.lod, color: o.color, shade: o.shade, tint: o.tint };
    for (let k = 0; k < n; k++) {
      if (o.missing?.includes(k)) continue;
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const P = (t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const p0 = P(t0);
      const p1 = P(t1);
      const mid: V3 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 - deck, (p0[2] + p1[2]) / 2];
      const slope = (Math.atan2(p1[1] - p0[1], (L * (t1 - t0)) || 1) * 180) / Math.PI;
      this.addPart(fam, () => boxGeo(L / n, deck, width), this.matrix(mid, [0, yaw, slope]), body);
    }
    const pw = width * 0.7;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[2] + (b[2] - a[2]) * t;
      const y = a[1] + (b[1] - a[1]) * t - deck;
      const g = this.ground(x, z) - SINK;
      if (y - g < 0.005) continue;
      this.addPart(fam, () => boxGeo(pw, y - g, width * 1.1), this.matrix([x, g, z], [0, yaw, 0]), body);
    }
    this.close();
    return this;
  }

  /**
   * An arcade between local points a → b: `count` openings between piers (`pier` wide, `depth` deep,
   * `h` tall, seated), a lintel band from `archH` to `h` over every opening not listed in `missing`,
   * optional `deck` slab on top.
   */
  arcade(fam: FamilyId, a: V2, b: V2, o: PartOpts & { count?: number; h?: number; archH?: number; pier?: number; depth?: number; missing?: number[]; deck?: boolean } = {}): this {
    this.begin();
    this.open();
    const count = Math.max(1, o.count ?? 5);
    const h = o.h ?? 0.2;
    const archH = o.archH ?? h * 0.7;
    const pier = o.pier ?? 0.03;
    const depth = o.depth ?? 0.05;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const yaw = (-Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    const P = (t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const body: PartOpts = { lod: o.lod, color: o.color, shade: o.shade, tint: o.tint };
    let yTop = -Infinity;
    const bases: number[] = [];
    for (let k = 0; k <= count; k++) {
      const [x, z] = P(k / count);
      const g = this.ground(x, z) - SINK;
      bases.push(g);
      yTop = Math.max(yTop, g + h);
    }
    for (let k = 0; k <= count; k++) {
      const [x, z] = P(k / count);
      this.addPart(fam, () => boxGeo(pier, yTop - bases[k], depth), this.matrix([x, bases[k], z], [0, yaw, 0]), body);
      this.contacts.push({ x, z, baseY: bases[k], groundY: bases[k] + SINK, h: yTop - bases[k] });
    }
    const span = L / count;
    for (let k = 0; k < count; k++) {
      if (o.missing?.includes(k)) continue;
      const [x, z] = P((k + 0.5) / count);
      this.addPart(fam, () => boxGeo(span - pier, h - archH, depth * 0.9), this.matrix([x, yTop - (h - archH), z], [0, yaw, 0]), body);
    }
    if (o.deck) {
      const [x, z] = P(0.5);
      this.addPart(fam, () => boxGeo(L + pier, h * 0.06, depth * 1.4), this.matrix([x, yTop, z], [0, yaw, 0]), body);
    }
    this.close();
    return this;
  }

  /**
   * Loft through horizontal sections (same vertex count each): `outline` (x, z) at height `y`, rotated
   * by `rotDeg` and scaled by `scale` — twisted towers (Minas Morgul, Barad-dûr fins). Flat facets,
   * capped at both ends. Base at `at`.
   */
  loft(fam: FamilyId, sections: { outline: V2[]; y: number; rotDeg?: number; scale?: number }[], o: PartOpts = {}): this {
    this.begin();
    const gen = (): Geo => {
      const g = new Geo();
      const rings: V3[][] = sections.map((sc) => {
        const a = (sc.rotDeg ?? 0) * DEG;
        const s = sc.scale ?? 1;
        return sc.outline.map(([x, z]): V3 => [(x * Math.cos(a) + z * Math.sin(a)) * s, sc.y, (-x * Math.sin(a) + z * Math.cos(a)) * s]);
      });
      const n = rings[0].length;
      const cen = (r: V3[]): V3 => r.reduce((acc, q) => [acc[0] + q[0] / n, acc[1] + q[1] / n, acc[2] + q[2] / n], [0, 0, 0] as V3);
      for (let k = 0; k + 1 < rings.length; k++) {
        const c0 = cen(rings[k]);
        const c1 = cen(rings[k + 1]);
        const mid: V3 = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2, (c0[2] + c1[2]) / 2];
        for (let j = 0; j < n; j++) {
          const j1 = (j + 1) % n;
          faceOut(g, [rings[k][j], rings[k][j1], rings[k + 1][j1], rings[k + 1][j]], mid);
        }
      }
      capPolygon(g, rings[0], [0, -1, 0]);
      capPolygon(g, rings[rings.length - 1], [0, 1, 0]);
      return g;
    };
    this.place(fam, gen, o);
    return this;
  }

  // ---------------------------------------------------------------- records

  /** A point light (local km). Gate defaults by kind (records.ts DEFAULT_GATE). */
  light(at: V3, o: LightOpts = {}): this {
    this.lights.push({ at, color: o.color ?? 0xffb060, intensity: o.intensity ?? 1, radius: o.radius ?? 0.02, kind: o.kind ?? 'lamp', gate: o.gate, flicker: o.flicker ?? 0, ...lightExtras(o) });
    return this;
  }

  /**
   * Window lights on a wall rectangle: `count` (or `density` per km²) slots on a grid, lifted 4 m off
   * the wall along `normal`; a stable `on` fraction of them is lit (unlit slots record nothing).
   */
  windows(rect: WindowRect, o: WindowOpts = {}): this {
    const p = this.begin();
    this.windowsFor(p, rect, o);
    return this;
  }

  private windowsFor(p: number, rect: WindowRect, o: WindowOpts): void {
    const count = Math.max(1, Math.round(o.count ?? (o.density ? o.density * rect.w * rect.h : 4)));
    const nrm = norm2(rect.normal);
    // horizontal axis along the wall: up × normal
    let ux = nrm[2];
    let uz = -nrm[0];
    const ul = Math.hypot(ux, uz) || 1;
    ux /= ul;
    uz /= ul;
    const cols = Math.max(1, Math.round(Math.sqrt((count * rect.w) / Math.max(1e-6, rect.h))));
    const rows = Math.max(1, Math.ceil(count / cols));
    let slot = 0;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols && slot < count; c++, slot++) {
        if (this.q(p, 500 + slot) >= (o.on ?? 0.7)) continue;
        const fu = cols === 1 ? 0 : (c / (cols - 1) - 0.5) * rect.w;
        const fv = rows === 1 ? 0 : (r / (rows - 1) - 0.5) * rect.h;
        this.lights.push({
          at: [rect.at[0] + ux * fu + nrm[0] * 0.004, rect.at[1] + fv + nrm[1] * 0.004, rect.at[2] + uz * fu + nrm[2] * 0.004],
          color: o.color ?? 0xe2a452,
          intensity: o.intensity ?? 1,
          radius: o.size ?? 0.012,
          kind: o.kind ?? 'window',
          flicker: 0,
        });
      }
  }

  /** A hero tree (local km), drawn by the VegetationSystem as a canopy cluster. */
  tree(kind: TreeKind, x: number, z: number, o: TreeOpts = {}): this {
    this.trees.push({ at: [x, z], kind, crownKm: o.crownKm ?? 0.06, heightKm: o.heightKm, color: o.color, yawDeg: o.yawDeg });
    return this;
  }

  // ---------------------------------------------------------------- build

  /** Legacy (S1) API: LOD0 merged per material key. */
  build(): Map<string, BufferGeometry> {
    return this.buildLods().lods[0] ?? new Map();
  }

  /**
   * Merge the parts into 1–3 LODs (see the class doc for membership). The coarsest LOD always keeps at
   * least the largest part group. A level identical to the previous one (same parts, nothing detailed)
   * reuses the previous level's geometry objects (index = level stays meaningful for LandmarkSystem) and
   * the next, smaller level is still built; trailing repeats are dropped. `lod0Only` (records / stats
   * runs that keep no geometry) packs LOD0 and regenerates nothing.
   */
  buildLods(o: { lod0Only?: boolean } = {}): KitOutput {
    const out: KitOutput = { lods: [], lights: this.lights, trees: this.trees, contacts: this.contacts, bbox: null, parts: [] };
    if (!this.list.length) return out;
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    const gb = new Map<number, { min: V3; max: V3 }>();
    for (const p of this.list) {
      const b = p.g0.bounds();
      const g = gb.get(p.group) ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], b.min[a]);
        max[a] = Math.max(max[a], b.max[a]);
        g.min[a] = Math.min(g.min[a], b.min[a]);
        g.max[a] = Math.max(g.max[a], b.max[a]);
      }
      gb.set(p.group, g);
    }
    out.bbox = { min, max };
    const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    const ext = (grp: number) => {
      const g = gb.get(grp)!;
      return Math.hypot(g.max[0] - g.min[0], g.max[1] - g.min[1], g.max[2] - g.min[2]);
    };
    const level = (p: Part): LodLevel => {
      const e = ext(p.group);
      const auto: LodLevel = e >= LOD_SHARE.lod2 * diag ? 2 : e >= LOD_SHARE.lod1 * diag ? 1 : 0;
      return Math.min(p.lod ?? auto, p.cap) as LodLevel;
    };
    const lv = this.list.map(level);
    if (!lv.some((l) => l === 2)) {
      // keep a silhouette: promote the largest group
      let best = -1;
      let bestE = -1;
      this.list.forEach((p, k) => {
        if (p.cap === 2 && ext(p.group) > bestE) {
          bestE = ext(p.group);
          best = p.group;
        }
      });
      this.list.forEach((p, k) => {
        if (p.group === best && p.cap === 2 && p.lod === undefined) lv[k] = 2;
      });
    }
    let prev: number[] | null = null;
    for (let L = 0; L <= (o.lod0Only ? 0 : 2); L++) {
      const idx = this.list.map((_, k) => k).filter((k) => lv[k] >= L);
      if (!idx.length) break;
      if (prev && idx.length === prev.length && idx.every((k, j) => k === prev![j]) && !idx.some((k) => this.list[k].detailed)) {
        out.lods.push(out.lods[out.lods.length - 1]);
        out.parts.push(idx.length);
        continue;
      }
      const byKey = new Map<string, PackItem[]>();
      for (const k of idx) {
        const p = this.list[k];
        let geo = p.g0;
        if (L > 0 && p.detailed) {
          geo = p.gen(LOD_DETAIL[L]);
          if (p.m) geo.transform(p.m);
        }
        const list = byKey.get(p.key) ?? [];
        list.push({ geo, paint: L > 0 && p.paintCoarse ? p.paintCoarse : p.paint, surf: p.surf, h: p.h, aoMin: p.aoMin });
        byKey.set(p.key, list);
      }
      const lod: LodGeometry = new Map();
      for (const key of ['structure', 'glow']) {
        const items = byKey.get(key);
        if (items?.length) lod.set(key, packGeometry(items));
      }
      out.lods.push(lod);
      out.parts.push(idx.length);
      prev = idx;
    }
    while (out.lods.length > 1 && out.lods[out.lods.length - 1] === out.lods[out.lods.length - 2]) {
      out.lods.pop();
      out.parts.pop();
    }
    return out;
  }
}

// ------------------------------------------------------------------ helpers

/** smoothstep on [0, 1] */
function smoothstep01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Newell normal of a polygon (not normalised; area-weighted, robust for slightly non-planar quads) */
function newell(pts: V3[]): V3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

function norm2(n: V3): V3 {
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

function inside(poly: V2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** flat convex face whose normal points away from an interior point */
function faceOut(g: Geo, pts: V3[], interior: V3): void {
  // Newell normal
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const c = pts.reduce((acc, q) => [acc[0] + q[0] / pts.length, acc[1] + q[1] / pts.length, acc[2] + q[2] / pts.length], [0, 0, 0] as V3);
  if (nx * (c[0] - interior[0]) + ny * (c[1] - interior[1]) + nz * (c[2] - interior[2]) < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  face(g, pts, [nx, ny, nz]);
}

/** flip triangles whose geometric normal points towards an interior point */
function fixWinding(g: Geo, interior: V3): Geo {
  for (let k = 0; k < g.i.length; k += 3) {
    const [a, b, c] = [g.i[k], g.i[k + 1], g.i[k + 2]];
    const P = (v: number): V3 => [g.p[v * 3], g.p[v * 3 + 1], g.p[v * 3 + 2]];
    const pa = P(a);
    const pb = P(b);
    const pc = P(c);
    const u: V3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const v: V3 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const cen: V3 = [(pa[0] + pb[0] + pc[0]) / 3 - interior[0], (pa[1] + pb[1] + pc[1]) / 3 - interior[1], (pa[2] + pb[2] + pc[2]) / 3 - interior[2]];
    if (n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2] < 0) {
      g.i[k + 1] = c;
      g.i[k + 2] = b;
    }
  }
  return g;
}

/** close a (roughly planar, possibly concave) polygon with its own flat vertices, facing `n` */
function capPolygon(g: Geo, ring: V3[], n: V3): void {
  const nn = norm2(n);
  // project onto the plane ⟂ n
  const ref: V3 = Math.abs(nn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm2([ref[1] * nn[2] - ref[2] * nn[1], ref[2] * nn[0] - ref[0] * nn[2], ref[0] * nn[1] - ref[1] * nn[0]]);
  const w: V3 = [nn[1] * u[2] - nn[2] * u[1], nn[2] * u[0] - nn[0] * u[2], nn[0] * u[1] - nn[1] * u[0]];
  const pts2: V2[] = ring.map((q) => [q[0] * u[0] + q[1] * u[1] + q[2] * u[2], q[0] * w[0] + q[1] * w[1] + q[2] * w[2]]);
  if (Math.abs(area2(pts2)) < 1e-12) return;
  const ids = ring.map((q) => g.v(q[0], q[1], q[2], nn[0], nn[1], nn[2]));
  const tris = triangulate(pts2);
  for (const [a, b, c] of tris) {
    const pa = ring[a];
    const pb = ring[b];
    const pc = ring[c];
    const cr: V3 = [
      (pb[1] - pa[1]) * (pc[2] - pa[2]) - (pb[2] - pa[2]) * (pc[1] - pa[1]),
      (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]),
      (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]),
    ];
    if (cr[0] * nn[0] + cr[1] * nn[1] + cr[2] * nn[2] >= 0) g.tri(ids[a], ids[b], ids[c]);
    else g.tri(ids[a], ids[c], ids[b]);
  }
}

/** ear-clipping triangulation of a simple 2D polygon (indices) */
function triangulate(pts: V2[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  const idx = pts.map((_, k) => k);
  const ccw = area2(pts) > 0;
  const cross = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const a = idx[(k - 1 + idx.length) % idx.length];
      const b = idx[k];
      const c = idx[(k + 1) % idx.length];
      const cr = cross(pts[a], pts[b], pts[c]);
      if (ccw ? cr <= 1e-15 : cr >= -1e-15) continue;
      let ear = true;
      for (const q of idx) {
        if (q === a || q === b || q === c) continue;
        const d1 = cross(pts[a], pts[b], pts[q]);
        const d2 = cross(pts[b], pts[c], pts[q]);
        const d3 = cross(pts[c], pts[a], pts[q]);
        if (ccw ? d1 >= 0 && d2 >= 0 && d3 >= 0 : d1 <= 0 && d2 <= 0 && d3 <= 0) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      out.push([a, b, c]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

/** a pointed stake / tooth: w along x, h up, t deep (triangular prism across the wall) */
function stakeGeo(w: number, h: number, t: number): Geo {
  const g = new Geo();
  const x = w / 2;
  const z = t / 2;
  face(g, [[-x, 0, z], [x, 0, z], [0, h, z]], [0, 0, 1]);
  face(g, [[-x, 0, -z], [x, 0, -z], [0, h, -z]], [0, 0, -1]);
  const ls: V3 = norm2([-h, x, 0]);
  const rs: V3 = norm2([h, x, 0]);
  face(g, [[-x, 0, -z], [-x, 0, z], [0, h, z], [0, h, -z]], ls);
  face(g, [[x, 0, -z], [x, 0, z], [0, h, z], [0, h, -z]], rs);
  return g;
}
