import { defineLandmark } from '../types.ts';

/** Isengard: the Ring of Isengard in Nan Curunír, with the black tower of Orthanc at its heart. */
export default defineLandmark({
  id: 'isengard',
  placeId: 'isengard',
  tier: 'A',
  // tallest proxies: barely grow in wide shots (they already out-top the ranges)
  wideBoost: { refKm: 160, max: 1.2 },
  stamps: [{ kind: 'flatten', at: [0, 0], radius: 8.5, falloff: 4, height: 'auto' }],
  proxy: (k) => {
    k.ring('darkStone', 7.4, 0.9, 2.0, { seg: 72, tint: 0x3a3836 });
    // Orthanc: four black piers fused into one tower, splitting into four horns
    for (const [x, z] of [
      [-0.45, -0.45],
      [0.45, -0.45],
      [-0.45, 0.45],
      [0.45, 0.45],
    ] as [number, number][]) {
      k.box('darkStone', 0.85, 11.5, 0.85, { at: [x, 0, z] });
      k.cone('darkStone', 0.32, 2.6, { at: [x * 1.35, 11.5, z * 1.35], rot: [z * 22, 0, -x * 22], seg: 4 });
    }
    k.box('darkStone', 1.4, 12.2, 1.4, {});
    // gate in the south of the ring
    k.box('metal', 1.2, 1.6, 1.0, { at: [0, 0, 7.4], tint: 0x444040 });
  },
  lights: [{ at: [0, 0.5, 3], color: 0xff6a1a, intensity: 6, radius: 8, kind: 'fire' }],
  emitters: [{ preset: 'smoke', at: [2, 0.2, 2], rate: 0.5, scale: 2 }],
  annotation: { title: 'Isengard', subtitle: 'Orthanc, the tower of Saruman', blurb: 'Within the great ring of stone stands Orthanc, unbreakable black spire of the White Wizard.' },
  bookmarks: [{ id: 'isengard-close', distanceKm: 45, elevationDeg: 12, azimuthDeg: 160, fov: 35, lift: 7, tod: 16 }],
});
