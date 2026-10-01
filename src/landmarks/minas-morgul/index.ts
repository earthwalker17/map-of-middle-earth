import type { LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { buildBridge, buildCity } from './city.ts';
import { C, PAD_C, PAD_FALL, PAD_R, PAD_REL, TOWER } from './layout.ts';
import { buildTower } from './tower.ts';

/**
 * Minas Morgul, the Tower of the Moon (research §11; the RotK gate-and-bridge still, Nasmith's "The Tower
 * of the Moon"): a walled city on a shelf of the Morgul vale's northern side above the Morgulduin, across a
 * long bridge lined with dark posts; battered walls with spiked parapets, spired towers and steep fin-like
 * buttresses (two great blades flanking the fanged gate); dark steep-roofed houses packed up towards the
 * keep; ONE tall tower of fins twisting as it rises to a flared crown of jagged spikes round a spire. Lit
 * from within by a corpse-light (city.ts): near-black stone, green glow welling up the walls from their
 * feet at night, green window slits, the gate mouth burning, green cores between the tower's fins (dim by
 * day) and the lantern under the crown (always). Local frame: heading 0 (x east, z south); see layout.ts.
 * The Great Signal beam is an S4 effect.
 *
 * Terrain: the display point is at the western mouth of the vale, a trench ≈ 4 units deep cut east–west
 * into the mountain front of the Ephel Dúath (which rises 3–7 units east of x ≈ 2.5 and falls to Ithilien
 * west of x ≈ −4). Stamps (relative to the base ground at the display point): the vale's northern wall
 * carried on west of the mountain front as a ridge behind the city (the southern wall is natural), then
 * the shelf (pad) cut into the vale side — a promontory falling steeply west and south to the stream.
 */
const STAMPS: LocalStamp[] = [
  // the vale's northern wall behind the city, carried west of the mountain front
  {
    kind: 'ridge',
    path: [
      [-6, -3.0],
      [-3, -3.1],
      [0, -3.3],
      [3, -3.6],
    ],
    height: [0.3, 1.6, 1.8, 0.4],
    halfWidth: 2.6,
    profile: 'round',
    rough: { amp: 0.7, scaleKm: 2.0, ridged: true },
    surface: 'rock',
  },
  // the city's shelf
  { kind: 'flatten', at: PAD_C, radius: PAD_R, falloff: PAD_FALL, height: PAD_REL },
];

export default defineLandmark({
  id: 'minas-morgul',
  placeId: 'minas-morgul',
  tier: 'A',
  stamps: STAMPS,
  proxy: (k) => {
    const padY = k.ground(C[0], C[1]);
    buildCity(k);
    buildBridge(k, padY);
    buildTower(k, { at: TOWER, y0: k.ground(TOWER[0], TOWER[1]), r: 0.44, keepH: 0.95, shaftH: 3.6 });
  },
  lookOverride: 'mordor',
  annotation: { title: 'Minas Morgul', subtitle: 'The Tower of Sorcery', blurb: 'Once Minas Ithil, Tower of the Rising Moon — now the stronghold of the Nazgûl.' },
  bookmarks: [
    {
      id: 'minas-morgul-close',
      distanceKm: 20,
      elevationDeg: 7,
      azimuthDeg: 214,
      fov: 25,
      lift: 1.7,
      aimKm: [0.3, -2.7],
      tod: 21.0,
      dayOfYear: 78,
      compare: ['reference/film/minas-morgul/minas-morgul-gate-bridge-film.jpg', 'reference/concept-art/minas-morgul/nasmith-tower-of-the-moon.jpg'],
      note: 'night from the south-south-west, down the line of the bridge: the arched bridge over the Morgulduin gorge leading in from the lower right to the fanged gate between its two great blades, the walls lit green from below, the twisted tower; a March moon 55° up behind the camera (Frodo passed here on 10 March); Mount Doom and Cirith Ungol stay out of frame (right)',
    },
    { id: 'minas-morgul-wide', distanceKm: 70, elevationDeg: 24, azimuthDeg: 205, fov: 35, lift: 6, tod: 21.0, dayOfYear: 78, note: 'the Morgul vale in the Ephel Dúath at night from the south-south-west over southern Ithilien, the city a green spark on the vale side; turned off the old axis (Mount Doom lies straight behind the city from the west-south-west) so Doom stays at the right edge' },
  ],
});
