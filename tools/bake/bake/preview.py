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
        img = np.empty((cfg.H, cfg.W, 3), np.uint8)
        f32 = lambda v: np.array(v, np.float32)  # noqa: E731
        low, mid, high = f32([0.46, 0.55, 0.32]), f32([0.62, 0.58, 0.42]), f32([0.92, 0.92, 0.94])
        # colour in row strips (float32) so the preview never dominates the bake's peak memory
        for r0 in range(0, cfg.H, 300):
            sl = slice(r0, min(cfg.H, r0 + 300))
            hh = h[sl].astype(np.float32)
            land_t = np.clip(hh / 45.0, 0, 1)[..., None]
            col = np.where(land_t < 0.5, low + (mid - low) * (land_t / 0.5), mid + (high - mid) * ((land_t - 0.5) / 0.5))
            fo = forest[sl][..., None]
            col = col * (1 - fo * 0.55) + f32([0.18, 0.3, 0.16]) * fo * 0.55
            col = col * (0.35 + 0.8 * shade[sl][..., None])
            depth = np.clip(-hh / 6.0, 0, 1)[..., None]
            water_col = f32([0.35, 0.55, 0.62]) * (1 - depth) + f32([0.08, 0.18, 0.3]) * depth
            col = np.where((hh <= 0)[..., None], water_col, col)
            river = np.maximum(channel[sl], lake[sl])[..., None]
            col = col * (1 - river) + f32([0.2, 0.42, 0.62]) * river
            img[sl] = (np.clip(col, 0, 1) * 255).astype(np.uint8)

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
