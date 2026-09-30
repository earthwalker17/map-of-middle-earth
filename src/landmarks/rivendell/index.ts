import type { LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { buildRivendell, TREES } from './halls.ts';
import { FALLS, LEDGE_N, LEDGE_NE, LEDGE_S, LEDGE_SE, NORTH_FOOT, PAVILION, RAVINE_X, SOUTH_FOOT, STREAM } from './layout.ts';

/**
 * Rivendell, Imladris (research §4): a deep, narrow, steep-walled gorge with ribbon waterfalls; pale
 * terraced halls with steep slate roofs clinging to ledges on both sides, the Last Homely House the
 * largest group, a round Council court among pillars, a thin arched bridge leaping a waterfall's ravine,
 * woods of autumn gold and dark conifers filling the valley — the warmest, calmest place of the film.
 *
 * Local frame: x east, z south (heading 0), km round the display point, heights relative to the base
 * ground there. The baked stream runs east → west through the valley (level ≈ 0 at the display point),
 * falling at x ≈ −4.5 … −6 into the deep Bruinen valley to the west. The gorge is built by RAISING its
 * walls beside the stream (scarps either side, their feet 0.7 km from it, just beyond the stream's ribbon;
 * the river guard keeps the stream and its banks): a high, sunlit north wall and a lower south one, four
 * ledges cut into them for the halls (the main one, the Last Homely House, on the north wall), each
 * terrace edged at its real edge with a low band of rim rock facing the gorge (kit cliffs, halls.ts); the
 * steep scarp faces themselves are the terrain's rock. A rock spur east of the main ledge carries a
 * pavilion at the ledge's level, a notch cut between them is the ravine of a waterfall. Waterfalls are
 * declared for S4 (static pale streaks stand in for them).
 *
 * Straight down the gorge axis the walls hide the ledges, so the hero bookmark looks obliquely down the
 * gorge from the east-south-east with a long lens (fov 14), into the afternoon sun (side-back light).
 */

const STAMPS: LocalStamp[] = [
  // the gorge walls: scarps raising the moor on both sides of the stream — the high, sunlit north wall (2.5,
  // a steep 0.85 km face) that carries the Last Homely House on its ledge, a lower south wall (1.9); the
  // moor running back behind the rims (undulating) and falling away gently, so the valley reads as a cleft
  // in the high moorland rather than a cut between two mesas (the north moor fades within 1.4 km beyond
  // its ends and back: the valley opens north-west into the Bruinen's gorge, whose slopes nothing may
  // stand over)
  { kind: 'scarp', path: NORTH_FOOT, side: 'left', height: 2.5, run: 0.85, plateauKm: 1.9, falloff: 1.4, rough: { amp: 0.45, scaleKm: 3.0 }, surface: 'rock' },
  { kind: 'scarp', path: SOUTH_FOOT, side: 'right', height: 1.9, run: 0.8, plateauKm: 2.2, falloff: 2.6, rough: { amp: 0.35, scaleKm: 3.0 }, surface: 'rock' },
  // the ledges for the halls, level shelves cut into the walls (the two up-valley shelves only cut down:
  // nothing is raised toward the stream there)
  ...[LEDGE_N, LEDGE_S].map((l) => ({ kind: 'flatten' as const, at: l.at, radius: l.r, falloff: 0.3, height: l.h, surface: 'turf' as const })),
  // the rock spur of the pavilion at the main ledge's level, and the waterfall's ravine cut between them
  { kind: 'flatten', at: PAVILION.at, radius: 0.28, falloff: 0.3, height: PAVILION.h, surface: 'rock' },
  { kind: 'flatten', at: [RAVINE_X, PAVILION.at[1] - 0.1], radius: 0.14, falloff: 0.22, height: 0.75, lowerOnly: true, surface: 'rock' },
  ...[LEDGE_NE, LEDGE_SE].map((l) => ({ kind: 'flatten' as const, at: l.at, radius: l.r, falloff: 0.3, height: l.h, lowerOnly: true, surface: 'turf' as const })),
];

export default defineLandmark({
  id: 'rivendell',
  placeId: 'rivendell',
  tier: 'A',
  stamps: STAMPS,
  // the terraces and the gorge floor are cleared of the placed vegetation (its broad scrub clumps do not
  // belong in the gorge; the authored woods stay)
  vegetationExclusion: [...[LEDGE_N, LEDGE_S, LEDGE_NE, LEDGE_SE].map((l) => ({ at: l.at, r: l.r + 0.2 })), ...STREAM.filter((_, i) => i % 2 === 0).map((at) => ({ at, r: 1.0 }))],
  trees: TREES,
  // ribbon falls for S4 (EffectsSystem); pale static streaks stand in for them today (halls.ts)
  waterFeatures: FALLS.map((f) => ({ kind: 'waterfall' as const, path: f.path, width: f.width })),
  proxy: (k) => buildRivendell(k),
  annotation: { title: 'Rivendell', subtitle: 'Imladris, the Last Homely House', blurb: 'The hidden refuge of Elrond Half-elven, where the Fellowship of the Ring was formed.' },
  bookmarks: [
    {
      id: 'rivendell-close',
      distanceKm: 17,
      elevationDeg: 32,
      azimuthDeg: 125,
      fov: 14,
      lift: 0.6,
      aimKm: [0.4, 1.4],
      tod: 16.3,
      compare: ['reference/film/rivendell/rivendell-valley-fotr.jpg', 'reference/concept-art/rivendell/rivendell-alan-lee.png', 'reference/bigatures/rivendell/rivendell-weta-mini.png'],
      note: 'hero (mid, 17 km, long lens): from the east-south-east, obliquely down the gorge into the afternoon sun (side-back light) — the pale gabled halls and the tall spire of the Last Homely House on their ledge against the high north wall, the round court, the thin bridge over the waterfall ravine to the pavilion, the woods of autumn gold and dark conifers massed in the gorge (straight down the axis the walls hide the ledges)',
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
