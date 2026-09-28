import { defineLandmark } from '../types.ts';

export default defineLandmark({
  id: 'edoras',
  placeId: 'edoras',
  tier: 'B',
  stamps: [{ kind: 'raise', at: [0, 0], radius: 2.6, amount: 2.1 }],
  proxy: (k) => {
    k.box('wood', 1.2, 0.45, 0.45, { at: [0, 0, -0.3], tint: 0x7a5a38 });
    k.box('thatch', 1.25, 0.25, 0.5, { at: [0, 0.45, -0.3], tint: 0xe0b050 });
    k.ring('wood', 1.35, 0.1, 0.35, { tint: 0x6a4e30 });
    for (let i = 0; i < 12; i++) {
      const a = k.r(1) * Math.PI * 2;
      const r = 0.4 + k.r(2) * 0.8;
      k.box('wood', 0.2, 0.16, 0.2, { at: [Math.cos(a) * r, 0, Math.sin(a) * r], tint: 0x8a6a44 });
      k.cone('thatch', 0.16, 0.15, { at: [Math.cos(a) * r, 0.16, Math.sin(a) * r], seg: 4, rot: [0, 45, 0] });
    }
  },
  night: { windows: 15, flicker: 0.3 },
  annotation: { title: 'Edoras', subtitle: 'Meduseld, the Golden Hall', blurb: 'Court of the Kings of Rohan upon its green hill below the White Mountains.' },
});
