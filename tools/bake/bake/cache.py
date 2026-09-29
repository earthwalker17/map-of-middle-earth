"""Step caches (data/baked/cache/<step>.npz + steps.json): every bake step stores its products keyed by
a hash of the inputs it depends on, so `pnpm bake -- --steps hydro,export` reruns only the river/lake
work (seconds, little memory) and any stale upstream step reruns automatically."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np


def digest(*parts) -> str:
    """Stable short hash of JSON-serialisable parts (config sections, file stats, upstream keys)."""
    blob = json.dumps(parts, sort_keys=True, ensure_ascii=True, default=str).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:16]


def file_stamp(path: Path) -> list:
    """Cheap identity of a source file (size + mtime) for cache keys."""
    try:
        st = path.stat()
        return [path.name, st.st_size, int(st.st_mtime)]
    except OSError:
        return [path.name, None]


def code_stamp(*modules: str) -> str:
    """Hash of bake module sources, so a code change invalidates the steps that use it."""
    here = Path(__file__).resolve().parent
    h = hashlib.sha256()
    for m in modules:
        h.update((here / f"{m}.py").read_bytes())
    return h.hexdigest()[:16]


class StepCache:
    def __init__(self, root: Path):
        self.root = root
        self.meta_path = root / "steps.json"
        try:
            self.meta: dict = json.loads(self.meta_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.meta = {}

    def _path(self, step: str) -> Path:
        return self.root / f"{step}.npz"

    def valid(self, step: str, key: str) -> bool:
        return self.meta.get(step, {}).get("key") == key and self._path(step).exists()

    def save(self, step: str, key: str, arrays: dict[str, np.ndarray], extra: dict | None = None) -> None:
        np.savez(self._path(step), **arrays)
        self.meta[step] = {"key": key, "extra": extra or {}}
        self.meta_path.write_text(json.dumps(self.meta, indent=1, ensure_ascii=False), encoding="utf-8")

    def load(self, step: str) -> tuple[dict[str, np.ndarray], dict]:
        with np.load(self._path(step), allow_pickle=False) as z:
            arrays = {k: z[k] for k in z.files}
        return arrays, self.meta.get(step, {}).get("extra", {})

    def save_json(self, step: str, name: str, obj) -> None:
        (self.root / f"{step}_{name}.json").write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    def load_json(self, step: str, name: str):
        return json.loads((self.root / f"{step}_{name}.json").read_text(encoding="utf-8"))

    def drop(self, step: str) -> None:
        self.meta.pop(step, None)
        self._path(step).unlink(missing_ok=True)


def q8(a: np.ndarray) -> np.ndarray:
    """0..1 float → u8 (the export quantisation). Masks are quantised as soon as they are computed so a
    cached and a fresh run feed identical values to every later step."""
    return np.clip(np.rint(a * 255), 0, 255).astype(np.uint8)


def f8(a: np.ndarray) -> np.ndarray:
    return a.astype(np.float32) / 255.0
