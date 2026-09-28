import { defineLandmark } from '../types.ts';

/** The West-gate of Moria: the Doors of Durin in a sheer cliff by the dark lake, two holly trees. */
export default defineLandmark({
  id: 'moria',
  placeId: 'moria',
  tier: 'A',
  headingDeg: 270,
  stamps: [{ kind: 'raise', at: [0, 2.8], radius: 4, amount: 3 }],
  proxy: (k) => {
    // cliff face behind the doors (local -z faces west)
    k.box('weathered', 5.5, 5, 1.6, { at: [0, -0.5, 1.1], tint: 0x6d6a66 });
    // the doors: dark recess framed by a pale arch (ithildin glow comes with the effects pass)
    k.box('darkStone', 1.4, 2.2, 0.2, { at: [0, 0.2, 0.32] });
    k.torus('weathered', 0.75, 0.07, { at: [0, 2.35, 0.28], rot: [90, 0, 0], tint: 0xc8d4dc });
    // holly trees flanking the gate
    for (const x of [-1.2, 1.2]) {
      k.cylinder('wood', 0.07, 0.1, 0.8, { at: [x, 0, 0] });
      k.blob('foliage', 0.55, { at: [x, 1.2, 0], squash: 1.4, tint: 0x6a8a58 });
    }
  },
  annotation: { title: 'Moria', subtitle: 'The Doors of Durin', blurb: 'Speak, friend, and enter — the hidden West-gate of Khazad-dûm, greatest of the Dwarf-halls.' },
  bookmarks: [{ id: 'moria-close', distanceKm: 20, elevationDeg: 14, azimuthDeg: 262, fov: 35, tod: 18.9 }],
});
