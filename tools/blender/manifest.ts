/**
 * The GLB model manifest (public/models/manifest.json) and the script hashes it records — shared by the
 * Blender runner (tools/blender/run.ts) and the landmark gates (tools/check/landmarks.ts).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ModelEntry {
  id: string;
  /** file name under public/models/ */
  file: string;
  sha256: string;
  bytes: number;
  /** the build script, relative to the repository root */
  script: string;
  /** sha256 over the script and tools/blender/lib.py (see `scriptHash`) — staleness check */
  scriptSha256: string;
  /** Blender version string of the build */
  blender: string;
  /** triangles of the shared lod0 / lod1 / lod2 nodes */
  tris: [number, number, number];
  /** optional variant nodes `<name>_lod0/1/2` an instance adds on top (ModelDecl instances[].node): tris per LOD */
  variants?: Record<string, [number, number, number]>;
  /** model-space bounds (km): horizontal radius about the origin, height above it */
  boundsKm: { r: number; h: number };
}

export interface ModelManifest {
  version: 1;
  notes: string;
  models: ModelEntry[];
}

export const MODELS_DIR = 'public/models';
export const MANIFEST = `${MODELS_DIR}/manifest.json`;
export const LIB = 'tools/blender/lib.py';

export function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** sha256 of `script` bytes, a NUL, then tools/blender/lib.py bytes (both LF, as committed). */
export function scriptHash(root: string, script: string): string {
  const h = createHash('sha256');
  h.update(readFileSync(join(root, script)));
  h.update(Buffer.from([0]));
  h.update(readFileSync(join(root, LIB)));
  return h.digest('hex');
}

export function readManifest(root: string): ModelManifest {
  const f = join(root, MANIFEST);
  if (!existsSync(f)) return { version: 1, notes: '', models: [] };
  return JSON.parse(readFileSync(f, 'utf8')) as ModelManifest;
}
