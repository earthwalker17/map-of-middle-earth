"""Land/sea classification.

The ME-DEM datum is NOT sea level = 0: DEM 0 is the deep ocean floor and sea level sits at
16 grey levels (304.8 m) — coastline vectors sample at a median of exactly that value, the DEM
carries shelf bathymetry below it, and enclosed seas (Bay of Belfalas) are flat floors at ~239 m.
Sea = pixels below the datum that are connected to a known sea seed (so inland depressions stay
land), with the rasterized coastline acting as an extra barrier.
"""
from __future__ import annotations

import cv2
import numpy as np
from rasterio import features
from scipy import ndimage

from .config import Config, Timer
from .vectors import read


def sea_level_m(cfg: Config) -> float:
    return float(cfg.world["vertical"]["seaLevelMetres"])


def land_fraction(cfg: Config, metres: np.ndarray, ss: int = 2) -> np.ndarray:
    seeds = cfg.world["coast"]["seaSeedsKm"]
    sl = sea_level_m(cfg)
    with Timer("coast: sea = below-datum regions connected to sea seeds"):
        # supersample heights for a smoother (antialiased) coastline
        up = cv2.resize(metres, (cfg.W * ss, cfg.H * ss), interpolation=cv2.INTER_LINEAR)
        below = up < sl
        lines = read(cfg, "Coastline")
        from affine import Affine

        t = cfg.transform * Affine.scale(1 / ss)
        barrier = features.rasterize(((g, 1) for g in lines.geometry), out_shape=up.shape, transform=t, fill=0, dtype="uint8", all_touched=True).astype(bool)
        labels, _ = ndimage.label(below & ~barrier)
        keep = set()
        for x, y in seeds:
            c, r = cfg.km_to_px(x, y)
            r, c = int(r * ss), int(c * ss)
            if 0 <= r < up.shape[0] and 0 <= c < up.shape[1] and labels[r, c] > 0:
                keep.add(int(labels[r, c]))
        sea = np.isin(labels, list(keep))
        # coastline barrier pixels: assign sea where they touch sea and lie below the datum
        sea |= barrier & below & ndimage.binary_dilation(sea, iterations=2)
        land = 1.0 - cv2.resize(sea.astype(np.float32), (cfg.W, cfg.H), interpolation=cv2.INTER_AREA)
        print(f"[bake]   sea level {sl:.1f} m; {len(keep)} sea regions; land {land.mean() * 100:.1f}%")
    return land.astype(np.float32)
