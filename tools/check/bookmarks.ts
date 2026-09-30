/**
 * Bookmark framing gates (CPU camera probe, tools/check/probe.ts): every landmark bookmark meets its
 * expectations — `-close`: subject ≥ 25 % of frame height, no void at the top, sky share in range, clear
 * line of sight; `-wide`: projected extent ≥ places.json wideShotPxTarget — plus shot-list coverage.
 *
 * W0a stub: counts bookmarks. Implemented with probe v2 (W0b).
 */
import type { World } from '../../src/world/World.ts';
import type { LandmarkDefinition } from '../../src/landmarks/types.ts';
import type { CheckResult } from './world.ts';

export async function checkBookmarks(_world: World, landmarks: LandmarkDefinition[]): Promise<CheckResult> {
  const out: CheckResult = { errors: [], warnings: [], info: [] };
  const n = landmarks.reduce((s, d) => s + (d.bookmarks?.length ?? 0), 0);
  out.info.push(`bookmarks: ${n} landmark bookmarks`);
  return out;
}
