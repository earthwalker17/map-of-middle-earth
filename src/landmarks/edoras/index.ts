import type { V2, V3 } from '../records.ts';
import { defineLandmark } from '../types.ts';

/**
 * Edoras (kit v2 pilot): an isolated rocky knoll on the Snowbourn's braided plain before the White
 * Mountains; a grey rock face under the summit on the north and west, the long Golden Hall (Meduseld) on
 * a battered stone terrace at the top, reached by a stone stair up the east side; a carpet of mossy
 * thatched halls packed in rows along the contours on the other slopes, a timber palisade round the hill,
 * burial mounds white with simbelmynë outside the gate. Local frame: x east, z south (heading 0);
 * bearings are compass degrees from the summit. Design scale ×~10 (Meduseld 1.17 km long) — the knoll
 * carries the silhouette.
 */

/** local point at compass bearing `b` (deg), radius `r` km from the summit */
const polar = (b: number, r: number): V2 => [Math.sin((b * Math.PI) / 180) * r, -Math.cos((b * Math.PI) / 180) * r];

const TIMBER = 0x4e3a28;
/** terrace-bank turf, close to the Rohan tussock of the knoll */
const TURF = 0x817b4e;
/** weathered, mossy grey-olive thatch (the film's town: a carpet of dark roofs) */
const THATCH = [0x5f5b49, 0x6a6550, 0x767058, 0x66624d, 0x706a54, 0x5b5846];
/** golden straw of Meduseld's roof, pale gilding of its trim */
const STRAW = 0xcfac52;
const GILT = 0xdcc070;
const GATE = 90; // compass bearing of the gate (east)
const RING = 1.75; // palisade radius, km
/** the crag band under the summit: from bearing 20 (NNE) anticlockwise round N and W to 205 (SSW) */
const BAND = { from: 20, to: 205 };
const bandR = (b: number): number => 0.98 + 0.05 * Math.sin(b * 0.21);
/** Meduseld: hall centre, size (×1.3 of S1), the terrace top clearance */
const HX = -0.1;
const HZ = 0.08;
const HALL = { w: 1.17, d: 0.34, h: 0.15, pitch: 52, ov: 0.045 };
/** terrace outline round the hall (chamfered rectangle, densified so its foot follows the ground) */
const TERRACE: V2[] = (() => {
  const a = 0.68;
  const c = 0.25;
  const ch = 0.08;
  const corners: V2[] = [
    [-a + ch, -c],
    [a - ch, -c],
    [a, -c + ch],
    [a, c - ch],
    [a - ch, c],
    [-a + ch, c],
    [-a, c - ch],
    [-a, -c + ch],
  ];
  const out: V2[] = [];
  for (let k = 0; k < corners.length; k++) {
    const p = corners[k];
    const q = corners[(k + 1) % corners.length];
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.05));
    for (let j = 0; j < n; j++) out.push([p[0] + ((q[0] - p[0]) * j) / n, p[1] + ((q[1] - p[1]) * j) / n]);
  }
  return out;
})();

export default defineLandmark({
  id: 'edoras',
  placeId: 'edoras',
  tier: 'B',
  // the knoll: a dome (extra bulk to the north-west: the steep, rocky side); the foothill spur to the
  // south cut down to the plain (lowerOnly flatten: it never raises); the two needle-like spur tips of the
  // range foot 6–7 km behind the knoll (they stood over Meduseld from the north) lowered into ridges; a
  // gently levelled summit for Meduseld (strength 0.9: rounded, not the S1 truncated cone). Flatten
  // heights are relative to the base ground at the origin.
  stamps: [
    { kind: 'raise', at: [0.2, -0.1], radius: 3.2, amount: 1.6 },
    { kind: 'raise', at: [-0.5, -0.25], radius: 1.8, amount: 0.4 },
    { kind: 'flatten', at: [0.3, 2.75], radius: 0.55, falloff: 0.9, height: -0.1, lowerOnly: true, strength: 0.9 },
    { kind: 'flatten', at: [-2.0, 6.4], radius: 0.55, falloff: 0.8, height: 0.6, lowerOnly: true, strength: 0.95 },
    { kind: 'flatten', at: [3.5, 6.9], radius: 0.5, falloff: 0.8, height: -0.2, lowerOnly: true, strength: 0.9 },
    { kind: 'flatten', at: [-0.1, 0.1], radius: 0.72, falloff: 0.5, height: 'auto', strength: 0.9 },
  ],
  lodPx: [110, 30],
  vegetationExclusion: 2.4,
  proxy: (k) => {
    // ---- Meduseld on its battered stone terrace
    const ty = Math.max(...TERRACE.map(([x, z]) => k.ground(HX + x, HZ + z))) + 0.045;
    k.extrude('weathered', TERRACE, 0.045, { at: [HX, 0, HZ], followGround: true, taper: 0.035, color: 0xa39b88 });
    const { w, d, h, pitch, ov } = HALL;
    k.house('wood', 'thatch', w, d, h, {
      at: [HX, ty, HZ],
      seat: false,
      pitch,
      overhang: ov,
      color: 0x5b4935,
      roofColor: STRAW,
      roofGrain: 0.45,
      chimney: false,
      ridge: { fam: 'gold', color: GILT, size: 0.022 },
      gableBoards: { fam: 'gold', color: GILT, size: 0.024, horn: 0.075, lod: 1 },
      windows: { count: 3, on: 0.67, sides: 2, color: 0xe2a452 },
    });
    // the porch on the east gable, the louvre lantern on the ridge
    k.house('wood', 'thatch', 0.16, 0.26, 0.11, { at: [HX + w / 2 + 0.07, ty, HZ], seat: false, rot: [0, 90, 0], pitch: 50, overhang: 0.02, color: 0x5b4935, roofColor: STRAW, roofGrain: 0.45, ridge: { fam: 'gold', color: GILT, size: 0.014 } });
    const ridgeY = ty + h + (d / 2) * Math.tan((pitch * Math.PI) / 180);
    k.house('wood', 'thatch', 0.16, 0.1, 0.045, { at: [HX - 0.15, ridgeY - 0.03, HZ], seat: false, pitch: 50, color: 0x5b4935, roofColor: STRAW, gableBoards: { fam: 'gold', color: GILT, size: 0.012, horn: 0.03, lod: 1 } });
    // a lower hall north of the terrace, dug into the slope on a turf bank
    k.house('wood', 'thatch', 0.46, 0.14, 0.07, { at: [HX - 0.05, 0, HZ - 0.37], pitch: 50, overhang: 0.03, dig: 0.7, color: TIMBER, roofColor: 0x7c7152, roofGrain: 0.55, ridge: {}, bank: { color: TURF } });

    // ---- the rock face under Meduseld: ONE continuous band round the north and west (the steepest part
    // of the knoll), its ends tapering into the slope; it forms the upper third of the knoll there
    const band: V2[] = [];
    const hs: number[] = [];
    for (let b = BAND.from + 360; b >= BAND.to; b -= 4) {
      band.push(polar(b, bandR(b)));
      // tallest on the north-west (the face seen from the plain), lower towards both ends
      const nw = Math.cos(((b - 315) * Math.PI) / 180);
      hs.push(0.48 + 0.22 * Math.max(0, nw));
    }
    k.cliff('weathered', band, hs, { color: 0x77726a, rough: 0.7, strata: 0.4, depth: 0.75, overhang: 0.06 });
    // scree boulders at the foot of the face
    k.scatter(
      { annulus: { at: [0, 0], r0: 1.05, r1: 1.22, a0: BAND.to + 10, a1: BAND.from - 10 } },
      10,
      (_i, x, z, u) => {
        k.rock('weathered', 0.03 + u * 0.035, { at: [x, 0, z], seat: true, squash: 0.7, lump: 0.3, color: 0x817b6f, shade: 0.9 + u * 0.2, lod: 0 });
      },
      { minSpacing: 0.12 },
    );

    // ---- the town: rows of thatched halls along the contours (ridges along them, eaves overlapping) on
    // the gentler east, south-east and south slopes (≤ 49°: a house on the 55–65° north / west flanks
    // could only stand on a pillar), each dug into the slope on a turf terrace bank; the north / west
    // stay open turf, scree and the rock face; the terrace and the stair are kept clear
    const avoid = (x: number, z: number): boolean =>
      (x > HX - 0.8 && x < HX + 0.8 && z > HZ - 0.36 && z < HZ + 0.36) ||
      (x > HX - 0.33 && x < HX + 0.23 && z > HZ - 0.55 && z < HZ) ||
      (x > 0.45 && z > -0.13 && z < 0.21);
    const rows = [0.78, 0.92, 1.06, 1.2, 1.34, 1.48, 1.62];
    let n = 0;
    let lit = 0;
    rows.forEach((r0, ri) => {
      let b = 18 + (ri % 2) * 4;
      let wi = 0.11 + k.r(1) * 0.09;
      while (b < 255) {
        const r = r0 + (k.r(2) - 0.5) * 0.04;
        const [x, z] = polar(b, r);
        // the local fall line: the ridge follows the true contour (the least drop across the house); a
        // house on a steeper spot than 49° is skipped
        const e = 0.06;
        const gx = (k.ground(x + e, z) - k.ground(x - e, z)) / (2 * e);
        const gz = (k.ground(x, z + e) - k.ground(x, z - e)) / (2 * e);
        const skip = k.r(3) < 0.08 || Math.hypot(gx, gz) > 1.15 || avoid(x, z);
        if (!skip) {
          const i = n++;
          const di = 0.085 + k.r(4) * 0.02;
          const hi = 0.034 + k.r(5) * 0.01;
          const window = lit < 24 && i % 4 === 1;
          if (window) lit++;
          const trim = i % 4 === 0;
          k.house('wood', 'thatch', wi, di, hi, {
            at: [x, 0, z],
            // local +z (the window side) faces down the fall line
            rot: [0, (Math.atan2(-gx, -gz) * 180) / Math.PI + (k.r(6) - 0.5) * 8, 0],
            pitch: 52 + k.r(7) * 8,
            overhang: 0.03,
            dig: 0.75,
            bank: { color: TURF, shade: 0.92 + k.r(8) * 0.12 },
            color: TIMBER,
            shade: 0.85 + k.r(9) * 0.3,
            roofColor: THATCH[i % THATCH.length],
            roofGrain: 0.6,
            chimney: i % 6 === 3,
            ...(i % 2 === 0 ? { ridge: { color: 0x4d4a3b } } : {}),
            ...(trim ? { gableBoards: { color: 0x3f3020, size: 0.009, horn: 0.018 } } : {}),
            ...(window ? { windows: { count: 1, on: 1, sides: 1 as const, size: 0.01 } } : {}),
          });
        }
        // centre-to-centre along the row: half of each width plus a small gap (the 0.03 km eaves overlap)
        const next = 0.11 + k.r(1) * 0.09;
        b += ((((wi + next) / 2 + 0.006 + k.r(10) * 0.024) / r) * 180) / Math.PI;
        wi = next;
      }
    });

    // ---- palisade round the hill (open at the gate): weathered grey-brown timber, pointed stakes
    const gap = 7;
    const ring: V2[] = [];
    for (let b = GATE + gap; b <= GATE + 360 - gap; b += 3) ring.push(polar(b, RING + 0.05 * Math.sin(b * 0.09)));
    k.wallPath('wood', ring, 0.05, 0.015, {
      followGround: true,
      step: 0.08,
      color: 0x7a6a55,
      shadeJitter: 0.1,
      crenel: { w: 0.016, h: 0.02, gap: 0.004, shape: 'point', lod: 0 },
    });
    for (const s of [-1, 1]) {
      const [x, z] = polar(GATE + s * (gap + 0.5), RING);
      k.tower('wood', 0.04, 0.12, { at: [x, 0, z], seat: true, sides: 4, rot: [0, 45, 0], roof: 'cone', roofFam: 'thatch', roofColor: 0x6a6550, roofH: 0.06, color: 0x6e5f4c });
    }
    // ---- the stone stair from the gate up the east flank to the terrace
    const stair: V3[] = [];
    const x1 = HX + 0.68;
    for (let t = 0; t <= 10; t++) stair.push([RING + 0.02 - (t * (RING + 0.02 - x1)) / 10, Number.NaN, 0.04 + (t * (HZ - 0.04)) / 10]);
    k.stairs('stone', stair, 0.055, { stepKm: 0.028, color: 0xb9b1a0 });
    // ---- burial mounds along the road outside the gate, white with simbelmynë
    for (let i = 0; i < 8; i++) {
      const side = i % 2 ? 1 : -1;
      const x = RING + 0.35 + Math.floor(i / 2) * 0.28;
      const z = side * (0.22 + (i % 3) * 0.04);
      const r = 0.07 + (i % 3) * 0.012;
      k.mound('foliage', r, r * 0.6, { at: [x, 0, z], color: 0xa3ab80, shade: 1 + (i % 2) * 0.08 });
    }
  },
  annotation: { title: 'Edoras', subtitle: 'Meduseld, the Golden Hall', blurb: 'Court of the Kings of Rohan upon its green hill below the White Mountains.' },
  bookmarks: [
    {
      id: 'edoras-close',
      distanceKm: 16,
      // the range behind the knoll tops out 15-18 deg above the horizon from here: the camera sits 3 deg
      // BELOW its aim point (2.2 km above the summit ground) so the frame reaches up to the peaks and sky
      elevationDeg: -3,
      azimuthDeg: 40,
      fov: 38,
      lift: 2.2,
      tod: 9,
      compare: ['reference/film/edoras', 'reference/photos/edoras'],
      note: 'hero (mid, 16 km): from the north-east across the plain at 9:00 (the sun rakes across the knoll from the east), the town on the east slopes, the rock face under Meduseld on the right, the White Mountains behind with their peaks and sky at the top',
    },
  ],
});
