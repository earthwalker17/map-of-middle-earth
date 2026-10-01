import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2 } from '../records.ts';
import { defineLandmark } from '../types.ts';
import type { LocalStamp } from '../types.ts';
import { buildGate, G, GATE_STAMPS } from './gate.ts';

/**
 * Erebor, the Lonely Mountain (research §13): ONE massive mountain alone on the plain, with ridged
 * spurs — not a clay cone. The display position is the Front Gate at the southern foot, where the
 * River Running issues (places.json offset); the summit sits over the DEM summit, 8.7 km north
 * (azimuth summit → gate ≈ 197°).
 *
 * A broad, heavy, straight-sided body (radius 8 km, its top tenth blunted) standing above the ranges on
 * the northern horizon, with six long spurs whose shoulders hold three-quarters of its height near the
 * peak and run out long toward the plain, five shorter rib spurs between them on the faces, and a broad
 * shoulder peak on the west (the left of the Desolation of Smaug frame) — the heavy, snow-capped mountain
 * of the film (stamp snow caps; the ground look's lowered snow line). The gate valley between the
 * south-east arm (132°) and Ravenhill's south-west arm (238°) stays open — nothing within ~40° of the
 * gate line — so the river leaves the mountain down its own valley (it flows S then SE from the gate);
 * those two arms keep lower shoulders. Surface 'auto': the foothills keep their turf, the steep upper
 * mountain its rock.
 */
const SUMMIT_AT: [number, number] = [2.545, -8.348];
const DEG = Math.PI / 180;
/** a point `km` from the summit on compass bearing `b` (local x, z) */
const fromSummit = (b: number, km: number): [number, number] => [SUMMIT_AT[0] + Math.sin(b * DEG) * km, SUMMIT_AT[1] - Math.cos(b * DEG) * km];

const MASSIF: LocalStamp = {
  kind: 'massif',
  at: SUMMIT_AT,
  radius: 8,
  summit: 27.5,
  // the profile starts from the level of the plain around (the gate at the foot lies ~1 lower)
  base: 1.2,
  // a straight-sided pyramid rather than a concave witch's hat; the top blunted by SUMMIT_BLUNT
  exponent: 1.0,
  dome: 0.35,
  // the main spurs drop from the summit as arêtes to shoulders at three-quarters of the height
  // (rootFrac), then run out long and heavy toward the plain — broad shoulders either side of the peak;
  // the two arms of the gate valley keep lower roots so the valley stays open
  spurs: [
    { azimuthDeg: 18, lengthKm: 20, widthKm: 5, heightFrac: 0.42, rootFrac: 0.8 },
    { azimuthDeg: 78, lengthKm: 23, widthKm: 5.5, heightFrac: 0.46, rootFrac: 0.8 },
    // the eastern arm of the gate valley
    { azimuthDeg: 132, lengthKm: 21, widthKm: 5, heightFrac: 0.46, rootFrac: 0.68 },
    // Ravenhill's spur: the western arm of the gate valley, the watch-post near its end
    { azimuthDeg: 238, lengthKm: 23, widthKm: 5, heightFrac: 0.5, rootFrac: 0.68 },
    { azimuthDeg: 290, lengthKm: 20, widthKm: 5, heightFrac: 0.44, rootFrac: 0.8 },
    { azimuthDeg: 338, lengthKm: 17, widthKm: 4.5, heightFrac: 0.4, rootFrac: 0.78 },
    // ribs between them: shorter ridge spurs whose crests stand at a third to a half of the height on the
    // faces (never within 40° of the gate line, 197°)
    { azimuthDeg: 48, lengthKm: 13, widthKm: 3, heightFrac: 0.36, rootFrac: 0.72 },
    { azimuthDeg: 105, lengthKm: 14, widthKm: 3, heightFrac: 0.36, rootFrac: 0.72 },
    { azimuthDeg: 262, lengthKm: 13, widthKm: 3, heightFrac: 0.36, rootFrac: 0.72 },
    { azimuthDeg: 314, lengthKm: 12, widthKm: 3, heightFrac: 0.34, rootFrac: 0.72 },
    { azimuthDeg: 356, lengthKm: 12, widthKm: 3, heightFrac: 0.34, rootFrac: 0.7 },
  ],
  // steep flanks: ridged spurs with deep V valleys between them
  flankSlope: 2.3,
  rough: { amp: 1.2, scaleKm: 3.6, ridged: true },
  // the snow-capped upper mountain of the film: snow above 0.45 of the height on all but the sheerest
  // faces — the ribs' sheer faces break its edge into streaks (the ground look's lowered snow line adds
  // gully snow below it)
  snowCap: 0.45,
};

/** the top tenth blunted: a soft cut of the summit (the 12× relief made a needle of it) */
const SUMMIT_BLUNT: LocalStamp = { kind: 'flatten', at: SUMMIT_AT, radius: 0.5, falloff: 1.7, height: 25.2, lowerOnly: true, strength: 0.85 };

/**
 * The broad shoulder peak west of the summit (the left of the Desolation of Smaug frame): a lower
 * subsidiary summit at about 76 % of the height, 6.5 km out on the western shoulder (≈ 5 above the col
 * on the 290° spur's crest), with its own short ridges and snow.
 */
const SHOULDER: LocalStamp = {
  kind: 'massif',
  at: fromSummit(284, 6.5),
  radius: 4.6,
  summit: 1.2 + 0.76 * 26.3,
  base: 1.2,
  exponent: 0.95,
  dome: 0.7,
  spurs: [
    { azimuthDeg: 240, lengthKm: 5.5, widthKm: 2, heightFrac: 0.45, rootFrac: 0.85 },
    { azimuthDeg: 325, lengthKm: 5, widthKm: 2, heightFrac: 0.42, rootFrac: 0.85 },
    { azimuthDeg: 20, lengthKm: 4, widthKm: 2, heightFrac: 0.5, rootFrac: 0.9 },
  ],
  flankSlope: 2.6,
  rough: { amp: 0.7, scaleKm: 2.4, ridged: true, seed: 7 },
  snowCap: 0.62,
};

/**
 * Ravenhill (research §13): the ruined dwarf watch-post near the end of the south-western spur (238°
 * from the summit, Ravenhill's arm of the gate valley) — a squat octagonal tower on a bastion ring on
 * the crest, a watch-fire on its top. It stands on the spur's crest (z ≈ −2.2 here, ≈ 18.5, some 10.7
 * above the gate), levelled a little by the landmark's stamps.
 */
const RAVENHILL: V2 = [-11.4, -2.2];

function ravenhill(k: ProxyKit): void {
  const [x, z] = RAVENHILL;
  k.wallPath('stone', [
    [x - 0.28, z - 0.2],
    [x + 0.22, z - 0.3],
    [x + 0.34, z + 0.12],
    [x - 0.05, z + 0.34],
    [x - 0.34, z + 0.14],
  ], 0.12, 0.05, { closed: true, followGround: true, step: 0.08, color: 0x6b6e69, batter: 0.2, crenel: { w: 0.04, h: 0.035, gap: 0.03, lod: 0 }, lod: 1 });
  k.tower('stone', 0.14, 0.42, { at: [x, 0, z], seat: 'min', sides: 8, taper: 0.08, roof: 'crenel', color: 0x707773, lod: 1 });
  k.tower('stone', 0.07, 0.28, { at: [x + 0.18, 0, z - 0.1], seat: 'min', sides: 8, roof: 'none', color: 0x666964, lod: 0 });
  // tumbled blocks round the ruined post (LOD0)
  k.scatter(
    { annulus: { at: [x, z], r0: 0.38, r1: 0.7 } },
    10,
    (_i, rx, rz, u) => k.rock('weathered', 0.035 + u * 0.04, { at: [rx, 0, rz], seat: true, squash: 0.6, lump: 0.3, detail: 1, color: 0x6b6e69, lod: 0 }),
    { minSpacing: 0.12 },
  );
  // the watch-fire on the tower's top, inside its parapet (the tower is seated on the lowest ground
  // under its ring, sunk 0.02)
  let g = k.ground(x, z);
  for (let i = 0; i < 8; i++) g = Math.min(g, k.ground(x + Math.cos((i / 8) * Math.PI * 2) * 0.14, z + Math.sin((i / 8) * Math.PI * 2) * 0.14));
  k.light([x, g - 0.02 + 0.42 + 0.03, z], { kind: 'fire', color: 0xff9a40, intensity: 2.2, radius: 0.05, flicker: 0.35 });
}

/** Erebor, the Lonely Mountain: a lone massif with ridged spurs; the Front Gate guarded by carved kings. */
export default defineLandmark({
  id: 'erebor',
  placeId: 'erebor',
  tier: 'A',
  // the massif; the head of the gate valley, a level floor opening south (the river issues across it);
  // the gate court cut into the mountain's foot (gate.ts GATE_STAMPS, lowerOnly: they never raise) —
  // the terrain's sheer rock is the recess wall, the façade and the kings' plinths are let into it
  stamps: [
    MASSIF,
    SHOULDER,
    SUMMIT_BLUNT,
    { kind: 'flatten', at: [0, 2.2], radius: 2.4, falloff: 2.2, height: 0.2 },
    ...GATE_STAMPS,
    // Ravenhill's seat on the spur crest
    { kind: 'flatten', at: RAVENHILL, radius: 0.5, falloff: 0.45, height: 'auto', strength: 0.85 },
  ],
  // the gate court, and the Desolation of the Dragon on the plain before the gate (no scrub clumps)
  vegetationExclusion: [
    { at: G(0, 0.6), r: 2.6 },
    { at: [5, 9], r: 10 },
    { at: [-7, 13], r: 6 },
    { at: [25, -11], r: 3 },
  ],
  proxy: (k) => {
    buildGate(k);
    ravenhill(k);
  },
  annotation: { title: 'Erebor', subtitle: 'The Lonely Mountain', blurb: 'The great Dwarf-kingdom under the mountain, once held by the dragon Smaug.' },
  bookmarks: [
    {
      id: 'erebor-close',
      distanceKm: 62,
      // low over the plain: the summit stands well above the far ranges to the north (a higher camera
      // set the Grey Mountains' ridge level with the shoulders)
      elevationDeg: 3.5,
      azimuthDeg: 185,
      fov: 35,
      lift: 11,
      tod: 18.0,
      dayOfYear: 240,
      compare: ['reference/film/erebor/erebor-lonely-mountain-dos.jpg', 'reference/film/erebor/erebor-front-gate-statues.webp', 'reference/bigatures/erebor/erebor-front-gate-weta-mini.jpg'],
      note: 'golden evening (the prologue) from the south: the lone massif with its ridged spurs and snow cap in the last warm light, the Front Gate at its foot — the two kings flanking the carved façade, braziers burning — the River Running leaving it, the watch-fire on Ravenhill (the western spur)',
    },
    { id: 'erebor-wide', distanceKm: 140, elevationDeg: 6, azimuthDeg: 168, fov: 35, lift: 4, tod: 18.0, dayOfYear: 240, note: 'from the south over the Long Lake and Lake-town, Erebor alone on the northern plain, its summit clear of the far ranges' },
  ],
});
