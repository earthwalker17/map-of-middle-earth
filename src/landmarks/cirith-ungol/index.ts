import { defineLandmark } from '../types.ts';

export default defineLandmark({
  id: 'cirith-ungol',
  placeId: 'cirith-ungol',
  tier: 'B',
  headingDeg: 270,
  proxy: (k) => {
    k.box('darkStone', 1.0, 1.8, 1.0, {});
    k.box('darkStone', 0.7, 1.4, 0.7, { at: [0, 1.8, 0], rot: [0, 12, 0] });
    k.cone('darkStone', 0.45, 1.6, { at: [0, 3.2, 0], seg: 5 });
    k.box('lava', 0.12, 0.18, 0.05, { at: [0, 2.6, -0.37] });
  },
  lookOverride: 'mordor',
  annotation: { title: 'Cirith Ungol', subtitle: 'The Pass of the Spider', blurb: 'The secret stair into Mordor, watched by the Tower and haunted by Shelob.' },
});
