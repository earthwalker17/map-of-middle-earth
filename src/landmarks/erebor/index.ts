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
 * A broad, heavy body (radius 8 km, a gently concave profile) standing well above the ranges on the
 * northern horizon, with six long spurs whose shoulders hold a third to a half of its height — the heavy,
 * snow-capped mountain of the film (a stamp snow cap above 0.7 of its height). The
 * gate valley between the south-east arm (132°) and Ravenhill's south-west arm (238°) stays open — nothing
 * within ~40° of the gate line — so the river leaves the mountain down its own valley (it flows S then SE
 * from the gate); those two arms are the highest, flanking the gate. Surface 'auto': the foothills keep
 * their turf, the steep upper mountain its rock.
 */
const SUMMIT_AT: [number, number] = [2.545, -8.348];

const MASSIF: LocalStamp = {
  kind: 'massif',
  at: SUMMIT_AT,
  radius: 8,
  summit: 27.5,
  // the profile starts from the level of the plain around (the gate at the foot lies ~1 lower)
  base: 1.2,
  exponent: 1.2,
  // a broad, heavy crown rather than a needle (12× exaggerated heights make any pointed peak a Matterhorn)
  dome: 0.6,
  // each spur drops from the summit as an arête to a shoulder at about two-thirds of the height
  // (rootFrac), then runs out long, heavy and slowly falling toward the plain (heightFrac halfway out)
  spurs: [
    { azimuthDeg: 18, lengthKm: 20, widthKm: 5, heightFrac: 0.35, rootFrac: 0.65 },
    { azimuthDeg: 78, lengthKm: 23, widthKm: 5.5, heightFrac: 0.36, rootFrac: 0.65 },
    // the eastern arm of the gate valley
    { azimuthDeg: 132, lengthKm: 21, widthKm: 5, heightFrac: 0.46, rootFrac: 0.66 },
    // Ravenhill's spur: the western arm of the gate valley, the watch-post near its end
    { azimuthDeg: 238, lengthKm: 23, widthKm: 5, heightFrac: 0.5, rootFrac: 0.66 },
    { azimuthDeg: 290, lengthKm: 20, widthKm: 5, heightFrac: 0.35, rootFrac: 0.64 },
    { azimuthDeg: 338, lengthKm: 17, widthKm: 4.5, heightFrac: 0.34, rootFrac: 0.64 },
  ],
  // steep flanks: ridged spurs with deep V valleys between them
  flankSlope: 2.3,
  rough: { amp: 1.0, scaleKm: 3.6, ridged: true },
  // the snow-capped upper mountain of the film: snow above 0.7 of the height on all but the sheerest faces
  snowCap: 0.7,
};

/**
 * Ravenhill (research §13): the ruined dwarf watch-post near the end of the south-western spur (238°
 * from the summit, Ravenhill's arm of the gate valley) — a squat octagonal tower on a bastion ring on
 * the crest, a watch-fire on its top.
 */
/** on the spur's crest (the crest runs along z ≈ −2.2 here, ≈ 18.5, some 10.7 above the gate) */
const RAVENHILL: V2 = [-11.4, -2.2];

function ravenhill(k: ProxyKit): void {
  // on the crest, levelled a little by the landmark's stamps
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
  k.light([x, k.ground(x, z) + 0.5, z], { kind: 'fire', color: 0xff9a40, intensity: 2.2, radius: 0.05, flicker: 0.35 });
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
    { kind: 'flatten', at: [0, 2.2], radius: 2.4, falloff: 2.2, height: 0.2 },
    ...GATE_STAMPS,
    // Ravenhill's seat on the spur crest
    { kind: 'flatten', at: RAVENHILL, radius: 0.5, falloff: 0.45, height: 'auto', strength: 0.85 },
  ],
  vegetationExclusion: [{ at: G(0, 0.6), r: 2.6 }],
  proxy: (k) => {
    buildGate(k);
    ravenhill(k);
  },
  annotation: { title: 'Erebor', subtitle: 'The Lonely Mountain', blurb: 'The great Dwarf-kingdom under the mountain, once held by the dragon Smaug.' },
  bookmarks: [
    {
      id: 'erebor-close',
      distanceKm: 62,
      elevationDeg: 6,
      azimuthDeg: 185,
      fov: 35,
      lift: 12,
      tod: 18.0,
      dayOfYear: 240,
      compare: ['reference/film/erebor/erebor-lonely-mountain-dos.jpg', 'reference/film/erebor/erebor-front-gate-statues.webp', 'reference/bigatures/erebor/erebor-front-gate-weta-mini.jpg'],
      note: 'golden evening (the prologue) from the south: the lone massif with its ridged spurs and snow cap in the last warm light, the Front Gate at its foot — the two kings flanking the carved façade, braziers burning — the River Running leaving it, the watch-fire on Ravenhill (the western spur)',
    },
    { id: 'erebor-wide', distanceKm: 140, elevationDeg: 6, azimuthDeg: 168, fov: 35, lift: 4, tod: 18.0, dayOfYear: 240, note: 'from the south over the Long Lake and Lake-town, Erebor alone on the northern plain, its summit clear of the far ranges' },
  ],
});
