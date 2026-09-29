"""Write runtime assets to data/baked/ (served at /world/*) + manifest with hashes."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Polygon

from .cache import q8
from .config import Config, Timer
from .terrainmask import CHANNELS as TERRAIN_CHANNELS
from .vectors import canon_lakes, canon_roads


def _raw(path: Path, channels: list[np.ndarray]) -> tuple[int, int]:
    """Interleaved RGBA8 raw (row 0 = north) from u8 channels. Raw instead of PNG: no premultiplied-alpha,
    colour-space or flip ambiguity for data masks. A PNG copy goes to preview/ for inspection."""
    rgba = np.ascontiguousarray(np.stack([np.asarray(c, dtype=np.uint8) for c in channels], axis=-1))
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


def export_all(cfg: Config, hy: dict, rivers: list[dict], vec: dict, reg: dict, tm: dict) -> dict:
    out = cfg.out
    files: dict[str, dict] = {}
    h = hy["height"]

    with Timer("export: height (u16)"):
        hmin, hmax = float(h.min()), float(h.max())
        q = np.clip(np.rint((h - hmin) / (hmax - hmin) * 65535), 0, 65535).astype("<u2")
        p = out / "height.u16"
        q.tofile(p)
        files["height"] = {"file": p.name, "format": "u16le", "width": cfg.W, "height": cfg.H, "min": hmin, "max": hmax, "sha256": _sha(p)}

    with Timer("export: masks"):
        land = q8((h > 0).astype(np.float32))
        for key, chans, names in (
            ("water", [hy["river_channel"], hy["lake"], land, hy["river_valley"]], ["riverChannel", "lake", "land", "riverValley"]),
            ("landcover", [vec["forest"], vec["wetland"], vec["vulcanism"], vec["road"]], ["forest", "wetland", "vulcanism", "road"]),
            ("forests", [vec["forest_mirkwood"], vec["forest_fangorn"], vec["forest_lorien"], vec["forest_old"]], ["mirkwood", "fangorn", "lorien", "oldForest"]),
            ("terrain", [tm[c] for c in TERRAIN_CHANNELS], TERRAIN_CHANNELS),
        ):
            p = out / f"{key}.rgba8"
            w, hh = _raw(p, chans)
            files[key] = {"file": p.name, "format": "rgba8", "width": w, "height": hh, "channels": names, "sha256": _sha(p)}

    with Timer("export: look weights"):
        layers = reg["layers"]
        region_ids = list(reg["_extra"]["ids"])
        L, lh, lw = layers.shape
        tiles = (L + 3) // 4
        stack = np.zeros((tiles * lh, lw, 4), np.uint8)
        for i in range(L):
            stack[(i // 4) * lh : (i // 4 + 1) * lh, :, i % 4] = layers[i]
        p = out / "look.rgba8"
        np.ascontiguousarray(stack).tofile(p)
        files["look"] = {"file": p.name, "format": "rgba8", "layers": tiles, "tileWidth": lw, "tileHeight": lh, "regions": region_ids, "sha256": _sha(p)}

    with Timer("export: rivers / lakes / roads json"):
        # rivers.json v2: the processed centrelines exactly as carved (points, level, bed, falls, into)
        rv = [{k: v for k, v in r.items() if not k.startswith("_")} for r in rivers]
        lake_info = hy["_extra"]["lakes"]
        levels = {l["key"]: l["level"] for l in lake_info}
        lakes = []
        for row in canon_lakes(cfg).itertuples():
            if row.key not in levels:
                continue
            for poly in _polys(row.geometry.simplify(200 if row.geometry.area > 4e6 else 60)):
                lakes.append({"name": row.NAME if isinstance(row.NAME, str) else None, "key": row.key, "level": levels.get(row.key), "ring": _world_coords(cfg, poly.exterior.coords)})
        roads = []
        for row in canon_roads(cfg).itertuples():
            for ln in _lines(row.geometry.simplify(300)):
                roads.append({"name": row.name if isinstance(row.name, str) else None, "points": _world_coords(cfg, ln.coords)})
        for name, data in (("rivers", rv), ("lakes", lakes), ("roads", roads)):
            p = out / f"{name}.json"
            p.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
            files[name] = {"file": p.name, "count": len(data), "sha256": _sha(p)}

    cx, cy = cfg.centre_km
    manifest = {
        "version": 2,
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
        "lakes": [{"key": l["key"], "level": l["level"], "areaKm2": l["areaKm2"]} for l in lake_info if l["level"] is not None],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest
