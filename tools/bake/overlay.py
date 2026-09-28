"""Entry point: CT-1980 geography overlay QA (CPU only). `tools/bake/.venv/Scripts/python.exe tools/bake/overlay.py`"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to a legacy code page
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:  # pragma: no cover
    pass

from bake.overlay import main  # noqa: E402

if __name__ == "__main__":
    main(sys.argv[1:])
