"""Blender version / glTF exporter option probe (pnpm models --probe).

Prints the Blender version and every property of `bpy.ops.export_scene.gltf` (identifier, type, default,
enum items) so tools/blender/lib.py uses the real 4.5 names instead of guessed ones.
"""
import json
import sys

import bpy

print('MOME_PROBE blender', bpy.app.version_string)
print('MOME_PROBE python', sys.version.split()[0])
props = bpy.ops.export_scene.gltf.get_rna_type().properties
for p in props:
    if p.identifier == 'rna_type':
        continue
    info = {'type': p.type}
    try:
        if p.type == 'ENUM':
            info['items'] = [i.identifier for i in p.enum_items]
            info['default'] = sorted(p.default_flag) if p.is_enum_flag else p.default
        elif getattr(p, 'is_array', False) and p.array_length > 0:
            info['default'] = list(p.default_array)
        elif p.type in ('BOOLEAN', 'INT', 'FLOAT', 'STRING'):
            info['default'] = p.default
    except Exception as e:  # noqa: BLE001 — diagnostics only
        info['error'] = str(e)
    print('MOME_PROBE option', p.identifier, json.dumps(info))
# the modifiers / operators the builds rely on
for name in ('SKIN', 'SUBSURF', 'REMESH', 'DECIMATE', 'DISPLACE', 'BEVEL', 'SMOOTH', 'CORRECTIVE_SMOOTH', 'WELD'):
    print('MOME_PROBE modifier', name, name in {m.identifier for m in bpy.types.Modifier.bl_rna.properties['type'].enum_items})
print('MOME_PROBE ok')
