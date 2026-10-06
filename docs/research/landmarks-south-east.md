> **S6 (V1 release):** direct links to image files (film stills, concept art, set photos) were removed
> from this public brief; the article and page sources remain. The images themselves were only ever
> local look references (`reference/`, never committed).

# South & East landmarks: Peter Jackson film visual reference (Map of Middle-Earth)

**Scope and checks.** Every image URL below was fetched with HTTP GET on 2026-09-28/29 and returned 200 with an image content type. I looked directly at 15 of the stills. Hex values marked **[S]** were sampled with Pillow from the still named in brackets. Hex values marked **[E]** are my own estimates. Anything marked **[mem]** comes from memory of the films and I could not confirm it against a source.

**Image sources:** URLs (Tolkien Gateway, Fandom, Wikimedia Commons) are listed for identification only; the images are copyrighted (except the Commons items, which carry their own CC licences) and are not redistributed.
- **Licensing:** the film stills and Lee/Howe/Nasmith art are copyrighted. Use them for look-dev reference only and never put them in the final video. The Commons photos are CC-licensed.

## Global findings that change the plan

1. **The Mordor sky is not uniformly red in the films.** In daytime and during Eye shots it is cold charcoal/blue-grey cloud: sky #24242d, #1c1d24, #0e1015; horizon haze #727785; ash ground #282b30 **[S: TG Barad-dûr still]**. It turns warm umber (#261f18, #43362c, #524941, #7c6f63) **[S: Fandom "Mordor's DuoSpire" RotK]** and red-orange (#823817, #ad4e1f) **[S: Fandom Rotk-1-1707]** only near Orodruin, at night, and at the climax.
   - Suggested approach: a charcoal base sky, plus a red-orange emissive underglow that grows with proximity to Doom and at night.
2. **Jackson compressed Mordor's geography.** Barad-dûr is visible from the Black Gate and sits close to Doom (TG, Fandom). The Morgul signal is visible from Minas Tirith. This supports exaggerating landmark scale and sightlines in the diorama.
3. **Event order in the film:** the Morgul Great Signal comes first; the next morning Pippin lights the first beacon above the City. In the book this is reversed (TG, Great Signal). Useful when choosing the video's narrative order.
4. **Bigature scales:**
   - Minas Tirith: 1:72, with some sections at 1:14; about 7 m tall; nearly 1,000 houses (TG Bigatures).
   - Argonath: 1:60, about 8 ft (blog summarising the Extended Edition appendices).
   - Barad-dûr: 26–27 ft at **1:166**, built by David Tremont, which implies roughly 1.3–1.5 km real height.
     - Fandom says "1:66", which is inconsistent with its own ~5,000 ft figure, so it is probably a typo.
     - TG says "9 ft", which conflicts with the other sources. Treat it as **[conflict]**.
   - Cirith Ungol: John Howe re-drew it from Tolkien's drawings, and it was built on a rocky pinnacle (TG).

---

### 1. Anduin & Nen Hithoel
- **(a) Silhouette:** a broad, wide-looping river through steep forested gorges and cliffs. Nen Hithoel is a long lake hemmed in by forested hills with mountains behind.
- **(b) Close-up:** Elven grey boats; rapids and boulders; beech/conifer banks; mist on the water.
- **(c) Palette:**
  - Lake #5f6f71; hills #474c53; sky #96a6c4 **[S: TG Amon Hen still]**.
  - Gorge water #4c5a58 **[S: TG Argonath]**.
  - Rauros area: #102224, #4a5f61, #63787d, spray #c4c0be **[S: Fandom Rauros.jpg]**.
- **(d) Mood:** cool, clear, desaturated teal. Bright overcast or sunny alpine light. This is the calm before Amon Hen.
- **(e) FX:** flowing water with specular sparkle; drifting low mist on the lake; soft cloud shadows moving over the hills.
- **Filming:** the Waiau River between Te Anau and Manapouri was the Anduin; Mavora Lakes was Nen Hithoel (per newzealandfilmmap and travel sources).
- **(f) References:**
  - Fandom Aax.jpg (FotR, Nen Hithoel page): [image link removed]
  - Fandom Amon_Hen_from_Nen_Hithoel_-_FotR.jpg: [image link removed]

### 2. Argonath (Pillars of the Kings)
- **(a) Silhouette:** two colossal robed kings set into the gorge walls on either bank, facing upstream. Each raises its **left hand, palm outward** in warning. The pair forms a narrow gate with a bright mist-filled gap between them (the view toward Nen Hithoel).
- **(b) Close-up:**
  - The left figure wears a full helm with a face guard. The right figure is bearded and wears a crowned helm, with its right hand gripping a sword hilt at the chest, blade down (the book gives them axes).
  - Long vertical robe folds; cracks, lichen and water streaks; bases fuse into the natural rock.
  - The bigature heads were carved in foam and then "aged" by knocking pieces off.
  - Identity: the book says Isildur and Anárion. Weta's product copy says "Elendil and his son Isildur". The film does not name them **[conflict]**.
- **(c) Palette** **[S: TG FotR still]**: lit stone #52554f; shade #35413f; cliffs #5b5649; sky #848985 with a warm peach band #979284; water #4c5a58; spray #848374.
- **(d) Mood:** low-angle, awe-inspiring, backlit with pale gold light, and the statues read partly in silhouette.
- **(e) FX:** river flow; mist rising from the downstream gap; a slow push-in camera move (the video should copy the "reveal" dolly).
- **(f) References:**
  - [V] [image link removed] (1920 px film still)
  - [V] [image link removed] (1620×796)
  - [V] [image link removed]
  - [V] Commons real gorge (Kawarau Gorge, the plate location): [image link removed]

### 3. Falls of Rauros & Amon Hen (Seat of Seeing)
- **(a) Silhouette:**
  - Rauros is a wide white cataract and spray plume at the south end of Nen Hithoel.
  - Amon Hen is a conifer-forested hill beside the lake. The Seat stands on the summit as a flat stone table on columns, topped by a dark crown-like finial.
- **(b) Close-up:**
  - The Seat has a frieze of carved roundels and moss-grown ruined steps. A stone animal/bird statue lies to one side.
  - The finial is a cluster of tall blade/flame spires with a bird figure **[looked at directly]**.
  - Surrounding forest ruins include moss-covered stone heads and fallen masonry **[mem]**.
- **(c) Palette** **[S: TG Amon Hen still]**: stone #48463f; finial #232932; dry grass #706550; dark foliage #151713; lake #5f6f71; blue sky #96a6c4. Rauros spray #c4c0be **[S]**.
- **(d) Mood:** the brightest, most summery natural light on this list: blue sky and alpine sun. It turns tragic at Boromir's death.
- **(e) FX:**
  - Waterfall: scrolling foam, a spray particle cloud, and a rainbow haze **[E]**.
  - Boromir's funeral boat drifting over the falls.
  - Frodo's vision from the Seat (a rapid tilt up Barad-dûr).
- **(f) References:**
  - [V] [image link removed]
  - [V] Fandom Rauros (FotR still): [image link removed]
  - [V] [image link removed]
  - [V] [image link removed] (Tolkien's own drawing, good for topology)

### 4. Emyn Muil
- **(a) Silhouette:** a maze of jagged, broken grey volcanic ridges, knife-edge crags and sudden cliffs, with no vegetation to speak of.
- **(b) Close-up:** slabby, fractured andesite; rope-descent cliff faces; wet rock; small pools.
- **(c) Palette** **[S: Fandom Emyn_Muil.webp, 3840×1600; film aspect, but not categorised by film]**: #2c393a, #192422, #131c1a, #0b1210; pale sky #e2d1b8; mid rock #6c7473.
- **(d) Mood:** cold, blue-grey and disorienting. There is a night thunderstorm with rain during the rope scene **[mem]**.
- **(e) FX:** fog rolling through the gaps; lightning flashes; rain streaks.
- **Filming:** Meads Wall, Whakapapa ski area on Ruapehu.
- **(f) References:**
  - [V] [image link removed]
  - [V] [image link removed]

### 5. Dead Marshes
- **(a) Silhouette:** a flat, endless bog of stagnant pools and tussock under a low sky. The horizon line is broken only by Mordor's mountains in the distance.
- **(b) Close-up:** pale drowned faces of the dead (Elves, Men, Orcs) under the water; the faint "candles" / ghost lights; rotting reeds.
- **(c) Palette:**
  - #535752, #3f4139, #292c26, #5f625c **[S: Fandom Dead-marshes.jpg, TTT]**.
  - Water #2a3027, #161b15, #353d32 **[S: Fandom Dead-Marshes-Water.jpg]**.
  - Ghost-light accent: pale green-white #cfe3c8 **[E]**.
- **(d) Mood:** desaturated olive-grey, dead flat lighting, oppressive. A Nazgûl on a fell beast crosses overhead.
- **(e) FX:** ground mist hugging the pools; flickering will-o'-wisp point sprites; slow ripples.
- **Filming:** aerial shots at Kepler Mire; close-ups on a Weta wet-set in Lower Hutt.
- **(f) References:**
  - [V] [image link removed]
  - [V] [image link removed]
  - [V] [image link removed]
  - [V] Commons: [image link removed]

### 6. Black Gate (Morannon) & Towers of the Teeth
- **(a) Silhouette:**
  - A single long, dark iron wall spans the pass between two steep rocky ridges.
  - The wall is made of tall vertical plates with spiked tops, and has a giant double gate at its centre.
  - Two very tall, slender watch towers with spiky crown tops stand high on the flanking slopes (Narchost and Carchost).
  - In front lies a flat, pale ash plain.
- **(b) Close-up:** riveted iron plating; troll-operated gate leaves (TTT); spikes; wall-walk battlements; smaller towers along the wall.
- **(c) Palette** **[S: TG RotK still]**: iron #292b25; towers #353730; rock #23251f to #5d5d55; ash plain #636155; sky #5f615c; faint warm glow beyond the gate #36332d.
- **(d) Mood:** overcast grey-olive and very desaturated, with a dim orange-brown smudge over Mordor behind the gate.
- **(e) FX:**
  - The gate opens (a heavy, slow swing).
  - The whole wall and both Towers of the Teeth collapse into the ground when the Ring is destroyed (TG). This is a strong candidate for the video climax.
  - The Eye visible in the distance.
- **Filming:** the plain is the Rangipo Desert.
- **(f) References:**
  - [V] [image link removed]
  - [V] [image link removed] (3840×1600)
  - [V] [image link removed]
  - [V] Commons: [image link removed]

### 7. Ithilien & Henneth Annûn
- **(a) Silhouette:**
  - Ithilien is a lush green wooded slope between the Anduin and the Ephel Dúath, with a rocky riverbed and ferns.
  - Henneth Annûn is a waterfall curtain across a cliff with a cave behind it (the Window on the West) above a pool.
- **(b) Close-up:** Rangers in green; fern, moss and wet dark rock; wet cave walls; torchlight; the moonlit Forbidden Pool where Gollum fishes **[mem]**.
- **(c) Palette:**
  - Ithilien: olive #51553b, #2a3122, #636a4e; warm light #958c6e; highlight #cfc9be **[S: Fandom Ithilien_-_TtT.jpg]**.
  - Henneth Annûn: slate blues #323b4c, #546884; falling water #c5d2e9, #99add2 **[S: TG TTT still]**.
- **(d) Mood:** the last green, living place before Mordor. Dappled warm sun by day; cool blue night at the pool.
- **(e) FX:** waterfall with a sunset glow through the curtain (the "Window" at sunset in the book and in the Lee/Nasmith art); spray; the Oliphaunt battle.
- **Filming:** Twelve Mile Delta near Queenstown for the Ithilien camp. Mangawhero Falls is a reference Commons photo; I could not confirm it as a filming location.
- **(f) References:**
  - [V] [image link removed] (low-res)
  - [V] [image link removed]
  - [V] Alan Lee's Henneth Annûn: [image link removed]
  - [V] [image link removed]
  - [V] [image link removed]

### 8. Osgiliath
- **(a) Silhouette:** a ruined city straddling the Anduin, with broken towers, roofless halls and a partly collapsed multi-arched bridge. The broken skyline is full of gaps.
- **(b) Close-up:** Romanesque/Gothic round arches, arcades, colonnades, broken domes; rubble slopes; banners of Gondor; stone quays **[looked at directly: TG still]**.
- **(c) Palette:** lit stone #646e6c; shadows #0b1619, #1b2629; haze and sky #d0d6de, highlights #d9dee7 **[S: TG still]**; #4e6263, #77877f **[S: Fandom Osgiliath_reclaimed, TTT]**.
- **(d) Mood:** a heavy white-grey atmospheric haze, so depth falls off quickly. Cold and battle-worn.
- **(e) FX:** drifting smoke and haze; Nazgûl on fell beasts overhead; at night, Orc boats crossing with torches and fire glints on the water **[mem]**.
- **(f) References:**
  - [V] [image link removed]
  - [V] [image link removed]
  - [V] [image link removed]

### 9. Minas Tirith (+ Citadel, White Tree, Pelennor, Rammas Echor)
- **(a) Silhouette:**
  - Seven concentric tiered walls climb a spur of Mindolluin, backed by a sheer grey cliff and mountains.
  - A huge **keel/prow of rock** ("like the prow of a ship", Weta) splits the tiers and projects eastward. Its tip at the top is the Citadel terrace.
  - The **Tower of Ecthelion** is a tall, slim white tower with a pointed spire and is the top accent.
  - There is a curtain wall with round towers at the base; the Great Gate faces east.
- **(b) Close-up:**
  - Around 1,000 houses with balconies, arches and turrets.
  - Seventh level: the Court of the Fountain with the dead White Tree on a lawn and a fountain.
  - The White Tree shows a single blossom during the siege and is in full bloom at the coronation (Fandom/secondary).
  - The beacon Pippin lights is on a crag above the City.
- **(c) Palette:**
  - Overcast exterior: lit stone #a49b8b, highlights #d2c6b7; city mid-tones #585953; mountain #414343; sky #a6a3a2 **[S: TG still]**.
  - Seventh level in sun: warm ivory #c5b59b, #a89879, #767059, #655f4b **[S: Fandom Seventh_level]**.
  - White Tree scene: #6e7a6d, #979c9a, bark #d1cbc5 **[S]**.
  - Suggestion: use warm off-white limestone, never pure white.
- **(d) Mood:**
  - Shafts of light breaking through cloud onto the white stone; mountain cloud wrapping the peaks.
  - During the siege, Sauron's brown darkness covers the sky; fires burn across the lower tiers.
- **(e) FX:** fires and smoke columns from the lower tiers; trebuchet arcs; banners in the wind; the dawn light breaking through when Gandalf and the Rohirrim arrive **[mem]**.
- **Pelennor:** in the film it is **empty grassland** and the Rammas Echor wall is **not shown** (Fandom; secondary sources). Filmed at Ben Ohau Station, Twizel, with golden tussock.
  - For the map: optionally draw the Rammas Echor as a faint low ring wall, for geographic accuracy.
- **(f) References:**
  - [V] [image link removed]
  - [V] [image link removed] (1920×1170)
  - [V] [image link removed]
  - [V] [image link removed]
  - [V] John Howe's Tower of Ecthelion: [image link removed]
  - [V] [image link removed]

### 10. Mindolluin, White Mountains & the beacons
- **(a) Silhouette:** jagged snow-capped alpine peaks running west from Minas Tirith. Each beacon sits on a summit crag.
- **(b) Close-up:** beacons are stacked timber piles on stone platforms, with small warden huts. Snow, ice and cloud sit below the peaks **[mem for the huts]**.
- **(c) Palette:**
  - Beacon stills: rock #343734, #4d5656; shadow #0f1110; fire #d19d56, #aa7854 **[S: Fandom Beacons_of_War / Beacon-hills (2.39:1 stills, likely RotK)]**.
  - TTT mountains: #7095a2, #425f6a, snow haze #a4aeb4 **[S]**.
- **(d) Mood:** golden-hour and dusk helicopter sweeps with low sun. The fire reads warm against the cold blue snow.
- **(e) FX:** a chain ignition that hops peak to peak (the camera chases it); fire and ember particles; smoke trails bent by wind.
- **Filming:** Mount Gunn near Franz Josef. Only one real beacon was filmed; the rest are CG (NZ Film Map).
- **(f) References:**
  - [V] [image link removed]
  - [V] [image link removed]
  - [V] [image link removed]
  - [V] [image link removed]

### 11. Minas Morgul
- **(a) Silhouette:**
  - A walled city across a moat and bridge in a dark vale, with steeply sloped, fin-like buttress walls and pointed spires.
  - One tall central tower dominates, with a jagged top.
  - The city is lit from within by a sickly green glow.
- **(b) Close-up:**
  - The gate is a monstrous fanged face or mouth **[looked at directly]**.
  - The bridge is lined with gargoyle statues of snarling demons with tongues sticking out (NFB 2026 review).
  - Gates open inward in FotR and outward in RotK (Fandom).
  - Book detail: the tower's top course "revolved slowly". I could not confirm this happens in the film **[U]**.
- **(c) Palette** **[S: TG RotK still]**: walls #508264, brightest #7bad85; tower #2b4f4c; sky #0f1d21; shadows #0c1919, #132626. Beam core, estimated: #d8ffe6 with an outer glow of #6fdc9a **[E]**.
- **(d) Mood:** a "corpse light". Everything is lit from below and inside by green, and the surroundings are near-black teal.
- **(e) FX:**
  - **Great Signal:** the glow "coalesces around the central tower and erupts upwards into a ghoulish pillar", described as a swirling twister of luminous vapour into the clouds. It is visible from Minas Tirith and comes with a volcano-like roar (TG, Fandom, NFB).
  - Then the Witch-king leaves on his fell beast and the army marches out with torches.
  - Suggested approach: a twisting additive cylinder with scrolling noise, plus pulsing green emissive walls and green volumetric fog.
- **(f) References:**
  - [V] [image link removed] (film)
  - [V] [image link removed] (same film frame, 1317×786)
  - [V] [image link removed]
  - Do **not** use Fandom Minas_Mogul_Tower.jpg or Side_view: they are from *Shadow of War*, not the films.

### 12. Cirith Ungol (stairs & tower)
- **(a) Silhouette:**
  - The Stairs are a thread of steps cut up a sheer cliff above Morgul Vale.
  - The Tower is a tall, narrow, many-faceted dark tower with vertical fins and a jagged, cracked crown. It stands on a rock pinnacle at the pass, with a lower bastion.
- **(b) Close-up:** the steep, worn steps; Shelob's tunnel mouth; spiked parapets; Orc banners **[mem]**.
- **(c) Palette:**
  - Tower #161916; dark sky #242622; Mordor glow on the horizon #382617, peaking at #503824 **[S: TG RotK still]**.
  - Stairs: near-black teal #030709 to #223d3f, lit by green spill from Morgul **[S: Fandom Stairs_of_Cirith_Ungol_-_RotK]**.
- **(d) Mood:** a silhouette against the smouldering amber-brown glow of Mordor; the stairs are cold and lit green from below.
- **(e) FX:** drifting mist in the pass; the orange glow behind it breathing slowly.
- **(f) References:**
  - [V] [image link removed]
  - [V] [image link removed]
  - [V] [image link removed]

### 13. Plateau of Gorgoroth (Mordor)
- **(a) Silhouette:** a vast, cracked volcanic plain ringed by jagged ranges (Ephel Dúath and Ered Lithui). Orodruin rises in the middle and Barad-dûr to the north-east.
- **(b) Close-up:** fissures of glowing lava; steam and smoke vents; Orc encampments with many campfires; roads; pits and slag **[mem]**.
- **(c) Palette** **[S: TG Barad-dûr still]**: ground #282b30; rock #1c1d24, #3a3439; fumes #746f74; lava cracks #bb481b **[S: FotR Doom still]**. Warm-mode palette as in Global finding 1.
- **(d) Mood:** a permanent low cloud ceiling; no sun; the only light is a glow from below plus the Eye.
- **(e) FX:** ember sparks; heat shimmer; steam vents; slowly pulsing lava cracks (emissive noise); the sweep of the Eye's beam.
- **(f) References:**
  - [V] [image link removed]
  - [V] [image link removed] (RotK: tower and Doom together)
  - [V] Commons Rangipo Desert: [image link removed]

### 14. Barad-dûr & the Eye of Sauron
- **(a) Silhouette:**
  - An impossibly tall, black, jagged spire rising from a massive buttressed base on a mountain spur. The shaft is bundled vertical fins with spikes along it.
  - At the top, two huge curved **horn prongs** form a crescent or "U" cradle that holds the Eye.
  - Design based on John Howe's 1991 calendar painting. Howe: "beyond architecture… an extension of his soul".
- **(b) Close-up:** layered dark iron-and-stone plates; buttress spikes; the inner faces of the horns lit orange by the Eye **[looked at directly]**.
- **(c) Palette** **[S: TG RotK still]**:
  - Tower #09090e; horns #a64d1d.
  - Eye: core #fcad4d, body #ed7d2f / #dc6424, outer flame #ab5627, pupil or darkest core #6d1d06.
  - A close-up Eye image runs redder: #ba1308, #7c0a08, #e16d0c, #e79d17 **[S: Fandom Eye.jpg, source unconfirmed]**.
- **(d) Mood:** the Eye is the brightest thing in Mordor, set against a charcoal sky; it lights the horns and cloud undersides from below.
- **(e) FX (the Eye's look and motion, as sourced):**
  - A giant eyeball made of flame with a black vertical cat-like slit pupil, wreathed in flickering fire and "rimmed with fire" (Fandom, TG).
  - In RotK it sweeps Mordor with a **red searchlight beam**, "constantly sweeping the lands" (TG).
  - It turns toward the Black Gate.
  - In the extended edition the camera zooms into the pupil to reveal an armoured Sauron.
  - When the Ring is destroyed the Eye "violently implodes, triggering a shockwave", and the tower collapses (Fandom). Gray Horsfield animated the collapse.
  - Suggested approach:
    - Build the Eye as a billboard or sphere with an fBm fire shader, a slit pupil that dilates, and slow saccades.
    - Build the beam as an additive cone plus a SpotLight, with a ground hotspot decal.
    - Add bloom.
    - Finish with an implosion then a ring shockwave.
- **(f) References:**
  - [V] [image link removed] (the key reference)
  - [V] [image link removed]
  - [V] [image link removed]
  - [V] [image link removed] (red-sky variant, 400×300)
  - [V] [image link removed]

### 15. Mount Doom / Orodruin & Sammath Naur
- **(a) Silhouette:**
  - A near-symmetrical, steep, dark cone built from the shape and proportions of Mt Ngauruhoe. Long shots are a model, CG, or both.
  - A constant ash plume rises from the crater and merges into the overcast.
  - Slope scenes were filmed on Ruapehu; the summit of Ngauruhoe was not filmed because it is sacred to Māori (TG, Fandom).
- **(b) Close-up:**
  - The Sammath Naur is a dark doorway high on the cone, reached by a winding path **[mem]**.
  - Inside is a cavern with a narrow rock spur over a lava chasm, lit deep red-brown: #392217, #513323, accent #a25c2c **[S: Fandom 558_2_SN_detail, RotK]**.
  - Loose ash and scree slopes; lava flow channels.
- **(c) Palette** **[S: TG FotR still]**:
  - Plume #111110; dark red under-glow on the cone #22120f, with a red streak in the plume #2a1b18; horizon light #88796d; lava #bb481b.
  - Estimated molten gradient: #fff2b0, then #ffb347, then #ff5a1a, then crust #3a0f06 **[E]**.
- **(d) Mood:** nearly black frames. The only colour is lava light and the plume lit red from below. Glow colour runs orange-red, not magenta.
- **(e) FX:**
  - Billowing plume: dark billboard particles lit warmer toward the base.
  - Lava rivulets down the flanks: scrolling emissive noise along splines.
  - Crater glow pulsing; heat haze; ash fall.
  - At the climax: a violent eruption and lava rivers around Frodo and Sam, then the eagles.
  - Lightning inside the plume **[mem/U]**.
- **(f) References:**
  - [V] [image link removed] (small, 14 KB)
  - [V] [image link removed]
  - [V] [image link removed]
  - [V] Commons Ngauruhoe: [image link removed]

### 16. Dol Guldur (Hobbit trilogy)
- **(a) Silhouette:**
  - A ruined Númenórean fortress on a hill in dead southern Mirkwood. It looks like a crown of broken, splintered towers, with thorny dead vines bristling from every top.
  - The plan is an equilateral triangle: three sides, three bays, three staircases.
  - It is reached by a long stone bridge (DoS).
- **(b) Close-up:** rotted stone with rusted iron strapping; metal spikes and chains; great thorny vines; skeletal remains; Nazgûl statues (motionpictures.org; TG).
- **(c) Palette:**
  - Teal-viridian: #0a1919, #152f2c, #305b54, #5d877b, #84aa99; sky #749d8e **[S: TG AUJ still]**.
  - DoS: #39423b, #596158, #aeb5a3 **[S]**.
  - When Sauron appears as fire: #8f5220, #d58d48, #eeb579 **[S]**.
- **(d) Mood:** a cold sickly-green overcast with streaked, wind-torn clouds. A different green from Morgul: murky teal-grey rather than glowing lime.
- **(e) FX:** black shadow-smoke of the Necromancer **[mem]**; the Eye of fire forming; Galadriel's white light against the dark (BotFA); dead branches creaking in wind.
- **(f) References:**
  - [V] [image link removed]
  - [V] [image link removed]
  - [V] [image link removed]
  - [V] [image link removed]

---

## PRIORITY REFERENCE DOWNLOADS
All resolved with HTTP 200 when checked.

| # | URL | Shows | Filename |
|---|---|---|---|
| 1 | [image link removed] | Tower, horns, Eye, Gorgoroth (RotK) | ref_baraddur_eye_rotk.jpg |
| 2 | [image link removed] | Minas Tirith, prow, tiers, cliff | ref_minastirith_rotk.jpg |
| 3 | [image link removed] | Minas Tirith, 1920 px | ref_minastirith_rotk_hi.webp |
| 4 | [image link removed] | Morgul gate, bridge, green glow | ref_minasmorgul_film.jpg |
| 5 | [image link removed] | Argonath, 1920 px | ref_argonath_fotr.png |
| 6 | [image link removed] | Black Gate and both towers | ref_blackgate_rotk.jpg |
| 7 | [image link removed] | Black Gate, 3840×1600 | ref_blackgate_rotk_4k.webp |
| 8 | [image link removed] | Doom, plume, lava (FotR) | ref_mountdoom_fotr.jpg |
| 9 | [image link removed] | Barad-dûr and Doom together (RotK) | ref_mordor_duospire_rotk.webp |
| 10 | [image link removed] | Sammath Naur interior | ref_sammathnaur_rotk.webp |
| 11 | [image link removed] | Cirith Ungol tower, Mordor glow | ref_cirithungol_tower_rotk.png |
| 12 | [image link removed] | Stairs of Cirith Ungol | ref_cirithungol_stairs_rotk.webp |
| 13 | [image link removed] | Osgiliath ruins, haze | ref_osgiliath_film.png |
| 14 | [image link removed] | Seat of Seeing, lake | ref_amonhen_seat_fotr.jpg |
| 15 | [image link removed] | Falls of Rauros (FotR) | ref_rauros_fotr.webp |
| 16 | [image link removed] | Emyn Muil crags, 4K | ref_emynmuil_ttt.webp |
| 17 | [image link removed] | Dead Marshes wide | ref_deadmarshes_ttt.webp |
| 18 | [image link removed] | Marsh water and faces | ref_deadmarshes_water_ttt.webp |
| 19 | [image link removed] | Ithilien woodland | ref_ithilien_ttt.webp |
| 20 | [image link removed] | Henneth Annûn waterfall | ref_hennethannun_ttt.jpg |
| 21 | [image link removed] | Lit beacon on a peak | ref_beacons_rotk.webp |
| 22 | [image link removed] | Beacon chain, mountains | ref_beaconhills_rotk.webp |
| 23 | [image link removed] | Citadel, 7th level | ref_minastirith_citadel_rotk.webp |
| 24 | [image link removed] | White Tree, Court of the Fountain | ref_whitetree_rotk.webp |
| 25 | [image link removed] | Dol Guldur silhouette | ref_dolguldur_auj.png |
| 26 | [image link removed] | Dol Guldur bridge approach | ref_dolguldur_bridge_dos.webp |
| 27 | [image link removed] | Howe's source design for Barad-dûr | art_howe_darktower.jpg |
| 28 | [image link removed] | Howe's Eye | art_howe_eye.jpg |
| 29 | [image link removed] | Lee's Doom slopes (rock and ash) | art_lee_mountdoom.jpg |
| 30 | [image link removed] | Gorgoroth plain | art_nasmith_gorgoroth.jpg |
| 31 | [image link removed] | Dead Marshes art | art_lee_deadmarshes.jpg |
| 32 | [image link removed] | Henneth Annûn art | art_lee_windowwest.jpg |
| 33 | [image link removed] | Cirith Ungol art | art_lee_cirithungol.jpg |
| 34 | [image link removed] | Tolkien's Rauros/Tol Brandir topology | art_tolkien_rauros.jpg |
| 35 | [image link removed] | Real Doom cone (CC) | photo_ngauruhoe.jpg |
| 36 | [image link removed] | Real Mordor / Black Gate plain (CC) | photo_rangipo.jpg |
| 37 | [image link removed] | Real Argonath gorge (CC) | photo_kawarau.jpg |
| 38 | [image link removed] | Real Dead Marshes (CC, 590 px) | photo_keplermire.jpg |

**Unverified or not found:**
- No reliable film still of Narchost/Carchost: the TG one is a 788 px, heavily artefacted crop.
- No high-res film still of the Eye's searchlight beam on a stable host.
- No clean film still of the Rammas Echor, because it does not appear in the films.
- Fandom Eye.jpg (1024×768) and Mount_Doom.jpg have no source attribution; don't rely on them.

**Sources:**
- https://tolkiengateway.net/wiki/Bigatures, /Great_Signal, /Eye_of_Sauron, /Barad-d%C3%BBr, /Mount_Doom, /Morannon, /Dol_Guldur
- lotr.fandom.com api.php, page parses for Minas_Morgul, Barad-dûr, Mount_Doom, Eye_of_Sauron
- https://www.wetanz.com/us/minas-tirith
- https://www.wetanz.com/us/barad-dur
- https://www.wetanz.com/us/the-argonath-pillars-of-the-kings
- https://lynbaileyreflectivejournal.wordpress.com/2012/11/15/weta-workshop-on-the-lord-of-the-rings/
- https://lynbaileyreflectivejournal.wordpress.com/2012/11/20/weta-workshop-on-the-lord-of-the-rings-take-2/
- https://neverfeltbetter.wordpress.com/2026/08/05/nfb-re-watches-the-lord-of-the-rings-minas-morgul-as-a-horror-scene/
- https://www.motionpictures.org/2014/12/building-the-sets-of-middle-earth-for-the-battle-of-the-five-armies/
- https://newzealandfilmmap.com/locations/mount-gunn-beacon-fires/
- https://newzealandfilmmap.com/locations/kepler-dead-marshes/
- https://newzealandfilmmap.com/locations/waiau-anduin/
- https://newzealandfilmmap.com/locations/kawarau-argonath/
- https://wremertravels.com/2025/12/30/whakapapa-mount-doom-emyn-muil-lotr/
- https://www.redcarpet-tools.com/film-locations/pelennor-fields
- https://lotr.fandom.com/wiki/White_Tree_of_Gondor