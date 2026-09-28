"""Bake orchestration. Deterministic: same inputs + world.json → same outputs (hashes in manifest)."""
from __future__ import annotations

import argparse
import shutil

from . import config
from .coast import land_fraction
from .dem import read_dem
from .export import export_all
from .preview import render_preview
from .regions import bake_regions
from .terrain import synthesize
from .vectors import load_vectors


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser(prog="bake")
    ap.add_argument("--force", action="store_true", help="ignore the DEM cache")
    ap.add_argument("--no-preview", action="store_true")
    args = ap.parse_args(argv)

    cfg = config.load()
    if args.force and cfg.cache.exists():
        shutil.rmtree(cfg.cache)
        cfg.cache.mkdir(parents=True)
    print(f"[bake] frame x {cfg.x0_km}..{cfg.x1_km} km, y {cfg.y0_km}..{cfg.y1_km} km → {cfg.W}x{cfg.H} @ {cfg.px_km} km/px")
    metres, dem_land = read_dem(cfg)
    land = land_fraction(cfg, metres)
    vec = load_vectors(cfg)
    region_ids, region_layers = bake_regions(cfg)
    h, info = synthesize(cfg, metres, land, vec)
    manifest = export_all(cfg, h, info, vec, region_ids, region_layers)
    if not args.no_preview:
        render_preview(cfg, h, vec)
    print(f"[bake] done → {cfg.out} ({len(manifest['files'])} assets)")
