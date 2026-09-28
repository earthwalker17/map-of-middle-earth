import { defineLandmark } from '../types.ts';

export default defineLandmark({
  id: 'dol-guldur',
  placeId: 'dol-guldur',
  tier: 'B',
  stamps: [{ kind: 'raise', at: [0, 0], radius: 3.5, amount: 2.2 }],
  proxy: (k) => {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      k.box('darkStone', 0.4, 1.2 + k.r(1) * 2.2, 0.4, { at: [Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2], rot: [k.r(2) * 14 - 7, 0, k.r(3) * 14 - 7] });
    }
    k.box('darkStone', 0.9, 3.4, 0.9, { rot: [0, 0, 5] });
  },
  annotation: { title: 'Dol Guldur', subtitle: 'Hill of Sorcery', blurb: 'Ruined fortress in southern Mirkwood, lair of the Necromancer.' },
});
