"""
Fetch the score's third-party inputs into data/music-src/ (gitignored) and write data/music-src/manifest.json
(committed): the CC0 sample libraries (a sparse checkout of only the instruments the score uses) and the
sfizz_render binary. Nothing here is shipped; the rendered audio is the project's own composition.

    uv run --project tools/music python tools/music/fetch.py [--dry] [--keep-git]

Idempotent. The sparse clone's .git (a second copy of every sample) is deleted after the checkout unless
--keep-git (disk is tight); the commit stays in the manifest. To change the instrument set, delete
data/music-src/vsco2 and run again.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "data" / "music-src"

# VSCO 2 Community Edition (Versilian Studios, CC0-1.0), SFZ branch: SFZ files at the root, samples in folders
VSCO2 = {
    "id": "vsco2",
    "name": "VSCO 2 Community Edition",
    "url": "https://github.com/sgossner/VSCO-2-CE",
    "branch": "SFZ",
    "license": "CC0-1.0",
    "folders": [
        "Strings/Violin Section",
        "Strings/Viola Section",
        "Strings/Cello Section",
        "Strings/Solo Contrabass",
        "Strings/Harp",
        "Brass/F Horn",
        "Brass/Tenor Trombone",
        "Brass/Tuba",
        "Brass/Trumpet",
        "Woodwinds/Flute",
        "Woodwinds/Oboe",
        "Woodwinds/Clarinet",
        "Woodwinds/Piccolo",
        "Percussion",
    ],
}

SFIZZ = {
    "id": "sfizz",
    "name": "sfizz 1.2.3 (sfizz_render)",
    "url": "https://github.com/sfztools/sfizz/releases/download/1.2.3/sfizz-1.2.3-win64.zip",
    "license": "BSD-2-Clause (tool only, not shipped)",
}


def sh(*args: str, cwd: Path | None = None) -> str:
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"[music] {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout.strip()


def tree_bytes(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file() and ".git" not in f.parts)


def rmtree(p: Path) -> None:
    def onerror(func, path, _exc):  # git packs are read-only on Windows
        os.chmod(path, stat.S_IWRITE)
        func(path)

    shutil.rmtree(p, onerror=onerror)


def fetch_vsco2(dry: bool, keep_git: bool) -> dict:
    d = DEST / VSCO2["id"]
    if d.exists() and not (d / ".git").exists():
        # a finished checkout whose .git was dropped: verify the folders, keep the recorded commit
        missing = [f for f in VSCO2["folders"] if not (d / f).is_dir()]
        if missing:
            sys.exit(f"[music] {d} lacks {missing}: delete it and fetch again")
        prev = json.loads((DEST / "manifest.json").read_text(encoding="utf-8")) if (DEST / "manifest.json").exists() else {"items": []}
        commit = next((i.get("commit") for i in prev["items"] if i.get("id") == VSCO2["id"]), None)
        sfz = sorted(p.name for p in d.glob("*.sfz"))
        return {**VSCO2, "dir": f"data/music-src/{VSCO2['id']}", "commit": commit, "bytes": tree_bytes(d), "sfz": sfz}
    if not (d / ".git").exists():
        if dry:
            return {**VSCO2, "status": "would clone"}
        sh("git", "clone", "--filter=blob:none", "--no-checkout", "--depth", "1", "--branch", VSCO2["branch"], VSCO2["url"], str(d))
    patterns = ["/*.sfz", "/LICENSE", "/README.md"] + [f"/{f}/" for f in VSCO2["folders"]]
    if dry:
        return {**VSCO2, "status": "present", "patterns": patterns}
    sh("git", "sparse-checkout", "init", "--no-cone", cwd=d)
    sh("git", "sparse-checkout", "set", "--no-cone", *patterns, cwd=d)
    sh("git", "checkout", VSCO2["branch"], cwd=d)
    commit = sh("git", "rev-parse", "HEAD", cwd=d)
    sfz = sorted(p.name for p in d.glob("*.sfz"))
    if not keep_git:
        rmtree(d / ".git")
    return {**VSCO2, "dir": f"data/music-src/{VSCO2['id']}", "commit": commit, "bytes": tree_bytes(d), "sfz": sfz}


def fetch_sfizz(dry: bool) -> dict:
    d = DEST / "sfizz"
    exe = next(iter(d.rglob("sfizz_render.exe")), None) if d.exists() else None
    if exe is None:
        if dry:
            return {**SFIZZ, "status": "would download"}
        data = urllib.request.urlopen(SFIZZ["url"], timeout=120).read()
        sha = hashlib.sha256(data).hexdigest()
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            z.extractall(d)
        (d / "zip.sha256").write_text(sha)
        exe = next(iter(d.rglob("sfizz_render.exe")), None)
        if exe is None:
            sys.exit("[music] sfizz zip has no sfizz_render.exe")
    sha = (d / "zip.sha256").read_text().strip() if (d / "zip.sha256").exists() else None
    return {**SFIZZ, "exe": exe.relative_to(ROOT).as_posix(), "zipSha256": sha}


def main() -> None:
    dry = "--dry" in sys.argv
    DEST.mkdir(parents=True, exist_ok=True)
    libs = [fetch_vsco2(dry, "--keep-git" in sys.argv), fetch_sfizz(dry)]
    manifest = {
        "notes": "Third-party inputs of the original score (S5), fetched by tools/music/fetch.py into data/music-src/ (gitignored, never shipped). Sample libraries are CC0; the score and the rendered audio are this project's own work.",
        "items": libs,
    }
    if not dry:
        (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    for l in libs:
        mb = f"{l.get('bytes', 0) / 2**20:.0f} MB" if "bytes" in l else ""
        print(f"[music] {l['id']}: {l.get('status', 'ok')} {mb} {l.get('exe', '')}")


if __name__ == "__main__":
    os.environ.setdefault("GIT_TERMINAL_PROMPT", "0")
    main()
