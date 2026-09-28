import { defineLandmark } from '../types.ts';
import type { ProxyKit } from '../kit/ProxyKit.ts';

function king(k: ProxyKit, x: number): void {
  const s = Math.sign(x);
  k.box('weathered', 1.8, 1.6, 1.8, { at: [x, 0, 0], tint: 0x9c968a });
  k.box('weathered', 1.2, 4.6, 0.9, { at: [x, 1.6, 0], tint: 0xaaa497 });
  k.box('weathered', 1.5, 1.0, 1.0, { at: [x, 5.6, 0], tint: 0xaaa497 });
  k.box('weathered', 0.6, 0.8, 0.6, { at: [x, 6.6, 0], tint: 0xb0aa9c });
  k.cone('weathered', 0.35, 0.6, { at: [x, 7.4, 0], seg: 6, tint: 0xb0aa9c });
  // raised LEFT hand (outer side), palm toward the north (upstream)
  k.box('weathered', 0.35, 2.8, 0.35, { at: [x - s * 0.95, 5.4, 0], rot: [0, 0, s * 18], tint: 0xa49e91 });
  // right hand holds an axe along the body
  k.box('weathered', 0.2, 3.4, 0.2, { at: [x + s * 0.8, 1.7, -0.2], tint: 0x8c8679 });
}

/** The Pillars of the Kings: Isildur and Anárion, left hands raised in warning, flanking the Anduin. */
export default defineLandmark({
  id: 'argonath',
  placeId: 'argonath',
  tier: 'A',
  stamps: [
    { kind: 'raise', at: [-6.5, 0], radius: 4.5, amount: 3.5 },
    { kind: 'raise', at: [6.5, 0], radius: 4.5, amount: 3.5 },
  ],
  proxy: (k) => {
    king(k, -3.4);
    king(k, 3.4);
  },
  annotation: { title: 'The Argonath', subtitle: 'The Pillars of the Kings', blurb: 'Two colossal kings of old guard the northern gate of Gondor upon the Great River.' },
  bookmarks: [{ id: 'argonath-close', distanceKm: 17, elevationDeg: 10, azimuthDeg: 0, fov: 38, tod: 15 }],
});
