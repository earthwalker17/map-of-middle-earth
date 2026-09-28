"""Write runtime assets to data/baked/ (served at /world/*) + manifest with hashes."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Polygon

from .config import Config, Timer


def _u8(a: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(a * 255), 0, 255).astype(np.uint8)


def _png(path: Path, channels: list[np.ndarray]) -> None:
    rgba = np.stack([_u8(c) for c in channels], axis=-1)
    Image.fromarray(rgba, "RGBA").save(path, optimize=False, compress_level=6)


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _lines(geom) -> list:
    if isinstance(geom, LineString):
        return [geom]
    if isinstance(geom, MultiLineString):
        return list(geom.geoms)
    return []


def _polys(geom) -> list:
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return []


def _world_coords(cfg: Config, coords) -> list:
    out = []
    for x, y in coords:
        X, Z = cfg.km_to_world(x / 1000.0, y / 1000.0)
        out.append([round(X, 3), round(Z, 3)])
    return out


def export_all(cfg: Config, h: np.ndarray, info: dict, vec: dict, region_ids: list[str], region_layers: np.ndarray) -> dict:
    out = cfg.out
    files: dict[str, dict] = {}

    with Timer("export: height (u16)"):
        hmin, hmax = float(h.min()), float(h.max())
        q = np.clip(np.rint((h - hmin) / (hmax - hmin) * 65535), 0, 65535).astype("<u2")
        p = out / "height.u16"
        q.tofile(p)
        files["height"] = {"file": p.name, "format": "u16le", "width": cfg.W, "height": cfg.H, "min": hmin, "max": hmax, "sha256": _sha(p)}

    with Timer("export: masks"):
        lake = np.zeros_like(h)
        for m in vec["lake_masks"].values():
            lake = np.maximum(lake, m)
        land = np.clip((h > 0).astype(np.float32), 0, 1)
        p = out / "water.png"
        _png(p, [vec["river_channel"], lake, land, vec["river_valley"]])
        files["water"] = {"file": p.name, "channels": ["riverChannel", "lake", "land", "riverValley"], "sha256": _sha(p)}
        p = out / "landcover.png"
        _png(p, [vec["forest"], vec["wetland"], vec["vulcanism"], vec["road"]])
        files["landcover"] = {"file": p.name, "channels": ["forest", "wetland", "vulcanism", "road"], "sha256": _sha(p)}
        p = out / "forests.png"
        _png(p, [vec["forest_mirkwood"], vec["forest_fangorn"], vec["forest_lorien"], vec["forest_old"]])
        files["forests"] = {"file": p.name, "channels": ["mirkwood", "fangorn", "lorien", "oldForest"], "sha256": _sha(p)}

    with Timer("export: look weights"):
        L, lh, lw = region_layers.shape
        tiles = (L + 3) // 4
        stack = np.zeros((tiles * lh, lw, 4), np.float32)
        for i in range(L):
            stack[(i // 4) * lh:(i // 4 + 1) * lh, :, i % 4] = region_layers[i]
        p = out / "look.png"
        Image.fromarray(_u8(stack), "RGBA").save(p, compress_level=6)
        files["look"] = {"file": p.name, "layers": tiles, "tileWidth": lw, "tileHeight": lh, "regions": region_ids, "sha256": _sha(p)}

    with Timer("export: rivers / lakes / roads json"):
        rivers = []
        for row in vec["rivers_gdf"].itertuples():
            for ln in _lines(row.geometry.simplify(250)):
                if ln.length < 2000:
                    continue
                rivers.append({"name": row.name if isinstance(row.name, str) else None, "cls": row.cls, "widthKm": cfg.world["rivers"]["widthKm"][row.cls], "points": _world_coords(cfg, ln.coords)})
        levels = {l["key"]: l["level"] for l in info.get("lakes", [])}
        lakes = []
        for row in vec["lakes_gdf"].itertuples():
            for poly in _polys(row.geometry.simplify(200)):
                lakes.append({"name": row.NAME if isinstance(row.NAME, str) else None, "key": row.key, "level": levels.get(row.key), "ring": _world_coords(cfg, poly.exterior.coords)})
        roads = []
        for row in vec["roads_gdf"].itertuples():
            for ln in _lines(row.geometry.simplify(300)):
                roads.append({"name": row.name if isinstance(row.name, str) else None, "points": _world_coords(cfg, ln.coords)})
        for name, data in (("rivers", rivers), ("lakes", lakes), ("roads", roads)):
            p = out / f"{name}.json"
            p.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
            files[name] = {"file": p.name, "count": len(data), "sha256": _sha(p)}

    cx, cy = cfg.centre_km
    manifest = {
        "version": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "frame": cfg.world["frame"],
        "centreKm": [cx, cy],
        "world": {
            "xMin": cfg.x0_km - cx,
            "xMax": cfg.x1_km - cx,
            "zMin": cy - cfg.y1_km,
            "zMax": cy - cfg.y0_km,
            "notes": "texture uv = ((X - xMin)/(xMax - xMin), (Z - zMin)/(zMax - zMin)); row 0 = north",
        },
        "kmPerPixel": cfg.px_km,
        "vertical": {k: v for k, v in cfg.world["vertical"].items() if k != "demCalibration"},
        "files": files,
        "lakes": info.get("lakes", []),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest
