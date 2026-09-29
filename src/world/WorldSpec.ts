import worldJson from '../../data/world/world.json';

export interface MaskFile {
  file: string;
  format: 'rgba8';
  width: number;
  height: number;
  channels: string[];
}

/** Shape of data/baked/manifest.json (written by tools/bake/bake/export.py). */
export interface BakedManifest {
  version: number;
  createdAt: string;
  frame: { xMinKm: number; xMaxKm: number; yMinKm: number; yMaxKm: number };
  centreKm: [number, number];
  world: { xMin: number; xMax: number; zMin: number; zMax: number };
  kmPerPixel: number;
  files: {
    height: { file: string; format: 'u16le'; width: number; height: number; min: number; max: number; sha256: string };
    water: MaskFile;
    landcover: MaskFile;
    forests: MaskFile;
    /**
     * Bake v2 (optional): terrain analysis mask, RGBA8, typically half resolution (2000×1200).
     * R = large-scale ambient occlusion (1 = open), G = valley index / TPI (0.5 = flat, <0.5 valley,
     * >0.5 ridge), B = wetness (proximity to rivers/lakes), A = reserved (flow accumulation).
     * Curvature at landmark stamps is computed at runtime from the heightfield instead.
     */
    terrain?: MaskFile;
    look: { file: string; format: 'rgba8'; layers: number; tileWidth: number; tileHeight: number; regions: string[] };
    rivers: { file: string; count: number };
    lakes: { file: string; count: number };
    roads: { file: string; count: number };
  };
  lakes: { key: string; level: number; areaKm2: number }[];
}

export type WorldJson = typeof worldJson;

/**
 * Coordinate systems:
 *  - ME-GIS km: [x east, y north] — how every source datum and data/world/*.json is authored
 *  - world:     X east, Y up, Z south (−Z north), 1 unit = 1 km, origin at the frame centre
 *  - map uv:    u = 0..1 west→east, v = 0..1 north→south (texture row 0 = north)
 */
export class WorldSpec {
  readonly json: WorldJson = worldJson;
  readonly cx: number;
  readonly cy: number;
  readonly xMin: number;
  readonly xMax: number;
  readonly zMin: number;
  readonly zMax: number;

  constructor(readonly manifest: BakedManifest) {
    const f = worldJson.frame;
    this.cx = (f.xMinKm + f.xMaxKm) / 2;
    this.cy = (f.yMinKm + f.yMaxKm) / 2;
    this.xMin = f.xMinKm - this.cx;
    this.xMax = f.xMaxKm - this.cx;
    this.zMin = this.cy - f.yMaxKm;
    this.zMax = this.cy - f.yMinKm;
    const m = manifest.world;
    if (Math.abs(m.xMin - this.xMin) > 1e-6 || Math.abs(m.zMax - this.zMax) > 1e-6) {
      throw new Error('Baked data frame does not match data/world/world.json — run `pnpm bake`');
    }
  }

  static async load(): Promise<WorldSpec> {
    const res = await fetch('/world/manifest.json');
    if (!res.ok) throw new Error('Missing baked world (/world/manifest.json) — run `pnpm data:fetch && pnpm bake`');
    return new WorldSpec((await res.json()) as BakedManifest);
  }

  get width(): number {
    return this.xMax - this.xMin;
  }
  get depth(): number {
    return this.zMax - this.zMin;
  }

  /** ME-GIS km → world [X, Z]. */
  kmToWorld(xKm: number, yKm: number): [number, number] {
    return [xKm - this.cx, this.cy - yKm];
  }

  worldToKm(x: number, z: number): [number, number] {
    return [x + this.cx, this.cy - z];
  }

  worldToUv(x: number, z: number): [number, number] {
    return [(x - this.xMin) / this.width, (z - this.zMin) / this.depth];
  }

  inFrame(x: number, z: number): boolean {
    return x >= this.xMin && x <= this.xMax && z >= this.zMin && z <= this.zMax;
  }
}
