import { defineLandmark } from '../types.ts';

/** Minas Morgul: the corrupted Tower of the Moon, glowing with a pale sickly light. */
export default defineLandmark({
  id: 'minas-morgul',
  placeId: 'minas-morgul',
  tier: 'A',
  headingDeg: 270,
  // the tower stands on the vale's northern spur (display offset) on a pad that carries the whole walled
  // ring (r 2.4); the Morgulduin runs in the vale ~4 km below it, clear of the pad
  stamps: [{ kind: 'flatten', at: [0, 0], radius: 2.6, falloff: 0.7, height: 'auto' }],
  proxy: (k) => {
    k.ring('weathered', 2.4, 0.35, 1.6, { seg: 40, tint: 0x8a9a92 });
    let y = 0;
    for (let i = 0; i < 7; i++) {
      const w = 1.8 - i * 0.22;
      const h = 1.8;
      k.box('weathered', w, h, w, { at: [0, y, 0], rot: [0, i * 11, 0], tint: 0x9aaaa2 });
      k.box('emissiveGreen', w * 0.6, 0.1, w + 0.02, { at: [0, y + h * 0.6, 0], rot: [0, i * 11, 0] });
      y += h;
    }
    k.cone('weathered', 0.5, 3.4, { at: [0, y, 0], seg: 4, tint: 0xa8b8b0 });
    k.sphere('emissiveGreen', 0.3, { at: [0, y + 1.2, 0] });
    // the bridge over the Morgulduin, facing west (local -z)
    k.box('weathered', 0.7, 0.25, 3.2, { at: [0, 0.4, -3.9], tint: 0x8a9a92 });
  },
  lights: [{ at: [0, 13, 0], color: 0x9cf0b4, intensity: 8, radius: 12, kind: 'magic' }],
  lookOverride: 'mordor',
  annotation: { title: 'Minas Morgul', subtitle: 'The Tower of Sorcery', blurb: 'Once Minas Ithil, Tower of the Rising Moon — now the stronghold of the Nazgûl.' },
  bookmarks: [{ id: 'minas-morgul-close', distanceKm: 45, elevationDeg: 14, azimuthDeg: 265, fov: 35, lift: 8, tod: 18.4 }],
});
