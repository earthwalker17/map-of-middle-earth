## Three.js tech research for Map of Middle-Earth (checked 2026-09-28/29)

Sources are GitHub via `gh api`, the npm registry via `npm view`, and the three.js source at tag r186. Anything I could not confirm directly is marked **[UNVERIFIED]**.

### 1. three.js release and state of WebGPURenderer + TSL

- **Latest release:** r186, tagged on GitHub 2026-09-24 (https://github.com/mrdoob/three.js/releases/tag/r186).
  - The npm `latest` tag is **three@0.186.1** (2026-09-24). 0.186.0 came out 2026-09-08.
  - Earlier releases: r185 (0.185.0 on 2026-06-25, patch on 07-01), r184 (2026-04-16), r183 (2026-02-18/20), r182 (2025-12-10).
  - `@types/three` latest is 0.186.0.
- **Official status (manual, r186):** https://github.com/mrdoob/three.js/blob/r186/manual/pages/webgpurenderer.html
  - The manual still says the renderer is "in an experimental state although its maturity level has been greatly improved… depending on your application… you will encounter missing features or a better performance with WebGLRenderer."
  - WebGLRenderer is maintained, but "no plans to add larger new features."
- **Imports:** `three/webgpu` and `three/tsl`.
  - Initialisation is async. Use `setAnimationLoop()` or `await renderer.init()`.
  - The `*Async` render/compute methods have been deprecated since r181.
- **WebGL2 fallback:** automatic when WebGPU is unavailable. You can force it with `new WebGPURenderer({ forceWebGL: true })`.
  - In the fallback, compute shaders run through **transform feedback** (confirmed in `src/renderers/webgl-fallback/WebGLBackend.js`).
  - The fallback does not support indirect or array compute counts. Storage textures, atomics and workgroup memory are therefore WebGPU-only.
- **Missing compared with WebGLRenderer:**
  - `ShaderMaterial`, `RawShaderMaterial` and `onBeforeCompile` are not supported. Everything has to be written as node materials in TSL.
  - `EffectComposer` is not supported; the post stack is replaced by node-based `RenderPipeline`.
  - `PostProcessing` was renamed `RenderPipeline` in r183. The old name is still exported, along with `DirectRenderPipeline`.
  - Migration guide: https://github.com/mrdoob/three.js/wiki/Migration-Guide
- **Relevant changes in r186:**
  - `SunLight` (cascaded shadows, now 2 cascades) is in `three/addons/lights/SunLight.js` and works with both renderers. With WebGPU you register it with `renderer.library.addLight(SunLightNode, SunLight)`.
  - Added: `compileComputeAsync()`, async `dispose()`, a VXGI node, an OIT pass, SSAO node, `softParticles()`, and `batchIndirectIndex`.
  - Sky and SkyMesh get "more realistic clouds".
  - New procedural addons: `TerrainGenerator`, `ForestGenerator` (500k instanced trees in one draw) and `TreeGenerator`.
  - `PCFSoftShadowMap` is removed; use `PCFShadowMap`.
  - The PBR energy-conservation change alters how materials look.
  - The CommonJS build is deprecated and the minified builds are removed.
- **Known issues:**
  - **Node-material build and draw overhead:** https://github.com/mrdoob/three.js/issues/33821 (open)
    - WebGPURenderer was 16–36× slower than WebGL at first-render/initialisation with thousands of unique materials or separate `render()` calls.
    - Causes are per-render `queue.submit` and a separate colour-space output pass.
    - Mitigations: reuse materials, use per-instance uniforms (`webgpu_instance_uniform`), batch, and keep `render()`/`compute()` calls few.
  - Performance regression since r176: https://github.com/mrdoob/three.js/issues/32675 (closed).
  - **r186 regression:** a transparent `Line2NodeMaterial` plus `setSize()` gives "Destroyed texture used in a submit" (#34600, #34608). It was closed 2026-09-20, so the fix is probably in 0.186.1 **[UNVERIFIED which build]**. Pin 0.186.1 and avoid transparent Line2 for the route line.
  - A Gen9 Intel benchmark showed WebGL with higher FPS than WebGPU (https://aestar.tech/en/blog-en/webgpu-vs-webgl-practical-three-js-performance-test-for-complex-3d-scenes/). I found no Ice Lake/Gen11-specific three.js bug.
- **Intel Gen11 on Windows/D3D12:**
  - Chrome's WebGPU runs on Dawn over D3D12.
  - Dawn enables a driver-bug toggle on Intel Gen9.5/Gen11 D3D12 (disables texture sub-allocation, crbug 1237175): https://dawn.googlesource.com/dawn
  - **[UNVERIFIED]** that your UHD G1 driver isn't blocklisted. Check `chrome://gpu` and `(await navigator.gpu.requestAdapter()).info`.
- **Headless:**
  - The Chrome docs only cover Linux/Vulkan flags (`--enable-unsafe-webgpu`, `--use-angle=vulkan`): https://developer.chrome.com/blog/supercharge-web-ai-testing
  - Headless browsers often fall back to software GL (https://issues.chromium.org/issues/40540071).
  - On Windows, run **headed** Chrome/Edge through Playwright (`channel:'chrome'` or `'msedge'`) and assert the adapter is non-null. **[UNVERIFIED]** that `--headless=new` gets a hardware adapter on Windows.

### 2. Post-processing for WebGPURenderer

Everything lives under `three/addons/tsl/display/*.js` and is chained with `RenderPipeline` plus `pass()`/`mrt()` from `three/tsl` (listing: https://github.com/mrdoob/three.js/tree/r186/examples/jsm/tsl/display). Examples: https://threejs.org/examples/?q=webgpu%20postprocessing

- **Bloom:** `bloom` from `BloomNode.js`. Selective and emissive bloom via MRT. Faster blur added in r186. Mature.
- **Ambient occlusion:**
  - `ao` from `GTAONode.js`, reworked in r185/r186. It is darker now; lower `radius`/`scale`. `distanceExponent` and `distanceFallOff` are deprecated.
  - `ssao` from `SSAONode.js` is a new cheap option in r186 and the better fit for an iGPU.
  - `denoise` (`DenoiseNode.js`) and `bilateralBlur` are available for cleanup.
- **Depth of field:** `dof(node, viewZ, focusDistance, focalLength, bokehScale)` from `DepthOfFieldNode.js`.
  - **There is no TiltShift node.** For the miniature look, either use a strong shallow `dof`, or write a custom TSL mask on `screenUV.y` that mixes `gaussianBlur`/`hashBlur` (`GaussianBlurNode.js`, `hashBlur.js`) with the sharp image. The mask is simple and cheap.
- **Anti-aliasing:**
  - `traa` from `TRAANode.js`, which needs MSAA off and `velocity` in MRT.
  - `taau` from `TAAUNode.js`, which also upscales.
  - `fxaa`, `smaa` (SMAA 1x medium), and `ssaaPass` from `SSAAPassNode.js`. SSAA is the best choice offline because it supersamples and time per frame doesn't matter.
  - `fsr1` for upscaling and `sharpen` are also available.
- **Screen-space reflections:** `ssr` from `SSRNode.js`, with an optional denoiser (r185). Composite additively (r183 change).
- **Other screen-space effects:** `ssgi` (SSGINode) and `sss` (SSSNode).
- **Motion blur:** `motionBlur(input, velocity, samples)` from `MotionBlur.js`. Offline, sub-frame accumulation is an alternative.
- **Lens flare:**
  - `lensflare` from `LensflareNode.js` is a bloom-based ghost/halo effect.
  - Geometric flares: `LensflareMesh` from `three/addons/objects/LensflareMesh.js`.
- **Film grain:** `film` from `FilmNode.js`. Also `chromaticAberration`, `rgbShift`, `afterImage`, `transition` (for title-card crossfades), `radialBlur`, `sepia`/`bleach` and `crt`.
- **Colour grading:**
  - `lut3D` from `Lut3DNode.js`, with `LUTCubeLoader`, `LUT3dlLoader` or `LUTImageLoader`.
  - TSL built-ins: `cdl`, `saturation`, `vibrance`, `hue`, `luminance`, `posterize`.
  - Tone mapping: `agxToneMapping`, `acesFilmicToneMapping`, `neutralToneMapping`.
  - The r186 Inspector has a Colour Grading extension.
- **Outline:** `outline(scene, camera, params)` from `OutlineNode.js`.
- **God rays:** `godrays(depth, camera, light)` from `GodraysNode.js` (a port of three-good-godrays).
  - Only point and directional lights. It needs full shadows enabled: renderer shadows on, objects cast and receive, and the light casts.
  - Follow it with `bilateralBlur` and `depthAwareBlend`.
- **Fog in post:** example `webgpu_postprocessing_fog`, added in r186.

**WebGL route for comparison:**
- `postprocessing` 6.39.5 (Zlib, peer `three >=0.168 <0.187`, 2026-09-09) is WebGLRenderer-only. v7 is at 7.0.0-beta.16 (2026-02-19) and still WebGL-focused. https://github.com/pmndrs/postprocessing
- Add-ons: `n8ao` 2.0.1 (ISC) for AO and three-good-godrays for god rays.
- `realism-effects` 1.1.2 is stale (last published 2023).
- The WebGL route has a richer and more battle-tested effect set, but it is a frozen-feature renderer.

### 3. Terrain at large scale

- **Bounded diorama with offline render:** a map-sized diorama doesn't need infinite-terrain LOD.
  - Use N×N tiled `PlaneGeometry` chunks (so frustum culling works per tile), with vertex displacement from a 16-bit heightmap in TSL `positionNode`.
  - Compute normals in-shader or from a baked normal map.
  - A quadtree is optional for interactive preview.
  - Reference: `webgpu_tsl_procedural_terrain`, which uses `mx_noise_float` displacement and finite-difference normals (https://threejs.org/examples/webgpu_tsl_procedural_terrain.html).
- **r186 addons:** `three/addons/generators/TerrainGenerator.js` bakes domain-warped, eroded mountains into a mesh, with a TSL grass/rock/snow material and `sampleHeight`/`sampleSlope` for placement.
  - Pair it with `ForestGenerator.js`. Demo: `webgpu_custom_fog`.
  - Good templates, but these are procedural, not heightmap-driven. Adapt them to your Middle-earth heightmap.
- **LOD libraries:**
  - `@interverse/three-terrain-lod` 2.1.1 (MIT, peer `three >=0.183`): quadtree plus instanced chunks, a TSL displacement material, skirts, and GPU heightmap brush compositing. The repo `aiira-co/three-terrain-lod` has 3 stars, so maturity is low. https://github.com/aiira-co/three-terrain-lod
  - Reference implementations only: https://github.com/tschie/terrain-cdlod, https://github.com/felixpalmer/lod-terrain
  - `three.terrain.js` 3.1.1 (MIT, 2026-08) is a WebGL-era generator.
  - `@takram/three-geospatial` core (0.9.1) and `3d-tiles-renderer` 0.5.3 (Apache-2.0) target real-world geodata, which is overkill here.
- **Splat and biome blending (TSL):**
  - Use an RGBA splat or biome mask texture plus `triplanarTexture`/`triplanarTextures` (exported from `three/tsl`) for cliffs.
  - Add slope and height rules, and detail/macro-variation noise (`mx_fractal_noise_float`, `mx_worley_noise_float`, `tsl/math/voronoiNoise.js`, `curlNoise.js`).
  - Watch texture-unit and bandwidth cost on the iGPU. Prefer texture arrays (`DataArrayTexture` / KTX2 array).
- **Instancing:**
  - `InstancedMesh` can do millions of instances. `ForestGenerator` does 500k in one draw, with distance-gated shading.
  - Culling is per object, so split instances into spatial tiles.
  - `BatchedMesh` works in WebGPU (`webgpu_mesh_batch`) with per-instance culling and sorting. r186 fixed draw offsets and added `batchIndirectIndex`.
  - GPU-driven drawing: `IndirectStorageBufferAttribute` plus `geometry.setIndirect()`, with a compute pass writing the draw args (`webgpu_struct_drawindirect`). This is how to do compute culling and LOD in WebGPU. It's WebGPU-only: the WebGL fallback can't do indirect.
  - Per-instance data: `instancedArray`/`storage` and `webgpu_instance_uniform`.
  - `@three.ez/instanced-mesh` 0.3.16 (MIT) adds BVH culling, LOD and shadow-LOD, but its README makes no WebGPU claim. Treat it as WebGL-oriented **[UNVERIFIED]**.
  - Distant trees should be impostors or billboards (`billboarding()` TSL node).

### 4. Sky, atmosphere, clouds, water, fog (licences)

- **three `SkyMesh`** (WebGPU; `Sky` is the WebGL version) — MIT, as all of three.js:
  - A Preetham sky with r186 procedural 2D clouds: `cloudScale`, `cloudSpeed`, `cloudCoverage`, `cloudDensity`, `cloudElevation` uniforms.
  - Always +Y up (r186). The legacy gamma was removed in r183.
  - Example: `webgpu_sky`.
- **`@takram/three-atmosphere`** 0.19.1 (MIT):
  - Bruneton precomputed scattering plus Hillaire multiple scattering.
  - The **`/webgpu` export is marked "Done"** and needs `three >=0.182`. It provides `AtmosphereLight`, `AtmosphereLightNode`, `aerialPerspective` and `AtmosphereContext`, and uses `RenderPipeline`.
  - It's built for Earth scale (ECEF), but there is a "non-geospatial" story.
  - Docs: https://github.com/takram-design-engineering/three-geospatial/blob/main/packages/atmosphere/WEBGPU.md. Storybook: https://takram-design-engineering.github.io/three-geospatial-webgpu/
  - **[UNVERIFIED]** compatibility with r186; the last publish was 2026-05-06.
- **`@takram/three-clouds`** 0.7.6 (MIT):
  - Volumetric clouds, **WebGL plus `postprocessing` only**. The root README says clouds WebGPU support is "Work in progress". https://github.com/takram-design-engineering/three-geospatial
  - It relies on temporal accumulation, so offline you must render several warm-up frames per output frame.
  - R3F peers are optional.
- **Water:**
  - `WaterMesh` (`objects/WaterMesh.js`): flat, reflective, sun glint (`webgpu_ocean`).
  - `Water2Mesh` (`objects/Water2Mesh.js`): reflection, refraction and flow maps (`webgpu_water`). Both are WebGPU-only; `Water`/`Water2` are the WebGL versions.
  - Other options: a heightfield ripple sim (`webgpu_compute_water`) and a `MeshPhysicalNodeMaterial` with transmission.
  - Waterfalls: scrolling-UV TSL material on a mesh strip, plus mist particles.
- **Fog:**
  - TSL `fog()`, `densityFogFactor`, `rangeFogFactor`, `exponentialHeightFogFactor` (`webgpu_fog_height`).
  - Noise fog with `triNoise3D` (`webgpu_custom_fog`) and scattering fog (`webgpu_custom_fog_scattering`).
  - Volumetric lighting (`webgpu_volume_lighting`, `_traa`, `_rectarea`).
  - Raymarched cloud volume (`webgpu_volume_cloud`, `tsl/utils/Raymarching.js`).
  - Post fog (`webgpu_postprocessing_fog`).
- **Cloud shadows:** **no ready-made library found.** Standard approach: in the terrain and object material, sample a world-XZ scrolling 2D noise or cloud-coverage texture along the sun direction and multiply it into direct light. Cheap and deterministic.

### 5. GPU particles (TSL compute)

- **Official examples:** https://threejs.org/examples/
  - `webgpu_compute_particles` (1M particles, `instancedArray` + `Fn().compute()`)
  - `webgpu_compute_particles_rain`, `_snow`, `_fluid`
  - `webgpu_tsl_compute_attractors_particles`
  - `webgpu_tsl_vfx_flames`, `webgpu_tsl_vfx_linkedparticles`, `webgpu_tsl_vfx_tornado`
  - `webgpu_volume_fire` (uses `tsl/math/curlNoise.js`)
  - `webgpu_particles_soft` (`softParticles` from `tsl/utils/SoftParticles.js`, r186)
- **Pattern:** position/velocity in `instancedArray` → per-frame `renderer.compute(kernel)` → a `SpriteNodeMaterial` or instanced mesh reading storage.
  - Use curl noise for smoke, ash and embers.
  - Add bloom on emissive embers and soft-particle depth fade.
  - `compileComputeAsync()` (r186) pre-compiles kernels.
- **Third-party:** `three.quarks` 0.17.1 (MIT) lists "WebGPU rendering support" as not done yet. Its experimental `quarks.nodes` claims WebGPU compute **[UNVERIFIED]**.

### 6. Tooling and version facts

- `vite` 8.3.1: Rolldown-based, stable since 2026-03-12. Needs Node ^20.19 or >=22.12, so Node 24 is fine. https://vite.dev/blog/announcing-vite8
- `typescript`: 7.0.2 is `latest`, the Go port released 2026-07-08. It has no public compiler API, and `strict` is on by default. https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
  - 6.0.3 was published 2026-04-16.
  - `@types/three` tags only go up to `ts6.0`.

---

## RECOMMENDED STACK

**Renderer: `WebGPURenderer` + TSL (three 0.186.1) on the WebGPU backend.** `forceWebGL` stays available as a debug fallback, but don't design around it: no indirect draw or atomics there.

Why:
- All new post nodes (dof, traa, ssaaPass, ssao/GTAO, godrays, lut3D, film, lensflare, motionBlur), plus SunLight CSM, SkyMesh clouds, Water2Mesh, compute particles and Terrain/ForestGenerator templates, are native.
- Offline frame-by-frame rendering hides WebGPU's per-draw CPU overhead.

Core packages and tools:
- `three@0.186.1` (MIT), `@types/three@0.186.0`
- `vite@^8.3` (MIT)
- `typescript@~6.0.3`, used for type-checking only; Vite/Oxc transpiles. TS 7 is optional later once `@types/three` publishes a `ts7` tag.
- pnpm; Node 24.

Rendering building blocks:
- **Terrain:** custom tiled heightmap plus TSL displacement, splat/triplanar material and in-shader normals. Borrow from `TerrainGenerator.js` and `webgpu_tsl_procedural_terrain`.
  - `@interverse/three-terrain-lod@2.1.1` (MIT) is only a reference; it's immature.
- **Vegetation:** tiled `InstancedMesh` following the `ForestGenerator.js` pattern, plus billboard impostors.
  - Landmarks (glTF, KTX2 textures) go into `BatchedMesh`.
  - GPU-indirect culling with `setIndirect` is optional.
- **Sky:** `SkyMesh` first, because it's simplest and has clouds. Upgrade to `@takram/three-atmosphere@0.19.1/webgpu` (MIT) for aerial perspective only after a compatibility spike with r186.
- **Clouds:** custom TSL raymarch (`webgpu_volume_cloud` / `Raymarching.js`) or billboard cloud cards, plus projected cloud shadows. Avoid `@takram/three-clouds` because it would force the WebGL route.
- **Water:** `Water2Mesh` / `WaterMesh`.
- **Particles:** TSL compute (Mount Doom smoke, ash, embers, waterfall mist).
- **Post chain:** `pass` + `mrt(output, normal, velocity)` → `ssao`/`ao` → `godrays` (SunLight) → `bloom` → `dof` or a custom tilt-shift mask → `lut3D`/`cdl` → `film` → AA with `ssaaPass` offline (`traa`/`fxaa` for preview).
- **Route line:** a tube or ribbon mesh with an emissive TSL material and bloom, not a transparent `Line2NodeMaterial`.

Utilities:
- `three-mesh-bvh@0.9.15` (MIT) for raycasts and path snapping.
- `lil-gui@0.21.0` (MIT) or the built-in three Inspector.
- `@gltf-transform/core@4.5.1` (MIT) plus KTX2/BasisU for asset optimisation.
- `simplex-noise@4.0.3` (MIT) for CPU-side noise.

Offline capture:
- `playwright@1.63.0` (Apache-2.0) drives **headed** Chrome 153 / Edge (`channel:'chrome'`).
- The page exposes `renderFrame(n)`, which sets a virtual clock → `renderer.render` → `readRenderTargetPixelsAsync` or `canvas.toBlob`.
- Frames go to Node → PNG sequence or raw RGBA piped to ffmpeg 8 (libx264/x265 CRF, or ProRes master).
- Optional in-browser encoding: WebCodecs plus `mediabunny@1.60.0` (MPL-2.0). `mp4-muxer` is deprecated in its favour.

Fallback route if WebGPU is unstable on the UHD G1: `WebGLRenderer` + `postprocessing@6.39.5` (Zlib) + `@takram/three-atmosphere` / `three-clouds` (WebGL) + `n8ao`. It's feature-frozen, and `postprocessing`'s peer range stops at three <0.187.

## RISKS

1. **WebGPU is still "experimental" in the official docs,** with breaking changes every release (r183–r186 renames, removed shadow types, energy changes).
   - Pin exact versions (three 0.186.1).
   - Upgrade deliberately and keep golden-frame screenshot tests.
2. **Clock-driven TSL nodes break determinism.** `time` and `deltaTime` come from `performance.now()` (confirmed in `src/nodes/core/NodeFrame.js`).
   - Drive all animation from your own `uniform()` frame-time values.
   - Or override `performance.now` / `requestAnimationFrame` through Playwright `addInitScript` with a virtual clock.
   - Temporal nodes (TRAA, SSGI, takram clouds) need fixed-step history. Render warm-up frames after cuts.
3. **The iGPU is weak.** The UHD G1 has 32 EUs **[its ~0.5 TFLOPS throughput is my estimate, not verified]**, and memory is shared with 7.6 GB of RAM.
   - Budget textures (KTX2/BC7), keep tab memory well under 2 GB, and use half-float targets.
   - Tile the forest and cull it. Use SSAO rather than GTAO or SSGI for preview.
   - Have separate quality presets for preview and final.
4. **Device loss on long GPU work.** Windows TDR (about 2 s per GPU submission) or Chrome's GPU watchdog can kill a heavy frame (raymarched clouds or SSAA at 4K). This is general platform knowledge, not something I verified in this session.
   - Split the work: render tiles with `camera.setViewOffset` and accumulate SSAA over several submits. Cap raymarch steps.
   - Handle `device.lost` and resume from the last frame index.
   - `--disable-gpu-watchdog` **[UNVERIFIED]**. Raising the TdrDelay registry value needs admin and user consent.
5. **Headless GPU on Windows is unreliable/unverified.**
   - Use headed Chrome/Edge through Playwright.
   - Assert `navigator.gpu.requestAdapter()` is non-null and log `adapter.info` before a batch render.
   - Don't use Playwright's bundled headless shell.
6. **Node-material compile and draw overhead** (#33821): stalls with many unique materials.
   - Share materials; vary them with per-instance attributes or storage.
   - Pre-compile with `compileAsync` / `compileComputeAsync` before capture.
   - First-use pipeline compiles on D3D12 can be slow **[UNVERIFIED magnitude]**.
7. **Third-party WebGPU gaps:**
   - takram clouds is WebGL-only.
   - three.quarks and `@three.ez/instanced-mesh` are WebGL-oriented.
   - takram atmosphere WebGPU is untested against r186.
   - Plan to build clouds, tilt-shift and cloud shadows in-house in TSL.
8. **Canvas readback:** a WebGPU canvas's contents may be invalid after presentation **[UNVERIFIED on Chrome 153]**. Prefer rendering the final pipeline to a RenderTarget and using `readRenderTargetPixelsAsync`, or grab the canvas in the same task right after `render()`.
9. **Transparent `Line2NodeMaterial` resize bug in r186** (#34600, #34608). It's closed and probably fixed in 0.186.1. Avoid it anyway, or keep the canvas size fixed during capture.
10. **Typings:** TS 7.0.2 is `latest`, but `@types/three` only declares up to `ts6.0`. Stay on TS 6.0.3 until that changes.

Sources:
- https://github.com/mrdoob/three.js/releases/tag/r186
- https://github.com/mrdoob/three.js/wiki/Migration-Guide
- https://github.com/mrdoob/three.js/blob/r186/manual/pages/webgpurenderer.html
- https://github.com/mrdoob/three.js/tree/r186/examples/jsm/tsl/display
- https://github.com/mrdoob/three.js/issues/33821
- https://github.com/mrdoob/three.js/issues/34600
- https://github.com/takram-design-engineering/three-geospatial
- https://github.com/pmndrs/postprocessing
- https://github.com/aiira-co/three-terrain-lod
- https://github.com/agargaro/instanced-mesh
- https://dawn.googlesource.com/dawn
- https://developer.chrome.com/blog/supercharge-web-ai-testing
- https://issues.chromium.org/issues/40540071
- https://vite.dev/blog/announcing-vite8
- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- https://aestar.tech/en/blog-en/webgpu-vs-webgl-practical-three-js-performance-test-for-complex-3d-scenes/
- https://threejs.org/examples/webgpu_tsl_procedural_terrain.html