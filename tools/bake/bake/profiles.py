"""Monotone river profiles: water levels that never rise downstream (except at declared falls).

A profile is fitted along a river stem (source → mouth; lines joined end-to-start and lakes between
their inlet and outlet) to target samples = thalweg + water depth, by an asymmetric ("expectile")
isotonic regression: filling a pit costs `fill_weight`× more than cutting a sill, so the water follows
the lower envelope of the terrain and cuts through DEM sills instead of pooling behind them. A sill is
cut at most `max_cut` deep unless that would hold back a pool deeper than `max_pool`. A lake is one
heavily weighted sample (its shore level, symmetric cost) that stays pinned through the smoothing, so
the lake level is decided jointly with the rivers entering and leaving it. Boundary conditions (sea
mouth, confluence = the parent's level, distributary start) are imposed with monotonicity-preserving
ramps; the result is smoothed and given a minimum gradient. Last, the level is capped by what the banks
can hold (cap_profile: level ≤ cummin(upper), never below a held level downstream — the excess where the
two conflict is returned so the caller can end a side feeder at its valley bottom or allow the fill).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import isotonic_regression


@dataclass
class FitParams:
    fill_weight: float = 8.0
    iterations: int = 6
    max_cut: float = 2.0
    max_pool: float = 0.5  # the cut cap is raised wherever it would hold back a pool deeper than this
    smooth_km: float = 2.0
    min_grade: float = 0.002  # world units per km
    ramp_km: float = 3.0
    ramp_grade: float = 0.08  # preferred steepest boundary ramp, units per km


def rev_cummax(x: np.ndarray) -> np.ndarray:
    return np.maximum.accumulate(x[::-1])[::-1]


def iso_dec(y: np.ndarray, w: np.ndarray) -> np.ndarray:
    return isotonic_regression(y, weights=w, increasing=False).x


def expectile_iso(t: np.ndarray, p: FitParams, cap: np.ndarray, bw: np.ndarray, fw: np.ndarray) -> np.ndarray:
    b = iso_dec(t, bw)
    for _ in range(p.iterations):
        b = iso_dec(t, bw * np.where(b > t, fw, 1.0))
    # a sill may only be cut `max_cut` deep: what it cannot cut it holds back (pool upstream) — but
    # never a pool deeper than max_pool above the lowest target upstream of the sill (then it cuts)
    cap = np.maximum(cap, t - np.minimum.accumulate(t) - p.max_pool)
    return rev_cummax(np.maximum(b, t - cap))


def smooth_mono(b: np.ndarray, win: int) -> np.ndarray:
    """Moving average with edge replication: keeps a non-increasing sequence non-increasing."""
    if win < 2 or len(b) < 3:
        return b.copy()
    k = win // 2
    pad = np.concatenate([np.full(k, b[0]), b, np.full(k, b[-1])])
    c = np.concatenate([[0.0], np.cumsum(pad)])
    n = 2 * k + 1
    return (c[n:] - c[:-n]) / n


def ramp(n: int) -> np.ndarray:
    """0 → 1 smoothstep over n samples (non-decreasing)."""
    if n <= 1:
        return np.ones(max(n, 0))
    x = np.linspace(0.0, 1.0, n)
    return x * x * (3 - 2 * x)


def ramp_len(gap: float, ds: float, n_total: int, p: FitParams) -> int:
    km = max(p.ramp_km, abs(gap) / p.ramp_grade)
    return int(min(n_total, max(2, round(km / ds))))


def impose_end(b: np.ndarray, E: float, ds: float, p: FitParams) -> np.ndarray:
    """b ≥ E everywhere and b[-1] == E (monotone-preserving ramp)."""
    b = np.maximum(b, E)
    gap = E - b[-1]  # ≤ 0
    if gap < 0:
        n = ramp_len(gap, ds, len(b), p)
        b[-n:] += gap * ramp(n)
    b[-1] = E
    return b


def impose_start(b: np.ndarray, S: float, ds: float, p: FitParams) -> np.ndarray:
    """b ≤ S everywhere and b[0] == S (monotone-preserving ramp)."""
    b = np.minimum(b, S)
    gap = S - b[0]  # ≥ 0
    if gap > 0:
        n = ramp_len(gap, ds, len(b), p)
        b[:n] += gap * (1 - ramp(n))
    b[0] = S
    return b


def min_grade(b: np.ndarray, ds: float, g: float) -> np.ndarray:
    """Forward pass: every sample at least g·ds below its upstream neighbour."""
    out = b.copy()
    step = g * ds
    for i in range(1, len(out)):
        if out[i] > out[i - 1] - step:
            out[i] = out[i - 1] - step
    return out


def pin(b: np.ndarray, i: int, v: float) -> np.ndarray:
    """Hold sample i at v: everything upstream ≥ v, everything downstream ≤ v (stays monotone)."""
    b[:i] = np.maximum(b[:i], v)
    b[i] = v
    b[i + 1 :] = np.minimum(b[i + 1 :], v)
    return b


def cap_profile(b: np.ndarray, upper: np.ndarray, hold: np.ndarray, ds: float, p: FitParams, falls: list[int]) -> tuple[np.ndarray, np.ndarray]:
    """No perched water: the level never exceeds `upper` (the banks + the allowed fill) anywhere upstream,
    i.e. level ≤ cummin(upper) — except where a held level downstream (`hold`: lakes, the mouth) forces it
    higher (a conflict, returned as the excess over the cap). The drops the cap creates are softened by a
    lowering-only moving average per fall-free segment. Returns (level, conflict excess per sample)."""
    n = len(b)
    capv = np.minimum.accumulate(upper)
    need = rev_cummax(hold)
    out = np.minimum(b, np.maximum(capv, need))
    win = int(round(p.smooth_km / ds)) | 1
    cuts = sorted({i for i in falls if 0 <= i < n - 1})
    for i0, i1 in zip([0, *[f + 1 for f in cuts]], [*cuts, n - 1]):
        sl = slice(i0, i1 + 1)
        seg = out[sl]
        seg = np.minimum(seg, smooth_mono(seg, win))
        out[sl] = min_grade(seg, ds, p.min_grade)
    out = np.maximum(out, need)
    return out, np.maximum(0.0, need - capv)


def fit_profile(t: np.ndarray, ds: float, p: FitParams, E: float | None, S: float | None, falls: list[int], cap: np.ndarray, bw: np.ndarray | None = None, fw: np.ndarray | None = None, pins: list[int] | None = None, upper: np.ndarray | None = None) -> tuple[np.ndarray, list[tuple[int, float]], np.ndarray]:
    """Level profile for targets `t` (source → mouth).

    E: level at the mouth (exact), S: level at the source (exact). One isotonic fit over the whole stem
    decides where the water drops; `falls` = sample indices f where it may stay a sharp drop between
    samples f and f+1 — smoothing and the minimum gradient never cross a fall, everywhere else drops are
    smoothed into slopes. `bw` base weights (default 1), `fw` fill weights (default p.fill_weight),
    `pins` samples held through smoothing (lakes), `upper` the highest level the banks can hold at each
    sample (cap_profile). Returns (level, [(f, drop)], conflict excess over `upper`)."""
    n = len(t)
    bw = np.ones(n) if bw is None else bw
    fw = np.full(n, p.fill_weight) if fw is None else fw
    pins = sorted(pins or [])
    b = expectile_iso(t, p, cap, bw, fw)
    if E is not None:
        b = np.maximum(b, E)
    if S is not None:
        b = np.minimum(b, S)
    held = [(i, float(b[i])) for i in pins]
    cuts = sorted({i for i in falls if 0 <= i < n - 1})
    win = int(round(p.smooth_km / ds)) | 1
    for i0, i1 in zip([0, *[f + 1 for f in cuts]], [*cuts, n - 1]):
        sl = slice(i0, i1 + 1)
        # per segment: a moving average of a monotone run stays monotone, and it only ever raises the
        # segment's last sample / lowers its first, so every fall keeps (or grows) its drop
        seg = smooth_mono(b[sl], win)
        for i, v in held:
            if i0 <= i <= i1:
                seg = pin(seg, i - i0, v)
        seg = min_grade(seg, ds, p.min_grade)
        for i, v in held:
            if i0 <= i <= i1:
                seg = pin(seg, i - i0, v)
        b[sl] = seg
    if E is not None:
        b = impose_end(b, E, ds, p)
    if S is not None:
        b = impose_start(b, S, ds, p)
    excess = np.zeros(n)
    if upper is not None:
        hold = np.full(n, -np.inf)
        for i, v in held:
            hold[i] = v
        if E is not None:
            hold[-1] = max(hold[-1], E)
        b, excess = cap_profile(b, upper, hold, ds, p, cuts)
        if S is not None:
            b[0] = min(b[0], S)
    return b, [(f, float(b[f] - b[f + 1])) for f in cuts], excess
