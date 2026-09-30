import type { V2, V3 } from '../records.ts';
import { defineLandmark } from '../types.ts';

/**
 * Edoras (kit v2 pilot): an isolated rocky knoll on the Snowbourn's braided plain before the White
 * Mountains; a palisade rings the hill, thatched halls climb its slopes, a stone stair runs up the east
 * side to the summit terrace where Meduseld stands, long and steep-roofed, its roof of gold; burial
 * mounds line the road outside the gate. Local frame: x east, z south (heading 0); bearings are compass
 * degrees from the summit. Design scale ×~10 (Meduseld 0.9 km long) — the knoll carries the silhouette.
 */

/** local point at compass bearing `b` (deg), radius `r` km from the summit */
const polar = (b: number, r: number): V2 => [Math.sin((b * Math.PI) / 180) * r, -Math.cos((b * Math.PI) / 180) * r];

const TIMBER = 0x5a3f28;
const THATCH = [0x8d7a4f, 0x7d6c48, 0x9a8656, 0x6f6446, 0x857352];
const GATE = 90; // compass bearing of the gate (east)
const RING = 1.5; // palisade radius, km

export default defineLandmark({
  id: 'edoras',
  placeId: 'edoras',
  tier: 'B',
  // the knoll: a broad dome, extra bulk to the north-west (the steep, rocky side) and a small summit
  // terrace for Meduseld — no longer the S1 truncated cone (r 1.7 flatten)
  stamps: [
    { kind: 'raise', at: [0.2, 0], radius: 3.6, amount: 1.9 },
    { kind: 'raise', at: [-0.5, -0.25], radius: 1.8, amount: 0.55 },
    { kind: 'flatten', at: [-0.1, 0.1], radius: 0.62, falloff: 0.45, height: 'auto' },
  ],
  lodPx: [110, 30],
  vegetationExclusion: 2.4,
  proxy: (k) => {
    // ---- Meduseld on the summit terrace: stone platform, the long hall (gables east / west), porch, annex
    const hx = -0.1;
    const hz = 0.08;
    k.extrude(
      'weathered',
      [
        [-0.56, -0.2],
        [0.62, -0.2],
        [0.62, 0.2],
        [-0.56, 0.2],
      ],
      0.018,
      { at: [hx, 0, hz], followGround: true, color: 0xb3ab98 },
    );
    k.house('wood', 'gold', 0.9, 0.26, 0.12, {
      at: [hx, 0.018, hz],
      pitch: 52,
      overhang: 0.035,
      color: 0x6a4a2e,
      chimney: false,
      plinthFam: 'weathered',
      windows: { count: 3, on: 0.67, sides: 2, color: 0xe2a452 },
    });
    k.house('wood', 'gold', 0.1, 0.2, 0.09, { at: [hx + 0.5, 0.018, hz], pitch: 50, overhang: 0.015, color: 0x6a4a2e, rot: [0, 90, 0] });
    k.house('wood', 'thatch', 0.42, 0.14, 0.08, { at: [hx - 0.08, 0, hz - 0.3], pitch: 48, roofColor: 0x8a7650, color: TIMBER });
    // ---- the rocky north-west face: cliffs below the terrace (walked anticlockwise so they face out)
    const face: V2[] = [];
    for (let b = 338; b >= 236; b -= 6) face.push(polar(b, 0.82 + 0.1 * Math.sin(b * 0.11)));
    k.cliff(
      'weathered',
      face,
      face.map((_, i) => 0.16 + 0.12 * Math.sin((i / (face.length - 1)) * Math.PI)),
      { color: 0x7b7466, rough: 0.5, strata: 0.35, overhang: 0.05, depth: 0.25 },
    );
    const lower: V2[] = [];
    for (let b = 318; b >= 262; b -= 6) lower.push(polar(b, 1.28 + 0.06 * Math.cos(b * 0.2)));
    k.cliff('weathered', lower, 0.12, { color: 0x847c6c, rough: 0.6, strata: 0.3, depth: 0.2 });
    // boulders on the flanks
    k.scatter({ annulus: { at: [0, 0], r0: 0.7, r1: 1.9, a0: 200, a1: 350 } }, 12, (_i, x, z, u) => {
      k.rock('weathered', 0.035 + u * 0.045, { at: [x, 0, z], seat: true, squash: 0.7, lump: 0.3, color: 0x7f786a, shade: 0.9 + u * 0.2, lod: 0 });
    }, { minSpacing: 0.12 });

    // ---- the town: thatched halls on the slopes (ridges along the contours), avoiding the stair
    let lit = 0;
    k.scatter(
      { annulus: { at: [0, 0], r0: 0.68, r1: RING - 0.12, a0: 342, a1: 232 } },
      56,
      (i, x, z, u) => {
        const b = (Math.atan2(x, -z) * 180) / Math.PI;
        const w = 0.13 + u * 0.1;
        const d = 0.085 + ((i * 7) % 5) * 0.008;
        const h = 0.055 + ((i * 3) % 4) * 0.007;
        const yaw = -b + (((i * 37) % 23) - 11);
        const window = lit < 24 && i % 2 === 0;
        if (window) lit++;
        k.house('wood', 'thatch', w, d, h, {
          at: [x, 0, z],
          rot: [0, yaw, 0],
          pitch: 46 + ((i * 5) % 9),
          color: TIMBER,
          shade: 0.85 + ((i * 13) % 7) * 0.05,
          roofColor: THATCH[i % THATCH.length],
          chimney: i % 5 === 0,
          ...(window ? { windows: { count: 1, on: 1, sides: 1 as const, size: 0.01 } } : {}),
        });
      },
      { minSpacing: 0.19, avoid: [[[0.45, -0.12], [RING + 0.3, -0.12], [RING + 0.3, 0.2], [0.45, 0.2]]] },
    );

    // ---- palisade round the hill (open at the gate), gate towers
    const gap = 7;
    const ring: V2[] = [];
    for (let b = GATE + gap; b <= GATE + 360 - gap; b += 3) ring.push(polar(b, RING + 0.05 * Math.sin(b * 0.09)));
    k.wallPath('wood', ring, 0.08, 0.03, {
      followGround: true,
      step: 0.08,
      color: 0x4a3524,
      crenel: { w: 0.014, h: 0.022, gap: 0.004, shape: 'point', lod: 0 },
    });
    for (const s of [-1, 1]) {
      const [x, z] = polar(GATE + s * (gap + 0.5), RING);
      k.tower('wood', 0.045, 0.14, { at: [x, 0, z], seat: true, sides: 4, rot: [0, 45, 0], roof: 'cone', roofFam: 'thatch', roofColor: 0x7d6c48, roofH: 0.06, color: 0x4a3524 });
    }
    // ---- the stone stair from the gate up the east flank to the terrace
    const stair: V3[] = [];
    for (let t = 0; t <= 10; t++) {
      const x = RING + 0.02 - t * ((RING - 0.52) / 10);
      stair.push([x, Number.NaN, 0.04]);
    }
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
      distanceKm: 20,
      elevationDeg: 9,
      azimuthDeg: 45,
      fov: 35,
      lift: 0.3,
      tod: 11,
      compare: ['reference/film/edoras', 'reference/photos/edoras'],
      note: 'hero (mid, ~20 km): from the north-east across the braided valley, the knoll against the White Mountains',
    },
  ],
});
