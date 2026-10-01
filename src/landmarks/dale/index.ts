import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';
import { defineLandmark } from '../types.ts';

/**
 * Dale (research §14; the Unexpected Journey prologue): a compact city of pale stone on a spur in the
 * valley before the Lonely Mountain — houses with dusty tile and slate roofs packed along the contours,
 * a curtain wall with towers round the spur, the domed great hall and bell towers with spires on the
 * crown, red and blue banners, a stone bridge over the Forest River below the spur's nose, warm windows
 * at dusk.
 *
 * Site (local km, x east, z south): the display point (places.json offset 22 km south of the canon point,
 * kept) lies on the Wilderland plateau (≈ 7.1) 2–4 km north-east of its escarpment, which falls ≈ 3.3 to
 * the Forest River's valley (≈ 3.7) along a line from (−4.5, 0) to (0.5, 5); the river runs 1.5–2 km
 * beyond the scarp foot. Erebor's Front Gate is 21.7 km north (bearing ≈ 5°). The spur is a broad-crowned
 * hill (a massif stamp whose profile starts from the valley floor) standing out from the escarpment over
 * the valley, 1.5 above the plain at its crown, joined to the plain by a spur running back north-east.
 */

/** the city: an ellipse along the spur (centre, half-axes along / across, axis bearing) */
const CITY = { at: [-0.95, 0.75] as V2, a: 1.55, b: 1.08, bearing: 225 };
const DEG = Math.PI / 180;
const ca = Math.cos(CITY.bearing * DEG);
const sa = Math.sin(CITY.bearing * DEG);
/** city frame (s along the spur towards the nose, t across) → local x, z */
const CF = (s: number, t: number): V2 => [CITY.at[0] + sa * s + ca * t, CITY.at[1] - ca * s + sa * t];
/** the hill's crown (massif centre) and the citadel on it */
const HILL: V2 = CF(0.3, 0);
const CROWN: V2 = CF(0.2, 0);

const STONE = [0xcbbd9e, 0xc4b597, 0xd3c6a8, 0xbcae90, 0xc9b99a, 0xd8ccb0];
const ROOF = [0x7a5a4a, 0x5a6066, 0x6e5446, 0x4f565c, 0x84604c, 0x626a6e, 0x705a4c];
const WALL = 0xb9ab8c;
const BANNER = [0xa33b2a, 0x2f5a8a];
const WARM = 0xe8a050;

const inCity = (x: number, z: number, grow = 1): boolean => {
  const dx = x - CITY.at[0];
  const dz = z - CITY.at[1];
  const s = dx * sa - dz * ca;
  const t = dx * ca + dz * sa;
  return (s / (CITY.a * grow)) ** 2 + (t / (CITY.b * grow)) ** 2 <= 1;
};

function buildDale(k: ProxyKit): void {
  let lights = 0;
  const light = (p: V3, kind: 'window' | 'lamp', intensity = 1, size = 0.012): void => {
    if (lights >= 60) return;
    lights++;
    // windows lit from golden hour (dusk gate): the prologue's city glows at sunset
    k.light(p, { kind, color: WARM, intensity, radius: size, gate: 'dusk' });
  };
  const slope = (x: number, z: number): [number, number] => {
    const e = 0.06;
    return [(k.ground(x + e, z) - k.ground(x - e, z)) / (2 * e), (k.ground(x, z + e) - k.ground(x, z - e)) / (2 * e)];
  };

  // ---------------------------------------------------------------- the citadel on the crown
  const cy0 = k.ground(CROWN[0], CROWN[1]);
  // a terrace levelled for the great hall
  const terr: V2[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    terr.push([CROWN[0] + Math.cos(a) * 0.38, CROWN[1] + Math.sin(a) * 0.33]);
  }
  k.extrude('stone', terr, 0.05, { followGround: true, color: WALL, shade: 0.95 });
  const ty = Math.max(...terr.map(([x, z]) => k.ground(x, z))) + 0.05;
  // the great hall: a cross-shaped hall under a ribbed dome on a drum
  k.house('stone', 'roofTile', 0.45, 0.2, 0.15, { at: [CROWN[0], ty, CROWN[1]], seat: false, rot: [0, 45, 0], pitch: 40, color: STONE[0], roofColor: ROOF[0], lod: 2 });
  k.house('stone', 'roofTile', 0.45, 0.2, 0.15, { at: [CROWN[0], ty, CROWN[1]], seat: false, rot: [0, -45, 0], pitch: 40, color: STONE[2], roofColor: ROOF[0], lod: 2 });
  k.cylinder('stone', 0.125, 0.135, 0.13, { at: [CROWN[0], ty + 0.15, CROWN[1]], seg: 16, color: STONE[3] });
  k.lathe(
    'slate',
    [
      [0.145, 0],
      [0.138, 0.05],
      [0.112, 0.11],
      [0.062, 0.16],
      [0.015, 0.19],
      [0.015, 0.24],
      [0, 0.25],
    ],
    { at: [CROWN[0], ty + 0.28, CROWN[1]], seg: 16, color: 0x6f7a7c },
  );
  for (let i = 0; i < 4; i++) {
    const a = (i * 90 + 45) * DEG;
    light([CROWN[0] + Math.cos(a) * 0.15, ty + 0.21, CROWN[1] + Math.sin(a) * 0.15], 'window', 1.3, 0.016);
  }
  // bell towers with spires round the crown, banners on their faces
  const belfries: [number, number, number][] = [
    [-0.36, -0.22, 0.62],
    [0.3, 0.26, 0.52],
    [-0.2, 0.4, 0.45],
    [0.62, -0.42, 0.42],
    [-0.75, 0.45, 0.38],
  ];
  belfries.forEach(([dx, dz, h], i) => {
    const x = CROWN[0] + dx;
    const z = CROWN[1] + dz;
    k.tower('stone', 0.056, h, { at: [x, 0, z], seat: 'min', sides: 4, rot: [0, 45, 0], roof: 'spire', roofH: 0.2, roofFam: 'slate', color: STONE[(i + 1) % STONE.length], roofColor: 0x4f5a5e, lod: 2 });
    const g = k.ground(x, z);
    // the belfry openings glow at dusk; a long banner down the south face
    light([x, g + h * 0.85, z + 0.062], 'window', 1.2, 0.013);
    k.box('plaster', 0.042, h * 0.35, 0.006, { at: [x, g + h * 0.4, z + 0.06], color: BANNER[i % 2], lod: 0 });
  });

  // ---------------------------------------------------------------- the town: houses along the contours
  const avoid = (x: number, z: number): boolean => Math.hypot(x - CROWN[0], z - CROWN[1]) < 0.5 || belfries.some(([dx, dz]) => Math.hypot(x - CROWN[0] - dx, z - CROWN[1] - dz) < 0.1);
  let n = 0;
  for (let s = -CITY.a; s <= CITY.a; s += 0.105) {
    for (let t = -CITY.b; t <= CITY.b; t += 0.11) {
      const js = s + (k.r(1) - 0.5) * 0.05;
      const jt = t + (k.r(2) - 0.5) * 0.05;
      const [x, z] = CF(js, jt);
      if (!inCity(x, z, 0.97) || avoid(x, z) || k.r(3) < 0.1) continue;
      const [gx, gz] = slope(x, z);
      // terraced down the flanks: a stone plinth carries a house on the steeper ground
      if (Math.hypot(gx, gz) > 1.9) continue;
      const i = n++;
      const w = 0.085 + k.r(4) * 0.065;
      const d = 0.068 + k.r(5) * 0.032;
      const h = 0.06 + k.r(6) * 0.055;
      const yaw = Math.hypot(gx, gz) > 0.08 ? (Math.atan2(-gx, -gz) * 180) / Math.PI : CITY.bearing + (k.r(7) < 0.5 ? 0 : 90);
      // lit windows mostly on the valley (south-west) half of the town, the side the prologue looks at; the
      // grid runs from the plain end (s < 0) to the nose, so the far half must not use up the budget
      const lit = k.r(14) < (js > -0.25 ? 0.55 : 0.1) && lights < 51;
      k.house('stone', i % 3 === 2 ? 'slate' : 'roofTile', w, d, h, {
        at: [x, 0, z],
        rot: [0, yaw + (k.r(8) - 0.5) * 10, 0],
        roof: k.r(9) < 0.2 ? 'hip' : 'gable',
        pitch: 38 + k.r(10) * 14,
        overhang: 0.01,
        dig: 0.42,
        color: STONE[i % STONE.length],
        shade: 0.92 + k.r(11) * 0.16,
        roofColor: ROOF[(i * 5 + 2) % ROOF.length],
        roofGrain: 0.4,
        plinthFam: 'stone',
        plinthColor: 0x9a8f76,
        lod: i % 4 === 0 ? 2 : i % 4 === 2 ? 1 : 0,
        ridge: { fam: 'stone', color: 0x8f8268, size: 0.008 },
        ...(i % 2 === 1 ? { chimney: true } : {}),
      });
      if (lit) {
        // the lit window goes on the wall that looks most towards the valley in the south-west (the
        // prologue's view); house yaw maps local +z to (sin, cos) and +x to (cos, −sin)
        const ny = (yaw * Math.PI) / 180;
        const faces: [number, number, number][] = [
          [Math.sin(ny), Math.cos(ny), d / 2],
          [-Math.sin(ny), -Math.cos(ny), d / 2],
          [Math.cos(ny), -Math.sin(ny), w / 2],
          [-Math.cos(ny), Math.sin(ny), w / 2],
        ];
        const toView: V2 = [Math.sin(205 * DEG), -Math.cos(205 * DEG)];
        const [fx, fz, off] = faces.reduce((a, b) => (b[0] * toView[0] + b[1] * toView[1] > a[0] * toView[0] + a[1] * toView[1] ? b : a));
        // the house floor as the kit seats it (lowest corner, or dug in by 42 % of the wall height)
        const cs = [-1, 1].flatMap((a) => [-1, 1].map((b) => k.ground(x + Math.cos(ny) * a * (w / 2) + Math.sin(ny) * b * (d / 2), z - Math.sin(ny) * a * (w / 2) + Math.cos(ny) * b * (d / 2))));
        const floor = Math.max(Math.min(...cs, k.ground(x, z)), Math.max(...cs, k.ground(x, z)) - 0.42 * h) - 0.02;
        const wy = floor + h * 0.78;
        const wx = x + fx * (off + 0.004);
        const wz = z + fz * (off + 0.004);
        // only where that wall stands free (not the uphill wall dug into the slope)
        if (k.ground(wx + fx * 0.01, wz + fz * 0.01) < wy - 0.012) light([wx, wy, wz], 'window', 2.2 + k.r(12) * 0.8, 0.016);
      }
    }
  }

  // ---------------------------------------------------------------- the curtain wall round the spur, towers
  // (in runs: where the flank is too steep for a wall to stand — the nose's bluff — the rock is the wall)
  const ring: { p: V2; g: number }[] = [];
  for (let a = 0; a < 360; a += 6) {
    const s = Math.cos(a * DEG) * CITY.a * 1.03;
    const t = Math.sin(a * DEG) * CITY.b * 1.05;
    const p = CF(s, t);
    const [gx, gz] = slope(p[0], p[1]);
    ring.push({ p, g: Math.hypot(gx, gz) });
  }
  const start = ring.findIndex((q) => q.g > 1.7);
  const runs: V2[][] = [];
  let cur: V2[] = [];
  for (let i = 0; i <= ring.length; i++) {
    const q = ring[(Math.max(0, start) + i) % ring.length];
    if (q.g <= 1.7 && i < ring.length) cur.push(q.p);
    else {
      if (cur.length >= 3) runs.push(cur);
      cur = [];
    }
  }
  if (start < 0) runs.splice(0, runs.length, ring.map((q) => q.p));
  for (const run of runs)
    k.wallPath('stone', run, 0.075, 0.03, {
      closed: start < 0,
      followGround: true,
      step: 0.08,
      batter: 0.15,
      color: WALL,
      shadeJitter: 0.06,
      crenel: { w: 0.02, h: 0.018, gap: 0.016, lod: 0 },
    });
  // wall towers where the ground is gentle enough to hold one
  let last = -1;
  ring.forEach((q, i) => {
    if (q.g > 1.25 || (last >= 0 && i - last < 7)) return;
    last = i;
    k.tower('stone', 0.05, 0.17, { at: [q.p[0], 0, q.p[1]], seat: true, sides: 8, roof: 'cone', roofFam: 'roofTile', roofColor: ROOF[0], color: STONE[3] });
    // a lantern in the tower's upper window, looking out over the valley
    light([q.p[0] + Math.sin(205 * DEG) * 0.054, k.ground(q.p[0], q.p[1]) + 0.13, q.p[1] - Math.cos(205 * DEG) * 0.054], 'lamp', 2.2, 0.016);
  });

  // ---------------------------------------------------------------- the bridge over the Forest River below the nose
  const b0: V2 = [-3.55, 3.35];
  const b1: V2 = [-4.55, 4.75];
  const deckY = Math.max(k.ground(b0[0], b0[1]), k.ground(b1[0], b1[1])) + 0.06;
  k.bridge('stone', [b0[0], deckY, b0[1]], [b1[0], deckY, b1[1]], { width: 0.07, arches: 6, deck: 0.03, color: STONE[4] });
  for (const p of [b0, b1]) light([p[0], deckY + 0.03, p[1]], 'lamp', 1.1, 0.012);
}

export default defineLandmark({
  id: 'dale',
  placeId: 'dale',
  tier: 'B',
  // the spur: a rounded ridge running south-west from the plateau out over the escarpment, its nose a
  // steep bluff above the valley; the crown raised for the citadel
  stamps: [
    // the spur: a broad-crowned hill rising from the lower escarpment (base −2.5; the valley floor ≈ −3.4,
    // kept clear of the Forest River's banks)
    // against the escarpment, 1.5 above the plain at its crown; its arms run out south-west and
    // south into the valley and back north-east onto the plain (the spur's root) — never lowers
    {
      kind: 'massif',
      at: HILL,
      radius: 2.5,
      summit: 1.8,
      base: -2.5,
      exponent: 1.05,
      dome: 0.9,
      spurs: [
        { azimuthDeg: 225, lengthKm: 1.8, widthKm: 1.4, heightFrac: 0.55, rootFrac: 0.88 },
        { azimuthDeg: 165, lengthKm: 1.8, widthKm: 1.2, heightFrac: 0.45, rootFrac: 0.82 },
        { azimuthDeg: 290, lengthKm: 2.2, widthKm: 1.2, heightFrac: 0.45, rootFrac: 0.82 },
        { azimuthDeg: 45, lengthKm: 2.8, widthKm: 1.6, heightFrac: 0.82, rootFrac: 0.95 },
      ],
      flankSlope: 1.6,
      rough: { amp: 0.2, scaleKm: 1.8 },
    },
    // the crown eased into a gently domed table for the town
    { kind: 'flatten', at: HILL, radius: 0.9, falloff: 0.6, height: 1.65, strength: 0.45 },
  ],
  lodPx: [70, 24],
  vegetationExclusion: [{ at: CITY.at, r: 1.8 }],
  proxy: buildDale,
  annotation: { title: 'Dale', subtitle: 'City of Men below the Mountain', blurb: 'Once a merry town of bells and toys, laid waste by Smaug and rebuilt by Bard.' },
  bookmarks: [
    {
      id: 'dale-close',
      distanceKm: 26,
      elevationDeg: 8,
      azimuthDeg: 208,
      fov: 19,
      lift: 0.5,
      aimKm: [-0.95, -0.75],
      tod: 18.0,
      dayOfYear: 240,
      compare: ['reference/film/dale/dale-ruins-dos.jpg', 'reference/film/dale/dale-city-auj.jpg'],
      note: 'golden evening (the prologue) from the south-south-west: the pale city on its spur above the valley, the bell towers and the domed hall on the crown, the bridge over the Forest River, the Lonely Mountain rising behind',
    },
  ],
});
