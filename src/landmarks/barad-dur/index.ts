import { defineLandmark } from '../types.ts';

/** The Dark Tower: a black, buttressed spire crowned by two horns cradling the Eye. */
export default defineLandmark({
  id: 'barad-dur',
  placeId: 'barad-dur',
  tier: 'A',
  stamps: [{ kind: 'raise', at: [0, 0], radius: 9, amount: 2.5 }],
  proxy: (k) => {
    const segs = 9;
    let y = 0;
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const r0 = 3.6 * (1 - t * 0.78);
      const r1 = 3.6 * (1 - (t + 1 / segs) * 0.78);
      const h = 3.1 - t * 0.9;
      k.cylinder('darkStone', r1, r0, h, { at: [0, y, 0], seg: 8 + (i % 2) * 4 });
      // buttresses / spikes around each drum
      const n = 8;
      for (let j = 0; j < n; j++) {
        const a = (j / n) * Math.PI * 2 + i * 0.3;
        k.cone('darkStone', 0.35 * (1 - t * 0.6), 1.6 - t, {
          at: [Math.cos(a) * r0 * 0.95, y + h * 0.4, Math.sin(a) * r0 * 0.95],
          rot: [Math.sin(a) * 18, 0, -Math.cos(a) * 18],
          seg: 6,
        });
      }
      y += h;
    }
    // the horns
    k.cone('darkStone', 0.45, 5.2, { at: [1.1, y - 0.5, 0], rot: [0, 0, -14], seg: 8 });
    k.cone('darkStone', 0.45, 5.2, { at: [-1.1, y - 0.5, 0], rot: [0, 0, 14], seg: 8 });
    // the Eye (a slit of fire between the horns)
    k.sphere('emissive', 0.62, { at: [0, y + 2.4, 0], squash: 1.6 });
    k.sphere('lava', 0.2, { at: [0, y + 2.4, -0.55], squash: 2.4 });
  },
  lights: [{ at: [0, 26, 0], color: 0xff7a1f, intensity: 20, radius: 40, kind: 'eye' }],
  emitters: [{ preset: 'smoke', at: [0, 24, 0], rate: 0.3 }],
  lookOverride: 'mordor',
  annotation: { title: 'Barad-dûr', subtitle: 'The Dark Tower', blurb: 'Fortress of Sauron, its crown ever watchful with the lidless Eye.' },
  bookmarks: [{ id: 'barad-dur-close', distanceKm: 70, elevationDeg: 12, azimuthDeg: 60, fov: 32, tod: 18.5 }],
});
