import type { LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { buildRivendell, TREES } from './halls.ts';
import { LEDGE_N, LEDGE_NE, LEDGE_S, LEDGE_SE, NORTH_FOOT, SOUTH_FOOT } from './layout.ts';

/**
 * Rivendell, Imladris (research §4): a deep, narrow, steep-walled gorge with ribbon waterfalls; pale
 * terraced halls with steep slate roofs clinging to ledges on both sides, the Last Homely House the
 * largest group, a round Council court among pillars, a thin high arched bridge across the gorge, autumn
 * trees filling the valley — the warmest, calmest place of the film.
 *
 * Local frame: x east, z south (heading 0), km round the display point, heights relative to the base
 * ground there. The baked stream runs east → west through the valley (level ≈ 0 at the display point),
 * falling at x ≈ −4.5 … −6 into the deep Bruinen valley to the west. The gorge is built by RAISING its
 * walls beside the stream (scarps either side; the river guard keeps the stream and its banks), with a
 * ledge cut into each wall for the halls; the sheer upper walls are kit cliffs (halls.ts), with notches
 * where the S4 waterfalls will fall.
 */

const STAMPS: LocalStamp[] = [
  // the gorge walls: scarps raising the moor on both sides of the stream — the high, sunlit north wall (2.7,
  // a steep 0.85 km face) that carries the Last Homely House on its ledge, a lower south side (1.35) over
  // which the valley is seen; the moor running back behind the rims (undulating) and falling away gently,
  // so the valley reads as a cleft in the high moorland rather than a cut between two mesas
  // (the north moor fades within 1.2 km beyond its ends and back: the valley opens north-west into the
  // Bruinen's gorge, whose slopes nothing may stand over)
  { kind: 'scarp', path: NORTH_FOOT, side: 'left', height: 2.7, run: 0.85, plateauKm: 1.7, falloff: 1.3, rough: { amp: 0.45, scaleKm: 3.0 }, surface: 'rock' },
  { kind: 'scarp', path: SOUTH_FOOT, side: 'right', height: 1.35, run: 0.8, plateauKm: 2.0, falloff: 2.6, rough: { amp: 0.35, scaleKm: 3.0 }, surface: 'rock' },
  // the ledges for the halls, level shelves cut into the walls (the two up-valley shelves only cut down:
  // nothing is raised toward the stream there)
  ...[LEDGE_N, LEDGE_S].map((l) => ({ kind: 'flatten' as const, at: l.at, radius: l.r, falloff: 0.35, height: l.h, surface: 'turf' as const })),
  ...[LEDGE_NE, LEDGE_SE].map((l) => ({ kind: 'flatten' as const, at: l.at, radius: l.r, falloff: 0.3, height: l.h, lowerOnly: true, surface: 'turf' as const })),
];

export default defineLandmark({
  id: 'rivendell',
  placeId: 'rivendell',
  tier: 'A',
  stamps: STAMPS,
  vegetationExclusion: [LEDGE_N, LEDGE_S, LEDGE_NE, LEDGE_SE].map((l) => ({ at: l.at, r: l.r + 0.2 })),
  trees: TREES,
  // ribbon falls for S4 (EffectsSystem): the stream's descent into the Bruinen's gorge, and two falls from
  // the moor rims into the valley beside the ledges (local x, y, z)
  waterFeatures: [
    { kind: 'waterfall', path: [[-4.3, -0.8, 1.07], [-6.2, -2.9, 1.54]], width: 0.35 },
    { kind: 'waterfall', path: [[1.25, 2.35, -2.35], [1.2, 0.2, -0.95]], width: 0.12 },
    { kind: 'waterfall', path: [[-0.3, 2.4, 2.05], [-0.25, 0.1, 0.95]], width: 0.1 },
  ],
  proxy: (k) => buildRivendell(k),
  annotation: { title: 'Rivendell', subtitle: 'Imladris, the Last Homely House', blurb: 'The hidden refuge of Elrond Half-elven, where the Fellowship of the Ring was formed.' },
  bookmarks: [
    {
      id: 'rivendell-close',
      distanceKm: 18,
      elevationDeg: 30,
      azimuthDeg: 170,
      fov: 22,
      lift: 0.6,
      aimKm: [0.1, 1.0],
      tod: 16.3,
      compare: ['reference/film/rivendell/rivendell-valley-fotr.jpg', 'reference/concept-art/rivendell/rivendell-alan-lee.png', 'reference/bigatures/rivendell/rivendell-weta-mini.png'],
      note: 'hero (mid, 18 km, long lens): across the valley from the south-south-east over its low south rim, into the afternoon sun — the pale halls of the Last Homely House on their ledge against the high north wall, the round court, the thin bridge over the gorge, the autumn gold backlit (seen down the gorge axis the walls hide the ledges)',
    },
    {
      id: 'rivendell-wide',
      distanceKm: 70,
      elevationDeg: 16,
      azimuthDeg: 255,
      fov: 35,
      lift: 1.0,
      tod: 16.3,
      compare: ['reference/concept-art/rivendell/rivendell-alan-lee.png', 'reference/concept-art/rivendell/rivendell-descent-john-howe.jpg'],
      note: 'from the west over the Bruinen: the hidden valley cut into the moors below the Misty Mountains, lit by the afternoon sun',
    },
  ],
});
