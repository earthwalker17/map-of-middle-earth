"""
Render the score (S5):  pnpm music --cues <cues.json> [--out renders/music/<dir>] [--from s --to s]

cues.json: the film's cue sheet — `node --import tsx tools/check/film.ts --cues <file>` ({film, sections, cues, hits};
event ramps are read from data/tour/timeline.json), or the draft format {duration, beats, events}. Output: stems/*.wav (+ .mid),
master.wav (48 kHz, 24-bit, −16 LUFS, ≤ −1.5 dBTP), spectrogram.png (section markers), report.json.
Deterministic for a given cue sheet, score code and sample set.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from engine import calibrate, master, mix, render_stems, write_outputs  # noqa: E402
from instruments import ROOT, write_perc_maps  # noqa: E402
from journey import compose  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cues", required=True)
    ap.add_argument("--out")
    ap.add_argument("--label", default="")
    ap.add_argument("--from", dest="t_from", type=float)
    ap.add_argument("--to", dest="t_to", type=float)
    a = ap.parse_args()
    cues = json.loads(Path(a.cues).read_text(encoding="utf-8"))
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = Path(a.out) if a.out else ROOT / "renders" / "music" / f"{stamp}{'-' + a.label if a.label else ''}"
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    write_perc_maps()
    score = compose(cues)
    if a.t_from is not None or a.t_to is not None:  # a window (sketches): drop notes outside it
        lo = a.t_from or 0.0
        hi = a.t_to or score.duration
        for k in list(score.notes):
            score.notes[k] = [n for n in score.notes[k] if lo - 8 <= n.t < hi]
    used = [k for k, v in score.notes.items() if v]
    calibrate(used, ROOT / "data" / "music-src" / "cal")
    stems = render_stems(score, out / "stems")
    t1 = time.time()
    end_fade = None
    fade = [b for b in cues.get("beats") or cues.get("cues") or [] if b["id"] == "end"]
    if fade:
        end_fade = (score.duration - 2.2, score.duration)
    y, rep = mix(score, stems, fade_out=end_fade)
    y = y[: int(score.duration * 48000)]
    if a.t_from is not None or a.t_to is not None:
        y = y[int((a.t_from or 0) * 48000) : int((a.t_to or score.duration) * 48000)]
        score.markers = [(t - (a.t_from or 0), m) for t, m in score.markers if (a.t_from or 0) <= t < (a.t_to or score.duration)]
    y, m = master(y)
    rep.update(m)
    film = cues.get("film", {})  # the film's CueSheet (tools/check/film.ts --cues) or the draft exporter's sheet
    rep["cues"] = {"file": str(a.cues), "duration": cues.get("duration", film.get("duration")), "hash": cues.get("hash", film.get("hash"))}
    rep["notes"] = {k: len(v) for k, v in score.notes.items() if v}
    write_outputs(out, y, rep, score)
    print(f"[music] {len(stems)} stems in {t1 - t0:.0f} s, mix + master {time.time() - t1:.0f} s → {out}")
    print(f"[music] {rep['lufs']} LUFS, true peak {rep['truePeakDbtp']} dBTP, {rep['durationS']} s")


if __name__ == "__main__":
    main()
