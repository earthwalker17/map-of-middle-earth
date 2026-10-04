"""
The orchestra (S5 score): every stem the score can write, its SFZ (VSCO 2 CE, CC0, in data/music-src/vsco2 —
or a percussion map of ours, generated into data/music-src/sfz/, that points at the same samples), its playable range, seating
(pan), level, hall send and attack latency (a sustain sample speaks late: notes are moved earlier by it).

VSCO 2 SFZs map no CCs: dynamics come from velocity layers plus the mixer's per-stem gain automation.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VSCO = ROOT / "data" / "music-src" / "vsco2"
OWN = ROOT / "data" / "music-src" / "sfz"  # generated (machine paths) — gitignored


@dataclass(frozen=True)
class Instrument:
    id: str
    sfz: Path
    lo: int
    hi: int
    pan: float  # -1 left .. +1 right
    gain_db: float  # stem level
    send: float  # hall send 0..1
    latency: float = 0.0  # s: notes start this much earlier
    family: str = "strings"


def _v(name: str) -> Path:
    return VSCO / f"{name}.sfz"


ORCH: dict[str, Instrument] = {
    i.id: i
    for i in [
        # strings (sections) — seated violins left, violas centre, cellos / basses right
        Instrument("vln", _v("ViolinEnsSusVib"), 55, 86, -0.40, 0.0, 0.32, 0.09),
        Instrument("vln_soft", _v("ViolinEnsSusVib-Quiet"), 55, 86, -0.35, 0.0, 0.36, 0.10),
        Instrument("vla", _v("ViolaEnsSusVib"), 48, 86, 0.10, -1.0, 0.32, 0.09),
        Instrument("vc", _v("CelloEnsSusVib"), 36, 77, 0.30, 0.0, 0.30, 0.08),
        Instrument("cb", _v("ContrabassSusVB"), 24, 60, 0.42, -2.0, 0.26, 0.08),
        Instrument("vln_pizz", _v("ViolinEnsPizz"), 55, 86, -0.40, -3.0, 0.28),
        Instrument("vc_pizz", _v("CelloEnsPizz"), 36, 77, 0.30, -2.0, 0.26),
        Instrument("cb_pizz", _v("ContrabassPizz"), 24, 60, 0.42, -3.0, 0.24),
        Instrument("vln_trem", _v("ViolinEnsTrem"), 55, 86, -0.40, -2.0, 0.34, 0.03),
        Instrument("vc_trem", _v("CelloEnsTrem"), 36, 77, 0.30, -1.0, 0.30, 0.03),
        Instrument("vc_spic", _v("CelloEnsSpic"), 36, 77, 0.30, -2.0, 0.24),
        Instrument("cb_spic", _v("ContrabassSpic"), 24, 60, 0.42, -3.0, 0.22),
        Instrument("harp", _v("Harp"), 28, 101, -0.48, -1.0, 0.40, family="harp"),
        # brass
        Instrument("hn", _v("FHornSus"), 33, 77, -0.18, -1.0, 0.42, 0.05, "brass"),
        Instrument("hn_stac", _v("FHornStac"), 33, 77, -0.18, -2.0, 0.40, 0.0, "brass"),
        Instrument("tpt", _v("TrumpetSus"), 52, 84, 0.04, -4.0, 0.38, 0.03, "brass"),
        Instrument("tbn", _v("TromboneSus"), 34, 65, 0.24, -2.0, 0.38, 0.04, "brass"),
        Instrument("tba", _v("TubaSus"), 29, 62, 0.32, -2.0, 0.34, 0.05, "brass"),
        # winds
        Instrument("fl", _v("FluteSusVib"), 60, 96, -0.10, -2.0, 0.34, 0.03, "winds"),
        Instrument("ob", _v("OboeSusVib"), 58, 89, 0.06, -3.0, 0.32, 0.03, "winds"),
        Instrument("cl", _v("ClarinetSus"), 50, 90, 0.14, -2.0, 0.32, 0.03, "winds"),
        Instrument("picc", _v("PiccoloSus"), 67, 91, -0.06, -8.0, 0.36, 0.02, "winds"),
        # tuned percussion
        Instrument("glock", _v("Glockenspiel"), 67, 96, 0.30, -9.0, 0.44, family="perc"),
        Instrument("bells", _v("TubularBells"), 60, 79, 0.22, -8.0, 0.46, family="perc"),
        Instrument("timp", _v("Timpani"), 36, 60, 0.0, -1.0, 0.34, family="perc"),
        Instrument("timp_roll", _v("TimpaniRolls"), 36, 60, 0.0, -2.0, 0.34, family="perc"),
        # our percussion maps (tools/music/sfz)
        Instrument("bd", OWN / "bassdrum.sfz", 36, 36, 0.0, -2.0, 0.40, family="perc"),
        Instrument("bd_roll", OWN / "bassdrum_roll.sfz", 36, 39, 0.0, -4.0, 0.40, family="perc"),
        Instrument("gong", OWN / "gong.sfz", 40, 45, 0.12, -4.0, 0.50, family="perc"),
        Instrument("cym", OWN / "cymbal.sfz", 48, 55, -0.12, -8.0, 0.46, family="perc"),
        Instrument("anvil", OWN / "anvil.sfz", 60, 60, 0.18, -12.0, 0.36, family="perc"),
        Instrument("tri", OWN / "triangle.sfz", 72, 72, 0.28, -14.0, 0.40, family="perc"),
    ]
}

# percussion maps: key → velocity layers (low → high) of sample names in vsco2/Percussion; "{rr}" = round robin
PERC_MAPS: dict[str, list[dict]] = {
    "bassdrum.sfz": [{"key": 36, "layers": [f"BDrumNewhit_v{v}_rr{{rr}}_Sum.wav" for v in range(1, 8)], "rr": 2}],
    "bassdrum_roll.sfz": [{"key": 36 + i, "layers": [f"bassdrum_rub{i + 1}_v1.wav"], "rr": 1} for i in range(4)],
    "gong.sfz": [
        {"key": 40, "layers": ["gongHit_p.wav", "gongHit_mf.wav", "gongHit_f.wav", "gongHit_fff.wav"], "rr": 1},
        {"key": 42, "layers": ["gongscrape_pp.wav", "gongscrape_mf.wav"], "rr": 1},
    ],
    "cymbal.sfz": [
        {"key": 48, "layers": ["susCymb1-cresc-Long_v1.wav"], "rr": 1},
        {"key": 49, "layers": ["susCymb1-cresc-Median_v1.wav"], "rr": 1},
        {"key": 50, "layers": [f"cymbal-crash1_{d}_rr{{rr}}.wav" for d in ("pp", "mp", "mf", "ff")], "rr": 2},
        {"key": 52, "layers": [f"susCymb1-hit_{d}_rr{{rr}}.wav" for d in ("pp", "mp", "f", "fff")], "rr": 2},
    ],
    "anvil.sfz": [{"key": 60, "layers": [f"Anvil_Hit1_v{v}_Sum.wav" for v in (1, 2, 3)], "rr": 1}],
    "triangle.sfz": [{"key": 72, "layers": [f"Triangle6-Hit_v{v}_rr{{rr}}_Sum.wav" for v in (1, 2)], "rr": 2}],
}


def write_perc_maps() -> list[Path]:
    """Write our percussion SFZ maps (velocity layers split evenly; round robins via seq_length)."""
    OWN.mkdir(parents=True, exist_ok=True)
    perc = VSCO / "Percussion"
    out = []
    for name, keys in PERC_MAPS.items():
        lines = [f"// {name}: generated by tools/music/instruments.py (samples: VSCO 2 CE, CC0)", "<control>", f"default_path={perc.as_posix()}/", "<global>", "ampeg_release=3", "ampeg_dynamic=1"]
        for k in keys:
            n = len(k["layers"])
            for li, pattern in enumerate(k["layers"]):
                lo = 1 + (127 * li) // n
                hi = (127 * (li + 1)) // n
                for rr in range(1, k["rr"] + 1):
                    seq = f" seq_length={k['rr']} seq_position={rr}" if k["rr"] > 1 else ""
                    lines.append(f"<region> sample={pattern.replace('{rr}', str(rr))} key={k['key']} lovel={lo} hivel={hi}{seq}")
        p = OWN / name
        p.write_text("\n".join(lines) + "\n", encoding="utf-8")
        out.append(p)
    return out


def check_samples() -> list[str]:
    """Missing samples referenced by our percussion maps (empty = all present)."""
    import re

    perc = VSCO / "Percussion"
    missing = []
    for p in OWN.glob("*.sfz"):
        for s in re.findall(r"sample=(\S+)", p.read_text(encoding="utf-8")):
            if not (perc / s).exists():
                missing.append(f"{p.name}: {s}")
    return missing


if __name__ == "__main__":
    for p in write_perc_maps():
        print("wrote", p.relative_to(ROOT))
    miss = check_samples()
    print("missing:", miss or "none")
    for i in ORCH.values():
        if not i.sfz.exists():
            print("NO SFZ:", i.id, i.sfz)
