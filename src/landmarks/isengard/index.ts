import { valueNoise } from '../../core/rng.ts';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2 } from '../records.ts';
import type { EmitterDecl, LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';

/**
 * Isengard in the Two Towers (research §9; the TTT ring-and-Orthanc still, the Weta Orthanc miniature,
 * Howe): a perfect ring of dark rock (⌀ 13 km, 1.35 km tall, battered, buttressed outside, a broad walk
 * with a parapet on top) with ONE gate in the south, set in a basin levelled out of the floor of Nan
 * Curunír at the foot of Methedras. Orthanc at the centre: four faceted piers with sharp vertical edges
 * fused round deep grooves, tapering to a flat summit from which four thin blade-like horns rise, splayed
 * outwards and serrated on their inner edges — obsidian with a cool specular. Inside: a dark, mottled floor
 * of ash and mud, pale paved radial roads, scattered workshop sheds, and the pits — sixteen ragged forge
 * shafts with charred spoil rims burning orange (fire lights, from dusk; a dull glow by day) with smoke
 * vents (emitters, S4). The road leaves the gate south down the valley towards the Fords of Isen.
 *
 * Terrain: the display point is on the valley floor ~3 km west of the Isen's source; the valley walls rise
 * 4–10 units west and east within 6–8 km and Methedras +18…+22 north. The Isen rises INSIDE the ring (its
 * baked source at local (4.5, −2.5), level +1.16) and leaves it in the south-east (bearing ≈ 146°), so the
 * place is `onRiver` (places.json): the basin stamp levels the whole floor above the river's water
 * (+1.3) — the river runs hidden under it, as in a culvert (the film's floor has no river) — and blends
 * back down to the valley over 5 km, so the Isen comes out where the floor falls below its water again,
 * ~5 km south of the ring (at the foot of the apron before the gate). Local frame: heading 0, x east,
 * z south.
 */

const R = 6.5;
/** the ring wall: base thickness, height */
const WALL = { t: 0.62, h: 1.35 };
/** the floor of the basin, relative to the base ground at the display point (above the Isen's source) */
const FLOOR = 1.3;
/** compass bearing of the gate (south) */
const GATE_B = 180;
/** dark rock of the ring */
const RING = 0x404245;
const RING_LIT = 0x4a4c4f;
/** Orthanc: total height to the horn tips, the summit platform height, the base half-diagonal, the turn */
const ORTHANC = { top: 6.25, r: 0.8, turnDeg: -30 };
const OBSIDIAN = 0x383c43;
const PIT_GLOW = 0x5a1c05;
const ROAD = 0x9c998f;

/** local point at compass bearing b (deg), radius r from the centre */
function polar(b: number, r: number): V2 {
  const t = (b * Math.PI) / 180;
  return [Math.sin(t) * r, -Math.cos(t) * r];
}

/** the ring wall from bearing b0 to b1 (clockwise) */
function arcPath(r: number, b0: number, b1: number, step = 3): V2[] {
  const n = Math.max(2, Math.ceil((b1 - b0) / step));
  return Array.from({ length: n + 1 }, (_, i) => polar(b0 + ((b1 - b0) * i) / n, r));
}

/**
 * Orthanc's cross-section at scale 1: four piers (a sharp corner between two flank facets — the facets
 * either side of the corner meet at ~110°, so one catches the sun while the other falls into shade) fused
 * round deep grooves — 24 vertices (5 pier points + 1 groove, × 4), counter-clockwise from +x, turned by
 * ORTHANC.turnDeg so that seen from the hero camera (bearing 172) all four horns stand apart.
 */
function orthancSection(r: number): V2[] {
  const out: V2[] = [];
  const turn = (ORTHANC.turnDeg * Math.PI) / 180;
  for (let i = 0; i < 4; i++) {
    const a = ((45 + 90 * i) * Math.PI) / 180 + turn;
    const at = (ang: number, rr: number): V2 => [Math.cos(ang) * rr, Math.sin(ang) * rr];
    out.push(at(a - 0.44, r * 0.68));
    out.push(at(a - 0.18, r * 0.9));
    out.push(at(a, r));
    out.push(at(a + 0.18, r * 0.9));
    out.push(at(a + 0.44, r * 0.68));
    // the deep groove on the axis between this pier and the next
    out.push(at(a + Math.PI / 4, r * 0.44));
  }
  return out;
}

/** the tower: the pier bundle tapering to the summit, three faint ledge bands, ribs, four horns */
function buildOrthanc(k: ProxyKit): void {
  const y0 = k.ground(0, 0) - 0.08;
  const sec = orthancSection(ORTHANC.r);
  const H = ORTHANC.top;
  const turn = (ORTHANC.turnDeg * Math.PI) / 180;
  // the shaft: a slight flare at the foot, a near-straight taper to 64 % at the summit
  const lv = [0, 0.04, 0.12, 0.3, 0.5, 0.7, 0.88, 1];
  const scaleAt = (f: number) => 1.06 - 0.06 * Math.min(1, f / 0.04) - 0.36 * f;
  k.loft('obsidian', lv.map((f) => ({ outline: sec, y: H * f, scale: scaleAt(f) })), { at: [0, y0, 0], color: OBSIDIAN });
  // faint ledge bands (the storeys of the film tower): thin collars barely proud of the shaft
  for (const f of [0.3, 0.62, 0.88]) {
    const s = scaleAt(f) * 1.025;
    k.loft(
      'obsidian',
      [
        { outline: sec, y: 0, scale: s },
        { outline: sec, y: 0.04, scale: s },
      ],
      { at: [0, y0 + H * f, 0], color: OBSIDIAN, shade: 0.9, lod: 0 },
    );
  }
  // sharp vertical ribs on the piers' flank facets (the film tower's fluting), following the taper:
  // knife-edged fins whose two faces catch the light differently
  for (let i = 0; i < 4; i++) {
    for (const [off, rr] of [
      [-0.31, 0.79],
      [0.31, 0.79],
    ] as [number, number][]) {
      const a = ((45 + 90 * i) * Math.PI) / 180 + turn + off;
      const [ux, uz] = [Math.cos(a), Math.sin(a)];
      const [tx, tz] = [-uz, ux];
      const c = ORTHANC.r * rr;
      const fin: V2[] = [
        [ux * (c - 0.03) - tx * 0.03, uz * (c - 0.03) - tz * 0.03],
        [ux * (c + 0.07), uz * (c + 0.07)],
        [ux * (c - 0.03) + tx * 0.03, uz * (c - 0.03) + tz * 0.03],
      ];
      // the fins in the dark metal family: their knife edges catch the sky as thin vertical highlights
      k.loft('metal', [0.04, 0.5, 0.97].map((f) => ({ outline: fin, y: H * f, scale: scaleAt(f) })), { at: [0, y0, 0], color: 0x3a3e46, lod: 0 });
    }
  }
  // the four horns: thin tapering blades rising from the piers' corners, splayed ~10° outwards, with
  // thorns on their inner edges; heights varied (the film tower's crown is ragged, not symmetric)
  const sTop = scaleAt(1);
  const hornH = [1.3, 1.02, 1.18, 0.92];
  const splay = Math.tan((10 * Math.PI) / 180);
  for (let i = 0; i < 4; i++) {
    const a = ((45 + 90 * i) * Math.PI) / 180 + turn;
    const [ux, uz] = [Math.cos(a), Math.sin(a)];
    const [tx, tz] = [-uz, ux];
    const rr = ORTHANC.r * sTop * 0.88;
    const hh = hornH[i];
    // a blade: long tangentially, thin radially (a flattened diamond), tapering to a point
    const blade = (w: number, d: number, out: number): V2[] => {
      const cx = ux * (rr + out);
      const cz = uz * (rr + out);
      return [
        [cx + tx * w, cz + tz * w],
        [cx + ux * d, cz + uz * d],
        [cx - tx * w, cz - tz * w],
        [cx - ux * d, cz - uz * d],
      ];
    };
    k.loft(
      'obsidian',
      [
        { outline: blade(0.13, 0.065, 0), y: 0 },
        { outline: blade(0.11, 0.055, hh * 0.45 * splay), y: hh * 0.45 },
        { outline: blade(0.065, 0.035, hh * 0.8 * splay), y: hh * 0.8 },
        { outline: blade(0.008, 0.006, hh * splay), y: hh },
      ],
      { at: [0, y0 + H - 0.02, 0], color: OBSIDIAN },
    );
    // thorns on the inner edge, pointing in and up
    const yaw = (-Math.atan2(-uz, -ux) * 180) / Math.PI;
    for (const f of [0.3, 0.55, 0.75]) {
      const out = hh * f * splay;
      const w = 0.035 * (1 - f * 0.6);
      k.cone('obsidian', w, 0.16 * (1 - f * 0.4), { at: [ux * (rr + out - 0.04), y0 + H - 0.02 + hh * f, uz * (rr + out - 0.04)], rot: [0, yaw, -60], seg: 4, color: OBSIDIAN, lod: 0 });
    }
  }
  // the stair to the door (south face) and the door's dark slot
  k.box('obsidian', 0.26, 0.1, 0.5, { at: [0, y0 + 0.05, ORTHANC.r * 0.7 + 0.1], color: 0x1e2024, lod: 0 });
  k.box('darkStone', 0.12, 0.22, 0.04, { at: [0, y0 + 0.15, ORTHANC.r * 0.62], color: 0x060607, lod: 0 });
}

/**
 * The Ring of Isengard: battered dark rock standing on the level floor all the way round (its foot
 * follows the ground: seated), buttressed outside, a broad walk with a low parapet on top, open only at
 * the gate in the south (the wall carried over it as a lintel).
 */
function buildRing(k: ProxyKit): void {
  const g = 2.4; // gate gap half-angle, deg
  const floor = k.ground(0, 0);
  k.wallPath('darkStone', arcPath(R, GATE_B + g, GATE_B - g + 360), WALL.h, WALL.t, { followGround: true, step: 0.35, batter: 0.22, color: RING, shadeJitter: 0.05 });
  // the parapet along the outer edge of the walk
  const rp = R + (WALL.t * (1 - 0.22)) / 2 - 0.03;
  k.wallPath('darkStone', arcPath(rp, GATE_B + g, GATE_B - g + 360, 2), 0.07, 0.05, { at: [0, floor - 0.02 + WALL.h, 0], color: RING_LIT, lod: 1 });
  // the gate: the wall carried over the opening as a lintel block, a dark tunnel under it
  const [x, z] = polar(GATE_B, R);
  const w = 2 * R * Math.sin(((g + 0.6) * Math.PI) / 180);
  k.box('darkStone', w, WALL.h - 0.45 + 0.02, WALL.t * 0.85, { at: [x, floor + 0.43, z], rot: [0, 180 - GATE_B, 0], color: RING });
  // buttresses round the outside every 7.5°: the regular segments of the film's ring
  for (let b = 3.75; b < 360; b += 7.5) {
    if (Math.abs(b - GATE_B) < 5) continue;
    const [bx, bz] = polar(b, R + WALL.t * 0.42);
    k.box('darkStone', 0.22, WALL.h * 0.9, 0.28, { at: [bx, 0, bz], seat: 'min', rot: [0, 180 - b, 0], color: RING_LIT, lod: 0 });
  }
}

/**
 * Sixteen pits (compass bearing, radius from the tower, size): in loose clusters of varied sizes between
 * the radial roads, at least ~1.1 km apart.
 */
const PITS: [number, number, number][] = (
  [
    [312, 2.3, 0.32],
    [322, 3.6, 0.22],
    [338, 2.9, 0.14],
    [330, 4.8, 0.36],
    [348, 5.4, 0.18],
    [255, 2.2, 0.2],
    [262, 3.9, 0.4],
    [276, 3.0, 0.15],
    [285, 5.0, 0.26],
    [22, 3.4, 0.3],
    [38, 4.6, 0.17],
    [44, 2.5, 0.22],
    [150, 3.5, 0.28],
    [200, 4.4, 0.2],
    [95, 4.9, 0.16],
    [212, 2.0, 0.13],
  ] as [number, number, number][]
).map(([b, r, s]): [number, number, number] => [...polar(b, r), s]);

/** a ragged closed outline of mean radius r round (x, z): value noise on the angle, seeded per pit */
function ragged(x: number, z: number, r: number, amp: number, seed: number, n = 14): V2[] {
  return Array.from({ length: n }, (_, i): V2 => {
    const a = (i / n) * Math.PI * 2;
    const q = r * (1 + amp * (valueNoise(Math.cos(a) * 1.6 + seed, Math.sin(a) * 1.6, 7301) - 0.5) * 2);
    return [x + Math.cos(a) * q, z + Math.sin(a) * q];
  });
}

/**
 * The pits: ragged forge shafts — a burning floor (dusk glow, dull by day), a charred spoil rim of heaped
 * slag round it, a few blocks of debris, and a fire light (halved: a dull ember glint in the regional
 * shots, not a beacon).
 */
function buildPits(k: ProxyKit): void {
  PITS.forEach(([x, z, r], i) => {
    const g = k.ground(x, z);
    const inner = ragged(x, z, r, 0.3, i * 3.7);
    const outer = ragged(x, z, r * 1.55 + 0.05, 0.35, i * 3.7 + 1.3);
    k.extrude('darkStone', outer, 0.05, { at: [0, g - 0.03, 0], holes: [inner.slice().reverse()], color: 0x252321, grain: 0.5, lod: 0 });
    k.extrude('emissive', inner, 0.03, { at: [0, g - 0.025, 0], color: PIT_GLOW, glow: { gate: 'dusk', strength: 2.2 }, lod: 0 });
    // heaps of slag on the rim
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * Math.PI * 2 + k.r(1) * 1.4;
      const rr = r * (1.25 + k.r(2) * 0.35) + 0.03;
      k.rock('weathered', 0.035 + k.r(3) * 0.05, { at: [x + Math.cos(a) * rr, 0, z + Math.sin(a) * rr], seat: true, squash: 0.45, lump: 0.35, detail: 1, color: 0x2a2826, lod: 0 });
    }
    k.light([x, g + 0.05, z], { kind: 'fire', color: 0xff7a1e, intensity: 0.6, radius: r * 0.25, flicker: 0.35 });
  });
}

/** roads: pale paved ribbons draped on the ground (wall paths following the ground: seated) */
function road(k: ProxyKit, path: V2[], w: number, h = 0.04): void {
  k.wallPath('stone', path, h, w, { followGround: true, step: 0.2, color: ROAD, grain: 0.3, lod: 0 });
}

/** the radial roads inside, the road on south from the gate, the workshop sheds on the floor */
function buildFloor(k: ProxyKit): void {
  road(k, [polar(180, 1.0), polar(180, R + 0.2)], 0.2);
  for (const b of [0, 60, 120, 240, 300]) road(k, [polar(b, 1.0), polar(b, R - 0.45)], 0.12);
  // the road south from the gate down Nan Curunír towards the Fords of Isen (the straight line leaving
  // the gate in the film still), west of the river: one continuous draped ribbon down the apron before
  // the gate, as far as the hero frame shows it
  road(
    k,
    [
      [0, R + 0.2],
      [0.05, 8.5],
      [0.2, 10.0],
      [0.25, 10.6],
    ],
    0.12,
    // a little raised (a paved causeway down the apron): its foot follows the lower edge of the slope
    0.07,
  );
  // workshop sheds and stores scattered over the floor, clear of the tower, the pits and the roads
  const avoid = [{ at: [0, 0] as V2, r: 1.4 }, ...PITS.map(([x, z, r]) => ({ at: [x, z] as V2, r: r * 1.6 + 0.25 }))];
  const onRoad = (x: number, z: number) => {
    const b = ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;
    const r = Math.hypot(x, z);
    return [0, 60, 120, 180, 240, 300, 360].some((rb) => Math.abs(b - rb) * (Math.PI / 180) * r < 0.3);
  };
  k.scatter(
    { annulus: { at: [0, 0], r0: 1.5, r1: R - 0.7 } },
    34,
    (_i, x, z, u) => {
      if (onRoad(x, z)) return;
      const w = 0.12 + u * 0.22;
      k.house('weathered', 'slate', w, 0.08 + k.r(1) * 0.1, 0.06 + k.r(2) * 0.08, {
        at: [x, 0, z],
        rot: [0, k.r(3) * 180, 0],
        roof: k.r(4) < 0.6 ? 'flat' : 'gable',
        pitch: 22,
        color: 0x3b3a37,
        shade: 0.85 + k.r(5) * 0.3,
        roofColor: 0x2c2d2e,
        lod: 0,
      });
    },
    { minSpacing: 0.45, avoid },
  );
}

const STAMPS: LocalStamp[] = [
  // the floor of the ring levelled out of Nan Curunír above the Isen's water (onRiver: the river runs
  // hidden under it), blending back to the valley over 5 km — down to the river's own level by ~12 km out,
  // inside the onRiver circle (13 km), where the Isen comes out of the valley floor again
  { kind: 'basin', at: [0, 0], radius: R + 0.45, floor: FLOOR, falloff: 5.0 },
];

/** smoke over five of the pits, steam over one (EffectsSystem, S4) */
const EMITTERS: EmitterDecl[] = [0, 3, 6, 9, 12, 13].map((i, n): EmitterDecl => ({ preset: n === 5 ? 'steam' : 'smoke', at: [PITS[i][0], 0.1, PITS[i][1]], rate: 0.6, scale: 1.5 }));

export default defineLandmark({
  id: 'isengard',
  placeId: 'isengard',
  tier: 'A',
  stamps: STAMPS,
  proxy: (k) => {
    buildRing(k);
    buildOrthanc(k);
    buildFloor(k);
    buildPits(k);
  },
  emitters: EMITTERS,
  // Saruman felled the valley's trees: no lone trees anywhere near the ring
  vegetationExclusion: 15,
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
      // shade, and the landmark structure renders black there (no sky light in terrain shadow — contract
      // request); the shot list keeps 17.5 until the main agent decides
      tod: 14.0,
      compare: ['reference/film/isengard/isengard-ring-orthanc-film.jpg', 'reference/bigatures/isengard/orthanc-weta-mini.jpg'],
      note: 'early afternoon from the south over Nan Curunír: the dark ring in its levelled basin, the gate facing us with the road leaving it, Orthanc in the centre against the shoulder of Methedras, the pits burning; the sun from the south-west rakes across the ring and the tower',
    },
  ],
});
