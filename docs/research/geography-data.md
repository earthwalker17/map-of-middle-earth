Answers for all four sections are below. I checked every URL live on 2026-09-28/29; coordinates and file structures come from downloading the actual files. Anything I could not confirm is marked UNVERIFIED, and anything I worked out myself rather than read from the data is marked DERIVED. Nothing was written to disk.

## 1. Datasets

### A. ME-GIS: the base vector set
- **Repo:** https://github.com/andrewheiss/ME-GIS (the old address github.com/jvangeld/ME-GIS now redirects here). 109 stars, last push 2023-01-07, no LICENSE file.
- **Terms (README):** "If you want to use the data, just ask. We typically approve most personal and educational uses."
- **Raw file pattern:** `https://raw.githubusercontent.com/andrewheiss/ME-GIS/master/<Layer>.shp|.dbf|.prj`
- **Origin:** made for the ME-DEM project (Outerra forum users monks, SeerBlue and Redrobes), later maintained by jvangeld.
- **Format:** ESRI shapefiles. The .prj says WGS84 / UTM zone 31N (EPSG:32631), but it is really a flat metric grid. Do not reproject it; treat x,y as Cartesian metres with y pointing north.
- **Extent:** about 0 to 2,000,000 on both axes. Coastline bbox is (150820, -348, 2000317, 1962949); Contours_18 bbox is (-1680, -348, 2000325, 2000348).

Layers (feature type, count, notes):

| Layer | Type, count | Notes |
|---|---|---|
| Coastline2 | PolyLine, 110 | Lines, not polygons: they must be closed or polygonised before use as a land mask |
| Contours_18 | PolyLine, 4266 | Field `Elevation`, 402 distinct values from 0 to 10363.2 |
| Rivers | PolyLine, 2497 | TYPE is Stream or River; 42 named rivers (Anduin, Entwash, Isen, Bruinen, Celebrant, Nimrodel, Sirannon, Morgulduin, Forest River, Celduin, Carnen, The Water, Withywindle, etc.) |
| Lakes | Polygon, 256 | Named: Sea of Rhûn, Sea of Núrnen, Nen Hithoel, Long Lake, Mirrormere, Lake Evendim, Lake of Moria, Bywater Pool |
| Forests | Polygon, 2033 | Deciduous Forest and Forest Clearing; named: Mirkwood, Fangorn, Lothlorien, Old Forest, Druadan, Firien, Eryn Vorn, Chetwood, Woody End |
| Hills | Polygon, 2179 | Mostly unnamed |
| Wetlands02 | Polygon, 181 | Midgewater, Overbourne, the Marish, two "Nindalf" polygons |
| Vulcanism | Polygon, 110 | "Hot Spots" and "Vulcanism" |
| Stonefields | Polygon, 7 | |
| Roads | PolyLine, 1010 | PRIMARY / SECONDARY / TERTIARY; named: Great East Road, Greenway, Old South Road, South Road, Old Forest Road, Sauron's Road |
| Point layers | Towns 425, Citadels 119, Towers_and_Keeps 202, Ruins 237, Cities 30, Beacons 150, Hamlets 20 | Place points |
| Label layers | Combined_Placenames 785 points, Mountains_Anno 10, Regions_Anno 14 | Label anchors and label curves |

Also present: `Combined_Placenames.xyz`, a plain-text file with a `DESCRIPTION=/NAME=` block per label followed by an `x,y` line. It is easy to parse.

**Mountains are not stored as geometry.** Mountains_Anno holds only curves for placing labels. Relief has to come from the DEM or from the contours plus Hills polygons.

**Vertical datum (DERIVED, fits the numbers exactly):**
- Coastline `Elevation` = 5486.4 m (18,000 ft), so that value is sea level.
- Contour steps are 19.05 m (62.5 ft), and one step equals one grey level in the 8-bit DEM.
- So height above sea ≈ (contour − 5486.4) m, or 8-bit DEM value × 19.05 m. The maximum is 4876.8 m (256 steps).

**Quality caveats:**
- **Non-canon features:** an `ORIGIN=MERP` field marks features taken from ICE's Middle-earth Role Playing maps, which are not canon and are copyrighted. That covers 2407 of 2497 rivers, 993 of 1010 roads, 1681 forest pieces, 377 of 425 towns, and most citadels and keeps. Filter on `ORIGIN=''` for canon features.
- **Encoding:** text is Latin-1 (for example `Barad-d\xfbr`).
- **Labels are offset from features:** Combined_Placenames records where a label sits, not where the place is. Use the point layers for real positions.
- **Other issues:** one analysis of this data found rivers that don't connect and polygons stored as broken segments (https://blogs.ubc.ca/thereandbackagain/methodology/).

**Horizontal scale:** distances are about half of Tolkien's miles; see §4.

### B. bburns/Arda: the DEM plus cleaned vectors (best current source)
- **Repo:** https://github.com/bburns/Arda (branch `main`, pushed 2026-09-20).
- **Licence:** "This project is MIT, though the original 3d DEM elevation data (10k/dem.jpg) and vector layers are uncertain."
- **10k DEM:** `data/rasters/10k/dem.jpg`
  - https://raw.githubusercontent.com/bburns/Arda/main/data/rasters/10k/dem.jpg returns 200, 4,414,201 bytes.
  - 10000×10000, 8-bit greyscale, 200.1 m per pixel. About 20% of pixels are 0 (sea).
  - World file `dem.wld`: `200.1, 0, 0, -200.1, -900, 2001100` (top-left pixel centre).
  - The README calls the alignment "slightly off". I found Nen Hithoel within about 1–2 km of the vector lake, and Mount Doom about 5 km from the vector volcano polygon.
- **32k DEM:** release `dem-32k-v1` (https://github.com/bburns/Arda/releases/tag/dem-32k-v1, published 2026-09-20).
  - 32257×32257 UInt16, 62.03 m per pixel, values 0–64727.
  - Four GeoTIFF quadrants: dem_nw.tif 264.7 MB, dem_ne.tif 273.4 MB, dem_sw.tif 161.4 MB, dem_se.tif 314.0 MB. Also hillshade.tif, 206.7 MB.
  - `data/rasters/32k/dem.vrt` is in git. GeoTransform origin (-1000.05, 2001200.05), pixel 62.0330 m. So both DEMs cover roughly x [-1000, 2,000,000] and y [200, 2,001,200].
  - Source: 64 Unreal Engine 16-bit PNG tiles (4033² each). The 8-bit JPEG has a tone curve baked in, so the 16-bit/8-bit ratio varies (about 224 low, 365 mid, 255 high). Calibration table: `docs/2026-09-20-32k-dem.md`.
- **Vectors:** `data/vectors/vectors.gpkg` (12.4 MB, EPSG:32631) holds the same ME-GIS layers with accents fixed. Combined_Placenames is trimmed to 259 labels. Contours are in `data/vectors/contours.gpkg` (32 MB).
  - Opening the GeoPackage from memory: its header is in WAL mode (bytes 18–19 = 2), so reset those bytes before `sqlite3.deserialize`. Opening from a normal file works fine.
- **Build script:** `scripts/build-dem.ps1` (needs GDAL, which ships with QGIS).

### C. austinw8/MiddleEarth (R package)
- https://github.com/austinw8/MiddleEarth. The same ME-GIS layers as `.rda` files, plus `miles_to_meters()`. Licence file is present but its type isn't recognised.
- Adds nothing new; skip.

### D. kwoxer/Arda-Maps: independent vectors with a Frodo route
- https://github.com/kwoxer/Arda-Maps (last push 2020, no licence, so all rights reserved by default).
- Third-age GeoJSON is in `QGIS/third age/arda3/`:
  - Polygons: poly_outline (coast), poly_mountainhigh, poly_mountainlow, poly_highland, poly_forest, poly_lake, poly_moor, poly_region.
  - Lines: line_river, line_road, line_waypath.
  - Points: point_city 35, point_place 30, point_mount 19, point_castletower 9, point_waterfall, point_ford, point_bridge.
- **Frodo's route:** `line_waypath` carries tags such as `wp-frodo` and `wp-frodo wp-merry wp-pippin`.
- **Coordinates:** labelled CRS84 but are tiny made-up degrees, bbox about (0.0004, -0.0307, 0.049, -0.0003).
- **Fit to ME-GIS:** an affine fit using 36 shared places left a median error of 25 km and an RMS of 37 km (Umbar off by 123 km). The maps are drawn differently, so this set can't be dropped onto ME-GIS without local rubber-sheeting. Use it for its route and points, not its geometry.

### E. Others (lower value)
- **Legacy ME-DEM download is gone:**
  - `https://keybase.pub/jvangeld/10k.bt` does not connect (keybase.pub has shut down).
  - `http://me-dem.me.uk` returns 410 Gone.
  - Forums still up: https://forum.outerra.com/index.php?topic=1491.0 and https://worlds.outercraft.com/forum/index.php
- **christiankarldelhey/Fantasy_Map_Creator:** Pete Fenlon's MERP map georeferenced onto Europe in PostGIS (EPSG:4326). The DEM is synthesised from peak points. No licence, not canon. Skip.
- **ArdaCraft DEM** on Tolkien Gateway: 1183×951 only.
- **Georeferencing notes:** http://gisninja.blogspot.com/2012/12/georeferening-middle-earth.html

## 2. Landmark coordinates (ME-GIS native metres, y points north)

**Normalising to 0..1:** use the DEM extent, `u = (x + 1000) / 2001000` and `v = (y - 200) / 2001000`. For 10k DEM pixels: `col = (x + 900) / 200.1`, `row = (2001100 - y) / 200.1`.

**Source key:**
- **P** = canon point feature: towns, cities, citadels and keeps with ORIGIN blank.
- **L** = label anchor from Combined_Placenames, which may sit a few km off the feature.
- **G** = derived from a polygon or river line.
- **D** = local peak in the 10k DEM, with the grey value shown.
- **E** = my estimate, about ±3 km.

| Place | x, y | Source and notes |
|---|---|---|
| Hobbiton | 518241, 1045233 | P (label 515948, 1043820) |
| Bag End | ~518250, 1045800 | E: just north of Hobbiton; Arda-Maps puts it slightly north |
| Bree | 598318, 1045197 | P |
| Weathertop / Amon Sûl | 673193, 1049127 | P (tower). Weather Hills DEM high point is 48 at 665833, 1052826 |
| Rivendell | 881105, 1054420 | P |
| Moria West-gate | 847291, 920986 | P ("Khazad-dûm"), next to the Lake of Moria polygon (846206–847004, 920436–921653); DEM cliff foot about 848500, 921000 |
| Moria East-gate / Dimrill Dale | ~887500, 929500 | E: head of the dale, NW of Mirrormere (889182–891781, 923789–929388). Labels: Dimrill Stair 888664, 933528; Dimrill Dale 889483, 930844 |
| Caradhras | label 872481, 939177 | Summit is ambiguous. DEM highs nearby: 199 at 888000, 942000; area maximum 217 at 868134, 922361, directly above Moria |
| Lothlórien | forest bbox 900631, 904924 to 978579, 953410 | G; Caras Galadhon P 969296, 921786 |
| Isengard / Orthanc | 805979, 812497 | P |
| Edoras | 863747, 723402 | P |
| Helm's Deep | 805415, 748074 | P (label 802135, 751170) |
| Fangorn | bbox 827114, 793282 to 929548, 879668; centre 878331, 836475 | G (label 889434, 832120) |
| Argonath | ~1080500, 764500 | E: Anduin gorge just above the lake inlet (1079476, 762073); label 1085257, 761932 |
| Rauros | 1074638, 744474 | G: where the Anduin leaves Nen Hithoel; DEM drops just south of it; label 1082084, 740642 |
| Amon Hen | ~1072600, 742700 | D/E: grey value 74, SW of the outlet |
| Nen Hithoel | bbox 1068997, 744475 to 1084595, 762473 | G |
| Emyn Muil | label 1114633, 787316 | L |
| Dead Marshes | polygon bbox 1117258, 737763 to 1168176, 769829; centre about 1142700, 753800 | G (mislabelled "Wetland 05 Nindalf"); label 1138789, 759159 |
| Morannon / Black Gate | 1181537, 723163 | P |
| Henneth Annûn | 1140324, 678923 | L (spelled "Henneth Arnen") |
| Osgiliath | 1138600, 629458 | P |
| Minas Tirith | 1120738, 618877 | P; Mindolluin DEM 167 at 1112857, 621611 |
| Minas Morgul | 1169735, 637427 | P |
| Cirith Ungol | 1186522, 640543 | P |
| Barad-dûr | 1253267, 671171 | P |
| Orodruin / Mount Doom | 1240100, 663400 | D: cone value 166 on a Gorgoroth plateau of about 90. Vector crater polygon centre 1234800, 662500; label 1230413, 667554 |
| Erebor | 1259345, 1184848 | P; DEM summit 160 at 1261331, 1188494 |
| Dale | 1257591, 1180840 | P |
| Lake-town / Esgaroth | 1272744, 1129148 | P; Long Lake bbox 1270121, 1118797 to 1278721, 1154993 |
| Dol Guldur | 1071014, 929617 | P |
| Grey Havens / Mithlond | 367917, 1042100 | P (label 373937, 1054576) |
| Sea of Rhûn centre | 1571366, 879627 | G: polygon bbox 1507172, 809134 to 1635559, 950120 |
| Mouths of Anduin | 995023, 485706 | L ("Ethir Anduin"); the named Anduin line ends at 1077620, 524849 near Pelargir and the delta is unnamed streams |

## 3. Reference map images (dev-only; all copyrighted unless stated)

**Access note for Tolkien Gateway:** it sits behind Cloudflare. `api.php` and requests without a browser User-Agent get 403. With a browser User-Agent, all URLs below returned 200. Every TG file listed is copyrighted and hosted there as "fair use".

**Canonical and film maps:**

| Map | Size | URL |
|---|---|---|
| Christopher Tolkien, General Map (1954) | 1920×2130 PNG | https://tolkiengateway.net/w/images/6/67/Christopher_Tolkien_-_General_Map_of_Middle-earth.png |
| Christopher Tolkien, "The West of Middle-earth at the End of the Third Age" (1980, Unfinished Tales; best linework) | 3840×2931 | https://tolkiengateway.net/w/images/f/fb/Christopher_Tolkien_-_The_West_of_Middle-earth.png |
| Same map, colourised | 3765×2879 | https://tolkiengateway.net/w/images/4/4f/The_West_of_Middle-earth_at_the_End_of_the_Third_Age_%28colorized%29.jpeg |
| Christopher Tolkien, Rohan/Gondor/Mordor map | 1920×1547 | https://tolkiengateway.net/w/images/d/d9/Christopher_Tolkien_-_Map_of_Rohan%2C_Gondor%2C_and_Mordor.png |
| Christopher Tolkien, A Part of the Shire | 1200×728 | https://tolkiengateway.net/w/images/6/62/Christopher_Tolkien_-_A_Part_of_the_Shire.jpg |
| Tolkien-annotated General Map (owned by Blackwell's) | 2837×2480 | https://tolkiengateway.net/w/images/c/ca/The_Annotated_Map_of_Middle-earth.jpeg |
| Pauline Baynes poster (1970) | 880×1224 (low) | https://tolkiengateway.net/w/images/5/5c/Pauline_Baynes_-_A_Map_of_Middle-earth_%28color%29_2.jpg |
| Film Middle-earth map poster (New Line; filed under Daniel Reeve) | 3500×3527 | https://tolkiengateway.net/w/images/8/8a/The_Lord_of_the_Rings_%28film_series%29_-_Middle-earth_map_poster.jpg |
| Daniel Reeve, Mordor (merchandise) | 2700×2368 | https://tolkiengateway.net/w/images/a/a7/Daniel_Reeve_-_Map_of_Mordor_%28Merchandise%29.jpg |
| Daniel Reeve, Mordor (Decipher) | 1607×1200 | https://tolkiengateway.net/w/images/1/11/Daniel_Reeve_-_Map_of_Mordor_%28Decipher%29.jpg |

- **Daniel Reeve's own site:** https://www.danielreeve.co.nz/LOTR/Maps/ has images of at most 700 px (for example `images/Merch1a.jpg`, 620×625), © New Line.
- **Karen Wynn Fonstad:** no legitimate high-resolution host found. The 1991 atlas is on Internet Archive as controlled lending: https://archive.org/details/atlasofmiddleear00fons
- **Baynes alternatives:** only low-res online (Wikipedia fair-use copy is 268×372).

**Freely licensed Wikimedia Commons maps:**

| Map | Licence | Size | URL |
|---|---|---|---|
| Rolf Schwemmer, Frodo's and Aragorn's travels (useful for the route) | CC BY 3.0 | 2544×3508 | https://upload.wikimedia.org/wikipedia/commons/0/0d/RolfsMapOfTolkiensMiddleEarth_Frodos_and_Aragorns_Travels.jpg |
| Sketch Map of Middle-earth | CC BY-SA 4.0 | SVG | https://upload.wikimedia.org/wikipedia/commons/b/b7/Sketch_Map_of_Middle-earth.svg |
| Geomorphology of Middle-earth | CC BY-SA 4.0 | SVG | https://upload.wikimedia.org/wikipedia/commons/d/d9/Geomorphology_of_Middle-earth.svg |
| Map of Middle-Earth | CC BY-SA 4.0 | SVG | https://upload.wikimedia.org/wikipedia/commons/4/44/Map_of_Middle-Earth.svg |
| Tolkien Anduin River | Public domain | 600×1200 | https://upload.wikimedia.org/wikipedia/commons/4/4a/Tolkien_Anduin_River.png |

## 4. Scale facts

**Horizontal scale (ME-GIS to Tolkien miles):**
- ME-GIS distances need doubling (Andrew Heiss, https://www.andrewheiss.com/blog/2023/04/26/middle-earth-mapping-sf-r-gis/). His Hobbiton→Rivendell comes out at 229 mi raw, 458 mi doubled, matching Fonstad.
- **Rule (DERIVED):** 1 Tolkien mile ≈ 805 ME-GIS units, so the whole 2001 km grid is about 2,490 mi square.
- The factor is only roughly constant. Straight-line checks with ×2 applied:

| Pair | Doubled distance | Tolkien figure |
|---|---|---|
| Hobbiton→Rivendell | 451 mi | 458 mi |
| Morannon→Barad-dûr | 110 mi | about 100 mi |
| Hobbiton→Minas Tirith | 530 mi south, 917 mi straight | 600 mi south (Letter 294); TG says about 900 mi east |
| Mount Doom→Barad-dûr | 19–25 mi | about 30 mi (TG) |
| Isengard→Helm's Deep | 80 mi | looks too long (UNVERIFIED) |
| Hobbiton→Mount Doom | about 1,015 mi straight line | |

**Map scale and latitude:**
- Tolkien's working map used 2 cm squares, each 100 miles (TG, "The First Map of The Lord of the Rings").
- Hobbiton and Rivendell are at about the latitude of Oxford, Minas Tirith 600 mi south at about Florence, and the Mouths of Anduin/Pelargir at about Troy (Letter 294, https://tolkiengateway.net/wiki/Letter_294).

**Route lengths (the figures disagree):**
- Frodo's route Bag End→Mount Doom is 1,779 mi per the Eowyn Challenge, which measured it from Fonstad's atlas; that figure includes detours and 389 mi by boat.
- CBR's legs, measured from Christopher Tolkien's scale bar: Shire→Bree 120, Bree→Rivendell 300, Rivendell→Lórien 175, Lórien→Parth Galen 300, Parth Galen→Black Gate 160, Black Gate→Minas Morgul 110, Minas Morgul→Mount Doom 70; total 1,235 mi (https://www.cbr.com/frodo-sam-lotr-how-far-walked/).
- TheOneRing.net: about 1,800 mi in 185 days; Bag End→Rivendell in 27 days.

**Heights:**
- **Mount Doom:** about 4,500 ft above the plain, on a base about 3,000 ft high (TG). The DEM agrees: the cone rises 76 grey levels × 19.05 m ≈ 1,450 m above Gorgoroth. The UBC project normalised Mount Doom to 1,371.6 m.
- **Misty Mountains:** run 900 mi. Fonstad estimates peaks up to 12,000 ft / 3,660 m. The DEM has Caradhras-area highs of 199–217 grey levels, about 3.8–4.1 km.
- **Erebor:** "possibly about 3,500 metres" (TG, source uncertain). DEM value 160 ≈ 3,050 m above sea.
- **Minas Tirith:** Citadel 700 ft above the plain; the Tower of Ecthelion brings the total to 1,000 ft. Fonstad puts the city's breadth at about 3,100 ft.
- **Orthanc:** 500 ft.
- **Amon Hen:** "I doubt if it was much over 1,000 feet" (Tolkien, 1959 letter).
- **Mindolluin:** 10,459 ft is a MERP figure, not canon.
- **Caradhras, Weathertop, Argonath:** no canon heights found.

## RECOMMENDATION

1. **Terrain:** take the heightmap from bburns/Arda's 32k 16-bit DEM (release dem-32k-v1). Use GDAL to crop and downsample it to a 2048–4096² 16-bit PNG or R16 that the Iris Plus GPU can handle. Fall back to the 10k JPEG, where 1 grey level ≈ 19.05 m.
2. **Masks and features:** build them from ME-GIS/Arda vectors filtered to `ORIGIN=''`, then rasterise into the same grid:
   - coastline (close the lines into polygons, then cross-check against DEM value 0 = sea);
   - canon rivers, lakes, forests (Mirkwood, Fangorn, Lórien, Old Forest), wetlands and roads;
   - landmark positions from the point layers, not the labels (table in §2).
3. **Optional detail:** add MERP streams and forest patches for drainage and texture detail, accepting that they are non-canon and their licence is unclear.
4. **Mountain ranges:** keep them exactly as the DEM has them (they were hand-edited from Tolkien's maps). Exaggerate vertical scale for the diorama look, and nudge landmark peaks to canon values: Orodruin about 1.37 km above Gorgoroth, Amon Hen about 300 m.
5. **Reference overlay:** use Christopher Tolkien's 1980 West of Middle-earth map (3840 px) and the Rolf Schwemmer route map only as dev overlays to check coastlines and rivers, and to draw Frodo's route. Build the route from the ME-GIS roads (Great East Road) plus the §2 waypoints, not from the Arda-Maps paths, which don't align with ME-GIS.
6. **Credit and permission:** credit the ME-DEM team (monks, SeerBlue, Redrobes, jvangeld) and bburns/Arda. The ME-GIS README asks users to request permission, so ask before any public release of the video.