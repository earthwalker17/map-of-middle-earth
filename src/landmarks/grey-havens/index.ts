import { defineLandmark } from '../types.ts';

export default defineLandmark({
  id: 'grey-havens',
  placeId: 'grey-havens',
  tier: 'B',
  proxy: (k) => {
    for (let i = 0; i < 6; i++) k.box('stone', 0.3, 0.3, 1.8, { at: [-1.5 + i * 0.6, 0, 0.8], tint: 0xe8e6e0 });
    k.cylinder('stone', 0.18, 0.22, 2.2, { at: [0.3, 0, -0.5], tint: 0xf4f2ee });
    k.cone('stone', 0.24, 0.6, { at: [0.3, 2.2, -0.5], tint: 0xf4f2ee });
  },
  annotation: { title: 'The Grey Havens', subtitle: 'Mithlond', blurb: 'Harbour of the Elves upon the Gulf of Lune, whence the last ships sail into the West.' },
});
