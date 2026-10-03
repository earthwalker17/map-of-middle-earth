# data/source — third-party geography source data

> **This folder is gitignored and its data must NEVER be committed or pushed** (only this
> README and `manifest.json` are tracked). It holds third-party data whose redistribution
> terms are unclear or restrictive. Build tools read from here and emit derived,
> project-specific assets elsewhere.
>
> Restore / verify: `pnpm data:fetch` (`node tools/refs/fetch-data.mjs --only data [--check]`),
> driven by `data/source/manifest.json` (URLs, sizes, sha256).

## arda/ — bburns/Arda (https://github.com/bburns/Arda, branch `main`)

Licence: **MIT for code; DEM/vector data provenance uncertain** (original ME-DEM
project by the Outerra Worlds Forum team: monks, SeerBlue, Redrobes; maintained by
jvangeld; packaged by bburns). The repo README says: "This project is MIT, though the
original 3d DEM elevation data (10k/dem.jpg) and vector layers are uncertain." No
LICENSE file exists in the repo. Treat the data as dev-only; ask before redistribution.

| File | Source | What it is |
|---|---|---|
| `arda/vectors/vectors.gpkg` | `data/vectors/vectors.gpkg` | GeoPackage (SQLite) of vector layers: coastlines, rivers, lakes, forests, roads, places, etc. |
| `arda/rasters/10k/dem.jpg` | `data/rasters/10k/dem.jpg` | 10000x10000 8-bit greyscale DEM (JPEG) |
| `arda/rasters/10k/dem.wld` | `data/rasters/10k/dem.wld` | World file: 200.1 m/px, origin (-900, 2001100) |
| `arda/rasters/32k/dem.vrt` | `data/rasters/32k/dem.vrt` | GDAL VRT mosaic, 32257x32257 UInt16, EPSG:32631, ~62.03 m/px |
| `arda/rasters/32k/dem_{nw,ne,sw,se}.tif` | GitHub release `dem-32k-v1` | Four UInt16 GeoTIFF quadrants referenced by the VRT (relativeToVRT, same folder). `hillshade.tif` intentionally not downloaded. |
| `arda/docs/README.md` | `README.md` | Repo README (credits, licence note) |
| `arda/docs/2026-09-20-32k-dem.md` | `docs/2026-09-20-32k-dem.md` | Calibration / build notes for the 32k DEM |
| `arda/docs/build-dem.ps1` | `scripts/build-dem.ps1` | DEM build script (reference only, not run here) |

## me-gis/ — andrewheiss/ME-GIS (https://github.com/andrewheiss/ME-GIS, branch `master`)

Terms: **ask before use; usually approved for personal/educational use** (see README
for credits/terms). Dev reference only.

| File | What it is |
|---|---|
| `me-gis/README.md` | Repo README: terms and credits |
| `me-gis/Combined_Placenames.xyz` | Text export of place-name label anchors (NAME / DESCRIPTION / coordinates) |

## Canonical maps

Reference maps live in the local, never-committed `reference/maps/` (indexed by the local
`reference/manifest.json`). Most are copyrighted (Tolkien Estate / HarperCollins /
New Line) and are dev reference only; a few Wikimedia Commons files are CC BY / CC BY-SA / PD.
