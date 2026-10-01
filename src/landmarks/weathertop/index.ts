import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2 } from '../types.ts';
import { defineLandmark } from '../types.ts';

/**
 * Weathertop / Amon Sûl (research §3; the Fellowship still, Alan Lee, John Howe): a lone, steep hill at
 * the southern end of the Weather Hills, standing high over the lower hills and the East Road, its flanks
 * broken by bands of grey rock (#7a7a70) among slate-teal moss and scree, a bulging rock cap under a flat
 * crown, and on the crown the ring of the ruined watchtower — broken arches on their piers, gaps, pillar
 * stumps and fallen blocks; one campfire inside the ring.
 *
 * Local frame: x east, z south (heading 0), km round the display point; heights relative to the base
 * ground there (the plain falls gently to the south-east, the Weather Hills rise to the north-west). The
 * hill is a stamp: a steep massif ≈ 3.5 above the plain with short rocky shoulders (one running north-west
 * as a saddle into the Weather Hills), ridged roughness for the gullies, and its crown levelled (a flatten,
 * lowerOnly) for the ruin; the rock bands, the cap and the ruin are kit geometry seated on it.
 */

const DEG = Math.PI / 180;
/** the summit (local) and the crown's level (relative to the base ground at the origin) */
const TOP: V2 = [0, 0];
const SUMMIT = 3.45;
/** the crown: a level plateau this high (rel. base) and this wide, held by a steep rim */
const CROWN = 3.05;
const CROWN_R = 0.62;
/** the ring of the watchtower: radius, km */
const RING_R = 0.42;
/** compass bearing and radius round the summit → local */
const polar = (b: number, r: number): V2 => [TOP[0] + Math.sin(b * DEG) * r, TOP[1] - Math.cos(b * DEG) * r];

const STONE = 0x7a7a70;
const STONE2 = 0x6e6f66;
const ROCK = 0x6a6c64;

function buildWeathertop(k: ProxyKit): void {
  // ---------------------------------------------------------------- rock: the bulging cap under the crown's rim
  // ONE continuous outward-facing face (walked with decreasing bearing: the face looks to the right of the
  // walk = outward), its ends tapering into the slope where the path comes up from the north-west saddle
  const cap: V2[] = [];
  const hs: number[] = [];
  for (let b = 300; b >= -10; b -= 5) {
    cap.push(polar(b, CROWN_R + 0.04 + 0.03 * Math.sin(b * 0.11)));
    hs.push(0.26 + 0.08 * Math.sin(b * 0.07 + 1) + 0.04 * Math.sin(b * 0.31));
  }
  k.cliff('weathered', cap, hs, { color: ROCK, rough: 0.7, strata: 0.6, soft: 0.35, depth: 0.25, overhang: 0.07 });
  // outcrops on the flanks: clusters of big half-buried lumpy boulders (grey schist breaking through)
  const level = (y: number, b: number): number => {
    // the radius where the ground falls to local height y along bearing b
    const [dx, dz] = [Math.sin(b * DEG), -Math.cos(b * DEG)];
    let r = 0.4;
    while (r < 3 && k.ground(TOP[0] + dx * r, TOP[1] + dz * r) > y) r += 0.01;
    return r;
  };
  for (const [b0, y, n] of [
    [205, -0.7, 5],
    [245, -1.1, 4],
    [150, -0.9, 4],
    [180, -1.6, 4],
    [110, -1.3, 3],
    [280, -0.8, 3],
  ] as [number, number, number][]) {
    for (let i = 0; i < n; i++) {
      const b = b0 + (i - n / 2) * 6 + (k.r(1) - 0.5) * 4;
      const r = level(y + (k.r(2) - 0.5) * 0.25, b);
      const [x, z] = polar(b, r);
      k.rock('weathered', 0.06 + k.r(3) * 0.07, { at: [x, 0, z], seat: true, squash: 0.55, lump: 0.35, detail: 1, color: ROCK, shade: 0.85 + k.r(4) * 0.3, lod: 0 });
    }
  }

  // ---------------------------------------------------------------- the ruin on the crown
  const gy = (x: number, z: number) => k.ground(x, z);
  const N = 18;
  const piers: { p: V2; h: number }[] = [];
  for (let i = 0; i < N; i++) {
    const b = (i / N) * 360 + 6;
    const p = polar(b, RING_R);
    // pier heights: tall on the south and west (the face seen against the dusk), broken low elsewhere
    const tall = Math.cos((b - 220) * DEG);
    const h = Math.max(0.08, 0.2 + 0.13 * tall + 0.1 * (k.r(5) - 0.5));
    piers.push({ p, h });
  }
  for (let i = 0; i < N; i++) {
    const a = piers[i];
    const c = piers[(i + 1) % N];
    const b0 = (i / N) * 360 + 6;
    // gaps in the ring (fallen sections): a low rubble course only
    const gap = i === 3 || i === 7 || i === 8 || i === 13;
    const mid: V2 = [(a.p[0] + c.p[0]) / 2, (a.p[1] + c.p[1]) / 2];
    const yaw = (-Math.atan2(c.p[1] - a.p[1], c.p[0] - a.p[0]) * 180) / Math.PI;
    const len = Math.hypot(c.p[0] - a.p[0], c.p[1] - a.p[1]);
    if (gap) {
      k.box('weathered', len * 0.9, 0.02 + k.r(6) * 0.015, 0.04, { at: [mid[0], gy(mid[0], mid[1]) - 0.015, mid[1]], rot: [0, yaw, 0], color: STONE2, lod: 0 });
      continue;
    }
    // an arch between two piers where both still stand tall enough (its head broken off elsewhere)
    const h = Math.min(a.h, c.h);
    const arched = h > 0.17 && (b0 < 100 || b0 > 150);
    k.arcade('weathered', a.p, c.p, { count: 1, h: h + 0.05, archH: h, pier: 0.045, depth: 0.06, missing: arched ? [] : [0], color: i % 2 ? STONE : STONE2, lod: 1 });
  }
  // a tall broken fragment of the tower wall on the south-west, two empty windows
  {
    const p0 = polar(205, RING_R + 0.02);
    const p1 = polar(240, RING_R + 0.02);
    k.arcade('weathered', p0, p1, { count: 2, h: 0.46, archH: 0.34, pier: 0.06, depth: 0.07, missing: [1], color: STONE, lod: 1 });
  }
  // pillar stumps inside the ring and fallen blocks round it
  for (let i = 0; i < 7; i++) {
    const b = i * 51 + 25 + k.r(7) * 15;
    const [x, z] = polar(b, RING_R * 0.6);
    k.cylinder('weathered', 0.022, 0.025, 0.07 + k.r(8) * 0.09, { at: [x, 0, z], seat: true, seg: 7, color: STONE, lod: 0 });
  }
  k.scatter(
    { annulus: { at: TOP, r0: RING_R * 0.7, r1: RING_R * 1.2 } },
    14,
    (_i, x, z, u) => k.box('weathered', 0.035 + u * 0.03, 0.022 + u * 0.012, 0.026 + u * 0.016, { at: [x, 0.02, z], rot: [u * 20, u * 360, u * 15], seat: true, color: u > 0.5 ? STONE : STONE2, lod: 0 }),
    { minSpacing: 0.06 },
  );
  // the campfire in the ring: a small dark hearth and the fire
  const fire = polar(200, RING_R * 0.35);
  k.rock('weathered', 0.02, { at: [fire[0], 0.008, fire[1]], seat: true, squash: 0.5, detail: 0, color: 0x3a342c, lod: 0 });
  k.light([fire[0], gy(fire[0], fire[1]) + 0.025, fire[1]], { kind: 'fire', color: 0xff9a40, intensity: 1.8, radius: 0.02, flicker: 0.35 });
}

export default defineLandmark({
  id: 'weathertop',
  placeId: 'weathertop',
  tier: 'B',
  stamps: [
    // the hill: a steep massif with short rocky shoulders, a north-west saddle into the Weather Hills
    {
      kind: 'massif',
      at: TOP,
      radius: 3.0,
      summit: SUMMIT,
      base: -0.3,
      exponent: 1.35,
      dome: 0.55,
      spurs: [
        { azimuthDeg: 325, lengthKm: 2.6, widthKm: 1.0, heightFrac: 0.3, rootFrac: 0.62 },
        { azimuthDeg: 115, lengthKm: 2.2, widthKm: 0.9, heightFrac: 0.28, rootFrac: 0.6 },
        { azimuthDeg: 210, lengthKm: 2.0, widthKm: 0.9, heightFrac: 0.3, rootFrac: 0.62 },
        { azimuthDeg: 40, lengthKm: 1.9, widthKm: 0.8, heightFrac: 0.25, rootFrac: 0.58 },
      ],
      flankSlope: 2.0,
      rough: { amp: 0.28, scaleKm: 1.6, ridged: true },
      surface: 'rock',
    },
    // the crown: a level plateau for the ruin, held by a steep rim (raised where the body falls short,
    // cut where it stands higher)
    { kind: 'plateau', at: TOP, radius: CROWN_R, height: CROWN, rim: 0.35 },
    { kind: 'flatten', at: TOP, radius: CROWN_R, falloff: 0.3, height: CROWN, lowerOnly: true },
  ],
  lodPx: [70, 24],
  vegetationExclusion: [{ at: TOP, r: 2.2 }],
  proxy: buildWeathertop,
  annotation: { title: 'Weathertop', subtitle: 'Amon Sûl', blurb: 'Ruined watchtower of the old kingdom, where the Ringwraiths found Frodo.' },
  bookmarks: [
    {
      id: 'weathertop-close',
      distanceKm: 28,
      elevationDeg: -1.2,
      azimuthDeg: 150,
      fov: 12,
      lift: -0.2,
      // the camera stands below the crown so the ruin breaks the skyline: a silhouette shot with more sky
      expect: { sky: [0.2, 0.6] },
      tod: 19.6,
      compare: ['reference/film/weathertop/weathertop-ruin-fotr.png', 'reference/concept-art/weathertop/weathertop-alan-lee.jpg', 'reference/concept-art/weathertop/weathertop-horizon-john-howe.jpg'],
      note: 'hero (regional, 28 km): from the south-south-east, below the crown, at dusk (19.6: the sun setting to the west-north-west, rim-lighting the hill’s west face) — the lone steep hill with its rock bands standing at the south end of the lower Weather Hills, the broken ring of the watchtower jagged against the sky, the campfire spark on the crown',
    },
  ],
});
