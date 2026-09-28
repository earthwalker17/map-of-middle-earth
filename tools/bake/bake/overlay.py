"""Geography QA overlay: Christopher Tolkien's 1980 'West of Middle-earth' map vs our baked terrain.

The ME-GIS / ME-DEM data is our geometric truth; the CT map is only a cross-check that flags *large*
discrepancies (> FLAG_KM). Two maps drawn by different hands never agree to a few km, so small residuals
are expected and ignored. CPU only.

Inputs
  data/world/world.json                 frame (ME-GIS km)
  data/qa/ct1980-points.json            control points: CT pixel [x, y] <-> ME-GIS km [x east, y north]
                                        (a point with "fit": false is reported but not used in any fit)
  reference/maps/ct-1980-west-of-middle-earth.png
  data/baked/preview/relief.png         our shaded relief at half resolution (0.8 km/px)

Outputs (data/baked/preview/)
  overlay-ct1980.png         relief + CT linework warped with a thin-plate spline (TPS). The TPS pins every
                             control point, so use it to compare shapes *between* points (coastlines,
                             rivers, ranges, forests); it hides differences at the points themselves.
  overlay-ct1980-affine.png  relief + CT linework warped with the best-fit affine only: the honest
                             discrepancy view. Red circle = our canonical position, blue cross = where the
                             CT map puts it; joined by a yellow line when the residual exceeds FLAG_KM.
  overlay-ct1980.json        affine parameters, per-point residuals (full fit, leave-one-out, local), flags.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.interpolate import RBFInterpolator

from . import config

FLAG_KM = 18.0
OUT_KM_PER_PX = 0.8  # relief.png is the frame at half the heightfield resolution
FIT_WEIGHT = {3: 1.0, 2: 0.7, 1: 0.35}  # affine least-squares weight by confidence
TPS_SMOOTHING = {3: 10.0, 2: 40.0, 1: 160.0}  # warp TPS (km -> CT px): stays within ~1 km of confident points
LOCAL_SMOOTHING = {3: 1e3, 2: 4e3, 1: 1.6e4}  # local leave-one-out TPS (CT px -> km)
CT_ALPHA = 0.75  # opacity of CT black linework over the relief
CT_RED_ALPHA = 0.35  # opacity of CT red lettering


# ----------------------------------------------------------------------------------------------- fit
def load_points(path: Path) -> tuple[dict, list[dict]]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    pts = [p for p in doc["points"] if p.get("megisKm") is not None]
    return doc, pts


def fit_affine(px: np.ndarray, km: np.ndarray, w: np.ndarray) -> np.ndarray:
    """Weighted least squares: km ≈ [px_x, px_y, 1] @ M, M is 3x2."""
    X = np.column_stack([px, np.ones(len(px))])
    sw = np.sqrt(w)[:, None]
    M, *_ = np.linalg.lstsq(X * sw, km * sw, rcond=None)
    return M


def apply_affine(M: np.ndarray, px: np.ndarray) -> np.ndarray:
    px = np.atleast_2d(px)
    return np.column_stack([px, np.ones(len(px))]) @ M


def invert_affine(M: np.ndarray) -> np.ndarray:
    """Inverse of apply_affine: returns M' with px = [km_x, km_y, 1] @ M'."""
    A = M[:2].T  # km = A @ px + t
    t = M[2]
    Ai = np.linalg.inv(A)
    Mi = np.zeros((3, 2))
    Mi[:2] = Ai.T
    Mi[2] = -Ai @ t
    return Mi


def describe_affine(M: np.ndarray) -> dict:
    """Decompose the linear part into scale (km per CT px), rotation and shear (CT y flipped to point north)."""
    A = M[:2].T @ np.diag([1.0, -1.0])
    sx = float(np.hypot(A[0, 0], A[1, 0]))
    rot = math.degrees(math.atan2(A[1, 0], A[0, 0]))
    shear = float((A[0, 0] * A[0, 1] + A[1, 0] * A[1, 1]) / sx)
    sy = float(np.linalg.det(A) / sx)
    return {"kmPerPxX": sx, "kmPerPxY": sy, "aspectYoverX": sy / sx, "rotationDeg": rot, "shearKmPerPx": shear}


def similarity_rms(px: np.ndarray, km: np.ndarray) -> tuple[float, float]:
    """Best isotropic fit (scale + rotation + shift, CT y flipped): (km per px, RMS km). Compared with the
    affine RMS it shows how much of the misfit is a global aspect/shear difference between the two maps."""
    X = np.column_stack([px[:, 0], -px[:, 1]])
    Xc, Kc = X - X.mean(0), km - km.mean(0)
    U, S, Vt = np.linalg.svd(Kc.T @ Xc)
    R = U @ Vt
    s = S.sum() / (Xc ** 2).sum()
    pred = (s * (R @ Xc.T)).T + km.mean(0)
    return float(s), float(np.sqrt(np.mean(np.sum((pred - km) ** 2, axis=1))))


def by_conf(table: dict, conf: np.ndarray) -> np.ndarray:
    return np.array([table.get(int(c), table[2]) for c in conf], dtype=float)


def residual_table(pts: list[dict], px: np.ndarray, km: np.ndarray, conf: np.ndarray, use: np.ndarray,
                   M: np.ndarray) -> list[dict]:
    """Per point: affine residual, affine leave-one-out residual, and a *local* leave-one-out residual from a
    smoothed TPS (CT px -> km) fitted to the other points. The local one absorbs the regional drawing
    differences a point shares with its neighbours and isolates points that disagree with their
    surroundings (it extrapolates for points on the rim of the point cloud, so it is weaker there)."""
    w = by_conf(FIT_WEIGHT, conf)
    sm = by_conf(LOCAL_SMOOTHING, conf)
    pred = apply_affine(M, px)
    d = pred - km
    rows = []
    for i, p in enumerate(pts):
        keep = use.copy()
        keep[i] = False
        Mi = fit_affine(px[keep], km[keep], w[keep])
        loo = apply_affine(Mi, px[i])[0] - km[i]
        t = RBFInterpolator(px[keep], km[keep], kernel="thin_plate_spline", smoothing=sm[keep], degree=1)
        tloo = t(px[i:i + 1])[0] - km[i]
        r = float(np.hypot(*d[i]))
        rows.append({
            "id": p["id"],
            "confidence": int(conf[i]),
            "usedInFit": bool(use[i]),
            "megisKm": [round(float(km[i, 0]), 2), round(float(km[i, 1]), 2)],
            "ctAffineKm": [round(float(pred[i, 0]), 2), round(float(pred[i, 1]), 2)],
            "dxKm": round(float(d[i, 0]), 1),
            "dyKm": round(float(d[i, 1]), 1),
            "residualKm": round(r, 1),
            "looResidualKm": round(float(np.hypot(*loo)), 1),
            "localResidualKm": round(float(np.hypot(*tloo)), 1),
            "localDxDyKm": [round(float(tloo[0]), 1), round(float(tloo[1]), 1)],
            "flagged": r > FLAG_KM,
            "localFlag": bool(np.hypot(*tloo) > FLAG_KM),
        })
    return rows


# ---------------------------------------------------------------------------------------------- warp
def frame_grid(cfg: config.Config, W: int, H: int) -> tuple[np.ndarray, np.ndarray]:
    """ME-GIS km of every output pixel centre (row 0 = north)."""
    xs = cfg.x0_km + (np.arange(W) + 0.5) * OUT_KM_PER_PX
    ys = cfg.y1_km - (np.arange(H) + 0.5) * OUT_KM_PER_PX
    return np.meshgrid(xs, ys)


def warp_ct(ct: np.ndarray, map_x: np.ndarray, map_y: np.ndarray) -> np.ndarray:
    mx = np.ascontiguousarray(map_x, dtype=np.float32)
    my = np.ascontiguousarray(map_y, dtype=np.float32)
    return cv2.remap(np.ascontiguousarray(ct), mx, my, cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))


def affine_maps(Mi: np.ndarray, gx: np.ndarray, gy: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    p = np.column_stack([gx.ravel(), gy.ravel(), np.ones(gx.size)]) @ Mi
    return p[:, 0].reshape(gx.shape), p[:, 1].reshape(gx.shape)


def tps_maps(km: np.ndarray, px: np.ndarray, conf: np.ndarray, gx: np.ndarray, gy: np.ndarray,
             chunk: int = 200_000) -> tuple[np.ndarray, np.ndarray, RBFInterpolator]:
    """TPS from ME-GIS km to CT pixels (the direction remap needs), evaluated at every output pixel."""
    tps = RBFInterpolator(km, px, kernel="thin_plate_spline", smoothing=by_conf(TPS_SMOOTHING, conf), degree=1)
    q = np.column_stack([gx.ravel(), gy.ravel()])
    out = np.empty((len(q), 2))
    for s in range(0, len(q), chunk):
        out[s:s + chunk] = tps(q[s:s + chunk])
    return out[:, 0].reshape(gx.shape), out[:, 1].reshape(gx.shape), tps


# ------------------------------------------------------------------------------------------- compose
def compose(relief: np.ndarray, warped: np.ndarray) -> np.ndarray:
    """Relief (lightened) with the CT black linework drawn over it and the CT red lettering faintly tinted."""
    rel = relief.astype(np.float32) / 255.0
    rel = 0.35 + 0.65 * rel  # lighten so dark linework reads everywhere, including the deep sea
    ct = warped.astype(np.float32) / 255.0
    r, g, b = ct[..., 0], ct[..., 1], ct[..., 2]
    red = np.clip((r - np.maximum(g, b)) * 2.0, 0, 1)
    dark = np.clip((1.0 - (r + g + b) / 3.0) * 1.4, 0, 1) * (1 - red)
    a = CT_ALPHA * dark[..., None]
    out = rel * (1 - a) + np.array([0.02, 0.02, 0.06]) * a
    ar = CT_RED_ALPHA * red[..., None]
    out = out * (1 - ar) + np.array([0.85, 0.05, 0.05]) * ar
    return (np.clip(out, 0, 1) * 255).astype(np.uint8)


def _font(size: int):
    for name in ("arial.ttf", "DejaVuSans.ttf", "LiberationSans-Regular.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _text(d: ImageDraw.ImageDraw, xy, s: str, fill, font) -> None:
    x, y = xy
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)):
        d.text((x + dx, y + dy), s, fill=(0, 0, 0), font=font)
    d.text((x, y), s, fill=fill, font=font)


def draw_markers(img: np.ndarray, cfg: config.Config, rows: list[dict], affine: bool, title: str) -> Image.Image:
    im = Image.fromarray(img)
    d = ImageDraw.Draw(im)
    f = _font(15)

    def to_px(k):
        return ((k[0] - cfg.x0_km) / OUT_KM_PER_PX, (cfg.y1_km - k[1]) / OUT_KM_PER_PX)

    for row in rows:
        ox, oy = to_px(row["megisKm"])
        flagged = affine and row["flagged"]
        if affine:
            cx, cy = to_px(row["ctAffineKm"])
            if flagged:
                d.line([(ox, oy), (cx, cy)], fill=(255, 210, 0), width=3)
            s = 7
            d.line([(cx - s, cy - s), (cx + s, cy + s)], fill=(20, 60, 255), width=3)
            d.line([(cx - s, cy + s), (cx + s, cy - s)], fill=(20, 60, 255), width=3)
        d.ellipse([ox - 7, oy - 7, ox + 7, oy + 7], outline=(230, 20, 20), width=3)
        label = f"{row['id']} {row['residualKm']:.0f}km" if affine else row["id"]
        _text(d, (ox + 9, oy - 18), label, (255, 235, 90) if flagged else (255, 255, 255), f)
    _text(d, (14, 10), title, (255, 255, 255), _font(20))
    return im


# ---------------------------------------------------------------------------------------------- main
def run() -> dict:
    cfg = config.load()
    root = config.ROOT
    doc, pts = load_points(root / "data" / "qa" / "ct1980-points.json")
    ct = np.array(Image.open(root / doc["image"]).convert("RGB"))
    relief = np.array(Image.open(cfg.out / "preview" / "relief.png").convert("RGB"))
    H, W = relief.shape[:2]
    assert abs(W * OUT_KM_PER_PX - (cfg.x1_km - cfg.x0_km)) < 1e-6 and \
        abs(H * OUT_KM_PER_PX - (cfg.y1_km - cfg.y0_km)) < 1e-6, "relief.png must cover the frame at OUT_KM_PER_PX"

    px = np.array([p["px"] for p in pts], dtype=float)
    km = np.array([p["megisKm"] for p in pts], dtype=float)
    conf = np.array([int(p.get("confidence", 2)) for p in pts])
    use = np.array([p.get("fit", True) for p in pts], dtype=bool)
    w = by_conf(FIT_WEIGHT, conf)

    # --- affine
    M = fit_affine(px[use], km[use], w[use])
    rows = residual_table(pts, px, km, conf, use, M)
    res = np.array([r["residualKm"] for r in rows])
    rms = float(np.sqrt(np.mean(res[use] ** 2)))
    wrms = float(np.sqrt(np.sum(w[use] * res[use] ** 2) / np.sum(w[use])))
    good = use & (conf >= 2)
    rms_good = float(np.sqrt(np.mean(res[good] ** 2)))
    info = describe_affine(M)
    sim_scale, sim_rms = similarity_rms(px[use], km[use])
    rows_sorted = sorted(rows, key=lambda r: -r["residualKm"])
    flagged = [r for r in rows_sorted if r["flagged"]]
    local = [r for r in sorted(rows, key=lambda r: -r["localResidualKm"]) if r["localFlag"]]

    print(f"[overlay] {len(pts)} control points ({int(use.sum())} used in fits); affine CT px -> ME-GIS km: "
          f"{info['kmPerPxX']:.4f} x {info['kmPerPxY']:.4f} km/px (y/x {info['aspectYoverX']:.3f}), "
          f"rotation {info['rotationDeg']:+.2f} deg, shear {info['shearKmPerPx']:+.4f}")
    print(f"[overlay] affine RMS {rms:.1f} km (weighted {wrms:.1f}; confidence>=2 only {rms_good:.1f}; "
          f"median {np.median(res[use]):.1f}); flag threshold {FLAG_KM:.0f} km")
    print(f"[overlay] isotropic similarity fit for comparison: {sim_scale:.4f} km/px, RMS {sim_rms:.1f} km "
          f"(the gap to the affine RMS is the global aspect/shear difference between the two maps)")
    print(f"[overlay] {'id':22s} conf  resid    dx     dy    LOO  local")
    for r in rows_sorted:
        mark = ("  <-- FLAG" if r["flagged"] else "") + (" (local)" if r["localFlag"] else "")
        fit = "" if r["usedInFit"] else " [not fitted]"
        print(f"[overlay] {r['id']:22s} {r['confidence']:>3d} {r['residualKm']:6.1f} {r['dxKm']:6.1f} {r['dyKm']:6.1f} "
              f"{r['looResidualKm']:6.1f} {r['localResidualKm']:6.1f}{mark}{fit}")

    # --- warps
    gx, gy = frame_grid(cfg, W, H)
    ax, ay = affine_maps(invert_affine(M), gx, gy)
    warped_aff = warp_ct(ct, ax, ay)
    tx, ty, tps = tps_maps(km[use], px[use], conf[use], gx, gy)
    warped_tps = warp_ct(ct, tx, ty)
    scale = 0.5 * (abs(info["kmPerPxX"]) + abs(info["kmPerPxY"]))
    bend_km = np.hypot(tx - ax, ty - ay) * scale  # how far the TPS departs from the affine, per output pixel
    tps_res_km = np.hypot(*(tps(km[use]) - px[use]).T) * scale

    out_dir = cfg.out / "preview"
    out_dir.mkdir(parents=True, exist_ok=True)
    tps_img = draw_markers(compose(relief, warped_tps), cfg, rows, affine=False, title=(
        "CT 1980 'West of Middle-earth', thin-plate-spline warp (pinned at the red control points) over the baked relief"))
    tps_img.save(out_dir / "overlay-ct1980.png")
    aff_img = draw_markers(compose(relief, warped_aff), cfg, rows, affine=True, title=(
        f"CT 1980, affine-only warp over the baked relief - RMS {rms:.1f} km. Red o = ours, blue x = CT, "
        f"yellow line = residual > {FLAG_KM:.0f} km"))
    aff_img.save(out_dir / "overlay-ct1980-affine.png")

    report = {
        "version": 1,
        "image": doc["image"],
        "points": len(pts),
        "pointsUsedInFit": int(use.sum()),
        "flagThresholdKm": FLAG_KM,
        "affine": {
            "matrixPxToKm": [[round(float(v), 8) for v in row] for row in M.tolist()],
            "notes": "km = [px_x, px_y, 1] @ matrix (CT pixel y down, ME-GIS km y north); least-squares weights by "
                     "confidence " + json.dumps(FIT_WEIGHT),
            **{k: round(v, 5) for k, v in info.items()},
            "rmsKm": round(rms, 2),
            "weightedRmsKm": round(wrms, 2),
            "rmsKmConfidence2plus": round(rms_good, 2),
            "medianKm": round(float(np.median(res[use])), 2),
        },
        "similarity": {
            "notes": "isotropic scale + rotation + shift, for comparison with the affine",
            "kmPerPx": round(sim_scale, 5),
            "rmsKm": round(sim_rms, 2),
        },
        "tps": {
            "kernel": "thin_plate_spline",
            "direction": "ME-GIS km -> CT px",
            "smoothingByConfidence": TPS_SMOOTHING,
            "maxResidualAtControlKm": round(float(tps_res_km.max()), 2),
            "meanBendFromAffineInFrameKm": round(float(bend_km.mean()), 1),
            "maxBendFromAffineInFrameKm": round(float(bend_km.max()), 1),
        },
        "local": {
            "notes": "localResidualKm = leave-one-out prediction error of a smoothed TPS (CT px -> km) fitted to the "
                     "other points: disagreement with the neighbours' drawing differences.",
            "smoothingByConfidence": LOCAL_SMOOTHING,
        },
        "flagged": [r["id"] for r in flagged],
        "localFlagged": [r["id"] for r in local],
        "residuals": rows_sorted,
        "outputs": ["data/baked/preview/overlay-ct1980.png", "data/baked/preview/overlay-ct1980-affine.png"],
    }
    (out_dir / "overlay-ct1980.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[overlay] TPS: max control residual {tps_res_km.max():.2f} km; departs from the affine by "
          f"{bend_km.mean():.1f} km on average, {bend_km.max():.1f} km at most, inside the frame")
    print(f"[overlay] flagged affine > {FLAG_KM:.0f} km ({len(flagged)}): {', '.join(r['id'] for r in flagged) or 'none'}")
    print(f"[overlay] flagged local > {FLAG_KM:.0f} km ({len(local)}): {', '.join(r['id'] for r in local) or 'none'}")
    for p in ("overlay-ct1980.png", "overlay-ct1980-affine.png", "overlay-ct1980.json"):
        print(f"[overlay] wrote {out_dir / p}")
    return report


def main(argv: list[str] | None = None) -> None:
    run()


if __name__ == "__main__":  # pragma: no cover
    main()
