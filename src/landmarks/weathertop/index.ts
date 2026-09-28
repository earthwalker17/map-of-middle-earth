import { defineLandmark } from '../types.ts';

export default defineLandmark({
  id: 'weathertop',
  placeId: 'weathertop',
  tier: 'B',
  stamps: [{ kind: 'cone', at: [0, 0], radius: 5.5, summit: 4.2, exponent: 1.5 }],
  proxy: (k) => {
    for (let i = 0; i < 14; i++) {
      if (i % 5 === 3) continue;
      const a = (i / 14) * Math.PI * 2;
      k.box('weathered', 0.28, 0.5 + k.r(1) * 0.5, 0.2, { at: [Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7], rot: [0, (-a * 180) / Math.PI, 0], tint: 0x8a8880 });
    }
  },
  annotation: { title: 'Weathertop', subtitle: 'Amon Sûl', blurb: 'Ruined watchtower of the old kingdom, where the Ringwraiths found Frodo.' },
});
