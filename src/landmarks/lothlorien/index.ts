import { defineLandmark } from '../types.ts';

/** Caras Galadhon: the city of the Galadhrim in the golden mallorn trees. */
export default defineLandmark({
  id: 'lothlorien',
  placeId: 'lothlorien',
  tier: 'A',
  vegetationExclusion: 4,
  proxy: (k) => {
    const trees = 11;
    for (let i = 0; i < trees; i++) {
      const a = (i / trees) * Math.PI * 2;
      const r = i === 0 ? 0 : 1.2 + k.r(1) * 1.4;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = i === 0 ? 4.2 : 2.4 + k.r(2) * 1.2;
      k.cylinder('stone', 0.12, 0.22, h, { at: [x, 0, z], seg: 10, tint: 0xd9dde6 });
      k.blob('foliage', 0.9 + (i === 0 ? 0.4 : k.r(3) * 0.3), { at: [x, h, z], squash: 0.75, tint: 0xd6b85c });
      k.blob('foliage', 0.6, { at: [x, h * 0.7, z], squash: 0.7, tint: 0xc2a84c });
      k.cylinder('emissive', 0.35, 0.35, 0.05, { at: [x, h * 0.55, z], seg: 12 });
    }
  },
  night: { windows: 50, flicker: 0.02 },
  lookOverride: 'lorien',
  annotation: { title: 'Lothlórien', subtitle: 'Caras Galadhon', blurb: 'The golden wood of the Lady Galadriel, where no shadow falls.' },
  bookmarks: [{ id: 'lothlorien-close', distanceKm: 34, elevationDeg: 30, azimuthDeg: 240, fov: 35, tod: 17.8 }],
});
