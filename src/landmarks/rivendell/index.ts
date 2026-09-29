import { defineLandmark } from '../types.ts';

/** Rivendell: the Last Homely House in the hidden valley of Imladris, pale halls amid autumn woods. */
export default defineLandmark({
  id: 'rivendell',
  placeId: 'rivendell',
  tier: 'A',
  // the cleft of Imladris: walls raised either side of the stream that runs ~1.7 km south of the house
  // (a carve along it would sink the banks below the baked water); the stream corridor stays as baked
  stamps: [
    { kind: 'raise', at: [0, -2.8], radius: 3.6, amount: 2.2 },
    { kind: 'raise', at: [0.5, 5.2], radius: 4, amount: 1.8 },
  ],
  proxy: (k) => {
    for (let i = 0; i < 16; i++) {
      const x = -3 + k.r(1) * 6;
      const z = -2.6 + k.r(2) * 1.2;
      const y = k.ground(x, z) - 0.05;
      const h = 0.35 + k.r(3) * 0.5;
      k.box('stone', 0.55, h, 0.4, { at: [x, y, z], tint: 0xeee4cf });
      k.cone('wood', 0.42, 0.35, { at: [x, y + h, z], seg: 4, rot: [0, 45, 0], tint: 0x8a5a3a });
    }
    k.cylinder('stone', 0.18, 0.2, 1.8, { at: [0.4, k.ground(0.4, -2.2), -2.2], tint: 0xf4ecd8 });
    for (let i = 0; i < 22; i++) {
      const x = -4 + k.r(7) * 8;
      const z = -3.2 + k.r(8) * 6;
      k.blob('foliage', 0.4 + k.r(6) * 0.3, { at: [x, k.ground(x, z) + 0.3, z], tint: k.r(9) > 0.5 ? 0xc2702f : 0xd9a441 });
    }
  },
  waterFeatures: [{ kind: 'waterfall', path: [[1.5, 2.5, -2.8], [1.4, 0, -2.4]], width: 0.25 }],
  night: { windows: 40, flicker: 0.05 },
  annotation: { title: 'Rivendell', subtitle: 'Imladris, the Last Homely House', blurb: 'The hidden refuge of Elrond Half-elven, where the Fellowship of the Ring was formed.' },
  bookmarks: [{ id: 'rivendell-close', distanceKm: 20, elevationDeg: 30, azimuthDeg: 200, fov: 35, lift: 0.9, tod: 17.5 }],
});
