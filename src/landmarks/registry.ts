import type { LandmarkDefinition } from './types.ts';

/** Every src/landmarks/<id>/index.ts default-exports a defineLandmark(...) bundle. */
const modules = import.meta.glob<{ default: LandmarkDefinition }>('./*/index.ts', { eager: true });

export const LANDMARKS: LandmarkDefinition[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.id.localeCompare(b.id));
