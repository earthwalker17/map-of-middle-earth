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
 * The hero looks up the gorge from beyond the valley lip with a long lens (the house on its spur on the
 * left third, the gorge head in the upper third) on a late-October afternoon at the film segment's tod
 * (the low sun from the south-west); the wide shows the valley as a slot cut into the high moorland under
 * the Misty Mountains.
 */

const STAMPS: LocalStamp[] = [
  // the gorge walls: scarps raising the moor on both sides of the stream — the high, sunlit north wall (3.3,
  // a steep 0.5 km face) behind the Last Homely House's spur, the south wall (2.8); the moor running back
  // 4.5–5 km behind the rims (undulating) and falling gently away, so the valley reads as a deep cleft in
  // the high moorland. The fades are bounded: a longer north fade lifts the ground west of the main ledge
  // over the hero's line of sight, a longer south fade carries the stamp box over the hero camera (probe)
  { kind: 'scarp', path: NORTH_FOOT, side: 'left', height: NORTH_H, run: 0.5, plateauKm: 4.5, falloff: 3.0, rough: { amp: 0.45, scaleKm: 3.0 }, surface: 'rock' },
  { kind: 'scarp', path: SOUTH_FOOT, side: 'right', height: SOUTH_H, run: 0.5, plateauKm: 5.0, falloff: 2.5, rough: { amp: 0.35, scaleKm: 3.0 }, surface: 'rock' },
  // the ledges for the halls, level shelves cut into the walls (≥ 1.2 km across, so the heightfield holds
  // them); the north-east shelf only cuts down into its wall
  ...[LEDGE_N, LEDGE_S, LEDGE_SE].map((l) => ({ kind: 'flatten' as const, at: l.at, radius: l.r, falloff: 0.3, height: l.h, surface: 'turf' as const })),
  // the rock spur of the pavilion at the main ledge's level, and the waterfall's ravine cut between them
  { kind: 'flatten', at: PAVILION.at, radius: 0.28, falloff: 0.3, height: PAVILION.h, surface: 'rock' },
  { kind: 'flatten', at: [RAVINE_X, PAVILION.at[1] - 0.1], radius: 0.14, falloff: 0.22, height: 0.75, lowerOnly: true, surface: 'rock' },
  { kind: 'flatten', at: LEDGE_NE.at, radius: LEDGE_NE.r, falloff: 0.3, height: LEDGE_NE.h, lowerOnly: true, surface: 'turf' },
];

export default defineLandmark({
  id: 'rivendell',
  placeId: 'rivendell',
  tier: 'A',
  stamps: STAMPS,
  // the valley, its rims, the terraces and the gorge floor are cleared of the placed vegetation (its broad
  // clumps are far too big beside the halls; the landmark's own woods and authored trees stay)
  vegetationExclusion: [{ at: [0.5, 0], r: 4.5 }, ...STREAM.filter((p, i) => i % 2 === 0 && Math.hypot(p[0] - 0.5, p[1]) + 1.0 > 4.5).map((at) => ({ at, r: 1.0 }))],
  trees: TREES,
  forests: FORESTS,
  // S4 tree-height cap: every tree of the valley stays under 0.6 of the Last Homely House (0.49 to its ridge)
  treeCaps: [{ at: [0.5, 0], r: 4.0, maxHeightKm: 0.28 }],
  // ribbon falls for S4 (EffectsSystem); the rock under them is darker (wet) today (halls.ts)
  waterFeatures: FALLS.map((f) => ({ kind: 'waterfall' as const, path: f.path, width: f.width })),
  // mist cards (EffectsSystem): a layer along the gorge floor below the halls (the floor falls from ≈ +0.6
  // at x 3.3 to −0.5 at x −3.3; the ledges stand at 1.0–1.7), a thinner one up the valley, and one in the
  // Bruinen's gorge under the stream's falls; the cards fade where the ground rises to them
  emitters: [
    { preset: 'mist', at: [3.6, 0.85, -1.15], to: [-3.6, -0.15, 0.85], rate: 0.7, scale: 0.75, color: 0xe8ebee },
    { preset: 'mist', at: [7.5, 1.55, -1.75], to: [3.9, 0.95, -1.2], rate: 0.5, scale: 0.6, color: 0xe8ebee },
    { preset: 'mist', at: [-5.6, -2.55, 1.4], to: [-8.6, -2.9, 2.0], rate: 0.7, scale: 0.9, color: 0xe8ebee },
  ],
  proxy: (k) => buildRivendell(k),
  annotation: { title: 'Rivendell', subtitle: 'Imladris, the Last Homely House', blurb: 'The hidden refuge of Elrond Half-elven, where the Fellowship of the Ring was formed.' },
  bookmarks: [
    {
      id: 'rivendell-close',
      distanceKm: 9.5,
      elevationDeg: 11,
      azimuthDeg: 256,
      fov: 21,
      lift: 1.0,
      aimKm: [2.4, 1.4],
      tod: 16.3,
      dayOfYear: 298,
      compare: ['reference/film/rivendell/rivendell-valley-fotr.jpg', 'reference/concept-art/rivendell/rivendell-alan-lee.png', 'reference/bigatures/rivendell/rivendell-weta-mini.png'],
      note: 'hero (long lens from beyond the valley lip, framed as at 6.5 km with a 28° lens): looking up the gorge on a late-October afternoon (the film segment\'s tod; the low sun from the south-west, behind the right shoulder) — the Last Homely House on its spur on the left third (honey-cream halls, swept verdigris and bronze roofs, slender towers with ogee caps, the round Council court, terraces cantilevered over the gorge), the sheer walls with their wet gullies and the stream receding up the gorge to its head in the upper third, golden woods; the south-ledge group framed out; the falls are S4 effects. The probe measures 0 px for a subject whose stamp box contains the camera\'s near corners (the gorge\'s plateaus): visibility is still checked',
      expect: { minSubjectPx: 0 },
    },
    {
      id: 'rivendell-wide',
      distanceKm: 30,
      elevationDeg: 11,
      azimuthDeg: 240,
      fov: 26,
      lift: 3,
      aimKm: [3, 1],
      tod: 16.3,
      dayOfYear: 298,
      compare: ['reference/concept-art/rivendell/rivendell-alan-lee.png', 'reference/concept-art/rivendell/rivendell-descent-john-howe.jpg'],
      note: 'from the south-west over the Bruinen (30 km, long lens): the hidden valley, a deep slot cut into the high moorland below the Misty Mountains (the rims run on into the moor), the halls on their spur, on a late-October afternoon. The mountains rise ≈ 25° over the valley seen from the west: no sky fits with the valley in a ≤ 40° lens (probe)',
    },
  ],
});
