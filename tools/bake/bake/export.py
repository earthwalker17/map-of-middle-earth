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


def _raw(path: Path, channels: list[np.ndarray]) -> tuple[int, int]:
    """Interleaved RGBA8 raw (row 0 = north). Raw instead of PNG: no premultiplied-alpha,
    colour-space or flip ambiguity for data masks. A PNG copy goes to preview/ for inspection."""
    rgba = np.ascontiguousarray(np.stack([_u8(c) for c in channels], axis=-1))
    rgba.tofile(path)
    prev = path.parent / "preview"
    prev.mkdir(exist_ok=True)
    Image.fromarray(rgba[..., :3], "RGB").save(prev / (path.stem + "-rgb.png"), compress_level=6)
    return rgba.shape[1], rgba.shape[0]


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
        for key, chans, names in (
            ("water", [vec["river_channel"], lake, land, vec["river_valley"]], ["riverChannel", "lake", "land", "riverValley"]),
            ("landcover", [vec["forest"], vec["wetland"], vec["vulcanism"], vec["road"]], ["forest", "wetland", "vulcanism", "road"]),
            ("forests", [vec["forest_mirkwood"], vec["forest_fangorn"], vec["forest_lorien"], vec["forest_old"]], ["mirkwood", "fangorn", "lorien", "oldForest"]),
        ):
            p = out / f"{key}.rgba8"
            w, hh = _raw(p, chans)
            files[key] = {"file": p.name, "format": "rgba8", "width": w, "height": hh, "channels": names, "sha256": _sha(p)}

    with Timer("export: look weights"):
        L, lh, lw = region_layers.shape
        tiles = (L + 3) // 4
        stack = np.zeros((tiles * lh, lw, 4), np.float32)
        for i in range(L):
            stack[(i // 4) * lh:(i // 4 + 1) * lh, :, i % 4] = region_layers[i]
        p = out / "look.rgba8"
        np.ascontiguousarray(_u8(stack)).tofile(p)
        files["look"] = {"file": p.name, "format": "rgba8", "layers": tiles, "tileWidth": lw, "tileHeight": lh, "regions": region_ids, "sha256": _sha(p)}

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
