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
}

export interface Place extends PlaceDef {
  /** display position in world units (canonical + offset) */
  x: number;
  z: number;
  /** canonical position in world units */
  cx: number;
  cz: number;
}

export interface RiverLine {
  name: string | null;
  cls: 'great' | 'major' | 'minor' | 'stream';
  widthKm: number;
  points: [number, number][];
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
  ) {}

  static async load(onProgress?: (msg: string) => void): Promise<World> {
    onProgress?.('world manifest');
    const spec = await WorldSpec.load();
    const m = spec.manifest.files;
    onProgress?.('heightfield');
    const [heights, water, landcover, forests, look, rivers, lakes] = await Promise.all([
      HeightField.load(spec),
      fetchBin(m.water.file),
      fetchBin(m.landcover.file),
      fetchBin(m.forests.file),
      fetchBin(m.look.file),
      fetch(`/world/${m.rivers.file}`).then((r) => r.json() as Promise<RiverLine[]>),
      fetch(`/world/${m.lakes.file}`).then((r) => r.json() as Promise<LakePoly[]>),
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
    const regions = m.look.regions as LookRegion[];
    for (const r of regions) if (!(r in looksJson.regions)) throw new Error(`looks.json has no preset for region '${r}'`);
    return new World(spec, heights, mk(m.water, water), mk(m.landcover, landcover), mk(m.forests, forests), lookTex, regions, places, rivers, lakes);
  }

  place(id: string): Place {
    const p = this.places.get(id);
    if (!p) throw new Error(`unknown place '${id}'`);
    return p;
  }

  /** Ground height under a place's display position. */
  groundAt(x: number, z: number): number {
    return this.heights.sample(x, z);
  }
}
