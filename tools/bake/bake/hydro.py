"""Hydrology v2: one river network for the carve, the masks and the runtime ribbons.

1. network   canon ME-GIS river lines (clipped to the frame) → a graph: shared endpoints and T-junctions
             (a tributary ending mid-segment) become nodes, lakes are nodes (inlets / outlets), river
             ends in the sea are one sink node. Lines are oriented by topology — multi-source Dijkstra
             from the sinks (the sea; for basins without a sea outlet their lowest node, e.g. the
             endorheic Rhûn / Núrnen), never by comparing end heights.
2. centre    one processed centreline per line (0.1 km resample, Gaussian-smoothed corners with pinned
             ends, junction ends re-snapped onto their parent, resampled every `sampleKm`).
3. profiles  monotone beds per line (profiles.py) solved parents-first: sea mouth → bed < 0, confluence →
             the parent's level, lake inlet → the lake level, lake outlet → the lake level; declared
             falls (world.json rivers.falls) are the only places the surface may drop steeply.
4. lakes     levels from the outlet (or a shore percentile), beds deepened, shores graded to the level.
5. carve     smooth U cross-section into h (only lowers), levee fill beside the channel where the bank is
             lower than the water (so the runtime never needs to drape), valley walls eased.
6. masks     channel / valley / distance rasters from the same centrelines; rivers.json v2 export data.
"""
from __future__ import annotations

import heapq
import re
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from shapely import affinity
from shapely.geometry import LineString, MultiLineString, Point, box

from .cache import q8
from .config import Config, Timer
from .profiles import FitParams, fit_profile
from .vectors import canon_lakes, canon_rivers, norm, raster_mask_window, smooth_band

TOL_KM = 0.3


@dataclass
class End:
    node: str
    kind: str  # 'sea' | 'lake' | 'node' | 'free'
    lake: str | None = None


@dataclass
class Line:
    idx: int
    name: str | None
    cls: str
    width: float
    depth: float
    geom: LineString  # raw, km, digitised order
    ends: list[End] = field(default_factory=list)  # [start, end] in digitised order
    flipped: bool = False
    id: str = ""
    # topology after orientation
    down: tuple = ("free",)
    up: tuple = ("free",)
    # processed centreline (km, ME-GIS) + profile
    pts: np.ndarray | None = None
    s: np.ndarray | None = None
    thal: np.ndarray | None = None
    bed: np.ndarray | None = None
    level: np.ndarray | None = None
    falls: list = field(default_factory=list)
    into: str | None = None

    @property
    def core(self) -> float:
        return max(self.width / 2, 0.5)


@dataclass
class Lake:
    key: str
    name: str | None
    geom: object  # shapely polygon, km
    r0: int = 0
    c0: int = 0
    cov: np.ndarray | None = None
    level: float | None = None
    shore: float | None = None
    area_km2: float = 0.0
    outlets: list[int] = field(default_factory=list)
    inlets: list[int] = field(default_factory=list)


def slug(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "-", norm(s) if s else "stream").strip("-") or "stream"


# ------------------------------------------------------------------ sampling helpers


def bilinear(cfg: Config, h: np.ndarray, pts_km: np.ndarray) -> np.ndarray:
    col = (pts_km[:, 0] - cfg.x0_km) / cfg.px_km - 0.5
    row = (cfg.y1_km - pts_km[:, 1]) / cfg.px_km - 0.5
    return ndimage.map_coordinates(h, [row, col], order=1, mode="nearest")


def resample(xy: np.ndarray, ds: float) -> np.ndarray:
    seg = np.hypot(*np.diff(xy, axis=0).T)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    L = s[-1]
    n = max(2, int(round(L / ds)) + 1)
    t = np.linspace(0.0, L, n)
    return np.stack([np.interp(t, s, xy[:, 0]), np.interp(t, s, xy[:, 1])], axis=1)


def arclen(xy: np.ndarray) -> np.ndarray:
    return np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(xy, axis=0).T))])


def smooth_centreline(xy: np.ndarray, sigma_km: float, ds: float) -> np.ndarray:
    """Gaussian smoothing along the arc with the ends pinned (weight rises over 3σ from each end)."""
    if len(xy) < 5:
        return xy
    sig = sigma_km / ds
    sm = np.stack([ndimage.gaussian_filter1d(xy[:, k], sig, mode="nearest") for k in (0, 1)], axis=1)
    s = arclen(xy)
    d_end = np.minimum(s, s[-1] - s)
    w = np.clip(d_end / (3 * sigma_km), 0, 1)
    w = (w * w * (3 - 2 * w))[:, None]
    return xy * (1 - w) + sm * w


def project(pts: np.ndarray, s: np.ndarray, p: np.ndarray) -> tuple[float, np.ndarray]:
    """Arc position and foot point of p on polyline pts."""
    a = pts[:-1]
    e = pts[1:] - a
    l2 = np.maximum((e * e).sum(1), 1e-12)
    t = np.clip(((p - a) * e).sum(1) / l2, 0, 1)
    q = a + e * t[:, None]
    d = np.hypot(*(q - p).T)
    i = int(np.argmin(d))
    return float(s[i] + t[i] * np.sqrt(l2[i])), q[i]


# ------------------------------------------------------------------ 1. network


def build_lines(cfg: Config) -> list[Line]:
    R = cfg.world["rivers"]
    gdf = canon_rivers(cfg)
    inset = cfg.px_km * 0.5
    frame = box(cfg.x0_km + inset, cfg.y0_km + inset, cfg.x1_km - inset, cfg.y1_km - inset)
    lines: list[Line] = []
    for row in gdf.itertuples():
        g = affinity.scale(row.geometry, 1e-3, 1e-3, origin=(0, 0))
        parts = list(g.geoms) if isinstance(g, MultiLineString) else [g]
        for part in parts:
            clip = part.intersection(frame)
            for c in (list(clip.geoms) if hasattr(clip, "geoms") else [clip]):
                if not isinstance(c, LineString) or c.length < 1.0:
                    continue
                name = row.name if isinstance(row.name, str) else None
                lines.append(Line(len(lines), name, row.cls, float(R["widthKm"][row.cls]), float(R["depth"][row.cls]), c))
    return lines


def build_network(cfg: Config, lines: list[Line], lakes: dict[str, Lake], h: np.ndarray, land: np.ndarray) -> dict:
    """Attach ends to lakes / the sea / junction nodes; returns the undirected graph and T-junctions."""
    inset = cfg.px_km * 0.5 + 0.05
    fb = box(cfg.x0_km + inset, cfg.y0_km + inset, cfg.x1_km - inset, cfg.y1_km - inset)

    def at_sea(p: tuple[float, float]) -> bool:
        c, r = cfg.km_to_px(*p)
        r0, c0 = max(0, int(r) - 3), max(0, int(c) - 3)
        win_l = land[r0 : int(r) + 4, c0 : int(c) + 4]
        win_h = h[r0 : int(r) + 4, c0 : int(c) + 4]
        return win_l.size > 0 and (float(win_l.min()) < 0.5 or float(win_h.min()) <= 0.0)

    # endpoint clusters (union-find over ends within TOL)
    ends = [(i, e, np.array(l.geom.coords[0 if e == 0 else -1])) for i, l in enumerate(lines) for e in (0, 1)]
    parent = list(range(len(ends)))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    P = np.array([p for _, _, p in ends])
    tree = cKDTree(P)
    for a, b in sorted(tree.query_pairs(TOL_KM)):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)
    clusters: dict[int, list[int]] = {}
    for k in range(len(ends)):
        clusters.setdefault(find(k), []).append(k)

    for l in lines:
        l.ends = [End("", "free"), End("", "free")]
    tjunc: dict[str, tuple[int, float]] = {}  # node → (line, raw arc km) when it sits on a line's interior
    for root, members in clusters.items():
        node = f"n{root}"
        pts = P[members]
        rep = pts.mean(axis=0)
        # lake contact wins, then junctions, then the sea, then the frame edge / free
        lake_hit = None
        for key, lk in lakes.items():
            d = lk.geom.distance(Point(rep))
            if d < 1.0 and (lake_hit is None or d < lake_hit[1]):
                lake_hit = (key, d)
        own = {ends[k][0] for k in members}
        t_hit = None
        for j, lj in enumerate(lines):
            if j in own:
                continue
            d = lj.geom.distance(Point(rep))
            if d < TOL_KM:
                s = lj.geom.project(Point(rep))
                if min(s, lj.geom.length - s) > TOL_KM and (t_hit is None or d < t_hit[2]):
                    t_hit = (j, s, d)
        if lake_hit:
            end = End(f"lake:{lake_hit[0]}", "lake", lake_hit[0])
        elif t_hit or len(members) > 1:
            end = End(node, "node")
            if t_hit:
                tjunc[node] = (t_hit[0], t_hit[1])
        elif at_sea(tuple(rep)):
            end = End("sea", "sea")
        elif not fb.contains(Point(rep)):
            end = End(f"frame{root}", "free")
        else:
            end = End(f"free{root}", "free")
        for k in members:
            i, e, _ = ends[k]
            lines[i].ends[e] = end

    # graph: every line is a chain start → (T-junction nodes on it, by arc) → end
    on_line: dict[int, list[tuple[float, str]]] = {}
    for node, (j, s) in tjunc.items():
        on_line.setdefault(j, []).append((s, node))
    adj: dict[str, list[tuple[str, float]]] = {}
    for i, l in enumerate(lines):
        chain = [(0.0, l.ends[0].node), *sorted(on_line.get(i, [])), (l.geom.length, l.ends[1].node)]
        for (sa, na), (sb, nb) in zip(chain, chain[1:]):
            w = max(sb - sa, 1e-3)
            adj.setdefault(na, []).append((nb, w))
            adj.setdefault(nb, []).append((na, w))
    return {"adj": adj, "tjunc": tjunc, "on_line": on_line}


def dijkstra(adj: dict, sources: list[str]) -> dict[str, float]:
    dist = {s: 0.0 for s in sources}
    pq = [(0.0, s) for s in sorted(sources)]
    heapq.heapify(pq)
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist.get(u, np.inf):
            continue
        for v, w in adj.get(u, []):
            nd = d + w
            if nd < dist.get(v, np.inf):
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return dist


def orient(cfg: Config, lines: list[Line], net: dict, lakes: dict[str, Lake], h: np.ndarray) -> list[str]:
    adj = net["adj"]
    sinks = ["sea"] if "sea" in adj else []
    # authored endorheic lakes (world.json rivers.sinks) drain nowhere: they are sinks like the sea
    sinks += [f"lake:{k}" for k in cfg.world["rivers"].get("sinks", []) if f"lake:{k}" in adj]
    dist = dijkstra(adj, sinks)
    # other basins without a sea outlet drain to their lowest node (a terminal marsh): the lowest
    # terrain where a line touches it
    node_xy: dict[str, list[np.ndarray]] = {}
    for l in lines:
        node_xy.setdefault(l.ends[0].node, []).append(np.array(l.geom.coords[0]))
        node_xy.setdefault(l.ends[1].node, []).append(np.array(l.geom.coords[-1]))
    seen = set(dist)
    extra: list[str] = []
    for start in sorted(adj):
        if start in seen:
            continue
        comp, stack = [], [start]
        seen.add(start)
        while stack:
            u = stack.pop()
            comp.append(u)
            for v, _ in adj.get(u, []):
                if v not in seen:
                    seen.add(v)
                    stack.append(v)

        def height(n: str) -> float:
            xy = node_xy.get(n)
            return float(bilinear(cfg, h, np.array(xy)).min()) if xy else np.inf

        extra.append(min(sorted(comp), key=height))
    if extra:
        dist = dijkstra(adj, sinks + extra)
    log = []
    for l in lines:
        d0 = dist.get(l.ends[0].node, np.inf)
        d1 = dist.get(l.ends[1].node, np.inf)
        if d0 < d1:
            l.flipped = True
            log.append(f"{l.name or 'stream'}#{l.idx}")
    return sorted(extra) + [f"flipped {len(log)}: " + ", ".join(log)]


def oriented_coords(l: Line) -> np.ndarray:
    c = np.asarray(l.geom.coords, dtype=np.float64)
    return c[::-1].copy() if l.flipped else c


def oriented_ends(l: Line) -> tuple[End, End]:
    return (l.ends[1], l.ends[0]) if l.flipped else (l.ends[0], l.ends[1])


# ------------------------------------------------------------------ 2. centrelines + 3. profiles


def lake_shore_level(cfg: Config, lk: Lake, h: np.ndarray, pct: float) -> float | None:
    inside = lk.cov > 0.5
    if inside.sum() < 1:
        inside = lk.cov >= lk.cov.max() * 0.5
    ring = ndimage.binary_dilation(inside, iterations=2) & ~inside
    hw = h[lk.r0 : lk.r0 + lk.cov.shape[0], lk.c0 : lk.c0 + lk.cov.shape[1]]
    vals = hw[ring & (lk.cov < 0.5)]
    return float(np.percentile(vals, pct)) if vals.size else None


def solve(cfg: Config, h_pre: np.ndarray, land: np.ndarray, lakes: dict[str, Lake]) -> tuple[list[Line], list[str]]:
    R = cfg.world["rivers"]
    P = R.get("profile", {})
    fp = FitParams(
        fill_weight=P.get("fillWeight", 8.0),
        max_cut=P.get("maxCut", 2.0),
        max_pool=P.get("maxPool", 0.5),
        smooth_km=P.get("smoothKm", 2.0),
        min_grade=P.get("minGrade", 0.002),
        ramp_km=P.get("rampKm", 3.0),
        ramp_grade=P.get("rampGrade", 0.08),
    )
    ds = float(R.get("sampleKm", 0.25))
    log: list[str] = []

    pct = float(cfg.world.get("lakes", {}).get("shorePercentile", 40))
    for lk in lakes.values():
        lk.shore = lake_shore_level(cfg, lk, h_pre, pct)
    with Timer("hydro: network + orientation"):
        lines = build_lines(cfg)
        net = build_network(cfg, lines, lakes, h_pre, land)
        log += orient(cfg, lines, net, lakes, h_pre)
        # ids: slug of the name, numbered when a name repeats (the Anduin is two lines)
        counts: dict[str, int] = {}
        for l in lines:
            counts[slug(l.name)] = counts.get(slug(l.name), 0) + 1
        seen: dict[str, int] = {}
        for l in lines:
            b = slug(l.name)
            seen[b] = seen.get(b, 0) + 1
            l.id = b if counts[b] == 1 else f"{b}-{seen[b]}"

    tj = net["tjunc"]
    rank = {"great": 3, "major": 2, "minor": 1, "stream": 0}
    starts_at: dict[str, list[int]] = {}
    for l in lines:
        up, dn = oriented_ends(l)
        starts_at.setdefault(up.node, []).append(l.idx)

    def classify(l: Line) -> None:
        up, dn = oriented_ends(l)
        if dn.kind == "sea":
            l.down = ("sea",)
        elif dn.kind == "lake":
            l.down = ("lake", dn.lake)
            lakes[dn.lake].inlets.append(l.idx)
        elif dn.node in tj:
            l.down = ("line", tj[dn.node][0], "T")
        elif [j for j in starts_at.get(dn.node, []) if j != l.idx]:
            cand = [j for j in starts_at[dn.node] if j != l.idx]
            j = max(cand, key=lambda j: (rank[lines[j].cls], lines[j].geom.length, -j))
            l.down = ("line", j, "cont")
        else:
            l.down = ("free",)
        if up.kind == "lake":
            l.up = ("lake", up.lake)
            lakes[up.lake].outlets.append(l.idx)
        elif up.node in tj:
            l.up = ("line", tj[up.node][0], "T")
        else:
            l.up = ("free",)

    for l in lines:
        classify(l)
    flow_widths(cfg, lines, lakes, log)

    with Timer("hydro: centrelines"):
        sig = float(R.get("smoothKm", 0.6))
        for l in lines:
            xy = resample(oriented_coords(l), 0.1)
            xy = smooth_centreline(xy, sig, 0.1)
            l.pts = xy
        # snap junction ends onto the processed parent (T-junctions) / the parent's start (continuations)
        for l in lines:
            for which, ref in ((-1, l.down), (0, l.up)):
                if ref[0] != "line":
                    continue
                par = lines[ref[1]]
                s_par = arclen(par.pts)
                _, q = project(par.pts, s_par, l.pts[which])
                off = q - l.pts[which]
                # shift the last / first 2 km smoothly so the snap never kinks the line
                s = arclen(l.pts)
                dist = (s[-1] - s) if which == -1 else s
                w = np.clip(1 - dist / 2.0, 0, 1)[:, None]
                l.pts = l.pts + off[None] * w
        for l in lines:
            l.pts = resample(l.pts, ds)
            l.s = arclen(l.pts)
            offs = np.array([-0.5, -0.25, 0.0, 0.25, 0.5]) * l.core
            t = np.gradient(l.pts, axis=0)
            t /= np.maximum(np.hypot(*t.T), 1e-9)[:, None]
            nrm = np.stack([-t[:, 1], t[:, 0]], axis=1)
            samples = np.stack([bilinear(cfg, h_pre, l.pts + nrm * o) for o in offs], axis=0)
            l.thal = samples.min(axis=0)

    with Timer("hydro: profiles"):
        # a free source sitting in a hollow below a sill (vector/DEM mismatch) starts at the sill instead
        trim_km = float(P.get("trimSourceKm", 25.0))
        for l in lines:
            if l.up[0] != "free" or len(l.s) < 8:
                continue
            n = int(np.searchsorted(l.s, min(trim_km, 0.3 * l.s[-1])))
            m = int(np.argmax(l.thal[: n + 1]))
            if m > 0 and l.thal[m] - l.thal[0] > fp.max_pool:
                log.append(f"trim {l.id}: source moved {l.s[m]:.1f} km downstream to the sill ({l.thal[m] - l.thal[0]:.2f} above the old source)")
                l.pts, l.thal = l.pts[m:], l.thal[m:]
                l.s = l.s[m:] - l.s[m]

        # falls: declared knickpoints (world.json rivers.falls) → sample index per line
        fall_at: dict[int, list[tuple[int, str]]] = {}
        for f in R.get("falls", []):
            best = None
            for l in lines:
                if norm(l.name) != norm(f["river"]):
                    continue
                d = np.hypot(*(l.pts - np.array(f["atKm"])).T)
                i = int(np.argmin(d))
                if d[i] < 6.0 and (best is None or d[i] < best[2]):
                    best = (l.idx, i, float(d[i]))
            if best is None:
                log.append(f"WARN fall '{f['name']}' not matched to a line")
                continue
            # the lip sits where the terrain drops: the steepest 1 km thalweg descent within snapKm
            fl = lines[best[0]]
            k1 = max(1, int(round(1.0 / ds)))
            r = int(round(float(f.get("snapKm", 6.0)) / ds))
            lo, hi = max(0, best[1] - r), min(len(fl.s) - 1 - k1, best[1] + r)
            i = best[1]
            if hi > lo:
                i = lo + int(np.argmax(fl.thal[lo:hi] - fl.thal[lo + k1 : hi + k1]))
            log.append(f"fall {f['name']}: {fl.id} sample {i} ({fl.s[i]:.1f} km; thalweg drop {fl.thal[i] - fl.thal[min(i + k1, len(fl.s) - 1)]:.2f} over 1 km)")
            fall_at.setdefault(best[0], []).append((i, f["name"]))
        cut_ovr = R.get("maxCutOverrides", [])

        def cap_for(l: Line) -> np.ndarray:
            cap = np.full(len(l.s), fp.max_cut)
            for o in cut_ovr:
                if norm(o["river"]) != norm(l.name):
                    continue
                d = np.hypot(*(l.pts - np.array(o["atKm"])).T)
                cap = np.where(d < o["radiusKm"], np.maximum(cap, o["maxCut"]), cap)
            return cap

        def level_on(j: int, p: np.ndarray) -> float:
            par = lines[j]
            s, _ = project(par.pts, par.s, p)
            return float(np.interp(s, par.s, par.level))

        # stems: lines joined where one ends and the next starts (the main feeder continues the stem,
        # other feeders join it like tributaries) and lakes between their main inlet and their outlet
        # are fitted as ONE profile, so a sill at a junction is judged with the upstream context (the
        # Mitheithel → Gwathló) and a lake level is decided with the rivers around it (Forest River →
        # Long Lake → Celduin → Sea of Rhûn)
        def key_of(i: int) -> tuple:
            return (rank[lines[i].cls], lines[i].s[-1], -i)

        nxt: dict[tuple, tuple] = {}
        for l in lines:
            if l.down[0] == "line" and l.down[2] == "cont":
                j = l.down[1]
                cur = next((a for a, b in nxt.items() if b == ("line", j)), None)
                if cur is None or key_of(l.idx) > key_of(cur[1]):
                    if cur is not None:
                        del nxt[cur]
                    nxt[("line", l.idx)] = ("line", j)
        for key, lk in lakes.items():
            if lk.inlets:
                nxt[("line", max(lk.inlets, key=key_of))] = ("lake", key)
            if lk.outlets:
                nxt[("lake", key)] = ("line", max(lk.outlets, key=key_of))
        has_prev = set(nxt.values())
        elems = [("line", l.idx) for l in lines] + [("lake", k) for k, lk in lakes.items() if lk.inlets or lk.outlets]
        stems: list[list[tuple]] = []
        for e in elems:
            if e in has_prev:
                continue
            chain = [e]
            while chain[-1] in nxt:
                chain.append(nxt[chain[-1]])
            stems.append(chain)
        stem_of: dict[tuple, int] = {e: k for k, st in enumerate(stems) for e in st}

        authored = cfg.world.get("lakes", {}).get("levels", {})
        lake_w = float(cfg.world.get("lakes", {}).get("fitWeight", 1.0))
        smooth_by = P.get("smoothKmByClass", {})
        done: set[int] = set()
        pending = list(range(len(stems)))

        def deps_ready(k: int) -> bool:
            st = stems[k]
            last, first = st[-1], st[0]
            if last[0] == "line":
                dn = lines[last[1]].down
                if dn[0] == "line" and stem_of[("line", dn[1])] not in done:
                    return False
                if dn[0] == "lake" and stem_of.get(("lake", dn[1]), k) not in done | {k}:
                    return False
            if first[0] == "line":
                up = lines[first[1]].up
                if up[0] == "line" and stem_of[("line", up[1])] not in done:
                    src = stems[stem_of[("line", up[1])]][-1]
                    # a distributary waits for the line it leaves, unless that drains into this stem
                    if not (src[0] == "line" and lines[src[1]].down[0] == "line" and stem_of[("line", lines[src[1]].down[1])] == k):
                        return False
            return True

        def run(k: int) -> None:
            solve_stem(cfg, stems[k], lines, lakes, fp, ds, fall_at, cap_for, level_on, stem_of, done, authored, lake_w, smooth_by, log)
            done.add(k)
            pending.remove(k)

        while pending:
            ready = [k for k in pending if deps_ready(k)]
            for k in ready:
                if deps_ready(k):
                    run(k)
            if not ready:
                k = pending[0]
                log.append(f"WARN dependency cycle at stem {stems[k][0]}: solved with free bounds")
                run(k)
        for lk in lakes.values():
            if lk.level is None:
                lk.level = float(authored.get(lk.key, lk.shore))
        log.append("stems: " + "; ".join(" → ".join(lines[e[1]].id if e[0] == "line" else f"[{e[1]}]" for e in st) for st in stems if len(st) > 1))
    return lines, log


def flow_widths(cfg: Config, lines: list[Line], lakes: dict[str, Lake], log: list) -> None:
    """Width from flow: the class width scaled by (upstream network length / class reference)^k, so the
    lower Anduin clearly dominates its tributaries (world.json rivers.flowWidth)."""
    fwc = cfg.world["rivers"].get("flowWidth")
    if not fwc:
        return
    feeders: dict[int, list[int]] = {l.idx: [] for l in lines}
    for l in lines:
        if l.down[0] == "line":
            feeders[l.down[1]].append(l.idx)
        elif l.down[0] == "lake":
            for o in lakes[l.down[1]].outlets:
                feeders[o].append(l.idx)
    memo: dict[int, float] = {}

    def lup(i: int, stack: frozenset = frozenset()) -> float:
        if i in memo:
            return memo[i]
        if i in stack:
            return 0.0
        v = lines[i].geom.length + sum(lup(f, stack | {i}) for f in feeders[i])
        memo[i] = v
        return v

    k, lo, hi = float(fwc.get("exponent", 0.35)), float(fwc.get("min", 0.8)), float(fwc.get("max", 1.3))
    for l in lines:
        ref = float(fwc["refKm"].get(l.cls, 0) or 0)
        if ref <= 0:
            continue
        s = float(np.clip((lup(l.idx) / ref) ** k, lo, hi))
        l.width = round(round(l.width * s / 0.05) * 0.05, 2)
    big = sorted(lines, key=lambda l: -l.width)[:6]
    log.append("flow widths: " + ", ".join(f"{l.name or 'stream'} {l.width:.2f} km (upstream {lup(l.idx):.0f} km)" for l in big))


def solve_stem(cfg, st: list[tuple], lines, lakes, fp: FitParams, ds: float, fall_at: dict, cap_for, level_on, stem_of: dict, done: set, authored: dict, lake_w: float, smooth_by: dict, log: list) -> None:
    """Fit one stem in LEVEL space (target = thalweg + the line's water depth) and split it back.
    A lake is a single sample shared by its main inlet's last sample and its outlet's first sample."""
    t_parts, c_parts, bw_parts, fw_parts = [], [], [], []
    offs: dict[int, int] = {}
    lake_at: dict[str, int] = {}
    n = 0
    for q, e in enumerate(st):
        if e[0] == "lake":
            lk = lakes[e[1]]
            tgt = float(authored.get(lk.key, lk.shore if lk.shore is not None else 0.0))
            w = 1e6 if lk.key in authored else lake_w * np.sqrt(max(lk.area_km2, 0.1)) / ds
            if q == 0:  # a lake at the head of the stem: its own sample
                t_parts.append(np.array([tgt]))
                c_parts.append(np.array([1e3]))
                bw_parts.append(np.array([w]))
                fw_parts.append(np.array([1.0]))
                n += 1
            else:  # the inlet's last sample becomes the lake
                t_parts[-1][-1], c_parts[-1][-1], bw_parts[-1][-1], fw_parts[-1][-1] = tgt, 1e3, w, 1.0
            lake_at[e[1]] = n - 1
            continue
        l = lines[e[1]]
        a = 0 if q == 0 else 1  # consecutive elements share their junction sample
        offs[l.idx] = n - a
        t_parts.append(l.thal[a:] + l.depth)
        c_parts.append(cap_for(l)[a:])
        bw_parts.append(np.ones(len(l.s) - a))
        fw_parts.append(np.full(len(l.s) - a, fp.fill_weight))
        n += len(l.s) - a
    t, cap, bw, fw = (np.concatenate(x) for x in (t_parts, c_parts, bw_parts, fw_parts))
    falls, names = [], {}
    plunge = int(round(float(cfg.world["rivers"].get("plungeKm", 4.0)) / ds))
    for i, o in offs.items():
        for fi, name in fall_at.get(i, []):
            f = o + fi
            falls.append(f)
            names[f] = name
            # below a declared fall the river runs at the floor it plunges to (the drop stays at the lip)
            if f + 1 < len(t):
                seg = slice(f + 1, min(len(t), f + 1 + plunge))
                t[seg] = t[seg].min()
    E = S = None
    last, first = st[-1], st[0]
    if last[0] == "line":
        ll = lines[last[1]]
        dn = ll.down
        if dn[0] == "sea":
            E = 0.0
        elif dn[0] == "lake":
            ll.into = dn[1]
            if lakes[dn[1]].level is not None:
                E = lakes[dn[1]].level
        elif dn[0] == "line":
            ll.into = lines[dn[1]].id
            if stem_of[("line", dn[1])] in done:
                E = level_on(dn[1], ll.pts[-1])
    if first[0] == "line":
        fl = lines[first[1]]
        if fl.up[0] == "line" and stem_of[("line", fl.up[1])] in done:
            S = level_on(fl.up[1], fl.pts[0])
    if S is not None and E is not None and S < E:
        S = E  # a distributary cannot start below where it ends
    cls_in = [lines[e[1]].cls for e in st if e[0] == "line"]
    pk = FitParams(**{**fp.__dict__, "smooth_km": float(max(smooth_by.get(c, fp.smooth_km) for c in cls_in))})
    lvl, drops = fit_profile(t, ds, pk, E, S, falls, cap, bw, fw, list(lake_at.values()))
    for key, i in lake_at.items():
        lakes[key].level = float(lvl[i])
    for q, e in enumerate(st):
        if e[0] != "line":
            continue
        l = lines[e[1]]
        o, m = offs[l.idx], len(l.s)
        l.level = lvl[o : o + m].copy()
        l.bed = l.level - l.depth
        l.falls = [{"index": int(f - o), "drop": round(float(dr), 4), "name": names.get(f)} for f, dr in drops if o <= f < o + m - 1]
        if q + 1 < len(st):
            nx = st[q + 1]
            l.into = nx[1] if nx[0] == "lake" else lines[nx[1]].id
        cut = l.thal - l.bed
        if cut.max() > fp.max_cut + 0.05:
            k = int(np.argmax(cut))
            log.append(f"note {l.id}: deepest cut {cut.max():.2f} at {l.pts[k][0]:.1f},{l.pts[k][1]:.1f} km")
        fill = l.bed - l.thal
        if fill.max() > 0.6:
            k = int(np.argmax(fill))
            log.append(f"note {l.id}: pooled {fill.max():.2f} above the thalweg at {l.pts[k][0]:.1f},{l.pts[k][1]:.1f} km")


# ------------------------------------------------------------------ 4. lakes


def load_lakes(cfg: Config) -> dict[str, Lake]:
    out: dict[str, Lake] = {}
    for row in canon_lakes(cfg).itertuples():
        g = affinity.scale(row.geometry, 1e-3, 1e-3, origin=(0, 0))
        if not g.intersects(box(cfg.x0_km, cfg.y0_km, cfg.x1_km, cfg.y1_km)):
            continue
        pad = int(np.ceil(8.0 / cfg.px_km))
        r0, c0, cov = raster_mask_window(cfg, affinity.scale(g, 1e3, 1e3, origin=(0, 0)), pad)
        if cov.max() <= 0:
            continue
        name = row.NAME if isinstance(row.NAME, str) else None
        out[row.key] = Lake(row.key, name, g, r0, c0, cov, area_km2=float(g.area))
    return out


def shape_lakes(cfg: Config, h: np.ndarray, land: np.ndarray, lakes: dict[str, Lake]) -> None:
    """Deepen lake beds below the level and grade the shores to it (no walls, no floating edges)."""
    L = cfg.world.get("lakes", {})
    eps = float(L.get("shoreEpsilon", 0.03))
    for lk in lakes.values():
        if lk.level is None:
            continue
        sl = (slice(lk.r0, lk.r0 + lk.cov.shape[0]), slice(lk.c0, lk.c0 + lk.cov.shape[1]))
        hw = h[sl]
        wet = lk.cov > 0.02
        d_in = ndimage.distance_transform_edt(wet) * cfg.px_km
        d_out = ndimage.distance_transform_edt(~wet) * cfg.px_km
        size = np.sqrt(max(lk.area_km2, 0.1))
        max_depth = float(np.clip(0.8 + size / 25.0, 1.0, 3.0))
        ramp_in = float(np.clip(size * 0.25, 0.3, 3.0))
        bed = lk.level - (0.12 + (max_depth - 0.12) * np.clip(d_in / ramp_in, 0, 1) ** 0.7)
        # a shelf: near the shore the bed IS the profile (no underwater cliffs where the DEM drops
        # steeply at the waterline); further in, any deeper DEM basin is kept
        t_in = np.clip((d_in - 0.5 * ramp_in) / ramp_in, 0, 1)
        keep = t_in * t_in * (3 - 2 * t_in)
        hw[:] = np.where(wet, bed + (np.minimum(hw, bed) - bed) * keep, hw)
        # shores: walls above the level are eased down to it over D km, low shores rise to the level
        D = float(L.get("gradeKm", {}).get(lk.key, np.clip(size * 0.3, 1.5, 5.0)))
        out = ~wet
        t = np.clip(d_out / D, 0, 1)
        f = t * t * (3 - 2 * t)
        top = lk.level + eps
        graded = top + (hw - top) * f
        hw[:] = np.where(out & (hw > top), graded, hw)
        rim = top - np.maximum(0.0, d_out - 0.6) * 0.5
        landish = land[sl] >= 0.5
        hw[:] = np.where(out & landish & (hw < rim), rim, hw)


# ------------------------------------------------------------------ 5. carve + 6. masks


def carve(cfg: Config, h: np.ndarray, land: np.ndarray, lines: list[Line], lakes: dict[str, Lake]) -> dict[str, np.ndarray]:
    Rv = cfg.world["rivers"]
    bank_w = Rv.get("bankKm", {"great": 4.0, "major": 3.0, "minor": 2.0, "stream": 1.2})
    slope_by = Rv.get("bankSlope", 1.2)
    bank_ovr = Rv.get("bankOverrides", [])
    eps = 0.03
    H, W = h.shape
    core_min = np.full((H, W), np.inf, np.float32)
    levee = np.full((H, W), -np.inf, np.float32)
    bank_cut = np.zeros((H, W), np.float32)
    channel = np.zeros((H, W), np.float32)
    dist = np.full((H, W), 1e3, np.float32)
    near_level = np.zeros((H, W), np.float32)
    lake_any = np.zeros((H, W), np.float32)
    for lk in lakes.values():
        sl = (slice(lk.r0, lk.r0 + lk.cov.shape[0]), slice(lk.c0, lk.c0 + lk.cov.shape[1]))
        np.maximum(lake_any[sl], lk.cov, out=lake_any[sl])
    for l in lines:
        c = l.core
        R = c + float(bank_w[l.cls])
        # dense centreline (0.1 km) carrying level / bed
        n = max(2, int(np.ceil(l.s[-1] / 0.1)) + 1)
        sd = np.linspace(0, l.s[-1], n)
        dp = np.stack([np.interp(sd, l.s, l.pts[:, 0]), np.interp(sd, l.s, l.pts[:, 1])], axis=1)
        lv = np.interp(sd, l.s, l.level)
        bd = np.interp(sd, l.s, l.bed)
        # steepest valley wall allowed beside the water: by class, raised in declared gorges
        slope = np.full(n, float(slope_by[l.cls] if isinstance(slope_by, dict) else slope_by), np.float32)
        for o in bank_ovr:
            if norm(o["river"]) == norm(l.name):
                near = np.hypot(*(dp - np.array(o["atKm"])).T) < o["radiusKm"]
                slope[near] = float(o["bankSlope"])
        tree = cKDTree(dp)
        (x0, y0), (x1, y1) = dp.min(0) - R, dp.max(0) + R
        c0, r0 = cfg.km_to_px(x0, y1)
        c1, r1 = cfg.km_to_px(x1, y0)
        c0, r0 = max(0, int(c0)), max(0, int(r0))
        c1, r1 = min(W, int(np.ceil(c1)) + 1), min(H, int(np.ceil(r1)) + 1)
        rr, cc = np.mgrid[r0:r1, c0:c1]
        xs = cfg.x0_km + (cc + 0.5) * cfg.px_km
        ys = cfg.y1_km - (rr + 0.5) * cfg.px_km
        q = np.stack([xs.ravel(), ys.ravel()], axis=1)
        d, k = tree.query(q, distance_upper_bound=R)
        ok = np.isfinite(d)
        if not ok.any():
            continue
        idx_r = rr.ravel()[ok]
        idx_c = cc.ravel()[ok]
        d = d[ok].astype(np.float32)
        k = k[ok]
        lvk = lv[k].astype(np.float32)
        bdk = bd[k].astype(np.float32)
        wet_lake = lake_any[idx_r, idx_c] > 0.5
        # channel core: U section from the bed (centre) to the level (core edge) — on land it IS the
        # section (DEM pits under the water are filled, so the thalweg is the carved centreline)
        m = (d < c) & ~wet_lake
        u = (d[m] / c) ** 2
        core_h = lvk[m] - (lvk[m] - bdk[m]) * (1 - u)
        cur = core_min[idx_r[m], idx_c[m]]
        core_min[idx_r[m], idx_c[m]] = np.minimum(cur, core_h)
        # levee fill: the bank beside the water stays a little above the level (land only), then
        # tapers down at 1:2 to the natural ground instead of ending in a dike
        d_lev = 1.6 * c + 0.3
        m2 = (d >= c) & (d < R) & ~wet_lake & (land[idx_r, idx_c] >= 0.5)
        dm = d[m2]
        req = lvk[m2] + eps + 0.08 * (np.minimum(dm, d_lev) - c) - 0.5 * np.maximum(0.0, dm - d_lev)
        levee[idx_r[m2], idx_c[m2]] = np.maximum(levee[idx_r[m2], idx_c[m2]], req)
        # valley walls: ease anything steeper than bank_slope from the water's edge (soft cap)
        m3 = (d >= c) & ~wet_lake
        dd = d[m3] - c
        lim = lvk[m3] + eps + dd * slope[k[m3]]
        bw = float(bank_w[l.cls])
        x = np.clip((dd - 0.5 * bw) / (0.5 * bw), 0, 1)
        wb = 1 - x * x * (3 - 2 * x)
        hc = h[idx_r[m3], idx_c[m3]]
        cutv = wb * np.maximum(0.0, hc - lim)
        bank_cut[idx_r[m3], idx_c[m3]] = np.maximum(bank_cut[idx_r[m3], idx_c[m3]], cutv)
        # masks
        aa = max(cfg.px_km * 0.75, l.width * 0.25)
        ch = smooth_band(d, c, aa)
        channel[idx_r, idx_c] = np.maximum(channel[idx_r, idx_c], ch)
        db = np.maximum(d - c, 0)
        closer = db < dist[idx_r, idx_c]
        dist[idx_r[closer], idx_c[closer]] = db[closer]
        near_level[idx_r[closer], idx_c[closer]] = lvk[closer]
    in_core = np.isfinite(core_min)
    h -= bank_cut
    np.maximum(h, np.where(in_core, -np.inf, levee), out=h)
    on_land = in_core & (land >= 0.5)
    h[on_land] = core_min[on_land]
    np.minimum(h, core_min, out=h)  # at sea mouths the section only ever lowers
    return {"channel": channel, "dist": dist, "near_level": near_level, "lake_any": lake_any, "core": in_core}


def valley_mask(cfg: Config, lines: list[Line]) -> np.ndarray:
    from rasterio import features

    valley = np.zeros((cfg.H, cfg.W), np.float32)
    for cls in ("great", "major", "minor", "stream"):
        sub = [LineString(l.pts) for l in lines if l.cls == cls]
        if not sub:
            continue
        g = [affinity.scale(s, 1e3, 1e3, origin=(0, 0)) for s in sub]
        m = features.rasterize(((x, 1) for x in g), out_shape=(cfg.H, cfg.W), transform=cfg.transform, fill=0, dtype="uint8", all_touched=True)
        d = (ndimage.distance_transform_edt(m == 0) * cfg.px_km).astype(np.float32)
        w = cfg.world["rivers"]["widthKm"][cls]
        np.maximum(valley, np.exp(-((d / (w * 2.5 + 2.0)) ** 2)), out=valley)
    return valley


def run_hydro(cfg: Config, h_pre: np.ndarray, land: np.ndarray) -> tuple[np.ndarray, dict[str, np.ndarray], dict]:
    with Timer("hydro: lakes"):
        lakes = load_lakes(cfg)
    lines, log = solve(cfg, h_pre, land, lakes)
    h = h_pre.copy()
    with Timer("hydro: lake shores"):
        shape_lakes(cfg, h, land, lakes)
    with Timer("hydro: carve + masks"):
        m = carve(cfg, h, land, lines, lakes)
        valley = valley_mask(cfg, lines)
    for s in log:
        print(f"[bake]   {s}")
    rivers = []
    for l in lines:
        rivers.append(
            {
                "id": l.id,
                "name": l.name,
                "cls": l.cls,
                "widthKm": l.width,
                "points": [[round(v, 3) for v in cfg.km_to_world(float(x), float(y))] for x, y in l.pts],
                "level": [round(float(v), 4) for v in l.level],
                "bed": [round(float(v), 4) for v in l.bed],
                "falls": l.falls,
                "into": l.into,
                "_down": list(l.down[:1]) + ([lines[l.down[1]].id] if l.down[0] == "line" else list(l.down[1:])),
                "_up": list(l.up[:1]) + ([lines[l.up[1]].id] if l.up[0] == "line" else list(l.up[1:])),
                "_thal": [round(float(v), 3) for v in l.thal],
                "_flipped": l.flipped,
            }
        )
    lake_info = []
    for lk in lakes.values():
        lake_info.append({"key": lk.key, "level": None if lk.level is None else round(float(lk.level), 4), "shore": None if lk.shore is None else round(float(lk.shore), 3), "areaKm2": round(float((lk.cov > 0.5).sum()) * cfg.px_km**2, 1), "polygonKm2": round(lk.area_km2, 1), "outlets": [lines[o].id for o in lk.outlets], "inlets": [lines[o].id for o in lk.inlets]})
    masks = {
        "river_channel": q8(m["channel"]),
        "river_valley": q8(valley),
        "river_dist": m["dist"],
        "near_level": m["near_level"],
        "lake": q8(np.clip(m["lake_any"], 0, 1)),
    }
    return h, masks, {"rivers": rivers, "lakes": lake_info, "log": log}
