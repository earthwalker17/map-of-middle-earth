import { defineLandmark } from '../types.ts';

/** Lake-town (Esgaroth): a timber town on stilts upon the Long Lake. */
export default defineLandmark({
  id: 'lake-town',
  placeId: 'lake-town',
  tier: 'A',
  anchor: 'water',
  proxy: (k) => {
    // piles + deck (local y = 0 is the lake surface)
    k.box('wood', 3.6, 0.12, 2.6, { at: [0, 0.18, 0], tint: 0x6a5238 });
    for (let i = 0; i < 26; i++) {
      const x = -1.6 + k.r(1) * 3.2;
      const z = -1.1 + k.r(2) * 2.2;
      const h = 0.25 + k.r(3) * 0.35;
      k.box('wood', 0.32, h, 0.28, { at: [x, 0.3, z], tint: 0x5a4632 });
      k.cone('wood', 0.26, 0.25, { at: [x, 0.3 + h, z], seg: 4, rot: [0, 45, 0], tint: 0x4a3a2c });
    }
    k.box('wood', 0.8, 0.6, 0.5, { at: [0, 0.3, 0], tint: 0x6e5438 });
    k.box('wood', 0.3, 0.1, 2.6, { at: [0, 0.16, -2.6], tint: 0x5a4632 });
  },
  night: { windows: 60, flicker: 0.4 },
  annotation: { title: 'Lake-town', subtitle: 'Esgaroth upon the Long Lake', blurb: 'A town of Men built out on the waters, in the shadow of the Lonely Mountain.' },
  bookmarks: [{ id: 'lake-town-close', distanceKm: 22, elevationDeg: 24, azimuthDeg: 200, fov: 35, tod: 17.2 }],
});
