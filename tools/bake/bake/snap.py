"""Thalweg snap: ME-GIS centrelines onto the DEM valley floor, before the profiles are fitted.

The ME-GIS river vectors are laterally offset from the Arda DEM valleys in places (a vector running on a
valley flank or across a spur while the valley floor lies a few km to one side). A monotone profile
along such a vector has to cut sills that are not there in the terrain (the Brown Lands, the Gladden
Fields, stream-41 …). So each processed centreline is moved, within a class-dependent lateral window
(world.json rivers.snap.windowKm), onto the lowest continuous path of the relief:

  • chains — a line and the continuation its stem carries on into (main feeder → continuation) are
    snapped as ONE path, so a continuation node moves with both lines;
  • candidates — offsets o along the normals of a smoothed copy of the line (steps of stepKm), limited
    by the window, by the bend radius on the inner side of a bend (no loops), off the sea, off lakes and
    off other lines' channels (except near the end where two lines join);
  • cost — Σ ds·(h_pre(p + o·n) + offsetCost·|o|) + bendCost·Δo²/ds (a Viterbi dynamic programme over
    all samples, at most maxStep grid steps per sample): the lowest continuous path that stays close
    to the ME-GIS course;
  • topology — ends at the sea, at a lake, at the frame edge or at a shared node are pinned (the window
    tapers to 0 over pinTaper × window from them; a node already moved by an earlier chain is followed);
    a tributary / side feeder end and a distributary start stay free and are re-attached to the snapped
    parent afterwards (hydro.solve), so every confluence, lake inlet / outlet and mouth is preserved.

Deterministic: fixed grids, ordered loops, argmin tie-breaks. Returns per-class shift statistics
(distance of the snapped line from the raw ME-GIS geometry) for the bake report.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

from .config import Config
from .hydro import End, Lake, Line, arclen, bilinear, lake_raster, normals, oriented_coords, oriented_ends, resample, smooth_centreline

INF = 1e12


def _smoothstep(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def _pinned(end: End, ref: tuple) -> bool:
    """A chain end that must stay where ME-GIS puts it (the sea, a lake, the frame edge, a shared node);
    tributary / side-feeder ends and distributary starts are re-attached to the snapped parent instead,
    free sources may move."""
    if end.kind in ("sea", "lake") or end.node.startswith("frame"):
        return True
    if ref[0] == "line":
        return False
    return end.kind != "free"


def _viterbi(C: np.ndarray, step: float, ds: float, lam: float, kmax: int) -> np.ndarray:
    """Lowest-cost path through C[i, j] (n samples × m offsets) moving at most kmax columns per sample,
    each move of k columns costing lam·(k·step)²/ds. Returns the column per sample."""
    n, m = C.shape
    acc = C[0].copy()
    back = np.zeros((n, m), np.int8)
    shifts = [0] + [s for k in range(1, kmax + 1) for s in (-k, k)]  # tie-break: straight on first
    for i in range(1, n):
        best = np.full(m, INF * 4)
        arg = np.zeros(m, np.int8)
        for k in shifts:
            src = np.full(m, INF * 4)
            if k > 0:
                src[k:] = acc[:-k]
            elif k < 0:
                src[:k] = acc[-k:]
            else:
                src = acc
            cand = src + lam * (k * step) ** 2 / ds
            better = cand < best
            best = np.where(better, cand, best)
            arg = np.where(better, k, arg)
        acc = np.minimum(best + C[i], INF * 4)
        back[i] = arg
    j = int(np.argmin(acc))
    path = np.empty(n, np.int64)
    for i in range(n - 1, -1, -1):
        path[i] = j
        j -= int(back[i, j])
    return path


def snap_lines(cfg: Config, lines: list[Line], h_pre: np.ndarray, land: np.ndarray, lakes: dict[str, Lake], main_feeder: dict[int, int], rank: dict, log: list) -> dict:
    """Move every line's processed centreline (l.pts, 0.1 km) onto the valley floor (see the module doc).
    Needs l.pts and l.s; sets l.pts (0.1 km, re-smoothed) and l.snap (max / mean shift, km)."""
    R = cfg.world["rivers"]
    S = R.get("snap") or {}
    if not S.get("windowKm"):
        return {}
    win_by = S["windowKm"]
    dstep = float(S.get("stepKm", 0.1))
    mu = float(S.get("offsetCost", 0.1))
    lam = float(S.get("bendCost", 1.0))
    kmax = int(S.get("maxStep", 2))
    ds = float(S.get("sampleKm", 0.25))
    post = float(S.get("smoothKm", 0.5))
    taper_k = float(S.get("pinTaper", 2.0))
    margin = float(S.get("otherMarginKm", 0.3))
    join_zone = float(S.get("joinZoneKm", 3.0))
    joint_km = float(S.get("jointFrameKm", 1.5))
    sig = float(R.get("smoothKm", 0.6))
    hs = ndimage.gaussian_filter(h_pre, 1.0).astype(np.float32)  # 0.4 km: DEM pixel noise
    lake_any = lake_raster(cfg, lakes)
    by_node: dict[str, list[int]] = {}
    for l in lines:
        up, dn = oriented_ends(l)
        by_node.setdefault(up.node, []).append(l.idx)
        by_node.setdefault(dn.node, []).append(l.idx)

    # chains: main feeder → continuation (the stem's line-to-line joins)
    nxt = {f: j for j, f in sorted(main_feeder.items())}
    has_prev = set(nxt.values())
    chains: list[list[int]] = []
    covered: set[int] = set()
    for l in lines:
        if l.idx in has_prev:
            continue
        ch = [l.idx]
        while ch[-1] in nxt and nxt[ch[-1]] not in ch:
            ch.append(nxt[ch[-1]])
        chains.append(ch)
        covered |= set(ch)
    chains += [[l.idx] for l in lines if l.idx not in covered]
    chains.sort(key=lambda ch: (-max(rank[lines[i].cls] for i in ch), -sum(float(lines[i].s[-1]) for i in ch), ch[0]))

    raw = {l.idx: resample(oriented_coords(l), 0.1) for l in lines}
    node_shift: dict[str, np.ndarray] = {}
    done: set[int] = set()
    for ch in chains:
        members = set(ch)
        segs = [resample(lines[i].pts, ds) for i in ch]
        bounds = np.cumsum([0] + [len(p) for p in segs])
        P = np.concatenate(segs)
        n = len(P)
        # a continuation node is one place: the feeder's last sample and the continuation's first sample
        # (ME-GIS ends clustered within the node tolerance) start from their common midpoint
        for k in range(1, len(ch)):
            b = int(bounds[k])
            P[b - 1] = P[b] = 0.5 * (P[b - 1] + P[b])
        head, tail = lines[ch[0]], lines[ch[-1]]
        up_end, dn_end = oriented_ends(head)[0], oriented_ends(tail)[1]
        s = arclen(P)
        if s[-1] < 1.5 or n < 6:
            continue
        # a pinned end at a node an earlier chain moved follows that node
        for which, end in ((0, up_end), (-1, dn_end)):
            sh = node_shift.get(end.node)
            if sh is not None and np.hypot(*sh) > 1e-6:
                dist = s if which == 0 else s[-1] - s
                L = max(2.0, 3.0 * float(np.hypot(*sh)))
                P = P + sh[None] * _smoothstep(1 - dist / L)[:, None]
        pin0, pin1 = _pinned(up_end, head.up), _pinned(dn_end, tail.down)
        # window per sample: the line's class window, eased across class changes, tapered at pinned ends
        W = np.concatenate([np.full(len(p), float(win_by.get(lines[i].cls, 0.0))) for i, p in zip(ch, segs)])
        W = ndimage.gaussian_filter1d(W, 2.0 / ds, mode="nearest")
        Wmax = float(W.max())
        if Wmax < dstep:
            continue
        if pin0:
            W *= _smoothstep(s / np.maximum(taper_k * W, 1e-3))
        if pin1:
            W *= _smoothstep((s[-1] - s) / np.maximum(taper_k * W, 1e-3))
        # frame, per line of the chain (its own window): normals of a smoothed copy; the inner side of a
        # bend is limited to 0.7 × its radius
        Ns, KP, KN = [], [], []
        for k, i in enumerate(ch):
            Pl = P[bounds[k] : bounds[k + 1]]
            wl = float(win_by.get(lines[i].cls, 0.0))
            Ps = smooth_centreline(Pl, max(1.0, 0.4 * wl), ds) if len(Pl) >= 5 else Pl
            Ns.append(normals(Ps))
            t = np.gradient(Ps, axis=0)
            kap = np.gradient(np.unwrap(np.arctan2(t[:, 1], t[:, 0]))) / ds
            size = max(3, int(2 * wl / ds) | 1)
            KP.append(ndimage.maximum_filter1d(np.maximum(kap, 0), size, mode="nearest"))
            KN.append(ndimage.maximum_filter1d(np.maximum(-kap, 0), size, mode="nearest"))
        N, kp, kn = np.concatenate(Ns), np.concatenate(KP), np.concatenate(KN)
        # continuation nodes: the junction sample is the last point of one line AND the first of the next
        # (two samples, one place). Both lines' frames ease into one shared normal over joinFrameKm on
        # either side, and the node takes one shared offset below — so the node moves as ONE point and
        # the feeder still ends exactly where its continuation starts
        joints = [int(bounds[k]) for k in range(1, len(ch))]
        for b in joints:
            nj = N[b - 1] + N[b]
            ln = float(np.hypot(*nj))
            nj = nj / ln if ln > 1e-6 else N[b]
            wj = _smoothstep(1.0 - np.abs(s - s[b]) / joint_km)[:, None]
            N = N * (1 - wj) + nj[None] * wj
            N /= np.maximum(np.hypot(*N.T), 1e-9)[:, None]
            N[b - 1] = N[b] = nj
        hi = np.minimum(W, 0.7 / np.maximum(kp, 1e-9))
        lo = -np.minimum(W, 0.7 / np.maximum(kn, 1e-9))
        J = int(np.ceil(Wmax / dstep))
        offs = np.arange(-J, J + 1) * dstep
        m = len(offs)
        valid = (offs[None, :] <= hi[:, None] + 1e-9) & (offs[None, :] >= lo[:, None] - 1e-9)
        valid[:, J] = True
        Q = P[:, None, :] + N[:, None, :] * offs[None, :, None]
        ii, jj = np.nonzero(valid)
        q = Q[ii, jj]
        hv = bilinear(cfg, hs, q)
        bad = (bilinear(cfg, land, q) < 0.5) | (bilinear(cfg, lake_any, q) > 0.5)
        # other lines' channels (current positions): excluded, except where this chain ends at / starts
        # from them (the join zones at its ends) and except their own join zones on this chain
        pts_o, own_o = [], []
        for l in lines:
            if l.idx in members:
                continue
            p = l.pts if l.idx in done else raw[l.idx]
            so = arclen(p)
            up, dn = oriented_ends(l)
            keep = np.ones(len(p), bool)
            joins_up = (l.up[0] == "line" and l.up[1] in members) or any(j in members for j in by_node.get(up.node, []))
            joins_dn = (l.down[0] == "line" and l.down[1] in members) or any(j in members for j in by_node.get(dn.node, []))
            zone = float(win_by.get(l.cls, 0.0)) + Wmax + join_zone
            if joins_up:
                keep &= so > zone
            if joins_dn:
                keep &= so < so[-1] - zone
            sel = p[keep][::2]
            pts_o.append(sel)
            own_o.append(np.full(len(sel), l.idx))
        if pts_o and sum(len(p) for p in pts_o):
            PO = np.concatenate(pts_o)
            OW = np.concatenate(own_o)
            cores = np.array([l.core for l in lines])[OW]
            dq, kq = cKDTree(PO).query(q, k=4, distance_upper_bound=float(cores.max()) + margin + 0.2)
            # the lines this chain joins at its start / end may be approached near that end only
            p0 = {j for j in by_node.get(up_end.node, []) if j not in members}
            p1 = {j for j in by_node.get(dn_end.node, []) if j not in members}
            if head.up[0] == "line":
                p0.add(head.up[1])
            if tail.down[0] == "line":
                p1.add(tail.down[1])
            near0 = s[ii] < Wmax + join_zone
            near1 = s[-1] - s[ii] < Wmax + join_zone
            hit = np.zeros(len(q), bool)
            for c in range(dq.shape[1]):
                ok = np.isfinite(dq[:, c])
                idx = np.where(ok, kq[:, c], 0)
                own = OW[idx]
                free = (np.isin(own, sorted(p0)) & near0) | (np.isin(own, sorted(p1)) & near1)
                hit |= ok & (dq[:, c] < cores[idx] + margin) & ~free
            bad |= hit
        bad &= jj != J
        C = np.full((n, m), INF)
        C[ii, jj] = np.where(bad, INF, ds * (hv + mu * np.abs(offs[jj])))
        path = _viterbi(C, dstep, ds, lam, kmax)
        o = offs[path]
        o = ndimage.gaussian_filter1d(o, post / ds, mode="nearest")
        o = np.clip(o, lo, hi)
        for b in joints:
            o[b - 1] = o[b] = 0.5 * (o[b - 1] + o[b])
        P2 = P + N * o[:, None]
        for k, i in enumerate(ch):
            l = lines[i]
            seg = P2[bounds[k] : bounds[k + 1]]
            old_up, old_dn = l.pts[0].copy(), l.pts[-1].copy()
            l.pts = smooth_centreline(resample(seg, 0.1), sig, 0.1)
            up, dn = oriented_ends(l)
            node_shift.setdefault(up.node, l.pts[0] - old_up)
            node_shift.setdefault(dn.node, l.pts[-1] - old_dn)
            done.add(i)

    # shift statistics against the raw ME-GIS geometry
    stats: dict[str, dict] = {}
    worst: list[tuple] = []
    for l in lines:
        d, _ = cKDTree(raw[l.idx]).query(l.pts)
        l.snap = (float(d.max()), float(d.mean()))
        st = stats.setdefault(l.cls, {"lines": 0, "maxKm": 0.0, "sumKm": 0.0, "n": 0, "over1Km": 0.0})
        st["lines"] += 1
        st["maxKm"] = max(st["maxKm"], float(d.max()))
        st["sumKm"] += float(d.sum())
        st["n"] += len(d)
        st["over1Km"] += float((d > 1.0).sum()) * 0.1
        worst.append((float(d.max()), l.idx))
    out = {c: {"lines": v["lines"], "maxKm": round(v["maxKm"], 2), "meanKm": round(v["sumKm"] / max(v["n"], 1), 3), "over1Km": round(v["over1Km"], 1)} for c, v in sorted(stats.items(), key=lambda kv: -rank[kv[0]])}
    log.append("snap: " + "; ".join(f"{c} {v['lines']} lines, max {v['maxKm']} km, mean {v['meanKm']} km, {v['over1Km']} km of river > 1 km off" for c, v in out.items()))
    worst.sort(key=lambda w: (-w[0], w[1]))
    log.append("snap: largest shifts " + ", ".join(f"{lines[i].id or lines[i].name} {d:.1f} km" for d, i in worst[:8]))
    return {"byClass": out, "lines": {lines[i].id: round(d, 2) for d, i in sorted(worst, key=lambda w: w[1])}}
