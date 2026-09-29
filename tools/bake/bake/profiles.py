"""Monotone river profiles: water levels that never rise downstream (except at declared falls).

A profile is fitted along a river stem (source → mouth; lines joined end-to-start and lakes between
their inlet and outlet) to target samples = thalweg + water depth, by an asymmetric ("expectile")
isotonic regression: filling a pit costs `fill_weight`× more than cutting a sill, so the water follows
the lower envelope of the terrain and cuts through DEM sills instead of pooling behind them. A sill is
cut at most `max_cut` deep unless that would hold back a pool deeper than `max_pool`. A lake is one
heavily weighted sample (its shore level, symmetric cost) that stays pinned through the smoothing, so
the lake level is decided jointly with the rivers entering and leaving it. Boundary conditions (sea
mouth, confluence = the parent's level, distributary start) are imposed with monotonicity-preserving
ramps; the result is smoothed with each line's own class window (never more than smooth_lower below or
smooth_raise above the fit: no excavated torrent heads, no ramps in the air below a cascade) and given a
minimum gradient. Last, the level is capped by what the banks can hold (cap_profile: level ≤
cummin(upper), never below a held level downstream — the excess where the two conflict is returned so
the caller can end a side feeder at its valley bottom or allow the fill); the drops the cap creates are
smoothed only where it binds.
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
    smooth_lower: float = 0.5  # the smoothing may lower the fitted level at most this much (no excavation)
    smooth_raise: float = 1e9  # ...and raise it at most this much (no water hanging over a cascade's foot)


def close_pits(t: np.ndarray, pk: int, cut_cost: float = 0.0, max_notch: float = 0.0) -> np.ndarray:
    """Targets with the short pits pooled over: a DEM hollow narrower than `pk` samples along the line is
    filled toward the rim that holds it (grey closing), so the river pools over it instead of cutting the
    long reach around it down to its floor. Each pool then takes the level that moves the least terrain
    ("cut where cheap"): lowering the pool by d saves the fill of every pit sample below the rim and costs
    `cut_cost` × the cut of every sill sample downstream that stands above the lowered pool (until the
    terrain drops below it again) — a short, narrow sill is notched (at most `max_notch` deep), a long
    one keeps the full pool. Samples within half a window of the line's ends are left alone (a lake or a
    parent lies beyond them)."""
    n = len(t)
    if pk <= 2 or n <= pk:
        return t.copy()
    from scipy import ndimage

    k2 = pk // 2
    cl = t.copy()
    cl[k2:-k2] = ndimage.grey_closing(t, size=pk, mode="nearest")[k2:-k2]
    if cut_cost <= 0.0 or max_notch <= 0.0:
        return cl
    out = cl.copy()
    pit = cl - t > 1e-3
    i = 0
    while i < n:
        if not pit[i]:
            i += 1
            continue
        a = i
        while i < n and pit[i]:
            i += 1
        b = i - 1
        rim = float(cl[b])
        depth = float((cl[a : b + 1] - t[a : b + 1]).max())
        j0 = b + 1
        while j0 < n and t[j0] > rim:
            j0 += 1
        base = cut_cost * float((t[b + 1 : j0] - rim).sum())  # a sill above the rim is cut anyway
        best_d, best_cost = 0.0, 0.0
        for d in np.round(np.arange(0.1, min(max_notch, depth) + 1e-9, 0.1), 3):
            lvl = rim - float(d)
            j = b + 1
            while j < n and t[j] > lvl:
                j += 1
            if j >= n:
                break  # the terrain never drops below that pool again on this line: no notch drains it
            saved = float(np.minimum(cl[a : b + 1] - t[a : b + 1], d).sum())
            cost = cut_cost * float((t[b + 1 : j] - lvl).sum()) - base - saved
            if cost < best_cost - 1e-9:
                best_d, best_cost = float(d), cost
        if best_d > 0:
            out[a : b + 1] = np.maximum(t[a : b + 1], cl[a : b + 1] - best_d)
    return out


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


def smooth_var(b: np.ndarray, win: np.ndarray) -> np.ndarray:
    """Moving average with a per-sample (odd) window and edge replication, made non-increasing again
    (a window that changes along the stem — a stream feeding a great river — can break monotonicity)."""
    k = (np.asarray(win, dtype=np.int64) // 2).clip(0)
    K = int(k.max()) if len(k) else 0
    if K < 1 or len(b) < 3:
        return b.copy()
    pad = np.concatenate([np.full(K, b[0]), b, np.full(K, b[-1])])
    c = np.concatenate([[0.0], np.cumsum(pad)])
    i = np.arange(len(b)) + K
    lo, hi = i - k, i + k + 1
    return np.minimum.accumulate((c[hi] - c[lo]) / (hi - lo))


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


def cap_profile(b: np.ndarray, upper: np.ndarray, hold: np.ndarray, ds: float, p: FitParams, falls: list[int], wins: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """No perched water: the level never exceeds `upper` (the banks + the allowed fill) anywhere upstream,
    i.e. level ≤ cummin(upper) — except where a held level downstream (`hold`: lakes, the mouth) forces it
    higher (a conflict, returned as the excess over the cap). The drops the cap creates are softened by a
    lowering-only moving average (per-sample class windows `wins`), only within half a window of where
    the cap binds and never more than smooth_lower below the capped level — no excavation of reaches the
    cap does not touch. Returns (level, conflict excess per sample)."""
    n = len(b)
    capv = np.minimum.accumulate(upper)
    need = rev_cummax(hold)
    out = np.minimum(b, np.maximum(capv, need))
    wins = np.full(n, int(round(p.smooth_km / ds)) | 1) if wins is None else wins
    bind = np.nonzero(b - out > 1e-3)[0]
    if bind.size:
        half = wins // 2
        mark = np.zeros(n + 1, np.int64)
        np.add.at(mark, np.clip(bind - half[bind], 0, n), 1)
        np.add.at(mark, np.clip(bind + half[bind] + 1, 0, n), -1)
        zone = np.cumsum(mark)[:n] > 0
        cuts = sorted({i for i in falls if 0 <= i < n - 1})
        for i0, i1 in zip([0, *[f + 1 for f in cuts]], [*cuts, n - 1]):
            sl = slice(i0, i1 + 1)
            seg = out[sl]
            if not zone[sl].any():
                continue
            sm = np.maximum(np.minimum(seg, smooth_var(seg, wins[sl])), seg - p.smooth_lower)
            seg = np.minimum.accumulate(np.where(zone[sl], sm, seg))
            out[sl] = min_grade(seg, ds, p.min_grade)
    out = np.maximum(out, need)
    return out, np.maximum(0.0, need - capv)


def fit_profile(t: np.ndarray, ds: float, p: FitParams, E: float | None, S: float | None, falls: list[int], cap: np.ndarray, bw: np.ndarray | None = None, fw: np.ndarray | None = None, pins: list[int] | None = None, upper: np.ndarray | None = None, win_km: np.ndarray | None = None) -> tuple[np.ndarray, list[tuple[int, float]], np.ndarray]:
    """Level profile for targets `t` (source → mouth).

    E: level at the mouth (exact), S: level at the source (exact). One isotonic fit over the whole stem
    decides where the water drops; `falls` = sample indices f where it may stay a sharp drop between
    samples f and f+1 — smoothing and the minimum gradient never cross a fall, everywhere else drops are
    smoothed into slopes. `bw` base weights (default 1), `fw` fill weights (default p.fill_weight),
    `pins` samples held through smoothing (lakes), `upper` the highest level the banks can hold at each
    sample (cap_profile), `win_km` the smoothing window per sample (default p.smooth_km; the class of
    the line the sample belongs to). The smoothing never lowers the fit by more than p.smooth_lower nor
    raises it by more than p.smooth_raise (a steep drop stays a cascade instead of a ramp in the air).
    Returns (level, [(f, drop)], conflict excess over `upper`)."""
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
    wins = np.round((np.full(n, p.smooth_km) if win_km is None else np.asarray(win_km, dtype=np.float64)) / ds).astype(np.int64) | 1
    b0 = b.copy()
    for i0, i1 in zip([0, *[f + 1 for f in cuts]], [*cuts, n - 1]):
        sl = slice(i0, i1 + 1)
        # per segment: a moving average of a monotone run stays monotone, and it only ever raises the
        # segment's last sample / lowers its first, so every fall keeps (or grows) its drop; it may not
        # dig the level more than smooth_lower below the fit (a steep torrent keeps its own profile
        # instead of being averaged down at its head)
        seg = np.minimum(np.maximum(smooth_var(b[sl], wins[sl]), b0[sl] - p.smooth_lower), b0[sl] + p.smooth_raise)
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
        b, excess = cap_profile(b, upper, hold, ds, p, cuts, wins)
        if S is not None:
            b[0] = min(b[0], S)
    return b, [(f, float(b[f] - b[f + 1])) for f in cuts], excess
