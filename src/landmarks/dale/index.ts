import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';
import { defineLandmark } from '../types.ts';

/**
 * Dale (research §14; the Desolation of Smaug still, the Unexpected Journey prologue): a city of pale
 * stone on a broad promontory in the valley before the Lonely Mountain — houses with dusty tile and
 * slate roofs wrapping the crown and the flanks in three terraces held by retaining walls, a continuous
 * curtain wall with towers and two gatehouses along the outer terrace's edge, rock breaking out of the
 * steep flanks below it; on the crown the gabled great hall with a low lantern and, beside it, the one
 * dominant square belfry (open arched bell stage, low pyramidal tile roof, banners on poles), two lesser
 * belfries on the terraces; a stone bridge over the Forest River below the nose; warm windows at night.
 *
 * Site (local km, x east, z south): the display point (places.json offset 22 km south of the canon point,
 * kept) lies on the Wilderland plateau 2–4 km north-east of its escarpment, which falls ≈ 3.3 to the
 * Forest River's valley; the river bends round below it (west, then south). The promontory is a broad
 * massif whose flat crown carries the city, its nose out over the valley (south-west) and its root a long
 * low ridge running back north-north-east across the plateau towards Erebor's southern foothills, so the
 * city sits on a spur of the mountain's skirt.
 */

/** the city: an ellipse along the spur (centre, half-axes along / across, axis bearing) */
const CITY = { at: [-1.45, 1.2] as V2, a: 1.65, b: 1.2, bearing: 225 };
const DEG = Math.PI / 180;
const ca = Math.cos(CITY.bearing * DEG);
const sa = Math.sin(CITY.bearing * DEG);
/** city frame (s along the spur towards the nose, t across) → local x, z */
const CF = (s: number, t: number): V2 => [CITY.at[0] + sa * s + ca * t, CITY.at[1] - ca * s + sa * t];
/** the hill's crown (massif centre) and the citadel on it */
const HILL: V2 = CF(0.25, 0);
const CROWN: V2 = CF(0.15, 0);
/** compass bearing (deg) → unit vector (x, z) */
const dirOf = (b: number): V2 => [Math.sin(b * DEG), -Math.cos(b * DEG)];
/** the hero looks at the city from this bearing (dale-close): lit windows face it */
const VIEW_FROM = 226;

const STONE = [0xcbbd9e, 0xc4b597, 0xd3c6a8, 0xbcae90, 0xc9b99a, 0xd8ccb0];
const ROOF = [0x7a5a4a, 0x5a6066, 0x6e5446, 0x4f565c, 0x84604c, 0x626a6e, 0x705a4c];
const WALL = 0xb9ab8c;
const RETAIN = 0xa99c7e;
const BANNER = [0xa33b2a, 0x2f5a8a];
const WARM = 0xe8a050;
const ROCK = 0x8a8170;

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
    k.light(p, { kind, color: WARM, intensity, radius: size });
  };
  const slope = (x: number, z: number): [number, number] => {
    const e = 0.06;
    return [(k.ground(x + e, z) - k.ground(x - e, z)) / (2 * e), (k.ground(x, z + e) - k.ground(x, z - e)) / (2 * e)];
  };

  // ---------------------------------------------------------------- the terraces: contour rings round the crown
  // (the outer one carries the curtain wall; inside the city ellipse; star-shaped from the crown)
  const L0 = k.ground(CROWN[0], CROWN[1]);
  const LEVELS = [L0 - 0.14, L0 - 0.3, L0 - 0.5];
  const ring = (level: number, grow: number): V2[] => {
    const out: V2[] = [];
    for (let b = 0; b < 360; b += 5) {
      const [dx, dz] = dirOf(b);
      let r = 0.1;
      while (r < 3 && k.ground(CROWN[0] + dx * r, CROWN[1] + dz * r) > level && inCity(CROWN[0] + dx * r, CROWN[1] + dz * r, grow)) r += 0.015;
      out.push([CROWN[0] + dx * r, CROWN[1] + dz * r]);
    }
    // smooth the ring a little (no saw teeth from the march)
    return out.map((p, i) => {
      const a = out[(i + out.length - 1) % out.length];
      const c = out[(i + 1) % out.length];
      return [(a[0] + 2 * p[0] + c[0]) / 4, (a[1] + 2 * p[1] + c[1]) / 4];
    });
  };
  const rings = LEVELS.map((L, i) => ring(L, i === 2 ? 1.04 : 1.0));
  const outer = rings[2];
  /** radius of the outer ring at the bearing of (x, z) from the crown */
  const ringR = (rg: V2[], x: number, z: number): number => {
    const b = ((Math.atan2(x - CROWN[0], -(z - CROWN[1])) / DEG + 360) % 360) / 5;
    const i = Math.floor(b);
    const f = b - i;
    const p = rg[i % rg.length];
    const q = rg[(i + 1) % rg.length];
    const r0 = Math.hypot(p[0] - CROWN[0], p[1] - CROWN[1]);
    const r1 = Math.hypot(q[0] - CROWN[0], q[1] - CROWN[1]);
    return r0 + (r1 - r0) * f;
  };
  const rOf = (x: number, z: number) => Math.hypot(x - CROWN[0], z - CROWN[1]);

  // retaining walls along the two inner terrace edges (the stepped town at hero range; LOD0)
  for (const rg of rings.slice(0, 2)) k.wallPath('stone', rg, 0.06, 0.035, { closed: true, followGround: true, step: 0.08, batter: 0.2, color: RETAIN, shadeJitter: 0.06, lod: 0 });
  // the curtain wall along the outer terrace's edge, crenellated, with towers
  k.wallPath('stone', outer, 0.1, 0.045, { closed: true, followGround: true, step: 0.06, batter: 0.18, color: WALL, shadeJitter: 0.06, crenel: { w: 0.02, h: 0.02, gap: 0.016, lod: 0 } });
  const gates = [40, 222];
  outer.forEach(([x, z], i) => {
    const b = i * 5;
    if (i % 6 !== 3 || gates.some((g) => Math.abs(((b - g + 540) % 360) - 180) < 14)) return;
    k.tower('stone', 0.048, 0.17, { at: [x, 0, z], seat: true, sides: 8, roof: 'cone', roofFam: 'roofTile', roofColor: ROOF[0], color: STONE[3], lod: 1 });
  });
  // the two gatehouses (towards Erebor's road, north-east, and down to the bridge, south-west): twin
  // square towers with pyramid roofs over an arch, a lamp, a banner on a pole
  for (const g of gates) {
    const i = Math.round(g / 5) % outer.length;
    const [x, z] = outer[i];
    const [tx, tz] = dirOf(g + 90);
    for (const s of [-1, 1]) {
      const px = x + tx * s * 0.075;
      const pz = z + tz * s * 0.075;
      k.tower('stone', 0.045, 0.2, { at: [px, 0, pz], seat: true, sides: 4, rot: [0, -g + 45, 0], roof: 'cone', roofH: 0.06, roofFam: 'roofTile', roofColor: ROOF[4], color: STONE[2], lod: 1 });
    }
    k.box('stone', 0.11, 0.05, 0.05, { at: [x, k.ground(x, z) + 0.1, z], rot: [0, -g, 0], color: STONE[0], lod: 0 });
    const [ox, oz] = dirOf(g);
    light([x + ox * 0.04, k.ground(x, z) + 0.08, z + oz * 0.04], 'lamp', 1.1, 0.014);
    // a banner on a pole over the arch, hanging clear of the wall
    const by = k.ground(x, z) + 0.15;
    k.box('wood', 0.006, 0.006, 0.05, { at: [x + ox * 0.045, by, z + oz * 0.045], rot: [0, -g, 0], color: 0x3a3028, lod: 0 });
    k.box('plaster', 0.03, 0.08, 0.004, { at: [x + ox * 0.065, by - 0.08, z + oz * 0.065], rot: [0, -g, 0], color: BANNER[g > 180 ? 0 : 1], lod: 0 });
  }

  // ---------------------------------------------------------------- the citadel on the crown
  const terr: V2[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    terr.push([CROWN[0] + Math.cos(a) * 0.4, CROWN[1] + Math.sin(a) * 0.34]);
  }
  k.extrude('stone', terr, 0.05, { followGround: true, color: WALL, shade: 0.95 });
  const ty = Math.max(...terr.map(([x, z]) => k.ground(x, z))) + 0.05;
  // the great hall: a long gabled hall with a cross wing, a low octagonal lantern over the crossing
  const HALL_YAW = 45;
  k.house('stone', 'roofTile', 0.46, 0.17, 0.15, { at: [CROWN[0], ty, CROWN[1]], seat: false, rot: [0, HALL_YAW, 0], pitch: 38, overhang: 0.012, color: STONE[0], roofColor: ROOF[0], ridge: { fam: 'stone', color: 0x8f8268, size: 0.01 }, lod: 2 });
  k.house('stone', 'roofTile', 0.26, 0.14, 0.13, { at: [CROWN[0], ty, CROWN[1]], seat: false, rot: [0, HALL_YAW + 90, 0], pitch: 38, overhang: 0.012, color: STONE[2], roofColor: ROOF[0], lod: 2 });
  k.tower('stone', 0.045, 0.06, { at: [CROWN[0], ty + 0.15 + 0.06, CROWN[1]], sides: 8, roof: 'dome', roofH: 0.035, roofFam: 'slate', roofColor: 0x6f7a7c, color: STONE[3], lod: 1 });
  // the hall's windows (the long south-east front)
  const [hfx, hfz] = dirOf(135);
  for (const s of [-0.12, 0, 0.12]) {
    const [ax, az] = dirOf(HALL_YAW + 90);
    light([CROWN[0] + ax * s + hfx * 0.09, ty + 0.07, CROWN[1] + az * s + hfz * 0.09], 'window', 1.0, 0.014);
  }

  /**
   * A stout square belfry (height ≈ 3.5–4× its width): a plain shaft, an open bell stage (corner piers
   * round a dark core, a cornice), a low pyramidal tile roof; banners hang from poles at the stage's foot.
   */
  const belfry = (x: number, z: number, r: number, shaft: number, yaw: number, banners: number[], lod: 0 | 1 | 2): void => {
    let g = Infinity;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) g = Math.min(g, k.ground(x + a * r, z + b * r));
    const y0 = g - 0.02;
    const rot: V3 = [0, yaw, 0];
    k.box('stone', 2 * r, shaft, 2 * r, { at: [x, y0, z], rot, color: STONE[1], lod });
    k.box('stone', 2 * r + 0.012, 0.014, 2 * r + 0.012, { at: [x, y0 + shaft - 0.014, z], rot, color: STONE[3], lod: 0 });
    // the bell stage: four corner piers, the dark open core between them, a cornice
    const st = r * 0.75;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const c = Math.cos(yaw * DEG);
      const sn = Math.sin(yaw * DEG);
      const lx = a * (r - r * 0.18);
      const lz = b * (r - r * 0.18);
      k.box('stone', r * 0.36, st, r * 0.36, { at: [x + lx * c + lz * sn, y0 + shaft, z - lx * sn + lz * c], rot, color: STONE[0], lod: 1 });
    }
    k.box('darkStone', 2 * r * 0.8, st, 2 * r * 0.8, { at: [x, y0 + shaft, z], rot, color: 0x2a2520, lod: 1 });
    k.box('stone', 2 * r + 0.016, 0.018, 2 * r + 0.016, { at: [x, y0 + shaft + st, z], rot, color: STONE[3], lod: 1 });
    k.cone('roofTile', r * 1.45, r * 1.15, { at: [x, y0 + shaft + st + 0.018, z], seg: 4, rot: [0, yaw + 45, 0], color: ROOF[4], lod });
    // the bell stage glows at night (a lamp in the belfry)
    light([x, y0 + shaft + st * 0.5, z], 'lamp', 1.2, 0.014);
    // banners on poles: from the shaft's face just below the stage, hanging clear of the wall
    for (const fb of banners) {
      const [nx, nz] = dirOf(fb);
      const py = y0 + shaft - 0.03;
      k.box('wood', 0.006, 0.006, 0.06, { at: [x + nx * (r + 0.03), py, z + nz * (r + 0.03)], rot: [0, -fb, 0], color: 0x3a3028, lod: 0 });
      k.box('plaster', 0.032, r * 2.2, 0.004, { at: [x + nx * (r + 0.05), py - r * 2.2, z + nz * (r + 0.05)], rot: [0, -fb, 0], color: BANNER[Math.round(fb / 90) % 2], lod: 0 });
    }
  };
  // the dominant belfry beside the hall (east of it), two lesser ones on the terraces
  {
    const [bx, bz] = [CROWN[0] + 0.33, CROWN[1] - 0.12];
    belfry(bx, bz, 0.068, 0.36, HALL_YAW, [225, 135], 2);
    const p2 = CF(-0.55, 0.62);
    belfry(p2[0], p2[1], 0.048, 0.22, HALL_YAW + 8, [225], 1);
    const p3 = CF(0.95, -0.45);
    belfry(p3[0], p3[1], 0.045, 0.2, HALL_YAW - 6, [230], 1);
  }

  // ---------------------------------------------------------------- the town: houses on the terraces
  const avoidPts: V2[] = [
    [CROWN[0] + 0.33, CROWN[1] - 0.12],
    CF(-0.55, 0.62),
    CF(0.95, -0.45),
  ];
  /** distance from (x, z) to a ring polyline */
  const ringDist = (rg: V2[], x: number, z: number): number => {
    let best = Infinity;
    for (let i = 0; i < rg.length; i++) {
      const a = rg[i];
      const b = rg[(i + 1) % rg.length];
      const ex = b[0] - a[0];
      const ez = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez || 1)));
      best = Math.min(best, Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t));
    }
    return best;
  };
  const toView = dirOf(VIEW_FROM);
  let n = 0;
  let lit = 0;
  for (let s = -CITY.a; s <= CITY.a; s += 0.1) {
    for (let t = -CITY.b; t <= CITY.b; t += 0.105) {
      const js = s + (k.r(1) - 0.5) * 0.05;
      const jt = t + (k.r(2) - 0.5) * 0.05;
      const [x, z] = CF(js, jt);
      // inside the curtain wall (clear of it), off the citadel, clear of the terrace walls and the belfries
      const r = rOf(x, z);
      if (r > ringR(outer, x, z) - 0.09 || r < 0.5 || k.r(3) < 0.08) continue;
      if (avoidPts.some(([ax, az]) => Math.hypot(x - ax, z - az) < 0.12)) continue;
      if (rings.slice(0, 2).some((rg) => ringDist(rg, x, z) < 0.05)) continue;
      const [gx, gz] = slope(x, z);
      const gm = Math.hypot(gx, gz);
      if (gm > 1.6) continue;
      const w = 0.085 + k.r(4) * 0.06;
      let d = 0.065 + k.r(5) * 0.03;
      const h = 0.055 + k.r(6) * 0.05;
      const yaw = gm > 0.08 ? (Math.atan2(-gx, -gz) * 180) / Math.PI : CITY.bearing + (k.r(7) < 0.5 ? 0 : 90);
      // a visible plinth of at most half a storey: shallower houses on the steeper ground, else none
      const ny = (yaw * Math.PI) / 180;
      const span = (dd: number) => {
        const cs = [-1, 1].flatMap((a) => [-1, 1].map((b) => k.ground(x + Math.cos(ny) * a * (w / 2) + Math.sin(ny) * b * (dd / 2), z - Math.sin(ny) * a * (w / 2) + Math.cos(ny) * b * (dd / 2))));
        return Math.max(...cs, k.ground(x, z)) - Math.min(...cs, k.ground(x, z));
      };
      const DIG = 0.42;
      if (span(d) - DIG * h > 0.022) d = 0.055;
      if (span(d) - DIG * h > 0.022) continue;
      const i = n++;
      const isLit = lit < 46 && k.r(14) < 0.5;
      k.house('stone', i % 3 === 2 ? 'slate' : 'roofTile', w, d, h, {
        at: [x, 0, z],
        rot: [0, yaw + (k.r(8) - 0.5) * 10, 0],
        roof: k.r(9) < 0.2 ? 'hip' : 'gable',
        pitch: 36 + k.r(10) * 14,
        overhang: 0.01,
        dig: DIG,
        color: STONE[i % STONE.length],
        shade: 0.92 + k.r(11) * 0.16,
        roofColor: ROOF[(i * 5 + 2) % ROOF.length],
        roofGrain: 0.4,
        plinthFam: 'stone',
        plinthColor: RETAIN,
        lod: i % 5 === 0 ? 2 : i % 5 === 2 ? 1 : 0,
        ridge: { fam: 'stone', color: 0x8f8268, size: 0.008 },
        ...(i % 2 === 1 ? { chimney: true } : {}),
      });
      if (isLit) {
        // the lit window goes on the wall that looks most towards the hero (south-south-west); house yaw
        // maps local +z to (sin, cos) and +x to (cos, −sin)
        const faces: [number, number, number][] = [
          [Math.sin(ny), Math.cos(ny), d / 2],
          [-Math.sin(ny), -Math.cos(ny), d / 2],
          [Math.cos(ny), -Math.sin(ny), w / 2],
          [-Math.cos(ny), Math.sin(ny), w / 2],
        ];
        const [fx, fz, off] = faces.reduce((a, b) => (b[0] * toView[0] + b[1] * toView[1] > a[0] * toView[0] + a[1] * toView[1] ? b : a));
        // the house floor as the kit seats it (lowest corner, or dug in by DIG of the wall height)
        const cs = [-1, 1].flatMap((a) => [-1, 1].map((b) => k.ground(x + Math.cos(ny) * a * (w / 2) + Math.sin(ny) * b * (d / 2), z - Math.sin(ny) * a * (w / 2) + Math.cos(ny) * b * (d / 2))));
        const floor = Math.max(Math.min(...cs, k.ground(x, z)), Math.max(...cs, k.ground(x, z)) - DIG * h) - 0.02;
        const wy = floor + h * 0.72;
        const wx = x + fx * (off + 0.004);
        const wz = z + fz * (off + 0.004);
        // only where that wall stands free (not the uphill wall dug into the slope)
        if (k.ground(wx + fx * 0.01, wz + fz * 0.01) < wy - 0.012) {
          light([wx, wy, wz], 'window', 0.8 + k.r(12) * 0.6, 0.015);
          lit++;
        }
      }
    }
  }

  // ---------------------------------------------------------------- rock breaking out of the steep flanks below the wall
  // (faceted crags on the arcs where the flank is steep; walked with decreasing bearing so they face out)
  {
    const crag: { p: V2; steep: boolean }[] = [];
    for (let b = 355; b >= 0; b -= 5) {
      const i = Math.round(b / 5) % outer.length;
      const [x, z] = outer[i];
      const [dx, dz] = dirOf(b);
      const r0 = 0.16;
      const p: V2 = [x + dx * r0, z + dz * r0];
      const [gx, gz] = slope(p[0], p[1]);
      crag.push({ p, steep: Math.hypot(gx, gz) > 1.1 });
    }
    let run: V2[] = [];
    const flush = () => {
      if (run.length >= 4) {
        const hs = run.map((_, j) => 0.12 + 0.12 * Math.sin((j / (run.length - 1)) * Math.PI) + k.r(1) * 0.06);
        k.cliff('weathered', run, hs, { depth: 0.18, rough: 0.5, strata: 0.45, soft: 0.45, overhang: 0.05, color: ROCK, lod: 1 });
      }
      run = [];
    };
    for (const c of crag) {
      if (c.steep) run.push(c.p);
      else flush();
    }
    flush();
  }

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
  // the promontory: a broad, gently domed massif on the plateau's edge (≈ 1 above the plateau; its
  // south-western end stands on the escarpment's lip, ≈ 4.3 over the valley), its nose south-west over
  // the Forest River, its root a long low ridge back north-north-east across the plateau towards Erebor's
  // foothills; flanks gentle enough for the town to wrap down them in terraces — never lowers
  stamps: [
    {
      kind: 'massif',
      at: HILL,
      radius: 2.2,
      summit: 1.0,
      base: -0.25,
      exponent: 1.0,
      dome: 0.5,
      // (the nose and the southern arm stay short: the escarpment's lip is ≈ 1 km south-west of the crown,
      // and the stamp must not fill the valley down to the Forest River's banks)
      spurs: [
        { azimuthDeg: 24, lengthKm: 9, widthKm: 2.2, heightFrac: 0.55, rootFrac: 0.95 },
        { azimuthDeg: 222, lengthKm: 1.5, widthKm: 1.6, heightFrac: 0.7, rootFrac: 0.95 },
        { azimuthDeg: 150, lengthKm: 1.4, widthKm: 1.3, heightFrac: 0.5, rootFrac: 0.9 },
        { azimuthDeg: 300, lengthKm: 2.4, widthKm: 1.5, heightFrac: 0.5, rootFrac: 0.9 },
      ],
      flankSlope: 1.0,
      rough: { amp: 0.22, scaleKm: 1.8, ridged: true },
    },
    // the crown eased a little for the citadel
    { kind: 'flatten', at: HILL, radius: 0.45, falloff: 0.6, height: 0.95, strength: 0.35 },
  ],
  lodPx: [70, 24],
  // the city and the Desolation between it and the Mountain: no trees
  vegetationExclusion: [
    { at: CITY.at, r: 2.2 },
    { at: [1.5, -7], r: 7 },
  ],
  proxy: buildDale,
  annotation: { title: 'Dale', subtitle: 'City of Men below the Mountain', blurb: 'Once a merry town of bells and toys, laid waste by Smaug and rebuilt by Bard.' },
  bookmarks: [
    {
      id: 'dale-close',
      distanceKm: 20,
      elevationDeg: 11,
      azimuthDeg: 226,
      fov: 14,
      lift: 0.1,
      aimKm: [-1.9, -1.6],
      tod: 18.0,
      dayOfYear: 240,
      compare: ['reference/film/dale/dale-ruins-dos.jpg', 'reference/film/dale/dale-city-auj.jpg'],
      note: 'golden evening (the prologue) from the south-west, down the line of the bridge, the low sun from the west: the pale terraced city on its promontory over the escarpment, walls and gatehouses, the great hall and the belfry on the crown, the Forest River bending below with the six-arch bridge in the foreground, the Lonely Mountain’s western flank behind on the left. From this side Erebor’s Front Gate (and its summit, 2–4° from the gate’s bearing from any southern viewpoint) stays out of frame: the gate no longer dwarfs the city',
    },
  ],
});
