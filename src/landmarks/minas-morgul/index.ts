import type { LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { buildBridge, buildCity } from './city.ts';
import { C, PAD_C, PAD_FALL, PAD_R, PAD_REL, T3_TOP, TOWER } from './layout.ts';
import { buildTower } from './tower.ts';
import { WASH_LIGHTS } from './wash.ts';

/**
 * Minas Morgul, the Tower of the Moon (research §11; the RotK gate-and-bridge still, Nasmith's "The Tower
 * of the Moon"): a walled city on a shelf of the Morgul vale's northern side above the Morgulduin, across a
 * broad bridge lined with hunched statues; PALE, ghostly stone (city.ts) tiered up against the mountain —
 * a battered, ribbed curtain of uneven height between bastions on a retaining plinth over a sheer rock
 * spur, a second terrace ring, the keep terrace with heavy blocks round the Tower, pale houses with dark
 * roofs; sharp fins only at the gate (two great blades) and at the crown. A corpse-light washes up every
 * outer face from its foot (glow bands over ~45 % of the height, pooling on the ground at the feet and
 * spilling down the plinths); a few dim window slits; the gate mouth burns. ONE tall tower (tower.ts):
 * a twisted fin shaft, a green-burning lamp room behind twisting piers — the city's one strong light —
 * and a spiral crown of eight blades drawing in to a needle. Local frame: heading 0 (x east, z south);
 * see layout.ts. The Great Signal beam is an S4 effect.
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
  // the Great Signal's spill (event morgul-beam, spill only: the beam ribbon is the EffectsSystem's) above
  // the crown, so the city and the vale light up green while it burns
  lights: [...WASH_LIGHTS, { at: [TOWER[0], 7.4, TOWER[1]], color: 0x3dff86, intensity: 2.4, radius: 0.15, kind: 'magic', gate: 'event', event: 'morgul-beam', spillKm: 4, sprite: false }],
  emitters: [
    // the Great Signal: a green beam from the crown up into the pall (deck ≈ 52 → +32 here), event-gated
    { preset: 'beam', at: [TOWER[0], 6.7, TOWER[1]], to: [TOWER[0], 31, TOWER[1]], rate: 1, scale: 1, color: 0x52ff8a, event: 'morgul-beam' },
    // the vale's corpse-light mist: a layer on the slope under the gate (in the wall-wash's reach), a sheet
    // following the Morgulduin down past the bridge (the stream falls west: −1.1 at x 2.3, −3.8 at the
    // bridge, −6.7 at x −2.3) and a layer pooled down the vale (−8.3 at x −3.5); green tint
    { preset: 'mist', at: [2.0, -1.4, 3.8], to: [-2.2, -1.8, 4.6], rate: 0.9, scale: 1.1, color: 0xb6f2c6 },
    { preset: 'mist', at: [2.3, -0.75, 6.8], to: [-2.3, -6.3, 4.95], rate: 1.1, scale: 0.8, color: 0xb6f2c6 },
    { preset: 'mist', at: [-2.6, -7.2, 4.9], to: [-6.8, -9.6, 5.2], rate: 1.1, scale: 1.4, color: 0xb6f2c6 },
  ],
  proxy: (k) => {
    const padY = k.ground(C[0], C[1]);
    buildCity(k);
    buildBridge(k, padY);
    buildTower(k, { at: TOWER, y0: T3_TOP, r: 0.44, keepH: 1.1, shaftH: 2.6, spireH: 0.9 });
  },
  lookOverride: 'mordor',
  annotation: { title: 'Minas Morgul', subtitle: 'The Tower of Sorcery', blurb: 'Once Minas Ithil, Tower of the Rising Moon — now the stronghold of the Nazgûl.' },
  bookmarks: [
    {
      id: 'minas-morgul-close',
      distanceKm: 14,
      elevationDeg: 6,
      azimuthDeg: 203,
      fov: 48,
      lift: 2.4,
      aimKm: [0.2, -1.8],
      tod: 21.0,
      dayOfYear: 78,
      compare: ['reference/film/minas-morgul/minas-morgul-gate-bridge-film.jpg', 'reference/concept-art/minas-morgul/nasmith-tower-of-the-moon.jpg'],
      note: 'night from the south (14 km): the pale citadel tiered against the mountain (the city ≈ 40 % of the silhouette) and its twisted tower filling the frame height with a little headroom, every wall washed green from its visible foot, the lamp room the one strong light, the pale statue bridge leading in from the bottom third; a March moon 55° up behind the camera (Frodo passed here on 10 March); Mount Doom, Barad-dûr and Cirith Ungol out of frame (right)',
    },
    {
      id: 'minas-morgul-wide',
      distanceKm: 38,
      elevationDeg: 5,
      azimuthDeg: 218,
      fov: 24,
      lift: -2.3,
      aimKm: [2.5, -4],
      tod: 21.0,
      dayOfYear: 78,
      compare: ['reference/concept-art/minas-morgul/nasmith-tower-of-the-moon.jpg'],
      note: 'night, low from the south-west up the Morgul vale: the pale citadel on the left third on the vale\'s north wall, the vale and the Morgulduin receding into the Ephel Dúath on the right, its lamp the one green light; Mount Doom and Barad-dûr beyond the right edge (from the west-south-west both stand right behind the citadel)',
    },
  ],
});
