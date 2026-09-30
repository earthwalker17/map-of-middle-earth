import { rotateLocal } from '../frame.ts';
import type { V2, V3 } from '../records.ts';
import { defineLandmark } from '../types.ts';
import { kingTS } from './king.ts';

/**
 * The Argonath — the Pillars of the Kings: two colossal robed kings on pedestals at the water's edge on
 * both banks of the Anduin, facing upstream, each raising the LEFT hand palm outward in warning, the right
 * gripping a long axe; the west king bearded under a crowned helm, the east king in a full helm with a
 * face guard. Local frame: heading 15° (the river runs in from the NNE here, so the kings face it);
 * x = across the river (east bank +x), −z = upstream.
 *
 * S3 spike (W2-D): the figure exists twice — the TS kit v2 fallback (king.ts) and a Blender-built GLB
 * (tools/blender/argonath.py → public/models/argonath.glb, same proportions). `USE_GLB` picks one; the
 * other stays one edit away.
 */
const USE_GLB = true;

const HEADING = 15;
/** nominal waterline at the kings, local y (river level ≈ 4.94 vs the origin ground 4.64) */
const WATER_Y = 0.3;
/** king frame origins (pedestal axis at the waterline), local km */
const KINGS: { at: V3; variant: 'crown' | 'helm' }[] = [
  { at: [-2.35, WATER_Y, 0], variant: 'crown' },
  { at: [2.35, WATER_Y, 0], variant: 'helm' },
];
/** the film's greenish statue stone (lit #52554f, shade #35413f) and the browner gorge rock (#5b5649) */
const STONE = 0x80847b;
const PLINTH = 0x6f6a5c;

/** stamps keep their S1 WORLD placement: local offsets un-rotated by the heading */
const unrot = (p: V2): V2 => rotateLocal(p, -HEADING);

export default defineLandmark({
  id: 'argonath',
  placeId: 'argonath',
  tier: 'A',
  headingDeg: HEADING,
  stamps: [
    { kind: 'raise', at: unrot([-6.5, 0]), radius: 4.5, amount: 3.5 },
    { kind: 'raise', at: unrot([6.5, 0]), radius: 4.5, amount: 3.5 },
  ],
  ...(USE_GLB
    ? {
        model: {
          file: 'argonath.glb',
          // the same king twice, NOT mirrored: both raise the left hand (the film / the book)
          instances: KINGS.map((kg) => ({ at: kg.at })),
          boundsKm: { r: 1.42, h: 7.25 },
        },
      }
    : {
        proxy: (k) => {
          for (const kg of KINGS) kingTS(k, { at: kg.at, variant: kg.variant, stone: STONE, plinth: PLINTH });
        },
      }),
  annotation: { title: 'The Argonath', subtitle: 'The Pillars of the Kings', blurb: 'Two colossal kings of old guard the northern gate of Gondor upon the Great River.' },
  bookmarks: [{ id: 'argonath-close', distanceKm: 32, elevationDeg: 10, azimuthDeg: 350, fov: 38, lift: 4, tod: 15 }],
});
