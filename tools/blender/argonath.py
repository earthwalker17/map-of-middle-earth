"""The Argonath kings (S3 W2-D) -> public/models/argonath.glb.

ONE shared body and two head variants — the landmark places the model twice (src/landmarks/argonath/index.ts),
unmirrored (both kings raise the LEFT hand: the film, the book), each instance adding its own head nodes:
- `lod0` / `lod1` / `lod2`: the robed body under a mantle, the raised left arm, the open left hand (palm
  facing upstream, fingers together), the cloak falling on that side, the right fist round a long axe, the
  chipped pedestal and the boulders at its foot;
- `crown_lod0..2`: the bearded king under a tall, narrow Gondorian helm-crown with a low diadem (the film's
  west king);
- `helm_lod0..2`: the king in a full helm with a face guard and a crest (the film's east king).

Built from the same proportions as the TS-v2 fallback (src/landmarks/argonath/king.ts) but as sculpture:
each piece is generated at high resolution and fused into one carved surface by an OpenVDB voxel remesh
(body 12 m voxels, hand 6 m, heads 7 m — the hand and heads keep their own triangle budgets so the fingers
and faces survive decimation), smoothed, weathered by fixed-seed noise, decimated into three LODs and painted
per vertex: grey-green stone with mottled blotches, dark fold valleys and creases, pale worn edges, vertical
rain streaks, yellow-grey lichen on upward faces, dark moss and a wet foot low down; the pedestal is broken
at its edges (planar chips) and eroded.

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
LEFT_WRIST = (-0.86, 5.08, -0.17)
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

VOXEL_BODY = 0.012
VOXEL_HAND = 0.006
VOXEL_HEAD = 0.007
VOXEL_PED = 0.025
# triangles per LOD of each piece (+ the boulders ≈ 1.1k at lod0 only)
BODY_TRIS = (24000, 5800, 1130)
HAND_TRIS = (2500, 500, 90)
HEAD_TRIS = (4300, 950, 200)
PED_TRIS = 1100
STONE = 0x7C847E
PLINTH = 0x76736A
LICHEN = 0x8E8C63
MOSS = 0x4C5638


def K(x, y, z):
    """figure frame (y above the pedestal top) -> Blender"""
    return (x, -z, y + PED_TOP)


def KB(x, y, z):
    """king frame (y above the waterline) -> Blender"""
    return (x, -z, y)


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def clamp01(x):
    return min(1.0, max(0.0, x))


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


def mid(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


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


# ------------------------------------------------------------------ body parts
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
    """the cloak falling from under the mantle on the raised arm's side to the pedestal (outer side), in deep
    flutes — it hangs from the shoulder, not from the raised elbow (no sail between the arm and the robe)"""
    table = [
        (0.02, -0.64, 0.25, 0.27),
        (1.0, -0.63, 0.23, 0.24),
        (2.2, -0.61, 0.19, 0.2),
        (2.85, -0.6, 0.15, 0.16),
        (3.2, -0.62, 0.12, 0.13),
        (3.4, -0.63, 0.09, 0.1),
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
        amp = 0.05 + 0.1 * (1 - t)
        return 1 + amp * (0.55 * math.cos(7 * a + ph[0]) + 0.3 * math.cos(11 * a + ph[1]) + 0.15 * math.cos(17 * a + ph[2]))

    m = lib.sweep(path, radius, seg=96, section=sect)
    # round the top into the underside of the sleeve
    m.add(lib.ellipsoid(K(-0.63, top, 0.02), (0.1, 0.11, 0.09), seg=24, rings=12))
    return m


def mantle():
    """a mantle over the shoulders from the collar to a hem across the upper chest and arms: hides the
    shoulder balls and gives the torso a garment line (an elliptic solid; its underside is the hem)"""
    prof = [(0.001, 3.14), (0.78, 3.14), (0.81, 3.2), (0.81, 3.34), (0.75, 3.52), (0.6, 3.64), (0.4, 3.74), (0.2, 3.8), (0.001, 3.81)]
    m = lib.lathe([(r, y + PED_TOP) for r, y in prof], seg=64, sx=1.0, sy=0.47)
    return m.transform(Matrix.Translation(Vector((0.0, -0.03, 0.0))))


def left_arm():
    """the raised left upper arm in a loose sleeve slid back to the elbow, with a rolled cuff (the bare
    forearm and the hand are their own finer piece)"""
    sh = (-SHOULDER_X, SHOULDER_Y, 0.0)
    el = LEFT_ELBOW
    nodes = [
        (*K(*sh), 0.155),
        (*K(*mid(sh, el, 0.5)), 0.135),
        (*K(*el), 0.105),
    ]
    arm = lib.skin('left_arm', nodes, [(0, 1), (1, 2)], subsurf=2)
    sleeve = lib.capsule(K(*sh), K(*mid(sh, el, 0.9)), 0.16, 0.14, seg=40, rings=12, caps=4)
    cuff = lib.capsule(K(*mid(sh, el, 0.82)), K(*mid(sh, el, 0.95)), 0.148, 0.142, seg=40, rings=4, caps=3)
    return arm, sleeve.add(cuff)


def right_arm():
    sh = (SHOULDER_X, SHOULDER_Y, 0.0)
    el = RIGHT_ELBOW
    fi = RIGHT_FIST
    nodes = [(*K(*sh), 0.2), (*K(*mid(sh, el, 0.5)), 0.175), (*K(*el), 0.15), (*K(*mid(el, fi, 0.5)), 0.125), (*K(*fi), 0.1)]
    arm = lib.skin('right_arm', nodes, [(0, 1), (1, 2), (2, 3), (3, 4)], subsurf=2)
    fist = lib.ellipsoid(K(*fi), (0.13, 0.12, 0.12), seg=20, rings=12)
    return arm, fist


def axe():
    fx, fz = RIGHT_FIST[0], RIGHT_FIST[2] - 0.02
    m = lib.capsule(K(fx, AXE_BOTTOM, fz), K(fx, AXE_TOP, fz), AXE_R, AXE_R * 0.85, seg=14, rings=12)
    m.add(lib.capsule(K(fx, AXE_TOP, fz), K(fx, AXE_TOP + 0.17, fz), 0.05, 0.012, seg=10, rings=3))
    blade = [(0.0, 3.34), (0.14, 3.3), (0.3, 3.2), (0.365, 3.42), (0.375, 3.62), (0.32, 3.84), (0.15, 3.77), (0.0, 3.72), (-0.13, 3.56), (-0.02, 3.52)]
    o = Vector(K(fx, 0.0, fz))
    m.add(lib.slab([(a, b) for a, b in blade], 0.055, (o, (1, 0, 0), (0, 0, 1))))
    return m


def neck_collar():
    """neck, the cloak's collar and the shoulders (the heads sit on the neck)"""
    m = lib.capsule(K(0, 3.55, 0.0), K(0, 3.95, -0.02), 0.155, 0.135, seg=24, rings=6)
    m.add(lib.lathe([(0.001, 0.0), (0.3, 0.0), (0.27, 0.1), (0.17, 0.15), (0.001, 0.15)], seg=48).transform(Matrix.Translation(Vector(K(0, 3.6, 0.02)))))
    for sx in (-1, 1):
        m.add(lib.ellipsoid(K(sx * SHOULDER_X, SHOULDER_Y - 0.02, 0.0), (0.24, 0.22, 0.2), seg=24, rings=14))
    return m


# ------------------------------------------------------------------ the open left hand
def hand_frame():
    """wrist point o, finger direction v (the forearm bent back 11° at the wrist), palm normal n (facing
    forward = upstream, a little up), u across the palm towards the thumb (the body's midline, +x)"""
    el = Vector(K(*LEFT_ELBOW))
    wr = Vector(K(*LEFT_WRIST))
    f = (wr - el).normalized()
    v = (Matrix.Rotation(0.2, 3, 'X') @ f).normalized()
    fwd = Vector((0, 1, 0))
    n = (fwd - v * v.dot(fwd)).normalized()
    u = n.cross(v).normalized()
    if u.x < 0:
        u = -u
    return wr, f, u, v, n


def hand():
    """the bare forearm from inside the sleeve's cuff, flattening into the wrist; palm, four fingers
    (slightly fanned, straight — the gesture of warning), the thumb standing off towards the midline, the
    thenar pad; one voxel pass so the wrist flows into the palm and the fingers stay apart"""
    o, f, u, v, n = hand_frame()
    P = lambda a, b, c=0.0: o + u * a + v * b + n * c  # noqa: E731
    rot = Matrix((u, n, v)).transposed()
    m = lib.Mesh()
    el = Vector(K(*LEFT_ELBOW))
    # forearm sweep: elbow (round) → mid (muscle) → wrist (flat front-to-back) → into the palm's heel;
    # sweep frame: the first radius lies along ≈ the palm normal (forward), the second across
    path = [el.lerp(o, k / 16) for k in range(17)] + [o + v * (0.02 * k) for k in range(1, 4)]
    table = [(0.0, 0.106, 0.106), (0.3, 0.094, 0.09), (0.62, 0.076, 0.07), (0.84, 0.056, 0.066), (0.9, 0.046, 0.068), (1.0, 0.038, 0.078)]

    def radius(t):
        for (t0, a0, b0), (t1, a1, b1) in zip(table, table[1:]):
            if t <= t1:
                q = (t - t0) / (t1 - t0)
                return (a0 + (a1 - a0) * q, b0 + (b1 - b0) * q)
        return table[-1][1:]

    m.add(lib.sweep([tuple(q) for q in path], radius, seg=28))
    # palm: a thick rounded plate, wider at the knuckles
    palm = [(-0.075, 0.0), (0.0, -0.012), (0.075, 0.0), (0.098, 0.1), (0.104, 0.2), (0.085, 0.232), (0.0, 0.24), (-0.085, 0.232), (-0.1, 0.2), (-0.092, 0.1)]
    m.add(lib.slab(palm, 0.06, (P(0.0, 0.01), u, v)))
    m.add(lib.ellipsoid(tuple(P(0.0, 0.12, 0.0)), (0.098, 0.034, 0.115), seg=24, rings=12, rot=rot))
    # thenar pad at the base of the thumb, the palm's heel
    m.add(lib.ellipsoid(tuple(P(0.05, 0.07, 0.012)), (0.048, 0.034, 0.075), seg=16, rings=10, rot=rot))
    # fingers: little (lateral, -u) … index (towards the thumb, +u); base, length, fan angle, radius — held
    # together, straight and flat (the film's "halt" palm, not a wave)
    fingers = [(-0.066, 0.16, -0.035, 0.021), (-0.022, 0.195, -0.012, 0.022), (0.022, 0.205, 0.008, 0.022), (0.066, 0.185, 0.028, 0.021)]
    for a, ln, ang, r in fingers:
        d = (v * math.cos(ang) + u * math.sin(ang)).normalized()
        base = P(a, 0.215)
        k1 = base + d * (ln * 0.55)
        tip = base + d * ln - n * 0.006
        m.add(lib.capsule(tuple(base), tuple(k1), r, r * 0.92, seg=12, rings=4))
        m.add(lib.capsule(tuple(k1), tuple(tip), r * 0.9, r * 0.78, seg=12, rings=4))
    # thumb: out towards the midline and up, two joints
    t0 = P(0.075, 0.06, 0.01)
    dt = (u * 0.72 + v * 0.66 + n * 0.12).normalized()
    t1 = t0 + dt * 0.085
    dt2 = (u * 0.45 + v * 0.88 + n * 0.08).normalized()
    t2 = t1 + dt2 * 0.085
    m.add(lib.capsule(tuple(t0), tuple(t1), 0.034, 0.028, seg=14, rings=4))
    m.add(lib.capsule(tuple(t1), tuple(t2), 0.027, 0.021, seg=14, rings=4))
    return m


# ------------------------------------------------------------------ heads
def face_common(m):
    m.add(lib.ellipsoid(K(0, HEAD_Y, -0.02), (0.19, 0.2, 0.245), seg=40, rings=24))


# the crowned king's tall helm-crown (radius, height above y = 4.1): a narrow ogival cone ≈ 1.6× the head's
# height (the head spans 3.92–4.32), the Gondorian helm of the film's bearded king — never a spiked ring
CROWN_HELM = [(0.001, -0.02), (0.232, -0.02), (0.236, 0.03), (0.226, 0.1), (0.206, 0.2), (0.18, 0.3), (0.149, 0.4),
              (0.114, 0.49), (0.077, 0.56), (0.04, 0.607), (0.015, 0.63), (0.001, 0.64)]


def crown_helm_r(h):
    for (r0, h0), (r1, h1) in zip(CROWN_HELM, CROWN_HELM[1:]):
        if h <= h1:
            return r0 + (r1 - r0) * (h - h0) / max(1e-9, h1 - h0)
    return 0.0


def head_crown(rnd):
    """the bearded king under a crowned helm: brow, deep-set eyes, nose, cheekbones, moustache, a long beard
    over the chest parted into three twisted locks; a tall, narrow ogival helm with vertical flutes, a low
    diadem band at the brow with short upright crenels (the front one a little taller), small wings swept
    back along its sides and a knob at the point"""
    m = lib.Mesh()
    face_common(m)
    m.add(lib.ellipsoid(K(0, 4.18, -0.175), (0.16, 0.05, 0.042), seg=24, rings=10))  # brow
    m.add(lib.capsule(K(0, 4.16, -0.2), K(0, 4.02, -0.262), 0.036, 0.052, seg=12, rings=4))  # nose
    for sx in (-1, 1):  # cheekbones, the lower lids
        m.add(lib.ellipsoid(K(sx * 0.1, 4.07, -0.15), (0.07, 0.06, 0.05), seg=16, rings=8))
        m.add(lib.capsule(K(sx * 0.045, 4.095, -0.2), K(sx * 0.11, 4.1, -0.175), 0.014, 0.012, seg=10, rings=3))
    for sx in (-1, 1):  # moustache sweeping into the beard
        m.add(lib.capsule(K(sx * 0.03, 4.0, -0.215), K(sx * 0.12, 3.9, -0.19), 0.03, 0.02, seg=12, rings=4))
    # the beard: a rounded, fluted mass from the chin to mid-chest (as wide as it is deep, not a slab), then
    # parting into three twisted locks, the middle one longest
    chin = Vector(K(0, 3.98, -0.13))
    mid_b = Vector(K(0, 3.6, -0.3))
    path = [tuple(chin.lerp(mid_b, k / 20) + Vector((0, 0.025 * math.sin(math.pi * k / 20), 0))) for k in range(21)]
    ph = rnd.random() * 6.28
    m.add(lib.sweep(path, lambda t: (0.125 - 0.02 * t, 0.1 - 0.02 * t), seg=48,
                    section=lambda a, t: 1 + 0.2 * math.cos(11 * a + ph + 2.0 * t) * (0.4 + 0.6 * t)))
    for j, (dx, ln, r0) in enumerate(((-0.065, 0.24, 0.05), (0.0, 0.33, 0.058), (0.065, 0.22, 0.048))):
        p0 = Vector(K(dx * 0.6, 3.68, -0.29))
        p1 = Vector(K(dx * 1.5, 3.6 - ln, -0.34 - 0.03 * (1 - abs(dx) / 0.065)))
        pts = []
        for k in range(15):
            t = k / 14
            q = p0.lerp(p1, t) + Vector((0.014 * math.sin(5.0 * t + j * 2.1), 0.012 * math.cos(5.0 * t + j), 0))
            pts.append(tuple(q))
        m.add(lib.sweep(pts, lambda t, r0=r0: (r0 * (1 - 0.75 * t) + 0.006, r0 * 0.85 * (1 - 0.75 * t) + 0.006), seg=16,
                        section=lambda a, t, j=j: 1 + 0.22 * math.cos(4 * a + 9 * t + j)))
    base = Matrix.Translation(Vector(K(0, 4.1, -0.02)))
    m.add(lib.lathe(CROWN_HELM, seg=48).transform(base))
    m.add(lib.ellipsoid(K(0, 4.1 + 0.638, -0.02), (0.022, 0.026, 0.022), seg=12, rings=8))  # knob at the point
    # vertical flutes up the helm: ribs laid on its surface from the diadem to near the point
    for i in range(12):
        a = 2 * math.pi * (i + 0.5) / 12 - math.pi / 2
        c, s = math.cos(a), math.sin(a)
        pts = []
        for k in range(9):
            h = 0.13 + 0.38 * k / 8
            r = crown_helm_r(h) + 0.004
            pts.append(K(c * r, 4.1 + h, -0.02 + s * r))
        m.add(lib.sweep(pts, lambda t: (0.013 * (1 - 0.6 * t), 0.013 * (1 - 0.6 * t)), seg=10))
    # the diadem: a low band at the brow with short upright crenels (≤ ¼ of the head's height, vertical)
    band = [(0.001, 0.0), (0.249, 0.0), (0.258, 0.03), (0.258, 0.1), (0.25, 0.125), (0.001, 0.125)]
    m.add(lib.lathe(band, seg=48).transform(base))
    for i in range(16):
        a = 2 * math.pi * i / 16 - math.pi / 2  # i = 0: front (-z)
        c, s = math.cos(a), math.sin(a)
        h = 0.085 if i == 0 else 0.05 + 0.012 * (i % 2)
        p0 = K(c * 0.246, 4.1 + 0.11, -0.02 + s * 0.246)
        p1 = K(c * 0.242, 4.1 + 0.11 + h, -0.02 + s * 0.242)
        m.add(lib.capsule(p0, p1, 0.024, 0.014, seg=10, rings=3, caps=2))
    # small wings swept back along the helm's sides (seen edge-on from the front: no horns in silhouette)
    wing = [(0.0, 0.0), (0.05, -0.012), (0.12, 0.01), (0.19, 0.07), (0.23, 0.15), (0.2, 0.14), (0.14, 0.1), (0.08, 0.075), (0.02, 0.06)]
    for sx in (-1, 1):
        o = Vector(K(sx * 0.252, 4.16, 0.02))
        back = Vector((sx * 0.14, -1.0, 0.0)).normalized()  # figure +z (behind) = Blender -y, a little outward
        m.add(lib.slab(wing, 0.018, (o, back, Vector((0, 0, 1)))))
    del rnd
    return m


def head_helm(rnd):
    """the king in a full helm: a tall dome with a raised brim and a low crest running front to back, a face
    guard over the whole face (brow band, nose guard, eye slits), an aventail flaring down to the collar"""
    m = lib.Mesh()
    face_common(m)
    base = Matrix.Translation(Vector(K(0, 4.1, -0.02)))
    dome = [(0.001, -0.02), (0.236, -0.02), (0.246, 0.05), (0.236, 0.16), (0.21, 0.27), (0.155, 0.36), (0.075, 0.425), (0.001, 0.44)]
    m.add(lib.lathe(dome, seg=48).transform(base))
    brim = [(0.001, -0.01), (0.262, -0.01), (0.268, 0.045), (0.001, 0.045)]
    m.add(lib.lathe(brim, seg=48).transform(base))
    # face guard: a mask over the whole face down to the chin, the brow band across it, a nose guard
    m.add(lib.ellipsoid(K(0, 3.97, -0.19), (0.175, 0.075, 0.17), seg=32, rings=16))
    m.add(lib.capsule(K(-0.16, 4.12, -0.215), K(0.16, 4.12, -0.215), 0.032, 0.032, seg=12, rings=8))
    m.add(lib.capsule(K(0, 4.15, -0.25), K(0, 3.9, -0.27), 0.024, 0.02, seg=12, rings=6))
    # the aventail: flaring from the helm's rim down over the neck to the collar, set back so the mask
    # stands proud of it in front
    avent = [(0.001, 3.62), (0.31, 3.62), (0.285, 3.72), (0.25, 3.85), (0.235, 3.99), (0.001, 3.99)]
    m.add(lib.lathe(avent, seg=48).transform(Matrix.Translation(Vector(K(0, 0.0, 0.05)))))
    # crest: a thin fin standing on the dome from above the brow over the top to the back — a chain of
    # flattened ellipsoids on the dome's median profile (the voxel pass fuses them into one blade)
    def dome_r(h):
        for (r0, h0), (r1, h1) in zip(dome, dome[1:]):
            if h <= h1:
                return r0 + (r1 - r0) * (h - h0) / max(1e-9, h1 - h0)
        return 0.0

    cy = 0.12  # rays from a point inside the dome, 0.12 above its base
    for k in range(27):
        th = math.radians(-62 + 142 * k / 26)  # 0 = straight up, − = front (−z), + = back
        dy, dz = math.cos(th), math.sin(th)
        t = 0.0
        while t < 0.6:
            h = cy + dy * t
            if h > 0.44 or abs(dz * t) > dome_r(h):
                break
            t += 0.004
        hgt = 0.045 + 0.025 * math.sin(math.pi * k / 26)
        c = K(0, 4.1 + cy + dy * (t + 0.01), -0.02 + dz * (t + 0.01))
        rot = Matrix.Rotation(th, 3, 'X')  # the ellipsoid's radial axis along the ray (Blender: −z_fig = +y)
        m.add(lib.ellipsoid(c, (0.024, hgt * 0.7, hgt), seg=12, rings=8, rot=rot))
    del rnd
    return m


# ------------------------------------------------------------------ pedestal
def pedestal_outline(scale=1.0):
    pw, pd, ch = PED_W / 2 * scale, PED_D / 2 * scale, 0.22 * scale
    block = [(-pw + ch, -pd), (pw - ch, -pd), (pw, -pd + ch), (pw, pd - ch), (pw - ch, pd), (-pw + ch, pd), (-pw, pd - ch), (-pw, -pd + ch)]
    return [(x, -z) for x, z in block]


def pedestal_block():
    bl = pedestal_outline()
    m = lib.prism(bl, PED_FOOT, PED_TOP - 0.16, taper=0.1)
    m.add(lib.prism([(x * 0.86, y * 0.86) for x, y in bl], PED_TOP - 0.17, PED_TOP, taper=0.05))
    return m


def chips(rnd):
    """planar breaks of the pedestal: bevel-like chips along the block's top edge and the moulding's rim
    (point, outward normal, depth, radius — a spherical region), and long broken corners down the chamfer
    edges (point, horizontal normal, depth, half length — a vertical band)"""
    pw, pd, ch = PED_W / 2, PED_D / 2, 0.22
    top = []
    for i in range(16):
        a = 2 * math.pi * (i + rnd.random() * 0.8) / 16
        c, s = math.cos(a), math.sin(a)
        z = PED_TOP - 0.16 - rnd.random() * 0.06
        p = Vector((c * pw * 0.9, s * pd * 0.9, z))
        nrm = (Vector((c / pw, s / pd, 0)).normalized() + Vector((0, 0, 0.8 + 0.4 * rnd.random()))).normalized()
        top.append((p, nrm, 0.03 + 0.05 * rnd.random(), 0.2 + 0.2 * rnd.random()))
    for i in range(8):
        a = 2 * math.pi * (i + 0.3 + rnd.random() * 0.6) / 8
        c, s = math.cos(a), math.sin(a)
        p = Vector((c * pw * 0.86 * 0.97, s * pd * 0.86 * 0.97, PED_TOP - 0.01))
        nrm = (Vector((c / pw, s / pd, 0)).normalized() + Vector((0, 0, 1.0))).normalized()
        top.append((p, nrm, 0.02 + 0.03 * rnd.random(), 0.12 + 0.1 * rnd.random()))
    corners = []
    outline = pedestal_outline()
    for k in range(len(outline)):
        if rnd.random() < 0.35:
            continue
        x, y = outline[k]
        zc = 0.2 + rnd.random() * 1.0
        corners.append((Vector((x * 0.95, y * 0.95, zc)), Vector((x, y, 0)).normalized(), 0.04 + 0.05 * rnd.random(), 0.25 + 0.35 * rnd.random()))
    del ch
    return top, corners


def pedestal(lod, rocks, rnd):
    """lod0: the block and moulded step fused by a voxel pass, broken at its edges by planar chips (flat-shaded
    facets) and lightly eroded, with boulders at the waterline; lod1/2: the plain block"""
    if lod > 0:
        return pedestal_block().obj(f'pedestal{lod}', smooth=False)
    ob = pedestal_block().obj('ped0', smooth=False)
    lib.voxel_remesh(ob, VOXEL_PED)
    top, corners = chips(rnd)
    me = ob.data
    for v in me.vertices:
        p = v.co.copy()
        for c, cn, dd, r in top:
            dist = (p - c).length
            if dist >= r:
                continue
            s = (p - c).dot(cn) + dd
            if s > 0:
                p -= cn * (s * (1 - smoothstep(0.6 * r, r, dist)))
        for c, cn, dd, hl in corners:
            dz = abs(p.z - c.z)
            if dz >= hl:
                continue
            s = (p - c).dot(cn) + dd
            if s > 0:
                p -= cn * (s * (1 - smoothstep(0.6 * hl, hl, dz)))
        v.co = p
    me.update()
    lib.displace(ob, lambda co, n: 0.004 * lib.fbm(co * 6.0 + Vector((3.3, 1.1, 0.4)), 2))
    dec = lib.decimate(ob, 'ped0d', PED_TRIS)
    remove(ob)
    lib.set_smooth(dec, False)
    parts = [dec]
    pw, pd = PED_W / 2, PED_D / 2
    for i, (a, r) in enumerate(rocks):
        c = KB(math.cos(a) * (pw + 0.05), 0.02, math.sin(a) * (pd + 0.05))
        rk = lib.ellipsoid(c, (r * 1.1, r, r * 0.7), seg=12, rings=7).obj(f'rock{i}')
        off = Vector((i * 3.1, i * 1.7, 0.0))
        lib.displace(rk, lambda co, n, off=off, r=r: 0.22 * r * lib.fbm(co * 5.0 + off, 2))
        parts.append(rk)
    return lib.join('pedestal0', parts)


# ------------------------------------------------------------------ surface
EYES = [Vector(K(sx * 0.075, 4.125, -0.2)) for sx in (-1, 1)]
SLITS = [Vector(K(sx * 0.072, 4.075, -0.255)) for sx in (-1, 1)]


def weathering_body(co, n):
    """low-frequency carving irregularity and erosion that survives ≈ 45 m triangles; the finer weathering
    lives in the vertex paint"""
    return 0.006 * lib.fbm(co * 3.0, 2) + 0.004 * lib.fbm(co * 9.0 + Vector((1.7, 4.2, 0.3)), 2)


def weathering_crown(co, n):
    d = 0.003 * lib.fbm(co * 6.0, 2)
    for e in EYES:
        q = (co - e).length
        if q < 0.11:
            d -= 0.034 * math.exp(-(q / 0.045) ** 2)
    return d


def weathering_helm(co, n):
    d = 0.003 * lib.fbm(co * 6.0, 2)
    for e in SLITS:
        q = co - e
        # a horizontal slit: 0.11 wide, 0.03 high (Blender x across, z up), only on front-facing skin
        r2 = (q.x / 0.058) ** 2 + (q.z / 0.017) ** 2 + (q.y / 0.08) ** 2
        if r2 < 1 and n.y > 0.2:
            d -= 0.03 * (1 - r2)
    return d


STONE_L = lib.srgb_to_linear(STONE)
PLINTH_L = lib.srgb_to_linear(PLINTH)
LICHEN_L = lib.srgb_to_linear(LICHEN)
MOSS_L = lib.srgb_to_linear(MOSS)


def mix3(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


def paint(co, n, cav, cavb, dark=0.0):
    """linear paint: statue stone / plinth, mottled; dark creases and fold valleys, pale worn ridges, rain
    streaks down the sides, a wet foot; lichen on upward faces, moss low down. `dark` darkens (eye slits)."""
    ped = 1 - smoothstep(PED_TOP - 0.03, PED_TOP + 0.005, co.z)
    base = mix3(STONE_L, PLINTH_L, ped)
    k = 1 + 0.2 * lib.fbm(co * 1.7 + Vector((4.1, 1.3, 2.7)), 2)
    k *= 1 - 0.4 * clamp01(cav * 1.8) - 0.45 * clamp01(cavb * 3.2)
    k *= 1 + 0.2 * clamp01(-cav * 1.8) + 0.1 * clamp01(-cavb * 3.2)
    side = 1 - abs(n.z)
    # rain streaks: vertical, but in irregular patches and of varying pitch (not a regular wood grain)
    st = lib.fbm(Vector((co.x * 21.0, co.y * 21.0, co.z * 0.9)) + Vector((2.2, 5.1, 0.0)), 2)
    st2 = lib.fbm(Vector((co.x * 47.0, co.y * 47.0, co.z * 1.6)) + Vector((8.4, 0.7, 3.0)), 2)
    patch = smoothstep(-0.05, 0.35, lib.fbm(co * 2.2 + Vector((0.4, 6.2, 1.9)), 2))
    k *= 1 - (0.42 * smoothstep(0.0, 0.3, st) * patch + 0.2 * smoothstep(0.05, 0.3, st2) * (1 - patch)) * (0.35 + 0.65 * side)
    k *= 0.66 + 0.34 * smoothstep(0.0, 0.55, co.z)  # wet foot at the waterline
    k *= 0.96 + 0.1 * max(0.0, n.z)  # sun-bleached tops
    k *= 1 - dark
    col = [c * k for c in base]
    li = lib.fbm(co * 6.0 + Vector((11.0, 3.0, 5.0)), 2)
    w = 0.7 * smoothstep(0.08, 0.6, n.z) * smoothstep(-0.1, 0.25, li)
    col = mix3(col, [c * (0.8 + 0.2 * k) for c in LICHEN_L], w)
    mo = lib.fbm(co * 4.0 + Vector((7.0, 2.0, 9.0)), 2)
    wm = 0.6 * (1 - smoothstep(0.3, 2.4, co.z)) * smoothstep(-0.1, 0.3, mo + 2.0 * max(0.0, cavb))
    col = mix3(col, [c * k for c in MOSS_L], wm)
    return tuple(col)


def paint_crown(co, n, cav, cavb):
    dark = 0.0
    for e in EYES:
        dark = max(dark, 0.45 * math.exp(-((co - e).length / 0.05) ** 2))
    return paint(co, n, cav, cavb, dark)


def paint_helm(co, n, cav, cavb):
    dark = 0.0
    for e in SLITS:
        q = co - e
        r2 = (q.x / 0.065) ** 2 + (q.z / 0.024) ** 2 + (q.y / 0.09) ** 2
        dark = max(dark, 0.6 * max(0.0, 1 - r2))
    return paint(co, n, cav, cavb, dark)


def finish(ob, fn):
    tri = ob.modifiers.new('tri', 'TRIANGULATE')
    tri.quad_method = 'FIXED'
    lib.apply_modifiers(ob)
    lib.paint(ob, fn, broad=3)
    lib.assign(ob, 'weathered')
    return ob


def fused(name, parts, voxel, smooth_iter=3):
    ob = lib.join(name, parts)
    lib.log(f'{name}: joined {lib.tri_count(ob)} tris; voxel remesh {voxel} km')
    lib.voxel_remesh(ob, voxel)
    lib.log(f'{name}: remeshed {lib.tri_count(ob)} tris')
    lib.smooth(ob, 0.5, smooth_iter)
    return ob


def remove(ob):
    import bpy
    me = ob.data
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)


def main():
    out = lib.out_path()
    lib.reset(SEED)
    rnd = random.Random(SEED)
    lib.log('body')
    la, sleeve = left_arm()
    ra, fist = right_arm()
    body = fused('body', [
        robe(rnd).obj('robe'),
        front_edges().obj('edges'),
        belt().obj('belt'),
        drape(rnd).obj('drape'),
        axe().obj('axe'),
        neck_collar().obj('neck'),
        mantle().obj('mantle'),
        la, sleeve.obj('sleeve'), ra, fist.obj('fist'),
    ], VOXEL_BODY)
    lib.displace(body, weathering_body)
    hnd = fused('hand', [hand().obj('hand_parts')], VOXEL_HAND, smooth_iter=2)
    rocks = [(2 * math.pi * i / 7 + 0.4 + rnd.random() * 0.5, 0.18 + 0.16 * rnd.random()) for i in range(7)]
    rnd_ped = random.Random(SEED + 7)
    lods = []
    for i in range(3):
        b = lib.decimate(body, f'body{i}', BODY_TRIS[i])
        h = lib.decimate(hnd, f'hand{i}', HAND_TRIS[i])
        ob = lib.join(f'lod{i}', [b, h, pedestal(i, rocks, rnd_ped)])
        finish(ob, paint)
        lods.append(ob)
        lib.log(f'lod{i}: {lib.tri_count(ob)} tris, {len(ob.data.vertices)} vertices')
    remove(body)
    remove(hnd)
    variants = {}
    for name, gen, wfn, pfn in (('crown', head_crown, weathering_crown, paint_crown), ('helm', head_helm, weathering_helm, paint_helm)):
        hd = fused(name, [gen(random.Random(SEED + len(name))).obj(f'{name}_parts')], VOXEL_HEAD, smooth_iter=2)
        lib.displace(hd, wfn)
        obs = []
        for i in range(3):
            ob = lib.decimate(hd, f'{name}_lod{i}', HEAD_TRIS[i])
            finish(ob, pfn)
            obs.append(ob)
            lib.log(f'{name}_lod{i}: {lib.tri_count(ob)} tris, {len(ob.data.vertices)} vertices')
        remove(hd)
        variants[name] = obs
    lib.export_glb(out, lods + [o for obs in variants.values() for o in obs])
    lib.report(lods, variants)


main()
