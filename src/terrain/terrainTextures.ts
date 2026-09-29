import { DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three/webgpu';
import type { QualityTier } from '../core/quality.ts';

/**
 * Terrain ground-detail layers (CC0 Poly Haven sets, see CREDITS.md), prepared offline by
 * tools/textures/prep.mjs into public/textures/terrain/ (derived, gitignored):
 *   detail.json          layer order + sources + sizes
 *   detail-<size>.bin    raw RGBA8, layers concatenated: R, G = tangent-space normal x, y (0.5 = flat),
 *                        B = luminance detail (high-passed ratio / 2: 0.5 = ×1), A = height (0..1)
 * The detail is luminance-only on purpose: the regional palette keeps the hue at every distance, the
 * layers only add grain, micro relief and height-blended transitions (rock through snow).
 * Layers are listed in priority order; a tier with fewer layers keeps the first N and maps the
 * rest onto a fallback (DETAIL_FALLBACK).
 */
export const DETAIL_LAYERS = ['meadow', 'dry', 'rock', 'snow', 'scree', 'ash'] as const;
export type DetailLayer = (typeof DETAIL_LAYERS)[number];
/** what a missing layer falls back to (preview has 4 layers) */
export const DETAIL_FALLBACK: Record<DetailLayer, DetailLayer> = { meadow: 'meadow', dry: 'dry', rock: 'rock', snow: 'snow', scree: 'rock', ash: 'dry' };

export interface TerrainDetail {
  texture: DataArrayTexture;
  size: number;
  layers: number;
  /** array index of a layer (after the tier's fallback) */
  index(layer: DetailLayer): number;
}

interface DetailManifest {
  version: number;
  layers: { id: DetailLayer; source: string }[];
  sizes: number[];
}

/**
 * Load the tier's detail layers (size ≤ tier size, first `layers` layers). Returns null (and the
 * terrain falls back to procedural micro-detail) when the derived files are missing or the tier
 * disables them (layers 0).
 */
export async function loadTerrainDetail(quality: QualityTier): Promise<TerrainDetail | null> {
  const want = quality.terrainDetail;
  if (!want.layers || !want.size) return null;
  let man: DetailManifest;
  try {
    const res = await fetch('/textures/terrain/detail.json');
    if (!res.ok) throw new Error(String(res.status));
    man = (await res.json()) as DetailManifest;
  } catch {
    console.warn('[terrain] no ground-detail textures (public/textures/terrain) — run `node tools/textures/prep.mjs`; using procedural detail');
    return null;
  }
  const sizes = [...man.sizes].sort((a, b) => a - b);
  const size = sizes.filter((s) => s <= want.size).pop() ?? sizes[0];
  const res = await fetch(`/textures/terrain/detail-${size}.bin`);
  if (!res.ok) {
    console.warn(`[terrain] missing detail-${size}.bin; using procedural detail`);
    return null;
  }
  const all = new Uint8Array(await res.arrayBuffer());
  const per = size * size * 4;
  const count = Math.min(want.layers, man.layers.length, Math.floor(all.length / per));
  const ids = man.layers.slice(0, count).map((l) => l.id);
  const data = count * per === all.length ? all : all.slice(0, count * per);
  const tex = new DataArrayTexture(data, size, size, count);
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.colorSpace = NoColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.name = `terrain-detail-${size}`;
  tex.needsUpdate = true;
  const index = (layer: DetailLayer): number => {
    let l: DetailLayer = layer;
    for (let k = 0; k < 3 && !ids.includes(l); k++) l = DETAIL_FALLBACK[l];
    const i = ids.indexOf(l);
    return i >= 0 ? i : 0;
  };
  return { texture: tex, size, layers: count, index };
}
