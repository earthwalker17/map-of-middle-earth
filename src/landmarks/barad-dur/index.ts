import type { LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { buildTower, CROWN_Y, EYE_DY } from './tower.ts';

/**
 * Barad-dûr, the Dark Tower (research §14): a black, jagged spire of bundled fins and spikes rising in
 * stepped tiers from a massive buttressed foundation on a spur of the Ered Lithui; at the top two curved
 * horns form a U-shaped cradle holding the Eye — the brightest thing in Mordor. Slim (the fin bundles
 * are ≤ 5 km across, the foundation 7 km), ~20 km from the platform to the horn tips, so its top stands
 * a little above Mount Doom's rim (its ground is ~11 higher than Doom's plain).
 *
 * Local frame: heading 170 — the local −z faces south-south-east, so the crescent of the horns (in the
 * local x–y plane) faces the hero cameras over Gorgoroth: its own (from bearing 145°, 25° off the face)
 * and the Mount Doom hero shot (Barad-dûr seen from bearing 192°, 22° off). The display offset
 * (14, 10) keeps it on the plateau edge north-east of Doom with a plain between the two.
 *
 * Stamps (heights relative to the base ground at the display point): a level platform for the foundation
 * (a flatten to +3.2), then a craggy mount round it — a massif whose main spur runs north-north-east into
 * the Ered Lithui foothills (the tower stands at the end of a mountain spur), with short buttress spurs
 * and ridged roughness; spur azimuths are local (world − heading).
 */
const HEADING = 170;
const world = (az: number) => (((az - HEADING) % 360) + 360) % 360;

const STAMPS: LocalStamp[] = [
  { kind: 'flatten', at: [0, 0], radius: 4.4, falloff: 3.5, height: 3.2 },
  {
    kind: 'massif',
    at: [0, 0],
    radius: 8,
    summit: 3.4,
    base: -1,
    exponent: 1.2,
    dome: 0.8,
    spurs: [
      // the Ered Lithui spur the tower stands at the end of
      { azimuthDeg: world(25), lengthKm: 16, widthKm: 4.5, heightFrac: 0.62, rootFrac: 0.92 },
      // buttress spurs of the mount
      { azimuthDeg: world(212), lengthKm: 7.5, widthKm: 3, heightFrac: 0.36, rootFrac: 0.85 },
      { azimuthDeg: world(122), lengthKm: 8, widthKm: 3, heightFrac: 0.4, rootFrac: 0.85 },
      { azimuthDeg: world(292), lengthKm: 6.5, widthKm: 3, heightFrac: 0.32, rootFrac: 0.8 },
    ],
    flankSlope: 2.0,
    rough: { amp: 0.8, scaleKm: 2.0, ridged: true },
    surface: 'rock',
  },
];

/** The Dark Tower: a black, buttressed spire crowned by two horns cradling the Eye. */
export default defineLandmark({
  id: 'barad-dur',
  placeId: 'barad-dur',
  tier: 'A',
  headingDeg: HEADING,
  stamps: STAMPS,
  proxy: (k) => buildTower(k),
  emitters: [{ preset: 'smoke', at: [0, CROWN_Y + EYE_DY + 1, 0], rate: 0.3 }],
  lookOverride: 'mordor',
  vegetationExclusion: 12,
  contrast: 'dark',
  annotation: { title: 'Barad-dûr', subtitle: 'The Dark Tower', blurb: 'Fortress of Sauron, its crown ever watchful with the lidless Eye.' },
  bookmarks: [
    {
      id: 'barad-dur-close',
      distanceKm: 50,
      elevationDeg: 1.5,
      azimuthDeg: 145,
      fov: 38,
      lift: 4,
      tod: 18.5,
      compare: ['reference/film/barad-dur/barad-dur-eye-rotk.jpg', 'reference/film/mordor/mordor-barad-dur-and-doom-rotk.webp', 'reference/concept-art/barad-dur/howe-the-dark-tower.jpg'],
      note: 'low from the south-east over Gorgoroth, the Ered Lithui behind (no slab edge on the horizon): the black spire on its spur, the horns and the Eye against the sky, the low sun raking from the left',
    },
  ],
});
