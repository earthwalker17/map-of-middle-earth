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


def remove_sea_ridges(cfg: Config, metres: np.ndarray, land: np.ndarray) -> np.ndarray:
    """Declared DEM artefacts under the sea (world.json vertical.seaArtefacts): inside each corridor the
    sea floor is replaced by its grey opening (disc of radiusKm), which removes ridges narrower than the
    disc while keeping every shelf that is wider or attached to land (land counts as the datum)."""
    arts = cfg.world["vertical"].get("seaArtefacts", [])
    if not arts:
        return metres
    out = metres.copy()
    datum = float(cfg.world["vertical"]["seaLevelMetres"])
    for a in arts:
        (xa, ya), (xb, yb) = a["fromKm"], a["toKm"]
        half, feather, rad = 0.5 * float(a["widthKm"]), float(a.get("featherKm", 3.0)), float(a.get("radiusKm", 3.0))
        pad = half + feather + rad + 1
        c0, r0 = cfg.km_to_px(min(xa, xb) - pad, max(ya, yb) + pad)
        c1, r1 = cfg.km_to_px(max(xa, xb) + pad, min(ya, yb) - pad)
        c0, r0 = max(0, int(c0)), max(0, int(r0))
        c1, r1 = min(cfg.W, int(np.ceil(c1))), min(cfg.H, int(np.ceil(r1)))
        win = (slice(r0, r1), slice(c0, c1))
        sea = land[win] < 0.5
        m = np.where(sea, np.minimum(metres[win], datum), datum).astype(np.float32)
        r = max(1, int(round(rad / cfg.px_km)))
        yy, xx = np.mgrid[-r : r + 1, -r : r + 1]
        opened = ndimage.grey_opening(m, footprint=(xx * xx + yy * yy) <= r * r)
        rr, cc = np.mgrid[r0:r1, c0:c1]
        px = cfg.x0_km + (cc + 0.5) * cfg.px_km
        py = cfg.y1_km - (rr + 0.5) * cfg.px_km
        ex, ey = xb - xa, yb - ya
        t = np.clip(((px - xa) * ex + (py - ya) * ey) / (ex * ex + ey * ey), 0, 1)
        d = np.hypot(px - (xa + ex * t), py - (ya + ey * t))
        w = 1 - smoothstep(half, half + feather, d)
        fixed = metres[win] + (np.minimum(metres[win], opened) - metres[win]) * w
        out[win] = np.where(sea, fixed, metres[win])
        print(f"[bake]   sea artefact '{a['name']}': lowered {int(((metres[win] - out[win]) > 20).sum() * cfg.px_km ** 2)} km² by > 20 m (max {float((metres[win] - out[win]).max()):.0f} m)")
    return out


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
        metres = remove_sea_ridges(cfg, metres, land)
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
