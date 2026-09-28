import { defineLandmark } from '../types.ts';

/** The Morannon: a black wall of iron and stone closing Cirith Gorgor, flanked by the Towers of the Teeth. */
export default defineLandmark({
  id: 'black-gate',
  placeId: 'black-gate',
  tier: 'A',
  stamps: [{ kind: 'flatten', at: [0, -2], radius: 7, falloff: 4, height: 'auto', strength: 0.8 }],
  proxy: (k) => {
    k.wall('darkStone', [-8, 0], [-1.3, 0], 4.2, 1.1);
    k.wall('darkStone', [1.3, 0], [8, 0], 4.2, 1.1);
    // the two gate leaves
    k.box('metal', 1.25, 5.2, 0.6, { at: [-0.63, 0, -0.2], tint: 0x5a5550 });
    k.box('metal', 1.25, 5.2, 0.6, { at: [0.63, 0, -0.2], tint: 0x5a5550 });
    // spikes along the parapet
    for (let x = -7.6; x <= 7.6; x += 0.55) if (Math.abs(x) > 1.4) k.cone('metal', 0.1, 0.8, { at: [x, 4.2, 0], seg: 5 });
    // the Towers of the Teeth
    for (const s of [-1, 1]) {
      k.cylinder('darkStone', 0.8, 1.1, 8.5, { at: [s * 5.2, 0, -1.6], seg: 8 });
      k.cone('darkStone', 1.0, 2.6, { at: [s * 5.2, 8.5, -1.6], seg: 8 });
      k.box('emissive', 0.12, 0.3, 0.05, { at: [s * 5.2, 7.2, -2.45] });
    }
  },
  lookOverride: 'dagorlad',
  annotation: { title: 'The Black Gate', subtitle: 'The Morannon', blurb: 'The iron gates of Mordor, guarding the pass of Cirith Gorgor.' },
  bookmarks: [{ id: 'black-gate-close', distanceKm: 45, elevationDeg: 14, azimuthDeg: 0, fov: 35, tod: 9 }],
});
