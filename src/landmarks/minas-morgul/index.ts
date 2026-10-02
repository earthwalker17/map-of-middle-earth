import type { LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { buildBridge, buildCity } from './city.ts';
import { C, PAD_C, PAD_FALL, PAD_R, PAD_REL, T3_TOP, TOWER } from './layout.ts';
import { buildTower } from './tower.ts';
import { WASH_LIGHTS } from './wash.ts';

/**
 * Minas Morgul, the Tower of the Moon (research §11; the RotK gate-and-bridge still, Nasmith's "The Tower
 * of the Moon"): a walled city on a shelf of the Morgul vale's northern side above the Morgulduin, across a
 * kinked, arched bridge lined with hunched statues on parapet posts; DARK, dead stone (city.ts, S4 W5)
 * tiered up against the mountain — a battered, ribbed curtain of uneven height between bastions on a
 * retaining plinth over a sheer rock spur, a second terrace ring, the keep terrace with heavy blocks round
 * the Tower, houses with dark roofs; sharp fins only at the gate (two great blades) and at the crown. A
 * corpse-light pools at the walls' feet and the gate and dies out by mid-height (glow bands over 40–50 %
 * of the height, spill-only wash lights, a low green mist hugging the curtain's foot); a few dim window
 * slits; the gate mouth burns. ONE tall tower (tower.ts):
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
    // S4 W5 fix round (the critic: no green haze round the walls): two thin, low layers hugging the outside
    // of the curtain's foot ≈ 0.08 over the ground (which rises from −0.33 at the south-west bastion to ≈ 0
    // before the gate), south-west → gate → south-east, inside the wash lights' reach
    { preset: 'mist', at: [-1.45, -0.25, 2.2], to: [0.15, 0.08, 3.2], rate: 0.3, scale: 0.45, color: 0xa6eebb },
    { preset: 'mist', at: [0.35, 0.08, 3.2], to: [1.3, 0.09, 2.6], rate: 0.3, scale: 0.45, color: 0xa6eebb },
    { preset: 'mist', at: [2.3, -0.75, 6.8], to: [-2.3, -6.3, 4.95], rate: 1.6, scale: 0.8, color: 0xb6f2c6 },
    { preset: 'mist', at: [-2.6, -7.2, 4.9], to: [-6.8, -9.6, 5.2], rate: 1.6, scale: 1.4, color: 0xb6f2c6 },
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
      fStop: 4,
      distanceKm: 14,
      elevationDeg: 6,
      azimuthDeg: 203,
      fov: 48,
      lift: 2.4,
      aimKm: [0.2, -1.8],
      tod: 21.0,
      dayOfYear: 78,
      compare: ['reference/film/minas-morgul/minas-morgul-gate-bridge-film.jpg', 'reference/concept-art/minas-morgul/nasmith-tower-of-the-moon.jpg'],
      note: 'night from the south (14 km): the dark citadel tiered against the mountain (the city ≈ 40 % of the silhouette) and its twisted tower filling the frame height with a little headroom, the corpse-light pooled at the walls\' feet and the burning gate (S4 W5), the lamp room the one strong light, the dark arched statue bridge leading in from the bottom third, kinked so its arches show; a March moon 55° up behind the camera (Frodo passed here on 10 March); Mount Doom, Barad-dûr and Cirith Ungol out of frame (right)',
    },
    {
      id: 'minas-morgul-wide',
      distanceKm: 30,
      elevationDeg: 2.5,
      azimuthDeg: 235,
      fov: 24,
      // (fix round: the frame lifted 0.4 — the spire's tip was tangent to the top edge)
      lift: -0.6,
      aimKm: [2.0, -3.5],
      tod: 21.0,
      dayOfYear: 78,
      compare: ['reference/concept-art/minas-morgul/nasmith-tower-of-the-moon.jpg'],
      note: 'night, low from the south-west up the Morgul vale (S4 W5: 30 km, 2.5°): the dark citadel on the left third on the vale\'s north wall, the tower\'s upper half and its lamp against the sky glow, the corpse-light pooled at the walls\' feet, the vale\'s gorge and the Morgulduin receding into the Ephel Dúath on the right; Mount Doom\'s glow just over the ridges at the top right',
    },
  ],
});
