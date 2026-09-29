"""Bake orchestration. Deterministic: same inputs + world.json → same outputs (hashes in manifest).

Steps (each caches its products in data/baked/cache, keyed by its inputs; `--steps` runs the listed
steps and whatever upstream step is stale):
  dem      Arda DEM → metres + land fraction (the 1 GB read; cached separately as before)
  coast    land/sea classification
  vectors  land-cover masks (forests, wetlands, vulcanism, roads)
  regions  look-region weight layers (data/world/regions.geojson)
  relief   exaggerated relief + bathymetry → h_pre_rivers
  hydro    river network, monotone profiles, lakes, carve, river/lake masks → final height
  mask     terrain.rgba8 (AO / valley index / wetness / flow)
  export   runtime assets + manifest
  preview  shaded-relief PNGs
"""
from __future__ import annotations

import argparse
import re
import json
import shutil

import numpy as np

from . import config
from .cache import StepCache, code_stamp, digest, f8, file_stamp, q8
from .coast import land_fraction
from .config import Timer
from .dem import read_dem

STEPS = ["dem", "coast", "vectors", "regions", "relief", "hydro", "mask", "export", "preview"]


class Bake:
    def __init__(self, cfg: config.Config, run: set[str]):
        self.cfg = cfg
        self.run = run
        self.cache = StepCache(cfg.cache)
        self.keys: dict[str, str] = {}
        self.mem: dict[str, dict] = {}
        w = cfg.world
        src = [file_stamp(cfg.path(*w["source"]["dem"].split("/"))), file_stamp(cfg.path(*w["source"]["vectors"].split("/")))]
        V = {k: v for k, v in w["vertical"].items() if k != "notes"}
        self.keys["dem"] = digest("dem", w["frame"], w["heightfield"], w["vertical"]["demCalibration"], src[0])
        self.keys["coast"] = digest("coast", self.keys["dem"], w["coast"], V["seaLevelMetres"], src[1], code_stamp("coast"))
        self.keys["vectors"] = digest("vectors", w["frame"], w["heightfield"], src[1], code_stamp("vectors"))
        regions_txt = cfg.path("data", "world", "regions.geojson").read_text(encoding="utf-8")
        self.keys["regions"] = digest("regions", w["frame"], w["heightfield"], regions_txt, code_stamp("regions"))
        self.keys["relief"] = digest("relief", self.keys["coast"], V, w["seeds"], w["rivers"]["classes"], src[1], code_stamp("relief", "vectors"))
        self.keys["hydro"] = digest("hydro", self.keys["relief"], w["rivers"], w.get("lakes"), code_stamp("hydro", "profiles", "vectors"))
        self.keys["mask"] = digest("mask", self.keys["hydro"], code_stamp("terrainmask", "flow"))

    def need(self, step: str) -> bool:
        return step in self.run or not self.cache.valid(step, self.keys[step])

    def get(self, step: str) -> dict:
        if step in self.mem:
            return self.mem[step]
        if step == "dem":  # read_dem keeps its own (frame-keyed) npy cache
            out = self.step_dem()
        elif self.need(step):
            if step not in self.run:
                print(f"[bake] {step}: cache stale or missing → rerun")
            out = getattr(self, f"step_{step}")()
        else:
            print(f"[bake] {step}: cached")
            arrays, extra = self.cache.load(step)
            out = {**arrays, "_extra": extra}
        self.mem[step] = out
        return out

    # ---------------------------------------------------------------- steps

    def step_dem(self) -> dict:
        metres, dem_land = read_dem(self.cfg)
        return {"metres": metres, "dem_land": dem_land}

    def step_coast(self) -> dict:
        land = land_fraction(self.cfg, self.get("dem")["metres"])
        self.cache.save("coast", self.keys["coast"], {"land": land})
        return {"land": land}

    def step_vectors(self) -> dict:
        from .vectors import load_masks

        out = load_masks(self.cfg)
        self.cache.save("vectors", self.keys["vectors"], out)
        return out

    def step_regions(self) -> dict:
        from .regions import bake_regions

        ids, layers = bake_regions(self.cfg)
        out = {"layers": q8(layers)}
        self.cache.save("regions", self.keys["regions"], out, {"ids": ids})
        return {**out, "_extra": {"ids": ids}}

    def step_relief(self) -> dict:
        from .relief import synthesize_relief
        from .vectors import canon_rivers

        h = synthesize_relief(self.cfg, self.get("dem")["metres"], self.get("coast")["land"], canon_rivers(self.cfg))
        out = {"h_pre_rivers": h}
        self.cache.save("relief", self.keys["relief"], out)
        # the DEM arrays are no longer needed by any later step
        self.mem.pop("dem", None)
        return out

    def step_hydro(self) -> dict:
        from .hydro import run_hydro

        h, masks, data = run_hydro(self.cfg, self.get("relief")["h_pre_rivers"], self.get("coast")["land"])
        out = {"height": h, **masks}
        self.cache.save("hydro", self.keys["hydro"], out, {"lakes": data["lakes"], "log": data["log"]})
        self.cache.save_json("hydro", "rivers", data["rivers"])
        return {**out, "_extra": {"lakes": data["lakes"], "log": data["log"]}}

    def step_mask(self) -> dict:
        from .terrainmask import terrain_mask

        hy = self.get("hydro")
        out = terrain_mask(self.cfg, hy)
        self.cache.save("mask", self.keys["mask"], out)
        return out

    def step_export(self) -> dict:
        from .export import export_all

        hy = self.get("hydro")
        rivers = self.cache.load_json("hydro", "rivers")
        manifest = export_all(self.cfg, hy, rivers, self.get("vectors"), self.get("regions"), self.get("mask"))
        print(f"[bake] export → {self.cfg.out} ({len(manifest['files'])} assets)")
        return {}

    def step_preview(self) -> dict:
        from .preview import render_preview

        hy = self.get("hydro")
        render_preview(self.cfg, hy["height"], f8(self.get("vectors")["forest"]), f8(hy["lake"]), f8(hy["river_channel"]))
        return {}


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser(prog="bake")
    ap.add_argument("--force", action="store_true", help="ignore every cache (re-read the DEM)")
    ap.add_argument("--no-preview", action="store_true")
    ap.add_argument("--steps", nargs="*", default=[], help=f"steps to run, comma or space separated (default: all but a cached DEM): {','.join(STEPS)}")
    args = ap.parse_args(argv)

    cfg = config.load()
    if args.force and cfg.cache.exists():
        shutil.rmtree(cfg.cache)
        cfg.cache.mkdir(parents=True)
    if args.steps:
        run = {s for s in re.split(r"[,\s]+", " ".join(args.steps)) if s}
        bad = run - set(STEPS)
        if bad:
            raise SystemExit(f"unknown steps {sorted(bad)}; known: {STEPS}")
    else:
        run = set(STEPS) - {"dem"}
    if args.no_preview:
        run.discard("preview")
    print(f"[bake] frame x {cfg.x0_km}..{cfg.x1_km} km, y {cfg.y0_km}..{cfg.y1_km} km → {cfg.W}x{cfg.H} @ {cfg.px_km} km/px; steps {','.join(s for s in STEPS if s in run)}")
    b = Bake(cfg, run)
    with Timer("bake"):
        for s in STEPS:
            if s in run and s != "dem":
                b.get(s)
    print(f"[bake] done → {cfg.out}")
