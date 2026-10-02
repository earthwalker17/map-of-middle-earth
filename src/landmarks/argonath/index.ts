import type { V2, V3 } from '../records.ts';
import { defineLandmark } from '../types.ts';
import type { LocalStamp } from '../types.ts';
import { kingTS } from './king.ts';

/**
 * The Argonath — the Pillars of the Kings: two colossal robed kings on pedestals at the water's edge on
 * both banks of the Anduin, at the gate of a gorge, facing upstream, each raising the LEFT hand palm outward
 * in warning, the right gripping a long axe; the west king bearded under a crowned helm, the east king in a
 * full helm with a face guard. Local frame: heading 15° (the river runs in from the NNE here, so the kings
 * face it); x = across the river (east bank +x), −z = upstream.
 *
 * The kings are a Blender-built GLB (tools/blender/argonath.py → public/models/argonath.glb: one shared body
 * and two head variants, `crown` and `helm`, picked per instance); the TS kit v2 figure (king.ts) stays the
 * fallback one edit away (`USE_GLB`).
 *
 * The gorge (S3 phase 2): the natural valley is steepened into two walls facing each other across the water
 * — scarps whose faces rise right behind the pedestals (the landmark is `onRiver`: the stamps may stand at
 * the channel's edge inside its 6 km footprint; the channel itself is never stamped) — and kit rock faces
 * seated at their foot, so the kings stand IN rock at the gate rather than on open banks. Upstream the walls
 * taper out before the river bends (the boats' approach and the hero low pass stay open); downstream they
 * open onto Nen Hithoel.
 */
const USE_GLB = true;

const HEADING = 15;
/** nominal waterline at the kings, local y (river level ≈ 4.93 vs the origin ground 4.64) */
const WATER_Y = 0.3;
/** king frame origins (pedestal axis at the waterline), local km */
const KINGS: { at: V3; variant: 'crown' | 'helm' }[] = [
  { at: [-2.35, WATER_Y, 0], variant: 'crown' },
  { at: [2.35, WATER_Y, 0], variant: 'helm' },
];
/** the film's greenish statue stone (lit #52554f, shade #35413f) and the browner gorge rock (#5b5649) */
const STONE = 0x80847b;
const PLINTH = 0x6f6a5c;
const ROCK = 0x837c6c;

/**
 * Gorge walls (local km, walking downstream): the scarp face lines run just outside the pedestals and the
 * channel core (the water ribbon reaches x ≈ ±2.9 here), the plateaus fall back over ~3 km. The west bank is
 * lower in the bake (≈ 3.5 at 5 km out vs ≈ 7 on the east), so it gets the larger lift. Upstream both faces
 * turn away from the water into buttresses facing the approach (beyond the 6 km footprint the river guard
 * would clamp a wall standing at the bank).
 */
const WEST_FACE: V2[] = [
  [-5.0, -4.2],
  [-3.8, -2.8],
  [-3.6, -1.4],
  [-3.7, 0.4],
  [-4.1, 2.0],
  [-4.9, 3.4],
  [-6.2, 4.6],
];
const EAST_FACE: V2[] = [
  [4.6, -4.2],
  [3.4, -2.8],
  [3.3, -1.4],
  [3.75, 0.4],
  [4.0, 2.0],
  [4.6, 3.4],
  [5.8, 4.6],
];

const STAMPS: LocalStamp[] = [
  { kind: 'scarp', path: WEST_FACE, side: 'right', height: 3.6, run: 1.1, plateauKm: 1.0, falloff: 1.2, rough: { amp: 0.4, scaleKm: 1.8, ridged: true, seed: 3 }, surface: 'rock' },
  { kind: 'scarp', path: EAST_FACE, side: 'left', height: 2.6, run: 1.1, plateauKm: 1.0, falloff: 1.2, rough: { amp: 0.4, scaleKm: 1.8, ridged: true, seed: 5 }, surface: 'rock' },
];

export default defineLandmark({
  id: 'argonath',
  placeId: 'argonath',
  tier: 'A',
  headingDeg: HEADING,
  stamps: STAMPS,
  proxy: (k) => {
    // the sheer walls of the gorge: faceted rock faces standing from under the water (base fixed below the
    // river level, not draped on the bank) up to about the scarp rim, their bodies sloping back into the
    // stamped walls, from the scarps' upstream buttresses (the east one wraps the bank the hero low pass
    // looks along on its left) to just past the kings, ending inside the stamped walls — the kings stand in
    // rock (a cliff faces the right of its walking direction: the west face walks upstream, the east
    // downstream). Tried and dropped: faces on down the low lake shores (they stood free as thin sunlit fins
    // seen from Rauros and hid behind the near walls from the low pass), taller faces (their backs poked out
    // of the walls as fins) and faces draped on the banks (tall paper-thin panels in the low pass). The
    // landmark bounds (a square of the bounds radius) must also stay clear of the hero low pass camera.
    const west: { at: V2; h: number }[] = [
      { at: [-4.4, 2.0], h: 5.1 },
      { at: [-4.0, 0.4], h: 5.5 },
      { at: [-3.9, -1.4], h: 5.1 },
      { at: [-4.1, -2.8], h: 4.1 },
    ];
    const east: { at: V2; h: number }[] = [
      { at: [5.3, -4.7], h: 3.9 },
      { at: [4.6, -3.8], h: 4.7 },
      { at: [3.7, -2.8], h: 4.6 },
      { at: [3.6, -1.4], h: 5.1 },
      { at: [4.05, 0.4], h: 5.5 },
      { at: [4.3, 2.0], h: 5.1 },
    ];
    const face = { at: [0, -0.45, 0] as V3, followGround: false, depth: 1.0, rough: 0.28, strata: 0.4, soft: 0.4, color: ROCK };
    k.cliff('weathered', west.map((q) => q.at), west.map((q) => q.h), face);
    k.cliff('weathered', east.map((q) => q.at), east.map((q) => q.h), { ...face, shade: 0.97 });
    const walls = [west.map((q) => q.at).filter(([, z]) => z > -3 && z < 4), east.map((q) => q.at).filter(([, z]) => z > -3 && z < 4)];
    // fallen blocks and boulders along the water's edge below the walls (hero range only): each marched
    // from the wall's foot line towards the river to where the bank meets the water, clear of the pedestals
    for (const [side, path] of [[-1, walls[0]], [1, walls[1]]] as [number, V2[]][]) {
      for (let i = 0; i < 16; i++) {
        const t = (i + 0.5 + 0.6 * (k.r(side * 100 + i) - 0.5)) / 16;
        const f = t * (path.length - 1);
        const j = Math.min(path.length - 2, Math.floor(f));
        const q = f - j;
        let x = path[j][0] + (path[j + 1][0] - path[j][0]) * q;
        const z = path[j][1] + (path[j + 1][1] - path[j][1]) * q;
        if (Math.abs(z) < 1.3) continue;
        for (let m = 0; m < 30 && k.ground(x, z) > 0.75; m++) x -= side * 0.1;
        x -= side * 0.15 * k.r(side * 200 + i);
        k.rock('weathered', 0.08 + 0.1 * k.r(side * 300 + i), { at: [x, 0, z], seat: true, squash: 0.7, color: ROCK, shade: 0.9, lod: 0 });
      }
    }
    if (!USE_GLB) for (const kg of KINGS) kingTS(k, { at: kg.at, variant: kg.variant, stone: STONE, plinth: PLINTH });
  },
  ...(USE_GLB
    ? {
        model: {
          file: 'argonath.glb',
          // one body twice, NOT mirrored (both raise the left hand: the film / the book), each with its own helm
          instances: KINGS.map((kg) => ({ at: kg.at, node: kg.variant })),
          boundsKm: { r: 1.42, h: 7.12 },
        },
      }
    : {}),
  annotation: { title: 'The Argonath', subtitle: 'The Pillars of the Kings', blurb: 'Two colossal kings of old guard the northern gate of Gondor upon the Great River.' },
  bookmarks: [
    {
      // the Fellowship passed the Argonath on 25 February (the Tale of Years): a late-winter afternoon sun
      // stands low in the south-west (bearing ≈ 240°, 11° up at 16:00) — behind the kings, just off the
      // right edge, for a camera upstream looking downstream (bearing 204°): rim light and a warm sky. (On
      // the default summer day the sun is due west at 16:30–17:00, side light.)
      id: 'argonath-close',
      fStop: 4,
      distanceKm: 12,
      elevationDeg: -6,
      azimuthDeg: 24,
      fov: 40,
      lift: 3.8,
      tod: 16,
      dayOfYear: 56,
      note: 'the low pass: on the Anduin 12 km upstream (NNE), ≈ 2 above the water, looking downstream up at the kings between the gorge walls, backlit by the low late-winter sun; both raised hands clear of the top edge',
    },
    { id: 'argonath-wide', distanceKm: 45, elevationDeg: 13, azimuthDeg: 22, fov: 35, lift: 3, tod: 16, dayOfYear: 56, note: 'the gate of the gorge from upstream, low enough to see the walls in profile: the kings between the rock faces, Nen Hithoel opening beyond into the haze' },
  ],
});
