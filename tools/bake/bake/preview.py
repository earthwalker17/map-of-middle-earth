"""Human-inspectable previews: shaded relief with water, forests, rivers and canonical places."""
from __future__ import annotations

import json

import cv2
import numpy as np
from PIL import Image

from .config import Config, Timer


def hillshade(h: np.ndarray, px: float, az_deg: float = 315, alt_deg: float = 40, z: float = 1.0) -> np.ndarray:
    gy, gx = np.gradient(h * z, px)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az = np.radians(az_deg)
    alt = np.radians(alt_deg)
    s = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(s, 0, 1).astype(np.float32)


def render_preview(cfg: Config, h: np.ndarray, forest: np.ndarray, lake: np.ndarray, channel: np.ndarray, name: str = "relief") -> None:
    with Timer("preview"):
        shade = hillshade(h, cfg.px_km, z=1.0)
        land_t = np.clip(h / 45.0, 0, 1)[..., None]
        low = np.array([0.46, 0.55, 0.32])
        mid = np.array([0.62, 0.58, 0.42])
        high = np.array([0.92, 0.92, 0.94])
        col = np.where(land_t < 0.5, low + (mid - low) * (land_t / 0.5), mid + (high - mid) * ((land_t - 0.5) / 0.5))
        forest = forest[..., None]
        col = col * (1 - forest * 0.55) + np.array([0.18, 0.3, 0.16]) * forest * 0.55
        col = col * (0.35 + 0.8 * shade[..., None])
        sea = (h <= 0)[..., None]
        depth = np.clip(-h / 6.0, 0, 1)[..., None]
        water_col = np.array([0.35, 0.55, 0.62]) * (1 - depth) + np.array([0.08, 0.18, 0.3]) * depth
        col = np.where(sea, water_col, col)
        river = np.maximum(channel, lake)[..., None]
        col = col * (1 - river) + np.array([0.2, 0.42, 0.62]) * river
        img = (np.clip(col, 0, 1) * 255).astype(np.uint8)

        places_file = cfg.path("data", "world", "places.json")
        if places_file.exists():
            places = json.loads(places_file.read_text(encoding="utf-8"))["places"]
            for p in places:
                x, y = p["canonical"]
                c, r = cfg.km_to_px(x, y)
                cv2.circle(img, (int(c), int(r)), 6, (180, 30, 20), 2, cv2.LINE_AA)
                cv2.putText(img, p["id"], (int(c) + 8, int(r) - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (40, 10, 10), 2, cv2.LINE_AA)
        out = cfg.out / "preview"
        out.mkdir(exist_ok=True)
        Image.fromarray(img).save(out / f"{name}-full.png")
        small = cv2.resize(img, (cfg.W // 2, cfg.H // 2), interpolation=cv2.INTER_AREA)
        Image.fromarray(small).save(out / f"{name}.png")
