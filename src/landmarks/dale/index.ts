import { defineLandmark } from '../types.ts';

export default defineLandmark({
  id: 'dale',
  placeId: 'dale',
  tier: 'B',
  proxy: (k) => {
    for (let i = 0; i < 22; i++) {
      const x = -1.2 + k.r(1) * 2.4;
      const z = -1 + k.r(2) * 2;
      const h = 0.25 + k.r(3) * 0.4;
      const y = k.ground(x, z) - 0.04;
      k.box('weathered', 0.3, h, 0.3, { at: [x, y, z], tint: 0xb4aa94 });
      k.cone('wood', 0.24, 0.22, { at: [x, y + h, z], seg: 4, rot: [0, 45, 0], tint: 0x6a5a4a });
    }
    k.cylinder('weathered', 0.2, 0.22, 1.4, { tint: 0xc0b6a0 });
  },
  annotation: { title: 'Dale', subtitle: 'City of Men below the Mountain', blurb: 'Once a merry town of bells and toys, laid waste by Smaug and rebuilt by Bard.' },
});
