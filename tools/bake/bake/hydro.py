"""Hydrology v2: one river network for the carve, the masks and the runtime ribbons.

1. network   canon ME-GIS river lines (clipped to the frame) → a graph: shared endpoints and T-junctions
             (a tributary ending mid-segment) become nodes, lakes are nodes (inlets / outlets), river
             ends in the sea are one sink node. Lines are oriented by topology — multi-source Dijkstra
             from the sinks (the sea, the endorheic lakes of world.json rivers.sinks, else a basin's
             lowest node), never by comparing end heights.
2. centre    one processed centreline per line (0.1 km resample, Gaussian-smoothed corners with pinned
             ends), snapped onto the DEM valley floor within a class window (snap.py: the ME-GIS vectors
             are laterally offset from the DEM valleys in places), junction ends re-attached to the snapped
             parent, resampled every `sampleKm`; widths from
             the upstream network length (flow width). A tributary (or a side feeder of a continuation
             node) is clipped at the edge of its parent's channel core — it meets the parent's water at
             the parent's level there; a distributary starts there; a side channel lying inside its
             parent's core is absorbed. Continuation starts are fed (never trimmed as sources).
3. profiles  monotone water levels (profiles.py) per STEM — lines joined end-to-start and lakes between
             their main inlet and their outlet — solved downstream-first: sea mouth → 0, confluence → the
             parent's level, other inlets → the lake level. A lake is one pinned, heavily weighted sample,
             so its level is decided with the rivers around it. The target is the thalweg + depth (short
             pits closed first: a river pools over a DEM hollow instead of cutting the reach around it)
             but never above the lower bank (the river is incised into its floodplain), and the level
             never exceeds
             what the banks hold: their SPILL level (priority-flood; a closed hollow beside the river does
             not drain it) + fillCap — where it would, the sill downstream is cut instead (no perched
             water, no embankments). A side feeder whose own valley lies below its parent's level (the
             vector crosses a DEM divide) ends at its valley bottom. Declared falls (world.json
             rivers.falls, snapped to the steepest DEM drop) are the only places the surface drops
             steeply; a free source in a hollow below a sill, or on a hillside above the valley it runs
             into, starts at the sill / where it meets the valley.
4. lakes     beds deepened below the level (inside the polygon) as a shelf near the shore, shores graded
             to the level (not beside the lake's own inlets / outlets); low shore connected to the water
             below the level is a flat delta at the level, elsewhere a narrow lip hides the lake's edge.
5. carve     U cross-section into h (exact on land: the thalweg IS the centreline); a levee under the
             ribbon edge at most fillCap above the ground, tapering 1:2 and ending within 0.8 km; valley
             walls under a continuous envelope rising from the water's edge at the class slope (steeper
             only in declared gorges), never lowered more than the ground at the water's edge stands
             above the water (tapering over edgeEaseKm) — a V valley keeps its shape instead of being
             dug out; each sample's cone fades beyond the cell's own foot point (no seams at bends); no
             line's easing undercuts another line's banks. Hollows beside a river that its water surface
             closes off fill to its level within marshBandKm — marshes (bounded, reported).
6. masks     channel / valley / distance rasters from the same centrelines; rivers.json v2 export data;
             report.json (geometry gates read by tools/check: terrain vs the relief outside the cores by
             cause — carve, lake shores, marshes — new cliffs, joins, ribbon edges, cuts, snap shifts).
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
from .profiles import FitParams, close_pits, fit_profile
from .vectors import canon_lakes, canon_rivers, norm, raster_mask_window, smooth_band

TOL_KM = 0.3
# the bank beside the water stays this much above the level (hides the ribbon edge)
CARVE_EPS = 0.03


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
    # lowest ground beside the channel (core edge … ribbon edge, the lower side; +inf where the bank is
    # water — the sea, a lake, another river's channel)
    bank: np.ndarray | None = None
    bed: np.ndarray | None = None
    level: np.ndarray | None = None
    falls: list = field(default_factory=list)
    into: str | None = None
    # parent line(s) whose core this line's end was clipped against (T-junction / side feeder)
    clip_parents: list = field(default_factory=list)
    # level above what the banks can hold (+ fillCap), forced by a held level downstream (a lake)
    excess: np.ndarray | None = None
    # a side channel lying entirely inside its parent's core: the parent's water covers it
    absorbed: bool = False
    # thalweg snap: (max, mean) distance of the processed centreline from the raw ME-GIS line (km)
    snap: tuple = (0.0, 0.0)
    # length bookkeeping (report.json lengths): km removed at the source (trims), at a junction (clipped
    # at the parent's core edge) and at the mouth (a side feeder ending at its valley bottom)
    trim_km: float = 0.0
    clip_km: float = 0.0
    short_km: float = 0.0
    # the main feeder of its continuation (it ends exactly where the continuation starts)
    cont_main: bool = False

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


def normals(pts: np.ndarray) -> np.ndarray:
    t = np.gradient(pts, axis=0)
    t /= np.maximum(np.hypot(*t.T), 1e-9)[:, None]
    return np.stack([-t[:, 1], t[:, 0]], axis=1)


def lake_raster(cfg: Config, lakes: dict[str, Lake]) -> np.ndarray:
    out = np.zeros((cfg.H, cfg.W), np.float32)
    for lk in lakes.values():
        sl = (slice(lk.r0, lk.r0 + lk.cov.shape[0]), slice(lk.c0, lk.c0 + lk.cov.shape[1]))
        np.maximum(out[sl], lk.cov, out=out[sl])
    return out


def ribbon_half(cfg: Config, l: Line) -> float:
    """Runtime ribbon half width (src/water/rivers.ts ribbonHalfWidth): ribbonScale × half the line
    width, but always a margin beyond the carved core (no dry channel walls on streams)."""
    R = cfg.world["rivers"]
    return max(float(R.get("ribbonScale", 1.4)) * l.width / 2, l.core + float(R.get("ribbonMarginKm", 0.1)))


def spill_levels(cfg: Config, h_pre: np.ndarray, land: np.ndarray, lakes: dict[str, Lake]) -> np.ndarray:
    """Priority-flood fill of the relief: each cell's spill level. Outlets = the sea, the frame edge and
    the endorheic lakes (world.json rivers.sinks)."""
    from .flow import fill_depressions

    seed = land < 0.5
    for key in cfg.world["rivers"].get("sinks", []):
        lk = lakes.get(key)
        if lk is not None:
            seed[lk.r0 : lk.r0 + lk.cov.shape[0], lk.c0 : lk.c0 + lk.cov.shape[1]] |= lk.cov > 0.5
    return fill_depressions(h_pre, seed)


def bank_heights(cfg: Config, lines: list[Line], spill: np.ndarray, land: np.ndarray, lakes: dict[str, Lake]) -> None:
    """Per sample, the lowest level the banks can hold the water at: along both normals from the core edge
    to just beyond the ribbon edge, the lower side's minimum SPILL level (a closed hollow beside the river
    fills up before the river spills into it; an open valley beside it drains the river at its own
    height). Bank samples that are water anyway (the sea, a lake, another line's channel core) never hold
    anything back (+inf)."""
    lake_any = lake_raster(cfg, lakes)
    allp = np.concatenate([l.pts for l in lines])
    owner = np.concatenate([np.full(len(l.pts), l.idx) for l in lines])
    core_of = np.array([l.core for l in lines])
    tree = cKDTree(allp)
    for l in lines:
        c = l.core
        hw = ribbon_half(cfg, l) + 0.1
        offs = np.linspace(c, hw, max(2, int(np.ceil((hw - c) / 0.2)) + 1))
        nrm = normals(l.pts)
        sides = []
        for sgn in (1.0, -1.0):
            lo = np.full(len(l.pts), np.inf)
            for o in offs:
                q = l.pts + nrm * (sgn * o)
                hv = bilinear(cfg, spill, q)
                wet = (bilinear(cfg, land, q) < 0.5) | (bilinear(cfg, lake_any, q) > 0.5)
                d, j = tree.query(q, k=8)
                own = owner[j]
                other = ((own != l.idx) & (d < core_of[own] + 0.05)).any(axis=1)
                lo = np.minimum(lo, np.where(wet | other, np.inf, hv))
            sides.append(lo)
        l.bank = np.minimum(sides[0], sides[1])


def nearest_parent(lines: list[Line], l: Line, default: int) -> int:
    """The parent line whose core edge this line's end lies on (the one it is nearest to beyond its core)."""

    def gap(j: int) -> float:
        par = lines[j]
        return float(np.hypot(*(project(par.pts, par.s, l.pts[-1])[1] - l.pts[-1]))) - par.core

    return min(l.clip_parents or [default], key=gap)


def main_feeders(lines: list[Line], rank: dict) -> dict[int, int]:
    """continuation line → the feeder that carries the stem on (highest class, then longest)."""
    out: dict[int, int] = {}

    def key_of(i: int) -> tuple:
        return (rank[lines[i].cls], lines[i].s[-1], -i)

    for l in lines:
        if l.down[0] == "line" and l.down[2] == "cont":
            j = l.down[1]
            if j not in out or key_of(l.idx) > key_of(out[j]):
                out[j] = l.idx
    return out


def clip_side_feeders(lines: list[Line], main_feeder: dict[int, int], log: list) -> None:
    """A tributary (or side feeder of a continuation node) ends at the edge of its parent's channel core,
    where it meets the parent's water at the parent's level; a distributary starts there. Inside the
    parent's core the parent's own surface and section rule (no tributary ribbon floating above it)."""

    def inside(p: np.ndarray, parents: list[int]) -> bool:
        for j in parents:
            par = lines[j]
            _, q = project(par.pts, par.s, p)
            if np.hypot(*(q - p)) < par.core:
                return True
        return False

    def cut(l: Line, sl: slice) -> None:
        L0 = float(l.s[-1])
        l.pts, l.thal, l.bank = l.pts[sl], l.thal[sl], l.bank[sl]
        l.s = arclen(l.pts)
        l.clip_km += L0 - float(l.s[-1])

    for l in lines:
        if l.down[0] == "line" and main_feeder.get(l.down[1]) != l.idx:
            j = l.down[1]
            parents = [j] + ([main_feeder[j]] if l.down[2] == "cont" and j in main_feeder else [])
            k = len(l.pts) - 1
            while k > 0 and inside(l.pts[k], parents):
                k -= 1
            if k < 2 or l.s[k] < 0.5:
                l.absorbed = True
                log.append(f"absorb {l.id}: lies inside {lines[j].id}'s core")
                continue
            if k < len(l.pts) - 1:
                log.append(f"clip {l.id}: ends at the edge of {lines[j].id}'s core ({l.s[-1] - l.s[k]:.2f} km inside it dropped)")
                cut(l, slice(0, k + 1))
            l.clip_parents = parents
        if l.up[0] == "line":
            j = l.up[1]
            k = 0
            while k < len(l.pts) - 1 and inside(l.pts[k], [j]):
                k += 1
            if k > len(l.pts) - 3 or l.s[-1] - l.s[k] < 0.5:
                l.absorbed = True
                log.append(f"absorb {l.id}: lies inside {lines[j].id}'s core")
                continue
            if k > 0:
                log.append(f"clip {l.id}: starts at the edge of {lines[j].id}'s core ({l.s[k]:.2f} km inside it dropped)")
                cut(l, slice(k, None))
    for l in lines:
        for ref in (l.down, l.up):
            if ref[0] == "line" and lines[ref[1]].absorbed and not l.absorbed:
                log.append(f"WARN {l.id} joins {lines[ref[1]].id}, which lies inside its parent's core")


def solve(cfg: Config, h_pre: np.ndarray, land: np.ndarray, lakes: dict[str, Lake]) -> tuple[list[Line], list[str], dict]:
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
        smooth_lower=P.get("smoothLower", 0.5),
        smooth_raise=P.get("smoothRaise", 1e9),
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
    ends_at: dict[str, list[int]] = {}
    for l in lines:
        up, dn = oriented_ends(l)
        starts_at.setdefault(up.node, []).append(l.idx)
        ends_at.setdefault(dn.node, []).append(l.idx)

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
        elif up.kind == "node" and [j for j in ends_at.get(up.node, []) if j != l.idx]:
            # a continuation: other lines end where this one starts — fed, never a source (no trim)
            l.up = ("cont", *sorted(j for j in ends_at[up.node] if j != l.idx))
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
            l.s = arclen(xy)
        # thalweg snap: every centreline onto the DEM valley floor within its class window (snap.py)
        from .snap import snap_lines

        # the main feeder of a continuation node carries the stem on; the others join it like tributaries
        # (one choice for the snap chains, the re-attach and the stems)
        main_feeder = main_feeders(lines, rank)
        for j, f in main_feeder.items():
            lines[f].cont_main = True
        snap_stats = snap_lines(cfg, lines, h_pre, land, lakes, main_feeder, rank, log)
        # re-attach junction ends onto the processed parent (T-junctions, side feeders) / exactly onto the
        # continuation's first point (its main feeder: one node, never a stub upstream of the junction);
        # the shift eases in over max(2 km, 3 × its length) so it never kinks the line
        for l in lines:
            for which, ref in ((-1, l.down), (0, l.up)):
                if ref[0] != "line":
                    continue
                par = lines[ref[1]]
                if which == -1 and ref[2] == "cont" and main_feeder.get(par.idx) == l.idx:
                    q = par.pts[0]
                else:
                    s_par = arclen(par.pts)
                    _, q = project(par.pts, s_par, l.pts[which])
                off = q - l.pts[which]
                s = arclen(l.pts)
                dist = (s[-1] - s) if which == -1 else s
                L = max(2.0, 3.0 * float(np.hypot(*off)))
                x = np.clip(1 - dist / L, 0, 1)
                l.pts = l.pts + off[None] * (x * x * (3 - 2 * x))[:, None]
        for l in lines:
            l.pts = resample(l.pts, ds)
            l.s = arclen(l.pts)
            offs = np.array([-0.5, -0.25, 0.0, 0.25, 0.5]) * l.core
            nrm = normals(l.pts)
            samples = np.stack([bilinear(cfg, h_pre, l.pts + nrm * o) for o in offs], axis=0)
            l.thal = samples.min(axis=0)
        spill = spill_levels(cfg, h_pre, land, lakes)
        bank_heights(cfg, lines, spill, land, lakes)
        del spill
        clip_side_feeders(lines, main_feeder, log)
        for lk in lakes.values():
            lk.inlets = [i for i in lk.inlets if not lines[i].absorbed]
            lk.outlets = [i for i in lk.outlets if not lines[i].absorbed]

    with Timer("hydro: profiles"):
        # a free source sitting in a hollow below a sill (vector/DEM mismatch) starts at the sill instead;
        # continuation starts ('cont', fed by the lines ending there) are never trimmed. Canon length is
        # kept: a trim moves the source at most trimSourceKm (the rest of the hollow is pooled or its sill
        # cut, within the usual caps) — unless the source reach runs down into a hollow more than
        # trimHollowCut below the sill it must cross (the cut would be an excavation; the pool a lake the
        # map does not have), which may move it up to trimSourceMaxKm
        trim_km = float(P.get("trimSourceKm", 5.0))
        trim_max = float(P.get("trimSourceMaxKm", 25.0))
        trim_hollow = float(P.get("trimHollowCut", 4.0))
        PR_fb = float(P.get("bankFreeboard", 0.05))

        def trim_point(l: Line, km: float) -> tuple[int, str, float]:
            """(sample index of the new source or 0, why, depth of the hollow when that is the reason)."""
            n = int(np.searchsorted(l.s, min(km, 0.3 * l.s[-1])))
            m = int(np.argmax(l.thal[: n + 1]))
            if m > 0 and l.thal[m] - l.thal[0] > fp.max_pool:
                return m, f"{l.thal[m] - l.thal[0]:.2f} above the old source", 0.0
            # ...or its first reach runs down into a hollow deeper than maxCut below a sill that is still
            # lower than the source (the vector crosses a DEM ridge soon after it rises)
            seg = l.thal[: n + 1]
            dep = seg - np.minimum.accumulate(seg)
            m = int(np.argmax(dep))
            if m > 0 and dep[m] > fp.max_cut:
                return m, f"{dep[m]:.2f} above the hollow before it", float(dep[m])
            # ...or it starts on a hillside: its lower bank lies far below its thalweg (the valley it runs
            # down into lies beside the vector) — start where it meets it
            gap = seg + l.depth - (l.bank[: n + 1] - float(PR_fb))
            ok = np.nonzero(gap <= 0.5 * fp.max_cut)[0]
            m = int(ok[0]) if ok.size else 0
            if m > 0 and gap[0] > fp.max_cut:
                return m, f"its bank {gap[0]:.2f} below its thalweg", 0.0
            return 0, "", 0.0

        for l in lines:
            moved = 0.0
            for _ in range(4):
                if l.up[0] != "free" or l.absorbed or len(l.s) < 8 or moved >= trim_max:
                    break
                m, why, hollow = trim_point(l, trim_max - moved)
                if m > 0 and moved + float(l.s[m]) > trim_km + 1e-6 and hollow <= trim_hollow:
                    if moved >= trim_km:
                        break
                    m, why, hollow = trim_point(l, trim_km - moved)
                if m <= 0:
                    break
                log.append(f"trim {l.id}: source moved {l.s[m]:.1f} km downstream to the sill ({why})")
                moved += float(l.s[m])
                l.trim_km += float(l.s[m])
                l.pts, l.thal, l.bank = l.pts[m:], l.thal[m:], l.bank[m:]
                l.s = l.s[m:] - l.s[m]

        # falls: declared knickpoints (world.json rivers.falls) → sample index per line
        fall_at: dict[int, list[tuple[int, str]]] = {}
        for f in R.get("falls", []):
            best = None
            for l in lines:
                if l.absorbed or norm(l.name) != norm(f["river"]):
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

        nxt: dict[tuple, tuple] = {("line", f): ("line", j) for j, f in sorted(main_feeder.items())}
        for key, lk in lakes.items():
            if lk.inlets:
                nxt[("line", max(lk.inlets, key=key_of))] = ("lake", key)
            if lk.outlets:
                nxt[("lake", key)] = ("line", max(lk.outlets, key=key_of))
        has_prev = set(nxt.values())
        elems = [("line", l.idx) for l in lines if not l.absorbed] + [("lake", k) for k, lk in lakes.items() if lk.inlets or lk.outlets]
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
    return lines, log, snap_stats


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


def solve_stem(cfg, st: list[tuple], lines, lakes, fp: FitParams, ds: float, fall_at: dict, cap_for, level_on, stem_of: dict, done: set, authored: dict, lake_w: float, smooth_by: dict, log: list, retry: bool = True) -> None:
    """Fit one stem in LEVEL space and split it back. Target = the thalweg + the line's water depth, but
    never above the lower bank less a freeboard (the river is incised into its floodplain instead of
    sitting on top of it); the level may never exceed the banks + the allowed levee fill (no perched
    water: profiles.cap_profile), so where the terrain cannot hold the water the sill downstream is cut.
    A lake is a single sample shared by its main inlet's last sample and its outlet's first sample.
    A side feeder whose own valley lies below the parent's level (the vector crosses a DEM divide on its
    way to the parent) ends at the bottom of that valley instead of being held up on an embankment."""
    PR = cfg.world["rivers"].get("profile", {})
    fb = float(PR.get("bankFreeboard", 0.05))
    fill_cap = float(PR.get("fillCap", 0.4))
    tol = float(PR.get("conflictTol", 0.3))
    pit_by = PR.get("pitKmByClass", {})
    pit_cut = float(PR.get("pitCutCost", 0.0))
    t_parts, c_parts, bw_parts, fw_parts, u_parts, w_parts = [], [], [], [], [], []
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
                u_parts.append(np.array([np.inf]))
                w_parts.append(np.array([fp.smooth_km]))
                n += 1
            else:  # the inlet's last sample becomes the lake
                t_parts[-1][-1], c_parts[-1][-1], bw_parts[-1][-1], fw_parts[-1][-1], u_parts[-1][-1] = tgt, 1e3, w, 1.0, np.inf
            lake_at[e[1]] = n - 1
            continue
        l = lines[e[1]]
        a = 0 if q == 0 else 1  # consecutive elements share their junction sample
        offs[l.idx] = n - a
        # short pits in the thalweg (DEM hollows narrower than pitKm along the line) are closed first: a
        # river pools over a pit (a marsh) instead of cutting the long reach around it down to its floor;
        # sills are left to the fit (cut, or held back as a pool)
        # — except behind a short sill, which is notched instead (profiles.close_pits: cut where cheap)
        pk = int(round(float(pit_by.get(l.cls, 0.0)) / ds)) | 1
        tl = close_pits(l.thal + l.depth, pk, pit_cut, fp.max_cut)
        t_parts.append(np.minimum(tl, l.bank - fb)[a:])
        c_parts.append(cap_for(l)[a:])
        bw_parts.append(np.ones(len(l.s) - a))
        fw_parts.append(np.full(len(l.s) - a, fp.fill_weight))
        u_parts.append((l.bank + fill_cap - CARVE_EPS)[a:])
        w_parts.append(np.full(len(l.s) - a, float(smooth_by.get(l.cls, fp.smooth_km))))
        n += len(l.s) - a
    t, cap, bw, fw, upper, win_km = (np.concatenate(x) for x in (t_parts, c_parts, bw_parts, fw_parts, u_parts, w_parts))
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
                # the parent whose core edge this line was clipped at (a side feeder of a continuation
                # node meets whichever of the two lines is nearer)
                E = level_on(nearest_parent(lines, ll, dn[1]), ll.pts[-1])
    if first[0] == "line":
        fl = lines[first[1]]
        if fl.up[0] == "line" and stem_of[("line", fl.up[1])] in done:
            S = level_on(fl.up[1], fl.pts[0])
    if S is not None and E is not None and S < E:
        S = E  # a distributary cannot start below where it ends
    # each line smooths with its own class window (a stream at the head of the Anduin stem keeps its
    # 2 km window instead of the great river's 8 km)
    lvl, drops, excess = fit_profile(t, ds, fp, E, S, falls, cap, bw, fw, list(lake_at.values()), upper, win_km)
    # a side feeder held above its own valley by the parent's level: end it at the valley bottom
    if retry and last[0] == "line" and E is not None and lines[last[1]].down[0] in ("line", "lake"):
        ll = lines[last[1]]
        o = offs[ll.idx]
        ex = excess[o : o + len(ll.s)]
        bad = np.nonzero(ex > tol)[0]
        if bad.size:
            k0 = int(bad[0])
            m = k0 + int(np.argmin(ll.thal[k0:]))
            if 4 <= m < len(ll.s) - 2:
                log.append(f"end {ll.id}: its valley lies {float(ex.max()):.2f} below the level of {ll.into} (a DEM divide at {ll.pts[m][0]:.1f},{ll.pts[m][1]:.1f} km); it ends at the valley bottom, {ll.s[-1] - ll.s[m]:.1f} km short")
                ll.short_km += float(ll.s[-1] - ll.s[m])
                ll.pts, ll.thal, ll.bank = ll.pts[: m + 1], ll.thal[: m + 1], ll.bank[: m + 1]
                ll.s = ll.s[: m + 1]
                if ll.down[0] == "lake":
                    lakes[ll.down[1]].inlets.remove(ll.idx)
                ll.down, ll.into, ll.clip_parents = ("free",), None, []
                solve_stem(cfg, st, lines, lakes, fp, ds, fall_at, cap_for, level_on, stem_of, done, authored, lake_w, smooth_by, log, retry=False)
                return
    for key, i in lake_at.items():
        lakes[key].level = float(lvl[i])
    for q, e in enumerate(st):
        if e[0] != "line":
            continue
        l = lines[e[1]]
        o, m = offs[l.idx], len(l.s)
        l.level = lvl[o : o + m].copy()
        l.bed = l.level - l.depth
        l.excess = excess[o : o + m].copy()
        if l.excess.max() > 0.05:
            k = int(np.argmax(l.excess))
            log.append(f"note {l.id}: held {l.excess.max():.2f} above what its banks allow (+{fill_cap}) by the level downstream, at {l.pts[k][0]:.1f},{l.pts[k][1]:.1f} km")
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


def shape_lakes(cfg: Config, h: np.ndarray, land: np.ndarray, lakes: dict[str, Lake], lines: list[Line] | None = None) -> None:
    """Deepen lake beds below the level and grade the shores to it (no walls, no floating edges). The
    grading fades out beside the lake's inlets and outlets (within riverKeepKm of their ribbon edge), so
    it never lowers a river's banks below the water the profile gave it."""
    L = cfg.world.get("lakes", {})
    eps = float(L.get("shoreEpsilon", 0.03))
    rim_flat = float(L.get("rimFlatKm", 0.6))
    rim_slope = float(L.get("rimSlope", 0.5))
    delta_km = float(L.get("deltaKm", 0.0))
    keep_km = float(L.get("riverKeepKm", 2.0))
    for lk in lakes.values():
        if lk.level is None:
            continue
        sl = (slice(lk.r0, lk.r0 + lk.cov.shape[0]), slice(lk.c0, lk.c0 + lk.cov.shape[1]))
        hw = h[sl]
        # the bed lies inside the polygon (the runtime lake surface); its antialiased edge pixels are shore
        wet = lk.cov >= 0.5
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
        # (an inland lake's bed stays above the sea datum: h > 0 is land for every mask and system)
        hw[:] = np.where(wet, np.maximum(bed + (np.minimum(hw, bed) - bed) * keep, np.minimum(hw, 0.1) if lk.level > 0.2 else -np.inf), hw)
        # shores: walls above the level are eased down to it over D km, low shores rise to the level
        D = float(L.get("gradeKm", {}).get(lk.key, np.clip(size * 0.3, 1.5, 5.0)))
        out = ~wet
        t = np.clip(d_out / D, 0, 1)
        f = t * t * (3 - 2 * t)
        top = lk.level + eps
        landish = land[sl] >= 0.5
        # low shore connected to the water below the level (a DEM basin wider than the ME-GIS polygon,
        # an inlet's flooded valley mouth) within deltaKm: flat at the level — a delta / marsh flat the
        # inlets run across, instead of an embankment sloping away from the water under a perched stream
        below = out & landish & (hw < top) & (d_out <= min(delta_km, 0.5 * size))
        lab, _ = ndimage.label(below | wet, structure=np.ones((3, 3), bool))
        ids = np.unique(lab[wet])
        delta = np.isin(lab, ids[ids > 0]) & below
        graded = top + (hw - top) * f
        if lines:
            dr = river_distance(cfg, lk, [lines[i] for i in lk.inlets + lk.outlets])
            xr = np.clip(dr / keep_km, 0.0, 1.0)
            graded = hw + (graded - hw) * (xr * xr * (3 - 2 * xr))
        hw[:] = np.where(out & (hw > top), graded, hw)
        # elsewhere a narrow lip hides the lake's edge (rimFlatKm at the level) and falls back to the
        # natural shore at rimSlope — no broad embankment
        rim = np.where(delta, top, top - np.maximum(0.0, d_out - rim_flat) * rim_slope)
        hw[:] = np.where(out & landish & (hw < rim), rim, hw)


def river_distance(cfg: Config, lk: Lake, conn: list[Line]) -> np.ndarray:
    """Over a lake's window: distance (km) beyond the ribbon edge of the nearest connected river (inf away
    from them)."""
    H, W = lk.cov.shape
    out = np.full((H, W), np.inf, np.float32)
    rr, cc = np.mgrid[lk.r0 : lk.r0 + H, lk.c0 : lk.c0 + W]
    q = np.stack([(cfg.x0_km + (cc + 0.5) * cfg.px_km).ravel(), (cfg.y1_km - (rr + 0.5) * cfg.px_km).ravel()], axis=1)
    for l in conn:
        if l.absorbed or len(l.s) < 2:
            continue
        n = max(2, int(np.ceil(l.s[-1] / 0.1)) + 1)
        sd = np.linspace(0, l.s[-1], n)
        dp = np.stack([np.interp(sd, l.s, l.pts[:, 0]), np.interp(sd, l.s, l.pts[:, 1])], axis=1)
        d, _ = cKDTree(dp).query(q, distance_upper_bound=ribbon_half(cfg, l) + 10.0)
        np.minimum(out, np.maximum(0.0, d - ribbon_half(cfg, l)).reshape(H, W).astype(np.float32), out=out)
    return out


# ------------------------------------------------------------------ 5. carve + 6. masks


def carve(cfg: Config, h: np.ndarray, land: np.ndarray, lines: list[Line], lakes: dict[str, Lake]) -> dict[str, np.ndarray]:
    Rv = cfg.world["rivers"]
    bank_w = Rv.get("bankKm", {"great": 4.0, "major": 3.0, "minor": 2.0, "stream": 1.2})
    slope_by = Rv.get("bankSlope", 1.2)
    bank_ovr = Rv.get("bankOverrides", [])
    fill_cap = float(Rv.get("profile", {}).get("fillCap", 0.4))
    ease_max = float(Rv.get("easeMaxFactor", 1.5))
    cone_fade = float(Rv.get("coneFadeKm", 1.0))
    edge_by = Rv.get("edgeEaseKm", {})
    edge_rise = float(Rv.get("edgeRise", 3.0))
    rise = float(Rv.get("wallRise", 3.0))
    eps = CARVE_EPS
    H, W = h.shape
    core_min = np.full((H, W), np.inf, np.float32)
    levee = np.full((H, W), -np.inf, np.float32)
    bank_cut = np.zeros((H, W), np.float32)
    protect = np.full((H, W), -np.inf, np.float32)
    channel = np.zeros((H, W), np.float32)
    dist = np.full((H, W), 1e3, np.float32)
    near_level = np.zeros((H, W), np.float32)
    near_zone = np.zeros((H, W), np.float32)  # the nearest line's ribbon edge beyond its core (km)
    near_line = np.full((H, W), -1, np.int32)  # the nearest line (report attribution)
    lake_any = np.zeros((H, W), np.float32)
    for lk in lakes.values():
        sl = (slice(lk.r0, lk.r0 + lk.cov.shape[0]), slice(lk.c0, lk.c0 + lk.cov.shape[1]))
        np.maximum(lake_any[sl], lk.cov, out=lake_any[sl])
    for l in lines:
        if l.absorbed:
            continue
        c = l.core
        # dense centreline (0.1 km) carrying level / bed
        n = max(2, int(np.ceil(l.s[-1] / 0.1)) + 1)
        sd = np.linspace(0, l.s[-1], n)
        dp = np.stack([np.interp(sd, l.s, l.pts[:, 0]), np.interp(sd, l.s, l.pts[:, 1])], axis=1)
        lv = np.interp(sd, l.s, l.level)
        bd = np.interp(sd, l.s, l.bed)
        ex = np.interp(sd, l.s, l.excess) if l.excess is not None else np.zeros(n)
        # steepest eased wall beside the water: by class, steeper only in declared gorges (bankOverrides).
        # Where the relief itself is steep the natural walls are kept anyway (the easing never lowers more
        # than the water's edge stands above the water, below), so no gorge walls on the plains
        slope = np.full(n, float(slope_by[l.cls] if isinstance(slope_by, dict) else slope_by), np.float32)
        cut_d = np.interp(sd, l.s, l.thal) - bd
        for o in bank_ovr:
            if norm(o["river"]) == norm(l.name):
                near = np.hypot(*(dp - np.array(o["atKm"])).T) < o["radiusKm"]
                slope[near] = np.maximum(slope[near], float(o["bankSlope"]))
        # easing width: the class width; a great / major river cut deep through a sill widens it (so the
        # eased wall reaches the ground the cut went through) up to easeMaxFactor × — small rivers never
        bw0 = float(bank_w[l.cls])
        if l.cls in ("great", "major"):
            bw = np.clip(2.0 * (np.maximum(cut_d, 0.0) + 0.5) / slope, bw0, ease_max * bw0).astype(np.float32)
        else:
            bw = np.full(n, bw0, np.float32)
        # edge excess: how far the ground just beyond the channel core stands above the water (the higher
        # side, eased along the line) — the most the walls are ever lowered: a V valley keeps its shape,
        # shifted down only as far as the channel needs, instead of being dug out to the class slope
        nd = normals(dp)
        edge = np.zeros(n, np.float32)
        for sgn in (1.0, -1.0):
            edge = np.maximum(edge, bilinear(cfg, h, dp + nd * (sgn * (c + 0.2))) - lv - eps)
        edge = ndimage.maximum_filter1d(edge, 11, mode="nearest").astype(np.float32)
        # ...over edgeEaseKm (by class) from the water's edge — the channel's own banks, not a trough —
        # widened where the excess is large so the taper never steepens the wall by more than edgeRise
        edge_w = float(edge_by.get(l.cls, 1e9)) if isinstance(edge_by, dict) else 1e9
        # reach: out to where the wall cap has risen above the highest ground around the line
        R0 = c + float(bw.max())
        (x0, y0), (x1, y1) = dp.min(0) - R0 - 10.0, dp.max(0) + R0 + 10.0
        c0, r0 = cfg.km_to_px(x0, y1)
        c1, r1 = cfg.km_to_px(x1, y0)
        hmax = float(h[max(0, int(r0)) : min(H, int(np.ceil(r1)) + 1), max(0, int(c0)) : min(W, int(np.ceil(c1)) + 1)].max())
        R = R0 + max(0.0, hmax - float(lv.min()) - 0.5 * float(bw.min()) * float(slope.min())) / (float(slope.min()) + rise)
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
        # levee: under the ribbon the bank stays a little above the level (land only), then tapers down
        # at 1:2; never more than fillCap above the ground (the profile keeps the level within reach of
        # the banks, so this only tops up low bank lips) and nothing beyond the taper — no embankments
        hw_r = ribbon_half(cfg, l) + 0.1
        d_lev = hw_r + fill_cap / 0.5
        m2 = (d >= c) & (d < d_lev) & ~wet_lake & (land[idx_r, idx_c] >= 0.5)
        dm = d[m2]
        tx = np.clip((dm - hw_r) / (d_lev - hw_r), 0, 1)
        allow = (fill_cap + ex[k[m2]]) * (1 - tx * tx * (3 - 2 * tx))
        req = np.minimum(lvk[m2] + eps - 0.5 * np.maximum(0.0, dm - hw_r), h[idx_r[m2], idx_c[m2]] + allow)
        levee[idx_r[m2], idx_c[m2]] = np.maximum(levee[idx_r[m2], idx_c[m2]], req)
        # valley walls: nothing stands above a cap that rises from the water's edge at the wall slope out
        # to half the easing width and steepens beyond — a continuous envelope (the max cut over the
        # nearby centreline samples' cones, so bends and steep reaches leave no seam)
        m3 = (d >= c) & ~wet_lake
        if m3.any():
            # the 12 nearest samples at 0.2 km, plus the 8 nearest at 1 km: a cell between two arms of a
            # bend (a steep torrent's upper and lower reach) sees both arms' walls — no seam where the
            # nearest arm changes
            qq = q[ok][m3]
            parts_d, parts_k = [], []
            for step, kmax in ((2, 12), (10, 8)):
                sp = dp[::step]
                kq = min(kmax, len(sp))
                dj_, kj_ = cKDTree(sp).query(qq, k=kq)
                if kq == 1:
                    dj_, kj_ = dj_[:, None], kj_[:, None]
                parts_d.append(dj_)
                parts_k.append(kj_ * step)
            dj, kj = np.concatenate(parts_d, axis=1), np.concatenate(parts_k, axis=1)
            del parts_d, parts_k, qq
            ddj = np.maximum(dj - c, 0.0)
            # beyond half the easing width the cap steepens smoothly (its slope grows by 2·wallRise over
            # the second half): a bounded reach in steep terrain without a crease on gentle slopes
            over = np.maximum(0.0, ddj - 0.5 * bw[kj])
            limj = lv[kj] + eps + ddj * slope[kj] + rise * over * over / (0.5 * bw[kj])
            # ...and the cut fades out between half the easing width and the full width (no crease
            # where the eased wall meets the untouched slope)
            xw = np.clip((ddj - 0.5 * bw[kj]) / (0.5 * bw[kj]), 0.0, 1.0)
            wbj = 1.0 - xw * xw * (3.0 - 2.0 * xw)
            # ...and never deeper than the edge excess, tapering to nothing over the easing width
            xe = np.clip(ddj / np.minimum(bw[kj], np.maximum(edge_w, 1.5 * edge[kj] / edge_rise)), 0.0, 1.0)
            edj = edge[kj] * (1.0 - xe * xe * (3.0 - 2.0 * xe))
            # each sample's cone counts in full near the cell's own foot point(s) and fades out over
            # coneFadeKm beyond (a smooth envelope: no seam where the nearest arm of a bend changes, and a
            # torrent's far lower reach does not dig into the hillside beside its upper reach)
            xc = np.clip((dj - dj.min(axis=1, keepdims=True)) / cone_fade, 0.0, 1.0)
            wc = 1.0 - xc * xc * (3.0 - 2.0 * xc)
            hc = h[idx_r[m3], idx_c[m3]]
            cutv = (wc * np.minimum(wbj * np.maximum(0.0, hc[:, None] - limj), edj)).max(axis=1).astype(np.float32)
            bank_cut[idx_r[m3], idx_c[m3]] = np.maximum(bank_cut[idx_r[m3], idx_c[m3]], cutv)
            # ...and no other line's (or a lower reach's) easing may undercut this line's banks: below the
            # ribbon edge the ground may fall away from the water at most as steeply as the walls rise
            fl = (lv[kj] + eps - (slope[kj] + rise) * np.maximum(0.0, dj - (hw_r - 0.1)) - (1.0 - wc) * 5.0).max(axis=1).astype(np.float32)
            protect[idx_r[m3], idx_c[m3]] = np.maximum(protect[idx_r[m3], idx_c[m3]], fl)
        # masks
        aa = max(cfg.px_km * 0.75, l.width * 0.25)
        ch = smooth_band(d, c, aa)
        channel[idx_r, idx_c] = np.maximum(channel[idx_r, idx_c], ch)
        db = np.maximum(d - c, 0)
        closer = db < dist[idx_r, idx_c]
        dist[idx_r[closer], idx_c[closer]] = db[closer]
        near_level[idx_r[closer], idx_c[closer]] = lvk[closer]
        near_zone[idx_r[closer], idx_c[closer]] = hw_r - c
        near_line[idx_r[closer], idx_c[closer]] = l.idx
    in_core = np.isfinite(core_min)
    # eased walls, but never below another channel's bank protection (and never raised by it)
    np.maximum(h - bank_cut, np.minimum(h, protect), out=h)
    del bank_cut, protect
    np.maximum(h, np.where(in_core, -np.inf, levee), out=h)
    on_land = in_core & (land >= 0.5)
    h[on_land] = core_min[on_land]
    np.minimum(h, core_min, out=h)  # at sea mouths the section only ever lowers
    return {"channel": channel, "dist": dist, "near_level": near_level, "near_zone": near_zone, "near_line": near_line, "lake_any": lake_any, "core": in_core}


def marsh_fill(cfg: Config, h: np.ndarray, land: np.ndarray, lakes: dict[str, Lake], m: dict) -> list[dict]:
    """Low ground beside a river that its water surface closes off — a hollow once the river's own
    channel is taken at its water level, touching the ribbon zone below the water — fills up to the
    river's level within marshBandKm beyond the ribbon edge, easing back to the natural ground over the
    band's outer half: a marsh / floodplain at the water (the Gladden Fields, the Long Marshes) instead of
    the ribbon edge hanging over a drop. The surface follows the nearest river's level (it falls with the
    river) and never rises above the cell's own spill level (a lake's shore stays at the lake). Bounded:
    hollows needing more than marshMaxKm2 or marshMaxDepth are left as they are (reported). Returns the
    fills."""
    from .flow import fill_depressions

    Rv = cfg.world["rivers"]
    max_km2 = float(Rv.get("marshMaxKm2", 250.0))
    max_depth = float(Rv.get("marshMaxDepth", 3.0))
    band = float(Rv.get("marshBandKm", 3.0))
    seed_out = land < 0.5
    for key in Rv.get("sinks", []):
        lk = lakes.get(key)
        if lk is not None:
            seed_out[lk.r0 : lk.r0 + lk.cov.shape[0], lk.c0 : lk.c0 + lk.cov.shape[1]] |= lk.cov > 0.5
    # the river's own channel holds water up to its level: a hollow beside it does not drain through the
    # carved bed (the marsh rises to the water surface, not to the channel floor)
    dist, zone, lvl = m["dist"], m["near_zone"], m["near_level"]
    spill = fill_depressions(np.where(dist <= 0.0, np.maximum(h, lvl + CARVE_EPS), h).astype(np.float32), seed_out)
    wet = m["lake_any"] > 0.5
    inband = (dist > 0) & (dist <= zone + band)
    hollow = ((spill - h) > 0.01) & inband & (land >= 0.5) & ~wet
    seeds = hollow & (dist <= zone) & (h < lvl - 0.02)
    lab, _ = ndimage.label(hollow, structure=np.ones((3, 3), bool))
    ids = np.unique(lab[seeds])
    ids = ids[ids > 0]
    objs = ndimage.find_objects(lab)
    fills = []
    for i in ids:
        sl = objs[i - 1]
        comp = lab[sl] == i
        hs = h[sl]
        x = np.clip((dist[sl] - zone[sl] - 0.5 * band) / (0.5 * band), 0.0, 1.0)
        w = 1.0 - x * x * (3.0 - 2.0 * x)
        top = np.minimum(spill[sl], lvl[sl] + CARVE_EPS)
        need = np.where(comp, np.maximum(top - hs, 0.0) * w, 0.0)
        filled = need > 0.01
        area = float(filled.sum() * cfg.px_km**2)
        r, c = sl[0].start + int(np.argwhere(comp)[0][0]), sl[1].start + int(np.argwhere(comp)[0][1])
        rec = {"at": [round(cfg.x0_km + (c + 0.5) * cfg.px_km, 1), round(cfg.y1_km - (r + 0.5) * cfg.px_km, 1)], "km2": round(area, 1), "depth": round(float(need.max()), 2)}
        if area > max_km2 or need.max() > max_depth:
            rec["skipped"] = True
        elif area > 0:
            hs[:] = hs + need.astype(hs.dtype)
        else:
            continue
        fills.append(rec)
    return sorted(fills, key=lambda f: -f["km2"])


def valley_mask(cfg: Config, lines: list[Line]) -> np.ndarray:
    from rasterio import features

    valley = np.zeros((cfg.H, cfg.W), np.float32)
    for cls in ("great", "major", "minor", "stream"):
        sub = [LineString(l.pts) for l in lines if l.cls == cls and not l.absorbed]
        if not sub:
            continue
        g = [affinity.scale(s, 1e3, 1e3, origin=(0, 0)) for s in sub]
        m = features.rasterize(((x, 1) for x in g), out_shape=(cfg.H, cfg.W), transform=cfg.transform, fill=0, dtype="uint8", all_touched=True)
        d = (ndimage.distance_transform_edt(m == 0) * cfg.px_km).astype(np.float32)
        w = cfg.world["rivers"]["widthKm"][cls]
        np.maximum(valley, np.exp(-((d / (w * 2.5 + 2.0)) ** 2)), out=valley)
    return valley


def geometry_report(cfg: Config, h_pre: np.ndarray, h_lakes: np.ndarray, h_carve: np.ndarray, h: np.ndarray, land: np.ndarray, lines: list[Line], lakes: dict[str, Lake], m: dict, fills: list[dict]) -> dict:
    """What the hydro step did to the terrain, as gates (tools/check reads report.json). Everything is
    measured against the relief (h_pre) outside the channel cores, split by cause: the river carve
    (levee raise, wall lowering), the lake shores (grading down, rims up — an allowance), the marsh fills
    (an allowance); plus new cliffs (outside declared gorges / falls), confluence joins, ribbon edges
    above the ground and the cuts below the relief."""
    px2 = cfg.px_km**2
    core = m["core"]
    onland = land >= 0.5
    wet = m["lake_any"] > 0.5
    out = ~core & onland & ~wet
    by_idx = {l.idx: l for l in lines}

    def area(mask: np.ndarray) -> float:
        return round(float(mask.sum() * px2), 1)

    def where(a: np.ndarray) -> list[float]:
        r, c = np.unravel_index(int(np.argmax(a)), a.shape)
        return [round(cfg.x0_km + (c + 0.5) * cfg.px_km, 1), round(cfg.y1_km - (r + 0.5) * cfg.px_km, 1)]

    def worst_lines(mask: np.ndarray, k: int = 6) -> list[dict]:
        own = m["near_line"][mask]
        own = own[own >= 0]
        if not own.size:
            return []
        ids, cnt = np.unique(own, return_counts=True)
        order = np.lexsort((ids, -cnt))[:k]
        return [{"id": by_idx[int(ids[i])].id, "km2": round(float(cnt[i] * px2), 1)} for i in order]

    def clusters(a: np.ndarray, thr: float, k: int = 8) -> list[dict]:
        """The largest connected patches where a > thr: area, max, where, nearest line."""
        lab, n = ndimage.label(a > thr, structure=np.ones((3, 3), bool))
        if not n:
            return []
        idx = np.arange(1, n + 1)
        sizes = ndimage.sum(np.ones_like(a), lab, idx)
        peaks = ndimage.maximum_position(a, lab, idx)
        out = []
        for j in np.lexsort((idx, -sizes))[:k]:
            r, c = peaks[j]
            own = int(m["near_line"][r, c])
            out.append({"km2": round(float(sizes[j] * px2), 1), "max": round(float(a[r, c]), 2), "at": [round(float(cfg.x0_km + (c + 0.5) * cfg.px_km), 1), round(float(cfg.y1_km - (r + 0.5) * cfg.px_km), 1)], "id": by_idx[own].id if own >= 0 else None})
        return out

    rep: dict = {}
    # 1. the river carve outside the cores: ground raised (levees) and lowered (eased walls)
    dc = np.where(out, h_carve - h_lakes, 0.0)
    rep["riverRaise"] = {"over05Km2": area(dc > 0.5), "over1Km2": area(dc > 1), "max": round(float(dc.max()), 3), "at": where(dc)}
    near = m["dist"] <= 1.0
    far = m["dist"] > 2.0
    band = ~near & ~far
    rep["riverLower"] = {"over2Km2": area(dc < -2), "over2NearKm2": area((dc < -2) & near), "over2BandKm2": area((dc < -2) & band), "over2FarKm2": area((dc < -2) & far), "over4Km2": area(dc < -4), "over6Km2": area(dc < -6), "max": round(float(-dc.min()), 3), "at": where(-dc), "worst": worst_lines(dc < -2), "worstFar": worst_lines((dc < -2) & far)}
    # 1b. inside the channel cores (on land, off the lakes): the bed raised above the relief — pits the
    # profile pools over (pit closing, held levels) instead of cutting; the water surface there stands
    # above the natural valley floor, so the banks around it are raised too (levees, marsh fills)
    cm = core & onland & ~wet
    dcore = np.where(cm, h - h_pre, 0.0)
    rep["coreRaise"] = {"coreKm2": area(cm), "over05Km2": area(dcore > 0.5), "over1Km2": area(dcore > 1), "over2Km2": area(dcore > 2), "over3Km2": area(dcore > 3), "max": round(float(dcore.max()), 3), "at": where(dcore), "worst": worst_lines(dcore > 1), "worst2": worst_lines(dcore > 2), "pools": clusters(dcore, 2.0)}
    del dcore
    # 2. marsh fills of closed hollows beside a river (an allowance, bounded per hollow by the bake)
    mf = h - h_carve
    rep["marshFill"] = {"over05Km2": area(mf > 0.5), "filledKm2": area(mf > 0.01), "max": round(float(mf.max()), 3), "fills": fills}
    # 3. lake shores: grading down to the level and low shores raised to it (an allowance, per lake)
    dl = np.where(~wet & onland, h_lakes - h_pre, 0.0)
    rims = []
    for lk in lakes.values():
        if lk.level is None:
            continue
        sl = (slice(lk.r0, lk.r0 + lk.cov.shape[0]), slice(lk.c0, lk.c0 + lk.cov.shape[1]))
        w = dl[sl]
        rims.append({"key": lk.key, "level": round(float(lk.level), 3), "over05Km2": area(w > 0.5), "max": round(float(w.max()), 3), "lowered2Km2": area(w < -2)})
    rep["lakeRims"] = rims
    # 4. everything together, against the relief outside the cores (the honest total) and what is left
    # once the declared allowances (marsh fills, lake rims / shore grading) are taken out
    dt = np.where(out, h - h_pre, 0.0)
    marsh = mf > 0.01
    lake_zone = np.abs(dl) > 0.01
    rep["terrain"] = {
        "raised05Km2": area(dt > 0.5),
        "raised1Km2": area(dt > 1),
        "lowered2Km2": area(dt < -2),
        "lowered4Km2": area(dt < -4),
        "maxRaise": round(float(dt.max()), 3),
        "maxLower": round(float(-dt.min()), 3),
        "atMaxLower": where(-dt),
        "allowances": {"marshRaised05Km2": area((dt > 0.5) & marsh), "lakeRaised05Km2": area((dt > 0.5) & lake_zone & ~marsh), "lakeLowered2Km2": area((dt < -2) & lake_zone)},
        "otherRaised05Km2": area((dt > 0.5) & ~marsh & ~lake_zone),
        "otherLowered2Km2": area((dt < -2) & ~lake_zone),
        "otherLowered4Km2": area((dt < -4) & ~lake_zone),
    }
    # 5. neighbour steps > 3 units the relief did not have (pairs, cells, clusters), outside the declared
    # gorges (bankOverrides) and falls (their snap radius + plunge)
    Rv = cfg.world["rivers"]
    zones = [(o["atKm"], float(o["radiusKm"])) for o in Rv.get("bankOverrides", [])]
    zones += [(f["atKm"], float(f.get("snapKm", 6.0)) + float(Rv.get("plungeKm", 4.0))) for f in Rv.get("falls", [])]
    cells = np.zeros(h.shape, bool)
    pairs = 0
    for ax in (0, 1):
        mm = (np.abs(np.diff(h, axis=ax)) > 3) & (np.abs(np.diff(h_pre, axis=ax)) <= 3)
        pairs += int(mm.sum())
        r, c = np.nonzero(mm)
        cells[r, c] = True
        cells[r + (ax == 0), c + (ax == 1)] = True
    r, c = np.nonzero(cells)
    xs = cfg.x0_km + (c + 0.5) * cfg.px_km
    ys = cfg.y1_km - (r + 0.5) * cfg.px_km
    declared = np.zeros(len(r), bool)
    for (zx, zy), zr in zones:
        declared |= np.hypot(xs - zx, ys - zy) < zr
    und = np.zeros(h.shape, bool)
    und[r[~declared], c[~declared]] = True
    lab, ncl = ndimage.label(und, structure=np.ones((3, 3), bool))
    at = []
    if ncl:
        sizes = ndimage.sum(und, lab, index=np.arange(1, ncl + 1))
        for k in np.argsort(-sizes, kind="stable")[:5]:
            rr, cc = np.argwhere(lab == k + 1)[0]
            at.append([round(cfg.x0_km + (cc + 0.5) * cfg.px_km, 1), round(cfg.y1_km - (rr + 0.5) * cfg.px_km, 1)])
    rep["newSteps"] = {"over3": pairs, "cells": int(cells.sum()), "declaredCells": int(declared.sum()), "undeclaredCells": int(und.sum()), "clusters": int(ncl), "at": at, "worst": worst_lines(und)}
    # 6. confluences: a side feeder ends at its parent's core edge, at the parent's level, and its ribbon
    # end never floats above its own bed
    by_id = {l.id: l for l in lines}
    joins = []
    for l in lines:
        if l.absorbed or l.into not in by_id:
            continue
        par = nearest_parent(lines, l, by_id[l.into].idx)
        P = lines[par]
        sp, q = project(P.pts, P.s, l.pts[-1])
        d = float(np.hypot(*(q - l.pts[-1])))
        # the side feeder's last 2 km on land (a main feeder runs straight on into its continuation's
        # deeper channel; at an estuary the ribbon hands over to the sea)
        tail = l.s >= l.s[-1] - 2.0
        ground = bilinear(cfg, h, l.pts[tail])
        fl = np.where(ground > 0.02, l.level[tail] - ground - l.depth, 0.0) if l.clip_parents else np.zeros(1)
        joins.append({"id": l.id, "into": l.into, "offKm": round(d - (P.core if l.clip_parents else 0.0), 3), "dLevel": round(float(l.level[-1] - np.interp(sp, P.s, P.level)), 4), "float": round(float(fl.max()), 3)})
    rep["joins"] = joins
    # 7. ribbon edges above the final ground (water hanging over a lower bank), km of river
    edge = []
    total = 0.0
    length = 0.0
    for l in lines:
        if l.absorbed or len(l.s) < 2:
            continue
        nrm = normals(l.pts)
        hw = ribbon_half(cfg, l)
        ds = float(l.s[1] - l.s[0])
        length += float(l.s[-1])
        fl = np.zeros(len(l.s))
        for sgn in (1.0, -1.0):
            q = l.pts + nrm * (sgn * hw * 0.85)
            g = bilinear(cfg, h, q)
            dry = (bilinear(cfg, land, q) >= 0.5) & (bilinear(cfg, m["lake_any"], q) < 0.5)
            fl = np.maximum(fl, np.where(dry, l.level - g, 0.0))
        km = float((fl > 0.15).sum() * ds)
        total += km
        if km > 0:
            k = int(np.argmax(fl))
            edge.append({"id": l.id, "km": round(km, 1), "max": round(float(fl[k]), 2), "at": [round(float(l.pts[k][0]), 1), round(float(l.pts[k][1]), 1)]})
    rep["edgeFloat"] = {"totalKm": round(total, 1), "lengthKm": round(length, 1), "share": round(total / max(length, 1e-6), 5), "lines": sorted(edge, key=lambda e: -e["km"])}
    # 8. cuts below the relief (thalweg − bed)
    cuts = []
    for l in lines:
        if l.absorbed:
            continue
        cut = l.thal - l.bed
        k = int(np.argmax(cut))
        cuts.append({"id": l.id, "max": round(float(cut[k]), 2), "at": [round(float(l.pts[k][0]), 1), round(float(l.pts[k][1]), 1)], "over2Km": round(float((cut > 2).sum() * (l.s[1] - l.s[0] if len(l.s) > 1 else 0)), 1)})
    rep["cuts"] = sorted(cuts, key=lambda c: -c["max"])
    # 9. continuation nodes: the main feeder ends exactly where its continuation starts, at its level
    conts = []
    for l in lines:
        if l.absorbed or not l.cont_main or l.down[0] != "line":
            continue
        C = lines[l.down[1]]
        conts.append({"id": l.id, "into": C.id, "gapKm": round(float(np.hypot(*(l.pts[-1] - C.pts[0]))), 4), "dLevel": round(float(l.level[-1] - C.level[0]), 4)})
    rep["continuations"] = conts
    # 10. lengths: raw ME-GIS (clipped to the frame) → processed, and where the difference went
    lens = []
    for l in lines:
        lens.append({"id": l.id, "rawKm": round(float(l.geom.length), 2), "km": 0.0 if l.absorbed else round(float(l.s[-1]), 2), "trimKm": round(l.trim_km, 2), "clipKm": round(l.clip_km, 2), "shortKm": round(l.short_km, 2), "absorbed": l.absorbed})
    rep["lengths"] = {"rawKm": round(sum(x["rawKm"] for x in lens), 1), "km": round(sum(x["km"] for x in lens), 1), "trimKm": round(sum(x["trimKm"] for x in lens), 1), "maxTrimKm": max((x["trimKm"] for x in lens), default=0.0), "lines": lens}
    return rep


def run_hydro(cfg: Config, h_pre: np.ndarray, land: np.ndarray) -> tuple[np.ndarray, dict[str, np.ndarray], dict]:
    with Timer("hydro: lakes"):
        lakes = load_lakes(cfg)
    lines, log, snap_stats = solve(cfg, h_pre, land, lakes)
    h = h_pre.copy()
    with Timer("hydro: lake shores"):
        shape_lakes(cfg, h, land, lakes, lines)
    h_lakes = h.copy()
    with Timer("hydro: carve + masks"):
        m = carve(cfg, h, land, lines, lakes)
        valley = valley_mask(cfg, lines)
    h_carve = h.copy()
    with Timer("hydro: marsh fill"):
        fills = marsh_fill(cfg, h, land, lakes, m)
    with Timer("hydro: geometry report"):
        report = geometry_report(cfg, h_pre, h_lakes, h_carve, h, land, lines, lakes, m, fills)
        report["snap"] = snap_stats
    del h_lakes, h_carve
    for s in log:
        print(f"[bake]   {s}")
    rr, rl, tr, ns = report["riverRaise"], report["riverLower"], report["terrain"], report["newSteps"]
    print(f"[bake]   report: carve outside the cores: raised > 0.5 {rr['over05Km2']} km² (max {rr['max']}), lowered > 2 {rl['over2Km2']} km² ({rl['over2NearKm2']} within 1 km of a core, {rl['over2FarKm2']} beyond 2 km), > 4 {rl['over4Km2']} km², > 6 {rl['over6Km2']} km², max {rl['max']} at {rl['at']}; worst " + ", ".join(f"{w['id']} {w['km2']}" for w in rl["worst"]) + "; beyond 2 km " + ", ".join(f"{w['id']} {w['km2']}" for w in rl["worstFar"]))
    print(f"[bake]   report: |h - h_pre| outside the cores: raised > 0.5 {tr['raised05Km2']} km² (marsh {tr['allowances']['marshRaised05Km2']}, lakes {tr['allowances']['lakeRaised05Km2']}, other {tr['otherRaised05Km2']}), lowered > 2 {tr['lowered2Km2']} km² (lake shores {tr['allowances']['lakeLowered2Km2']}, other {tr['otherLowered2Km2']}; > 4 {tr['otherLowered4Km2']})")
    print(f"[bake]   report: new > 3-unit steps: {ns['over3']} pairs, {ns['cells']} cells ({ns['declaredCells']} in declared gorges / falls), {ns['undeclaredCells']} undeclared cells in {ns['clusters']} clusters at {ns['at']}")
    print("[bake]   report: lake rims " + ", ".join(f"{r['key']} {r['over05Km2']} km² (max {r['max']})" for r in report["lakeRims"]))
    worst = sorted(report["joins"], key=lambda j: -max(j["float"], abs(j["dLevel"]) * 10, j["offKm"]))[:3]
    print("[bake]   report: worst joins " + "; ".join(f"{j['id']}→{j['into']} off {j['offKm']} km, Δlevel {j['dLevel']}, float {j['float']}" for j in worst))
    print("[bake]   report: deepest cuts " + ", ".join(f"{c['id']} {c['max']} ({c['over2Km']} km > 2)" for c in report["cuts"][:6]))
    mf = report["marshFill"]
    print(f"[bake]   report: marsh fills {mf['filledKm2']} km² (> 0.5: {mf['over05Km2']} km², max {mf['max']}): " + ", ".join(f"{f['km2']} km² at {f['at']}" + (" skipped" if f.get("skipped") else "") for f in mf["fills"][:6]))
    cr = report["coreRaise"]
    print(f"[bake]   report: channel cores raised above the relief: > 0.5 {cr['over05Km2']} km², > 1 {cr['over1Km2']}, > 2 {cr['over2Km2']}, > 3 {cr['over3Km2']} (of {cr['coreKm2']} km² of core), max {cr['max']} at {cr['at']}; worst > 1 " + ", ".join(f"{w['id']} {w['km2']}" for w in cr["worst"]) + "; > 2 " + ", ".join(f"{w['id']} {w['km2']}" for w in cr["worst2"]))
    gaps = sorted(report["continuations"], key=lambda c: -c["gapKm"])
    print(f"[bake]   report: continuations {len(gaps)}, largest gaps " + ", ".join(f"{c['id']}→{c['into']} {c['gapKm']} km (Δlevel {c['dLevel']})" for c in gaps[:4]))
    ln = report["lengths"]
    print(f"[bake]   report: river length raw {ln['rawKm']} km → {ln['km']} km; source trims {ln['trimKm']} km (max {ln['maxTrimKm']}): " + ", ".join(f"{x['id']} {x['trimKm']}" for x in sorted(ln["lines"], key=lambda x: -x["trimKm"])[:8] if x["trimKm"] > 0))
    ef = report["edgeFloat"]
    print(f"[bake]   report: ribbon edges > 0.15 above the ground on {ef['totalKm']} of {ef['lengthKm']} km ({100 * ef['share']:.2f} %): " + ", ".join(f"{e['id']} {e['km']} km (max {e['max']})" for e in ef["lines"][:6]))
    rivers = []
    for l in lines:
        if l.absorbed:
            continue
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
                "_up": list(l.up[:1]) + ([lines[l.up[1]].id] if l.up[0] == "line" else [lines[j].id for j in l.up[1:]] if l.up[0] == "cont" else list(l.up[1:])),
                "_bank": [round(float(v), 3) if np.isfinite(v) else None for v in l.bank],
                "_thal": [round(float(v), 3) for v in l.thal],
                "_flipped": l.flipped,
                "_snap": [round(l.snap[0], 2), round(l.snap[1], 3)],
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
    return h, masks, {"rivers": rivers, "lakes": lake_info, "log": log, "report": report}
