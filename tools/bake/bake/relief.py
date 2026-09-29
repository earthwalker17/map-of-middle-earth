"""Metres → exaggerated world-unit relief with bathymetry (before lakes and rivers: `h_pre_rivers`).

Vertical v2 (world.json → vertical):
  • exaggeration  e = E·H·(h/H)^γ of the DEM height above the sea datum;
  • scale split   macro (Gaussian σ = macroSigmaKm) keeps ×1 so ranges tower, the meso band
                  (macro … σ = mesoSigmaKm) is scaled by detailRatio, the micro band (< mesoSigmaKm)
                  by microRatio — ranges read as massive eroded bodies instead of needle fields;
  • valley fix    the low-pass lifts narrow valley floors toward the mountains around them (the
                  lower Anduin's flat DEM floor climbed 1.9 → 6 units). Inside a band around every canon
                  river the relief is pulled back down to the unsplit exaggeration (never raised).
No landmark stamps here: stamps are a TypeScript layer composited by the HeightField at runtime.
"""
from __future__ import annotations

import cv2
import numpy as np
from rasterio import features
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


def exaggerate(cfg: Config, metres: np.ndarray) -> np.ndarray:
    V = cfg.world["vertical"]
    E, gamma, href = V["exaggeration"], V["gamma"], V["referenceKm"]
    hkm = np.clip((metres - float(V["seaLevelMetres"])) / 1000.0, 0, None)
    return (E * href * np.power(hkm / href, gamma)).astype(np.float32)


def valley_band(cfg: Config, rivers) -> np.ndarray:
    """0..1 weight around canon rivers (Gaussian in distance; wider for larger classes)."""
    sig = cfg.world["vertical"].get("valleyBandKm", {"great": 14, "major": 10, "minor": 7, "stream": 5})
    band = np.zeros((cfg.H, cfg.W), np.float32)
    for cls, s in sig.items():
        sub = rivers[rivers["cls"] == cls]
        if sub.empty:
            continue
        m = features.rasterize(((g, 1) for g in sub.geometry), out_shape=(cfg.H, cfg.W), transform=cfg.transform, fill=0, dtype="uint8", all_touched=True)
        d = ndimage.distance_transform_edt(m == 0).astype(np.float32) * cfg.px_km
        np.maximum(band, np.exp(-((d / s) ** 2)), out=band)
        del m, d
    return band


def synthesize_relief(cfg: Config, metres: np.ndarray, land: np.ndarray, rivers) -> np.ndarray:
    V = cfg.world["vertical"]
    seed = cfg.world["seeds"]["world"]

    with Timer("relief: exaggeration, scale split, valley fix"):
        raw = exaggerate(cfg, metres)
        macro = ndimage.gaussian_filter(raw, V.get("macroSigmaKm", 12) / cfg.px_km)
        meso_s = V.get("mesoSigmaKm")
        if meso_s:
            meso = ndimage.gaussian_filter(raw, meso_s / cfg.px_km)
            split = macro + (meso - macro) * V.get("detailRatio", 0.45) + (raw - meso) * V.get("microRatio", 0.45)
            del meso
        else:
            split = macro + (raw - macro) * V.get("detailRatio", 0.45)
        del macro
        band = valley_band(cfg, rivers)
        # only ever lowers: cells the low-pass lifted above their own exaggerated height sink back
        land_h = split - band * np.maximum(split - raw, 0)
        land_h = np.maximum(land_h, 0).astype(np.float32)
        lift = split - land_h
        print(f"[bake]   valley fix: lowered {int((lift > 0.25).sum() * cfg.px_km ** 2)} km² by >0.25 (max {float(lift.max()):.2f})")
        del raw, split, band, lift

    with Timer("relief: bathymetry"):
        land_b = land >= 0.5
        d_sea = (ndimage.distance_transform_edt(~land_b) * cfg.px_km).astype(np.float32)
        sl = float(V["seaLevelMetres"])
        # bathymetry: DEM shelf depth below the datum, deepened with distance offshore
        d_dem = np.clip((sl - metres) / sl, 0, 1)
        d_dist = 1 - np.exp(-d_sea / V["shelfWidthKm"])
        floor_noise = value_noise(cfg, 40, seed) * 0.35 + value_noise(cfg, 12, seed + 1) * 0.12
        depth = V["seaFloorDepth"] * np.maximum(d_dist * 0.9, np.power(d_dem, 0.8)) + 0.12
        sea = -depth + floor_noise * smoothstep(2, 30, d_sea)
        t = smoothstep(0.3, 0.7, land)
        h = (sea * (1 - t) + np.maximum(land_h, 0.1) * t).astype(np.float32)
    print(f"[bake] relief: {float(h.min()):.2f} .. {float(h.max()):.2f} world units")
    return h
