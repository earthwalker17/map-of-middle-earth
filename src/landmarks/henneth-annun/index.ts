import { defineLandmark } from '../types.ts';

export default defineLandmark({
  id: 'henneth-annun',
  placeId: 'henneth-annun',
  tier: 'B',
  stamps: [{ kind: 'raise', at: [0, 1], radius: 2.2, amount: 1.4 }],
  proxy: (k) => {
    k.box('weathered', 1.6, 1.6, 0.6, { at: [0, 0, 0.4], tint: 0x7c7a70 });
  },
  waterFeatures: [{ kind: 'waterfall', path: [[0, 1.6, 0.1], [0, 0, -0.1]], width: 0.9 }],
  annotation: { title: 'Henneth Annûn', subtitle: 'The Window on the West', blurb: 'Hidden refuge of the Rangers of Ithilien behind a curtain of falling water.' },
});
