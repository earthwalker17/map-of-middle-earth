import { defineLandmark } from '../types.ts';

export default defineLandmark({
  id: 'bree',
  placeId: 'bree',
  tier: 'B',
  stamps: [{ kind: 'raise', at: [0.8, -0.6], radius: 2.2, amount: 1.2 }],
  proxy: (k) => {
    for (let i = 0; i < 16; i++) {
      const x = -1 + k.r(1) * 1.8;
      const z = -0.6 + k.r(2) * 1.6;
      const y = k.ground(x, z) - 0.04;
      k.box('wood', 0.28, 0.22, 0.24, { at: [x, y, z], tint: 0x8a7050 });
      k.cone('thatch', 0.22, 0.2, { at: [x, y + 0.22, z], seg: 4, rot: [0, 45, 0] });
    }
    k.ring('foliage', 1.5, 0.15, 0.25, { tint: 0x4f6a38 });
  },
  annotation: { title: 'Bree', subtitle: 'The Prancing Pony', blurb: 'Crossroads village of Men and Hobbits, where Strider waited in the corner.' },
});
