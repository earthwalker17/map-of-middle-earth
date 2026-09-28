import { defineLandmark } from '../types.ts';

export default defineLandmark({
  id: 'osgiliath',
  placeId: 'osgiliath',
  tier: 'B',
  proxy: (k) => {
    // broken bridge across the Anduin (east–west)
    for (let i = -4; i <= 4; i++) if (i !== 1) k.box('weathered', 0.8, 0.5, 0.5, { at: [i * 0.9, 0.4, 0], tint: 0xb8b2a4 });
    for (let i = 0; i < 40; i++) {
      const x = (k.r(1) > 0.5 ? 1 : -1) * (2.5 + k.r(2) * 3);
      const z = -3 + k.r(3) * 6;
      k.box('weathered', 0.35 + k.r(4) * 0.3, 0.2 + k.r(5) * 0.9, 0.35, { at: [x, k.ground(x, z) - 0.05, z], rot: [k.r(6) * 8, k.r(7) * 90, k.r(8) * 8], tint: 0xb0aa9c });
    }
  },
  annotation: { title: 'Osgiliath', subtitle: 'Citadel of the Stars', blurb: 'The ruined ancient capital of Gondor, straddling the Great River.' },
});
