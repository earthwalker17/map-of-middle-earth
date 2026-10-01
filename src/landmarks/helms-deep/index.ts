import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';
import type { LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';

/**
 * Helm's Deep (research §11; the TTT wide still, the Weta miniature, Lee and Howe): a fortress plugging
 * the mouth of a gorge in the northern White Mountains (the Thrihyrne). Seen from the north over the
 * Deeping-coomb: the long, slightly curved, crenellated Deeping Wall across the mouth (the culvert at its
 * foot where the dry Deeping Stream left the gorge) runs from the Hornburg — a keep with a tall tower on a
 * rock spur on the west side — across to the far cliff; the causeway ramp climbs the spur to the
 * Hornburg's gate; the gorge runs on south between sheer walls into the mountains. Neutral cool-grey
 * dressed stone (#8d8a84, shadows #4d4f53, lit #939295), 40 torches (fire, from dusk).
 *
 * Terrain: the display point sits at the north-east corner of a level upland block (+0…+1.5 over ~25 km,
 * falling 8–12 units to the Westfold north and east). Stamps (heights relative to the base ground at the
 * display point): two mountain ridges rising south from the gorge mouth (the west one ending north in
 * the Hornburg's spur), a back ridge closing the gorge's head, the gorge floor carved between them (no
 * river: the Deeping Stream is dry), the wall line levelled. Local frame: heading 0, x east, z south.
 */

/** the Deeping Wall's centre line, west (at the Hornburg) to east (into the far cliff), bowed north */
const WALL: V2[] = [
  [-0.86, -0.42],
  [-0.4, -0.4],
  [0.25, -0.39],
  [0.9, -0.38],
  [1.5, -0.28],
  [2.05, -0.08],
];
/** the gorge axis (the dry stream bed), north → south */
const GORGE: V2[] = [
  [0.4, -1.5],
  [0.4, 0.5],
  [0.25, 3.5],
  [0.0, 6.5],
  [-0.4, 9.5],
];
/** the Hornburg's knoll: its level top above the wall's foot (stamp height relative to the base ground) */
const SPUR_REL = 0.55;
/** the Hornburg platform on the knoll (local plan) */
const KEEP: V2[] = [
  [-2.0, -0.95],
  [-1.55, -1.2],
  [-1.05, -1.1],
  [-0.8, -0.7],
  [-0.85, -0.22],
  [-1.25, -0.02],
  [-1.75, -0.08],
  [-2.08, -0.45],
];
/** the Hornburg tower (centre) and the gate at the head of the causeway */
const TOWER: V2 = [-1.62, -0.72];
const GATE: V2 = [-1.25, -1.16];
/** the causeway: from the gate down along the knoll's north face to the coomb floor (north-west) */
const CAUSEWAY: V2[] = [
  [-1.3, -1.25],
  [-1.75, -1.55],
  [-2.3, -1.95],
];

const STONE = 0x939290;
const STONE_LIT = 0x9e9d9c;
const STONE_DARK = 0x6d6c6a;
const ROCK = 0x5f6062;
const ROOF = 0x4d4f53;

const STAMPS: LocalStamp[] = [
  // the west mountain: from behind the Hornburg's knoll south-west up to the Thrihyrne
  {
    kind: 'ridge',
    path: [
      [-2.3, 0.5],
      [-2.4, 2.4],
      [-3.2, 5.2],
      [-4.2, 8.6],
      [-5.2, 12.0],
    ],
    height: [0.9, 2.5, 3.5, 4.1, 3.8],
    halfWidth: 3.0,
    profile: 'round',
    asym: 0.2,
    rough: { amp: 0.5, scaleKm: 2.0, ridged: true },
    surface: 'rock',
  },
  // the east mountain: the far cliff of the wall, rising south-east
  {
    kind: 'ridge',
    path: [
      [2.5, -0.7],
      [3.0, 1.8],
      [3.9, 5.0],
      [4.8, 8.6],
      [5.4, 12.0],
    ],
    height: [0.9, 2.4, 3.4, 3.9, 3.6],
    halfWidth: 3.0,
    profile: 'round',
    asym: -0.2,
    rough: { amp: 0.5, scaleKm: 2.0, ridged: true },
    surface: 'rock',
  },
  // the head of the gorge: the mountains close round it in the south
  {
    kind: 'ridge',
    path: [
      [-5.0, 12.0],
      [-1.2, 13.2],
      [2.2, 13.0],
      [5.4, 11.8],
    ],
    height: [3.9, 3.6, 3.6, 3.8],
    halfWidth: 3.0,
    profile: 'round',
    rough: { amp: 0.6, scaleKm: 2.4, ridged: true },
    surface: 'rock',
  },
  // the range behind (the Thrihyrne and the White Mountains' northern front): a long, broken mountain
  // wall across the southern sky
  {
    kind: 'ridge',
    path: [
      [-19, 17.5],
      [-9, 14.5],
      [-2, 16.0],
      [5, 15.0],
      [12, 15.5],
      [20, 18.0],
    ],
    height: [3.0, 4.3, 4.8, 4.6, 4.2, 3.0],
    halfWidth: 4.6,
    profile: 'round',
    rough: { amp: 1.2, scaleKm: 3.0, ridged: true },
    surface: 'rock',
  },
  // the gorge: a narrow dry floor between the walls, rising slowly to its head
  { kind: 'carve', path: GORGE, width: 0.9, depth: 1.0, falloff: 1.0 },
  // the Deeping-coomb before the wall: a smooth open floor falling gently north
  { kind: 'flatten', at: [0.1, -3.4], radius: 2.2, falloff: 1.8, height: -0.45, strength: 0.85 },
  // the Hornburg's knoll, then the wall line, each levelled
  { kind: 'flatten', at: [-1.45, -0.6], radius: 0.7, falloff: 0.45, height: SPUR_REL, surface: 'rock' },
  { kind: 'flatten', at: [0.6, -0.3], radius: 1.0, falloff: 0.6, height: 0 },
];

function along(path: V2[], t: number): V2 {
  const L: number[] = [0];
  for (let k = 1; k < path.length; k++) L.push(L[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]));
  const s = t * L[L.length - 1];
  let k = 1;
  while (k < path.length - 1 && L[k] < s) k++;
  const f = (s - L[k - 1]) / Math.max(1e-9, L[k] - L[k - 1]);
  return [path[k - 1][0] + (path[k][0] - path[k - 1][0]) * f, path[k - 1][1] + (path[k][1] - path[k - 1][1]) * f];
}

function build(k: ProxyKit): void {
  // ---- the Hornburg's knoll: a level rock platform (its faces rock down to the coomb), a broken rock
  // face round its northern and eastern foot
  const knoll = k.ground(-1.45, -0.6);
  const keepY = knoll + 0.06;
  const low = Math.min(...KEEP.map(([x, z]) => k.ground(x, z)));
  k.extrude('weathered', KEEP, keepY - low + 0.03, { at: [0, low - 0.03, 0], color: ROCK, shade: 1.08, grain: 0.5 });
  // walking from the gorge side round the knoll's end (the face looks right: outwards), a little outside
  const cxz: V2 = [-1.42, -0.59];
  const rim: V2[] = [5, 4, 3, 2, 1, 0].map((i): V2 => [cxz[0] + (KEEP[i][0] - cxz[0]) * 1.08, cxz[1] + (KEEP[i][1] - cxz[1]) * 1.08]);
  k.cliff('weathered', rim, rim.map(([x, z]) => Math.max(0.12, (keepY - k.ground(x, z)) * 0.72)), { color: ROCK, rough: 0.45, strata: 0.4, depth: 0.3, soft: 0.4, taper: 0.2 });

  // ---- the keep: a crenellated curtain round the platform's rim, corner towers, the Great Hall built
  // against the mountain side, the tall Hornburg tower
  const ring = KEEP.map(([x, z]): V2 => {
    const [cx, cz] = cxz;
    return [cx + (x - cx) * 0.93, cz + (z - cz) * 0.93];
  });
  k.wallPath('stone', ring, 0.26, 0.08, { at: [0, keepY - 0.02, 0], closed: true, color: STONE, batter: 0.1, shadeJitter: 0.05, crenel: { w: 0.035, h: 0.035, gap: 0.03, lod: 0 } });
  for (const i of [0, 2, 4, 6]) {
    const [x, z] = ring[i];
    k.tower('stone', 0.085, 0.38, { at: [x, keepY - 0.02, z], sides: 8, roof: 'crenel', color: STONE_LIT, lod: 0 });
  }
  k.house('stone', 'slate', 0.5, 0.26, 0.22, { at: [-1.75, keepY - 0.01, -0.25], rot: [0, 18, 0], seat: false, roof: 'gable', pitch: 38, color: STONE, roofColor: ROOF });
  k.house('stone', 'slate', 0.3, 0.22, 0.18, { at: [-1.2, keepY - 0.01, -0.28], rot: [0, 0, 0], seat: false, roof: 'hip', pitch: 32, color: STONE_DARK, roofColor: ROOF });
  // the Hornburg tower: square, buttressed at the foot, tapering, crenellated crown
  const [tx, tz] = TOWER;
  k.tower('stone', 0.24, 0.5, { at: [tx, keepY - 0.02, tz], sides: 4, rot: [0, 45, 0], roof: 'none', color: STONE });
  k.tower('stone', 0.19, 1.2, { at: [tx, keepY + 0.46, tz], sides: 4, rot: [0, 45, 0], taper: 0.12, roof: 'none', color: STONE_LIT });
  // the crown: a corbelled gallery a little wider than the shaft's top, crenellated
  k.tower('stone', 0.2, 0.16, { at: [tx, keepY + 1.64, tz], sides: 4, rot: [0, 45, 0], roof: 'crenel', color: STONE_LIT });

  // ---- the Deeping Wall: thick, battered, crenellated, its foot following the ground from the keep's
  // spur across the levelled mouth and up into the far cliff
  k.wallPath('stone', WALL, 0.38, 0.26, { followGround: true, step: 0.08, batter: 0.2, color: STONE, shadeJitter: 0.06, crenel: { w: 0.045, h: 0.05, gap: 0.035, lod: 0 } });
  // the culvert where the Deeping Stream left the gorge (a dark arch at the wall's foot)
  const cv = along(WALL, 0.48);
  k.box('darkStone', 0.16, 0.11, 0.3, { at: [cv[0], 0, cv[1]], seat: 'min', rot: [0, 6, 0], color: 0x1d1c1b });
  // buttresses along the wall's outer (north) face
  for (let t = 0.08; t < 0.95; t += 0.11) {
    const [x, z] = along(WALL, t);
    if (Math.abs(t - 0.48) < 0.04) continue;
    k.box('stone', 0.07, 0.3, 0.1, { at: [x, 0, z - 0.15], seat: 'min', color: STONE_DARK, lod: 0 });
  }
  // a stair up the inner face at the east end, the round tower where the wall meets the far cliff
  const [ex, ez] = WALL[WALL.length - 1];
  k.tower('stone', 0.13, 0.5, { at: [ex, 0, ez], seat: true, sides: 10, roof: 'crenel', color: STONE_LIT });

  // ---- the causeway: a ramp of dressed stone climbing the spur to the gate, parapet on the open side
  const g0 = keepY - 0.02;
  const path: V3[] = CAUSEWAY.map(([x, z], i) => [x, i === 0 ? g0 : i === CAUSEWAY.length - 1 ? Number.NaN : (g0 + k.ground(x, z)) / 2, z]);
  k.stairs('stone', path, 0.16, { stepKm: 0.05, color: STONE_DARK });
  k.box('stone', 0.12, 0.3, 0.2, { at: [GATE[0], keepY - 0.02, GATE[1]], color: STONE_LIT, lod: 1 });
  k.box('darkStone', 0.03, 0.18, 0.1, { at: [GATE[0] + 0.07, keepY - 0.02, GATE[1]], color: 0x2a2724 });

  // ---- the inner parapet of the wall-walk (the south side), a lower rail
  k.wallPath('stone', WALL.map(([x, z]): V2 => [x, z + 0.1]), 0.44, 0.04, { followGround: true, step: 0.08, color: STONE_DARK, lod: 0 });
  // ---- scree and fallen blocks at the foot of the knoll and along the gorge walls
  k.scatter(
    { polygon: [[-2.6, -1.8], [-0.6, -1.9], [-0.5, -1.1], [-2.5, -0.9]] },
    10,
    (_i, x, z, u) => k.rock('weathered', 0.05 + u * 0.06, { at: [x, 0, z], seat: true, squash: 0.7, lump: 0.3, color: ROCK, shade: 0.9 + u * 0.2, lod: 0 }),
    { minSpacing: 0.18, avoid: [CAUSEWAY.map(([x, z]): V2 => [x, z]).concat([[-2.4, -2.1], [-1.2, -1.0]])] },
  );
  for (const side of [-1, 1]) {
    k.scatter(
      { polygon: side < 0 ? [[-1.2, 0.4], [-0.5, 0.4], [-0.6, 5.0], [-1.4, 5.0]] : [[1.2, 0.4], [1.9, 0.4], [2.0, 5.0], [1.3, 5.0]] },
      9,
      (_i, x, z, u) => k.rock('weathered', 0.06 + u * 0.07, { at: [x, 0, z], seat: true, squash: 0.75, lump: 0.3, color: ROCK, shade: 0.85 + u * 0.25, lod: 0 }),
      { minSpacing: 0.3 },
    );
  }
  // ---- Helm's Dike: a low earth rampart across the coomb, broken where the road passes
  k.wallPath(
    'weathered',
    [
      [-2.6, -3.3],
      [-1.4, -3.75],
      [-0.25, -3.95],
    ],
    0.09,
    0.16,
    { followGround: true, step: 0.1, batter: 0.5, color: 0x6c6a52, lod: 0 },
  );
  k.wallPath(
    'weathered',
    [
      [0.35, -3.95],
      [1.5, -3.8],
      [2.8, -3.35],
    ],
    0.09,
    0.16,
    { followGround: true, step: 0.1, batter: 0.5, color: 0x6c6a52, lod: 0 },
  );

  // ---- 40 torches (fire, dusk): along the wall's walk, round the keep, up the causeway
  for (let i = 0; i < 18; i++) {
    const [x, z] = along(WALL, (i + 0.5) / 18);
    k.light([x, k.ground(x, z) + 0.43, z], { kind: 'fire', color: 0xffae42, intensity: 1.2, radius: 0.012, flicker: 0.5 });
  }
  for (let i = 0; i < ring.length; i++) {
    const [x, z] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    k.light([(x + x1) / 2, keepY + 0.27, (z + z1) / 2], { kind: 'fire', color: 0xffae42, intensity: 1.2, radius: 0.012, flicker: 0.5 });
    k.light([x, keepY + 0.3, z], { kind: 'fire', color: 0xffae42, intensity: 1.1, radius: 0.012, flicker: 0.5 });
  }
  for (let i = 0; i < 4; i++) {
    const [x, z] = along(CAUSEWAY, (i + 0.5) / 4);
    const y = g0 + (k.ground(x, z) - g0) * ((i + 0.5) / 4) + 0.06;
    k.light([x, y, z], { kind: 'fire', color: 0xffae42, intensity: 1.1, radius: 0.012, flicker: 0.5 });
  }
  k.light([tx, keepY + 1.86, tz], { kind: 'fire', color: 0xffae42, intensity: 1.4, radius: 0.015, flicker: 0.4 });
  k.light([GATE[0] + 0.1, keepY + 0.2, GATE[1] - 0.08], { kind: 'fire', color: 0xffae42, intensity: 1.3, radius: 0.014, flicker: 0.5 });
}

export default defineLandmark({
  id: 'helms-deep',
  placeId: 'helms-deep',
  tier: 'A',
  stamps: STAMPS,
  proxy: build,
  vegetationExclusion: [
    { at: [0.3, 1.5], r: 4.0 },
    { at: [0.0, -3.0], r: 3.0 },
  ],
  annotation: { title: "Helm's Deep", subtitle: 'The Hornburg', blurb: 'Fortress-refuge of the Rohirrim, where the Deeping Wall held against ten thousand.' },
  bookmarks: [
    {
      id: 'helms-deep-close',
      distanceKm: 21,
      elevationDeg: 6,
      azimuthDeg: 5,
      fov: 22,
      lift: 2.5,
      tod: 8.0,
      compare: ['reference/film/helms-deep/helms-deep-wide-ttt.webp', 'reference/bigatures/helms-deep/helms-deep-weta-mini.png'],
      note: 'morning from the north over the Deeping-coomb: the curved Deeping Wall across the gorge mouth, the Hornburg keep and tower on its spur (right), the causeway, the gorge running into the mountains behind; the low sun from the east rakes across the wall',
    },
  ],
});
