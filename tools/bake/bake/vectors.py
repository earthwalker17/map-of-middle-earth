"""Canon ME-GIS vector layers (via Arda vectors.gpkg) → antialiased raster masks + river/lake geometry.

Rivers and lakes are rasterised by the hydro step (from the processed river centrelines, so the mask,
the carve and the runtime ribbons share one geometry); this module rasterises the land-cover layers.
"""
from __future__ import annotations

import re
import unicodedata
import warnings

import cv2
import geopandas as gpd
import numpy as np
from affine import Affine
from rasterio import features
from scipy import ndimage
from shapely.geometry import box

from .cache import q8
from .config import Config, Timer

warnings.filterwarnings("ignore", category=RuntimeWarning)

MASK_KEYS = ("forest", "forest_mirkwood", "forest_fangorn", "forest_lorien", "forest_old", "wetland", "vulcanism", "road")


def norm(s) -> str:
    """Accent/encoding-insensitive name key ('Sea of Rh�n' → 'sea of rhn')."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKD", s.replace("�", ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9 ]+", "", s.lower()).strip()


def read(cfg: Config, layer: str, canon: bool = False, margin_km: float = 80) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(cfg.path(*cfg.world["source"]["vectors"].split("/")), layer=layer, engine="pyogrio")
    if canon:
        col = next((c for c in gdf.columns if c.lower() == "origin"), None)
        if col is not None:
            gdf = gdf[gdf[col].fillna("") == ""]
    frame = box((cfg.x0_km - margin_km) * 1000, (cfg.y0_km - margin_km) * 1000, (cfg.x1_km + margin_km) * 1000, (cfg.y1_km + margin_km) * 1000)
    gdf = gdf[gdf.geometry.notna() & gdf.geometry.intersects(frame)]
    return gdf


def raster_mask(cfg: Config, geoms, ss: int = 2, all_touched: bool = False) -> np.ndarray:
    """Antialiased coverage 0..1 (supersampled rasterize → area downsample)."""
    geoms = [g for g in geoms if g is not None and not g.is_empty]
    if not geoms:
        return np.zeros((cfg.H, cfg.W), np.float32)
    t = cfg.transform * Affine.scale(1 / ss)
    m = features.rasterize(((g, 1) for g in geoms), out_shape=(cfg.H * ss, cfg.W * ss), transform=t, fill=0, dtype="uint8", all_touched=all_touched)
    return cv2.resize(m.astype(np.float32), (cfg.W, cfg.H), interpolation=cv2.INTER_AREA)


def raster_mask_window(cfg: Config, geom, pad_px: int, ss: int = 4) -> tuple[int, int, np.ndarray]:
    """Antialiased coverage of one polygon inside its (padded) pixel bbox → (row0, col0, coverage)."""
    x0, y0, x1, y1 = geom.bounds
    c0, r0 = cfg.km_to_px(x0 / 1000, y1 / 1000)
    c1, r1 = cfg.km_to_px(x1 / 1000, y0 / 1000)
    c0 = max(0, int(np.floor(c0)) - pad_px)
    r0 = max(0, int(np.floor(r0)) - pad_px)
    c1 = min(cfg.W, int(np.ceil(c1)) + pad_px)
    r1 = min(cfg.H, int(np.ceil(r1)) + pad_px)
    t = cfg.transform * Affine.translation(c0, r0) * Affine.scale(1 / ss)
    m = features.rasterize([(geom, 1)], out_shape=((r1 - r0) * ss, (c1 - c0) * ss), transform=t, fill=0, dtype="uint8")
    cov = cv2.resize(m.astype(np.float32), (c1 - c0, r1 - r0), interpolation=cv2.INTER_AREA)
    return r0, c0, cov


def line_distance_km(cfg: Config, geoms) -> np.ndarray:
    geoms = [g for g in geoms if g is not None and not g.is_empty]
    if not geoms:
        return np.full((cfg.H, cfg.W), 1e6, np.float32)
    m = features.rasterize(((g, 1) for g in geoms), out_shape=(cfg.H, cfg.W), transform=cfg.transform, fill=0, dtype="uint8", all_touched=True)
    return (ndimage.distance_transform_edt(m == 0) * cfg.px_km).astype(np.float32)


def smooth_band(d_km: np.ndarray, half_width_km: float, aa_km: float) -> np.ndarray:
    """1 inside |d| < half width, smooth falloff over aa."""
    t = np.clip((half_width_km + aa_km - d_km) / (2 * aa_km), 0, 1)
    return (t * t * (3 - 2 * t)).astype(np.float32)


def river_class(cfg: Config, name: str) -> str:
    n = norm(name)
    if not n:
        return "stream"
    classes = cfg.world["rivers"]["classes"]
    for cls in ("great", "major"):
        if any(norm(x) == n for x in classes[cls]):
            return cls
    return "minor"


def canon_rivers(cfg: Config) -> gpd.GeoDataFrame:
    rivers = read(cfg, "Rivers", canon=True).reset_index(drop=True)
    return rivers.assign(cls=[river_class(cfg, n) for n in rivers["name"]])


def canon_lakes(cfg: Config) -> gpd.GeoDataFrame:
    lakes = read(cfg, "lakes", canon=True).reset_index(drop=True)
    return lakes.assign(key=[norm(n) or f"lake{i}" for i, n in enumerate(lakes["NAME"])])


def canon_roads(cfg: Config) -> gpd.GeoDataFrame:
    return read(cfg, "Roads", canon=True).reset_index(drop=True)


def load_masks(cfg: Config) -> dict[str, np.ndarray]:
    """Land-cover masks, quantised to u8 (the export format)."""
    out: dict[str, np.ndarray] = {}
    with Timer("vectors: forests"):
        forests = read(cfg, "forests", canon=True)
        forests = forests.assign(key=[norm(n) for n in forests["name"]])
        wood = forests[forests["type"].fillna("").str.contains("Forest") & ~forests["type"].fillna("").str.contains("Clearing")]
        clear = forests[forests["type"].fillna("").str.contains("Clearing")]
        density = np.clip(raster_mask(cfg, wood.geometry) - raster_mask(cfg, clear.geometry), 0, 1)
        out["forest"] = q8(density)

        def named(prefix: str) -> np.ndarray:
            sub = wood[wood["key"].str.startswith(prefix)]
            return np.clip(raster_mask(cfg, sub.geometry) * density, 0, 1)

        out["forest_mirkwood"] = q8(named("mirkwood"))
        out["forest_fangorn"] = q8(named("fangorn"))
        out["forest_lorien"] = q8(named("lothlorien"))
        dark = np.maximum.reduce([named("old forest"), named("chetwood"), named("druadan"), named("firien")])
        out["forest_old"] = q8(dark)
        print(f"[bake]   forest coverage {density.mean() * 100:.1f}% of frame")

    with Timer("vectors: wetlands, vulcanism, roads"):
        wet = read(cfg, "Wetlands")
        out["wetland"] = q8(raster_mask(cfg, wet.geometry))
        vul = read(cfg, "Vulcanism")
        out["vulcanism"] = q8(raster_mask(cfg, vul.geometry))
        rd = line_distance_km(cfg, canon_roads(cfg).geometry)
        out["road"] = q8(smooth_band(rd, 0.35, 0.3))
    return out
