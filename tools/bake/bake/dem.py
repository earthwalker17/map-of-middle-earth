"""Read the Arda 32k UInt16 DEM over the world frame → metres above sea + land fraction.

The 16-bit data carries a tone curve relative to the metric 8-bit ME-DEM (19.05 m/grey level);
we invert the measured table (world.json → vertical.demCalibration) per source pixel, then
area-average down to the heightfield resolution in horizontal strips (bounded memory).
"""
from __future__ import annotations

import cv2
import numpy as np
import rasterio
from rasterio.windows import Window

from .config import Config, Timer


def read_dem(cfg: Config, strip_rows: int = 160) -> tuple[np.ndarray, np.ndarray]:
    cache_h = cfg.cache / f"dem_metres_{cfg.W}x{cfg.H}.npy"
    cache_l = cfg.cache / f"dem_land_{cfg.W}x{cfg.H}.npy"
    if cache_h.exists() and cache_l.exists():
        print("[bake] dem: using cache")
        return np.load(cache_h), np.load(cache_l)

    cal = cfg.world["vertical"]["demCalibration"]
    u16 = np.asarray(cal["u16"], dtype=np.float32)
    grey = np.asarray(cal["grey"], dtype=np.float32)
    m_per_grey = float(cal["metresPerGrey"])

    metres = np.zeros((cfg.H, cfg.W), np.float32)
    land = np.zeros((cfg.H, cfg.W), np.float32)
    with Timer("dem read + calibrate + resample"), rasterio.open(cfg.path(*cfg.world["source"]["dem"].split("/"))) as src:
        st = src.transform
        src_px = st.a
        for r0 in range(0, cfg.H, strip_rows):
            r1 = min(cfg.H, r0 + strip_rows)
            top_m = cfg.y1_km * 1000 - r0 * cfg.px_m
            bot_m = cfg.y1_km * 1000 - r1 * cfg.px_m
            col_off = (cfg.x0_km * 1000 - st.c) / src_px
            row_off = (st.f - top_m) / src_px
            win = Window(round(col_off), round(row_off), round((cfg.x1_km - cfg.x0_km) * 1000 / src_px), round((top_m - bot_m) / src_px))
            data = src.read(1, window=win, boundless=True, fill_value=0)
            m = np.interp(data.astype(np.float32), u16, grey).astype(np.float32) * m_per_grey
            lm = (data > 0).astype(np.float32)
            metres[r0:r1] = cv2.resize(m, (cfg.W, r1 - r0), interpolation=cv2.INTER_AREA)
            land[r0:r1] = cv2.resize(lm, (cfg.W, r1 - r0), interpolation=cv2.INTER_AREA)
            print(f"[bake]   rows {r0:4d}-{r1:4d} / {cfg.H}", flush=True)
    np.save(cache_h, metres)
    np.save(cache_l, land)
    print(f"[bake] dem: metres {metres.min():.0f}..{metres.max():.0f}, land {land.mean() * 100:.1f}%")
    return metres, land
