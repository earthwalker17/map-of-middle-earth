import { defineLandmark } from '../types.ts';

/** Helm's Deep: the Deeping Wall across the mouth of the gorge and the Hornburg on its spur. */
export default defineLandmark({
  id: 'helms-deep',
  placeId: 'helms-deep',
  tier: 'A',
  stamps: [
    { kind: 'raise', at: [0, 3.5], radius: 7, amount: 4 },
    { kind: 'carve', path: [[-0.2, -1.2], [0, 2.5], [0.6, 6]], width: 1.4, depth: 3.5, falloff: 1.6 },
  ],
  proxy: (k) => {
    // the Deeping Wall (across the mouth, facing north)
    k.wall('weathered', [-2.4, -0.6], [-0.6, -0.9], 1.5, 0.45, { tint: 0xa7a193 });
    k.wall('weathered', [-0.6, -0.9], [1.6, -0.7], 1.5, 0.45, { tint: 0xa7a193 });
    // the Hornburg: keep + tower on the rock spur to the east
    k.box('weathered', 1.6, 2.4, 1.4, { at: [2.3, 0, -0.4], tint: 0xb2ab9c });
    k.cylinder('weathered', 0.5, 0.6, 4.4, { at: [2.6, 0, -0.9], seg: 16, tint: 0xbab3a3 });
    k.cone('wood', 0.62, 0.9, { at: [2.6, 4.4, -0.9], seg: 16 });
    // the causeway ramp to the gate
    k.box('weathered', 0.5, 0.5, 2.2, { at: [1.6, 0, -1.8], rot: [-12, 0, 0], tint: 0x9d978a });
  },
  lights: [{ at: [2, 3, -1], color: 0xff9a3c, intensity: 3, radius: 4, kind: 'fire' }],
  night: { windows: 20, flicker: 0.4 },
  annotation: { title: "Helm's Deep", subtitle: 'The Hornburg', blurb: 'Fortress-refuge of the Rohirrim, where the Deeping Wall held against ten thousand.' },
  bookmarks: [{ id: 'helms-deep-close', distanceKm: 24, elevationDeg: 20, azimuthDeg: 20, fov: 35, tod: 6.8 }],
});
