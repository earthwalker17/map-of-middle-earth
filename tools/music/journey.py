"""
"Journey Through Middle-Earth" — the original score, written as code (S5).

Every section reads its times from the film's cue sheet (beat start / end, holds = arrivals, event ramps), so the
music follows the picture when the timeline is re-timed. Material (all original; none of Howard Shore's devices —
no tin whistle, no Hardanger fiddle, no 5/4 anvil ostinato):
  - the JOURNEY THEME in D: a rising fourth, a stepwise climb with a turn, a longing reach to the sixth;
  - its variants: pastoral (Shire, flute), elven (Rivendell / Lórien, flute + harp, chromatic-mediant colour),
    minor (Doom, low brass), full (finale, horns + strings, Lydian cadence);
  - section material: the road ostinato (D Dorian), Moria (C minor, heartbeat drum), Isengard (G Phrygian
    ostinato, sparse anvil), the Rohan horn call (open fifths, Aeolian), the Argonath reveal (tutti D major),
    the Black Gate (E Phrygian), Ithilien (oboe), Gondor (B♭ brass chorale + beacon call), Morgul (tritone
    clusters, beam stinger), Doom (tutti D minor).
Velocities: pp 34 · p 48 · mp 62 · mf 78 · f 98 · ff 116.
"""
from __future__ import annotations

from engine import Score

PP, P, MP, MF, F, FF = 34, 48, 62, 78, 98, 116

_NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def n(name: str) -> int:
    """'F#4' / 'Bb2' / 'C5' → MIDI (C4 = 60)"""
    k = _NOTE[name[0]]
    i = 1
    while i < len(name) and name[i] in "#b":
        k += 1 if name[i] == "#" else -1
        i += 1
    return k + 12 * (int(name[i:]) + 1)


def ns(names: str) -> list[int]:
    return [n(x) for x in names.split()]


# the journey theme (D major) as (note, beats); phrase A ends on the dominant, phrase B home
THEME_A = [("A3", 1), ("D4", 1), ("E4", 2), ("F#4", 1.5), ("G4", 0.5), ("F#4", 1), ("E4", 1), ("D4", 1), ("B3", 1), ("D4", 2), ("A3", 4)]
THEME_B = [("A3", 1), ("D4", 1), ("E4", 2), ("F#4", 1.5), ("A4", 0.5), ("B4", 2), ("A4", 1), ("F#4", 1), ("E4", 1.5), ("D4", 0.5), ("D4", 4)]
MOTIF = [("A3", 1), ("D4", 1), ("E4", 1), ("F#4", 1)]


def transpose(mel: list[tuple[str, float]], semis: int) -> list[tuple[int, float]]:
    return [(n(p) + semis, b) for p, b in mel]


class Cues:
    """beats from the film cue sheet: {id, kind, style, t0, t1, music{mood, intensity, hit}} + event keys"""

    def __init__(self, data: dict):
        self.duration = float(data["duration"])
        self.beats = data["beats"]
        self.by = {b["id"]: b for b in self.beats}
        self.events = data.get("events", {})

    def t0(self, beat: str) -> float:
        return float(self.by[beat]["t0"])

    def t1(self, beat: str) -> float:
        return float(self.by[beat]["t1"])

    def event_ramp(self, ch: str) -> tuple[float, float]:
        """first rise of an event channel: (start of the ramp, end of the ramp)"""
        ks = sorted(self.events.get(ch, []))
        for (ta, va), (tb, vb) in zip(ks, ks[1:]):
            if vb > va:
                return float(ta), float(tb)
        return (ks[0][0], ks[0][0]) if ks else (0.0, 0.0)


class Grid:
    """a metric grid: beat b → seconds"""

    def __init__(self, t0: float, bpm: float):
        self.t0 = t0
        self.bpm = bpm
        self.q = 60.0 / bpm

    def at(self, beat: float) -> float:
        return self.t0 + beat * self.q

    @staticmethod
    def fit(t0: float, t1: float, beats: int) -> "Grid":
        return Grid(t0, 60.0 * beats / max(0.1, t1 - t0))


# ───────────────────────────── helpers ─────────────────────────────


def line(S: Score, inst: str, g: Grid, start: float, mel, vel: int, legato: float = 1.02, cresc: int = 0) -> float:
    """a melody [(note, beats)] from beat `start`; returns the beat after it"""
    b = start
    for i, (p, beats) in enumerate(mel):
        pitch = n(p) if isinstance(p, str) else p
        v = vel + round(cresc * i / max(1, len(mel) - 1))
        S.add(inst, g.at(b), beats * g.q * legato, pitch, v)
        b += beats
    return b


def pad(S: Score, t0: float, t1: float, voicing: dict[str, str], vel: int) -> None:
    """sustained chord: {instrument: 'note names'}"""
    for inst, names in voicing.items():
        S.chord(inst, t0, t1 - t0, ns(names), vel)


def arp(S: Score, inst: str, t0: float, t1: float, names: str, step: float, vel: int, ring: float = 2.5, pattern: str = "updown") -> None:
    ps = ns(names)
    seq = ps + ps[-2:0:-1] if pattern == "updown" else ps
    t = t0
    k = 0
    while t < t1 - 1e-6:
        S.add(inst, t, ring, seq[k % len(seq)], vel - (4 if k % 2 else 0))
        t += step
        k += 1


def swell(S: Score, t_peak: float, vel: int = 100, long: bool = True) -> None:
    """suspended-cymbal crescendo peaking at t_peak (Long peaks 7.42 s in, Median 3.73 s)"""
    lead = 7.42 if long else 3.73
    if t_peak - lead >= 0:
        S.add("cym", t_peak - lead, lead + 1.5, 48 if long else 49, vel)


def roll(S: Score, t0: float, t1: float, pitch: str, v0: int, v1: int) -> None:
    """timpani roll crescendo (gain ramp over the roll)"""
    S.add("timp_roll", t0, t1 - t0 + 0.3, n(pitch), v1)
    S.env("timp_roll", [(t0 - 0.02, 0), (t0, -20 + 20 * v0 / max(1, v1)), (t1, 0)])


def hit(S: Score, t: float, gong: int = 0, bd: int = 0, crash: int = 0, timp: str | None = None, tv: int = F) -> None:
    if gong:
        S.add("gong", t - 0.12, 6.0, 40, gong)
    if bd:
        S.add("bd", t, 3.0, 36, bd)
    if crash:
        S.add("cym", t, 5.0, 50, crash)
    if timp:
        S.add("timp", t, 3.0, n(timp), tv)


# ───────────────────────────── sections ─────────────────────────────


def prologue(S: Score, c: Cues) -> None:
    """dawn over the whole map, the title, the dive to the Shire. D major, very quiet → swell into Hobbiton."""
    a = c.t0("hobbiton")  # arrival
    t_title = 1.6
    S.mark(0.0, "prologue")
    pad(S, 0.0, 8.6, {"cb": "D1", "vc": "D2 A2"}, PP + 4)
    S.env("vc", [(0.0, -24), (3.5, 0)])
    S.env("cb", [(0.0, -24), (3.5, 0)])
    pad(S, 0.9, 8.6, {"vla": "D4 A4", "vln_soft": "E5 A5"}, PP)
    arp(S, "harp", t_title, t_title + 1.6, "D3 A3 D4 E4 A4 D5 E5 A5", 0.2, P, ring=4.0, pattern="up")
    S.add("glock", 3.4, 2, n("A5"), P)
    S.add("glock", 4.3, 2, n("E6"), PP + 6)
    g = Grid(4.4, 66)  # the motif, solo horn, under the title
    line(S, "hn", g, 0, [("A3", 1), ("D4", 1), ("E4", 2), ("F#4", 3)], P + 4, legato=1.05)
    # Bm7 → G(add9) → A: the harmony opens as the camera lifts away
    pad(S, 8.6, 11.2, {"cb": "B1", "vc": "B2 F#3", "vla": "D4 A4", "vln_soft": "F#5 A5"}, PP + 6)
    pad(S, 11.2, a - 2.4, {"cb": "G1", "vc": "G2 D3", "vla": "B3 D4", "vln": "A4 D5 E5"}, P)
    pad(S, a - 2.4, a, {"cb": "A1", "vc": "A2 E3", "vla": "C#4 E4", "vln": "A4 C#5 E5"}, MP)
    S.env("vln", [(11.2 - 0.02, 0), (11.2, -16), (a, 0)])
    roll(S, a - 4.0, a - 0.05, "A2", P, MF)
    swell(S, a, 92, long=False)
    S.add("hn", a - 2.4, 2.4, n("C#4"), MP)
    S.add("hn", a - 2.4, 2.4, n("E4"), MP - 6)


def pastoral(S: Score, c: Cues) -> None:
    """Hobbiton at first light: the theme, pastoral (flute), harp, pizzicato, D major with a Mixolydian C."""
    t0 = c.t0("hobbiton")
    t1 = c.t0("bree")
    S.mark(t0, "shire")
    g = Grid.fit(t0, t1, 16)
    S.add("tri", t0, 2, 72, P)
    chords = [("D2", "D3 A3", "F#4 A4 D5", "D3 A3 D4 F#4 A4"), ("B1", "B2 F#3", "D4 F#4 B4", "B2 F#3 B3 D4 F#4"), ("G1", "G2 D3", "B3 D4 G4", "G2 D3 G3 B3 D4"), ("A1", "A2 E3", "C#4 E4 A4", "A2 E3 A3 C#4 E4")]
    for bar, (cb, vc, vln, harp) in enumerate(chords):
        s = g.at(bar * 4)
        e = g.at(bar * 4 + 4)
        pad(S, s, e, {"vla": vln.split()[0] + " " + vln.split()[1], "vln_soft": vln.split()[2]}, PP + 8)
        S.add("cb_pizz", s, 1.2, n(cb), MP)
        S.add("vc_pizz", g.at(bar * 4 + 2), 1.0, n(vc.split()[1]), P + 6)
        arp(S, "harp", s, e, harp, g.q / 2, P + 4, ring=2.2)
    line(S, "fl", g, 0, [(p, b) for p, b in transpose(THEME_A, 12)], MP, cresc=8)
    # clarinet answers in the last two bars
    line(S, "cl", g, 8, [("G4", 2), ("F#4", 2), ("E4", 4)], P + 4)


def road(S: Score, c: Cues) -> None:
    """Bree → Weathertop → the road to Rivendell: a walking ostinato in D Dorian, the motif in low horns."""
    t0 = c.t0("bree")
    t1 = c.t0("rivendell")
    S.mark(t0, "road")
    g = Grid.fit(t0, t1, 24)  # 6 bars
    prog = [("D", "D2 A2", "F4 A4"), ("C", "C2 G2", "E4 G4"), ("D", "D2 A2", "F4 A4"), ("Bb", "Bb1 F2", "D4 F4"), ("G", "G1 D2", "D4 G4"), ("C", "C2 G2", "E4 G4 Bb4")]
    osti = {"D": "D2 D2 A2 D2 C3 D2 A2 D2", "C": "C2 C2 G2 C2 Bb2 C2 G2 C2", "Bb": "Bb1 Bb1 F2 Bb1 A2 Bb1 F2 Bb1", "G": "G1 G1 D2 G1 F2 G1 D2 G1"}
    for bar, (root, low, mid) in enumerate(prog):
        s = g.at(bar * 4)
        e = g.at(bar * 4 + 4)
        for k, p in enumerate(osti[root].split()):
            S.add("vc_spic", g.at(bar * 4 + k * 0.5), g.q * 0.45, n(p) + 12, MP - 4 + (8 if k == 0 else 0))
            if k % 2 == 0:
                S.add("cb_pizz", g.at(bar * 4 + k * 0.5), 0.8, n(p), MP)
        pad(S, s, e, {"vla": mid}, P)
    # the motif, low horns, at Bree and again (darker) at Weathertop
    line(S, "hn", g, 0, [("D3", 1), ("G3", 1), ("A3", 2)], MP)
    wt = c.t0("weathertop")
    gw = Grid(wt, g.bpm)
    line(S, "hn", gw, 0, [("Bb2", 1), ("F3", 1), ("G3", 2), ("F3", 4)], MP + 4)
    S.add("timp", wt, 2.5, n("D2"), MP)
    S.add("cl", wt + 0.2, (t1 - wt) * 0.5, n("D4"), P)
    # into Rivendell: violins rise, harp glissando lands on the arrival
    S.add("vln", g.at(16), g.at(24) - g.at(16), n("G4"), P)
    S.add("vln", g.at(20), g.at(24) - g.at(20), n("Bb4"), P + 6)
    arp(S, "harp", t1 - 1.2, t1, "C3 E3 G3 Bb3 C4 E4 G4 Bb4 C5 E5", 0.12, MP, ring=3, pattern="up")


def elven(S: Score, c: Cues) -> None:
    """Rivendell: F major → D♭ → D, harp, high strings, flute motif, glockenspiel light."""
    t0 = c.t0("rivendell")
    t1 = c.t1("rivendell")
    S.mark(t0, "rivendell")
    g = Grid.fit(t0, t1, 8)
    pad(S, t0, g.at(4), {"cb": "F1", "vc": "F2 C3", "vla": "A3 C4", "vln_soft": "F5 A5 C6"}, P)
    pad(S, g.at(4), g.at(6), {"cb": "Db2", "vc": "Db2 Ab2", "vla": "F3 Ab3", "vln_soft": "F5 Ab5 C6"}, P)
    pad(S, g.at(6), t1 + 0.6, {"cb": "D2", "vc": "D2 A2", "vla": "E4 A4", "vln_soft": "F#5 A5"}, P + 4)
    arp(S, "harp", t0, g.at(4), "F2 C3 F3 A3 C4 E4 F4 A4", g.q / 2, MP - 4, ring=3.0)
    arp(S, "harp", g.at(4), g.at(6), "Db2 Ab2 Db3 F3 Ab3 C4 Db4 F4", g.q / 2, MP - 6, ring=3.0)
    line(S, "fl", g, 1, [("C5", 1), ("F5", 1), ("G5", 2), ("A5", 3)], MP)
    S.add("glock", g.at(0.5), 2, n("C6"), P)
    S.add("glock", g.at(2.5), 2, n("A6"), P - 6)
    S.add("glock", g.at(6), 3, n("F#6"), P)


def mountain(S: Score, c: Cues) -> None:
    """south over the snows of Caradhras: cold tremolo, low horn fifths, a soft swell into Moria."""
    t0 = c.t0("to-moria")
    t1 = c.t0("moria")
    S.mark(t0, "mountain")
    pad(S, t0, t1 + 0.4, {"vln_trem": "A5 E6", "hn": "D3 A3"}, P)
    S.env("vln_trem", [(t0 - 0.02, 0), (t0, -14), (t0 + 2.0, 0)])
    S.add("cb", t0, t1 - t0 + 0.4, n("D1"), PP + 8)
    swell(S, t1, 80, long=False)


def deep(S: Score, c: Cues) -> None:
    """Moria: C minor, heartbeat drum, low brass, tremolo cellos, a gong; light returns toward Lórien."""
    t0 = c.t0("moria")
    t1 = c.t0("lothlorien")
    S.mark(t0, "moria")
    hit(S, t0, gong=MP, bd=MP)
    S.hall += [(t0 - 0.5, 1.0), (t0 + 1.0, 1.45), (t1 - 3.0, 1.45), (t1 - 1.0, 1.0)]
    g = Grid(t0, 60)
    end_dark = t1 - 3.5
    pad(S, t0, end_dark, {"cb": "C1", "tba": "C1", "tbn": "G2"}, MP - 4)
    pad(S, t0, end_dark, {"vc_trem": "Eb3 G3"}, P)
    b = 0.0
    while g.at(b) < end_dark - 0.5:
        S.add("bd", g.at(b), 2.0, 36, P + (6 if int(b) % 4 == 0 else -6))
        b += 2
    line(S, "cl", Grid(t0 + 1.5, 60), 0, [("C4", 2), ("Eb4", 1), ("D4", 1), ("B3", 2), ("C4", 2)], P + 2)
    # the light of the golden wood: an A♭ → E chromatic shift as the route leaves the mountains
    pad(S, end_dark, t1, {"vla": "Ab3 C4", "vc": "Ab2 Eb3"}, P)
    arp(S, "harp", t1 - 2.0, t1, "E3 B3 E4 G#4 B4 E5", 0.33, P, ring=3, pattern="up")


def golden_wood(S: Score, c: Cues) -> None:
    """Lothlórien: E major with a Lydian A♯, high strings, flute, harp, glockenspiel."""
    t0 = c.t0("lothlorien")
    t1 = c.t1("lothlorien")
    S.mark(t0, "lorien")
    g = Grid.fit(t0, t1, 8)
    pad(S, t0, g.at(4), {"cb": "E1", "vc": "E2 B2", "vla": "G#3 B3", "vln_soft": "E5 G#5 B5"}, P)
    pad(S, g.at(4), t1 + 0.5, {"cb": "E1", "vc": "E2 B2", "vla": "A#3 C#4", "vln_soft": "F#5 A#5 C#6"}, P)
    arp(S, "harp", t0, t1, "E3 B3 E4 F#4 G#4 B4 E5", g.q / 2, MP - 6, ring=3.0)
    line(S, "fl", g, 0.5, [("B5", 1), ("E6", 1), ("F#6", 1.5), ("G#6", 0.5), ("F#6", 3)], MP - 2)
    for k, nm in enumerate(["B6", "G#6", "E6", "C#7"]):
        S.add("glock", g.at(1 + 2 * k), 2, n(nm), P - 4)


def isengard(S: Score, c: Cues) -> None:
    """past Fangorn to Isengard: G Phrygian ostinato (low strings + stopped horns), sparse anvil, timpani."""
    t0 = c.t0("to-isengard")
    t1 = c.t0("to-helms-deep")
    arrive = c.t0("isengard")
    S.mark(t0, "isengard")
    g = Grid(t0, 92)
    b = 0.0
    pat = ["G2", "G2", "Ab2", "G2", "G2", "D3", "Ab2", "G2"]
    while g.at(b) < t1 - 0.05:
        k = int(round(b * 2))
        v = MP + (10 if k % 8 == 0 else 0) + (8 if g.at(b) >= arrive else 0)
        S.add("vc_spic", g.at(b), g.q * 0.45, n(pat[k % 8]), v)
        S.add("cb_spic", g.at(b), g.q * 0.45, n(pat[k % 8]) - 12, v - 6)
        if k % 8 == 0 and g.at(b) >= arrive:
            S.add("hn_stac", g.at(b), 0.6, n("G3"), MF)
            S.add("hn_stac", g.at(b), 0.6, n("Ab3"), MF - 6)
        if k % 16 == 0 and g.at(b) >= arrive:
            S.add("anvil", g.at(b), 1.5, 60, MP)
        b += 0.5
    hit(S, arrive, timp="G2", tv=MF, bd=MP)
    pad(S, arrive, t1 + 0.3, {"tbn": "G2 D3", "tba": "G1"}, MP)
    S.add("vla", t0, arrive - t0, n("Bb3"), P)


def rohan(S: Score, c: Cues) -> None:
    """Helm's Deep and Edoras: the horn call (open fifths) over broad strings, D Aeolian → D major at Edoras."""
    t0 = c.t0("to-helms-deep")
    hd = c.t0("helms-deep")
    ed = c.t0("edoras")
    t1 = c.t0("to-argonath")
    S.mark(t0, "rohan")
    bar = (ed - hd) / 2  # Helm's Deep and Edoras fall on bar lines
    g = Grid(hd, 240.0 / bar)
    # pickup: string upbeat into Helm's Deep
    S.add("vc", t0, hd - t0, n("A2"), MP)
    S.add("timp", hd, 2.5, n("D2"), MF)
    prog = [("Dm", "D1", "D2 A2", "D3 F3 A3", "A4 D5"), ("F", "F1", "F2 C3", "C4 F4 A4", "A4 C5"), ("D", "D1", "D2 A2", "D3 F#3 A3", "F#4 A4 D5"), ("C", "C2", "C2 G2", "C4 E4 G4", "G4 C5")]
    for k, (_, cb, vc, vla, vln) in enumerate(prog):
        s = g.at(k * 4)
        e = min(t1 + 0.4, g.at(k * 4 + 4))
        if s >= t1:
            break
        pad(S, s, e, {"cb": cb, "vc": vc, "vla": vla, "vln": vln}, MP + (10 if k >= 2 else 0))
    call = [("D4", 2), ("A4", 1), ("G4", 1), ("A4", 3), ("C5", 1), ("D5", 2), ("C5", 1), ("A4", 1)]
    line(S, "hn", g, 0, call, MF)
    line(S, "hn", g, 0, [(n(p) - 12, b) for p, b in call], MF - 10)
    hit(S, ed, crash=MP, timp="D2", tv=F)
    line(S, "tbn", Grid(ed, g.bpm), 0, [("D3", 2), ("A2", 2)], MF)


def river(S: Score, c: Cues) -> None:
    """across Rohan and down the Great River: flowing harp, rising strings, the swell onto the Argonath."""
    t0 = c.t0("to-argonath")
    a = c.t0("argonath")
    S.mark(t0, "river")
    arp(S, "harp", t0, a, "D3 A3 D4 E4 F#4 A4 D5", (a - t0) / 28, MP - 2, ring=2.2)
    S.add("vc", t0, a - t0, n("D3"), MP)
    S.add("cb", t0, a - t0, n("D2"), MP)
    S.add("vla", t0 + 1.5, a - t0 - 1.5, n("A3"), MP)
    S.add("vln", t0 + 3.0, a - t0 - 3.0, n("E5"), MP)
    S.env("vln", [(t0 + 2.98, 0), (t0 + 3.0, -14), (a, 0)])
    roll(S, a - 4.5, a - 0.05, "A2", P, F)
    swell(S, a, 112)


def kings(S: Score, c: Cues) -> None:
    """the Argonath reveal: tutti D major, the theme (phrase B) broad in horns and violins; Rauros quieter."""
    a = c.t0("argonath")
    r = c.t0("rauros")
    t1 = c.t0("to-black-gate")
    S.mark(a, "argonath")
    hit(S, a, gong=F, bd=FF, crash=F, timp="D2", tv=FF)
    pad(S, a, r, {"cb": "D1", "tba": "D1", "tbn": "D2 A2", "vc": "D2 A2", "vla": "F#3 A3"}, F)
    pad(S, a, a + 2.5, {"tpt": "A4 D5"}, MF)
    g = Grid.fit(a, r, 16)
    line(S, "hn", g, 0, transpose(THEME_B, 0), F)
    line(S, "vln", g, 0, transpose(THEME_B, 12), MF + 6)
    for k, (cb, up) in enumerate([("D1", "D3 A3"), ("B0", "B2 F#3"), ("G1", "G2 D3"), ("A1", "A2 E3")]):
        S.chord("timp", g.at(k * 4), 2.0, [n(cb) + 24 if n(cb) + 24 >= 36 else n(cb) + 36], MF - 6)
    # Rauros: the falls — tremolo strings, harp, the river carrying on
    S.mark(r, "rauros")
    pad(S, r, t1 + 0.5, {"vln_trem": "A4 D5", "vc": "D2 A2", "cb": "D1"}, MP - 4)
    arp(S, "harp", r, t1, "D3 A3 D4 F#4 A4 D5", 0.25, P + 4, ring=2.5)


def approach(S: Score, c: Cues) -> None:
    """Emyn Muil → Dead Marshes → the Black Gate: E Phrygian, low brass E–F, drum on every beat."""
    t0 = c.t0("to-black-gate")
    bg = c.t0("black-gate")
    t1 = c.t0("to-henneth-annun")
    S.mark(t0, "black gate")
    g = Grid(t0, 66)
    pad(S, t0, t1 + 0.3, {"vc_trem": "E2 B2", "cb": "E1"}, P + 6)
    S.env("vc_trem", [(t0 - 0.02, 0), (t0, -12), (bg, 0)])
    b = 0.0
    while g.at(b) < t1 - 0.2:
        S.add("bd", g.at(b), 2.0, 36, MP - 6 + (14 if g.at(b) >= bg - 0.05 else 0))
        b += 1
    for k in range(int((t1 - t0) / (2 * g.q)) + 1):
        tt = g.at(k * 2)
        if tt >= t1:
            break
        S.add("tbn", tt, g.q * 1.9, n("E2") + (1 if k % 2 else 0), MP + (12 if tt >= bg else 0))
        S.add("tba", tt, g.q * 1.9, n("E1") + (1 if k % 2 else 0), MP + (8 if tt >= bg else 0))
    hit(S, bg, gong=MF, timp="E2", tv=F)
    pad(S, bg, t1 + 0.3, {"hn": "E3 F3 B3"}, MF)


def ithilien(S: Score, c: Cues) -> None:
    """Ithilien at sunset: a respite — oboe over strings and harp, G major."""
    t0 = c.t0("to-henneth-annun")
    t1 = c.t0("to-minas-tirith")
    S.mark(t0, "ithilien")
    g = Grid.fit(t0, t1, 12)
    pad(S, t0, g.at(4), {"cb": "G1", "vc": "G2 D3", "vla": "B3 D4", "vln_soft": "G4 B4"}, P)
    pad(S, g.at(4), g.at(8), {"cb": "E1", "vc": "E2 B2", "vla": "G3 B3", "vln_soft": "G4 B4"}, P)
    pad(S, g.at(8), t1 + 0.4, {"cb": "C2", "vc": "C2 G2", "vla": "E3 G3", "vln_soft": "E4 G4 C5"}, P)
    line(S, "ob", g, 0.5, [("D5", 1), ("G5", 1), ("A5", 1.5), ("B5", 0.5), ("A5", 2), ("G5", 1), ("E5", 1), ("D5", 4)], MP)
    arp(S, "harp", t0, t1, "G2 D3 G3 B3 D4 G4", g.q / 2, P, ring=2.5)


def gondor(S: Score, c: Cues) -> None:
    """Minas Tirith at blue hour: B♭ brass chorale; the beacon kindles to a trumpet call, bells and glockenspiel."""
    t0 = c.t0("to-minas-tirith")
    mt = c.t0("minas-tirith")
    t1 = c.t0("to-minas-morgul")
    S.mark(t0, "gondor")
    S.add("vc", t0, mt - t0, n("F2"), MP)
    S.add("vla", t0 + 1.0, mt - t0 - 1.0, n("C4"), MP)
    roll(S, mt - 2.5, mt - 0.05, "F2", P, MF)
    g = Grid(mt, 66)
    chorale = [("Bb2 F3 D4", "Bb1", 2), ("A2 F3 C4", "F1", 2), ("G2 D3 Bb3", "G1", 2), ("Eb3 G3 Bb3", "Eb1", 2), ("F2 D3 Bb3", "F1", 2), ("F2 C3 A3", "F1", 2), ("Bb2 F3 D4", "Bb1", 4)]
    b = 0.0
    for upper, low, beats in chorale:
        s = g.at(b)
        if s >= t1:
            break
        e = min(t1 + 0.6, g.at(b + beats))
        hn, tb = upper.split()[1:], upper.split()[:1]
        S.chord("hn", s, e - s, ns(" ".join(hn)), MF)
        S.chord("tbn", s, e - s, ns(" ".join(tb)), MF - 4)
        S.add("tba", s, e - s, n(low), MP + 4)
        S.chord("vla", s, e - s, ns(" ".join(hn)), MP - 6)
        b += beats
    bt0, bt1 = c.event_ramp("beacons")
    tb = (bt0 + bt1) / 2 if bt1 > bt0 else mt + 2.5
    S.mark(tb, "beacon")
    line(S, "tpt", Grid(tb, 72), 0, [("F4", 1), ("Bb4", 1), ("C5", 1), ("D5", 3)], MF)
    S.add("bells", tb + 0.1, 6, n("Bb4"), MP)
    S.add("glock", tb + 0.1, 3, n("F6"), MP)
    S.add("glock", tb + 0.9, 3, n("D6"), MP - 6)
    hit(S, tb, crash=MP, timp="Bb2", tv=MF)
    arp(S, "harp", tb, tb + 1.4, "Bb2 F3 Bb3 D4 F4 Bb4 D5 F5", 0.17, MF, ring=3, pattern="up")


def morgul(S: Score, c: Cues) -> None:
    """Minas Morgul: tritone pedal, string clusters, heartbeat drum; the green beam: swell → brass cluster stinger."""
    t0 = c.t0("to-minas-morgul")
    mm = c.t0("minas-morgul")
    t1 = c.t0("cirith-ungol")
    S.mark(t0, "morgul")
    pad(S, t0, t1 + 0.4, {"cb": "D1", "tba": "D1"}, MP)
    pad(S, mm, t1 + 0.4, {"tbn": "Ab2"}, MP)
    pad(S, t0, t1 + 0.4, {"vln_trem": "D5 Eb5", "vla": "Ab3 A3"}, P + 2)
    S.env("vln_trem", [(t0 - 0.02, 0), (t0, -16), (mm + 1, 0)])
    g = Grid(mm, 56)
    b = 0.0
    while g.at(b) < t1 - 0.3:
        S.add("bd", g.at(b), 2.0, 36, MP + (8 if b % 2 == 0 else -4))
        b += 1
    s0, s1 = c.event_ramp("morgul-beam")
    peak = (s0 + 2 * s1) / 3 if s1 > s0 else mm + 3.5
    S.mark(peak, "beam")
    swell(S, peak, 116, long=False)
    S.add("bd_roll", peak - 2.2, 4.0, 38, F)
    S.chord("hn", peak, 3.5, ns("D3 Ab3 Eb4"), F)
    S.chord("tbn", peak, 3.5, ns("D2 Ab2"), F)
    hit(S, peak, gong=F, timp="D2", tv=F)


def doom(S: Score, c: Cues) -> None:
    """Cirith Ungol → Gorgoroth → Mount Doom: the theme in minor, tutti, the climax at the mountain."""
    t0 = c.t0("cirith-ungol")
    md = c.t0("mount-doom")
    t1 = c.t1("mount-doom")
    S.mark(t0, "doom")
    g = Grid(t0, 84)
    b = 0.0
    while g.at(b) < md - 0.05:  # driving low strings toward the mountain
        k = int(round(b * 2))
        S.add("vc_spic", g.at(b), g.q * 0.45, n("D3") if k % 4 else n("D2"), MP + (6 if k % 4 == 0 else 0) + int(12 * (g.at(b) - t0) / (md - t0)))
        S.add("cb_spic", g.at(b), g.q * 0.45, n("D2"), MP)
        b += 0.5
    roll(S, md - 5.5, md - 0.05, "D2", P, FF)
    swell(S, md, 120)
    S.add("bd_roll", md - 3.0, 3.2, 39, F)
    hit(S, md, gong=FF, bd=FF, crash=FF, timp="D2", tv=FF)
    gm = Grid.fit(md, t1, 12)
    minor = [("A3", 1), ("D4", 1), ("E4", 2), ("F4", 1.5), ("G4", 0.5), ("F4", 1), ("E4", 1), ("D4", 4)]
    line(S, "hn", gm, 0, minor, FF - 6)
    line(S, "tbn", gm, 0, [(n(p) - 12, b) for p, b in minor], F)
    line(S, "vln", gm, 0, [(n(p) + 12, b) for p, b in minor], F)
    for k, (low, mid) in enumerate([("D1", "D2 A2"), ("Bb0", "Bb1 F2"), ("G1", "G2 D3")]):
        s = gm.at(k * 4)
        e = gm.at(k * 4 + 4) + (0.4 if k == 2 else 0)
        pad(S, s, e, {"cb": low, "tba": low, "vc": mid, "vla": "F3 A3" if k != 1 else "F3 Bb3"}, F)
        S.add("timp", s, 2.0, n("D2") if k != 2 else n("G2"), F)
        S.add("bd", s, 2.0, 36, F - 10)


def finale(S: Score, c: Cues) -> None:
    """the pull-out to the whole map: minor turns to major; the full theme (phrase B), Lydian cadence, coda."""
    t0 = c.t0("pull-out")
    e = c.t0("end")
    t_end = c.duration
    S.mark(t0, "finale")
    # rising out of Mordor: B♭ → C → D (major)
    pad(S, t0, t0 + 3.0, {"cb": "Bb0", "vc": "Bb1 F2", "vla": "D3 F3", "hn": "D4 F4"}, MF)
    pad(S, t0 + 3.0, t0 + 6.0, {"cb": "C1", "vc": "C2 G2", "vla": "E3 G3", "hn": "E4 G4"}, MF + 6)
    pad(S, t0 + 6.0, e, {"cb": "D1", "vc": "D2 A2", "vla": "F#3 A3", "hn": "F#4 A4", "vln": "A4 D5"}, F)
    line(S, "tpt", Grid(t0 + 6.0, 72), 0, MOTIF, MF)
    roll(S, e - 2.5, e - 0.05, "A2", MP, F)
    swell(S, e, 104, long=False)
    hit(S, e, crash=MF, timp="D2", tv=F, gong=MP)
    # the theme, phrase B, broad; then the coda under the end words / credits
    g = Grid(e, 76)
    line(S, "hn", g, 0, transpose(THEME_B, 0), F)
    line(S, "vln", g, 0, transpose(THEME_B, 12), MF + 4)
    harm = [("D1", "D2 A2", "F#3 A3"), ("B0", "B1 F#2", "D3 F#3"), ("E1", "E2 B2", "G#3 B3"), ("D1", "D2 A2", "F#3 A3")]  # E major = the Lydian II
    for k, (cb, vc, vla) in enumerate(harm):
        s = g.at(k * 4)
        en = g.at(k * 4 + 4) if k < 3 else t_end
        pad(S, s, en, {"cb": cb, "vc": vc, "vla": vla}, F - 8 * k)
    arp(S, "harp", g.at(12), t_end - 1.0, "D3 A3 D4 E4 F#4 A4 D5", 0.42, MP - 4, ring=4, pattern="up")
    S.add("glock", g.at(12) + 0.4, 4, n("F#6"), P)
    S.add("vln_soft", g.at(12), t_end - g.at(12), n("A5"), P)


SECTIONS = [prologue, pastoral, road, elven, mountain, deep, golden_wood, isengard, rohan, river, kings, approach, ithilien, gondor, morgul, doom, finale]


def compose(cues: dict) -> Score:
    c = Cues(cues)
    S = Score(duration=c.duration)
    for sec in SECTIONS:
        sec(S, c)
    return S
