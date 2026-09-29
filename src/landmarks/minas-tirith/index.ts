import { defineLandmark } from '../types.ts';

/** The White City: seven tiers against Mindolluin, split by the great prow of rock pointing east. */
export default defineLandmark({
  id: 'minas-tirith',
  placeId: 'minas-tirith',
  tier: 'A',
  // the display position (places.json, offset (-4, 9.5)) sits on Mindolluin's eastern foot with the
  // snapped Anduin bend >= 14 km to the south and east: the plateau rim ends >= 2 km short of the river
  // ribbon (the guard's bank envelope never clips it) and the floodplain bench stays between the two
  stamps: [
    { kind: 'flatten', at: [5, 1], radius: 5, falloff: 3, height: 0, strength: 0.5 },
    { kind: 'plateau', at: [0, 0], radius: 7.4, rim: 2, height: 0.6 },
  ],
  proxy: (k) => {
    const tiers = 7;
    for (let i = 0; i < tiers; i++) {
      const r = 7.6 - i * 0.98;
      const top = 1.0 + i * 1.15;
      k.cylinder('stone', r, r * 1.02, top, { seg: 64, tint: i % 2 ? 0xf2efe6 : 0xe4dfd2 });
      k.ring('stone', r + 0.05, 0.28, top + 0.45, { seg: 64, tint: 0xfbf8f0 });
    }
    // the prow: a knife of rock from the citadel to the gate, pointing east (+x)
    k.box('weathered', 7.4, 8.2, 0.9, { at: [3.5, 0, 0], tint: 0xe8e2d4 });
    k.box('weathered', 3.2, 9.4, 0.8, { at: [1.6, 0, 0], tint: 0xefeae0 });
    // citadel and the White Tower of Ecthelion
    k.cylinder('stone', 1.5, 1.6, 8.9, { seg: 40, tint: 0xfdfbf6 });
    k.cylinder('stone', 0.32, 0.36, 5.8, { at: [0.3, 8.9, 0], tint: 0xffffff });
    k.cone('stone', 0.36, 1.4, { at: [0.3, 14.7, 0], tint: 0xffffff });
    // the great gate (east)
    k.box('darkStone', 0.3, 0.8, 0.9, { at: [7.7, 0.2, 0] });
    // houses on the tiers
    for (let i = 0; i < 90; i++) {
      const tier = Math.floor(k.r(1) * 6);
      const r = 7.3 - tier * 0.98 - k.r(2) * 0.5;
      const a = k.r(3) * Math.PI * 2;
      const h = 0.25 + k.r(4) * 0.35;
      k.box('stone', 0.35, h, 0.3, { at: [Math.cos(a) * r, 1.0 + tier * 1.15, Math.sin(a) * r], rot: [0, (-a * 180) / Math.PI, 0], tint: 0xece6da });
    }
  },
  lights: [{ at: [0, 15, 0], color: 0xfff1d6, intensity: 2, radius: 3, kind: 'beacon' }],
  night: { windows: 300, flicker: 0.1 },
  annotation: { title: 'Minas Tirith', subtitle: 'The White City of Gondor', blurb: 'Seven-tiered city of the kings, carved into the flank of Mount Mindolluin, facing the shadow in the east.' },
  bookmarks: [{ id: 'minas-tirith-close', distanceKm: 55, elevationDeg: 18, azimuthDeg: 110, fov: 35, tod: 7.5 }],
});
