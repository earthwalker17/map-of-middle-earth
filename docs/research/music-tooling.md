# Original code-generated soundtrack: tooling research for "Map of Middle-Earth" (verified 2026-09-29)

Versions, dates and licenses below come from the GitHub API, the PyPI JSON API and the npm registry, queried live today. Anything not confirmed is marked **[UNVERIFIED]**.

---

## 1. Code-driven composition and rendering options

| Tool | Latest version (date) | License | Windows | Offline render path | Verdict for this project |
|---|---|---|---|---|---|
| **Tone.js** | npm `latest` 15.1.22 (published 2025-04-27); `next` 15.5.44 (2026-09-27) | MIT | Runs in a browser | `Tone.Offline(cb, duration, channels=2, sampleRate)` returns a `ToneAudioBuffer`. The callback gets its own Transport, which you must `.start()` yourself. Only nodes created inside the callback are rendered. | Good for the live, interactive map music. Weak for the final score: `Tone.Sampler` has no velocity layers or round robins, and long offline renders block the main thread (issue #436), so render in chunks. https://github.com/Tonejs/Tone.js · https://tonejs.github.io/docs/15.1.22/functions/Offline.html |
| **Raw Web Audio** (`OfflineAudioContext`) | Chrome 153 / Edge | n/a | yes | `startRendering()`, plus `ConvolverNode` for reverb | Same limits as Tone.js; you build everything yourself. |
| **node-web-audio-api** (IRCAM, Rust) | 2.2.0 (2026-08-09) | BSD-3 | Prebuilt for win x64 and arm64 | Includes `examples/offline.js` and `convolution.js`, a Faust example, and `examples/tone.js` using `polyfill.js` | Lets Tone.js or Web Audio code render headless in Node without a browser. Tone.js compatibility is partial. https://github.com/ircam-ismm/node-web-audio-api |
| **SuperCollider** | 3.14.1 (2025-11-24) | GPL-3.0 | win64 `.exe` and `.zip` (~140 MB) | Non-realtime (NRT) mode: `Score.recordNRT` / `scsynth -N`. SynthDefs and buffers must be included in the score at t=0. | Very capable, but steep learning curve and no native SFZ player. https://github.com/supercollider/supercollider/releases · https://doc.sccode.org/Guides/Non-Realtime-Synthesis.html |
| **Csound** | 7.0.0-beta.17 (2026-06-19), still beta; the last 6.x stable was 6.18.1 (Nov 2022, end of life) | LGPL-2.1 | `csound-windows-7.0.0-beta.17.zip` | Render to a file with `-o out.wav`. Python bindings: `libcsound` 0.17.7 (2026-09-14). | Powerful, but no stable 7.x release and a steep curve. Not recommended. https://github.com/csound/csound/releases |
| **pyo** | 1.0.5 (2023-03-26) | LGPL-3 / GPL-3 | Wheels only for cp37–cp311 (no 3.12–3.14) | `Server(audio="offline")` + `recordOptions` | Effectively stale; it works only on your Python 3.11. Avoid. https://pypi.org/project/pyo/ |
| **DawDreamer** | 0.9.0 (2026-08-12) | GPL-3.0 | Wheels for cp311–cp314 on win_amd64 | `RenderEngine`: Faust processors (polyphonic, MIDI), `SamplerProcessor`, VST3 hosting, `add_midi_note`, `load_midi`. Tempo automation with `engine.set_bpm(np.array, ppqn=960)`. The GIL is released during render in 0.9. | **Strong for the synthesized layers** (drones, formant choir, Faust physical-model flute/brass/violin). https://github.com/DBraun/DawDreamer |
| **pedalboard** (Spotify) | 0.9.25 (2026-09-09) | GPL-3.0 | Wheels for cp310–cp315 on Windows | Built-in effects: Convolution, Reverb, Compressor, Limiter, HighpassFilter, LowpassFilter, Gain, Delay, and more. Hosts VST3 effects and instruments on Windows (`load_plugin`). | **Best mixing and mastering layer.** https://github.com/spotify/pedalboard |
| **sfizz** / `sfizz_render` | 1.2.3 (2024-01-14). Repo **archived** (read-only) on 2026-06-21. | BSD-2 / ISC (SPDX says BSD-2; the README describes ISC) | `sfizz-1.2.3-win64.zip` **does contain `bin/Release/sfizz_render.exe`** (confirmed by opening the zip) | `sfizz_render --sfz X.sfz --midi in.mid --wav out.wav -s 48000 -q <quality> -p <polyphony> [--use-eot]`. Source confirms it handles note on/off, CC and pitch bend but **ignores MIDI channel and program change**: every track goes to one SFZ. **Output is fixed at 16-bit PCM stereo.** | **Best SFZ offline renderer.** Render one MIDI file per instrument, giving stems. Keep peaks well below 0 dBFS because of the 16-bit output. It works despite the archive, but it will not get fixes. https://github.com/sfztools/sfizz · https://github.com/sfztools/sfizz/releases/tag/1.2.3 |
| **FluidSynth** (SF2/SF3) | 2.6.1 (2026-09-19) | LGPL-2.1 | `fluidsynth-v2.6.1-win10-x64-cpp11.zip` contains `bin/fluidsynth.exe` | Fast render: `fluidsynth -ni -q -F out.wav -T wav -O s24 -r 48000 -g 0.5 -R 0 -C 0 bank.sf2 in.mid` (flags checked against the man page) | Fine for SF2 sketching and General MIDI fallbacks. Not cinematic quality. https://github.com/FluidSynth/fluidsynth/releases |
| **spessasynth_core** | 4.3.22 (2026-08-24) | Apache-2.0 | Pure JS/TS | Renders SF2/SF3/DLS plus MIDI offline in Node with no Web Audio (`audioToWav`); built-in reverb and chorus | Pure-Node alternative to FluidSynth. https://github.com/spessasus/spessasynth_core |
| js-synthesizer (FluidSynth compiled to WASM) | 1.13.0 (2026-04-20) | BSD-3 | browser / Node | — | Alternative for SF2 in the browser. |

**MIDI and music-data libraries**
- Python:
  - `pretty_midi` 0.2.11.post0 (2026-07-28, MIT)
  - `mido` 1.3.3 (MIT)
  - `music21` 10.5.0 (2026-06-17, BSD-3, Python ≥3.11); heavy, but useful for scales, chords and voice-leading helpers
  - `pyfluidsynth` 1.4.0 (MIT); needs the FluidSynth DLL on PATH
  - `pyloudnorm` 0.2.0 (MIT)
- Node:
  - `@tonejs/midi` 2.0.28 (MIT; last published 2022, but stable)
  - `midi-writer-js` 3.2.1 (2026-03-01, MIT)
  - `@sfz-tools/core` 1.0.0 (CC0; SFZ parsing)
  - `smplr` 1.0.1 (MIT)

**Faust physical and vocal models** (usable from DawDreamer, node-web-audio-api or Faust WASM). Faust 2.88.0 (2026-09-09). `physmodels.lib` includes:
- `SFFormantModelFofCycle`, `SFFormantModelFofSmooth`, `SFFormantModelBP` and `formantFilterbank*`: vowel formant voices, i.e. a synthetic choir
- `fluteModel`, `brassModel`, `clarinetModel`, `violinModel`, `djembe`, `marimbaModel`

Links: https://github.com/grame-cncm/faustlibraries/blob/master/physmodels.lib

**Extra free plugins that pedalboard or DawDreamer can host on Windows:**
- Surge XT 1.3.4 (2024-08-11, GPL-3, `surge-xt-win64-1.3.4-pluginsonly.zip`) for pads, drones and Mordor rumble. https://github.com/surge-synthesizer/releases-xt
- Dragonfly Reverb 3.2.10 (2023-04-23, GPL-3, win64 zip), an algorithmic hall/room/plate/early-reflections reverb. https://github.com/michaelwillis/dragonfly-reverb

**GPL note:** the GPL covers the tools, not the audio you render with them. It only matters if you redistribute the tools.

---

## 2. Permissively licensed sample libraries

| Library | Version | License | Format | Size | URL |
|---|---|---|---|---|---|
| **VSCO 2 Community Edition** (Versilian) | SFZ 1.1.0 (on the `SFZ` branch) | **CC0-1.0** | SFZ + WAV (44.1 kHz, 16/24-bit) | ~3 GB WAV / 2.3 GB SFZ (GitHub repo ≈2.2 GB) | https://github.com/sgossner/VSCO-2-CE · https://versilian-studios.com/vsco-community/ |
| **VCSL** (Versilian Community Sample Library) | SFZ v1.2.2 | **CC0-1.0** | WAV (44.1/48 kHz, 16/24-bit) + SFZ release | Repo ≈3.8 GB; 20–75 MB per instrument; mostly 1 round robin and 2–3 velocity layers | https://github.com/sgossner/VCSL |
| **Sonatina Symphonic Orchestra (SSO)**, maintained by P. Eastman | v4.0 (2024-12-24; repo still active 2026-08) | **CC Sampling Plus 1.0** (retired by CC in 2011). Using it in music, including commercially, is allowed with attribution. Advertising use is prohibited except to promote the work itself. Redistributing the whole library is non-commercial only. | SFZ, stereo 16-bit/44.1 kHz; "Notation" and "Performance" variants | ~1.3–1.4 GB | https://github.com/peastman/sso · https://creativecommons.org/licenses/sampling+/1.0/ |
| **Virtual Playing Orchestra** | 3.3 (waves 3.2) | Free for any music, including commercial. Built from SSO (Sampling+), extra Westlund samples (CC BY-SA 3.0), No Budget Orchestra (CC BY-SA 4.0), VSCO2 (CC0), U. Iowa, Philharmonia. Repackaging is only allowed for free with credit. **Treat as attribution-required.** | SFZ; Performance scripts use CC1 = volume | 603 MB | http://virtualplaying.com/virtual-playing-orchestra/ |
| **GeneralUser GS** | v2.0.3 (License v2.0) | Custom permissive: "use … without restriction for your own music creation, private or commercial" | SF2 | ~30.7 MB | https://github.com/mrbumpy409/GeneralUser-GS |
| **FluidR3_GM** (Frank Wen) | R3 | MIT | SF2 | ~141 MB **[UNVERIFIED size]** | https://member.keymusician.com/Member/FluidR3_GM/README.html |
| **Salamander Grand Piano V3** | v3 | CC BY 3.0 | SFZ, 48 kHz/24-bit, 16 velocity layers | >1 GB | https://github.com/sfzinstruments/SalamanderGrandPiano |
| **FreePats** (SFZ repos) | various | Mostly **CC0** (timpani, tubular-bells1, ocarina1, world-percussion (incl. darbuka), synth-pad-bowed, synth-strings, sweep-pad); some GPL-2 or CC BY | SFZ | small | https://github.com/freepats · https://freepats.zenvoid.org/ |
| **Karoryfer and others on sfzinstruments** | — | **CC0**: karoryfer-bigcat.cello (solo cello), cithara-barbarica (10-string medieval lyre), Karoryfer.HorsePulse (bass tagelharpa, pizzicato), karoryfer.war-tuba, hungarian_zither, dsmolken.double-bass | SFZ | — | https://github.com/sfzinstruments |

**Instrument coverage**

| Needed | Where to get it |
|---|---|
| String sections | SSO (1st/2nd violins, violas, cellos, basses: sustain, marcato, staccato, legato, pizzicato, col legno, tremolo, harmonics; vibrato on CC21); VSCO2 (violin, viola and cello sections, solo violin, solo contrabass); VPO |
| Solo cello | SSO Solo Cello; Karoryfer/Bigcat cello (CC0) |
| Horns | SSO French Horns and Solo Horn; VSCO2 F Horn (sustain, staccato, muted) |
| Low brass | SSO Trombones, Solo Bass Trombone, Tuba; VSCO2 Tenor Trombone, Old Trombone, Tuba; Karoryfer War Tuba (CC0) |
| Choir / pads | **SSO Chorus (Mixed, Large)** is the only real sampled choir found among these free libraries (VSCO2, VCSL and VPO have none); GM "Choir Aahs" in GeneralUser/FluidR3 (lower quality); Faust formant choir; Surge XT; FreePats synth pads |
| Harp | SSO Concert Harp; VSCO2 Harp; VCSL Concert Harp and Folk Harp; cithara-barbarica lyre |
| Flute / whistle | SSO flutes, alto flute, piccolo; VSCO2 Flute and Piccolo; VCSL baroque recorders (soprano, alto, tenor, bass) and ocarinas; FreePats ocarina. **No free CC0 tin-whistle sample library found [UNVERIFIED absence]**; substitute soprano recorder, piccolo or Faust `fluteModel`. |
| Low drums | VSCO2 bass drum, timpani, gong, anvil; VCSL Bass Drum 1–3, Timpani 1–2, Gong 1–2, Tubular Bells, Anvil; SSO Timpani (hits, rolls, crescendos), Bass Drum, Tamtam. No dedicated taiko sampler found; pitch the bass drums down and layer them. |
| Frame drum / bodhran | VCSL "Frame Drum" (CC0) is the closest. Freesound bodhran packs exist (https://freesound.org/people/bosone/packs/4209/, https://freesound.org/people/pogmothoin/packs/22609/) but their **licenses are [UNVERIFIED]**; check each sound and accept CC0 or CC BY only. |
| Atmospheric extras | VCSL Wine Glasses, Bowed Psaltery, Pipe Organ, Renaissance Organ, Didgeridoo (drone), Nepalese hand bells; SSO Celeste, Crotales, Chimes |

---

## 3. Techniques for convincing cinematic scoring from samples and synths

**Reverb and impulse responses (IRs)**

Free IR sources:
- **Voxengo free IRs**: 41 IRs, 44.1 kHz/16-bit, 6.9 MB. Royalty-free for any purpose, including commercial. You may not sell the IRs themselves. Useful spaces: Musikvereinsaal, Scala Milan Opera Hall, St Nicolaes Church, Small Prehistoric Cave (Moria), Large Bottle Hall, In The Silo. https://www.voxengo.com/impulses/
- **EchoThief**: 100+ North American spaces (caves, canyons, fortresses, glaciers). The license explicitly allows "derivative work (such as convolving it with other sounds…)". https://www.echothief.com/downloads/
- **OpenAIR** (University of York): licenses are per IR, mostly Creative Commons. The site https://www.openair.hosted.york.ac.uk/ returned **"Account suspended" on 2026-09-29**, so availability is **[UNVERIFIED]**.
- **Synthetic IRs** (no license needed): stereo decorrelated noise × exp(−6.91·t/RT60), a time-varying low-pass so highs decay faster, and 20–40 ms of pre-delay.
- **Dragonfly Reverb** (VST3, algorithmic).

How to apply it:
- Use one shared hall (RT60 2.5–3.5 s for epic cues) on **sends** so all libraries sit in one space. SSO in particular comes from mixed sources and needs this.
- Vary send depth to place instruments front to back: woodwinds and harp drier, brass, percussion and choir wetter.
- Filter the reverb return: high-pass at ~150–250 Hz and low-pass at ~6–8 kHz.
- Use cues-specific spaces: a cave IR for Moria, a cathedral/church IR for Minas Tirith, and a long dark tail for Mordor.
- Tools: pedalboard `Convolution(ir_path, mix)`, or ffmpeg `afir` (the IR goes in as the second input stream).

**Orchestration and layering**
- Octave doublings: cellos plus basses at 8vb; horns in unison for heroic lines; violins in octaves for the finale.
- Pads: string sustain + horns + choir, with a Faust formant choir or Surge pad underneath for density.
- Mordor: low brass + timpani + pitched-down bass drums + anvil, plus sub-bass rumble.
- Stagger note entries by 10–40 ms, vary velocities by ±8, alternate round robins, and overlap legato notes.

**Dynamics**
- Draw CC1/CC11 curves for crescendos. SSO and VPO "Performance" instruments use CC1 as volume on long articulations.
- Pick velocity layers to match the curve.
- Use timpani and suspended-cymbal rolls, and reverse cymbal swells timed to *end* on the hit point.

**Drones**
- Open fifths in low strings or organ, a didgeridoo or tagelharpa undertone, filtered noise wind, and slow LFO on filter cutoff.

**Mood palettes, kept original.** Guardrails: never input or quote Shore melodies. Avoid his signature devices: the tin-whistle hobbit hornpipe, the solo Hardanger fiddle, the 5/4 anvil ostinato, and the "Fellowship" horn interval shapes.
- **Pastoral:** Mixolydian or Dorian; recorder, ocarina, folk harp, pizzicato, light frame drum.
- **Ancient-elven:** string harmonics, celeste, concert harp arpeggios, SSO chorus "aah", chromatic-mediant chord shifts, slow harmonic rhythm.
- **Mysterious:** low clusters, tremolo and col legno, bass clarinet, tam-tam, bowed psaltery or wine glasses, cave IR.
- **Dark Mordor:** Phrygian or Locrian, tritones, low brass, 7/8 or free-time percussion, sub rumble.
- **Epic finale:** tutti with choir, broad ~70 BPM, Lydian-colored cadence, cymbal swell into the final chord.

**Mixing and mastering for video**
- Render stems at 48 kHz, sum in float, apply a gentle bus compressor (~2:1, slow attack), then a limiter with ceiling ≤ −1 dBTP.
- **Loudness targets:**
  - −14 LUFS integrated matches the YouTube and Spotify normalization reference.
  - AES TD1008 suggests about −16 LUFS for dynamic or album material; −16 LUFS suits a dynamic cinematic score.
  - Use TP −1.0 to −1.5 dBTP and keep LRA around 8–14 LU.
  - Sources: https://aes.org/wp-content/uploads/2024/01/20210924_TD1008_v3.13.pdf · https://productionadvice.co.uk/td1008/
- **ffmpeg loudnorm, two-pass.** The ffmpeg docs confirm: `linear=true` requires all `measured_*` values, and it reverts to dynamic mode if the target LRA is below the source LRA or if the true peak would exceed TP. In dynamic mode it upsamples to 192 kHz, so set `-ar 48000`.
  - Pass 1: `ffmpeg -i mix.wav -af loudnorm=I=-14:TP=-1.5:LRA=14:print_format=json -f null -`
  - Pass 2: `ffmpeg -i mix.wav -af loudnorm=I=-14:TP=-1.5:LRA=14:measured_I=..:measured_TP=..:measured_LRA=..:measured_thresh=..:offset=..:linear=true -ar 48000 master.wav`
  - Mux: `-c:a aac -b:a 320k`
  - Better: limit in pedalboard first, so the linear pass holds.
  - Docs: https://ffmpeg.org/ffmpeg-filters.html#loudnorm
- Check the result with `pyloudnorm`.

---

## RECOMMENDED TOOLCHAIN

**1. Single source of truth: `tour.json`**, shared with the Three.js camera path and the deterministic frame-stepped video renderer (time = frame / fps). Each segment holds:
- `{id, location, t0, t1, mood, intensity keyframes [(t, 0..1)], hitPoints [{t, type: "reveal"|"titleCard"|"cut"}]}`

**2. Composer: a Python 3.14 script in a uv venv** (Python 3.11 also works).
- Packages: `pretty_midi`/`mido`, `numpy`, optionally `music21`.
- Alternatively write it in Node TypeScript with `@tonejs/midi` to stay in one language. Both are fine.
- It generates an original motif set and harmony per mood, a **tempo map**, CC1/CC11 curves from the intensity keyframes, and humanization.
- Output is **one MIDI file per instrument stem**, because `sfizz_render` merges all channels into one SFZ.
- **Tempo map, hit-point fitting:** within a section, choose BPM = 60·N_beats / (t_hit − t_start) for integer bars, or insert `set_tempo` ramps. Leave ambient sections in free time (no fixed tempo) and anchor stingers and swells at absolute seconds (swell start = t_hit − swell length).
- **Transitions:** overlap sections by 2–4 s over a common pivot pedal tone, and let reverb tails cover the joins.
- It also writes `cues.csv` for the title cards.

**3. Sample rendering: `sfizz_render.exe`** (from sfizz-1.2.3-win64.zip), called in a loop:
- `sfizz_render --sfz "SSO/.../Cellos - Performance.sfz" --midi stems/cellos.mid --wav out/cellos.wav -s 48000 -q 3 -p 256`
- It renders faster than realtime, uses only the CPU and needs no GPU. Rendering one instrument at a time keeps RAM low on the 7.6 GB machine.
- Libraries, in order of preference: **SSO v4** (core orchestra, choir, harp), **VSCO2 CE** (CC0 doubles, percussion, anvil), **VCSL** (frame drum, recorders, ocarina, folk harp, gongs, tubular bells, psaltery, glasses), Karoryfer CC0 (cello, lyre, war tuba).
- Since output is 16-bit, keep each stem's peaks around −12 dBFS by lowering CC7 or the SFZ `volume`.

**4. Synth layers: DawDreamer 0.9.0 with Faust** for the formant choir pad, drones, wind or noise beds, Mordor sub rumble, and physical-model flute or whistle. It uses the same MIDI and tempo map via `set_bpm(array, ppqn=960)`. Surge XT VST3 is optional.

**5. Mix and master: pedalboard 0.9.25.**
- Per stem: EQ, Gain, and sends.
- Reverb: Convolution with Voxengo or EchoThief IRs, or synthetic IRs, or Dragonfly Reverb VST3.
- Bus: Compressor, then Limiter.
- Export a 48 kHz float WAV.

**6. Loudness and mux:** ffmpeg two-pass `loudnorm` to I=−14 LUFS (or −16 for a more dynamic master), TP −1.5; verify with pyloudnorm; mux AAC 320k with the rendered video.

**7. Sync check:** render a click or marker track from `cues.csv` and overlay it on the video with ffmpeg, or compare onset times.

**8. Live website (optional):** Tone.js 15.1.x can play the same score data in the browser with a slimmed CC0 sample subset and a `Convolver` using a small IR. Use this only for interactive preview, not for the final video audio.

**9. Quick sketches:** FluidSynth 2.6.1 `-F` with GeneralUser GS 2.0.3, or spessasynth_core in Node, for fast auditioning before full SFZ renders.

**Pros:** everything is free and runs offline on Windows 11 with only the CPU. Rendering is deterministic and frame-accurate, and stems can be remixed. The CC0 core (VSCO2, VCSL, Karoryfer) keeps licensing simple, and the quality is the best reachable with free libraries.

**Cons and risks:**
- sfizz is archived: no fixes, 16-bit output only, MIDI channel ignored.
- SSO (Sampling+) and VPO require **credits in the video**, for example "Sonatina Symphonic Orchestra (M. Westlund / P. Eastman), CC Sampling Plus 1.0"; Salamander, if used, requires CC BY credit.
- The free choir is limited (one SSO "aah" patch); layer it with the Faust formant choir.
- There is no real tin whistle or bodhran; use recorder or frame drum substitutes.
- Samples need careful humanization and a shared reverb to avoid sounding like MIDI.
- DawDreamer and pedalboard are GPL-3. That is fine for internal rendering; it matters only if you redistribute them.

**Setup:**
- `uv venv -p 3.14`, then `uv pip install dawdreamer pedalboard pretty_midi mido numpy pyloudnorm`
- Unzip sfizz-1.2.3-win64 and fluidsynth-v2.6.1-win10-x64
- Fetch the libraries: SSO v4 from GitHub releases, and VSCO2 CE and VCSL (use the `SFZ` branch or release) with `git clone --depth 1`
- Plan for ~7 GB of disk for the libraries