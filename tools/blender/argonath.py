"""The Argonath king (S3 W2-D Blender spike) -> public/models/argonath.glb.

ONE king — the landmark places it twice (src/landmarks/argonath/index.ts, `USE_GLB`), unmirrored: both
kings raise the LEFT hand (the film, the book). The bearded king under a crowned helm, robed, the left arm
raised with the open palm facing upstream, a heavy sleeve drape falling from it to the pedestal, the right
fist before the chest round a long axe; on a battered pedestal with boulders at the waterline.

Built from the SAME proportions as the TS-v2 fallback (src/landmarks/argonath/king.ts `KING`, `ROBE`), but as
sculpture: every part is generated at high resolution, the whole statue is fused into one carved surface by
an OpenVDB voxel remesh (12 m voxels), smoothed, weathered by fixed-seed noise (lumps, rain grooves, chipped
edges, eye sockets), decimated into lod0 / lod1 / lod2 and painted per vertex (grey-green stone, darker
crevices and wet foot, rain streaks, lichen on upward faces).

Frames: king frame = pedestal axis at the waterline, x right (the king's right hand), y up, facing -z;
Blender = (x, -z, y) so the model faces +Y (lib.py conventions).
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

SEED = 0x4A26A7
# keep in sync with src/landmarks/argonath/king.ts KING (the GLB pedestal foot stops at -1.2: still buried
# under the river bed / the banks, fewer hidden triangles)
PED_FOOT = -1.2
PED_TOP = 1.6
PED_W = 2.1
PED_D = 1.55
SHOULDER_Y = 3.5
SHOULDER_X = 0.52
HEAD_Y = 4.12
LEFT_ELBOW = (-0.8, 4.3, -0.1)
LEFT_WRIST = (-0.86, 5.1, -0.18)
RIGHT_ELBOW = (0.64, 2.72, 0.02)
RIGHT_FIST = (0.28, 2.95, -0.4)
AXE_BOTTOM, AXE_TOP, AXE_R = 0.2, 3.95, 0.038
# robe sections (y above the pedestal top, half width, half depth front, extra depth behind, fold scale)
ROBE = [
    (0.0, 0.71, 0.45, 0.22, 1.0),
    (0.14, 0.68, 0.43, 0.21, 1.0),
    (0.7, 0.62, 0.39, 0.18, 0.95),
    (1.4, 0.55, 0.35, 0.14, 0.85),
    (2.05, 0.48, 0.31, 0.1, 0.7),
    (2.5, 0.43, 0.28, 0.08, 0.5),
    (2.9, 0.48, 0.3, 0.07, 0.45),
    (3.3, 0.55, 0.31, 0.06, 0.35),
    (3.55, 0.6, 0.28, 0.05, 0.2),
    (3.72, 0.34, 0.2, 0.02, 0.0),
]
ROBE_TOP = ROBE[-1][0]

VOXEL = 0.012
# figure triangles per LOD (the pedestal adds ≈ 0.8k / 0.1k / 0.05k)
LOD_TRIS = (37400, 8800, 1750)
STONE = 0x80847B
PLINTH = 0x6F6A5C
LICHEN = 0x767A5C


def K(x, y, z):
    """figure frame (y above the pedestal top) -> Blender"""
    return (x, -z, y + PED_TOP)


def KB(x, y, z):
    """king frame (y above the waterline) -> Blender"""
    return (x, -z, y)


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def angdiff(a, b):
    d = (a - b) % (2 * math.pi)
    return d - 2 * math.pi if d > math.pi else d


def section(y):
    """interpolated robe section at figure height y (smooth: cosine blend between table rows)"""
    for k in range(len(ROBE) - 1):
        a, b = ROBE[k], ROBE[k + 1]
        if y <= b[0]:
            t = max(0.0, (y - a[0]) / (b[0] - a[0]))
            t = 0.5 - 0.5 * math.cos(math.pi * t) if k > 0 else t
            return tuple(a[i] + (b[i] - a[i]) * t for i in range(1, 5))
    return ROBE[-1][1:]


# ------------------------------------------------------------------ folds
def make_folds(rnd, n, front_start, side_start):
    """fold ridges: angle, angular half width, weight, start height (they run from there to the hem), fan drift"""
    folds = []
    for i in range(n):
        th = 2 * math.pi * (i + 0.5 + (rnd.random() - 0.5) * 0.7) / n
        front = math.sin(th) < -0.55
        start = (front_start + rnd.random() * 0.35) if front else (side_start + rnd.random() * 0.7)
        folds.append((th, 0.08 + rnd.random() * 0.07, 0.6 + rnd.random() * 0.7, start, (rnd.random() - 0.5) * 0.16))
    return folds


def fold_field(t, y, folds):
    f = 0.0
    for th, wd, w, start, drift in folds:
        if y > start:
            continue
        ramp = smoothstep(start, start - 0.7, y)
        c = th + drift * (start - y) / max(start, 1e-3)
        d = angdiff(t, c) / wd
        if abs(d) < 1:
            f += w * ramp * (1 - d * d) ** 2
    return f


# ------------------------------------------------------------------ parts
def robe(rnd):
    folds = make_folds(rnd, 30, 2.4, 3.1)
    n, ny = 288, 110
    rings = []
    for k in range(ny + 1):
        y = ROBE_TOP * (k / ny) ** 1.08
        hw, hd, back, fs = section(y)
        amp = (0.035 + 0.1 * (1 - y / ROBE_TOP) ** 0.8) * fs
        flare = 1 + 0.05 * smoothstep(0.18, 0.0, y)
        ring = []
        for j in range(n):
            t = 2 * math.pi * j / n
            c, s = math.cos(t), math.sin(t)
            depth = hd + back * s if s > 0 else hd
            sc = (1 + amp * (fold_field(t, y, folds) - 0.35)) * flare
            ring.append(K(hw * c * sc, y, depth * s * sc))
        rings.append(ring)
    return lib.grid_surface(rings)


def front_edges():
    """the cloak's two raised hems down the front, from the collar to the ground"""
    out = lib.Mesh()
    for sx in (-1, 1):
        path = []
        for k in range(24):
            y = 3.45 - 3.42 * k / 23
            hw, hd, _, _ = section(y)
            x = sx * (0.2 + (3.45 - y) * 0.05)
            z = -hd * math.sqrt(max(0.0, 1 - (x / hw) ** 2)) * 1.03
            path.append(K(x, y, z))
        out.add(lib.sweep(path, lambda t: (0.05, 0.05), seg=12))
    return out


def belt():
    hw, hd, back, _ = section(2.5)
    rings = []
    for y in (2.44, 2.56):
        ring = []
        for j in range(96):
            t = 2 * math.pi * j / 96
            s = math.sin(t)
            depth = hd + back * s if s > 0 else hd
            ring.append(K(hw * math.cos(t) * 1.06, y, depth * s * 1.06))
        rings.append(ring)
    m = lib.grid_surface(rings)
    m.add(lib.capsule(K(0.06, 2.45, -0.3), K(0.1, 1.2, -0.41), 0.045, 0.035, seg=12))
    m.add(lib.ellipsoid(K(0.0, 2.5, -0.31), (0.09, 0.05, 0.075), seg=16, rings=10))  # buckle
    return m


def drape(rnd):
    """the heavy sleeve falling from the raised left arm to the pedestal (outer side)"""
    table = [
        (0.02, -0.66, 0.27, 0.29),
        (1.0, -0.66, 0.25, 0.26),
        (2.2, -0.66, 0.22, 0.22),
        (3.2, -0.68, 0.18, 0.18),
        (3.75, -0.7, 0.14, 0.15),
        (4.02, -0.72, 0.1, 0.12),
    ]
    top = table[-1][0]

    def at(y):
        for k in range(len(table) - 1):
            a, b = table[k], table[k + 1]
            if y <= b[0]:
                t = (y - a[0]) / (b[0] - a[0])
                return tuple(a[i] + (b[i] - a[i]) * t for i in range(1, 4))
        return table[-1][1:]

    ys = [0.02 + (top - 0.02) * k / 60 for k in range(61)]
    path = [K(at(y)[0], y, 0.02) for y in ys]
    ph = [rnd.random() * 6.28 for _ in range(3)]

    def radius(t):
        _, hw, hd = at(ys[min(60, round(t * 60))])
        return (hd, hw)

    def sect(a, t):
        amp = 0.04 + 0.08 * (1 - t)
        return 1 + amp * (0.55 * math.cos(7 * a + ph[0]) + 0.3 * math.cos(11 * a + ph[1]) + 0.15 * math.cos(17 * a + ph[2]))

    m = lib.sweep(path, radius, seg=96, section=sect)
    # round the top into the underside of the sleeve
    m.add(lib.ellipsoid(K(-0.72, top, 0.02), (0.12, 0.13, 0.1), seg=24, rings=12))
    return m


def left_arm():
    sh = (-SHOULDER_X, SHOULDER_Y, 0.0)
    el = LEFT_ELBOW
    wr = LEFT_WRIST
    mid = lambda a, b, t: tuple(a[i] + (b[i] - a[i]) * t for i in range(3))  # noqa: E731
    nodes = [(*K(*sh), 0.2), (*K(*mid(sh, el, 0.5)), 0.18), (*K(*el), 0.145), (*K(*mid(el, wr, 0.5)), 0.12), (*K(*wr), 0.095)]
    arm = lib.skin('left_arm', nodes, [(0, 1), (1, 2), (2, 3), (3, 4)], subsurf=2)
    # the heavy sleeve over the upper arm (slid back to the elbow), rounded at both ends
    sleeve = lib.capsule(K(*sh), K(*mid(sh, el, 0.92)), 0.215, 0.2, seg=40, rings=12, caps=4)
    return arm, sleeve


def hand():
    """the open left hand, palm facing upstream (-z), fingers together, thumb towards the body"""
    el = Vector(K(*LEFT_ELBOW))
    wr = Vector(K(*LEFT_WRIST))
    v = (wr - el).normalized()
    u = (Vector((1, 0, 0)) - v * v.x).normalized()
    nrm = u.cross(v)
    if nrm.y < 0:  # the palm must face +Y (Blender) = -z (king frame)
        u = -u
    o = wr + v * 0.01 + Vector((0, 0.02, 0))
    HS = 1.12
    palm = [(a * HS, b * HS) for a, b in ((-0.1, 0.0), (0.0, -0.01), (0.1, 0.0), (0.108, 0.13), (0.1, 0.25), (0.0, 0.265), (-0.1, 0.25), (-0.106, 0.12))]
    # u points to the king's right (+x, towards the body) unless flipped above
    sgn = 1 if u.x > 0 else -1
    m = lib.slab([(a * sgn, b) for a, b in palm], 0.08, (o, u, v))
    P = lambda a, b, c=0.0: o + u * (a * sgn) + v * b + u.cross(v).normalized() * c  # noqa: E731
    for fx, ln in ((-0.075, 0.2), (-0.026, 0.225), (0.024, 0.215), (0.072, 0.185)):
        m.add(lib.capsule(tuple(P(fx * HS, 0.23 * HS)), tuple(P(fx * 1.04 * HS, (0.23 + ln) * HS, 0.012)), 0.029, 0.023, seg=12, rings=4))
    m.add(lib.capsule(tuple(P(0.085 * HS, 0.05 * HS)), tuple(P(0.175 * HS, 0.185 * HS, 0.01)), 0.033, 0.025, seg=12, rings=4))
    return m


def right_arm():
    sh = (SHOULDER_X, SHOULDER_Y, 0.0)
    el = RIGHT_ELBOW
    fi = RIGHT_FIST
    mid = lambda a, b, t: tuple(a[i] + (b[i] - a[i]) * t for i in range(3))  # noqa: E731
    nodes = [(*K(*sh), 0.2), (*K(*mid(sh, el, 0.5)), 0.175), (*K(*el), 0.15), (*K(*mid(el, fi, 0.5)), 0.125), (*K(*fi), 0.1)]
    arm = lib.skin('right_arm', nodes, [(0, 1), (1, 2), (2, 3), (3, 4)], subsurf=2)
    fist = lib.ellipsoid(K(*fi), (0.13, 0.12, 0.12), seg=20, rings=12)
    return arm, fist


def axe():
    fx, fz = RIGHT_FIST[0], RIGHT_FIST[2] - 0.02
    m = lib.capsule(K(fx, AXE_BOTTOM, fz), K(fx, AXE_TOP, fz), AXE_R, AXE_R * 0.85, seg=14, rings=12)
    m.add(lib.capsule(K(fx, AXE_TOP, fz), K(fx, AXE_TOP + 0.17, fz), 0.05, 0.012, seg=10, rings=3))
    blade = [(0.0, 3.34), (0.14, 3.3), (0.3, 3.2), (0.365, 3.42), (0.375, 3.62), (0.32, 3.84), (0.15, 3.77), (0.0, 3.72), (-0.13, 3.56), (-0.02, 3.52)]
    cu = sum(p[0] for p in blade) / len(blade)
    cv = sum(p[1] for p in blade) / len(blade)
    o = Vector(K(fx, 0.0, fz))
    m.add(lib.slab([(a, b) for a, b in blade], 0.055, (o, (1, 0, 0), (0, 0, 1))))
    del cu, cv
    return m


def head(rnd):
    m = lib.capsule(K(0, 3.55, 0.0), K(0, 3.95, -0.02), 0.155, 0.135, seg=24, rings=6)
    m.add(lib.ellipsoid(K(0, HEAD_Y, -0.02), (0.19, 0.2, 0.245), seg=40, rings=24))
    m.add(lib.ellipsoid(K(0, 4.18, -0.175), (0.16, 0.05, 0.042), seg=24, rings=10))  # brow
    m.add(lib.capsule(K(0, 4.16, -0.2), K(0, 4.02, -0.262), 0.036, 0.052, seg=12, rings=4))  # nose
    for sx in (-1, 1):  # cheekbones
        m.add(lib.ellipsoid(K(sx * 0.1, 4.07, -0.15), (0.07, 0.06, 0.05), seg=16, rings=8))
    for sx in (-1, 1):  # moustache sweeping into the beard
        m.add(lib.capsule(K(sx * 0.03, 4.0, -0.215), K(sx * 0.12, 3.9, -0.19), 0.03, 0.02, seg=12, rings=4))
    # beard: a tapering fluted wedge from the chin over the chest
    chin = Vector(K(0, 3.98, -0.13))
    tip = Vector(K(0, 3.32, -0.36))
    path = [tuple(chin.lerp(tip, k / 30) + Vector((0, 0.03 * math.sin(math.pi * k / 30), 0))) for k in range(31)]
    ph = rnd.random() * 6.28
    m.add(lib.sweep(path, lambda t: (0.11 * (1 - 0.5 * t) + 0.02, 0.22 * (1 - 0.45 * t) + 0.02), seg=48,
                    section=lambda a, t: 1 + 0.12 * math.cos(9 * a + ph) * (0.3 + t)))
    m.add(lib.ellipsoid(tuple(tip), (0.13, 0.07, 0.08), seg=24, rings=12))
    # the collar of the cloak
    m.add(lib.lathe([(0.001, 0.0), (0.3, 0.0), (0.27, 0.1), (0.17, 0.15), (0.001, 0.15)], seg=48).transform(Matrix.Translation(Vector(K(0, 3.6, 0.02)))))
    # shoulders
    for sx in (-1, 1):
        m.add(lib.ellipsoid(K(sx * SHOULDER_X, SHOULDER_Y - 0.02, 0.0), (0.24, 0.22, 0.2), seg=24, rings=14))
    return m


def crown(rnd):
    """helm dome, a crown band flaring out, nine tines (the front one tallest)"""
    base = Matrix.Translation(Vector(K(0, 4.1, -0.02)))
    helm = [(0.001, -0.02), (0.228, -0.02), (0.238, 0.03), (0.226, 0.07), (0.217, 0.16), (0.183, 0.26), (0.1, 0.325), (0.001, 0.342)]
    m = lib.lathe(helm, seg=48).transform(base)
    band = [(0.001, 0.02), (0.25, 0.02), (0.29, 0.16), (0.001, 0.16)]
    m.add(lib.lathe(band, seg=48).transform(base))
    for i in range(9):
        a = 2 * math.pi * i / 9 - math.pi / 2  # i = 0: front (-z)
        c, s = math.cos(a), math.sin(a)
        h = 0.3 if i == 0 else 0.16 + 0.06 * (i % 2) + 0.02 * rnd.random()
        p0 = K(c * 0.265, 4.24, -0.02 + s * 0.265)
        p1 = K(c * (0.265 + 0.2 * h), 4.24 + h, -0.02 + s * (0.265 + 0.2 * h))
        m.add(lib.capsule(p0, p1, 0.045, 0.006, seg=10, rings=4, caps=2))
    return m


def pedestal(lod, rocks):
    """the battered block + moulded step (flat-shaded, bevelled at lod0) and, at lod0, boulders at the
    waterline — built apart from the voxel-remeshed figure so its flat faces cost almost nothing"""
    pw, pd, ch = PED_W / 2, PED_D / 2, 0.22
    block = [(-pw + ch, -pd), (pw - ch, -pd), (pw, -pd + ch), (pw, pd - ch), (pw - ch, pd), (-pw + ch, pd), (-pw, pd - ch), (-pw, -pd + ch)]
    bl = [(x, -z) for x, z in block]
    m = lib.prism(bl, PED_FOOT, PED_TOP - 0.16, taper=0.1)
    m.add(lib.prism([(x * 0.86, y * 0.86) for x, y in bl], PED_TOP - 0.17, PED_TOP, taper=0.05))
    ob = m.obj(f'ped{lod}', smooth=False)
    if lod == 0:
        lib.bevel(ob, 0.025, segments=1, angle_deg=30)
    parts = [ob]
    if lod == 0:
        for i, (a, r) in enumerate(rocks):
            c = KB(math.cos(a) * (pw + 0.05), 0.02, math.sin(a) * (pd + 0.05))
            rk = lib.ellipsoid(c, (r * 1.1, r, r * 0.7), seg=12, rings=7).obj(f'rock{i}')
            off = Vector((i * 3.1, i * 1.7, 0.0))
            lib.displace(rk, lambda co, n, off=off: 0.22 * r * lib.fbm(co * 5.0 + off, 2))
            parts.append(rk)
    return lib.join(f'pedestal{lod}', parts)


# ------------------------------------------------------------------ surface
EYES = [Vector(K(sx * 0.075, 4.125, -0.2)) for sx in (-1, 1)]


def weathering(co, n):
    """only what survives a 37k-triangle budget (≈ 50 m triangles): a hand-carved low-frequency
    irregularity and deep eye sockets; finer weathering lives in the vertex paint"""
    d = 0.005 * lib.fbm(co * 3.0, 2)
    for e in EYES:
        q = (co - e).length
        if q < 0.11:
            d -= 0.032 * math.exp(-(q / 0.045) ** 2)
    return d


STONE_L = lib.srgb_to_linear(STONE)
PLINTH_L = lib.srgb_to_linear(PLINTH)
LICHEN_L = lib.srgb_to_linear(LICHEN)


def paint(co, n, cav):
    ped = 1 - smoothstep(PED_TOP - 0.03, PED_TOP + 0.005, co.z)
    base = [STONE_L[i] * (1 - ped) + PLINTH_L[i] * ped for i in range(3)]
    k = 1 - 0.3 * min(1.0, max(0.0, cav * 1.6)) + 0.08 * min(1.0, max(0.0, -cav * 1.6))
    streak = lib.fbm(Vector((co.x * 13.0, co.y * 13.0, co.z * 1.1)) + Vector((2.2, 5.1, 0.0)), 2)
    k *= 1 - 0.14 * max(0.0, streak)
    k *= 0.72 + 0.28 * smoothstep(0.1, 0.7, co.z)  # wet foot at the waterline
    k *= 0.96 + 0.08 * max(0.0, n.z)  # sun-bleached tops
    col = [c * k for c in base]
    li = lib.fbm(co * 5.0 + Vector((11.0, 3.0, 5.0)), 2)
    w = 0.45 * smoothstep(0.25, 0.7, n.z) * smoothstep(0.0, 0.3, li)
    return tuple(col[i] * (1 - w) + LICHEN_L[i] * k * w for i in range(3))


def main():
    out = lib.out_path()
    lib.reset(SEED)
    rnd = random.Random(SEED)
    lib.log('parts')
    parts = [
        robe(rnd).obj('robe'),
        front_edges().obj('edges'),
        belt().obj('belt'),
        drape(rnd).obj('drape'),
        hand().obj('hand'),
        axe().obj('axe'),
        head(rnd).obj('head'),
        crown(rnd).obj('crown'),
    ]
    rocks = [(2 * math.pi * i / 7 + 0.4 + rnd.random() * 0.5, 0.18 + 0.16 * rnd.random()) for i in range(7)]
    la, sleeve = left_arm()
    ra, fist = right_arm()
    parts += [la, sleeve.obj('sleeve'), ra, fist.obj('fist')]
    fig = lib.join('king', parts)
    lib.log(f'joined: {lib.tri_count(fig)} tris; voxel remesh {VOXEL} km')
    lib.voxel_remesh(fig, VOXEL)
    lib.log(f'remeshed: {lib.tri_count(fig)} tris')
    lib.smooth(fig, 0.5, 3)
    lib.displace(fig, weathering)
    lods = []
    for i, target in enumerate(LOD_TRIS):
        f = lib.decimate(fig, f'fig{i}', target)
        ob = lib.join(f'lod{i}', [f, pedestal(i, rocks)])
        tri = ob.modifiers.new('tri', 'TRIANGULATE')
        tri.quad_method = 'FIXED'
        lib.apply_modifiers(ob)
        lib.paint(ob, paint)
        lib.assign(ob, 'weathered')
        lods.append(ob)
        lib.log(f'lod{i}: {lib.tri_count(ob)} tris, {len(ob.data.vertices)} vertices')
    bpy_data_remove(fig)
    lib.export_glb(out, lods)
    lib.report(lods)


def bpy_data_remove(ob):
    import bpy
    me = ob.data
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)


main()
