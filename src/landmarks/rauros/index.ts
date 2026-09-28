import { defineLandmark } from '../types.ts';

export default defineLandmark({
  id: 'rauros',
  placeId: 'rauros',
  tier: 'B',
  proxy: (k) => {
    // Tol Brandir, the unclimbable island-pinnacle above the falls
    k.blob('weathered', 1.1, { at: [0.6, 1.8, -4.5], squash: 2.6, tint: 0x7a766e });
    // the Seat of Seeing on Amon Hen
    k.box('weathered', 0.3, 0.3, 0.3, { at: [-1.8, 0.8, 1.4], tint: 0x9a968c });
  },
  waterFeatures: [{ kind: 'waterfall', path: [[0, 1.5, 0], [0, 0, 0.6]], width: 3.5 }],
  annotation: { title: 'Rauros', subtitle: 'Falls of Rauros and Amon Hen', blurb: 'Where the Great River thunders over the falls, and the Fellowship was broken.' },
});
