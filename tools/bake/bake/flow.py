"""Terrain analysis kernels (numba, serial → bit-deterministic).

- horizon_ao:  large-scale ambient occlusion from the horizon angle in N directions (exaggerated
               heights, so the occlusion matches what the renderer shows).
- flow_accum:  Priority-Flood+ε depression filling (Barnes et al. 2014) seeded at the sea / frame edge;
               every cell drains to the neighbour it was flooded from, accumulation runs in reverse
               flood order. A binary heap with an insertion counter breaks height ties, so the result
               never depends on thread timing or float summation order.
"""
from __future__ import annotations

import numpy as np
from numba import njit


@njit(cache=True)
def horizon_ao(h: np.ndarray, px_km: float, dirs: np.ndarray, max_km: float) -> np.ndarray:
    H, W = h.shape
    out = np.empty((H, W), np.float32)
    nd = dirs.shape[0]
    for r in range(H):
        for c in range(W):
            h0 = h[r, c]
            acc = 0.0
            for k in range(nd):
                dx = dirs[k, 0]
                dy = dirs[k, 1]
                best = 0.0
                t = 1.0
                while t * px_km < max_km:
                    x = c + dx * t
                    y = r + dy * t
                    if x < 0.0 or y < 0.0 or x > W - 1.0 or y > H - 1.0:
                        break
                    xi = int(x)
                    yi = int(y)
                    fx = x - xi
                    fy = y - yi
                    x1 = min(xi + 1, W - 1)
                    y1 = min(yi + 1, H - 1)
                    a = h[yi, xi] + (h[yi, x1] - h[yi, xi]) * fx
                    b = h[y1, xi] + (h[y1, x1] - h[y1, xi]) * fx
                    hh = a + (b - a) * fy
                    tan = (hh - h0) / (t * px_km)
                    if tan > best:
                        best = tan
                    t += max(1.0, t * 0.18)
                acc += 1.0 - best / np.sqrt(1.0 + best * best)
            out[r, c] = acc / nd
    return out


@njit(cache=True)
def _push(hk, hc, hi, n, key, cnt, idx):
    i = n
    hk[i] = key
    hc[i] = cnt
    hi[i] = idx
    while i > 0:
        p = (i - 1) >> 1
        if hk[p] < hk[i] or (hk[p] == hk[i] and hc[p] < hc[i]):
            break
        hk[p], hk[i] = hk[i], hk[p]
        hc[p], hc[i] = hc[i], hc[p]
        hi[p], hi[i] = hi[i], hi[p]
        i = p
    return n + 1


@njit(cache=True)
def _pop(hk, hc, hi, n):
    top = hi[0]
    n -= 1
    hk[0] = hk[n]
    hc[0] = hc[n]
    hi[0] = hi[n]
    i = 0
    while True:
        l = 2 * i + 1
        r = l + 1
        m = i
        if l < n and (hk[l] < hk[m] or (hk[l] == hk[m] and hc[l] < hc[m])):
            m = l
        if r < n and (hk[r] < hk[m] or (hk[r] == hk[m] and hc[r] < hc[m])):
            m = r
        if m == i:
            break
        hk[m], hk[i] = hk[i], hk[m]
        hc[m], hc[i] = hc[i], hc[m]
        hi[m], hi[i] = hi[i], hi[m]
        i = m
    return top, n


@njit(cache=True)
def fill_depressions(h: np.ndarray, seed: np.ndarray) -> np.ndarray:
    """Priority-Flood (Barnes et al. 2014) without ε: every cell's spill level — the lowest water level at
    which it drains to an outlet (`seed` cells, the frame border). Closed depressions come out at their
    rim height, open valleys at their own height. float32 / int32 heap (≈17 bytes per cell)."""
    H, W = h.shape
    N = H * W
    hk = np.empty(N, np.float32)
    hc = np.empty(N, np.int32)
    hi = np.empty(N, np.int32)
    n = 0
    cnt = 0
    done = np.zeros(N, np.bool_)
    filled = np.empty((H, W), np.float32)
    for r in range(H):
        for c in range(W):
            if seed[r, c] or r == 0 or c == 0 or r == H - 1 or c == W - 1:
                i = r * W + c
                done[i] = True
                filled[r, c] = h[r, c]
                n = _push(hk, hc, hi, n, filled[r, c], cnt, i)
                cnt += 1
    while n > 0:
        i, n = _pop(hk, hc, hi, n)
        r = i // W
        c = i - r * W
        f = filled[r, c]
        for dr in range(-1, 2):
            for dc in range(-1, 2):
                if dr == 0 and dc == 0:
                    continue
                rr = r + dr
                cc = c + dc
                if rr < 0 or cc < 0 or rr >= H or cc >= W:
                    continue
                j = rr * W + cc
                if done[j]:
                    continue
                done[j] = True
                v = max(h[rr, cc], f)
                filled[rr, cc] = v
                n = _push(hk, hc, hi, n, v, cnt, j)
                cnt += 1
    return filled


@njit(cache=True)
def flow_accum(h: np.ndarray, seed: np.ndarray, cell_area: float) -> np.ndarray:
    """Upstream area (km²) per cell. `seed` marks outlet cells (sea); the frame border drains too."""
    H, W = h.shape
    N = H * W
    hk = np.empty(N, np.float64)
    hc = np.empty(N, np.int64)
    hi = np.empty(N, np.int64)
    n = 0
    cnt = 0
    done = np.zeros(N, np.bool_)
    down = np.full(N, -1, np.int64)
    order = np.empty(N, np.int64)
    filled = np.empty(N, np.float64)
    for r in range(H):
        for c in range(W):
            if seed[r, c] or r == 0 or c == 0 or r == H - 1 or c == W - 1:
                i = r * W + c
                done[i] = True
                filled[i] = h[r, c]
                n = _push(hk, hc, hi, n, filled[i], cnt, i)
                cnt += 1
    k = 0
    eps = 1e-6
    while n > 0:
        i, n = _pop(hk, hc, hi, n)
        order[k] = i
        k += 1
        r = i // W
        c = i - r * W
        for dr in range(-1, 2):
            for dc in range(-1, 2):
                if dr == 0 and dc == 0:
                    continue
                rr = r + dr
                cc = c + dc
                if rr < 0 or cc < 0 or rr >= H or cc >= W:
                    continue
                j = rr * W + cc
                if done[j]:
                    continue
                done[j] = True
                v = h[rr, cc]
                if v < filled[i] + eps:
                    v = filled[i] + eps
                filled[j] = v
                down[j] = i
                n = _push(hk, hc, hi, n, v, cnt, j)
                cnt += 1
    acc = np.full(N, cell_area, np.float64)
    for q in range(k - 1, -1, -1):
        i = order[q]
        d = down[i]
        if d >= 0:
            acc[d] += acc[i]
    return acc.reshape(H, W)
