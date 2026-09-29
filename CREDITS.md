# Credits

*Map of Middle-Earth* is a non-commercial fan work. This file credits every asset shipped in `public/`,
the third-party data and reference material used during development, and the software it is built with.
Machine-readable detail (URLs, sizes, sha256) lives in the manifests named below.

## Fonts

Shipped in `public/fonts/` (committed, used **unmodified**; manifest: `public/fonts/_manifest.json`).
All are licensed under the [SIL Open Font License 1.1](https://openfontlicense.org) (`OFL-1.1`); each
family's `OFL.txt` sits next to its font files. Source: [google/fonts](https://github.com/google/fonts).

| Family | Designer | Licence | Reserved Font Name | Files |
|---|---|---|---|---|
| Cinzel | Natanael Gama (The Cinzel Project Authors) | OFL-1.1 | **"Cinzel"** | `cinzel/Cinzel-VariableFont_wght.ttf` |
| Cinzel Decorative | Natanael Gama | OFL-1.1 | **"Cinzel"** | `cinzeldecorative/CinzelDecorative-{Regular,Bold}.ttf` |
| Cormorant Garamond | Christian Thalmann (Catharsis Fonts, The Cormorant Project Authors) | OFL-1.1 | none | `cormorantgaramond/CormorantGaramond{,-Italic}-VariableFont_wght.ttf` |
| EB Garamond | Georg Duffner, Octavio Pardo (The EB Garamond Project Authors) | OFL-1.1 | none | `ebgaramond/EBGaramond{,-Italic}-VariableFont_wght.ttf` |
| IM Fell English | Igino Marini (revival of the Fell Types) | OFL-1.1 | none | `imfellenglish/IMFeEN{rm,it}28P.ttf` |
| IM Fell English SC | Igino Marini (revival of the Fell Types) | OFL-1.1 | none | `imfellenglishsc/IMFeENsc28P.ttf` |

Cinzel and Cinzel Decorative carry the Reserved Font Name "Cinzel": we ship them unmodified under their
original names. Any subset, conversion or other modified version must be renamed (OFL §3). Variable-font
files are saved without the upstream `[wght]` brackets in the filename; content is byte-identical.

## Textures

[Poly Haven](https://polyhaven.com) PBR textures, **CC0 1.0** (public domain; credit given as a courtesy).

- **Sources** (not shipped): 2k JPG maps (`diffuse`, `nor_gl`, `rough`, `ao`, `disp`) in
  `data/textures-src/<asset_id>/`, **fetched by script, never committed**: `pnpm data:fetch`
  (`node tools/refs/fetch-data.mjs --only textures`), manifest `data/textures-src/manifest.json`.
- **Shipped (derived)**: `public/textures/terrain/` — the terrain ground-detail layers
  (`detail-512.bin`, `detail-1024.bin`, `detail.json`), generated from six of the sources by
  `node tools/textures/prep.mjs` (run automatically after the fetch; gitignored). Modifications:
  resized to 512² / 1024², luminance high-passed and contrast-normalised, packed with the normal
  map's x/y and the displacement map as height. Layers (see `detail.json`): meadow ← `aerial_grass_rock`,
  dry ← `withered_grass`, rock ← `aerial_rocks_02`, snow ← `snow_field_aerial`, scree ←
  `river_small_rocks`, ash ← `burned_ground_01`.

| Asset | Maps | Intended use |
|---|---|---|
| [aerial_beach_01](https://polyhaven.com/a/aerial_beach_01) | diffuse, nor_gl, rough, ao, disp | Coastal sand beach — Grey Havens / Belfalas coast / river banks |
| [aerial_grass_rock](https://polyhaven.com/a/aerial_grass_rock) | diffuse, nor_gl, rough, ao, disp | Shire / Eriador meadow with rock outcrops; general lowland grass |
| [aerial_rocks_02](https://polyhaven.com/a/aerial_rocks_02) | diffuse, nor_gl, rough, ao, disp | Grey rock — Misty / White Mountains cliffs and peaks |
| [brown_mud_leaves_01](https://polyhaven.com/a/brown_mud_leaves_01) | diffuse, nor_gl, rough, ao, disp | Wet mud — Dead Marshes / Nindalf / riverside marsh |
| [burned_ground_01](https://polyhaven.com/a/burned_ground_01) | diffuse, nor_gl, rough, ao, disp | Burned ash ground — Mordor / Gorgoroth / Dagorlad |
| [dark_rock](https://polyhaven.com/a/dark_rock) | diffuse, nor_gl, rough, ao, disp | Dark volcanic rock — Mordor, Mount Doom, Ephel Dúath |
| [dirt_aerial_02](https://polyhaven.com/a/dirt_aerial_02) | diffuse, nor_gl, rough, ao, disp | Bare soil — roads, fields, Brown Lands |
| [forrest_ground_01](https://polyhaven.com/a/forrest_ground_01) | diffuse, nor_gl, rough, ao, disp | Forest floor — Fangorn, Mirkwood, Lothlórien, Ithilien |
| [leafy_grass](https://polyhaven.com/a/leafy_grass) | diffuse, nor_gl, rough, ao, disp | Lush grass detail — Shire / Ithilien lowlands |
| [mossy_rock](https://polyhaven.com/a/mossy_rock) | diffuse, nor_gl, rough, ao, disp | Mossy rock — Fangorn, Rivendell, damp crags |
| [river_small_rocks](https://polyhaven.com/a/river_small_rocks) | diffuse, nor_gl, rough, ao, disp | River gravel — riverbeds, scree, fords |
| [rocky_terrain_02](https://polyhaven.com/a/rocky_terrain_02) | diffuse, nor_gl, rough, ao, disp | Rocky scree — mountain slopes, Emyn Muil |
| [snow_field_aerial](https://polyhaven.com/a/snow_field_aerial) | diffuse, nor_gl, rough, ao, disp | Snow field — Caradhras / high peaks |
| [withered_grass](https://polyhaven.com/a/withered_grass) | diffuse, nor_gl, rough, ao, disp | Dry golden grass — Rohan plains / Pelennor |

## Geography data

The terrain and map layers are derived from community Middle-earth GIS work. Source files live in
`data/source/` (gitignored; manifest `data/source/manifest.json`, restore with `pnpm data:fetch`) and
**derived data (`data/baked/`) is never committed**.

- **ME-DEM** — the original 3D elevation model of Middle-earth by the Outerra Worlds Forum team:
  **monks**, **SeerBlue** and **Redrobes**.
- **ME-GIS** — Middle-earth GIS vector layers, maintained by **jvangeld**
  ([andrewheiss/ME-GIS](https://github.com/andrewheiss/ME-GIS) mirror by **andrewheiss**; place-name
  anchors `Combined_Placenames.xyz`). Terms: ask before use; usually approved for personal/educational use.
- **Arda** — packaging of the DEM (10k JPEG, 32k UInt16 GeoTIFF quadrants from release `dem-32k-v1`) and
  vector layers (`vectors.gpkg`) by **bburns**: <https://github.com/bburns/Arda>. The code is MIT, but the
  **provenance/licence of the DEM and vector data is uncertain**.

We use these privately for development. **Permission from the authors will be requested before any public
release** of the project or of anything derived from their data.

## Reference material (dev-only, not redistributed)

Visual references in `reference/` (gitignored; index `reference/README.md`, manifest
`reference/manifest.json`, restore with `pnpm refs:fetch`) are used only to guide look-development and
QA. They are never shipped, committed or redistributed, and no pixels from them appear in the project's
outputs. Rights remain with their owners:

- Maps by **Christopher Tolkien** and **J.R.R. Tolkien** © The Tolkien Estate / HarperCollins;
  **Pauline Baynes** poster map © the Pauline Baynes estate / HarperCollins; film-style maps by
  **Daniel Reeve** © New Line Cinema / Decipher (copies via [Tolkien Gateway](https://tolkiengateway.net)).
- Film stills from *The Lord of the Rings* and *The Hobbit* trilogies © **New Line Cinema / Warner Bros.**
  (and MGM) (via Tolkien Gateway and the LOTR Fandom wiki).
- Concept art and illustration © **Alan Lee**, **John Howe**, **Ted Nasmith**; Tolkien's own drawings
  © The Tolkien Estate.
- Bigature / miniature imagery © **Weta Workshop** / New Line Cinema.
- LEGO Middle-earth MOC renders supplied by the user (builder unknown) — third-party, dev reference only.
- Wikimedia Commons items, under their own licences:

| Author | Licence | File (Commons page) | Shows |
|---|---|---|---|
| Bernard Spragg | CC0 | [photos/argonath/kawarau-gorge-otago.jpg](https://commons.wikimedia.org/wiki/File:Kawarau_Gorge._Otago_NZ.jpg) | Kawarau Gorge, NZ (Argonath location) |
| Cush | Public domain | [maps/commons-anduin-river.png](https://commons.wikimedia.org/wiki/File:Tolkien_Anduin_River.png) | Course of the Anduin |
| Ian Alexander | CC BY-SA 4.0 | [maps/commons-geomorphology.svg](https://commons.wikimedia.org/wiki/File:Geomorphology_of_Middle-earth.svg) | Geomorphology of Middle-earth |
| Ian Alexander | CC BY-SA 4.0 | [maps/commons-sketch-map.svg](https://commons.wikimedia.org/wiki/File:Sketch_Map_of_Middle-earth.svg) | Sketch map of Middle-earth |
| Jim Barton | CC BY-SA 2.0 | [photos/general/relief-model-cuillin-hills-bronze.jpg](https://commons.wikimedia.org/wiki/File:Bronze_relief_model_of_the_Cuillin_Hills_-_geograph.org.uk_-_4410750.jpg) | Bronze relief model, Cuillin Hills |
| Jim Barton | CC BY-SA 2.0 | [photos/general/relief-model-edinburgh.jpg](https://commons.wikimedia.org/wiki/File:Relief_model_of_Edinburgh_-_geograph.org.uk_-_7629062.jpg) | Painted relief model, Edinburgh |
| Joe Ross | CC BY-SA 2.0 | [photos/hobbiton/bag-end-hill-set.jpg](https://commons.wikimedia.org/wiki/File:Bag_End%2C_Bilbo_Baggins_House%2C_Hobbiton_Movie_Set%2C_Matamata%2C_New_Zealand_2016_%2850797473207%29.jpg) | Bag End, Hobbiton Movie Set |
| k1tesurfen | CC BY-SA 4.0 | [maps/commons-map-of-middle-earth.svg](https://commons.wikimedia.org/wiki/File:Map_of_Middle-Earth.svg) | Map of Middle-earth |
| Krzysztof Golik | CC BY-SA 4.0 | [photos/mordor/rangipo-desert.jpg](https://commons.wikimedia.org/wiki/File:Rangipo_Desert_05.jpg) | Rangipo Desert, NZ |
| Krzysztof Golik | CC BY-SA 4.0 | [photos/mount-doom/mount-ngauruhoe-cone.jpg](https://commons.wikimedia.org/wiki/File:Mount_Ngauruhoe_01.jpg) | Mount Ngauruhoe, NZ |
| Mike Dickison | CC BY 4.0 | [photos/edoras/mount-sunday-terrain.jpg](https://commons.wikimedia.org/wiki/File:Mount_Sunday_MRD_01.jpg) | Mount Sunday, NZ (Edoras location) |
| Motorau | Public domain | [photos/dead-marshes/kepler-mire.jpg](https://commons.wikimedia.org/wiki/File:Kepler_Mire_-_Dead_Marshes.JPG) | Kepler Mire, NZ (Dead Marshes location) |
| Richard Holder | CC0 | [photos/general/model-railway-diorama-tan-y-bwlch.jpg](https://commons.wikimedia.org/wiki/File:%22Tan-y-Bwlch%22%2C_an_OO9_model_railway_layout_by_Richard_Holder.jpg) | OO9 model railway layout |
| Rolf Schwemmer | CC BY 3.0 | [maps/schwemmer-frodo-aragorn-travels.jpg](https://commons.wikimedia.org/wiki/File:RolfsMapOfTolkiensMiddleEarth_Frodos_and_Aragorns_Travels.jpg) | Frodo's and Aragorn's travels |
| Sächsische IV K | CC BY 4.0 | [photos/general/model-railway-diorama-pecky.jpg](https://commons.wikimedia.org/wiki/File:Model_railway_Pe%C4%8Dky_wartime_layout.jpg) | Model railway diorama (Pečky) |
| Tom Hall | CC BY 2.0 | [photos/hobbiton/hobbiton-mill-bridge-set.jpg](https://commons.wikimedia.org/wiki/File:Hobbiton_mill_and_double-arched_bridge.jpg) | Hobbiton mill and double-arched bridge |
| User:FA2010 | Public domain | [photos/general/relief-model-munich-museum.jpg](https://commons.wikimedia.org/wiki/File:M%C3%BCnchen_Reliefmodell_BNM_img01.jpg) | Relief model of Munich (Bavarian National Museum) |
| Wikitarisch | CC BY 4.0 | [photos/general/relief-model-luebeck-landscape.jpg](https://commons.wikimedia.org/wiki/File:Reliefmodell_L%C3%BCbeck_und_Wakenitz_%28Museum_f%C3%BCr_Natur_und_Umwelt_L%C3%BCbeck%29.jpg) | Relief model, Lübeck and Wakenitz |

## Software

| Package | Licence | Use |
|---|---|---|
| [three.js](https://threejs.org) | MIT | WebGPU renderer, TSL |
| [Vite](https://vite.dev) | MIT | Dev server / build |
| [lil-gui](https://lil-gui.georgealways.com) | MIT | Debug UI |
| [Playwright](https://playwright.dev) | Apache-2.0 | Headless capture (`pnpm shots` / `pnpm qa`) |
| [sharp](https://sharp.pixelplumbing.com) | Apache-2.0 | Image processing in capture tools |
| [TypeScript](https://www.typescriptlang.org) · [tsx](https://tsx.is) | Apache-2.0 · MIT | Language / TS runner |

Python bake (`tools/bake`, dev-only):

| Package | Licence |
|---|---|
| NumPy, SciPy | BSD-3-Clause |
| Numba | BSD-2-Clause |
| rasterio | BSD-3-Clause |
| GDAL (via rasterio / pyogrio wheels) | MIT |
| pyogrio | MIT |
| Shapely | BSD-3-Clause |
| GeoPandas | BSD-3-Clause |
| OpenCV (opencv-python-headless) | Apache-2.0 (OpenCV) / MIT (wheel packaging) |
| Pillow | MIT-CMU (HPND) |
| scikit-image | BSD-3-Clause |
| tifffile | BSD-3-Clause |

## Trademarks & IP

*The Lord of the Rings*, *The Hobbit*, Middle-earth and the names of their characters, places and events
are trademarks of **Middle-earth Enterprises**; the books are © **The Tolkien Estate**. The films are
© New Line Cinema / Warner Bros. LEGO is a trademark of the LEGO Group. This project is a **non-commercial
fan work**, not affiliated with or endorsed by any of them or by any artist credited above.

The project deliberately contains **no Tengwar or Cirth**, **no film logos or film typography**, and **no
film-score material** — its music is original and does not use or imitate Howard Shore's score.
