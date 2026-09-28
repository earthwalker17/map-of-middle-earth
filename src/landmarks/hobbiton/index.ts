import { defineLandmark } from '../types.ts';

/** Hobbiton: the Hill with Bag End, the Party Tree, the mill and the Water. */
export default defineLandmark({
  id: 'hobbiton',
  placeId: 'hobbiton',
  tier: 'A',
  stamps: [{ kind: 'raise', at: [0, -0.4], radius: 2.4, amount: 1.5 }],
  proxy: (k) => {
    // round doors of hobbit-holes on the south face of the Hill
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.15 + 0.7 * (i / 8));
      const r = 1.2 + (i % 3) * 0.35;
      k.cylinder('wood', 0.09, 0.09, 0.04, { at: [Math.cos(a) * r, 0.45 + (i % 3) * 0.25, Math.sin(a) * r * 0.6], rot: [90, 0, 0], tint: i === 4 ? 0x2e5a2a : 0x8a3a2a });
    }
    // the Party Tree
    k.cylinder('wood', 0.12, 0.2, 0.9, { at: [1.6, 0, 1.3] });
    k.blob('foliage', 0.75, { at: [1.6, 1.25, 1.3], squash: 0.8, tint: 0x5a8a3a });
    // the mill by the Water
    k.box('wood', 0.5, 0.45, 0.4, { at: [-1.8, 0, 1.9], tint: 0x9a8060 });
    k.cylinder('wood', 0.25, 0.25, 0.08, { at: [-1.5, 0.25, 2.1], rot: [0, 0, 90] });
    // garden hedges
    for (let i = 0; i < 14; i++) k.blob('foliage', 0.18 + k.r(1) * 0.1, { at: [-2 + k.r(2) * 4.2, 0.1, -1 + k.r(3) * 3.2], squash: 0.7, tint: 0x4f7a34 });
  },
  night: { windows: 30, flicker: 0.3 },
  annotation: { title: 'Hobbiton', subtitle: 'The Shire', blurb: 'Where the journey begins: Bag End, under the Hill, home of Bilbo and Frodo Baggins.' },
  bookmarks: [{ id: 'hobbiton-close', distanceKm: 10, elevationDeg: 18, azimuthDeg: 190, fov: 35, tod: 16.5 }],
});
