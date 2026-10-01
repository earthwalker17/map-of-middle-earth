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
/**
 * what a missing layer falls back to (preview has 4 layers): ash → the broken stony grain of the rock
 * layer (withered grass on Gorgoroth read as a field), under the procedural crust (volcanic.ts)
 */
export const DETAIL_FALLBACK: Record<DetailLayer, DetailLayer> = { meadow: 'meadow', dry: 'dry', rock: 'rock', snow: 'snow', scree: 'rock', ash: 'rock' };

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
 * What the terrain detail load did (static data of the page, set once at init): the capture API
 * asserts on it (render/capture.ts), so a capture never silently renders the procedural fallback.
 */
export const terrainDetailStatus: { wanted: boolean; loaded: boolean; error: string } = { wanted: false, loaded: false, error: '' };

/** A missing / failed terrain detail set where the tier needs it. */
export function terrainDetailError(): string | null {
  const s = terrainDetailStatus;
  return s.wanted && !s.loaded ? `terrain detail textures failed to load (${s.error || 'unknown'}) — run \`node tools/textures/prep.mjs\` (public/textures/terrain)` : null;
}

/**
 * Load the tier's detail layers (size ≤ tier size, first `layers` layers). Returns null when the
 * tier disables them (layers 0). Missing or failed files: review / final tiers throw (the offline
 * look must never degrade silently); preview falls back to procedural micro-detail with a warning,
 * and the capture API refuses to render it (terrainDetailError).
 */
export async function loadTerrainDetail(quality: QualityTier): Promise<TerrainDetail | null> {
  const want = quality.terrainDetail;
  terrainDetailStatus.wanted = !!(want.layers && want.size);
  terrainDetailStatus.loaded = false;
  terrainDetailStatus.error = '';
  if (!terrainDetailStatus.wanted) return null;
  const fail = (why: string): null => {
    terrainDetailStatus.error = why;
    const msg = terrainDetailError()!;
    if (quality.id !== 'preview') throw new Error(`[terrain] ${msg}`);
    console.warn(`[terrain] ${msg}; using procedural detail`);
    return null;
  };
  let man: DetailManifest;
  try {
    const res = await fetch('/textures/terrain/detail.json');
    if (!res.ok) throw new Error(`detail.json ${res.status}`);
    man = (await res.json()) as DetailManifest;
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  const sizes = [...man.sizes].sort((a, b) => a - b);
  const size = sizes.filter((s) => s <= want.size).pop() ?? sizes[0];
  let res: Response;
  try {
    res = await fetch(`/textures/terrain/detail-${size}.bin`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) return fail(`detail-${size}.bin ${res.status}`);
  const all = new Uint8Array(await res.arrayBuffer());
  const per = size * size * 4;
  const count = Math.min(want.layers, man.layers.length, Math.floor(all.length / per));
  // a dev server answers a missing file with its HTML fallback (200): too short to hold a layer
  if (count < 1) return fail(`detail-${size}.bin holds no ${size}² layer (${all.length} bytes)`);
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
  terrainDetailStatus.loaded = true;
  return { texture: tex, size, layers: count, index };
}
