"""
Score engine (S5): notes in absolute seconds → one MIDI file per stem → sfizz_render (CC0 samples) → float mix
with per-stem gain / send automation, equal-power seating, one shared synthetic hall → master (bus compressor,
limiter, −16 LUFS integrated, true peak ≤ −1.5 dBTP) → WAV + analysis (loudness, stem peaks, spectrogram).

Deterministic: humanisation comes from a hash of (stem, note index); no wall clock, no global RNG state.
"""
from __future__ import annotations

import hashlib
import json
import math
import subprocess
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import mido
import numpy as np
import pyloudnorm
import soundfile as sf
from PIL import Image, ImageDraw
from scipy.signal import butter, oaconvolve, resample_poly, sosfilt

from instruments import ORCH, ROOT

SR = 48000
SFIZZ = next(iter((ROOT / "data" / "music-src" / "sfizz").rglob("sfizz_render.exe")), None)
TPS = 1920  # MIDI ticks per second (960 ppq at 120 bpm)


def h01(*parts: object) -> float:
    """deterministic 0..1 from a key"""
    d = hashlib.blake2b("|".join(map(str, parts)).encode(), digest_size=8).digest()
    return int.from_bytes(d, "little") / 2**64


@dataclass
class Note:
    t: float
    dur: float
    pitch: int
    vel: int


@dataclass
class Score:
    duration: float
    notes: dict[str, list[Note]] = field(default_factory=lambda: defaultdict(list))
    # per stem: [(t, dB)] gain envelope (linear interpolation in dB; 0 dB when absent)
    gain: dict[str, list[tuple[float, float]]] = field(default_factory=lambda: defaultdict(list))
    # per stem: [(t, send)] hall send override envelope (absent = the instrument's send)
    send: dict[str, list[tuple[float, float]]] = field(default_factory=lambda: defaultdict(list))
    # global hall wetness envelope multiplier (caves / vast spaces)
    hall: list[tuple[float, float]] = field(default_factory=list)
    # the conductor's dynamic arc: [(t, dB)] on the whole mix (dry + hall), before the master
    arc: list[tuple[float, float]] = field(default_factory=list)
    markers: list[tuple[float, str]] = field(default_factory=list)

    def add(self, inst: str, t: float, dur: float, pitch: int, vel: int) -> None:
        o = ORCH[inst]
        while pitch < o.lo:
            pitch += 12
        while pitch > o.hi:
            pitch -= 12
        if dur <= 0.01 or t >= self.duration:
            return
        self.notes[inst].append(Note(t, dur, int(pitch), int(max(1, min(127, vel)))))

    def chord(self, inst: str, t: float, dur: float, pitches: list[int], vel: int) -> None:
        for p in pitches:
            self.add(inst, t, dur, p, vel)

    def env(self, inst: str, pts: list[tuple[float, float]]) -> None:
        self.gain[inst].extend(pts)

    def mark(self, t: float, label: str) -> None:
        self.markers.append((t, label))


# ───────────────────────────── MIDI + sfizz ─────────────────────────────

# longest single bow / breath before a sustained note is re-articulated (the samples are not looped)
SEGMENT = {"strings": 5.0, "brass": 3.8, "winds": 3.8}


def humanised(inst: str, notes: list[Note]) -> list[Note]:
    o = ORCH[inst]
    seg = SEGMENT.get(o.family) if inst not in ("harp",) and not inst.endswith(("pizz", "spic", "stac")) else None
    out = []
    for i, n in enumerate(sorted(notes, key=lambda n: (n.t, n.pitch))):
        jt = (h01(inst, i, "t") - 0.5) * 0.024  # ±12 ms
        jv = round((h01(inst, i, "v") - 0.5) * 10)  # ±5 velocity
        t = max(0.0, n.t - o.latency + jt)
        v = max(1, min(127, n.vel + jv))
        if seg and n.dur > seg * 1.15:
            # re-bow: overlapping segments (the previous one is released as the next starts), softer re-attacks
            k = math.ceil(n.dur / seg)
            step = n.dur / k
            for j in range(k):
                out.append(Note(t + j * step, step + (0.35 if j < k - 1 else 0), n.pitch, max(1, v - (6 if j else 0))))
        else:
            out.append(Note(t, n.dur, n.pitch, v))
    return out


def write_midi(notes: list[Note], path: Path, end: float) -> None:
    ev: list[tuple[int, int, mido.Message]] = []
    by_pitch: dict[int, list[Note]] = defaultdict(list)
    for n in notes:
        by_pitch[n.pitch].append(n)
    for p, ns in by_pitch.items():
        ns.sort(key=lambda n: n.t)
        for k, n in enumerate(ns):
            on = round(n.t * TPS)
            off = round((n.t + n.dur) * TPS)
            if k + 1 < len(ns):  # re-strike: release the previous one first
                off = min(off, round(ns[k + 1].t * TPS) - 1)
            off = max(off, on + 1)
            ev.append((on, 1, mido.Message("note_on", note=p, velocity=n.vel)))
            ev.append((off, 0, mido.Message("note_off", note=p, velocity=0)))
    ev.sort(key=lambda e: (e[0], e[1]))
    mf = mido.MidiFile(ticks_per_beat=960)
    tr = mido.MidiTrack()
    mf.tracks.append(tr)
    tr.append(mido.MetaMessage("set_tempo", tempo=500000, time=0))
    last = 0
    for tick, _, msg in ev:
        tr.append(msg.copy(time=tick - last))
        last = tick
    tr.append(mido.MetaMessage("end_of_track", time=max(0, round(end * TPS) - last)))
    mf.save(path)


def render_stem(inst: str, notes: list[Note], out: Path, end: float) -> Path:
    if SFIZZ is None:
        raise SystemExit("[music] sfizz_render.exe missing: run tools/music/fetch.py")
    mid = out / f"{inst}.mid"
    wav = out / f"{inst}.wav"
    write_midi(humanised(inst, notes), mid, end)
    r = subprocess.run([str(SFIZZ), "--sfz", str(ORCH[inst].sfz), "--midi", str(mid), "--wav", str(wav), "-s", str(SR), "-q", "3", "-p", "256", "--use-eot"], capture_output=True, text=True)
    if r.returncode != 0 or not wav.exists():
        raise SystemExit(f"[music] sfizz failed for {inst}: {r.stderr[-800:]}")
    return wav


def render_stems(score: Score, out: Path, workers: int = 3, tail: float = 8.0) -> dict[str, Path]:
    out.mkdir(parents=True, exist_ok=True)
    end = score.duration + tail
    jobs = {k: v for k, v in score.notes.items() if v}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {k: ex.submit(render_stem, k, v, out, end) for k, v in jobs.items()}
        return {k: f.result() for k, f in futs.items()}


# ───────────────────────────── mix + master ─────────────────────────────

def envelope(pts: list[tuple[float, float]], n: int, default: float, db: bool) -> np.ndarray:
    if not pts:
        return np.full(n, (10 ** (default / 20)) if db else default, dtype=np.float32)
    pts = sorted(pts)
    t = np.arange(n, dtype=np.float64) / SR
    v = np.interp(t, [p[0] for p in pts], [p[1] for p in pts])
    return (10 ** (v / 20)).astype(np.float32) if db else v.astype(np.float32)


def hall_ir(rt60: float = 2.9, predelay: float = 0.028, seed: int = 7) -> np.ndarray:
    """synthetic stereo hall: decorrelated noise, band-wise decay (lows long, highs short), early reflections"""
    n = int(SR * rt60 * 1.25)
    rng = np.random.default_rng(seed)
    t = np.arange(n) / SR
    ir = np.zeros((n, 2), dtype=np.float64)
    bands = [(None, 250, rt60 * 1.15), (250, 1200, rt60), (1200, 4500, rt60 * 0.72), (4500, None, rt60 * 0.42)]
    for c in range(2):
        noise = rng.standard_normal(n)
        acc = np.zeros(n)
        for lo, hi, rt in bands:
            if lo is None:
                sos = butter(4, hi, "lowpass", fs=SR, output="sos")
            elif hi is None:
                sos = butter(4, lo, "highpass", fs=SR, output="sos")
            else:
                sos = butter(4, [lo, hi], "bandpass", fs=SR, output="sos")
            acc += sosfilt(sos, noise) * np.exp(-6.91 * t / rt)
        # soft onset (diffuse build-up)
        acc *= 1 - np.exp(-t / 0.018)
        ir[:, c] = acc
    for k, (dt, g) in enumerate([(0.011, 0.5), (0.019, 0.4), (0.027, 0.33), (0.041, 0.25), (0.056, 0.2)]):
        i = int(dt * SR)
        ir[i, 0] += g * (1 if k % 2 else 0.7)
        ir[i + int(0.0013 * SR), 1] += g * (0.7 if k % 2 else 1)
    pre = int(predelay * SR)
    ir = np.vstack([np.zeros((pre, 2)), ir])
    ir /= np.sqrt(np.sum(ir**2) / 2)
    return ir.astype(np.float32)


def load(path: Path, n: int) -> np.ndarray:
    x, sr = sf.read(path, dtype="float32", always_2d=True)
    if sr != SR:
        x = resample_poly(x, SR, sr, axis=0).astype(np.float32)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    if len(x) < n:
        x = np.vstack([x, np.zeros((n - len(x), 2), dtype=np.float32)])
    return x[:n]


def true_peak_db(x: np.ndarray) -> float:
    up = resample_poly(x, 4, 1, axis=0)
    return 20 * math.log10(max(1e-9, float(np.max(np.abs(up)))))


def mix(score: Score, stems: dict[str, Path], hall_gain: float = 0.42, fade_out: tuple[float, float] | None = None) -> tuple[np.ndarray, dict]:
    n = int((score.duration + 4.0) * SR)
    dry = np.zeros((n, 2), dtype=np.float32)
    bus = np.zeros((n, 2), dtype=np.float32)
    peaks = {}
    for inst, path in stems.items():
        o = ORCH[inst]
        x = load(path, n)
        peaks[inst] = round(20 * math.log10(max(1e-9, float(np.max(np.abs(x))))), 1)
        g = envelope(score.gain.get(inst, []), n, 0.0, True) * (10 ** ((o.gain_db + calibration(inst)) / 20))
        x *= g[:, None]
        a = (o.pan + 1) * math.pi / 4  # equal-power balance of a stereo stem
        x[:, 0] *= math.cos(a) * math.sqrt(2)
        x[:, 1] *= math.sin(a) * math.sqrt(2)
        dry += x
        s = envelope(score.send.get(inst, []), n, o.send, False)
        bus += x * s[:, None]
    hall = envelope(score.hall, n, 1.0, False)
    bus *= hall[:, None]
    ir = hall_ir()
    wet = np.stack([oaconvolve(bus[:, c], ir[:, c])[:n] for c in range(2)], axis=1).astype(np.float32)
    out = dry + wet * hall_gain
    if score.arc:
        out *= envelope(score.arc, n, 0.0, True)[:, None]
    if fade_out:
        t0, t1 = fade_out
        t = np.arange(n) / SR
        f = np.clip((t1 - t) / max(1e-3, t1 - t0), 0, 1) ** 2
        out *= f[:, None].astype(np.float32)
    return out, {"stemPeaksDbfs": peaks}


def lookahead_limit(x: np.ndarray, ceiling_db: float, lookahead: float = 0.005, release: float = 0.15, block: int = 48) -> np.ndarray:
    """deterministic look-ahead peak limiter: block gains from the 4×-oversampled peak, instant attack ahead of the
    peak, exponential release, linear interpolation between block gains"""
    ceil = 10 ** (ceiling_db / 20)
    up = np.abs(resample_poly(x, 4, 1, axis=0)).max(axis=1)
    nb = int(math.ceil(len(x) / block))
    peak = np.zeros(nb)
    m = up[: (len(up) // (4 * block)) * 4 * block].reshape(-1, 4 * block).max(axis=1)
    peak[: len(m)] = m
    if len(m) < nb:
        peak[len(m):] = up[len(m) * 4 * block :].max(initial=0)
    need = np.minimum(1.0, ceil / np.maximum(peak, 1e-9))
    la = max(1, int(lookahead * SR / block))
    # look-ahead: a block's gain is the minimum over the next `la` blocks
    ahead = np.array([need[i : i + la + 1].min() for i in range(nb)])
    rel = math.exp(-block / (release * SR))
    g = np.empty(nb)
    cur = 1.0
    for i in range(nb):
        cur = ahead[i] if ahead[i] < cur else min(ahead[i], 1 - (1 - cur) * rel)
        g[i] = cur
    gs = np.interp(np.arange(len(x)) / block, np.arange(nb), g).astype(np.float32)
    return x * gs[:, None]


def glue_compress(x: np.ndarray, threshold_db: float = -24.0, ratio: float = 2.0, attack: float = 0.040, release: float = 0.300, block: int = 48) -> np.ndarray:
    """deterministic bus glue: a stereo-linked peak detector on 1 ms blocks with attack / release ballistics; above
    the threshold the gain falls by (1 − 1/ratio) dB per dB; block gains interpolated linearly to the samples"""
    nb = int(math.ceil(len(x) / block))
    pad = np.zeros((nb * block - len(x), x.shape[1]), dtype=x.dtype)
    lvl = np.abs(np.concatenate([x, pad])).reshape(nb, block, -1).max(axis=(1, 2))
    a_att = math.exp(-block / (attack * SR))
    a_rel = math.exp(-block / (release * SR))
    env = np.empty(nb)
    e = 0.0
    for i, v in enumerate(lvl):
        a = a_att if v > e else a_rel
        e = a * e + (1 - a) * v
        env[i] = e
    over = 20 * np.log10(np.maximum(env, 1e-9)) - threshold_db
    g = 10 ** (np.minimum(0.0, (1 / ratio - 1) * over) / 20)
    gs = np.interp(np.arange(len(x)) / block, np.arange(nb), g).astype(np.float32)
    return (x * gs[:, None]).astype(np.float32)


def master(x: np.ndarray, target_lufs: float = -16.0, tp_ceiling: float = -1.5) -> tuple[np.ndarray, dict]:
    """28 Hz high-pass → bus glue (gentle 2:1) → loudness to the target → look-ahead limiter at the true-peak ceiling
    → trim so the integrated loudness never exceeds the target"""
    y = sosfilt(butter(2, 28, btype="highpass", fs=SR, output="sos"), x, axis=0).astype(np.float32)
    y = glue_compress(y)
    meter = pyloudnorm.Meter(SR)
    l0 = meter.integrated_loudness(y)
    y = y * (10 ** ((target_lufs - l0) / 20))
    y = lookahead_limit(y, tp_ceiling - 0.3)
    l1 = meter.integrated_loudness(y)
    if l1 > target_lufs:
        y *= 10 ** ((target_lufs - l1) / 20)
    tp = true_peak_db(y)
    return y.astype(np.float32), {"lufs": round(float(meter.integrated_loudness(y)), 2), "truePeakDbtp": round(tp, 2), "lufsBeforeNorm": round(float(l0), 2)}


# ───────────────────────────── calibration ─────────────────────────────

CAL_FILE = ROOT / "data" / "music-src" / "calibration.json"
CAL_REF_LUFS = -20.0
_cal: dict | None = None


def _sfz_key(inst: str) -> str:
    return hashlib.blake2b(ORCH[inst].sfz.read_bytes(), digest_size=8).hexdigest()


def calibrate(insts: list[str], work: Path) -> dict:
    """render a reference phrase per instrument (sustained notes / hits at velocity 96 across its range), measure
    its gated loudness and store the gain that brings it to CAL_REF_LUFS (cached by the SFZ's content hash)"""
    global _cal
    cal = json.loads(CAL_FILE.read_text()) if CAL_FILE.exists() else {}
    todo = [i for i in insts if cal.get(i, {}).get("sfz") != _sfz_key(i)]
    if todo:
        work.mkdir(parents=True, exist_ok=True)

        def one(inst: str) -> tuple[str, float]:
            o = ORCH[inst]
            notes = []
            if o.lo == o.hi or o.family == "perc" and o.hi - o.lo < 8:
                for k in range(3):
                    notes.append(Note(0.5 + k * 3.0, 2.5, o.lo + (k % max(1, o.hi - o.lo + 1)), 96))
            else:
                span = o.hi - o.lo
                for k, f in enumerate((0.25, 0.45, 0.65)):
                    notes.append(Note(0.5 + k * 3.0, 2.5, int(o.lo + f * span), 96))
            mid = work / f"cal-{inst}.mid"
            wav = work / f"cal-{inst}.wav"
            write_midi(notes, mid, 11.0)
            subprocess.run([str(SFIZZ), "--sfz", str(o.sfz), "--midi", str(mid), "--wav", str(wav), "-s", str(SR), "-q", "3", "--use-eot"], capture_output=True)
            x = load(wav, int(11 * SR))
            l = pyloudnorm.Meter(SR).integrated_loudness(x)
            return inst, float(l)

        with ThreadPoolExecutor(max_workers=3) as ex:
            for inst, l in ex.map(one, todo):
                cal[inst] = {"sfz": _sfz_key(inst), "lufs": round(l, 2), "gainDb": round(CAL_REF_LUFS - l, 2)}
        CAL_FILE.write_text(json.dumps(cal, indent=2), encoding="utf-8")
    _cal = cal
    return cal


def calibration(inst: str) -> float:
    if _cal is None or inst not in _cal:
        raise SystemExit(f"[music] no calibration for {inst}: call calibrate() first")
    return float(_cal[inst]["gainDb"])


def section_loudness(y: np.ndarray, marks: list[tuple[float, str]], duration: float) -> list[dict]:
    meter = pyloudnorm.Meter(SR, block_size=0.4)
    out = []
    pts = sorted(marks) + [(duration, "end")]
    for (t0, lab), (t1, _) in zip(pts, pts[1:]):
        seg = y[int(t0 * SR) : int(t1 * SR)]
        if len(seg) < SR:
            continue
        try:
            l = meter.integrated_loudness(seg)
        except ValueError:
            l = float("-inf")
        out.append({"label": lab, "t0": round(t0, 2), "t1": round(t1, 2), "lufs": round(l, 1) if math.isfinite(l) else None})
    return out


def spectrogram(y: np.ndarray, path: Path, marks: list[tuple[float, str]], width: int = 2400, height: int = 520) -> None:
    mono = y.mean(axis=1)
    hop = max(1, len(mono) // width)
    win = 4096
    cols = []
    w = np.hanning(win)
    for i in range(width):
        s = i * hop
        seg = mono[s : s + win]
        if len(seg) < win:
            seg = np.pad(seg, (0, win - len(seg)))
        cols.append(np.abs(np.fft.rfft(seg * w)))
    S = np.array(cols).T / (win / 4)  # freq × time, ≈ dBFS for a full-scale sine
    f = np.fft.rfftfreq(win, 1 / SR)
    rows = np.geomspace(30, 16000, height)
    idx = np.searchsorted(f, rows)
    img = 20 * np.log10(S[np.clip(idx, 0, len(f) - 1)] + 1e-7)
    img = np.clip((img + 96) / 84, 0, 1)[::-1]
    rgb = np.stack([img**0.8 * 255, img**1.6 * 200, img**3 * 120], axis=-1).astype(np.uint8)
    im = Image.fromarray(rgb)
    d = ImageDraw.Draw(im)
    dur = len(mono) / SR
    for t, lab in marks:
        x = int(t / dur * width)
        d.line([(x, 0), (x, height)], fill=(90, 160, 255), width=1)
        d.text((x + 3, 3), lab, fill=(220, 230, 255))
    im.save(path)


def write_outputs(out: Path, y: np.ndarray, report: dict, score: Score) -> None:
    sf.write(out / "master.wav", y, SR, subtype="PCM_24")
    spectrogram(y, out / "spectrogram.png", score.markers)
    report["sections"] = section_loudness(y, score.markers, score.duration)
    report["durationS"] = round(len(y) / SR, 3)
    (out / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
