import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2 } from '../records.ts';
import type { EmitterDecl, LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';

/**
 * Isengard in the Two Towers (research §9; the TTT ring-and-Orthanc still, the Weta Orthanc miniature,
 * Howe): a perfect ring of dark rock (#101212, ⌀ 13 km, 1.35 km tall, battered, buttressed outside) with
 * ONE gate in the south, set in a basin levelled out of the floor of Nan Curunír at the foot of Methedras;
 * the Isen rises inside it and leaves under a culvert in the south-east. Orthanc at the centre: four
 * faceted piers fused round deep grooves, banded by ledges, tapering to a flat summit from which four
 * blade-like horns rise — obsidian (#141619) with a cool specular. Inside: bare dark mud, radial paved
 * roads, and the pits — sixteen forge shafts burning orange (fire lights, from dusk; dim glow by day) with
 * smoke vents (emitters, S4).
 *
 * Terrain: the display point is on the valley floor ~3 km west of the Isen's source; the valley walls rise
 * 4–10 units west and east within 6–8 km and Methedras +18…+22 north. The basin stamp levels a floor at the
 * ground of the display point (+0.35) out to the ring and blends back to the valley sides over 2.5 km; the
 * Isen corridor stays as baked (the river guard). Local frame: heading 0, x east, z south.
 */

const R = 6.5;
/** the ring wall: base thickness, top thickness, height */
const WALL = { t: 0.5, h: 1.35 };
/** compass bearing of the gate (south) and of the Isen's culvert (where the river crosses the ring) */
const GATE_B = 180;
const CULVERT_B = 145.4;
const RING = 0x5a5d60;
const RING_LIT = 0x646769;
/** Orthanc: total height to the horn tips, the summit platform height, the base half-diagonal */
const ORTHANC = { h: 7.6, top: 6.25, r: 0.78 };
const OBSIDIAN = 0x3a3e45;
const PIT_GLOW = 0x5a1c05;

/** local point at compass bearing b (deg), radius r from the centre */
function polar(b: number, r: number): V2 {
  const t = (b * Math.PI) / 180;
  return [Math.sin(t) * r, -Math.cos(t) * r];
}

/** the ring wall from bearing b0 to b1 (clockwise), as a followGround path */
function arcPath(b0: number, b1: number, step = 3): V2[] {
  const n = Math.max(2, Math.ceil((b1 - b0) / step));
  return Array.from({ length: n + 1 }, (_, i) => polar(b0 + ((b1 - b0) * i) / n, R));
}

/**
 * Orthanc's cross-section at scale 1: four faceted piers on the diagonals (a pushed-out corner between two
 * flank points) fused round deep grooves on the axes — 16 vertices, counter-clockwise from +x.
 */
function orthancSection(r: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < 4; i++) {
    const a = ((45 + 90 * i) * Math.PI) / 180;
    const at = (ang: number, rr: number): V2 => [Math.cos(ang) * rr, Math.sin(ang) * rr];
    out.push(at(a - 0.5, r * 0.84));
    out.push(at(a - 0.2, r * 0.97));
    out.push(at(a, r));
    out.push(at(a + 0.2, r * 0.97));
    out.push(at(a + 0.5, r * 0.84));
    // the groove on the axis between this pier and the next
    out.push(at(a + Math.PI / 4, r * 0.56));
  }
  return out;
}

/** the tower: the pier bundle tapering to the summit, ledge bands, the summit platform, four horns */
function buildOrthanc(k: ProxyKit): void {
  const y0 = k.ground(0, 0) - 0.08;
  const sec = orthancSection(ORTHANC.r);
  const H = ORTHANC.top;
  // the shaft: a slight flare at the foot, a near-straight taper to 64 % at the summit
  const lv = [0, 0.04, 0.12, 0.3, 0.5, 0.7, 0.88, 1];
  const scaleAt = (f: number) => 1.06 - 0.06 * Math.min(1, f / 0.04) - 0.36 * f;
  k.loft('obsidian', lv.map((f) => ({ outline: sec, y: H * f, scale: scaleAt(f) })), { at: [0, y0, 0], color: OBSIDIAN });
  // ledge bands (the storeys of the film tower): thin projecting collars of the same section
  for (const f of [0.16, 0.34, 0.52, 0.68, 0.82, 0.93]) {
    const s = scaleAt(f) * 1.05;
    k.loft(
      'obsidian',
      [
        { outline: sec, y: 0, scale: s },
        { outline: sec, y: 0.07, scale: s },
      ],
      { at: [0, y0 + H * f, 0], color: 0x2c2f35, lod: 0 },
    );
  }
  // vertical ribs up the piers' faces (the film tower's fluting), following the taper
  for (let i = 0; i < 4; i++) {
    for (const off of [-0.34, -0.12, 0.12, 0.34]) {
      const a = ((45 + 90 * i) * Math.PI) / 180 + off;
      const rr = ORTHANC.r * (Math.abs(off) > 0.3 ? 0.88 : 0.985);
      const [cx, cz] = [Math.cos(a) * rr, Math.sin(a) * rr];
      const [tx, tz] = [-Math.sin(a) * 0.022, Math.cos(a) * 0.022];
      const [nx, nz] = [Math.cos(a) * 0.035, Math.sin(a) * 0.035];
      const rib: V2[] = [
        [cx - tx - nx * 0.5, cz - tz - nz * 0.5],
        [cx + tx - nx * 0.5, cz + tz - nz * 0.5],
        [cx + tx + nx, cz + tz + nz],
        [cx - tx + nx, cz - tz + nz],
      ];
      k.loft('obsidian', [0.04, 0.5, 0.995].map((f) => ({ outline: rib, y: H * f, scale: scaleAt(f) })), { at: [0, y0, 0], color: 0x2a2d33, lod: 0 });
    }
  }
  // the summit platform's parapet and the four horns: tapering blades rising from the piers' corners,
  // leaning a little outwards, two of them (south-east, north-west) the tallest
  const sTop = scaleAt(1);
  const hornH = [1.35, 1.15, 1.35, 1.2];
  for (let i = 0; i < 4; i++) {
    const a = ((45 + 90 * i) * Math.PI) / 180;
    const rr = ORTHANC.r * sTop * 0.86;
    const [cx, cz] = [Math.cos(a) * rr, Math.sin(a) * rr];
    // a blade: long tangentially, thin radially (a flattened diamond), tapering to a point
    const blade = (w: number, d: number): V2[] => {
      const tx = -Math.sin(a);
      const tz = Math.cos(a);
      const rx = Math.cos(a);
      const rz = Math.sin(a);
      return [
        [tx * w, tz * w],
        [rx * d, rz * d],
        [-tx * w, -tz * w],
        [-rx * d, -rz * d],
      ];
    };
    const hh = hornH[i];
    const lean = 0.09;
    k.loft(
      'obsidian',
      [
        { outline: blade(0.2, 0.11).map(([x, z]): V2 => [x + cx, z + cz]), y: 0 },
        { outline: blade(0.17, 0.09).map(([x, z]): V2 => [x + cx * (1 + lean * 0.4), z + cz * (1 + lean * 0.4)]), y: hh * 0.45 },
        { outline: blade(0.1, 0.06).map(([x, z]): V2 => [x + cx * (1 + lean), z + cz * (1 + lean)]), y: hh * 0.8 },
        { outline: blade(0.012, 0.01).map(([x, z]): V2 => [x + cx * (1 + lean * 1.3), z + cz * (1 + lean * 1.3)]), y: hh },
      ],
      { at: [0, y0 + H - 0.02, 0], color: OBSIDIAN },
    );
  }
  // the stair to the door (south face) and the door's dark slot
  k.box('obsidian', 0.26, 0.1, 0.5, { at: [0, y0 + 0.05, ORTHANC.r * 0.75], color: 0x1e2024, lod: 0 });
  k.box('darkStone', 0.12, 0.22, 0.04, { at: [0, y0 + 0.15, ORTHANC.r * 0.62], color: 0x060607, lod: 0 });
}

/**
 * The Ring of Isengard: battered dark rock, level on the basin floor all the way round (where the Isen's
 * trench passes under it in the south-east the wall bridges it: the culvert), buttressed outside, open only
 * at the gate in the south (the wall carried over it as a lintel).
 */
function buildRing(k: ProxyKit): void {
  const g = 2.4; // gate gap half-angle, deg
  const floor = k.ground(0, 0);
  k.wallPath('darkStone', arcPath(GATE_B + g, GATE_B - g + 360), WALL.h, WALL.t, { at: [0, floor - 0.06, 0], batter: 0.3, color: RING, shadeJitter: 0.05 });
  // the gate: the wall carried over the opening as a lintel block, a dark tunnel under it
  const [x, z] = polar(GATE_B, R);
  const w = 2 * R * Math.sin(((g + 0.6) * Math.PI) / 180);
  k.box('darkStone', w, WALL.h - 0.45 + 0.02, WALL.t * 0.85, { at: [x, floor + 0.39, z], rot: [0, 180 - GATE_B, 0], color: RING });
  // buttresses round the outside every 7.5°: the regular segments of the film's ring (none over the
  // Isen's trench)
  for (let b = 3.75; b < 360; b += 7.5) {
    if (Math.abs(b - GATE_B) < 5 || Math.abs(b - CULVERT_B) < 7) continue;
    const [bx, bz] = polar(b, R + WALL.t * 0.42);
    k.box('darkStone', 0.2, WALL.h * 0.92, 0.26, { at: [bx, floor - 0.06, bz], rot: [0, 180 - b, 0], color: RING_LIT, lod: 0 });
  }
}

/**
 * Sixteen pits (compass bearing, radius from the tower): clear of the Isen's corridor in the east and of
 * the gate road, at least 1 km apart.
 */
const PITS: [number, number, number][] = (
  [
    [200, 2.6],
    [228, 4.5],
    [255, 2.5],
    [268, 5.1],
    [292, 3.5],
    [312, 5.2],
    [332, 2.4],
    [348, 4.6],
    [12, 3.3],
    [28, 5.4],
    [42, 2.2],
    [158, 2.3],
    [166, 4.4],
    [196, 4.8],
    [222, 2.0],
    [300, 1.9],
  ] as [number, number][]
).map(([b, r], i): [number, number, number] => [...polar(b, r), 0.2 + 0.12 * ((i * 7) % 5) / 4]);

/** the pits: forge shafts with a dark rim, a burning floor (dusk glow, dim by day) and a fire light */
function buildPits(k: ProxyKit): void {
  for (const [x, z, r] of PITS) {
    // the floor is level here (basin): set on the ground at the centre, sunk a little
    const g = k.ground(x, z);
    k.ring('darkStone', r + 0.03, 0.07, 0.07, { at: [x, g - 0.03, z], seg: 16, color: 0x1a1918, lod: 0 });
    k.cylinder('emissive', r, r, 0.03, { at: [x, g - 0.02, z], seg: 16, color: PIT_GLOW, glow: { gate: 'dusk', strength: 6 }, lod: 0 });
    k.light([x, k.ground(x, z) + 0.06, z], { kind: 'fire', color: 0xff7a1e, intensity: 1.6, radius: r * 0.5, flicker: 0.35 });
  }
}

/** pale paved roads across the mud: the gate road and three radials (the light lines of the film still) */
function buildRoads(k: ProxyKit): void {
  const road = (b: number, r0: number, r1: number, w: number) => {
    const [x0, z0] = polar(b, r0);
    const [x1, z1] = polar(b, r1);
    const nx = -(z1 - z0);
    const nz = x1 - x0;
    const l = Math.hypot(nx, nz) || 1;
    const [ox, oz] = [(nx / l) * (w / 2), (nz / l) * (w / 2)];
    k.extrude(
      'stone',
      [
        [x0 + ox, z0 + oz],
        [x1 + ox, z1 + oz],
        [x1 - ox, z1 - oz],
        [x0 - ox, z0 - oz],
      ],
      0.016,
      { at: [0, Math.min(k.ground(x0, z0), k.ground(x1, z1)) - 0.012, 0], color: 0x55585a, lod: 0 },
    );
  };
  road(180, 0.9, R - 0.2, 0.14);
  // the road on south from the gate down Nan Curunír towards the Fords of Isen (the straight line leaving
  // the gate in the film still), in short pieces that follow the falling valley floor
  for (let r = R + 0.3; r < R + 20; r += 0.5) road(180 + (r - R) * 0.35, r, r + 0.5, 0.12);
  for (const b of [0, 240, 300]) road(b, 1.0, R - 0.3, 0.08);
}

const STAMPS: LocalStamp[] = [
  // the floor of the ring levelled out of Nan Curunír (the Isen corridor stays as baked)
  { kind: 'basin', at: [0, 0], radius: R + 0.45, floor: 0.35, falloff: 2.5 },
];

/** smoke over five of the pits, steam over one (EffectsSystem, S4) */
const EMITTERS: EmitterDecl[] = [0, 2, 5, 9, 13, 11].map((i, n): EmitterDecl => ({ preset: n === 5 ? 'steam' : 'smoke', at: [PITS[i][0], 0.1, PITS[i][1]], rate: 0.6, scale: 1.5 }));

export default defineLandmark({
  id: 'isengard',
  placeId: 'isengard',
  tier: 'A',
  stamps: STAMPS,
  proxy: (k) => {
    buildRing(k);
    buildOrthanc(k);
    buildRoads(k);
    buildPits(k);
  },
  emitters: EMITTERS,
  vegetationExclusion: R + 1.2,
  contrast: 'dark',
  annotation: { title: 'Isengard', subtitle: 'Orthanc, the tower of Saruman', blurb: 'Within the great ring of stone stands Orthanc, unbreakable black spire of the White Wizard.' },
  bookmarks: [
    {
      id: 'isengard-close',
      distanceKm: 40,
      elevationDeg: 15,
      azimuthDeg: 172,
      fov: 26,
      lift: 3,
      // early afternoon: from ~15:00 the western valley wall (+12 within 10 km) throws the whole basin into
      // shade and the dark ring and tower go black; at 14:00 the sun stands over it from the south-west
      tod: 14.0,
      compare: ['reference/film/isengard/isengard-ring-orthanc-film.jpg', 'reference/bigatures/isengard/orthanc-weta-mini.jpg'],
      note: 'early afternoon from the south over Nan Curunír: the dark ring in its levelled basin, the gate facing us, Orthanc in the centre against the shoulder of Methedras, the pits burning; the sun from the south-west rakes across the ring and the tower',
    },
  ],
});
