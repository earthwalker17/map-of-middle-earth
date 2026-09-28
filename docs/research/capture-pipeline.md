# Research report: deterministic offline capture of a Three.js WebGPU scene to video on Windows (for "Map of Middle-Earth")

## 0. Facts probed on this machine (read-only, 2026-09-28/29)

- **Chrome:** 153.0.8010.54 is installed. Playwright has cached `chromium-1208/1223/1228` and `chromium_headless_shell-*`.
- **GPU driver:** Intel UHD 31.0.101.2125 (dated 2023-05-24). Ice Lake is on Intel's legacy driver branch. The newest legacy driver is about 31.0.101.2145 (**not verified**): https://www.intel.com/content/www/us/en/download/776137/intel-7th-10th-gen-processor-graphics-windows.html. **Update the driver before any WebGPU work.**
- **RAM:** 2×4 GB at 3733 in dual channel, so the iGPU has decent memory bandwidth. Windows reports AdapterRAM = 1 GB.
- **Display:** 1536×1024, which is smaller than 1080p. Render resolution must therefore be set independently of window size.
- **Disk: C: has only 33.7 GB free.** This is the hard limit on lossless intermediates.
- **ffmpeg:** 8.0.1 (gyan full build). It has libx264, libx264rgb, libx265, libsvtav1, ffv1, prores_ks, utvideo, zscale, libplacebo, loudnorm-capable filters, and `h264_qsv`/`hevc_qsv`/`vp9_qsv`. `h264_qsv` and `hevc_qsv` encoded successfully in the benchmark. `av1_qsv` is listed, but Ice Lake has no AV1 hardware encode.
- **Encode benchmarks at 1080p** (synthetic testsrc2 with light noise, output to `-f null`; real rendered footage will differ):

| Encoder / settings | Speed | Size per frame |
|---|---|---|
| ffv1 bgr0, slices 16 (lossless) | ~20 fps | 0.23–1.6 MB |
| libx264rgb qp0 veryfast (lossless) | ~9.4 fps | not measured |
| prores_ks HQ, 10-bit 4:2:2 | ~6.5 fps | 0.31–0.94 MB |
| libx264 slow, CRF 16, 8-bit | ~3.4 fps | ~50 KB |
| libx265 slow, CRF 18, 10-bit | ~2.0 fps | not measured |
| SVT-AV1 preset 6, 10-bit | ~6.2 fps | not measured |
| SVT-AV1 preset 4, 10-bit | ~3.8 fps | not measured |
| hevc_qsv p010 slow | ~38 fps | not measured |
| h264_qsv slow | ~62 fps | not measured |

## 1. Driving Chrome (Playwright, real GPU, WebGPU)

**Which browser to launch**
- Use Playwright `chromium.launch({channel:'chrome'})` (the installed Chrome 153) or `channel:'chromium'`. Both run "new headless", which is the real Chrome.
- Playwright's default headless Chromium is `chromium-headless-shell`, the old headless mode. Avoid it for WebGPU. https://playwright.dev/docs/browsers
- The old headless mode was removed from the Chrome binary in Chrome 132 and now exists only as `chrome-headless-shell`. https://developer.chrome.com/blog/removing-headless-old-from-chrome , https://developer.chrome.com/docs/chromium/headless

**Headless screenshots of a WebGPU canvas come back black on Windows and Linux**
- The WebGPU canvas never reaches the headless compositor, so `Page.captureScreenshot` returns black. Rendering itself still works and can be confirmed by pixel readback. No flag combination is known to fix this. https://agent-browser.dev/webgpu , https://github.com/aelefebv/lucida/issues/1098 (Chrome 153).
- **Consequence:** never capture with screenshots. Read pixels back from the canvas or a render target instead.
- **Default choice:** run headed (`headless:false`) on the logged-in desktop. It is the most robust option, and it is fine because readback works regardless of window size.
- Headless `channel:'chrome'` is an option only after a smoke test passes.

**Flags for Windows**
- `--enable-unsafe-webgpu`: harmless on Windows, where WebGPU has shipped by default since Chrome 113. Headless is often reported not to expose WebGPU without it.
- `--ignore-gpu-blocklist`
- `--use-angle=d3d11`: already the Windows default. It affects WebGL and the compositor only; WebGPU uses Dawn on D3D12.
- `--disable-features=CalculateNativeWinOcclusion` and `--disable-backgrounding-occluded-windows`: without these, a covered window stops rendering. https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md
- `--disable-renderer-backgrounding` and `--disable-background-timer-throttling`: Playwright already adds these, plus `--force-color-profile=srgb`. https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts
- `--force-device-scale-factor=1`
- Optional: `--enable-webgpu-developer-features`. This exposes `adapter.info.backend` ("D3D12"), `driver`, and `memoryHeaps`. https://developer.chrome.com/docs/web-platform/webgpu/developer-features

**Flags not to use on Windows**
- `--use-angle=vulkan`, `--enable-features=Vulkan`, `--use-webgpu-adapter=swiftshader`: these are Linux/Colab recipes. https://developer.chrome.com/blog/supercharge-web-ai-testing
- `--disable-gpu`
- `--use-webgpu-adapter=d3d11` is an experimental D3D11 path (per Chrome 115 notes). Use it only as a fallback experiment. https://developer.chrome.com/blog/new-in-webgpu-115

**Checking that the real GPU is in use**
1. `const a = await navigator.gpu.requestAdapter()`. Fail hard if it is `null`.
2. Check `a.info.vendor` (expect `intel`) and `a.info.architecture`. Fail on `a.info.isFallbackAdapter` (the version on `GPUAdapter` itself is deprecated since Chrome 138): https://developer.chrome.com/blog/new-in-webgpu-138
3. Assert `renderer.backend.isWebGPUBackend === true`. three.js silently falls back to WebGL2, and Playwright always adds `--enable-unsafe-swiftshader`, so a silent fallback could end up software-rendered via SwiftShader.
4. Optionally load `chrome://gpu` and scrape for "WebGPU: Hardware accelerated". https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips

**Pitfalls**
- **Device lost from Windows TDR.** The default `TdrDelay` is 2 s: https://learn.microsoft.com/en-us/windows-hardware/drivers/display/tdr-registry-keys. Keep each submit well under 1 s on the UHD G1, which sub-frame accumulation does naturally. Handle `device.lost` by aborting and resuming.
- **`preserveDrawingBuffer` does not apply to WebGPU.** Per the gpuweb design, reading a canvas snapshots the current texture if `getCurrentTexture()` was called since the last present, otherwise the last presented frame. https://github.com/gpuweb/gpuweb/issues/1781 , https://github.com/gpuweb/gpuweb/issues/2743. Snapshot synchronously right after rendering (`new VideoFrame(canvas)`).
- **Canvas format.** It may be `bgra8unorm` rather than `rgba8unorm` (https://developer.mozilla.org/en-US/docs/Web/API/GPU/getPreferredCanvasFormat). Check `VideoFrame.format`, or request `copyTo({format:'RGBA'})`.
- **Texture size.** WebGPU's default `maxTextureDimension2D` is 8192. Request more through `requiredLimits` if needed.
- **Memory.** The iGPU shares 7.6 GB with Chrome, Node and ffmpeg. Stream frames and never buffer many.
- **`renderAsync()`** has been deprecated since three r181. Call `await renderer.init()` and use `render()`. https://threejs.org/manual/en/webgpurenderer.html
- **Version:** latest three.js on npm is 0.186.1.

## 2. Deterministic time

**Use an explicit app-level clock (recommended)**
- Compute time as `t = shotStart + frameIndex/fps + subframeOffset`. Every system reads this clock: water, lava, smoke, Eye scan, clouds, day-night, route line, camera spline.
- Use a seeded PRNG (e.g. mulberry32) instead of `Math.random`.
- Step particles and physics in fixed substeps.
- Call `AnimationMixer.update(dt)` with explicit `dt`.
- Remove `setAnimationLoop` in capture mode.
- **Verified three.js trap:** the TSL `time`/`deltaTime` nodes come from `NodeFrame.update()`, which uses `performance.now()`. Source: https://raw.githubusercontent.com/mrdoob/three.js/dev/src/nodes/core/NodeFrame.js. Use your own `uniform()` fed by the sim clock instead. `THREE.Timer` and `THREE.Clock` are also wall-clock based.
- Safety net: a timeweb-style `page.addInitScript` that overrides `performance.now`, `Date.now` and rAF in capture mode.

**timecut / timesnap**
- These override `Date`, `performance.now`, rAF and timers onto a virtual timeline. They have a canvas-capture mode and pipe to ffmpeg. CSS animations are not handled.
- Last npm version is about 0.3.3 and the tools are Puppeteer/WebGL-era, not WebGPU-aware. Borrow the idea only.
- https://github.com/tungs/timecut , https://www.npmjs.com/package/timesnap

**CDP virtual time**
- `Emulation.setVirtualTimePolicy` is experimental. Policies are `advance`, `pause` and `pauseIfNetworkFetchesPending`, with an optional `budget` that fires `virtualTimeBudgetExpired`. https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Emulation.pdl
- It controls JS timer scheduling, not GPU completion. Async WebGPU calls (`mapAsync`, `onSubmittedWorkDone`) and asset decoding can starve or deadlock under it.

**CDP `HeadlessExperimental.beginFrame`**
- It is headless-only. It needs a target created with `enableBeginFrameControl` and `--run-all-compositor-stages-before-draw`. https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/HeadlessExperimental.pdl
- In practice it belongs to headless-shell (**not verified** for new headless), and on Windows that path cannot present WebGPU.

**Why the app clock wins:** it does not depend on browser internals, works headed or headless, allows random access to any frame (needed for resume), supports sub-frame times for motion blur, and the same code drives live preview scrubbing.

## 3. Getting frames out

**A. `canvas.toBlob` PNG, then Node via `exposeFunction`**
- PNG is encoded on the CPU, roughly 100–300 ms per 1080p frame (**estimate**).
- `exposeFunction` payloads are JSON, so binary data must be base64 (+33%).
- Acceptable for stills only.

**B. Raw pixels, then Node, then ffmpeg stdin (recommended master path)**
- Page side: `new VideoFrame(canvas)` then `copyTo(buf,{format:'RGBA'})`. RGB conversion in `copyTo` shipped via a blink-dev Intent to Implement and Ship: https://groups.google.com/a/chromium.org/g/blink-dev/c/4ZyzUn4meaY. Alternative: `renderer.readRenderTargetPixelsAsync`; its blank-data bug was fixed in r180 (https://github.com/mrdoob/three.js/issues/31658).
- Transfer: same-origin `fetch(POST, body: Uint8Array)` to the Node CLI's HTTP server, which writes into `ffmpeg -f rawvideo` stdin and honours backpressure.
- Frame sizes: 1080p = 8.3 MB, 1440p = 14.7 MB. Loopback transfer is negligible next to render time.
- Lossless, full control over matrix and tags, and 16-bit is possible by reading back an RGBA16F render target as `rgb48le`.

**C. In-browser WebCodecs via Mediabunny (fast previews/dailies)**
- Mediabunny 1.60.0, MPL-2.0: https://github.com/Vanilagy/mediabunny. `mp4-muxer` and `webm-muxer` are deprecated in favour of it: https://vanilagy.github.io/mp4-muxer/
- API: `new CanvasSource(canvas,{codec:'avc'|'hevc'|'vp9', quality:new Quality('high'), hardwareAcceleration, keyFrameInterval})`, then `await src.add(ts, dur)`, which provides backpressure. Output goes to `StreamTarget` (`chunked`, 16 MiB default) in MP4/MOV/MKV/WebM with `fastStart:'fragmented'|'reserve'`. https://mediabunny.dev/guide/writing-media-files , https://mediabunny.dev/api/StreamTargetOptions
- Ice Lake Quick Sync encodes H.264, HEVC (8/10-bit) and VP9, but not AV1. https://en.wikipedia.org/wiki/Ice_Lake_(microprocessor)
- WebCodecs HEVC encode on Windows needs Chrome ≥130 with hardware support. https://github.com/StaZhu/enable-chromium-hevc-hardware-decoding
- Per-frame QP is available via `bitrateMode:'quantizer'`. https://groups.google.com/a/chromium.org/g/blink-dev/c/UZWH1LuwBas
- Downsides: lossy only, and effectively 8-bit 4:2:0 (10-bit in Chrome WebCodecs is **not verified**). The colour tag written for canvas frames is **not verified**, so run `ffprobe` on the output.
- 4K limits of the software fallback encoder are **not verified**. Probe with `VideoEncoder.isConfigSupported`.

**Quality ladder**
- Mezzanine per shot: FFV1 `bgr0` (lossless), or ProRes 422 HQ 10-bit when disk is short.
- Final outputs:
  - H.264 High, 8-bit 4:2:0, CRF 14–18, preset slow: for compatibility and YouTube.
  - HEVC Main10 (x265 CRF 16–18) or SVT-AV1 10-bit (CRF 20–24): master/archive. 10-bit reduces banding in sky and fog. Also dither before 8-bit quantisation in the final blit.
- YouTube spec: MP4 with faststart, H.264 High, 4:2:0, closed GOP, 2 B-frames, BT.709, audio AAC-LC or Opus at 48 kHz. Suggested bitrates: 1080p 8 Mbps, 1440p 16 Mbps. https://support.google.com/youtube/answer/1722171

**Colour**
- Treat the sRGB-encoded canvas output as BT.709 and pass the values through without a transfer conversion (common screen-capture convention).
- Convert RGB to YUV with an explicit `scale=out_color_matrix=bt709:out_range=tv`. Otherwise ffmpeg uses BT.601 and colours shift. https://forum.videohelp.com/threads/380991-ffmpeg-x264-RGB-to-YUV
- Tag the output: `-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv`.

## 4. Supersampling and temporal accumulation

**Recommended: jittered accumulation at native resolution**
- Take N sub-frames per output frame. Each gets a Halton(2,3) sub-pixel jitter (`camera.setViewOffset` or projection jitter) and a sub-frame time spread across the shutter. A 180° shutter spans 0.5/fps.
- This gives anti-aliasing and true motion blur in one loop, with flat memory use.
- Accumulate into an RGBA16F target as a running average (weight 1/(s+1)).
- Average after tone mapping and before the sRGB/dither output. This avoids HDR fireflies dominating edges; linear averaging is more physically correct but noisier. This is a trade-off, not a verified best practice.
- Suggested N: 4 for drafts, 8–16 for finals.

**Built-in three.js options**
- `SSAAPassNode` (`three/addons/tsl/display/SSAAPassNode.js`, 2^sampleLevel samples, unbiased option) gives spatial AA only. https://threejs.org/docs/pages/SSAAPassNode.html , https://threejs.org/examples/webgpu_postprocessing_ssaa.html
- Disable TRAA/TAA in capture mode, or give every shot pre-roll frames. Otherwise history differs between sequential and resumed renders.

**Rendering at 2× and downsampling**
- Costs 4× the pixel work and 4× the render-target memory. 3840×2160 RGBA16F is about 66 MB per buffer, times many post buffers. Borderline for 1080p output; impractical at 1440p (5120×2880) on this iGPU.
- If used, do the resolve in the renderer. Downscaling in ffmpeg happens in gamma space.

**Progressive effects (render until converged)**
- Re-seed blue noise per sub-frame for AO, volumetric fog/clouds and PCF shadows so accumulation denoises them.
- Optionally loop until the mean delta is below ε or N reaches its maximum.
- Force per-sub-frame updates of shadow cascades, impostors and LOD, with no time-slicing.
- Wait for assets, `renderer.compileAsync(scene,camera)` and `document.fonts.ready` before frame 0 of each shot.

## 5. Audio

**Rendering**
- Render the same procedural graph in `new OfflineAudioContext({numberOfChannels:2, sampleRate:48000, length: totalFrames*48000/fps})`.
- Schedule every cue from the same `timeline.json` that drives the video, and use a seeded PRNG. AudioWorklet works offline.
- 8 minutes of stereo float32 is about 184 MB, which is fine. Otherwise chunk with `suspend()` or render per-cue stems. https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext
- Browser-free alternative: `node-web-audio-api` (IRCAM, Rust, has Windows x64 builds). https://github.com/ircam-ismm/node-web-audio-api

**Export and sync**
- Encode the buffer to WAV (float32 or 24-bit) in the page and POST it to Node.
- Sync is exact: frame i is at time i/fps, and 48000/24 = 2000, 48000/30 = 1600, 48000/60 = 800 samples per frame.
- Force the audio length to frames/fps with `atrim`/`apad`, and pass `-t` at mux time.

**Loudness and codec**
- Two-pass `loudnorm` to I=-14 LUFS, TP=-1 dBTP. The -14 LUFS figure is a commonly reported YouTube target, not officially documented.
- Final audio: AAC-LC 320k at 48 kHz in MP4. Master: FLAC or PCM in MKV/MOV.

## 6. Throughput estimates (UHD G1, 32 EU, ~0.5 TFLOPS FP32) — **all rendering figures are estimates; confirm with a benchmark shot**

Assumed sub-frame cost at "offline quality" (PBR terrain, shadow cascades, fog/clouds, post): about 80–200 ms at 1080p and 140–350 ms at 1440p. Readback plus POST plus FFV1 adds about 30–60 ms, largely overlapped.

| Resolution | spp 1 | spp 4 | spp 8 | 8-min film at 24 fps (11,520 frames), spp 8 |
|---|---|---|---|---|
| 1080p | ~5–10 fps | ~1.2–3 fps | ~0.6–1.5 fps | ~2–5.5 h |
| 1440p | ~3–6 fps | ~0.7–1.8 fps | ~0.35–0.9 fps | ~3.5–9 h |

- **Final encodes (1080p, measured speeds):** x264 slow ≈ 55 min, x265 slow 10-bit ≈ 1.6 h, SVT-AV1 preset 6 ≈ 30 min. Multiply by about 1.8 for 1440p.
- **Disk:** FFV1 at 1080p comes to about 3–18 GB for the film; at 1440p up to ~33 GB, which exceeds the free space. Use ProRes HQ for 1440p, use an external drive, or delete shot mezzanines after the final encode.
- **Thermals:** the laptop has a 15 W budget. Run plugged in, in best-performance mode, with resume support.

# RECOMMENDED PIPELINE

**Components**
1. **`timeline.json`** is the single source of truth: fps, resolution, shots (start/end, camera spline ids, route-line progress), title cards and audio cues.
2. **The app (Vite + three WebGPURenderer)** has a `?capture=1` mode that exposes `window.__mm`:
   - `init(cfg)`: checks the adapter, disables TRAA, stops the animation loop.
   - `loadShot(id)`: awaits assets, `compileAsync` and fonts.
   - `renderFrame(i)`: runs the sub-frame loop, draws the final blit to the canvas, takes a `VideoFrame` snapshot, calls `copyTo(RGBA)` and POSTs the bytes.
   - `renderAudio()`: returns the WAV.
   - Title cards are drawn in-app (2D canvas texture in the final blit) so they are captured and deterministic. Alternative: HTML cards screenshotted by Playwright with `omitBackground:true` (screenshots are fine for DOM without WebGPU) and overlaid in ffmpeg.
3. **`tools/render.mjs`** is the Node CLI. It serves `dist/` and a `/__frame` endpoint on the same origin (no CORS), launches Playwright, spawns one ffmpeg per shot, and writes to ffmpeg stdin with drain-based backpressure. It shows progress and ETA, and resumes by skipping finished shots after checking their frame count with `ffprobe`.
4. **`tools/finalize.mjs`** concatenates shots, runs loudnorm, muxes audio and produces the final encodes.

CLI shape:
`node tools/render.mjs --timeline timeline.json --shots 1-12 --res 1920x1080 --fps 24 --spp 8 --shutter 0.5 --mezz ffv1|prores --headed --resume --out renders/`

**Launch sketch**
```js
const browser = await chromium.launch({ channel:'chrome', headless:false, args:[
 '--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=d3d11','--force-device-scale-factor=1',
 '--disable-features=CalculateNativeWinOcclusion','--disable-backgrounding-occluded-windows',
 '--disable-renderer-backgrounding','--disable-background-timer-throttling']});
const page = await browser.newPage({ viewport:{width:1280,height:720}, deviceScaleFactor:1 });
// the canvas backing store is set to 1920x1080 in-app; renderer.setPixelRatio(1); setSize(W,H,false)
```

**Pre-flight tests**
1. The adapter is Intel and the backend is WebGPU.
2. A test frame's pixel variance is above 0; black means failure.
3. Determinism: frame K rendered by jumping straight to it matches frame K rendered sequentially (hash or PSNR).

**ffmpeg commands**
```bash
# (1) per-shot lossless mezzanine (spawned by render.mjs; stdin = raw RGBA)
ffmpeg -hide_banner -y -f rawvideo -pix_fmt rgba -s 1920x1080 -framerate 24 -i pipe:0 \
  -c:v ffv1 -level 3 -g 1 -slices 16 -slicecrc 1 -pix_fmt bgr0 \
  -color_primaries bt709 -color_trc iec61966-2-1 -colorspace rgb renders/shot_012.mkv
# disk-constrained alternative (10-bit 4:2:2, visually lossless)
#  ... -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv422p10le" -c:v prores_ks -profile:v 3 \
#      -color_primaries bt709 -color_trc bt709 -colorspace bt709 renders/shot_012.mov
# fast draft: -vf "scale=out_color_matrix=bt709:out_range=tv,format=p010le" -c:v hevc_qsv -preset slow -global_quality 20

# (2) concatenate shots (list file: file 'shot_001.mkv' ...)
ffmpeg -f concat -safe 0 -i renders/shots.txt -c copy renders/master_video.mkv

# (3) audio: two-pass loudnorm (pass 1 measures, pass 2 applies measured_* values), exact length
ffmpeg -i soundtrack.wav -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null -
ffmpeg -i soundtrack.wav -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=..:measured_TP=..:measured_LRA=..:measured_thresh=..:linear=true,apad" \
  -t 480.0 -ar 48000 -c:a pcm_s24le soundtrack_norm.wav

# (4a) delivery / YouTube: H.264 8-bit BT.709
ffmpeg -i renders/master_video.mkv -i soundtrack_norm.wav -map 0:v -map 1:a \
  -vf "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p" \
  -c:v libx264 -preset slow -crf 16 -profile:v high -bf 2 -g 48 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv \
  -c:a aac -b:a 320k -ar 48000 -shortest -movflags +faststart journey_1080p_h264.mp4

# (4b) master: HEVC Main10
ffmpeg -i renders/master_video.mkv -i soundtrack_norm.wav -map 0:v -map 1:a \
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p10le" \
  -c:v libx265 -preset slow -crf 16 -tag:v hvc1 \
  -x265-params "colorprim=bt709:transfer=bt709:colormatrix=bt709:range=limited" \
  -c:a aac -b:a 320k -shortest -movflags +faststart journey_1080p_hevc10.mp4

# (4c) AV1 10-bit alternative
#  -vf "...format=yuv420p10le" -c:v libsvtav1 -preset 4 -crf 20 -svtav1-params tune=0 ...
```

**Settings to start with**
- Frame rate: 24 fps with a 180° shutter gives the film look; 30 fps looks smoother on pans.
- Drafts: spp 4, hevc_qsv, in-browser Mediabunny allowed.
- Finals: spp 8–16, FFV1 or ProRes mezzanine, then the ffmpeg encodes above.
- Resolution: finish at 1080p first. 1440p roughly doubles render time and disk use; the commonly repeated claim that 1440p uploads get better YouTube encodes is **not verified**.

**Not verified; test on this machine**
- WebGPU on Windows headless new mode with real D3D12 (readback should work; screenshots will not).
- `adapter.info.architecture` string values.
- WebCodecs 10-bit and 4K software limits.
- The exact latest Intel legacy driver version.
- Whether `beginFrame` works in new headless.
- All render-throughput numbers.