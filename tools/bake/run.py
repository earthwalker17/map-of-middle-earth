"""Entry point: `pnpm bake [--steps dem,vectors,regions,terrain,export,preview] [--force]`."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to a legacy code page
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:  # pragma: no cover
    pass

from bake.main import main  # noqa: E402

if __name__ == "__main__":
    main(sys.argv[1:])
