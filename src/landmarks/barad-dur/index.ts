import { defineLandmark } from '../types.ts';

/** The Dark Tower: a black, buttressed spire crowned by two horns cradling the Eye. */
export default defineLandmark({
  id: 'barad-dur',
  placeId: 'barad-dur',
  tier: 'A',
  // tallest proxies: barely grow in wide shots (they already out-top the ranges)
  stamps: [{ kind: 'raise', at: [0, 0], radius: 9, amount: 2.5 }],
  proxy: (k) => {
    const segs = 9;
    let y = 0;
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const r0 = 3.6 * (1 - t * 0.78);
      const r1 = 3.6 * (1 - (t + 1 / segs) * 0.78);
      const h = 3.1 - t * 0.9;
      // (one segment count for every drum: alternating 8 / 12-gons left lit ledges at the seams)
      k.cylinder('darkStone', r1, r0, h, { at: [0, y, 0], seg: 12 });
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
    // the Eye (a slit of fire between the horns): always burning (the night-gated lamp default would
    // leave a dull red ball by day), a saturated fiery orange-red with a ring of hot flame tongues —
    // moderate strengths: AgX washes anything much brighter out to a pale peach
    k.sphere('emissive', 0.62, { at: [0, y + 2.4, 0], squash: 1.6, color: 0xff3a08, glow: { gate: 'always', strength: 1.1 } });
    for (let j = 0; j < 12; j++) {
      const a = ((j + 0.5) / 12) * Math.PI * 2;
      k.cone('emissive', 0.11, 0.5 + (j % 3) * 0.12, {
        at: [Math.cos(a) * 0.52, y + 2.4 + Math.sin(a) * 0.52 * 1.6, 0],
        rot: [0, 0, (a * 180) / Math.PI - 90],
        seg: 6,
        color: 0xff9a1a,
        glow: { gate: 'always', strength: 1.6 },
      });
    }
    k.sphere('lava', 0.2, { at: [0, y + 2.4, -0.55], squash: 2.4 });
  },
  lights: [{ at: [0, 26, 0], color: 0xff7a1f, intensity: 20, radius: 40, kind: 'eye' }],
  emitters: [{ preset: 'smoke', at: [0, 24, 0], rate: 0.3 }],
  lookOverride: 'mordor',
  annotation: { title: 'Barad-dûr', subtitle: 'The Dark Tower', blurb: 'Fortress of Sauron, its crown ever watchful with the lidless Eye.' },
  bookmarks: [{ id: 'barad-dur-close', distanceKm: 95, elevationDeg: 10, azimuthDeg: 210, fov: 32, lift: 12, tod: 17.8 }],
});
