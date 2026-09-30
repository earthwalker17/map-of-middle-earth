"""Shared helpers for the Blender GLB landmark builds (S3; tools/blender/<id>.py, run by tools/blender/run.ts).

Conventions every build follows:
- headless: `blender -b --factory-startup -noaudio --python-exit-code 1 --python <script> -- --out <glb>`
- units: 1 Blender unit = 1 km. Blender is Z-up; a model FACES +Y, which the glTF export (+Y up) turns into
  -Z — the landmark's heading (src/landmarks/types.ts local frame: x east, y up, -z = heading).
- determinism: fixed seeds only (`reset(seed)` seeds `random` and `mathutils.noise`); no time, no hash()
  of strings, no dict-order dependence; every generator is plain Python over lists.
- output: three nodes `lod0`, `lod1`, `lod2` (one mesh each, triangles ≤ the script's budget), materials
  named `fam:<FamilyId>` (src/materials/families.ts — the runtime maps the name to a family and never uses
  the GLB material), paint in the point-domain colour attribute `Color` (-> COLOR_0, linear RGB; the
  runtime packs it as the absolute family paint), smooth normals. NO UVs, textures, animations, extras,
  Draco (`export_glb`).
- the last line a script prints is `MOME_STATS {json}` (`report`): tris per LOD, bounds (km), Blender
  version, peak working set (MB), build time (ms, diagnostics).
"""
import json
import math
import random
import sys
import time

import bpy
import mathutils
from mathutils import Matrix, Vector
from mathutils import noise as mnoise

T0 = time.perf_counter()  # diagnostics only (reported, never shapes geometry)


# ------------------------------------------------------------------ run / scene
def out_path():
    """The `--out <glb>` argument after Blender's `--`."""
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if '--out' not in argv:
        raise SystemExit('missing -- --out <file.glb>')
    return argv[argv.index('--out') + 1]


def reset(seed):
    """Empty factory scene, metric units with 1 BU = 1 km, fixed seeds."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    us = bpy.context.scene.unit_settings
    us.system = 'METRIC'
    us.scale_length = 1000.0
    us.length_unit = 'KILOMETERS'
    random.seed(seed)
    mnoise.seed_set(seed)


def log(msg):
    print(f'[blender] {msg}', flush=True)


def material(fam):
    """The shared-family placeholder material `fam:<FamilyId>` (only its NAME reaches the runtime)."""
    name = f'fam:{fam}'
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = False
    return m


# ------------------------------------------------------------------ mesh data (plain lists)
class Mesh:
    """Plain-Python mesh: vertices (x, y, z) and polygons (index tuples). Generators return these; `obj()`
    turns one into a Blender object."""

    def __init__(self, verts=None, faces=None):
        self.v = verts or []
        self.f = faces or []

    def add(self, other):
        o = len(self.v)
        self.v.extend(other.v)
        self.f.extend(tuple(i + o for i in f) for f in other.f)
        return self

    def transform(self, m):
        self.v = [tuple(m @ Vector(p)) for p in self.v]
        return self

    def obj(self, name, smooth=True):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(p) for p in self.v], [], [tuple(f) for f in self.f])
        me.validate(clean_customdata=False)
        me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        set_smooth(ob, smooth)
        return ob


def set_smooth(ob, smooth=True):
    polys = ob.data.polygons
    polys.foreach_set('use_smooth', [smooth] * len(polys))
    ob.data.update()


def grid_surface(rings, closed_u=True, cap_bottom=True, cap_top=True):
    """Quad surface through rings of equal length (bottom → top); caps close the ends with a centre fan."""
    m = Mesh()
    n = len(rings[0])
    for r in rings:
        m.v.extend(r)
    cols = n if closed_u else n - 1
    for k in range(len(rings) - 1):
        a = k * n
        b = (k + 1) * n
        for j in range(cols):
            j1 = (j + 1) % n
            m.f.append((a + j, a + j1, b + j1, b + j))
    for cap, ring_i, up in ((cap_bottom, 0, False), (cap_top, len(rings) - 1, True)):
        if not cap:
            continue
        r = rings[ring_i]
        c = tuple(sum(p[i] for p in r) / n for i in range(3))
        ci = len(m.v)
        m.v.append(c)
        base = ring_i * n
        for j in range(n):
            j1 = (j + 1) % n
            m.f.append((base + j, base + j1, ci) if up else (base + j1, base + j, ci))
    return m


def lathe(profile, seg=48, sx=1.0, sy=1.0, arc=None):
    """Surface of revolution about Z from [(r, z)] (bottom → top), elliptic scale sx / sy; r = 0 closes."""
    rings = []
    for r, z in profile:
        ring = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            ring.append((max(r, 1e-5) * math.cos(a) * sx, max(r, 1e-5) * math.sin(a) * sy, z))
        rings.append(ring)
    return grid_surface(rings, cap_bottom=profile[0][0] > 1e-5, cap_top=profile[-1][0] > 1e-5)


def ellipsoid(c, radii, seg=24, rings=16, rot=None):
    """UV ellipsoid centred at c with radii (rx, ry, rz), optional rotation matrix."""
    prof = []
    for k in range(rings + 1):
        t = -math.pi / 2 + math.pi * k / rings
        prof.append((math.cos(t), math.sin(t)))
    rr = []
    for cr, sz in prof:
        ring = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            ring.append((max(cr, 1e-4) * math.cos(a) * radii[0], max(cr, 1e-4) * math.sin(a) * radii[1], sz * radii[2]))
        rr.append(ring)
    m = grid_surface(rr)  # the pole rings are tiny: fan caps keep the surface closed
    mat = Matrix.Translation(Vector(c)) @ (rot.to_4x4() if rot is not None else Matrix.Identity(4))
    return m.transform(mat)


def _frame(d):
    d = Vector(d).normalized()
    ref = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized()
    w = d.cross(u).normalized()
    return u, w


def capsule(p0, p1, r0, r1, seg=16, rings=8, caps=3):
    """Tapered tube p0 → p1 (radii r0 → r1) with hemispherical end caps (`caps` rings each)."""
    p0 = Vector(p0)
    p1 = Vector(p1)
    d = (p1 - p0).normalized()
    u, w = _frame(d)
    pts = []  # (centre, radius, axial offset along d)
    for k in range(caps, 0, -1):
        t = (math.pi / 2) * k / (caps + 0.0)
        pts.append((p0 - d * (r0 * math.sin(t)), r0 * math.cos(t)))
    for k in range(rings + 1):
        t = k / rings
        pts.append((p0.lerp(p1, t), r0 + (r1 - r0) * t))
    for k in range(1, caps + 1):
        t = (math.pi / 2) * k / (caps + 0.0)
        pts.append((p1 + d * (r1 * math.sin(t)), r1 * math.cos(t)))
    rr = []
    for c, r in pts:
        ring = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            q = c + (u * math.cos(a) + w * math.sin(a)) * max(r, 1e-4)
            ring.append(tuple(q))
        rr.append(ring)
    return grid_surface(rr, cap_bottom=True, cap_top=True)


def sweep(path, radius_fn, seg=16, section=None):
    """Tube along a polyline path; radius_fn(t) → (ra, rb) semi-axes along the frame (u, w); `section(a, t)`
    optionally multiplies the radius per angle (folds). Ends capped."""
    n = len(path)
    rr = []
    for k in range(n):
        p = Vector(path[k])
        d = (Vector(path[min(k + 1, n - 1)]) - Vector(path[max(k - 1, 0)])).normalized()
        u, w = _frame(d)
        t = k / (n - 1)
        ra, rb = radius_fn(t)
        ring = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            s = section(a, t) if section else 1.0
            ring.append(tuple(p + (u * math.cos(a) * ra + w * math.sin(a) * rb) * s))
        rr.append(ring)
    return grid_surface(rr)


def area2(poly):
    """signed area of a 2D polygon (> 0: counter-clockwise)"""
    return 0.5 * sum(poly[k][0] * poly[(k + 1) % len(poly)][1] - poly[(k + 1) % len(poly)][0] * poly[k][1] for k in range(len(poly)))


def prism(outline, z0, z1, taper=0.0):
    """Vertical prism over an (x, y) outline (convex or star-shaped about its centroid) from z0 to z1; faces
    wound outwards whatever the outline's orientation."""
    if area2(outline) < 0:
        outline = list(reversed(outline))
    n = len(outline)
    cx = sum(p[0] for p in outline) / n
    cy = sum(p[1] for p in outline) / n
    s = 1 - taper
    bot = [(x, y, z0) for x, y in outline]
    top = [(cx + (x - cx) * s, cy + (y - cy) * s, z1) for x, y in outline]
    return grid_surface([bot, top])


def slab(outline_xz, thickness, frame):
    """A flat plate: an outline in its own (u, v) plane extruded ±thickness/2 along the normal; `frame` =
    (origin, u axis, v axis) — for blades and palms. Fan-triangulated about the centroid (star-shaped)."""
    o, u, v = (Vector(a) for a in frame)
    nrm = u.cross(v).normalized()
    if area2(outline_xz) < 0:
        outline_xz = list(reversed(outline_xz))
    n = len(outline_xz)
    cu = sum(p[0] for p in outline_xz) / n
    cv = sum(p[1] for p in outline_xz) / n
    rings = []
    for side in (-0.5, 0.5):
        rings.append([tuple(o + u * a + v * b + nrm * (thickness * side)) for a, b in outline_xz])
    m = grid_surface(rings, cap_bottom=False, cap_top=False)
    for ri, up in ((0, False), (1, True)):
        ci = len(m.v)
        m.v.append(tuple(o + u * cu + v * cv + nrm * (thickness * (-0.5 if ri == 0 else 0.5))))
        base = ri * n
        for j in range(n):
            j1 = (j + 1) % n
            m.f.append((base + j, base + j1, ci) if up else (base + j1, base + j, ci))
    return m


# ------------------------------------------------------------------ modifiers (applied immediately)
def apply_modifiers(ob):
    """Bake the modifier stack into the mesh (evaluated copy), keep the object."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)
    return ob


def skin(name, nodes, edges, subsurf=2):
    """Skin-modifier limb / figure from a stick skeleton: nodes [(x, y, z, r)], edges [(i, j)]; node 0 is
    the root; subdivided `subsurf` levels, applied."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([n[:3] for n in nodes], edges, [])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.modifiers.new('skin', 'SKIN')
    sv = me.skin_vertices[0].data
    for i, n in enumerate(nodes):
        sv[i].radius = (n[3], n[3])
        sv[i].use_root = i == 0
    ob.modifiers['skin'].use_smooth_shade = True
    if subsurf:
        s = ob.modifiers.new('subsurf', 'SUBSURF')
        s.levels = subsurf
        s.render_levels = subsurf
    return apply_modifiers(ob)


def join(name, parts):
    """Merge objects (their evaluated meshes in world space) into one new object, keeping each polygon's
    smooth / flat shading; the parts are deleted."""
    m = Mesh()
    flags = []
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in parts:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ob.matrix_world
        o = len(m.v)
        m.v.extend(tuple(mw @ v.co) for v in me.vertices)
        m.f.extend(tuple(i + o for i in p.vertices) for p in me.polygons)
        flags.extend(p.use_smooth for p in me.polygons)
        ev.to_mesh_clear()
    for ob in parts:
        me = ob.data
        bpy.data.objects.remove(ob)
        if me.users == 0:
            bpy.data.meshes.remove(me)
    ob = m.obj(name)
    if len(flags) == len(ob.data.polygons):
        ob.data.polygons.foreach_set('use_smooth', flags)
        ob.data.update()
    return ob


def voxel_remesh(ob, voxel):
    """Fuse every part into one watertight carved surface (OpenVDB voxel remesh, smooth shading)."""
    r = ob.modifiers.new('remesh', 'REMESH')
    r.mode = 'VOXEL'
    r.voxel_size = voxel
    r.adaptivity = 0.0
    r.use_smooth_shade = True
    return apply_modifiers(ob)


def smooth(ob, factor=0.5, iterations=4):
    s = ob.modifiers.new('smooth', 'SMOOTH')
    s.factor = factor
    s.iterations = iterations
    return apply_modifiers(ob)


def bevel(ob, width, segments=2, angle_deg=30):
    b = ob.modifiers.new('bevel', 'BEVEL')
    b.width = width
    b.segments = segments
    b.limit_method = 'ANGLE'
    b.angle_limit = math.radians(angle_deg)
    return apply_modifiers(ob)


def subdivide(ob, levels=1, simple=False):
    s = ob.modifiers.new('subsurf', 'SUBSURF')
    s.levels = levels
    s.render_levels = levels
    if simple:
        s.subdivision_type = 'SIMPLE'
    return apply_modifiers(ob)


def displace(ob, fn):
    """Move every vertex along its normal by fn(co, normal) km (fixed-seed noise inside fn)."""
    me = ob.data
    me.update()
    cos = [v.co.copy() for v in me.vertices]
    nrm = [v.normal.copy() for v in me.vertices]
    for i, v in enumerate(me.vertices):
        v.co = cos[i] + nrm[i] * fn(cos[i], nrm[i])
    me.update()
    return ob


def fbm(p, octaves=3, basis='PERLIN_ORIGINAL'):
    """Fixed-seed fractal noise in [-1, 1]-ish (mathutils.noise, seeded by `reset`)."""
    amp = 1.0
    tot = 0.0
    norm = 0.0
    q = Vector(p)
    for _ in range(octaves):
        tot += amp * mnoise.noise(q, noise_basis=basis)
        norm += amp
        amp *= 0.5
        q = q * 2.03
    return tot / norm


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def decimate(src, name, target_tris):
    """A decimated COPY of `src` (collapse) with about `target_tris` triangles, triangulated."""
    ob = src.copy()
    ob.data = src.data.copy()
    ob.name = name
    ob.data.name = name
    bpy.context.scene.collection.objects.link(ob)
    t = ob.modifiers.new('tri', 'TRIANGULATE')
    t.quad_method = 'FIXED'
    t.ngon_method = 'BEAUTY'
    apply_modifiers(ob)
    cur = tri_count(ob)
    if cur > target_tris:
        d = ob.modifiers.new('dec', 'DECIMATE')
        d.decimate_type = 'COLLAPSE'
        d.ratio = target_tris / cur
        d.use_collapse_triangulate = True
        apply_modifiers(ob)
    set_smooth(ob, True)
    return ob


def cavity(ob):
    """Per-vertex concavity in [-1, 1] (+ = crevice): mean offset of the neighbours along the normal,
    scaled by the mean edge length."""
    me = ob.data
    nb = [[] for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices
        nb[a].append(b)
        nb[b].append(a)
    out = []
    for i, v in enumerate(me.vertices):
        if not nb[i]:
            out.append(0.0)
            continue
        acc = 0.0
        el = 0.0
        for j in nb[i]:
            d = me.vertices[j].co - v.co
            acc += d.dot(v.normal)
            el += d.length
        el = el / len(nb[i]) or 1.0
        out.append(max(-1.0, min(1.0, (acc / len(nb[i])) / el * 2.0)))
    return out


def paint(ob, fn):
    """Point-domain linear colour attribute `Color` (the model's COLOR_0 paint): fn(co, normal, cavity) →
    linear (r, g, b)."""
    me = ob.data
    me.update()
    cav = cavity(ob)
    attr = me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    for i, v in enumerate(me.vertices):
        r, g, b = fn(v.co, v.normal, cav[i])
        attr.data[i].color = (r, g, b, 1.0)
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.find('Color')
    return ob


def srgb_to_linear(hexv):
    def ch(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (ch((hexv >> 16) & 255), ch((hexv >> 8) & 255), ch(hexv & 255))


def assign(ob, fam):
    ob.data.materials.clear()
    ob.data.materials.append(material(fam))
    return ob


# ------------------------------------------------------------------ export / report
def export_glb(path, objs):
    """GLB with fixed settings: selected objects only, modifiers applied, +Y up, normals, the active colour
    attribute as COLOR_0; no UVs / tangents / images / animations / skins / morphs / extras / Draco."""
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        check_existing=False,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=False,
        export_tangents=False,
        export_materials='EXPORT',
        export_image_format='NONE',
        export_vertex_color='ACTIVE',
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True,
        export_attributes=False,
        export_extras=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        export_draco_mesh_compression_enable=False,
        export_use_gltfpack=False,
        export_shared_accessors=False,
        export_gpu_instances=False,
        will_save_settings=False,
    )


def peak_mb():
    """Peak working set of this Blender process, MB (Windows; None elsewhere)."""
    try:
        import ctypes
        from ctypes import wintypes

        class PMC(ctypes.Structure):
            _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD), ('PeakWorkingSetSize', ctypes.c_size_t),
                        ('WorkingSetSize', ctypes.c_size_t), ('QuotaPeakPagedPoolUsage', ctypes.c_size_t),
                        ('QuotaPagedPoolUsage', ctypes.c_size_t), ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t),
                        ('QuotaNonPagedPoolUsage', ctypes.c_size_t), ('PagefileUsage', ctypes.c_size_t), ('PeakPagefileUsage', ctypes.c_size_t)]
        k32 = ctypes.WinDLL('kernel32')
        psapi = ctypes.WinDLL('psapi')
        k32.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PMC), wintypes.DWORD]
        pmc = PMC()
        pmc.cb = ctypes.sizeof(PMC)
        if not psapi.GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb):
            return None
        return round(pmc.PeakWorkingSetSize / 1048576)
    except Exception:  # noqa: BLE001 — diagnostics only
        return None


def report(lods):
    """Print MOME_STATS: tris per LOD, bounds of lod0 in the model frame (km, glTF axes: r about +Y, h = max
    height), Blender version, peak MB, time."""
    r = 0.0
    h = 0.0
    for v in lods[0].data.vertices:
        co = lods[0].matrix_world @ v.co
        r = max(r, math.hypot(co.x, co.y))
        h = max(h, co.z)
    stats = {
        'tris': [tri_count(o) for o in lods],
        'boundsKm': {'r': round(r, 3), 'h': round(h, 3)},
        'blender': bpy.app.version_string,
        'peakMB': peak_mb(),
        'ms': round((time.perf_counter() - T0) * 1000),
    }
    print('MOME_STATS ' + json.dumps(stats), flush=True)
