"""Metres + masks → exaggerated world-unit heightfield with bathymetry, lakes and river carving.

No landmark stamps here: stamps are a separate TypeScript layer composited by the HeightField
service at runtime (so landmark tuning never needs a re-bake).
"""
from __future__ import annotations

import cv2
import numpy as np
from scipy import ndimage

from .config import Config, Timer


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def value_noise(cfg: Config, scale_km: float, seed: int) -> np.ndarray:
    """Smooth deterministic noise in [-1, 1] at a given feature size (bicubic-upsampled lattice)."""
    rng = np.random.default_rng(seed)
    gw = max(2, int(cfg.W * cfg.px_km / scale_km) + 3)
    gh = max(2, int(cfg.H * cfg.px_km / scale_km) + 3)
    lattice = rng.uniform(-1, 1, (gh, gw)).astype(np.float32)
    return cv2.resize(lattice, (cfg.W, cfg.H), interpolation=cv2.INTER_CUBIC)


def synthesize(cfg: Config, metres: np.ndarray, land: np.ndarray, vec: dict) -> tuple[np.ndarray, dict]:
    V = cfg.world["vertical"]
    E, gamma, href = V["exaggeration"], V["gamma"], V["referenceKm"]
    seed = cfg.world["seeds"]["world"]
    info: dict = {}

    with Timer("terrain: exaggeration + bathymetry"):
        sl = float(V["seaLevelMetres"])
        hkm = np.clip((metres - sl) / 1000.0, 0, None)
        land_h = (E * href * np.power(hkm / href, gamma)).astype(np.float32)
        # scale-split exaggeration: massifs keep full lift, local relief is compressed
        sigma = V.get("macroSigmaKm", 12) / cfg.px_km
        macro = ndimage.gaussian_filter(land_h, sigma)
        land_h = (macro + (land_h - macro) * V.get("detailRatio", 0.45)).astype(np.float32)
        land_h = np.maximum(land_h, 0)
        land_b = land >= 0.5
        d_sea = ndimage.distance_transform_edt(~land_b) * cfg.px_km
        # bathymetry: DEM shelf depth below the datum, deepened with distance offshore
        d_dem = np.clip((sl - metres) / sl, 0, 1)
        d_dist = 1 - np.exp(-d_sea / V["shelfWidthKm"])
        floor_noise = value_noise(cfg, 40, seed) * 0.35 + value_noise(cfg, 12, seed + 1) * 0.12
        depth = V["seaFloorDepth"] * np.maximum(d_dist * 0.9, np.power(d_dem, 0.8)) + 0.12
        sea = -depth + floor_noise * smoothstep(2, 30, d_sea)
        t = smoothstep(0.3, 0.7, land)
        h = (sea * (1 - t) + np.maximum(land_h, 0.1) * t).astype(np.float32)

    with Timer("terrain: lakes"):
        lakes_info = []
        for key, mask in vec["lake_masks"].items():
            inside = mask > 0.5
            if inside.sum() < 4:
                continue
            ring = cv2.dilate(inside.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & ~inside
            level = float(np.percentile(h[ring], 15))
            d_shore = ndimage.distance_transform_edt(inside) * cfg.px_km
            bed = level - np.minimum(1.2, 0.05 + d_shore * 0.05)
            cov = np.clip(mask, 0, 1)
            h = np.where(cov > 0, h * (1 - cov) + np.minimum(h, bed) * cov, h).astype(np.float32)
            lakes_info.append({"key": key, "level": round(level, 4), "areaKm2": round(float(inside.sum()) * cfg.px_km**2, 1)})
        info["lakes"] = lakes_info

    with Timer("terrain: river carving"):
        above = h > 0.05
        carve = vec["river_channel"] * 0.35 + vec["river_valley"] * 0.18
        h = np.where(above, np.maximum(h - carve, 0.02), h).astype(np.float32)

    info["min"] = float(h.min())
    info["max"] = float(h.max())
    print(f"[bake] terrain: height range {info['min']:.2f} .. {info['max']:.2f} world units")
    return h, info
