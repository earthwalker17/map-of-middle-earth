Research ran on 2026-09-28/29 (web search, fetch, and HTTP checks). Every image URL below returned HTTP 200 when checked. Hex values marked **[measured]** were computed from the actual film stills: each still was fetched into memory and reduced with a 6-colour median-cut (Pillow), plus the average colour of the top 30% / middle 40% / bottom 30% bands (T/M/B). No files were written. These are graded film colours and lean dark, so use the mid-tones as base colours, not the shadows. Values marked **[est]** are my own estimates. **[unverified]** means I could not confirm it.

### DOWNLOAD NOTES
- **Tolkien Gateway (TG)** images at `tolkiengateway.net/w/images/...` return 200 with any user agent (including the curl and Python defaults). TG wiki pages need a browser user agent. The WebFetch tool gets 403 there, but curl works.
- **Fandom** `static.wikia.nocookie.net/lotr/images/...` returns **403 unless you send `Referer: https://lotr.fandom.com/`**. With that header it returns 200 (tested).
- **Wikimedia Commons**: `https://commons.wikimedia.org/wiki/Special:FilePath/<File_name>` redirects (302/301) to upload.wikimedia.org and then returns 200. Send a descriptive user agent. Licences are CC.
- **Weta shop product shots** (`wetanz.com/media/catalog/product/...`): drop the `?optimize=...` query to get full size. All returned 200.
- **Copyright**: the film stills and concept art are copyrighted. Use them only as internal reference; do not put them in the video.

---

## WETA "BIGATURES" (physical miniatures): what exists
- **Count**: about 68 miniature environments (American Society of Cinematographers article, https://theasc.com/article/lord-of-the-rings-fellowship-of-the-rings-vfx/) or 72 (Wikipedia, https://en.wikipedia.org/wiki/Production_of_The_Lord_of_the_Rings_film_series). The sources disagree.
- **People and method**: John Baster and Mary Maclachlan led the builds; Alex Funke was miniatures director of photography. They shot with motion-control cameras (Arri 435B, down to about 10 minutes per frame) and computer-controlled smoke density. Rock faces were moulded from the Wellington coastline, sprayed in urethane and hung on steel frames. Scales used were 1/12, 1/24, 1/36 and 1/72.
- **In this track's scope**:
  - **Rivendell**: 1/24, built straight from Alan Lee paintings with no technical drawings. ASC says Rivendell, Isengard, Moria and Caradhras were all 1/12 or 1/24.
  - **Orthanc**: 1/35. Carved in micro-crystalline wax, silicone-moulded, then cast in clear resin to read as black obsidian. It was composited onto a digital matte painting of the Isengard ring.
  - **Isengard**: separate dam and ring miniatures; the flood used two big tanks released by blowing bolts. The "60 ft across" figure comes only from CBR, a secondary source.
  - **Helm's Deep**: 1/35 for wide shots, plus a walk-around 1/4-scale section at Dry Creek Quarry (Wellington) that was demolished on camera.
  - **Lothlórien**: eight mallorn trees, 26 ft tall and 5 ft across; steel frame, carved polystyrene, urethane skin; shot with smoke and fairy lights.
  - **Fangorn**: trees about 5 ft tall made from real gorse branches; modular wheeled bases covering 60+ sq ft.
  - **Moria**: Dwarrowdelf hall with hundreds of repeated pillars, and the staircase sequence (about 2 minutes, all miniature).
  - **Mithlond (Grey Havens)**: listed by TG, no details.
  - Source for the Two Towers entries: https://lynbaileyreflectivejournal.wordpress.com/2012/11/20/weta-workshop-on-the-lord-of-the-rings-take-2/ (secondary, citing the Extended Edition appendices). Source for the Fellowship entries (Rivendell, Orthanc, Lothlórien, Moria): https://lynbaileyreflectivejournal.wordpress.com/2012/11/15/weta-workshop-on-the-lord-of-the-rings/ (same caveat). Bigature list also on TG: https://tolkiengateway.net/wiki/Bigatures
- **Outside this track**:
  - Minas Tirith: 1/72, parts at 1/14, about 7 m tall.
  - Barad-dûr: 1/166, 26 ft tall, built in stages.
  - Black Gate: 1/30, motorised.
  - Osgiliath: 1/50 and 1/10.
  - Argonath: 1/60, about 8 ft.
  - Also Cirith Ungol, Minas Morgul, Grond, Corsair ships.
- **Hobbit films**: mostly full-scale sets plus Weta Digital CG, not bigatures. Lake-town was a full-scale wet set at Stone Street Studios with a CG town added (https://www.theonering.net/torwp/2013/10/24/81159-set-visit-exclusive-bringing-lake-town-to-life-for-the-hobbit-the-desolation-of-smaug/). I found no source for Erebor or Dale bigatures **[unverified]**.
- **Modern Weta "Environment" statues**: these are hand-painted physical minis and the closest match to our look.
  - Helm's Deep by Leonard Ellis, "created using reference to the original shooting bigatures, set plans and on-set photography" (https://www.wetanz.com/us/helms-deep).
  - Rivendell, rebuilt 2026, includes the Council courtyard (https://www.wetanz.com/us/rivendell-environment).
  - Orthanc, Doors of Durin, Front Gate to Erebor, Bag End, Lothlórien, Grey Havens.

---

## 1. THE SHIRE / HOBBITON (Matamata set)
- **Location**: Alexander family sheep farm (about 1,250 acres), roughly 10 km SW of Matamata. The site was chosen because a huge pine stood beside a lake at the foot of a hill, with no power lines in view (https://www.hobbitontours.com/discover/our-story/). The set covers 5.5 ha with 44 hobbit holes built at different scales. It was temporary in 1999 and rebuilt permanently in 2010–11 (https://en.wikipedia.org/wiki/Hobbiton_Movie_Set).
- **(a) Silhouette**:
  - A rounded grassy hill ("the Hill") with Bag End at the top, under a large lone oak.
  - Terraces of round doors (Bagshot Row) step down the slope.
  - At the foot: the Party Field and Party Tree (the real pine) beside the Bywater pond.
  - Across the water: the Green Dragon inn, a double-arched stone bridge, and a mill with a waterwheel.
  - Around it: patchwork hedgerow fields and soft rolling hills.
- **(b) Close-up**:
  - Round painted doors with a central knob (Bag End's is green); round windows.
  - Hobbit holes are dug into turf banks, with brick or stone chimneys poking out of the grass.
  - Picket fences, gates, vegetable and flower gardens, washing lines, benches, wheelbarrows, beehives.
  - The Bag End oak is fake: a 26-tonne tree with steel and silicone limbs and wired artificial leaves.
  - Sign: "No admittance except on party business".
  - Party Field has bunting and a marquee.
- **(c) Palette** [measured, Fellowship "Hobbiton" still]: `#5f702d` `#4c5e22` `#3a491a` grass/foliage; `#7ea078` highlight; T/M/B `#3f583d` `#384819` `#475720`.
  - Battle of the Five Armies Hobbiton still: brighter lime `#9eac28` `#708315` `#bbc94e`, sky `#ccf1ea`.
  - Real set (Commons): Bag End greens `#607f35` `#3d521f`; Bywater pond `#667b35` / `#649a93`, sky `#85bfe1`.
  - [est] Door colours: green `#2f5d3a`, yellow `#d9a441`, red `#8e2f25`, blue `#3c5f8c`. Thatch/timber `#8a6a44`. Chimney brick `#8c5a3c`.
- **(d) Lighting**: warm, saturated late-summer sun; golden hour; soft haze; the most saturated and "safe" grade in the films. The Hobbit films are cooler and cleaner.
- **(e) Refs**:
  - TG Fellowship still, 1920×800: https://tolkiengateway.net/w/images/b/b6/The_Lord_of_the_Rings_-_The_Fellowship_of_the_Ring_-_Hobbiton.jpg
  - TG Unexpected Journey still, 2000×1334: https://tolkiengateway.net/w/images/5/5a/The_Hobbit_-_An_Unexpected_Journey_-_Gandalf_in_Hobbiton.jpg
  - TG mill: https://tolkiengateway.net/w/images/0/0d/The_Lord_of_the_Rings_-_The_Fellowship_of_the_Ring_-_The_Old_Mill.png
  - Commons mill and bridge, 4928×3264: https://commons.wikimedia.org/wiki/Special:FilePath/Hobbiton_mill_and_double-arched_bridge.jpg
  - Commons Bag End: https://commons.wikimedia.org/wiki/Special:FilePath/Bag_End,_Bilbo_Baggins_House,_Hobbiton_Movie_Set,_Matamata,_New_Zealand_2016_(50797473207).jpg
  - Weta Bag End mini: https://www.wetanz.com/media/catalog/product/8/6/86-10-00783_lotr_bagend_open_001.png

## 2. BREE (gate, Prancing Pony)
- **Location**: set built at Fort Dorset, Seatoun, Wellington (https://movie-locations.com/movies/l/Lord-Of-The-Rings-Fellowship-Of-The-Ring.php).
- **(a) Silhouette**: a dense walled town behind a tall timber palisade, with a big double wooden gate under a gatehouse; steep crowded roofs; a hill behind **[est]**.
- **(b) Close-up**:
  - Gate has a small sliding peep-hatch for the gatekeeper.
  - Muddy cobbled lanes; jettied, half-timbered and stone houses in an English late-medieval / Tudor style.
  - The Prancing Pony is a large multi-storey timber-framed inn with a hanging sign of a rearing white pony; smoky, warm interior.
- **(c) Palette** [measured, both film stills are night and rain]: `#010408` `#0b1f23` `#1c3b42`; T/M/B `#020b10` `#09171b` `#0a181c` (near-black teal). [est] Window and lantern glow `#e2a452`; wet timber `#3b2e22`; plaster `#9c8f78`.
- **(d) Lighting**: night, downpour, cold blue-teal with small warm window glows; hostile.
- **(e) Refs**:
  - TG Bree: https://tolkiengateway.net/w/images/b/b0/The_Lord_of_the_Rings_-_The_Motion_Picture_Trilogy_-_Bree.jpg
  - TG Prancing Pony: https://tolkiengateway.net/w/images/1/12/The_Lord_of_the_Rings_-_The_Fellowship_of_the_Ring_-_At_the_Sign_of_the_Prancing_Pony.jpg
  - TG Ringwraiths enter Bree: https://tolkiengateway.net/w/images/1/19/The_Lord_of_the_Rings_%28film_series%29_-_Ringwraiths_Enter_Bree.jpg
  - Alan Lee "The Inn at Bree": https://tolkiengateway.net/w/images/2/2b/Alan_Lee_-_The_Inn_at_Bree.jpg
  - Fandom wide shot (needs Referer), caption "Bree at night-time": https://static.wikia.nocookie.net/lotr/images/a/ad/Image-Breewide.jpg

## 3. WEATHERTOP / AMON SÛL
- **Location**: the Weathertop camp scenes were shot near Te Anau (movie-locations.com).
- **(a) Silhouette**: a lone steep conical hill standing above lower hills, crowned by a ring of broken stone arches and pillars (the ruined watchtower), with a hollow just below the summit.
- **(b) Close-up**: grey weathered ashlar blocks, broken arch segments and column stumps in a circle, fallen masonry, lichen, bare rock ledges, a stair path.
- **(c) Palette** [measured, Fellowship still]: `#3a4435` `#3c4e4a` `#46584f` `#566960`; T/M/B `#314449` `#394942` `#3e4937` (cool slate-teal and moss).
  - Fandom dusk still: sky `#cabaa4`, stone `#5a5755`.
  - [est] Stone albedo `#7a7a70`.
- **(d) Lighting**: dusk into moonlit night, desaturated blue, wind; a small campfire is the only warm source.
- **(e) Refs**:
  - TG Fellowship still: https://tolkiengateway.net/w/images/0/00/The_Lord_of_the_Rings_-_The_Fellowship_of_the_Ring_-_Weathertop.png
  - Alan Lee, 1600×1103: https://tolkiengateway.net/w/images/8/89/Alan_Lee_-_Weathertop.jpg
  - John Howe "Weathertop on the Horizon": https://tolkiengateway.net/w/images/2/29/John_Howe_-_Weathertop_on_the_Horizon.jpg
  - Fandom (Referer): https://static.wikia.nocookie.net/lotr/images/2/2e/Weathertop%27s_view.png

## 4. RIVENDELL
- **Location and sources**: Kaitoke Regional Park (Upper Hutt) plus studio sets plus the 1/24 bigature. The Wellington set had an autumn glade of fibreglass trunks, a Japanese-style bridge over a waterfall, slim wooden pillars and rooms with no outer walls (Ian McKellen's blog, https://mckellen.com/cinema/lotr/001128.htm).
- **(a) Silhouette**: a deep, narrow, steep-walled gorge with several tall ribbon waterfalls. Pale terraced buildings cling to the ledges on both sides, joined by a thin high arched bridge, with autumn trees filling the valley.
- **(b) Close-up**:
  - Celtic / Art Nouveau: slender columns, organic curving tracery (branches and leaves), open pavilions and gazebos, curved roofs.
  - Bridges without railings; the circular Council courtyard; balconies over the falls.
- **(c) Palette**:
  - [measured, Fellowship still] `#876950` `#634935` `#493322` `#ada182`; T/M/B `#675b48` `#584332` `#493624` (warm amber, ochre, brown).
  - [measured, Unexpected Journey still] `#9f8a68` `#6d6755` `#4c4737`.
  - Real Kaitoke location: `#686559` `#9e9d77`.
  - [est] Stone `#d6c7a1`; roof slate `#6e6a5c`; autumn leaves `#b5702a` / `#d19a3a`; waterfall white `#e8eef0`.
- **(d) Lighting**: soft golden autumn afternoon, mist from the falls, gentle backlight. It is the warmest and calmest grade in the films.
- **(e) Refs**:
  - TG Fellowship still: https://tolkiengateway.net/w/images/7/7b/The_Lord_of_the_Rings_-_The_Fellowship_of_the_Ring_-_Rivendell.jpg
  - TG Fellowship departing, 2556×1068: https://tolkiengateway.net/w/images/9/9f/The_Lord_of_the_Rings_-_The_Fellowship_of_the_Ring_-_The_Departure_of_the_Fellowship_from_Rivendell.png
  - TG Unexpected Journey, 2048×1152: https://tolkiengateway.net/w/images/7/7d/The_Hobbit_-_An_Unexpected_Journey_-_The_Company_arrive_at_Rivendell.jpg
  - Alan Lee, 1738×1070: https://tolkiengateway.net/w/images/4/41/Alan_Lee_-_Rivendell.png
  - John Howe "Descent into Rivendell": https://tolkiengateway.net/w/images/3/3c/John_Howe_-_Descent_into_Rivendell.jpg
  - Weta 2026 Rivendell mini: https://www.wetanz.com/media/catalog/product/_/l/_lotr_rivendell2026_001_1.png

## 5. MISTY MOUNTAINS & CARADHRAS
- **Location**: Southern Alps and glaciers stood in for the Misty Mountains; snow slopes on Whakapapa, Ruapehu (movie-locations.com).
- **(a) Silhouette**: a long north–south spine of jagged, heavily glaciated alpine peaks. Caradhras is a massive steep pyramidal peak with a knife-edge shoulder (the Redhorn pass).
- **(b) Close-up**: deep snow ledge path, cornices, black rock ribs through the snow, spindrift.
- **(c) Palette**:
  - [measured, Fellowship "on Caradhras" still] `#558f9e` `#67949d` `#47808e` `#115970` `#062d42`; T/M/B `#317083` `#286275` `#335e6d` (strongly cyan-teal).
  - Fandom Redhorn still: `#dbdeda` `#c8ccc9` `#abb3b4` `#6b92a2` (snow white-grey with blue shadows).
  - Fandom Misty Mountains still: sky `#6a7381`, rock `#484b48`.
- **(d) Lighting**: overcast blizzard, flat cold blue, lightning and avalanche; in distant wides, sunlit snow against dark rock.
- **(e) Refs**:
  - TG Fellowship still, 2560×1070: https://tolkiengateway.net/w/images/f/fe/The_Lord_of_the_Rings_-_The_Fellowship_of_the_Ring_-_The_Fellowship_on_Caradhras.png
  - Alan Lee "Pass of Caradhras": https://tolkiengateway.net/w/images/d/de/Alan_Lee_-_The_Pass_of_Caradhras.jpg
  - John Howe "Company Approaches Caradhras": https://tolkiengateway.net/w/images/6/61/John_Howe_-_The_Company_Approaches_Caradhras.jpg
  - Fandom (Referer): https://static.wikia.nocookie.net/lotr/images/a/a4/Caradhras.png

## 6. MORIA: West-gate (Doors of Durin, lake) and Dimrill Dale (east side)
- **(a) Silhouette, west**: a sheer dark cliff wall rising straight out of a still black lake (the dammed Sirannon), a narrow shelf path along its foot, and two holly trees marking where the doors are.
- **(a) Silhouette, east (Dimrill Dale)**: the Fellowship comes out onto steep grey boulder and scree slopes under snowy peaks.
- **(b) Close-up**:
  - The doors are invisible in the cliff face until moonlight reveals silver ithildin lines: an arch on pillars, crown and seven stars, anvil and hammer, two trees, and the Star of Fëanor in the centre.
  - The Watcher's tentacles come out of the lake.
  - Inside: the Dwarrowdelf hall's forest of square pillars.
- **(c) Palette**:
  - [measured, fandom "Durin's door" moonlit still] `#020907` `#0d1b1d` `#283f48`, highlight `#5f7784`; T/M/B `#1b282b` `#19282c` `#132325`. [est] Ithildin glow `#dff3ff`.
  - [measured, Dimrill Dale still "Az.JPG", caption confirms Fellowship film] `#637f81` `#759291` `#4f5755` `#303231`; T/M/B `#527275` `#283132` `#393c3a` (teal-grey overcast, dark rock).
- **(d) Lighting**: west side is night, cold moonlight and a mirror-still lake. East side is grey, grief-heavy overcast.
- **(e) Refs**:
  - TG film Doors of Durin prop illustration: https://tolkiengateway.net/w/images/f/f1/The_Lord_of_the_Rings_-_The_Fellowship_of_the_Ring_-_Doors_of_Durin_Illustration.png
  - Alan Lee "West-gate of Moria": https://tolkiengateway.net/w/images/e/ed/Alan_Lee_-_The_West-gate_of_Moria.jpg
  - John Howe "Moria Gate": https://tolkiengateway.net/w/images/c/c9/John_Howe_-_Moria_Gate.jpg
  - Fandom Durin's door (Referer): https://static.wikia.nocookie.net/lotr/images/2/2e/Durin%27s_door.png
  - Fandom Dimrill Dale (Referer): https://static.wikia.nocookie.net/lotr/images/5/52/Az.JPG
  - TG Moria hall: https://tolkiengateway.net/w/images/e/e4/The_Lord_of_the_Rings_-_The_Motion_Picture_Trilogy_-_Moria.jpg
  - Weta Doors of Durin mini: https://www.wetanz.com/media/catalog/product/8/6/86-10-03273_lotr_moriagates_001.png

## 7. LOTHLÓRIEN / CARAS GALADHON
- **Location**: Fernside Lodge, Featherston (woods); Paradise, Glenorchy (movie-locations.com).
- **(a) Silhouette**: giant smooth-trunked mallorns rise well above the surrounding forest, with pale gold-green crowns. Caras Galadhon is a cluster of the biggest trees, glowing from inside with lamps at night.
- **(b) Close-up**:
  - Silver-grey, smooth, slightly fluted trunks.
  - White flets (platforms) with curving Art Nouveau balustrades.
  - Spiral stairs wrapped around the trunks; lanterns; Galadriel's mirror glade.
- **(c) Palette**:
  - [measured, Caras Galadhon arrival still] `#9f8d69` `#b7b58a` `#765834` `#493419`; T/M/B `#8a7d5c` `#4c3d25` `#25180a` (gold canopy over dark forest).
  - [measured, "Farewell to Lórien"] `#c3d0b6` `#989f88` `#506359` `#0e3742`; T/M/B `#919b81` `#3b5658` `#152e36` (silver-sage and teal).
  - Fandom Caras Galadhon still: sky `#a4acb2`.
  - [est] Bark `#b9bdb6`; leaves `#c9b458`; lantern `#f2e6b0`.
- **(d) Lighting**: diffuse, silvery, dreamlike; at night, blue-silver with warm lamps; smoke gives depth.
- **(e) Refs**:
  - TG Caras Galadhon: https://tolkiengateway.net/w/images/3/38/The_Lord_of_the_Rings_-_The_Motion_Picture_Trilogy_-_Caras_Galadhon.jpg
  - TG Farewell to Lórien, 2560×1068: https://tolkiengateway.net/w/images/7/73/The_Lord_of_the_Rings_-_The_Fellowship_of_the_Ring_-_Farewell_to_L%C3%B3rien.png
  - Alan Lee: https://tolkiengateway.net/w/images/0/02/Alan_Lee_-_Lothl%C3%B3rien.png
  - Fandom Caras Galadhon (Referer): https://static.wikia.nocookie.net/lotr/images/7/7c/Carasgaladhon.jpg
  - Weta Lothlórien product: https://www.wetanz.com/media/catalog/product/5/0/509x297-01-web_thumbnail.jpg.png

## 8. FANGORN
- **(a) Silhouette**: a dark, dense forest mass climbing the eastern foothills at the southern end of the Misty Mountains, with snow peaks behind.
- **(b) Close-up**: enormous gnarled, twisted trunks, buttress roots, hanging moss and lichen, ferns, a deep leaf-litter floor, mist, old stone outcrops.
- **(c) Palette**:
  - [measured, fandom Fangorn still] `#23281b` `#141a12` `#3d412c` `#706f51`; T/M/B `#1a1f16` `#2d3225` `#24291b` (deep olive-moss).
  - [measured, Two Towers "Fangorn Forest and the Misty Mountains"] sky `#88baca` / `#bcced3`, forest `#13211a` `#224346`.
- **(d) Lighting**: very low-key, green-grey, shafts through mist; claustrophobic.
- **(e) Refs**:
  - TG Two Towers, 2556×1096: https://tolkiengateway.net/w/images/3/33/The_Lord_of_the_Rings_-_The_Two_Towers_-_Fangorn_Forest_and_the_Misty_Mountains.png
  - Fandom (Referer): https://static.wikia.nocookie.net/lotr/images/3/36/TTTFangornForest.jpg
  - Alan Lee "The Forest of Fangorn": https://tolkiengateway.net/w/images/4/4a/Alan_Lee_-_The_Forest_of_Fangorn.jpg

## 9. ISENGARD / ORTHANC
- **Location**: Harcourt Park, Upper Hutt, for the ground-level exteriors. Book scale: the ring is about a mile across and Orthanc about 500 ft **[from the book, not checked for this task]**.
- **(a) Silhouette**: a perfect circle of sheer dark rock wall with one gate, at the southern end of the Misty Mountains (Nan Curunír), and a single black tower in the centre. The tower is four faceted piers that rise into four sharp horn-like spires around a flat summit platform.
- **(b) Close-up**:
  - Glossy black obsidian-like faceted stone with vertical ribbing, narrow windows, a balcony, and a stair up to the door.
  - Fellowship (before): gardens and trees inside the ring.
  - Two Towers (after): open pits with forge fires, smoke, timber gantries, wheels, chains, bare mud.
  - Flooded state after the Ents.
- **(c) Palette**:
  - [measured, film Isengard still] `#6d7382` `#4e5564` `#969ca6` `#101212`; T/M/B `#5d6274` `#4f545b` `#1c2021` (steel blue-grey).
  - Before: sky `#778296`, ground `#444131`. After: `#424d56` `#2d3438`.
  - [est] Orthanc albedo `#141619` with a cool specular highlight `#8a93a3`; pit fire `#ff7a1e`.
- **(d) Lighting**: cold overcast; at night, orange underlight from the pits with rising smoke columns. Saruman's summit at night is almost black (TG "Gandalf atop Orthanc" measured `#03090d`).
- **(e) Refs**:
  - TG Isengard, 2026×1157: https://tolkiengateway.net/w/images/c/cc/The_Lord_of_the_Rings_%28film_series%29_-_Isengard.jpg
  - TG Orthanc: https://tolkiengateway.net/w/images/c/c7/Orthanc_film.jpg
  - TG Return of the King Isengard: https://tolkiengateway.net/w/images/0/06/The_Lord_of_the_Rings_-_The_Return_of_the_King_-_Isengard.jpg
  - Fandom before (Referer): https://static.wikia.nocookie.net/lotr/images/0/03/Isengard_before.jpeg
  - John Howe "Orthanc": https://tolkiengateway.net/w/images/f/fc/John_Howe_-_Orthanc.jpg
  - Weta Orthanc mini: https://www.wetanz.com/media/catalog/product/_/l/_lotr_miniorthanc_002.jpg

## 10. EDORAS / MEDUSELD
- **Location**: full-scale set on Mount Sunday, Rangitata Valley, Canterbury; about 9 months to build, then removed (https://newzealandfilmmap.com/locations/mount-sunday-edoras/).
- **(a) Silhouette**: an isolated rocky knoll rising from a wide braided-river valley ringed by snowy ranges. A wooden palisade circles the hill, and the long steep-roofed Golden Hall sits on the summit.
- **(b) Close-up**:
  - Stone stair and terrace up to Meduseld; carved and painted timber gables and posts with Rohirric knotwork and horse motifs **[est on motif details]**; gilded roof.
  - Thatched and shingled houses; green banners with a white horse.
  - Burial mounds with white simbelmynë flowers outside the gate.
- **(c) Palette**:
  - [measured, Two Towers "Meduseld" still] sky `#a6b1bf` / `#c3cdd7`, mid `#8b8f90`, ground `#51524f` `#201f16`.
  - Fandom Edoras still: T/M/B `#abbec4` `#515e5c` `#333830`.
  - Real Mount Sunday: sky `#4d85d6`, tussock `#746b4d`.
  - [est] Gold roof `#b8923a`; timber `#5a3f28`; banner green `#2e4a2c`.
- **(d) Lighting**: windswept, cold, bright-overcast, desaturated; flags cracking; a melancholy "fading kingdom" feel.
- **(e) Refs**:
  - TG Meduseld, 2940×1230: https://tolkiengateway.net/w/images/7/7f/The_Lord_of_the_Rings_-_The_Two_Towers_-_Meduseld.jpg
  - TG Return of the King at Edoras: https://tolkiengateway.net/w/images/7/76/The_Lord_of_the_Rings_-_The_Return_of_the_King_-_Gandalf_and_Aragorn_at_Edoras.png
  - Fandom (Referer): https://static.wikia.nocookie.net/lotr/images/2/2e/Edoras.jpg
  - John Howe "Edoras 01": https://tolkiengateway.net/w/images/4/4f/John_Howe_-_Edoras_01.jpg
  - Commons Mount Sunday: https://commons.wikimedia.org/wiki/Special:FilePath/Mount_Sunday_MRD_01.jpg

## 11. HELM'S DEEP (Deeping Wall, Hornburg, culvert, gorge)
- **Location**: Dry Creek Quarry, Wellington, plus the 1/35 and 1/4 bigatures.
- **(a) Silhouette**: a fortress plugging the mouth of a steep gorge at the foot of the White Mountains. A long, slightly curved Deeping Wall runs from the Hornburg (a keep with a tall tower on a rocky spur) across to the far cliff. A causeway ramp leads to the Hornburg gate.
- **(b) Close-up**:
  - Massive grey dressed-stone masonry, crenellations, a thick timber Great Gate.
  - A small culvert at the base of the wall where the Deeping Stream exits (the breach point).
  - Stairs; the Glittering Caves behind.
- **(c) Palette**:
  - [measured, fandom day still] `#5f5e5e` `#4d4f53` `#939295` `#2b343b`; T/M/B `#3f454b` `#4b4e53` `#807f7e` (neutral cool grey stone).
  - Siege at night: `#0c1a24` `#142836` `#1a3648` (deep navy).
  - [est] Stone albedo `#8d8a84`; torch `#ffae42`.
- **(d) Lighting**: night, torrential rain, lightning, torchlight. At dawn, a white-gold sunburst over the ridge when Gandalf arrives.
- **(e) Refs**:
  - TG Aragorn arrives: https://tolkiengateway.net/w/images/f/fd/The_Lord_of_the_Rings_-_The_Two_Towers_-_Aragorn_Arrives_At_Helm%27s_Deep.jpg
  - TG Fangorn comes to Helm's Deep, 2560×1076: https://tolkiengateway.net/w/images/e/e3/The_Lord_of_the_Rings_-_The_Two_Towers_-_Fangorn_Comes_to_Helm%27s_Deep.png
  - Fandom (Referer): https://static.wikia.nocookie.net/lotr/images/d/d3/Helm%27s_Deep_-_TtT.png
  - Alan Lee: https://tolkiengateway.net/w/images/f/f9/Alan_Lee_-_Helm%27s_Deep.png
  - John Howe: https://tolkiengateway.net/w/images/6/6d/John_Howe_-_Helm%27s_Deep.jpg
  - Weta Helm's Deep mini: https://www.wetanz.com/media/catalog/product/_/l/_lotr_helmsdeep_001_1.png

## 12. ROHAN PLAINS
- **(a) Silhouette**: vast rolling golden tussock downs, rocky outcrops and gullies, huge skies, with the White Mountains on the southern horizon.
- **(b) Close-up**: tussock clumps, schist tors, braided riverbeds, scattered villages. Westfold and Westemnet stills exist on TG.
- **(c) Palette**:
  - [measured, "Eastemnet Downs"] sky `#9dcef4` / `#c1def3`, grass `#7c6238` `#a39b7c`; T/M/B `#8eb7d4` `#5f6354` `#80693d`.
  - Charge of the Rohirrim (fandom "Rohancharge"): `#c5975c` `#916f45` `#57462d`.
- **(d) Lighting**: high clear sun or broken cloud, wind moving through the grass; golden late light.
- **(e) Refs**:
  - TG Eastemnet Downs: https://tolkiengateway.net/w/images/2/20/The_Lord_of_the_Rings_-_The_Two_Towers_-_Eastemnet_Downs.jpg
  - TG Westfold: https://tolkiengateway.net/w/images/0/0f/The_Lord_of_the_Rings_-_The_Two_Towers_-_Westfold.jpg
  - Alan Lee "Plains of Rohan": https://tolkiengateway.net/w/images/f/fa/Alan_Lee_-_The_Plains_of_Rohan.jpeg

## 13. EREBOR (Lonely Mountain, front gate)
- **(a) Silhouette**: one massive mountain standing alone on a flat plain (the Desolation), with several ridged spurs. Dale sits in the valley in front of the gate; Ravenhill has a ruined dwarf watch-post on a southern spur.
- **(b) Close-up**:
  - A monumental gate cut into the rock, flanked by two colossal dwarf-warrior statues holding axes (Bilbo's party climbs a statue's axe in Desolation of Smaug).
  - The River Running comes out beside the gate as a moat; geometric dwarven ramparts, stairs and turrets.
- **(c) Palette**:
  - [measured, Desolation of Smaug still] `#707773` `#899995` `#51514c` `#665d52`; T/M/B `#7d9392` `#616158` `#5b554c` (cold grey-green stone).
  - Unexpected Journey prologue gate (fandom): `#8c713f` gold accents on `#1b2317` dark stone.
- **(d) Lighting**: Unexpected Journey prologue has warm, prosperous, golden light. Desolation and Battle of the Five Armies are bleak, grey-teal and hazy.
- **(e) Refs**:
  - TG Desolation of Smaug: https://tolkiengateway.net/w/images/8/8e/The_Hobbit_-_The_Desolation_of_Smaug_-_Erebor.jpg
  - Fandom front gate (Referer): https://static.wikia.nocookie.net/lotr/images/4/4b/Erebor_front_gate.webp
  - Alan Lee "The Front Gate": https://tolkiengateway.net/w/images/6/68/Alan_Lee_-_The_Front_Gate.jpg
  - Weta Front Gate mini: https://www.wetanz.com/media/catalog/product/8/7/87-10-01284_hobbit_front_gate_erebor_002.jpg

## 14. DALE
- **(a) Silhouette**: a compact city of pale stone on a spur in the valley before Erebor's gate, with bell towers, spires and bridges over the river.
- **(b) Close-up**: arcaded streets, market squares and bright banners in the Unexpected Journey prologue; in Desolation of Smaug, snow-covered ruins and broken roofs.
- **(c) Palette** [measured, Desolation of Smaug still]: `#245765` `#043954` `#659091` `#bbe5d2`; T/M/B `#447c88` `#3c6064` `#1c3337` (frozen teal). [est] Prologue stone `#cbbd9e`; banners `#a33b2a` / `#2f5a8a`.
- **(d) Lighting**: prologue is warm and busy; later, cold, icy and desaturated.
- **(e) Refs**:
  - TG Desolation of Smaug: https://tolkiengateway.net/w/images/6/69/The_Hobbit_-_The_Desolation_of_Smaug_-_Dale.jpg
  - TG Unexpected Journey: https://tolkiengateway.net/w/images/6/62/The_Hobbit_-_An_Unexpected_Journey_-_Dale.jpg
  - John Howe "Dale": https://tolkiengateway.net/w/images/a/ac/John_Howe_-_Dale.jpg

## 15. LAKE-TOWN / ESGAROTH
- **(a) Silhouette**: a dense cluster of timber houses on stilts in the Long Lake, laced with canals, joined to the shore by a long bridge, with the Lonely Mountain on the horizon.
- **(b) Close-up**: weathered grey timber, steep shingled roofs, walkways, nets, barrels and boats, the Master's house, bell tower, windlass (the black-arrow launcher).
- **(c) Palette** [measured, fandom and TG stills agree]: `#7d7b76` `#595a58` `#3f494e` `#283235` `#121b1d`; T/M/B `#898b83` `#3e4444` `#1b2429` (misty grey-green). [est] Lantern `#f0a54a`.
- **(d) Lighting**: cold, overcast, mist on the water; night scenes have snow and warm lanterns; the Smaug attack is orange firelight on black water.
- **(e) Refs**:
  - Fandom (Referer), 1920×800: https://static.wikia.nocookie.net/lotr/images/a/ac/LakeTown.jpg
  - TG concept art: https://tolkiengateway.net/w/images/1/12/The_Hobbit_-_The_Desolation_of_Smaug_-_Lake-town_concept_art.jpg
  - Alan Lee: https://tolkiengateway.net/w/images/b/b5/Alan_Lee_-_Lake-town.jpg

## 16. MIRKWOOD
- **(a) Silhouette**: a huge dark forest mass, flat-topped, with no clearings from above; the Elvenking's gate is on a river.
- **(b) Close-up**: pale, sick trunks, cobwebs and hanging vines, a disorienting path; the canopy is rust-orange with blue butterflies.
- **(c) Palette**:
  - [measured, "Bilbo and the butterflies" canopy still] `#713318` `#39170c` `#bdb8a3` `#967a68`.
  - [measured, forest floor] `#302519` `#2d2317` `#201a12`; fandom "Mirk" still is almost black (`#171615`).
- **(d) Lighting**: murky, sickly brown and ochre, thin shafts of light; poisonous air.
- **(e) Refs**:
  - TG butterflies: https://tolkiengateway.net/w/images/f/ff/The_Hobbit_-_The_Desolation_of_Smaug_-_Bilbo_and_the_butterflies_in_the_canopy_of_Mirkwood.jpg
  - TG Legolas in Mirkwood: https://tolkiengateway.net/w/images/8/86/The_Hobbit_-_The_Desolation_of_Smaug_-_Legolas_in_Mirkwood.jpg
  - Alan Lee: https://tolkiengateway.net/w/images/0/0b/Alan_Lee_-_Thorin_and_Company_in_Mirkwood.jpg

## 17. GREY HAVENS (Mithlond)
- **(a) Silhouette**: a sheltered harbour inlet with pale stone quays and tall arches at the water's edge; a white swan-prowed elven ship sailing into a luminous west.
- **(b) Close-up**: smooth grey-white stone, slender arches, stairs down to the water.
- **(c) Palette** [measured, Return of the King still]: `#ccb07c` `#967d5b` `#564a35` `#131512`; T/M/B `#75664a` `#463e2e` `#3f392b`. Fandom wide shot: `#caab75` gold haze.
- **(d) Lighting**: low sun, golden backlit sea haze, ethereal and elegiac. It fits as the video's final shot.
- **(e) Refs**:
  - TG Return of the King: https://tolkiengateway.net/w/images/2/2f/The_Lord_of_the_Rings_-_The_Return_of_the_King_-_The_Grey_Havens.jpg
  - Alan Lee film concept art, 3654×2005: https://tolkiengateway.net/w/images/2/2c/Alan_Lee_-_Grey_Havens_concept_art.jpg
  - Fandom wide (Referer): https://static.wikia.nocookie.net/lotr/images/8/81/Mithlondwide.jpg
  - Weta mini: https://www.wetanz.com/media/catalog/product/_/l/_lotr_greyhavens_001.png

---

## CAVEATS
- Most Alan Lee and John Howe images on TG are book or calendar illustrations, not confirmed film concept art. The exception is "Alan Lee - Grey Havens concept art". Both artists were the films' lead concept designers, so the style still matches.
- Colour grades vary by home-video release (the 2020 4K remaster changed the green tint). TG and fandom stills come from mixed releases.
- I did not look at the images directly. What each one shows comes from its filename and page caption; the fandom captions I quoted were checked through the page API.
- Not verified: the film height of Orthanc; whether Erebor, Dale or Lake-town had bigatures; exact door and flag colours.

## PRIORITY REFERENCE DOWNLOADS (url | what it shows | suggested local filename)
Fandom URLs need the header `Referer: https://lotr.fandom.com/`.

1. https://tolkiengateway.net/w/images/b/b6/The_Lord_of_the_Rings_-_The_Fellowship_of_the_Ring_-_Hobbiton.jpg | Hobbiton wide, Fellowship | ref/west/hobbiton_fotr_wide.jpg
2. https://commons.wikimedia.org/wiki/Special:FilePath/Hobbiton_mill_and_double-arched_bridge.jpg | real set: mill, bridge, pond (CC) | ref/west/hobbiton_mill_bridge_commons.jpg
3. https://tolkiengateway.net/w/images/5/5a/The_Hobbit_-_An_Unexpected_Journey_-_Gandalf_in_Hobbiton.jpg | Hobbiton lane, Unexpected Journey | ref/west/hobbiton_auj.jpg
4. https://www.wetanz.com/media/catalog/product/8/6/86-10-00783_lotr_bagend_open_001.png | Weta Bag End mini (miniature look) | ref/west/bagend_weta_mini.png
5. https://tolkiengateway.net/w/images/b/b0/The_Lord_of_the_Rings_-_The_Motion_Picture_Trilogy_-_Bree.jpg | Bree gate, night and rain | ref/west/bree_gate_night.jpg
6. https://tolkiengateway.net/w/images/1/12/The_Lord_of_the_Rings_-_The_Fellowship_of_the_Ring_-_At_the_Sign_of_the_Prancing_Pony.jpg | Prancing Pony | ref/west/bree_prancing_pony.jpg
7. https://tolkiengateway.net/w/images/0/00/The_Lord_of_the_Rings_-_The_Fellowship_of_the_Ring_-_Weathertop.png | Weathertop ruin ring | ref/west/weathertop_fotr.png
8. https://tolkiengateway.net/w/images/8/89/Alan_Lee_-_Weathertop.jpg | Weathertop silhouette, Lee | ref/west/weathertop_alanlee.jpg
9. https://tolkiengateway.net/w/images/7/7b/The_Lord_of_the_Rings_-_The_Fellowship_of_the_Ring_-_Rivendell.jpg | Rivendell valley and falls | ref/west/rivendell_fotr.jpg
10. https://tolkiengateway.net/w/images/4/41/Alan_Lee_-_Rivendell.png | Rivendell, Lee | ref/west/rivendell_alanlee.png
11. https://www.wetanz.com/media/catalog/product/_/l/_lotr_rivendell2026_001_1.png | Weta Rivendell mini | ref/west/rivendell_weta_mini.png
12. https://tolkiengateway.net/w/images/f/fe/The_Lord_of_the_Rings_-_The_Fellowship_of_the_Ring_-_The_Fellowship_on_Caradhras.png | Caradhras blizzard | ref/west/caradhras_fotr.png
13. https://tolkiengateway.net/w/images/d/de/Alan_Lee_-_The_Pass_of_Caradhras.jpg | Caradhras peak, Lee | ref/west/caradhras_alanlee.jpg
14. https://static.wikia.nocookie.net/lotr/images/2/2e/Durin%27s_door.png | Moria West-gate at night | ref/west/moria_westgate_film.png
15. https://tolkiengateway.net/w/images/e/ed/Alan_Lee_-_The_West-gate_of_Moria.jpg | West-gate cliff and lake, Lee | ref/west/moria_westgate_alanlee.jpg
16. https://tolkiengateway.net/w/images/f/f1/The_Lord_of_the_Rings_-_The_Fellowship_of_the_Ring_-_Doors_of_Durin_Illustration.png | ithildin door design | ref/west/moria_doors_design.png
17. https://static.wikia.nocookie.net/lotr/images/5/52/Az.JPG | Dimrill Dale, east side | ref/west/dimrill_dale_fotr.jpg
18. https://tolkiengateway.net/w/images/3/38/The_Lord_of_the_Rings_-_The_Motion_Picture_Trilogy_-_Caras_Galadhon.jpg | Caras Galadhon | ref/west/lorien_caras_galadhon.jpg
19. https://tolkiengateway.net/w/images/7/73/The_Lord_of_the_Rings_-_The_Fellowship_of_the_Ring_-_Farewell_to_L%C3%B3rien.png | Lórien, river and mallorns | ref/west/lorien_farewell.png
20. https://tolkiengateway.net/w/images/3/33/The_Lord_of_the_Rings_-_The_Two_Towers_-_Fangorn_Forest_and_the_Misty_Mountains.png | Fangorn with mountains behind | ref/west/fangorn_misty_wide.png
21. https://static.wikia.nocookie.net/lotr/images/3/36/TTTFangornForest.jpg | Fangorn interior | ref/west/fangorn_interior.jpg
22. https://tolkiengateway.net/w/images/c/cc/The_Lord_of_the_Rings_%28film_series%29_-_Isengard.jpg | Isengard ring and Orthanc | ref/west/isengard_film.jpg
23. https://static.wikia.nocookie.net/lotr/images/0/03/Isengard_before.jpeg | Isengard before (gardens) | ref/west/isengard_before.jpg
24. https://tolkiengateway.net/w/images/c/c7/Orthanc_film.jpg | Orthanc tower | ref/west/orthanc_film.jpg
25. https://www.wetanz.com/media/catalog/product/_/l/_lotr_miniorthanc_002.jpg | Weta Orthanc mini | ref/west/orthanc_weta_mini.jpg
26. https://tolkiengateway.net/w/images/7/7f/The_Lord_of_the_Rings_-_The_Two_Towers_-_Meduseld.jpg | Edoras and Meduseld | ref/west/edoras_meduseld.jpg
27. https://static.wikia.nocookie.net/lotr/images/2/2e/Edoras.jpg | Edoras hill wide | ref/west/edoras_wide.jpg
28. https://commons.wikimedia.org/wiki/Special:FilePath/Mount_Sunday_MRD_01.jpg | real Mount Sunday terrain (CC) | ref/west/edoras_mount_sunday_commons.jpg
29. https://static.wikia.nocookie.net/lotr/images/d/d3/Helm%27s_Deep_-_TtT.png | Helm's Deep wide | ref/west/helmsdeep_wide.png
30. https://tolkiengateway.net/w/images/e/e3/The_Lord_of_the_Rings_-_The_Two_Towers_-_Fangorn_Comes_to_Helm%27s_Deep.png | Helm's Deep dawn | ref/west/helmsdeep_dawn.png
31. https://www.wetanz.com/media/catalog/product/_/l/_lotr_helmsdeep_001_1.png | Weta Helm's Deep (built from the bigature references) | ref/west/helmsdeep_weta_mini.png
32. https://tolkiengateway.net/w/images/2/20/The_Lord_of_the_Rings_-_The_Two_Towers_-_Eastemnet_Downs.jpg | Rohan plains | ref/west/rohan_plains.jpg
33. https://tolkiengateway.net/w/images/8/8e/The_Hobbit_-_The_Desolation_of_Smaug_-_Erebor.jpg | Lonely Mountain | ref/north/erebor_dos.jpg
34. https://static.wikia.nocookie.net/lotr/images/4/4b/Erebor_front_gate.webp | Erebor gate and statues | ref/north/erebor_front_gate.webp
35. https://www.wetanz.com/media/catalog/product/8/7/87-10-01284_hobbit_front_gate_erebor_002.jpg | Weta Front Gate mini | ref/north/erebor_gate_weta_mini.jpg
36. https://tolkiengateway.net/w/images/6/69/The_Hobbit_-_The_Desolation_of_Smaug_-_Dale.jpg | Dale ruins | ref/north/dale_dos.jpg
37. https://static.wikia.nocookie.net/lotr/images/a/ac/LakeTown.jpg | Lake-town wide | ref/north/laketown_wide.jpg
38. https://tolkiengateway.net/w/images/1/12/The_Hobbit_-_The_Desolation_of_Smaug_-_Lake-town_concept_art.jpg | Lake-town concept | ref/north/laketown_concept.jpg
39. https://tolkiengateway.net/w/images/f/ff/The_Hobbit_-_The_Desolation_of_Smaug_-_Bilbo_and_the_butterflies_in_the_canopy_of_Mirkwood.jpg | Mirkwood canopy | ref/north/mirkwood_canopy.jpg
40. https://tolkiengateway.net/w/images/2/2c/Alan_Lee_-_Grey_Havens_concept_art.jpg | Grey Havens film concept | ref/west/greyhavens_alanlee_concept.jpg
41. https://tolkiengateway.net/w/images/2/2f/The_Lord_of_the_Rings_-_The_Return_of_the_King_-_The_Grey_Havens.jpg | Grey Havens, Return of the King | ref/west/greyhavens_rotk.jpg
42. https://tolkiengateway.net/w/images/4/42/The_Lord_of_the_Rings_%28film_series%29_-_Minas_Tirith_minature.jpg | a real bigature photo (miniature look; small, 360×472) | ref/bigatures/minastirith_bigature.jpg
43. https://tolkiengateway.net/w/images/8/8d/The_Lord_of_the_Rings_%28film_series%29_-_Cirith_Ungol_minature.jpg | a real bigature photo | ref/bigatures/cirithungol_bigature.jpg

**Main sources**:
- https://tolkiengateway.net/wiki/Bigatures
- https://theasc.com/article/lord-of-the-rings-fellowship-of-the-rings-vfx/
- https://lynbaileyreflectivejournal.wordpress.com/2012/11/15/weta-workshop-on-the-lord-of-the-rings/
- https://lynbaileyreflectivejournal.wordpress.com/2012/11/20/weta-workshop-on-the-lord-of-the-rings-take-2/
- https://en.wikipedia.org/wiki/Production_of_The_Lord_of_the_Rings_film_series
- https://en.wikipedia.org/wiki/Hobbiton_Movie_Set
- https://www.hobbitontours.com/discover/our-story/
- https://movie-locations.com/movies/l/Lord-Of-The-Rings-Fellowship-Of-The-Ring.php
- https://mckellen.com/cinema/lotr/001128.htm
- https://newzealandfilmmap.com/locations/mount-sunday-edoras/
- https://www.theonering.net/torwp/2013/10/24/81159-set-visit-exclusive-bringing-lake-town-to-life-for-the-hobbit-the-desolation-of-smaug/
- https://www.wetanz.com/us/helms-deep
- https://www.wetanz.com/us/rivendell-environment
- https://www.wetanz.com/us/front-gate-to-erebor
- https://www.wetanz.com/us/orthanc
- https://www.cbr.com/lotr-miniatures-movie-filming-held-up-through-time/