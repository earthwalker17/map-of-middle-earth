"""terrain.rgba8 (half resolution, row 0 = north) — the terrain analysis contract of BakedManifest.files.terrain:

  R  large-scale ambient occlusion from 16-direction horizon angles out to 30 km (1 = open sky)
  G  valley index / multi-scale TPI: 0.5 flat, < 0.5 valley or hollow, > 0.5 ridge or crest
  B  wetness: proximity to rivers and lakes, fading with height above the nearest water level
  A  flow accumulation: log upstream area (Priority-Flood+ε / D8), 1 ≈ the Anduin at its mouth
"""
from __future__ import annotations

import cv2
import numpy as np
from scipy import ndimage

from .cache import f8, q8
from .config import Config, Timer
from .flow import flow_accum, horizon_ao

CHANNELS = ["ao", "valley", "wetness", "flow"]


def terrain_mask(cfg: Config, hy: dict) -> dict[str, np.ndarray]:
    h = hy["height"].astype(np.float32)
    w2, h2 = cfg.W // 2, cfg.H // 2
    px2 = cfg.px_km * 2
    small = cv2.resize(h, (w2, h2), interpolation=cv2.INTER_AREA)
    land = small > 0

    with Timer("mask: horizon AO"):
        n = 16
        a = (np.arange(n) + 0.5) * (2 * np.pi / n)
        dirs = np.stack([np.cos(a), np.sin(a)], axis=1).astype(np.float64)
        ao = horizon_ao(np.maximum(small, 0).astype(np.float64), px2, dirs, 30.0)
        ao = np.where(land, ao, 1.0).astype(np.float32)

    with Timer("mask: valley index"):
        tpi = np.zeros_like(small)
        for s_km, wgt, k in ((2.0, 0.45, 0.35), (6.0, 0.35, 0.9), (18.0, 0.2, 2.2)):
            tpi += wgt * np.tanh((small - ndimage.gaussian_filter(small, s_km / px2)) / k)
        valley = np.where(land, 0.5 + 0.5 * tpi, 0.5).astype(np.float32)

    with Timer("mask: wetness"):
        dist = hy["river_dist"].astype(np.float32)
        above = np.maximum(0.0, h - hy["near_level"])
        river_wet = np.exp(-dist / 1.2) * np.clip(1.0 - above / 1.2, 0, 1)
        lake = f8(hy["lake"]) > 0.5
        d_lake = ndimage.distance_transform_edt(~lake).astype(np.float32) * cfg.px_km
        lake_wet = np.where(lake, 1.0, np.exp(-d_lake / 1.5))
        wet_full = np.maximum(river_wet, lake_wet).astype(np.float32)
        wet = cv2.resize(wet_full, (w2, h2), interpolation=cv2.INTER_AREA)
        del dist, above, river_wet, d_lake, lake_wet, wet_full

    with Timer("mask: flow accumulation"):
        acc = flow_accum(small.astype(np.float64), ~land, px2 * px2)
        ref = max(float(acc[land].max()) if land.any() else 1.0, 1.0)
        flow = np.where(land, np.log1p(acc) / np.log1p(ref), 0.0).astype(np.float32)

    print(f"[bake]   AO mean {float(ao[land].mean()):.3f}, valley p5/p95 {np.percentile(valley[land], 5):.2f}/{np.percentile(valley[land], 95):.2f}, flow max {ref:.0f} km²")
    return {"ao": q8(ao), "valley": q8(valley), "wetness": q8(wet), "flow": q8(flow)}
