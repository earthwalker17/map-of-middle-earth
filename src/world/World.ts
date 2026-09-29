import {
  ClampToEdgeWrapping,
  DataArrayTexture,
  DataTexture,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
} from 'three/webgpu';
import placesJson from '../../data/world/places.json';
import looksJson from '../../data/world/looks.json';
import { WorldSpec, type MaskFile } from './WorldSpec.ts';
import { HeightField } from './HeightField.ts';

export interface PlaceDef {
  id: string;
  name: string;
  kind: 'landmark' | 'poi' | 'feature' | 'peak';
  tier?: 'A' | 'B';
  canonical: [number, number];
  src: string;
  displayOffsetKm?: [number, number];
  footprintKm?: number;
  region?: string;
  parent?: string;
  /** the landmark sits on / over water by design: its stamps may raise river or lake cells */
  onRiver?: boolean;
}

export interface Place extends PlaceDef {
  /** display position in world units (canonical + offset) */
  x: number;
  z: number;
  /** canonical position in world units */
  cx: number;
  cz: number;
}

export interface RiverFall {
  /** index into `points` where the drop starts */
  index: number;
  /** drop of the water surface, world units */
  drop: number;
  name?: string;
}

export interface RiverLine {
  name: string | null;
  cls: 'great' | 'major' | 'minor' | 'stream';
  widthKm: number;
  points: [number, number][];
  // ---- bake v2 (optional; absent in v1 bakes → runtime falls back to its own level estimate)
  /** stable id (unique per line) */
  id?: string;
  /** water surface level per point (world units), monotone non-increasing downstream except at `falls` */
  level?: number[];
  /** carved bed height per point (world units) */
  bed?: number[];
  /** explicit knickpoints (e.g. Rauros) — the only places the surface may drop steeply */
  falls?: RiverFall[];
  /** id of the river line or lake key this line drains into; null = sea / frame edge */
  into?: string | null;
}

export interface LakePoly {
  name: string | null;
  key: string;
  level: number | null;
  ring: [number, number][];
}

export type LookRegion = keyof typeof looksJson.regions;

function maskTexture(buf: ArrayBuffer, w: number, h: number): DataTexture {
  const t = new DataTexture(new Uint8Array(buf), w, h, RGBAFormat, UnsignedByteType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.colorSpace = NoColorSpace;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

async function fetchBin(file: string): Promise<ArrayBuffer> {
  const res = await fetch(`/world/${file}`);
  if (!res.ok) throw new Error(`failed to load /world/${file}`);
  return res.arrayBuffer();
}

/**
 * Everything static about the world, loaded once and shared (by constructor injection) with every
 * system: frame/projections, the HeightField, baked masks, look regions, places, rivers, lakes.
 */
export class World {
  private constructor(
    readonly spec: WorldSpec,
    readonly heights: HeightField,
    readonly water: DataTexture,
    readonly landcover: DataTexture,
    readonly forests: DataTexture,
    readonly look: DataArrayTexture,
    readonly lookRegions: LookRegion[],
    readonly places: Map<string, Place>,
    readonly rivers: RiverLine[],
    readonly lakes: LakePoly[],
    /** bake v2 terrain analysis mask (see BakedManifest.files.terrain), null for v1 bakes */
    readonly terrainMask: DataTexture | null = null,
  ) {}

  static async load(onProgress?: (msg: string) => void): Promise<World> {
    onProgress?.('world manifest');
    const spec = await WorldSpec.load();
    const m = spec.manifest.files;
    onProgress?.('heightfield');
    const [heights, water, landcover, forests, look, rivers, lakes, terrain] = await Promise.all([
      HeightField.load(spec),
      fetchBin(m.water.file),
      fetchBin(m.landcover.file),
      fetchBin(m.forests.file),
      fetchBin(m.look.file),
      fetch(`/world/${m.rivers.file}`).then((r) => r.json() as Promise<RiverLine[]>),
      fetch(`/world/${m.lakes.file}`).then((r) => r.json() as Promise<LakePoly[]>),
      m.terrain ? fetchBin(m.terrain.file) : Promise.resolve(null),
    ]);
    const mk = (f: MaskFile, buf: ArrayBuffer) => maskTexture(buf, f.width, f.height);
    const lookTex = new DataArrayTexture(new Uint8Array(look), m.look.tileWidth, m.look.tileHeight, m.look.layers);
    lookTex.format = RGBAFormat;
    lookTex.type = UnsignedByteType;
    lookTex.minFilter = LinearFilter;
    lookTex.magFilter = LinearFilter;
    lookTex.colorSpace = NoColorSpace;
    lookTex.generateMipmaps = false;
    lookTex.needsUpdate = true;

    const places = new Map<string, Place>();
    for (const def of placesJson.places as PlaceDef[]) {
      const off = def.displayOffsetKm ?? [0, 0];
      const [cx, cz] = spec.kmToWorld(def.canonical[0], def.canonical[1]);
      const [x, z] = spec.kmToWorld(def.canonical[0] + off[0], def.canonical[1] + off[1]);
      places.set(def.id, { ...def, x, z, cx, cz });
    }
    // "rivers win": landmark stamps keep off the water and leave natural banks beside it (HeightField
    // RiverGuard; allowlisted landmarks aside). The ribbon half width matches src/water/rivers.ts.
    const R = spec.json.rivers;
    heights.setRiverGuard({
      lines: rivers.map((r) => ({
        points: r.points,
        level: r.level ?? r.points.map((p) => heights.sample(p[0], p[1], 'base')),
        halfWidth: Math.max((R.ribbonScale * r.widthKm) / 2, Math.max(r.widthKm / 2, 0.5) + R.ribbonMarginKm),
        coreHalf: Math.max(r.widthKm / 2, 0.5),
      })),
      lakes: lakes.map((l) => ({ ring: l.ring, level: l.level })),
      exempt: [...places.values()].filter((p) => p.onRiver).map((p) => ({ x: p.x, z: p.z, r: p.footprintKm ?? 5 })),
      slope: R.stampBankSlope,
    });
    const regions = m.look.regions as LookRegion[];
    for (const r of regions) if (!(r in looksJson.regions)) throw new Error(`looks.json has no preset for region '${r}'`);
    const terrainMask = m.terrain && terrain ? mk(m.terrain, terrain) : null;
    return new World(spec, heights, mk(m.water, water), mk(m.landcover, landcover), mk(m.forests, forests), lookTex, regions, places, rivers, lakes, terrainMask);
  }

  place(id: string): Place {
    const p = this.places.get(id);
    if (!p) throw new Error(`unknown place '${id}'`);
    return p;
  }

  /** Water surface level at (x, z): the lake level if inside a lake polygon, 0 over the sea, else null. */
  waterLevelAt(x: number, z: number): number | null {
    for (const lake of this.lakes) {
      if (lake.level === null) continue;
      let inside = false;
      const r = lake.ring;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, zi] = r[i];
        const [xj, zj] = r[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) return lake.level;
    }
    return this.heights.sample(x, z) < 0 ? 0 : null;
  }

  /** Ground height under a place's display position. */
  groundAt(x: number, z: number): number {
    return this.heights.sample(x, z);
  }
}
