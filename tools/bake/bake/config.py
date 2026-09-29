"""World frame + paths, read from data/world/world.json (the single source of truth)."""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from pathlib import Path

from affine import Affine

ROOT = Path(__file__).resolve().parents[3]
# worktrees have no (gitignored) data/source: point MOME_SOURCE_DIR at the main checkout's copy
SOURCE_DIR = Path(os.environ["MOME_SOURCE_DIR"]).resolve() if os.environ.get("MOME_SOURCE_DIR") else ROOT / "data" / "source"


@dataclass
class Config:
    world: dict
    W: int
    H: int
    px_km: float
    x0_km: float
    x1_km: float
    y0_km: float
    y1_km: float
    out: Path
    cache: Path

    @property
    def px_m(self) -> float:
        return self.px_km * 1000.0

    @property
    def transform(self) -> Affine:
        """pixel (col,row) → ME-GIS metres; row 0 = north edge."""
        return Affine(self.px_m, 0, self.x0_km * 1000.0, 0, -self.px_m, self.y1_km * 1000.0)

    @property
    def centre_km(self) -> tuple[float, float]:
        return ((self.x0_km + self.x1_km) / 2, (self.y0_km + self.y1_km) / 2)

    def km_to_px(self, x_km, y_km):
        """ME-GIS km → fractional pixel (col,row) (pixel centres at +0.5)."""
        return (x_km - self.x0_km) / self.px_km, (self.y1_km - y_km) / self.px_km

    def km_to_world(self, x_km, y_km):
        """ME-GIS km → world (X, Z): origin at frame centre, X east, -Z north."""
        cx, cy = self.centre_km
        return x_km - cx, cy - y_km

    def path(self, *parts: str) -> Path:
        if len(parts) >= 2 and parts[0] == "data" and parts[1] == "source":
            return SOURCE_DIR.joinpath(*parts[2:])
        return ROOT.joinpath(*parts)


def load() -> Config:
    world = json.loads((ROOT / "data" / "world" / "world.json").read_text(encoding="utf-8"))
    f = world["frame"]
    hf = world["heightfield"]
    W, H, px = hf["width"], hf["height"], hf["kmPerPixel"]
    assert abs((f["xMaxKm"] - f["xMinKm"]) - W * px) < 1e-6, "frame width must equal width*kmPerPixel"
    assert abs((f["yMaxKm"] - f["yMinKm"]) - H * px) < 1e-6, "frame height must equal height*kmPerPixel"
    out = ROOT / "data" / "baked"
    cache = out / "cache"
    out.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    return Config(world, W, H, px, f["xMinKm"], f["xMaxKm"], f["yMinKm"], f["yMaxKm"], out, cache)


class Timer:
    def __init__(self, label: str):
        self.label = label

    def __enter__(self):
        self.t = time.perf_counter()
        print(f"[bake] {self.label}…", flush=True)
        return self

    def __exit__(self, *exc):
        print(f"[bake] {self.label}: {time.perf_counter() - self.t:.1f}s", flush=True)
