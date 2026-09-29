/**
 * Quality tiers. The interactive preview must stay usable on an Intel UHD iGPU; stills and film
 * frames are rendered offline where seconds per frame are acceptable.
 */
export type QualityTierId = 'preview' | 'review' | 'final';

export interface QualityTier {
  id: QualityTierId;
  /** multiplier on devicePixelRatio for the interactive canvas */
  pixelRatio: number;
  /** MSAA samples on the HDR scene target (0 = off; offline uses jitter accumulation instead) */
  msaa: number;
  /** default accumulation samples per output frame (jittered AA, sub-frame motion blur) */
  spp: number;
  terrain: {
    /** quads per patch edge */
    patchGrid: number;
    /** LOD distance multiplier: larger = finer detail further away */
    lodRangeK: number;
  };
  shadowMapSize: number;
  bloom: boolean;
  /** 0..1 scale on particle counts / instance densities */
  density: number;
  /** terrain ground-detail texture arrays (CC0 layers): texel size per layer and layer budget */
  terrainDetail: { size: number; layers: number };
  /** aerial perspective: per-channel extinction + sun in-scatter (false = plain height fog) */
  atmosphere: { inScatter: boolean };
  /** cloud shadows on the landscape; visible cloud layer in the sky/above the slab */
  clouds: { shadows: boolean; layer: boolean };
}

export const QUALITY: Record<QualityTierId, QualityTier> = {
  preview: {
    id: 'preview',
    pixelRatio: 0.85,
    msaa: 0,
    spp: 1,
    terrain: { patchGrid: 32, lodRangeK: 2.0 },
    shadowMapSize: 2048,
    bloom: true,
    density: 0.35,
    terrainDetail: { size: 512, layers: 4 },
    atmosphere: { inScatter: true },
    clouds: { shadows: true, layer: false },
  },
  review: {
    id: 'review',
    pixelRatio: 1,
    msaa: 0,
    spp: 4,
    terrain: { patchGrid: 64, lodRangeK: 2.6 },
    shadowMapSize: 4096,
    bloom: true,
    density: 0.75,
    terrainDetail: { size: 512, layers: 6 },
    atmosphere: { inScatter: true },
    clouds: { shadows: true, layer: true },
  },
  final: {
    id: 'final',
    pixelRatio: 1,
    msaa: 0,
    spp: 12,
    terrain: { patchGrid: 64, lodRangeK: 3.2 },
    shadowMapSize: 4096,
    bloom: true,
    density: 1,
    terrainDetail: { size: 1024, layers: 6 },
    atmosphere: { inScatter: true },
    clouds: { shadows: true, layer: true },
  },
};
