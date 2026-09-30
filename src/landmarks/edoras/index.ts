import { defineLandmark } from '../types.ts';

export default defineLandmark({
  id: 'edoras',
  placeId: 'edoras',
  tier: 'B',
  // Meduseld's green hill standing alone on the plain before the White Mountains: display offset
  // (2, 5.5) km puts it on a natural knoll north of the Snowbourn, which runs past its southern foot
  // ~3 km out, between the hill and the mountain front. A broad, gentle raise (r 3.8, +2 over the knoll:
  // grassy flanks, not a rock cone) and a level crown at full strength, wider than the r 1.35 ring
  // (r 1.7 + 0.6 falloff), that carries Meduseld and its houses
  stamps: [
    { kind: 'raise', at: [0, 0], radius: 3.8, amount: 2.0 },
    { kind: 'flatten', at: [0, 0], radius: 1.7, falloff: 0.6, height: 'auto' },
  ],
  proxy: (k) => {
    k.box('wood', 1.2, 0.45, 0.45, { at: [0, 0, -0.3], tint: 0x7a5a38 });
    k.box('thatch', 1.25, 0.25, 0.5, { at: [0, 0.45, -0.3], tint: 0xe0b050 });
    k.ring('wood', 1.35, 0.1, 0.35, { tint: 0x6a4e30 });
    for (let i = 0; i < 12; i++) {
      const a = k.r(1) * Math.PI * 2;
      const r = 0.4 + k.r(2) * 0.8;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = k.ground(x, z) - 0.03;
      k.box('wood', 0.2, 0.16, 0.2, { at: [x, y, z], tint: 0x8a6a44 });
      k.cone('thatch', 0.16, 0.15, { at: [x, y + 0.16, z], seg: 4, rot: [0, 45, 0] });
    }
  },
  annotation: { title: 'Edoras', subtitle: 'Meduseld, the Golden Hall', blurb: 'Court of the Kings of Rohan upon its green hill below the White Mountains.' },
});
