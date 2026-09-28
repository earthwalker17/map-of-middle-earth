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
  },
};
