import type { LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { buildRivendell, FORESTS, TREES } from './halls.ts';
import { FALLS, LEDGE_N, LEDGE_NE, LEDGE_S, LEDGE_SE, NORTH_FOOT, NORTH_H, PAVILION, RAVINE_X, SOUTH_FOOT, SOUTH_H, STREAM } from './layout.ts';

/**
 * Rivendell, Imladris (research §4): a deep, narrow gorge with sheer rock walls and ribbon waterfalls;
 * honey-cream elven halls under steep, swept (bell-cast) roofs of verdigris and bronze, slender towers
 * with ogee caps, open pavilions, arched galleries and terraces cantilevered over the gorge on slender
 * columns — the Last Homely House on a spur above the stream, a second group on the south ledge, single
 * halls on two up-valley shelves, a round Council court among pillars, a thin arched bridge leaping a
 * waterfall's ravine, woods of golden ochre broadleaves, pale-gold birches and slender firs kept under
 * ~0.6 of the main hall's height — the warmest, calmest place of the film.
 *
 * Local frame: x east, z south (heading 0), km round the display point, heights relative to the base
 * ground there. The baked stream runs east → west through the valley (level ≈ 0 at the display point),
 * falling at x ≈ −4.5 … −6 into the deep Bruinen valley to the west. The gorge is built by RAISING its
 * walls beside the stream (scarps either side, their feet 0.7 km from it, a steep 0.5 km face; the river
 * guard keeps the stream and its banks): a north wall 3.3 high that begins behind the main ledge (so the
 * ledge stands out from its west end as a spur, open to the west), a south wall 2.8 high; kit cliffs
 * (halls.ts) seated at the scarps' feet give the faces sheer, stratified rock. Ledges are cut into the
 * walls for the halls, each edged with a band of rim rock; a rock spur east of the main ledge carries a
 * pavilion at the ledge's level, a notch cut between them is the ravine of a waterfall. Five waterfalls
 * are declared for S4 (no placeholder geometry).
 *
 * The hero looks from over the west-south-west rim down into the gorge with a long lens (the house on
 * its spur on the left third, the gorge receding up-valley), on a late-October morning (side light from
 * the south-east); the wide shows the valley as a dark slot in the moors under the Misty Mountains.
 */

const STAMPS: LocalStamp[] = [
  // the gorge walls: scarps raising the moor on both sides of the stream — the high, sunlit north wall (3.3,
  // a steep 0.5 km face) behind the Last Homely House's spur, the south wall (2.8); the moor running back
  // behind the rims (undulating) and falling away, so the valley reads as a deep cleft in the high moorland
  // (the north moor fades within 0.8 km beyond its ends and back: the valley opens north-west into the
  // Bruinen's gorge, whose slopes nothing may stand over)
  { kind: 'scarp', path: NORTH_FOOT, side: 'left', height: NORTH_H, run: 0.5, plateauKm: 1.9, falloff: 0.8, rough: { amp: 0.45, scaleKm: 3.0 }, surface: 'rock' },
  { kind: 'scarp', path: SOUTH_FOOT, side: 'right', height: SOUTH_H, run: 0.5, plateauKm: 2.2, falloff: 2.6, rough: { amp: 0.35, scaleKm: 3.0 }, surface: 'rock' },
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
  // the valley, its rims, the terraces and the gorge floor are cleared of the placed vegetation (its broad
  // clumps are far too big beside the halls; the landmark's own woods and authored trees stay)
  vegetationExclusion: [{ at: [0.5, 0], r: 4.5 }, ...[LEDGE_N, LEDGE_S, LEDGE_NE, LEDGE_SE].map((l) => ({ at: l.at, r: l.r + 0.2 })), ...STREAM.filter((_, i) => i % 2 === 0).map((at) => ({ at, r: 1.0 }))],
  trees: TREES,
  forests: FORESTS,
  // ribbon falls for S4 (EffectsSystem); the rock under them is darker (wet) today (halls.ts)
  waterFeatures: FALLS.map((f) => ({ kind: 'waterfall' as const, path: f.path, width: f.width })),
  proxy: (k) => buildRivendell(k),
  annotation: { title: 'Rivendell', subtitle: 'Imladris, the Last Homely House', blurb: 'The hidden refuge of Elrond Half-elven, where the Fellowship of the Ring was formed.' },
  bookmarks: [
    {
      id: 'rivendell-close',
      distanceKm: 10,
      elevationDeg: 19,
      azimuthDeg: 248,
      fov: 24,
      lift: 0.5,
      aimKm: [0.8, 1.2],
      tod: 10.5,
      dayOfYear: 298,
      compare: ['reference/film/rivendell/rivendell-valley-fotr.jpg', 'reference/concept-art/rivendell/rivendell-alan-lee.png', 'reference/bigatures/rivendell/rivendell-weta-mini.png'],
      note: 'hero (10 km, long lens): from over the west-south-west rim down into the deep gorge on a late-October morning — the Last Homely House on its spur on the left third (honey-cream halls, swept verdigris and bronze roofs, slender towers with ogee caps, the round Council court, terraces cantilevered over the gorge), the sheer walls and the stream receding up the gorge past the shelf halls, golden woods on the floor; the falls are S4 effects',
    },
    {
      id: 'rivendell-wide',
      distanceKm: 45,
      elevationDeg: 17,
      azimuthDeg: 250,
      fov: 35,
      lift: 1.0,
      tod: 10.5,
      dayOfYear: 298,
      compare: ['reference/concept-art/rivendell/rivendell-alan-lee.png', 'reference/concept-art/rivendell/rivendell-descent-john-howe.jpg'],
      note: 'from the west-south-west over the Bruinen: the hidden valley, a deep dark slot cut into the moors below the Misty Mountains, on a late-October morning',
    },
  ],
});
