import { defineLandmark } from '../types.ts';

const R = 22;
const SUMMIT = 23;
const CRATER = 2.4;
const EXP = 1.7; // concave profile: broad ash apron, steep upper cone

/** Orodruin: a steep volcanic cone rising from the ash plain of Gorgoroth, fire in its crater. */
export default defineLandmark({
  id: 'mount-doom',
  placeId: 'mount-doom',
  tier: 'A',
  stamps: [{ kind: 'cone', at: [0, 0], radius: R, summit: SUMMIT, exponent: EXP, craterRadius: 2.3, craterDepth: CRATER }],
  proxy: (k) => {
    // lava pool in the crater (local y = 0 is the crater floor)
    k.cylinder('lava', 1.7, 1.7, 0.25, { seg: 32 });
    // lava rivulets down the flanks
    for (let f = 0; f < 5; f++) {
      const a = f * 1.31 + 0.4;
      for (let i = 0; i < 9; i++) {
        const r0 = 2.2 + i * 0.9 + (f % 2) * 0.3;
        const wob = Math.sin(i * 1.7 + f) * 0.08;
        const ca = Math.cos(a + wob);
        const sa = Math.sin(a + wob);
        // sit on the stamped flank (k.ground), tilted along the local downhill slope
        const gy = (r: number) => k.ground(ca * r, sa * r);
        k.box('lava', 0.9, 0.12, 0.16, {
          at: [ca * r0, gy(r0) + 0.05, sa * r0],
          rot: [0, (-(a + wob) * 180) / Math.PI, -Math.atan((gy(r0 - 0.45) - gy(r0 + 0.45)) / 0.9) * 57.3],
        });
      }
    }
    // Sammath Naur: the fiery doorway on the east flank
    const rd = 6.5;
    k.box('darkStone', 0.8, 0.9, 0.6, { at: [rd, k.ground(rd, 0), 0] });
    k.box('lava', 0.3, 0.5, 0.35, { at: [rd + 0.33, k.ground(rd + 0.33, 0) + 0.05, 0] });
  },
  lights: [{ at: [0, 1, 0], color: 0xff4a12, intensity: 30, radius: 30, kind: 'lava' }],
  emitters: [
    { preset: 'smoke', at: [0, 1, 0], rate: 1, scale: 3 },
    { preset: 'ash', at: [0, 4, 0], rate: 0.6, scale: 6 },
    { preset: 'sparks', at: [0, 0.5, 0], rate: 0.4 },
  ],
  lookOverride: 'mordor',
  vegetationExclusion: 20,
  annotation: { title: 'Mount Doom', subtitle: 'Orodruin, the Mountain of Fire', blurb: 'Where the One Ring was forged — and the only place it can be unmade.' },
  bookmarks: [{ id: 'mount-doom-close', distanceKm: 110, elevationDeg: 8, azimuthDeg: 160, fov: 32, lift: -10, tod: 17.5 }],
});
