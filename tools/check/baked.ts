/**
 * Node access to a baked world for validators and reports (no GPU): raw rasters, and the real World +
 * landmark stamp layer through a fetch shim over the bake directory (MOME_WORLD_DIR or data/baked).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BakedManifest } from '../../src/world/WorldSpec.ts';
import type { World } from '../../src/world/World.ts';
import type { LandmarkDefinition } from '../../src/landmarks/types.ts';
import type { Stamp } from '../../src/world/stamps.ts';

export const ROOT = process.cwd();

export function bakedDir(): string {
  return process.env.MOME_WORLD_DIR ?? join(ROOT, 'data/baked');
}

export function hasBake(dir: string): boolean {
  return existsSync(join(dir, 'manifest.json'));
}

export function readManifest(dir: string): BakedManifest {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as BakedManifest;
}

export interface Raster {
  w: number;
  h: number;
  data: Float32Array;
}

export function readHeight(dir: string): Raster {
  const f = readManifest(dir).files.height;
  const buf = readFileSync(join(dir, f.file));
  const u16 = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  const data = new Float32Array(u16.length);
  const k = (f.max - f.min) / 65535;
  for (let i = 0; i < u16.length; i++) data[i] = f.min + u16[i] * k;
  return { w: f.width, h: f.height, data };
}

/** One channel (0..3) of an RGBA8 mask, as 0..255. */
export function readMaskChannel(dir: string, key: 'water' | 'landcover' | 'forests' | 'terrain', ch: number): { w: number; h: number; data: Uint8Array } {
  const f = readManifest(dir).files[key];
  if (!f) throw new Error(`bake has no ${key} mask`);
  const buf = readFileSync(join(dir, f.file));
  const out = new Uint8Array(f.width * f.height);
  for (let i = 0; i < out.length; i++) out[i] = buf[i * 4 + ch];
  return { w: f.width, h: f.height, data: out };
}

let shimDir = '';
function installFetch(dir: string): void {
  shimDir = dir;
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
    const rel = String(url).replace(/^\/world\//, '');
    const buf = readFileSync(join(shimDir, rel));
    return {
      ok: true,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      json: async () => JSON.parse(buf.toString('utf8')),
    };
  };
}

export async function loadLandmarks(): Promise<LandmarkDefinition[]> {
  const out: LandmarkDefinition[] = [];
  const dir = join(ROOT, 'src/landmarks');
  for (const d of readdirSync(dir).sort()) {
    const f = join(dir, d, 'index.ts');
    if (existsSync(f)) out.push(((await import(pathToFileURL(f).href)) as { default: LandmarkDefinition }).default);
  }
  return out;
}

/** The runtime World for a bake directory, with the landmark stamp layer composited. */
export async function loadWorld(dir: string): Promise<{ world: World; landmarks: LandmarkDefinition[]; stamps: Stamp[] }> {
  installFetch(dir);
  const { World } = (await import(pathToFileURL(join(ROOT, 'src/world/World.ts')).href)) as typeof import('../../src/world/World.ts');
  const { landmarkStamps } = (await import(pathToFileURL(join(ROOT, 'src/landmarks/LandmarkSystem.ts')).href)) as typeof import('../../src/landmarks/LandmarkSystem.ts');
  const world = await World.load();
  const landmarks = await loadLandmarks();
  const stamps = landmarkStamps(world, landmarks);
  world.heights.setStamps(stamps);
  return { world, landmarks, stamps };
}
