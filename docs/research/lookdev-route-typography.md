**Look-development, cinematography, route and typography research for "Map of Middle-Earth"**

**Verification legend:** [V] = checked against a primary or near-primary source this session. [S] = from secondary sources only. [P] = my own proposal or derivation, not measured from the films. [U] = could not verify.

---

## 1. Peter Jackson LOTR color grading and lighting by region, and how to reproduce it in realtime

### 1.1 Who did what, and how [V]
- **Director of photography:** Andrew Lesnie, ASC, ACS. He won the Oscar for Best Cinematography for *The Fellowship of the Ring* (FOTR). He credits gaffer Brian Bansgrove as the "key element" of the lighting. Sources:
  - https://theasc.com/article/lord-of-the-rings-fellowship-of-the-ring/
  - https://en.wikipedia.org/wiki/Andrew_Lesnie
- **Colorist:** Peter Doyle, who pioneered the digital intermediate (DI) on these films.
  - The grading system was "Colossus" by Colorfront, built with PostHouse AG. It was later sold as 5D Colossus.
  - The original problem the DI solved was making New Zealand's southern-hemisphere light match England's soft northern light. Sources:
    - https://filmworkz.com/create-incredible-podcast-peter-doyle/
    - https://www.filmlight.ltd.uk/customers/meet-the-colourist/peter_doyle.php
- **How the grade worked:**
  - Grading happened in HLS space (hue, luminance, saturation), so saturation could be cut for chosen hues only. Doyle: "we can reduce the saturation based on color only". This let backgrounds be desaturated while skin tones were kept.
  - Doyle built custom sharpening "just a little bit higher than the film grain".
  - Diffusion for the Elvish realms was added in the grade as an emulation of a Tiffen Pro-Mist filter. It softens highlights and keeps blacks.
  - Source: https://theasc.com/article/lord-of-the-rings-the-two-towers/
- **Camera move style:** Lesnie on Jackson: "Very energetic and fluid… the camera is a character." Jackson praised Lesnie's natural backlight.
- **Which version to reference [S]:** The 2020 4K remaster regraded all three films to match the digital look of the Hobbit films. It removed the green tint that FOTR had on its extended-edition Blu-ray. This is forum-sourced only. Use the theatrical or 4K grade as the reference, not the green-tinted Blu-ray.

### 1.2 What Lesnie said, by region
Quotes are [V] from the American Cinematographer (AC) articles:
- FOTR: https://theasc.com/article/lord-of-the-rings-fellowship-of-the-ring/
- The Two Towers (TTT): https://theasc.com/article/lord-of-the-rings-the-two-towers/
- The Return of the King (ROTK): https://theasc.com/article/lord-of-the-rings-return-of-the-king/

| Region | What he said / what was done [V] |
|---|---|
| **Shire / Hobbiton** | "Golds and greens"; "a celebration of a simple life". He used as much natural sun as possible and avoided heavy filtration so greens stayed saturated; the warmth was set in the grade. Party firelight came from 8 small lamps gelled ¾ CTO: 4 steady, 4 flickering at random. Moonlight used CTB gel. The ROTK return to the Shire copies Gainsborough-style late-afternoon light. |
| **Weathertop** | "Blue-greens" (graded digitally). |
| **Rivendell** | "The word for Rivendell was… autumn"; it also shows "the decay of the Elvish empire". Soft ambient light broken by light shafts; the council scene has sun about ½ stop over ambient. Palette is "magenta-salmons". Twilight used lavender, lilac and salmon gels. Night is lavender-blue with blue moon shafts. Pro-Mist diffusion added in the grade. |
| **Moria** | "Would be desaturated, a look we achieved in the grading." Underexposed ambient, soft top light and raking side light on the stone. Pools of light from the torch and Gandalf's staff. Balin's tomb has a 4K Xenon light shaft through smoke. The Balrog scene uses fast-changing interactive light. |
| **Lothlórien** | At the forest edge: "very warm, late-afternoon… orange edges". Inside: "slightly cooler and lavender… ethereal… fragile". Same diffusion as Rivendell. Twinkle made by moving lights through layers of foliage. |
| **Rohan / Edoras** | "Medieval… earthy greens and browns". Under Wormtongue, a hue-selective desaturation that "looks like the color-dye prints of photos from the 1950s". Saturation comes back after Gandalf frees the king. |
| **Helm's Deep** | Rainy night, overexposed backlight, fire and torches, lights gelled ½ CTB. In the grade he "pulled back the blue while retaining a cool look". |
| **Fangorn** | Overexposed slivers of sun; "spooky but not scary". |
| **Dead Marshes** | "A slight amount of magenta" through the scenes; mist and weak sun. |
| **Gondor / Minas Tirith** | "A classic, graphic, pewter look". Warm earth colors and blues were boosted selectively so the image didn't drift toward monochrome: near-monochrome frames "fall apart" with "a point of magenta or two points of green". Siege lighting: ½–¾ CTO plus pulsing #30 red. |
| **Mordor** | "Blue-greens for night; light green contrasted with reds and oranges of Mount Doom fires" by day. Each sub-area keeps within the same lighting rules. |
| **Mount Doom exterior** | Shot on Ruapehu with no 85 filter, so the image was blue. Graded as desaturated blue, "almost monochromatic… strong reds providing color separation". |
| **Mount Doom interior** | Lit from below with red chase-pattern lights and shaken reflectors, so the light is constantly moving. |
| **Shelob's Lair** | "A fantastic cyan green". Low, hard backlight from the floor makes it claustrophobic. |
| **Cirith Ungol tower** | A red lantern against blue-green patterned moonlight (½ CTB plus White Flame Green). |
| **Grey Havens** | Golden late afternoon, lit by essentially one warm source. |
| **Hobbit films [S]** | Teal-orange grade; interiors "warmer, buttery yellows"; Goblin Town lit like "an underworld, almost volcanic". Source: https://ultrahd.highdefdigest.com/90844/thehobbitanunexpectedjourney4kultrahdbluray.html |

Not covered in any AC text I retrieved, so treat these as [U] and invent the looks: Bree, Caradhras, Isengard, Black Gate, Osgiliath, Ithilien, Argonath, Erebor, Lake-town.

### 1.3 Proposed per-region palettes [P]
These are derived from the descriptions above, not sampled from film frames.
- Sun colors use approximate blackbody sRGB values (Mitchell Charity table, [U] approximate): 2000K #FF8912, 3000K #FFB16E, 4000K #FFCEA6, 5000K #FFE4CE, 6500K #FFF9FD, 8000K #E3E9FF, 10000K #CFDAFF.
- In the table: Sat = saturation, WB = white balance.

| Region | Sun / key | Ambient / sky | Fog | Main colors | Grade |
|---|---|---|---|---|---|
| Shire | #FFD08A | #BFD6EA | #E9DDB5, thin | grass #7FA043, shadow #3E4F2B, gold #E3B04B, fire #FF9E3D | Sat +10–15% with greens boosted; WB warm; soft contrast |
| Bree (night, rain) | window light #FFB060 | #4A5560 | #5D6770 | wet stone #3A3F44 | cool; Sat −20% |
| Weathertop (night) | moon #9FD3C9 | #2F5E5B | #2A4A48 | rock #3C4A48 | blue-green; Sat −30% |
| Rivendell | #FFC48A | salmon #E7A48F; twilight lilac #B39BC8 | #EBD3C4 | leaves #C2702F / #D9A441, stone #DCD0BA | magenta-salmon; low-threshold bloom and halation ("Pro-Mist") |
| Caradhras | #F2F6FF | #9FB3CC | #DCE6F0, dense | shadow #5E7390 | cold; Sat −35% |
| Moria | torch #FFA24A; staff #E6EEFF | #2B2D30 | shafts #CFD6DE | stone #55585C, Balrog #FF4E12 | Sat −50% except fire hues; crushed shadows |
| Lothlórien | edge rake #F2B878 | inner lavender #B6BEDD | #C9CDE6 | silver bark #D9DDE6, gold leaves #D6B85C, lamps #E8F0FF | cool-lavender with diffusion (bloom) |
| Rohan | #FFDDAA | #A9BACB | #D6D2C2 | straw #B3A36A, green #7D8A4E, earth #6B5A43, thatch #C9A24E | earthy; optional hue-selective desaturation |
| Helm's Deep (night) | torches #FF9A3C | ½ CTB fill #9DB5FF | rain haze #4C5663 | stone #5A5F63 | cool, blue pulled back |
| Isengard [U] | fire pits #FF6A1A | #4A4744 | smoke #3A3633 | Orthanc #141417 | industrial; Sat −30% except fire |
| Dead Marshes | weak sun #E8E0C8 | #8C7F88 | #9C8C96, dense | water #3B463A, wisps #BFE3FF | slight magenta |
| Gondor | #FFE6C8 | #C2C8CC | #CDD0D2 | white stone #E3E1DA, pewter #8C9196, warm accent #B08A62, blue accent #5E7C9C | pewter; keep small warm and blue accents |
| Mordor day | red under-glow #FF5A1A | light green-grey #8E978A | ash #4A4540 | ground #2E2B29, basalt #1C1B1D | desaturated with red separation |
| Mordor night | lava #FFB347 → #FF5A1A → #B3200E | #1F3A3C | #22302F | — | blue-green with red accents |
| Mount Doom exterior | — | #5E6A78 | #6A6E72 | red #D8281C | blue-grey, near monochrome |
| Shelob / Cirith Ungol | lantern #E0402A | #2F8F83 | — | moon #7FD9C0 | cyan-green |
| Minas Morgul [U] | glow #9CF0B4 | #1E2A2A | — | — | sickly green (from memory of the film) |
| Eye of Sauron [P] | core #FFE3A0, rim #FF7A1F | — | — | — | bloom-driven |
| Grey Havens | #FFC56E | #F0D8A8 | #F4E2C0 | — | golden, single source |
| Lake-town / Erebor [U] | lanterns #FFB257 | #5B6E7A | — | gold #D9A93A, stone #4E5A52 | teal-orange |

### 1.4 Translating this to realtime (three.js r186, npm three@0.186.1, verified 2026-09-24)
- **Tone mapping:** three.js has `AgXToneMapping` and `NeutralToneMapping` [V, src/constants.js]. Grade before tone mapping, in linear HDR, like a DI.
- **Two-layer grade [P]:**
  1. *Per-pixel, world-space atmosphere.* Paint a "look mask" texture over the map (RGBA × 2 = 8 regions) and sample it at each fragment's world XZ. Use it to drive local fog or inscatter color, ash domes (Mordor), mist volumes (Dead Marshes) and glow (Lórien, Minas Morgul). A single frame can show several regions, so this layer must be spatial.
  2. *Per-shot global grade.* Sample the mask at the camera's focus point (not the camera position). Blend the region parameters with a critically damped spring (about 1.5–3 s). Parameters per region:
     - white-balance K and tint
     - ASC CDL values (slope/offset/power per channel, plus saturation)
     - hue-selective saturation curve (HLS-style)
     - sun color, intensity and elevation bias
     - hemisphere sky and ground colors
     - fog color, density and height falloff
     - bloom threshold and strength
     - vignette and grain
  - Interpolating parameters is cheap and friendly to Intel UHD. Where LUTs are wanted, blend at most 2 per pixel.
- **Available nodes and effects [V]:**
  - WebGPU/TSL nodes: `lut3D(node, lut, size, intensity)`, `dof(...)`, `BloomNode`, `FilmNode`, `GTAONode`, `SSSNode`, `GodraysNode`, `Sepia`, `BleachBypass`.
  - Classic pipeline: `LUTPass`, `BokehPass`, `GTAOPass`, `UnrealBloomPass`.
  - Loaders: `LUTCubeLoader`, `LUT3dlLoader`, `LUTImageLoader`.
  - pmndrs `postprocessing` v6.39.5 (2026-09-09): `LUT3DEffect`, `HueSaturationEffect`, `DepthOfFieldEffect`, `TiltShiftEffect`, `ToneMappingEffect`, `GodRaysEffect`, `VignetteEffect`, `NoiseEffect`.
  - Repos: https://github.com/mrdoob/three.js/tree/dev/examples/jsm/tsl/display and https://github.com/pmndrs/postprocessing
- **Building LUTs offline:** Python `colour-science` v0.4.7, BSD-3 (https://github.com/colour-science/colour) can turn CDL plus hue-sat settings into `.cube` files. The same numbers can then run as a parametric shader for realtime preview.
- **Day and night:** Blend each region's day and night presets by sun elevation.
  - Night presets follow Lesnie: blue-green (Weathertop, Mordor), lavender-blue moon shafts (Rivendell), CTB moon (Shire).
  - Fire sources are ¾ CTO orange, flickered with noise-driven intensity (2–8 Hz randomized, as in the Shire party rig).
- **Elvish diffusion:** Emulate Pro-Mist with a low bloom threshold (about 0.6–0.8 linear), a wide radius and low strength (0.15–0.3), plus a slight lift of highlights only. Apply only in the Rivendell and Lórien regions.
- **Lesnie's monochrome warning [P]:** Keep 2–5% of warm and cool accents in pewter or Mount Doom grades so a near-monochrome image doesn't look broken.

---

## 2. Making the world read as a beautiful miniature (diorama)

### 2.1 Why blur makes things look small [V/U]
- Held, Cooper, O'Brien and Banks, "Using Blur to Affect Perceived Distance and Size", ACM TOG 2010. Links:
  - https://dl.acm.org/doi/10.1145/1731047.1731057
  - https://pubmed.ncbi.nlm.nih.gov/21552429
  - https://objf.ai/papers/Held-UBA-2010-03/
- Findings [V]:
  - The pattern of blur plus relative depth cues sets the perceived absolute scale.
  - The blur gradient must match the depth gradient.
  - Linear screen-space blur gradients (fake tilt-shift) only work when they line up with the scene's depth gradient.
- The paper expresses blur as an angle. The thin-lens form [U: the PDF was over 10 MB and couldn't be fetched, so check the exact notation]:
  - Blur angle: `c_rad ≈ A · |1/z0 − 1/z1|`, where A = aperture diameter, z0 = focus distance, z1 = object distance.
  - In pixels: `c_px ≈ c_rad · H_px / vFOV_rad`.
  - On the image plane (sensor units): `c = A·f·|z1 − z0| / (z1·(z0 − f))`.
- **Consequence for Middle-earth [P]:** mountains break the "flat ground" assumption, so depth-based circle-of-confusion (CoC) blur beats screen-space tilt-shift. Use pmndrs `TiltShiftEffect` (offset, rotation, focusArea, feather, kernelSize) only for near-top-down map views.

### 2.2 Recommended camera model [P]
- **Scene units:** build in "table units", 1 unit = 1 cm. The Arda DEM extent is about 2000 km, so a 200 cm table is 1:1,000,000.
- **Lens:** use a real macro-style lens, e.g. 50 mm at f/5.6, giving A = f/N ≈ 0.89 cm.
- **Worked example:** focus at 40 cm, with an object 20 cm behind it:
  - `c_rad = 0.89 × |1/40 − 1/60| = 0.0074`
  - vFOV ≈ 27°, i.e. 0.471 rad
  - result ≈ 17 px at 1080p. Stopping down to f/11 gives about 8.5 px.
- **Behavior:** depth of field shrinks with distance squared. Close pushes onto Minas Tirith automatically look more "macro"; wide map shots stay mostly sharp. Use aperture pulls to tell the story: f/2.8–5.6 for toy-like intimacy, f/16–22 for epic moments (this mimics how Weta's stopped-down, motion-control shots hid the miniatures).
- **Tilted focal plane (Scheimpflug) in a post shader:** plane defined by point P0 and normal n.
  - Per pixel: `d = normalize(X − C)`, focus distance along the ray `t_f = dot(P0 − C, n) / dot(d, n)`, object distance `t = |X − C|`.
  - `CoC ∝ A·|1/t_f − 1/t|`.
  - This gives a true wedge-shaped depth of field that stays consistent over mountains.
- **Offline final render:** use accumulation depth of field (Haeberli & Akeley 1990): jitter the camera over the aperture disk while keeping the focal plane fixed, and average 16–64 samples per frame.
  - This gives physically correct bokeh with no halo artifacts, plus antialiasing, plus optional motion blur by time-jittering.
  - Cost estimate [P]: 6.5 min × 30 fps × 32 samples ≈ 374k renders, so budget hours on UHD Graphics.
- **Realtime preview:** TSL `dof()` or pmndrs `DepthOfFieldEffect` at half resolution. Note that three's `focalLength` parameter is a blur-range value in world units, not a lens focal length [V].

### 2.3 Other miniature cues [P, unless marked]
- **Motion scaling [V]:** filmmakers shoot miniatures at `24 × √(scale denominator)` fps; a 1:16 model is shot at 96 fps. Source: https://www.cinematography.net/edited-pages/MiniatureFormula.htm
  - Apply it in reverse: smoke, water and clouds moving at "tabletop" speed read as small; slowing them by `1/√S` reads as epic.
  - Make "perceived scale S" a per-shot parameter that drives the simulation time scale.
- **Aerial perspective:** real miniatures have little haze, while Weta's "bigatures" used atmospheric smoke. Use light haze for the miniature read and add height fog for landmark hero shots.
  - LOTR bigatures [S]: Minas Tirith at 1:72 (parts at 1:14), about 7 m tall. Source: https://tolkiengateway.net/wiki/Bigatures
- **Lighting:** a sun with slightly soft shadows (PCSS/VSM, larger radius) plus a big sky or hemisphere fill looks like studio softbox light.
  - Bake terrain AO (horizon-based, precomputed from the heightmap in numpy) and vertex AO on the miniatures.
  - Use "wrap" diffuse `(N·L + w) / (1 + w)` with w ≈ 0.3–0.5 on foliage and snow, plus back-translucency, for a subsurface-like feel.
- **Hobby-model materials (a realistic model, not LEGO):**
  - Grass: flocked "static grass" (high roughness plus `MeshPhysicalMaterial.sheen`).
  - Forests: clump-foliage blobs (instanced noise-displaced spheres).
  - Rock: dry-brushed, with edges lightened by curvature.
  - Water: glossy resin (roughness 0.05–0.1, depth tint, Fresnel).
  - Snow: sugar-sparkle.
  - Bevel every edge, keep a believable wall thickness, and make detail frequency match the model scale.
- **Vertical exaggeration [V]:** raised-relief maps usually use 5–10× (Wikipedia). The US continental raised-relief map uses 12× for topography and 8× for bathymetry at 1:4.37M.
  - Sources: https://en.wikipedia.org/wiki/Raised-relief_map and https://www.mapshop.com/understanding-scale-in-raised-relief-3d-maps/
  - Middle-earth at 1:1M: I suggest 15–25× base [P], a gamma curve `h' = H·(h/H)^γ` with γ ≈ 0.8 to lift foothills, and extra per-landmark boosts (Mount Doom, Caradhras, Erebor).
- **Relief cartography:**
  - Daniel Huffman: blur the DEM first, then mix roughly 90% smoothed with 10% original ("resolution bumping"). Too much exaggeration hides terrain in shadow. Source: https://somethingaboutmaps.wordpress.com/2022/01/13/towards-less-blender-y-relief/
  - Tom Patterson's plan oblique relief (terrain shifted north in proportion to elevation) and Imhof's Swiss-style shading are the classic references: https://en.wikipedia.org/wiki/Terrain_cartography
  - Standard cartographic lighting from the upper left / NW [U, convention].
- **Framing:** a diorama plinth with a cut-away strata edge, the map edge fading into parchment or a wooden table, and dust motes in the light.
- **Post:** slight saturation and midtone-contrast boost (typical of tilt-shift photos), vignette, a little chromatic aberration at the edges, and grain (`FilmNode`).

### 2.4 Reference works and what makes them work
- **Game of Thrones main titles** (Elastic / Angus Wall, 2011 Emmy) [V]:
  - Materials are wood, steel, leather and cloth, like Da Vinci machines.
  - Camera emulates a Bolex with a lens turret and only moves in physically plausible ways.
  - Depth passes drive focus and diffusion.
  - Color shifts by region (warm south, cool north), with haze where climates meet.
  - Geography stays true to the author's maps.
  - Sources: https://www.fxguide.com/fxfeatured/elastic-opens-game-of-thrones/ and https://www.artofthetitle.com/title/game-of-thrones/
- **Tiny Glade** (Tom Stochastic) [V/S]: realtime GI (software ray tracing against proxy geometry), a "novel DoF", and a soft diorama feel.
  - GPC talk: https://www.youtube.com/watch?v=jusWW2pPnA0
- **Rings of Power** [S]: map-to-live-landscape transitions, and an interactive map with animated journey lines. Directly relevant to the route line.
  - https://www.mentalfloss.com/posts/middle-earth-intertactive-map-rings-of-power-lord-of-the-rings
- **Middle-earth 3D terrain:**
  - Lugremg, "3D Map of Middle Earth": CC BY 4.0, 4.4M triangles, made with World Creator, ZBrush and Blender [V]. https://sketchfab.com/3d-models/3d-map-of-middle-earth-ede74867de2d4027b6d399cb1ecb0646
  - bburns/Arda DEM, from the Outerra forum: 2000 km square; 10k DEM at 200 m/px; 32k 16-bit at 62 m/px [V]. The repo has **no license file**, so treat it as reference-only. https://github.com/bburns/Arda
  - Jared Michael on ArtStation (https://jmichael.artstation.com/projects/Ye2mAP) and Fabio Leone (https://fabioleone.artstation.com/projects/3one6Y) [S].
  - Bodleian / Factum Arte interactive 3D model of Tolkien's maps [U, the article returned 403]: https://medium.com/@bodleian/tolkiens-maps-of-middle-earth-translated-into-interactive-3d-model-5ff71a62eb8f
- **Film map artist:** Daniel Reeve drew the films' maps (Weta's parchment map). Don't copy his lettering or linework. https://www.wetanz.com/us/parchment-map-of-middle-earth

---

## 3. Frodo's route as shown in the films

### 3.1 Waypoints in order
Film tags: FOTR, TTT, ROTK; EE = extended edition only. Plot sources [V]:
- https://en.wikipedia.org/wiki/The_Lord_of_the_Rings:_The_Two_Towers
- https://en.wikipedia.org/wiki/The_Lord_of_the_Rings:_The_Return_of_the_King
- https://tolkiengateway.net/wiki/The_Lord_of_the_Rings:_The_Fellowship_of_the_Ring_(extended_edition)

1. **Hobbiton / Bag End** (FOTR): Bilbo's party, Gandalf, the Ring left behind.
2. Shire fields: Sam's "farthest from home" moment; Farmer Maggot's crop (Merry and Pippin join); hiding from the Black Rider under a tree root; (EE) the Passing of the Elves.
3. **Bucklebury Ferry**: escape from the Rider.
4. **Bree**: the Prancing Pony, Strider. (EE) Midgewater Marshes. The films leave out the Old Forest, Bombadil and the Barrow-downs.
5. **Weathertop (Amon Sûl)**: night; the Witch-king stabs Frodo.
6. (EE) **Trollshaws**: "Mr. Bilbo's trolls" as stone statues.
7. **Ford of Bruinen**: Arwen's ride; the flood with its water-horses.
8. **Rivendell**: Council of Elrond; Sting and the mithril coat.
9. Journey montage over Eregion / Hollin: the crebain.
10. **Caradhras**: Saruman's storm and avalanche.
11. **West-gate of Moria**: the Watcher in the Water. Then the **Chamber of Mazarbul** (Balin's tomb, cave troll) and the **Bridge of Khazad-dûm** (Balrog; Gandalf falls). Then Dimrill Dale.
12. **Lothlórien / Caras Galadhon**: the Mirror of Galadriel. (EE) the long Farewell to Lórien with the gifts.
13. **Anduin by boat**, then the **Argonath**.
14. **Parth Galen / Amon Hen** (Frodo puts on the Ring and sees the Eye; Boromir falls) and the **Falls of Rauros**. Frodo and Sam cross to the east bank. The Fellowship splits here.
15. **Emyn Muil** (TTT): Gollum is captured and tamed.
16. **Dead Marshes**: faces in the water.
17. **Black Gate (Morannon)**: Easterlings enter; Gollum offers "another way".
18. **Ithilien**: Faramir's ambush, the mûmak.
19. **Henneth Annûn**: Forbidden Pool.
20. **Osgiliath**: a film-only deviation. Faramir takes them there; the Nazgûl on a fell beast; Sam's speech.
    - Correction to the brief: this is in the **theatrical** TTT, not only the EE. The EE adds the Boromir/Denethor Osgiliath flashback.
21. **Morgul Vale / Minas Morgul** (ROTK): green beam into the sky; the Witch-king's army marches out.
22. **Stairs of Cirith Ungol**: Gollum frames Sam and Frodo sends him away. Both are film-only changes.
23. **Shelob's Lair**: the Phial.
24. **Tower of Cirith Ungol**: orcs fight over the mithril; Sam's rescue.
25. **Plains of Gorgoroth**: the huge orc encampment. (EE) they are forced into an orc column and escape with a fake fight.
26. **Mount Doom / Sammath Naur**: the Ring and Gollum fall; eruption; Barad-dûr collapses; the Eagles.
27. **Minas Tirith**: the coronation, "you bow to no one". The book's Field of Cormallen is left out.
28. **Shire**: Sam and Rosie. The Scouring of the Shire is left out.
29. **Grey Havens**.

- **Distances for proportions [S], Éowyn Challenge (Fonstad):** Bag End → Rivendell 458 mi; Rivendell → Lórien 462 mi; total to Mount Doom about 1,779 mi, which leaves about 859 mi from Lórien to the mountain [P].
  - Pace by drama, not by distance: the south-east holds the most landmarks.
  - Source: https://newboards.theonering.net/threads/walk-to-rivendell-and-beyond-an-explanation-history-links.1017617/
- Pippin lighting the beacons was invented for the film; the beacons themselves are in the book [V/S].

### 3.2 Pacing plan: about 6:30 main cut [P]
Assumes 72 BPM, so one bar = 3.33 s; each segment is a whole number of bars.

| Time | Segment | Treatment |
|---|---|---|
| 0:00–0:12 | Title card | Ember-glow reveal (§4.5) |
| 0:12–0:40 | **Prologue** | Option A: open on Mount Doom's glow and the Eye (the FOTR prologue's "start at the end"), then sweep west. Option B: Erebor → Lake-town → Mirkwood → Misty Mountains, drawing Bilbo's route as a faint gold thread that hands over to Frodo's line at Bag End. |
| 0:40–1:10 | Shire → Bucklebury → Bree | **Pause at Hobbiton (6 s)**, golden hour. Dusk falls on the way to Bree. |
| 1:10–1:27 | Weathertop, Trollshaws, Ford | Night, blue-green; 3 s pause on the hill; the flood as a water effect. |
| 1:27–1:53 | **Rivendell** | Pause (6 s); waterfalls, autumn salmon light. Chapter card. |
| 1:53–2:30 | Caradhras → **Moria** | Snow, then a dive into the West-gate. **Cut-away cross-section** of the diorama showing the Bridge and the Balrog glow (8 s). Out through Dimrill Dale. |
| 2:30–2:50 | **Lothlórien** | Pause (5 s); lavender, twinkling canopy lamps. |
| 2:50–3:15 | Anduin → **Argonath** → Rauros / Amon Hen | Low hero pass between the pillars (5 s). The route splits into dashed side lines. |
| 3:15–3:50 | *Meanwhile* detour | Crane up and pan: Fangorn → **Isengard/Orthanc** (fire pits, then Ents' flood) → **Edoras** → **Helm's Deep** (rain, night). Return to the east bank. |
| 3:50–4:10 | Emyn Muil → Dead Marshes | Magenta mist; wisps. |
| 4:10–4:25 | **Black Gate** | Pause (4 s); gates open; turn south. |
| 4:25–4:48 | Ithilien → Henneth Annûn → **Osgiliath** | Fell beast silhouette. |
| 4:48–5:08 | **Minas Tirith** detour | Dawn "pewter" flyover, then the **beacon chain** racing west along the White Mountains to Edoras. |
| 5:08–5:30 | **Minas Morgul** → Stairs → Shelob → Cirith Ungol | Green beam; cyan-green lair; red lantern. |
| 5:30–6:05 | Gorgoroth → **Mount Doom / Barad-dûr** | Eye searchlight sweep; ash; climb; eruption; tower collapses; Eagles. Longest hold. |
| 6:05–6:30 | Epilogue | Dawn spreads west. Pull back to the whole map with the completed glowing line. Grey Havens ship sails into the sunset. End card. |

- **4:30 cut:** trim the prologue to 15 s; fold Isengard, Rohan and Minas Tirith into one 20 s beacon flyover; keep hero pauses only at Hobbiton, Rivendell, Moria, Argonath, Black Gate, Minas Morgul and Mount Doom.
- **Camera grammar:**
  - Rise into landmarks on a crane and push in slowly (3–6 s).
  - Low angles for statues (Argonath) and slight Dutch tilts in Mordor.
  - Helicopter-style glides along ridges.
  - The route head should move no faster than about 10% of frame width per second, with 1.5–2 s ease-in/out around each pause.
  - Use a Catmull-Rom camera path with a separate look-at spline.

### 3.3 Framing places that aren't on Frodo's route [P]
- Prologue as a "There and Back Again" thread from Erebor / Lake-town.
- At Amon Hen, split into colored dashed lines per group:
  - Aragorn, Legolas, Gimli: Rohan.
  - Merry and Pippin: Fangorn, Isengard.
  - Gandalf: return.
- Use the beacon relay as the natural flyover linking Gondor and Rohan.
- Picture-in-picture "cartouche insets" on the map as a cheap fallback.

---

## 4. Typography and ornament

### 4.1 Free fonts
All of these are verified present in `google/fonts/ofl/` under SIL OFL 1.1. Base URL: `https://fonts.google.com/specimen/<Name>`. Repo: https://github.com/google/fonts/tree/main/ofl

| Font | Designer | Use | RFN note |
|---|---|---|---|
| **Cinzel** (variable weight) | Natanael Gama | Roman inscriptional caps; chapter cards, Gondor | none in current OFL.txt |
| **Cinzel Decorative** | Gama | Main title only, swash caps | RFN 'Cinzel' |
| **IM Fell English** / English SC / DW Pica / Great Primer / Double Pica | Igino Marini | Old-print map labels; italic for water names | none |
| **Cormorant Garamond** / Cormorant / SC / Unicase | Christian Thalmann | Elegant subtitles, Elvish | none |
| **EB Garamond** | Duffner, Pardo | Body text, credits | none |
| **Uncial Antiqua** | Astigmatic | Celtic uncial; Rohan / Shire accents (sparingly) | RFN |
| **Almendra** / SC / Display | Ana Sanfelippo | Calligraphic Elvish labels | RFN |
| **Marcellus** / SC | Astigmatic | Trajan-like flared serif; Gondor | RFN |
| **Aboreto** | Dominik Jáger | Thin incised caps | none |
| **MedievalSharp**, **Metamorphous** | — | Dwarf / Moria labels | RFN |
| **Pirata One**, **Grenze Gotisch**, **Fruktur**, **UnifrakturMaguntia**, **Texturina** | — | Blackletter for Mordor / Isengard | Pirata has RFN |
| **Noto Sans Runic** | Google | Real Unicode runes (safe "Dwarvish" flavor; Tolkien used Anglo-Saxon runes on Thror's map in *The Hobbit* [U]) | none |
| **Junicode** v2.226 | Peter Baker | Medievalist, rich OpenType features | OFL-1.1; https://github.com/psb1558/Junicode-font |

- **RFN rule:** fonts with a Reserved Font Name must be renamed if you modify or subset them. Rendering text into video frames raises no license issue.
- **Suggested set [P]:**
  - Cinzel Decorative for the title.
  - Cinzel with +60–100 tracking for chapter cards.
  - Cormorant Garamond Italic for subtitles.
  - IM Fell English SC for land labels, and IM Fell English Italic for water (cartographic convention).
  - Mountain-range names in spaced caps set along a curve.

### 4.2 Fonts to avoid
- **Ringbearer** (Pete Klassen, 2002): copies the film logo; personal use only; no modification. https://www.fontspace.com/ringbearer-font-f2246
- **Aniron** (Klassen, 2004): copies the film credits font; private use only. https://www.thehutt.de/tolkien/fonts/aniron/readme.html
- **"Tolkien" font** (used by the Arda repo): license unclear [U].
- **Cirth Erebor**: personal use only. https://www.dafont.com/cirth-erebor.font

### 4.3 Tengwar and Cirth fonts, with cautions
- **Alcarin Tengwar** (Toshi Omagari): OFL-1.1 [V via GitHub API]. Designed to match Brill. https://github.com/Tosche/Alcarin-Tengwar
- **Free Tengwar Font Project** (FreeMonoTengwar, Tengwar Telcontar, Tengwar Formal CSUR): GPLv3+ with a font-embedding exception; glyphs sit in the ConScript (CSUR) Private Use Area. https://freetengwar.sourceforge.net/
- **Constructium** (Kreative Software): OFL, a Gentium fork; supports CSUR Tengwar and Cirth. https://www.kreativekorp.com/software/fonts/constructium/
- **Tengwar Annatar** (Johan Winge): freeware for non-commercial use only. Commercial use requires sending the author a free copy. Its own license warns that the Tolkien Estate's permission may be needed [V, LICENCE text]. https://github.com/luxcem/ttf-tengwar-annatar
- **Main caution [V]:** the Tolkien Estate FAQ says of the invented languages and scripts: "may not reproduce them in any form of publication or in connection with any group activity, commercial or otherwise". Maps of Middle-earth are protected copyright works, and the policy applies to non-profit uses too. https://www.tolkienestate.com/frequently-asked-questions-and-links/
  - **Recommendation:** no Tengwar or Cirth text, and never the One Ring inscription. Use real historical runes (Noto Sans Runic) or an original, procedurally generated pseudo-script for decoration.
- **Wider IP flags for the planner [V/S]:**
  - Film imagery and logos belong to Warner Bros./New Line.
  - The titles and many names are trademarks of Middle-earth Enterprises (Embracer since 2022; reportedly moved to a new "Fellowship Entertainment" in 2026 [U]).
  - The procedural soundtrack must not quote Howard Shore's themes.
  - Chapter names should be original rather than book or film titles.
  - Sources: https://en.wikipedia.org/wiki/Middle-earth_Enterprises and https://www.licenseglobal.com/entertainment/embracer-group-acquires-ip-rights-to-the-lord-of-the-rings-the-hobbit

### 4.4 Original ornament [P, sources V]
- **Knotwork:** implement the Mercat algorithm yourself; the algorithm isn't copyrightable.
  - References: https://www.stevenabbott.co.uk/Knots/knots.html and http://birrell.org/andrew/knotwork/
  - dmackinnon1/celtic has **no license**, so reference only: https://github.com/dmackinnon1/celtic
  - Draw as ribbons with over/under shading and a gilded edge.
- **Per-culture style families (don't copy film designs):**
  - Rohan: Anglo-Saxon / Sutton-Hoo-style zoomorphic interlace with horse-head ends.
  - Gondor: Roman/Byzantine meander, key and laurel.
  - Elves: vines grown by L-system or space colonization, animated along the border.
  - Dwarves: angular, straight-line geometric knots.
  - Mordor: jagged iron strapwork.
- **Map cartouche:** Renaissance strapwork scroll cartouches (Ortelius/Mercator era, public domain) and an original compass rose.
- **Public-domain ornament source:** Owen Jones, *The Grammar of Ornament* (1856). https://commons.wikimedia.org/wiki/Category:The_Grammar_of_Ornament

### 4.5 Animated title reveals [P; libraries V]
- **Text rendering options:**
  - troika-three-text 0.52.5 (MIT): SDF text that can patch any material. https://github.com/protectwise/troika
  - For WebGPU/TSL, an MSDF approach such as three-msdf-text-webgpu; see Codrops, "Gommage" dissolve (2026-01): https://tympanus.net/codrops/2026/01/28/webgpu-gommage-effect-dissolving-msdf-text-into-dust-and-petals-with-three-js-tsl/
  - opentype.js 2.0.0 (MIT) gives glyph outlines as paths.
- **Ink-draw:** animate the stroke of each glyph path (dash offset) with pressure-varying width. Then "bleed" the fill: `alpha = smoothstep(r − e, r, sdf + 0.1·noise + k·x)`. The wet sheen fades to matte over a procedural paper texture. Good for Shire and Rivendell cards.
- **Ember / forge (Mordor):** noise dissolve with a burn band ramp #FFF2C0 → #FF8A1E → #B3200E → charcoal, emissive above 1 so it blooms. Add curl-noise embers and heat-shimmer refraction. For the reverse, letters cool from molten to dark iron.
- **Gilded (Gondor / title):** bevel normals from the SDF gradient, metalness 1 and roughness about 0.3 under an environment map. A specular light sweeps left to right, with sparkle glints and gold-leaf crackle.
- **Other ideas:**
  - Elvish starlight: glyphs appear as connected points of light, with a rim glow.
  - Carved stone (Moria / Argonath): a raking light sweep reveals chiseled displacement while dust falls.
  - Every title sits inside a cartouche or knot frame that draws itself first, over 1–2 bars of music.