import { defineLandmark } from '../types.ts';

export default defineLandmark({
  id: 'osgiliath',
  placeId: 'osgiliath',
  tier: 'B',
  // the city astride the Great River on a level floodplain: the valley walls of both banks are cut down
  // to a terrace at the Anduin's level + 0.4 (height is relative to the ground at the display point, the
  // channel's centre ≈ 1.6; the Anduin's level there is 1.93) out to 6.3 km — beyond the ruins on both
  // banks — easing back into the walls over 2.7 km; lowerOnly: the channel and the floodplain below the
  // terrace are never raised. The display point sits 3 km north of the Morgulduin's mouth, so the
  // tributary's last reach only touches the terrace's southern edge (the guard keeps its banks).
  // Osgiliath is not onRiver: the river guard keeps the channel and grades the terrace to the water, and
  // none of its stamps needs to touch the water
  stamps: [{ kind: 'flatten', at: [0, -1], radius: 6.3, falloff: 2.7, height: 0.7, lowerOnly: true }],
  proxy: (k) => {
    // broken bridge across the Anduin (east–west)
    for (let i = -4; i <= 4; i++) if (i !== 1) k.box('weathered', 0.8, 0.5, 0.5, { at: [i * 0.9, 0.4, 0], tint: 0xb8b2a4 });
    for (let i = 0; i < 40; i++) {
      const x = (k.r(1) > 0.5 ? 1 : -1) * (2.5 + k.r(2) * 3);
      const z = -3 + k.r(3) * 6;
      k.box('weathered', 0.35 + k.r(4) * 0.3, 0.2 + k.r(5) * 0.9, 0.35, { at: [x, k.ground(x, z) - 0.05, z], rot: [k.r(6) * 8, k.r(7) * 90, k.r(8) * 8], tint: 0xb0aa9c });
    }
  },
  annotation: { title: 'Osgiliath', subtitle: 'Citadel of the Stars', blurb: 'The ruined ancient capital of Gondor, straddling the Great River.' },
});
