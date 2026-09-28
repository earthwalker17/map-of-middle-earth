"""Authored look regions (data/world/regions.geojson, ME-GIS km) → soft per-region weight layers."""
from __future__ import annotations

import json

import cv2
import numpy as np
from affine import Affine
from rasterio import features
from shapely.geometry import shape

from .config import Config, Timer


def bake_regions(cfg: Config) -> tuple[list[str], np.ndarray]:
    """Returns (ids ordered by index, weights[L, h, w] summing to 1) at look-mask resolution."""
    ds = cfg.world["heightfield"]["lookMaskDownsample"]
    w, h = cfg.W // ds, cfg.H // ds
    px_km = cfg.px_km * ds
    gj = json.loads(cfg.path("data", "world", "regions.geojson").read_text(encoding="utf-8"))
    feats = sorted(gj["features"], key=lambda f: f["properties"]["index"])
    ids = [f["properties"]["id"] for f in feats]
    assert [f["properties"]["index"] for f in feats] == list(range(len(feats))), "region indices must be 0..N-1"
    t = Affine(px_km, 0, cfg.x0_km, 0, -px_km, cfg.y1_km)  # regions are authored in km
    layers = np.zeros((len(ids), h, w), np.float32)
    with Timer(f"regions: {len(ids)} soft masks"):
        for i, f in enumerate(feats):
            m = features.rasterize([(shape(f["geometry"]), 1)], out_shape=(h, w), transform=t, fill=0, dtype="uint8").astype(np.float32)
            sigma = max(0.5, f["properties"].get("softKm", 30) / px_km / 2.0)
            layers[i] = cv2.GaussianBlur(m, (0, 0), sigma)
        total = layers.sum(axis=0)
        empty = total < 1e-3
        layers[0][empty] = 1.0  # default region
        layers /= np.maximum(layers.sum(axis=0), 1e-6)[None]
    return ids, layers
