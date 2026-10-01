import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2 } from '../records.ts';
import type { LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';

/**
 * Helm's Deep (research §11; the TTT wide still, the Weta miniature, Lee and Howe): a fortress plugging
 * the mouth of a gorge in the northern White Mountains (the Thrihyrne). Seen from the north over the
 * Deeping-coomb: the long, slightly curved, crenellated Deeping Wall across the mouth (the culvert at its
 * foot where the dry Deeping Stream left the gorge) runs from the Hornburg — a massive keep with a broad
 * tower on a sheer rock spur on the west side — across to the far cliff; the causeway ramp climbs along
 * the spur's foot to the Hornburg's gate; the gorge runs on south between sheer walls into the mountains.
 * Neutral cool-grey dressed stone (#8d8a84, shadows #4d4f53, lit #939295), 40 torches (fire, at night).
 *
 * Terrain: the display point sits at the north-east corner of a level upland block (+0…+1.5 over ~25 km,
 * falling 8–12 units to the Westfold north and east). Stamps (heights relative to the base ground at the
 * display point): the gorge walls as two scarps facing each other (massive, near-vertical faces with
 * broad, level tops — never needle peaks: the heights are ×12), the head of the gorge and the range
 * behind as broad, low-roughness ridges, the gorge floor carved a little (no river: the Deeping Stream is
 * dry), the coomb and the wall line levelled, the Hornburg's knoll a level spur with steep faces, the
 * causeway's embankment, Helm's Dike a low turfed bank across the coomb. Local frame: heading 0, x east,
 * z south.
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
  [0.45, -0.2],
  [0.45, 0.8],
  [0.35, 3.5],
  [0.15, 6.5],
  [-0.2, 9.5],
];
/** the Hornburg's knoll: its level top above the wall's foot (stamp height relative to the base ground) */
const SPUR_REL = 0.55;
const KNOLL: V2 = [-1.45, -0.6];
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
/** the Hornburg tower (centre), the round-fronted forebuilding, and the gate at the head of the causeway */
const TOWER: V2 = [-1.66, -0.62];
const FORE: V2 = [-1.2, -0.7];
const GATE: V2 = [-1.42, -1.17];
/**
 * The causeway's centre line: from the coomb north-west of the spur, rising along the foot of the knoll's
 * north-west face to the gate (≈ 12° at most; ramp heights are set in `build` from the ground at the foot
 * and the gate's level).
 */
const CAUSEWAY: V2[] = [
  [-3.3, -2.55],
  [-2.55, -1.95],
  [-1.9, -1.5],
  [-1.5, -1.3],
];
/** Helm's Dike across the coomb (two arms, broken where the road passes) */
const DIKE: V2[][] = [
  [
    [-2.6, -3.3],
    [-1.4, -3.75],
    [-0.25, -3.95],
  ],
  [
    [0.35, -3.95],
    [1.5, -3.8],
    [2.8, -3.35],
  ],
];

const STONE = 0x939290;
const STONE_LIT = 0x9e9d9c;
const ROCK = 0x5f6062;
const ROOF = 0x4d4f53;

const STAMPS: LocalStamp[] = [
  // the west wall of the gorge: a sheer face rising west from the Deep, a broad level top behind the
  // Hornburg, and short falloffs (the ends and the back are cliffs too: a massive block of mountain,
  // never a peak; its north end stands back from the spur, so the keep rises clear in front of it)
  {
    kind: 'scarp',
    path: [
      [-1.05, 0.35],
      [-0.85, 2.2],
      [-0.6, 5.0],
      [-0.8, 8.5],
      [-1.3, 11.0],
    ],
    height: 2.4,
    run: 0.7,
    side: 'right',
    plateauKm: 4.0,
    falloff: 0.45,
    rough: { amp: 0.12, scaleKm: 2.4 },
    surface: 'rock',
  },
  // the east wall: the far cliff the Deeping Wall runs into (taller: the ground behind it falls to the
  // Westfold)
  {
    kind: 'scarp',
    path: [
      [2.25, -0.75],
      [2.05, 1.8],
      [1.6, 5.0],
      [1.25, 8.5],
      [1.0, 11.0],
    ],
    height: 2.6,
    run: 0.7,
    side: 'left',
    plateauKm: 3.5,
    falloff: 0.45,
    rough: { amp: 0.12, scaleKm: 2.4 },
    surface: 'rock',
  },
  // the head of the gorge: a cliff closing it in the south, its top joining the two walls
  {
    kind: 'scarp',
    path: [
      [-4.5, 11.5],
      [-1.2, 12.2],
      [2.2, 12.0],
      [5.0, 11.2],
    ],
    height: 2.4,
    run: 0.8,
    side: 'right',
    plateauKm: 4.0,
    falloff: 0.6,
    rough: { amp: 0.15, scaleKm: 2.6 },
    surface: 'rock',
  },
  // the range behind (the Thrihyrne and the White Mountains' northern front): a long, heavy mountain wall
  // across the southern sky with a steep north face and broad tops
  {
    kind: 'scarp',
    path: [
      [-19, 16.0],
      [-9, 14.5],
      [-2, 15.5],
      [5, 14.8],
      [12, 15.3],
      [20, 16.5],
    ],
    height: 3.0,
    run: 1.4,
    side: 'right',
    plateauKm: 6,
    falloff: 3,
    rough: { amp: 0.25, scaleKm: 3.4 },
    surface: 'rock',
  },
  // the gorge: a dry floor between the walls, rising slowly to its head
  { kind: 'carve', path: GORGE, width: 1.0, depth: 0.45, falloff: 0.8 },
  // the Deeping-coomb before the wall: a smooth open floor falling gently north
  { kind: 'flatten', at: [0.1, -3.4], radius: 2.2, falloff: 1.8, height: -0.45, strength: 0.85 },
  // Helm's Dike: a low turfed bank across the coomb
  ...DIKE.map((path): LocalStamp => ({ kind: 'ridge', path, height: 0.12, halfWidth: 0.55, profile: 'round', surface: 'turf' })),
  // the causeway's embankment: a ridge of the spur's rock under the ramp, filling the dip of the coomb
  // (heights ≈ ramp line − ground; the kit fills the rest under the deck)
  { kind: 'ridge', path: CAUSEWAY, height: [0.0, 0.55, 0.36, 0.1], halfWidth: 0.6, profile: 'round', surface: 'rock' },
  // the Hornburg's knoll (steep-sided: the falloff is about one heightfield texel), then the wall line
  { kind: 'flatten', at: KNOLL, radius: 0.72, falloff: 0.3, height: SPUR_REL, surface: 'rock' },
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

/**
 * The causeway: a smooth stone ramp (no steps) rising evenly from `y0` at the first point to `y1` at the
 * last — one pitched deck slab per leg with a low parapet on the open (north-east) side, on an
 * embankment of the spur's rock (a ridge stamp), with rough masonry filling what the 0.4 km heightfield
 * leaves under the deck (columns 0.07 km apart, their tops inside the deck); the pale deck and parapet
 * draw the ramp's line. Returns the ramp height along the path (0..1).
 */
function causeway(k: ProxyKit, pts: V2[], y0: number, y1: number, width: number): (t: number) => [number, number, number] {
  const L: number[] = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = L[L.length - 1];
  const yAt = (s: number) => y0 + ((y1 - y0) * s) / total;
  const T = 0.05;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = L[i + 1] - L[i];
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    const ya = yAt(L[i]);
    const yb = yAt(L[i + 1]);
    const yaw = (-Math.atan2(dz, dx) * 180) / Math.PI;
    const pitch = (Math.atan2(yb - ya, len) * 180) / Math.PI;
    // the deck (a little longer than the leg, so the legs overlap at the bends)
    k.box('stone', len + width * 0.6, T, width, { at: [(ax + bx) / 2, (ya + yb) / 2 - T, (az + bz) / 2], rot: [0, yaw, pitch], color: STONE, shade: 1.02, grain: 0.15, lod: 1 });
    // the parapet on the open (left, north-east) side
    const [nx, nz] = [dz, -dx];
    const po = width / 2 - 0.012;
    k.box('stone', len + 0.02, 0.04, 0.022, { at: [(ax + bx) / 2 + nx * po, (ya + yb) / 2 - 0.004, (az + bz) / 2 + nz * po], rot: [0, yaw, pitch], color: STONE_LIT, lod: 0 });
    // the embankment under it
    const n = Math.max(1, Math.round(len / 0.07));
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const top = ya + (yb - ya) * t - T * 0.6;
      const corners: V2[] = [-1, 1].flatMap((u) => [-1, 1].map((v): V2 => [x + dx * u * (len / n) * 0.5 + -dz * v * width * 0.5, z + dz * u * (len / n) * 0.5 + dx * v * width * 0.5]));
      const g = Math.min(...corners.map(([cx, cz]) => k.ground(cx, cz))) - 0.02;
      if (top - g < 0.012) continue;
      k.box('weathered', len / n + 0.004, top - g, width * 0.97, { at: [x, g, z], rot: [0, yaw, 0], color: ROCK, grain: 0.45, lod: 0 });
    }
  }
  return (t: number) => {
    const s = t * total;
    let i = 1;
    while (i < pts.length - 1 && L[i] < s) i++;
    const f = (s - L[i - 1]) / Math.max(1e-9, L[i] - L[i - 1]);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, yAt(s), pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
  };
}

function build(k: ProxyKit): void {
  // ---- the Hornburg's knoll: a level rock platform (its faces rock down to the coomb), a sheer broken
  // rock face round its northern and eastern foot
  const knoll = k.ground(KNOLL[0], KNOLL[1]);
  const keepY = knoll + 0.06;
  const low = Math.min(...KEEP.map(([x, z]) => k.ground(x, z)));
  k.extrude('weathered', KEEP, keepY - low + 0.03, { at: [0, low - 0.03, 0], color: ROCK, shade: 1.0, grain: 0.5 });
  // walking from the gorge side round the knoll's end (the face looks right: outwards), a little outside
  const cxz: V2 = [-1.42, -0.59];
  const rim: V2[] = [5, 4, 3, 2, 1, 0, 7].map((i): V2 => [cxz[0] + (KEEP[i][0] - cxz[0]) * 1.08, cxz[1] + (KEEP[i][1] - cxz[1]) * 1.08]);
  k.cliff('weathered', rim, rim.map(([x, z]) => Math.max(0.14, (keepY - k.ground(x, z)) * 0.9)), { color: ROCK, rough: 0.5, strata: 0.45, depth: 0.25, soft: 0.3, taper: 0.2, overhang: 0.04 });

  // ---- the keep: a crenellated curtain round the platform's rim, corner towers, the Great Hall built
  // against the mountain side, the round-fronted forebuilding by the gate, the broad Hornburg tower
  const ring = KEEP.map(([x, z]): V2 => {
    const [cx, cz] = cxz;
    return [cx + (x - cx) * 0.93, cz + (z - cz) * 0.93];
  });
  k.wallPath('stone', ring, 0.26, 0.09, { at: [0, keepY - 0.02, 0], closed: true, color: STONE, batter: 0.15, shadeJitter: 0.05, crenel: { w: 0.035, h: 0.035, gap: 0.03, lod: 0 } });
  for (const i of [0, 2, 4, 6]) {
    const [x, z] = ring[i];
    k.tower('stone', 0.1, 0.38, { at: [x, keepY - 0.02, z], sides: 8, roof: 'crenel', color: STONE_LIT, lod: 0 });
  }
  k.house('stone', 'slate', 0.55, 0.3, 0.26, { at: [-1.78, keepY - 0.01, -0.28], rot: [0, 18, 0], seat: false, roof: 'gable', pitch: 36, color: STONE, roofColor: ROOF });
  // the forebuilding: a broad drum, round to the north (the film's keep mass beside the gate)
  k.tower('stone', 0.3, 0.52, { at: [FORE[0], keepY - 0.02, FORE[1]], sides: 20, roof: 'crenel', color: STONE, shade: 1.03 });
  k.house('stone', 'slate', 0.42, 0.34, 0.4, { at: [FORE[0] - 0.08, keepY - 0.01, FORE[1] + 0.32], rot: [0, 8, 0], seat: false, roof: 'hip', pitch: 30, color: STONE, roofColor: ROOF });
  // the Hornburg tower: broad and square, a battered foot, a short tapering shaft, a corbelled crown
  const [tx, tz] = TOWER;
  k.tower('stone', 0.42, 0.42, { at: [tx, keepY - 0.02, tz], sides: 4, rot: [0, 45, 0], taper: 0.08, roof: 'none', color: STONE });
  k.tower('stone', 0.36, 0.82, { at: [tx, keepY + 0.38, tz], sides: 4, rot: [0, 45, 0], taper: 0.1, roof: 'none', color: STONE_LIT });
  k.tower('stone', 0.36, 0.14, { at: [tx, keepY + 1.18, tz], sides: 4, rot: [0, 45, 0], roof: 'crenel', color: STONE_LIT });

  // ---- the Deeping Wall: thick, steeply battered, crenellated, its foot following the ground from the
  // keep's spur across the levelled mouth and up into the far cliff; a damp, darker foot course and a
  // pale string course below the walk (weathering bands)
  k.wallPath('stone', WALL, 0.38, 0.3, { followGround: true, step: 0.08, batter: 0.35, color: STONE, shadeJitter: 0.07, crenel: { w: 0.045, h: 0.05, gap: 0.035, lod: 0 } });
  const mid = Array.from({ length: 13 }, (_, i) => along(WALL, 0.05 + (0.7 * i) / 12));
  k.wallPath('stone', mid, 0.08, 0.33, { followGround: true, step: 0.08, color: 0x7a7976, lod: 0 });
  k.wallPath('stone', WALL, 0.3, 0.215, { followGround: true, step: 0.08, color: 0xa4a3a0, lod: 0 });
  // the culvert where the Deeping Stream left the gorge (one dark arch at the wall's foot)
  const cv = along(WALL, 0.48);
  k.box('darkStone', 0.13, 0.1, 0.36, { at: [cv[0], 0, cv[1]], seat: 'min', rot: [0, 6, 0], color: 0x1d1c1b });
  // the round tower where the wall meets the far cliff
  const [ex, ez] = WALL[WALL.length - 1];
  k.tower('stone', 0.15, 0.52, { at: [ex, 0, ez], seat: true, sides: 12, roof: 'crenel', color: STONE_LIT });
  // the inner parapet of the wall-walk (the south side), a lower rail
  k.wallPath('stone', WALL.map(([x, z]): V2 => [x, z + 0.11]), 0.44, 0.04, { followGround: true, step: 0.08, color: STONE, shade: 0.96, lod: 0 });

  // ---- the causeway: from the coomb up along the spur's foot to the gate, with the gate in the curtain
  const g0 = k.ground(CAUSEWAY[0][0], CAUSEWAY[0][1]);
  const ramp = causeway(k, CAUSEWAY, g0 + 0.02, keepY - 0.02, 0.13);
  // the gatehouse block in the north curtain (yaw along the wall), the dark gate in its outer face
  k.box('stone', 0.26, 0.33, 0.17, { at: [GATE[0], keepY - 0.02, GATE[1]], rot: [0, -11, 0], color: STONE_LIT, lod: 1 });
  k.box('darkStone', 0.1, 0.17, 0.04, { at: [GATE[0] + 0.196 * 0.08, keepY - 0.02, GATE[1] - 0.98 * 0.08], rot: [0, -11, 0], color: 0x2a2724 });

  // ---- scree and fallen blocks: angular, small, half-buried, at the foot of the knoll and along the
  // foot of the gorge walls
  const shard = (x: number, z: number, u: number, s: number) => {
    const w = s * (0.7 + k.r(1) * 0.6);
    const h = s * (0.45 + k.r(2) * 0.4);
    const d = s * (0.6 + k.r(3) * 0.6);
    const g = Math.min(k.ground(x - w / 2, z - d / 2), k.ground(x + w / 2, z + d / 2), k.ground(x, z));
    k.box('weathered', w, h, d, { at: [x, g - h * 0.45, z], rot: [(k.r(4) - 0.5) * 50, k.r(5) * 180, (k.r(6) - 0.5) * 50], color: ROCK, shade: 0.85 + u * 0.3, grain: 0.4, lod: 0 });
  };
  k.scatter(
    { polygon: [[-2.6, -1.75], [-0.6, -1.65], [-0.45, -1.05], [-2.45, -1.0]] },
    70,
    (_i, x, z, u) => shard(x, z, u, 0.016 + u * 0.016),
    { minSpacing: 0.05, avoid: [{ at: [-2.55, -1.95], r: 0.22 }, { at: [-1.9, -1.5], r: 0.2 }, { at: [-1.5, -1.3], r: 0.18 }] },
  );
  for (const side of [-1, 1]) {
    k.scatter(
      { polygon: side < 0 ? [[-0.95, 0.35], [-0.45, 0.35], [-0.35, 5.0], [-0.8, 5.0]] : [[1.55, 0.35], [2.05, 0.35], [1.85, 5.0], [1.35, 5.0]] },
      45,
      (_i, x, z, u) => shard(x, z, u, 0.018 + u * 0.02),
      { minSpacing: 0.12 },
    );
  }

  // ---- 40 torches (fire, lit at night only): along the wall's walk, round the keep, up the causeway
  const torch = { kind: 'fire' as const, gate: 'night' as const, color: 0xffae42, radius: 0.012, flicker: 0.5 };
  for (let i = 0; i < 18; i++) {
    const [x, z] = along(WALL, (i + 0.5) / 18);
    k.light([x, k.ground(x, z) + 0.43, z], { ...torch, intensity: 1.2 });
  }
  for (let i = 0; i < ring.length; i++) {
    const [x, z] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    k.light([(x + x1) / 2, keepY + 0.27, (z + z1) / 2], { ...torch, intensity: 1.2 });
    // on the corner towers' tops (even vertices) or on the curtain at the odd ones
    k.light([x, keepY + (i % 2 === 0 ? 0.42 : 0.3), z], { ...torch, intensity: 1.1 });
  }
  for (let i = 0; i < 4; i++) {
    const [x, y, z] = ramp((i + 0.5) / 4);
    k.light([x, y + 0.06, z], { ...torch, intensity: 1.1 });
  }
  k.light([tx, keepY + 1.37, tz], { ...torch, intensity: 1.4, radius: 0.015, flicker: 0.4 });
  k.light([GATE[0] - 0.12, keepY + 0.2, GATE[1] - 0.06], { ...torch, intensity: 1.3, radius: 0.014 });
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
      azimuthDeg: 18,
      fov: 22,
      lift: 2.5,
      tod: 8.0,
      compare: ['reference/film/helms-deep/helms-deep-wide-ttt.webp', 'reference/bigatures/helms-deep/helms-deep-weta-mini.png'],
      note: 'morning from the north-north-east over the Deeping-coomb: the curved Deeping Wall across the gorge mouth under the sheer walls of the Deep, the Hornburg keep and its broad tower on the spur (right), the causeway ramp, the gorge running into the mountains behind; the low sun from the east rakes across the wall',
    },
  ],
});
