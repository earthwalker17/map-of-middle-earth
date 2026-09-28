"""Canon ME-GIS vector layers (via Arda vectors.gpkg) → antialiased raster masks + river/lake geometry."""
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

from .config import Config, Timer

warnings.filterwarnings("ignore", category=RuntimeWarning)


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


def load_vectors(cfg: Config) -> dict:
    out: dict = {}
    widths = cfg.world["rivers"]["widthKm"]

    with Timer("vectors: rivers"):
        rivers = read(cfg, "Rivers", canon=True)
        rivers = rivers.assign(cls=[river_class(cfg, n) for n in rivers["name"]])
        channel = np.zeros((cfg.H, cfg.W), np.float32)
        valley = np.zeros((cfg.H, cfg.W), np.float32)
        nearest = np.full((cfg.H, cfg.W), 1e6, np.float32)
        for cls in ("great", "major", "minor", "stream"):
            sub = rivers[rivers["cls"] == cls]
            if sub.empty:
                continue
            d = line_distance_km(cfg, sub.geometry)
            w = widths[cls]
            channel = np.maximum(channel, smooth_band(d, w / 2, max(cfg.px_km * 0.75, w * 0.25)))
            valley = np.maximum(valley, np.exp(-((d / (w * 2.5 + 2.0)) ** 2)).astype(np.float32))
            nearest = np.minimum(nearest, d)
        out["river_channel"] = channel
        out["river_valley"] = valley
        out["river_dist_km"] = nearest
        out["rivers_gdf"] = rivers
        print(f"[bake]   canon rivers: {len(rivers)} ({dict(rivers['cls'].value_counts())})")

    with Timer("vectors: lakes"):
        lakes = read(cfg, "lakes", canon=True)
        lakes = lakes.assign(key=[norm(n) for n in lakes["NAME"]])
        out["lakes_gdf"] = lakes
        out["lake_masks"] = {row.key or f"lake{i}": raster_mask(cfg, [row.geometry]) for i, row in enumerate(lakes.itertuples())}
        print(f"[bake]   canon lakes: {list(out['lake_masks'].keys())}")

    with Timer("vectors: forests"):
        forests = read(cfg, "forests", canon=True)
        forests = forests.assign(key=[norm(n) for n in forests["name"]])
        wood = forests[forests["type"].fillna("").str.contains("Forest") & ~forests["type"].fillna("").str.contains("Clearing")]
        clear = forests[forests["type"].fillna("").str.contains("Clearing")]
        density = np.clip(raster_mask(cfg, wood.geometry) - raster_mask(cfg, clear.geometry), 0, 1)
        out["forest"] = density

        def named(prefix: str) -> np.ndarray:
            sub = wood[wood["key"].str.startswith(prefix)]
            return np.clip(raster_mask(cfg, sub.geometry) * density, 0, 1)

        out["forest_mirkwood"] = named("mirkwood")
        out["forest_fangorn"] = named("fangorn")
        out["forest_lorien"] = named("lothlorien")
        dark = np.maximum.reduce([named("old forest"), named("chetwood"), named("druadan"), named("firien")])
        out["forest_old"] = dark
        print(f"[bake]   forest coverage {density.mean() * 100:.1f}% of frame")

    with Timer("vectors: wetlands, vulcanism, roads"):
        wet = read(cfg, "Wetlands")
        out["wetland"] = raster_mask(cfg, wet.geometry)
        vul = read(cfg, "Vulcanism")
        out["vulcanism"] = raster_mask(cfg, vul.geometry)
        roads = read(cfg, "Roads", canon=True)
        out["roads_gdf"] = roads
        rd = line_distance_km(cfg, roads.geometry)
        out["road"] = smooth_band(rd, 0.35, 0.3)
    return out
