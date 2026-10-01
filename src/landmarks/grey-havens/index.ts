import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { ForestDecl, LocalStamp, V2, V3 } from '../types.ts';
import { defineLandmark } from '../types.ts';
import { archOutline, planeRot } from '../hobbiton/parts.ts';

/**
 * The Grey Havens / Mithlond (research §17; the Return of the King still, Alan Lee's film concept): a
 * sheltered harbour at the head of the Gulf of Lune between two steep crags of pale rock — one rising out
 * of the sea north-west of the basin (its arm closing the harbour's north side), one on the point to the
 * south-west — with the mouth between them opening west onto the gulf. Round the basin a paved quay of
 * straight runs with angled corners, stairs down into the water and long arcaded halls fronting the water;
 * slender towers at the quay's ends and corners; a breakwater with a light at its head across the mouth;
 * the town behind: tall narrow halls of warm pale stone under dark slate, shoulder to shoulder in rows on
 * paved terraces stepping up round the basin, stairs between them, domes and towers at the rows' ends; the
 * white swan-prowed ship moored in the basin on the sun's path. The hero looks west over the town and the
 * basin, out through the mouth, into the low sun shining on the gulf.
 *
 * Local frame: x east, z south (heading 0), km round the display point; `anchor: 'water'`: local y = 0 is
 * the sea surface — the display point lies inside the basin's floor (the build throws if it ever ends up on
 * land: frame.ts would then silently anchor the harbour on the ground). Stamp heights are relative to the
 * base ground at the origin, BASE above the sea (a survey constant, checked by the build). The coast rises
 * steeply inland (≈ 0.9 per km), so the stamps lower a broad low amphitheatre round the harbour and a
 * valley (the trough) running east from it under the hero camera, cut a level quay terrace round the
 * basin just above the sea, sink the basin (the sea plane fills it), lower the sea floor round the crags and
 * raise them steep and narrow out of the water (their rock is kit cliff tiers seated on the stamps).
 */

const DEG = Math.PI / 180;
/** height of the base ground at the origin above the sea (the stamps' reference; survey, checked) */
const BASE = 1.611;
/** the harbour basin's centre and floor radius (the display point lies just inside it) */
const H: V2 = [-0.1, -1.05];
const BASIN_R = 1.05;
/** the quay terrace level, the quay top, the quay's inner (water) edge and the apron's outer edge radii */
const QUAY_Y = 0.08;
const QUAY_TOP = 0.1;
const QUAY_R = 1.14;
const APRON_R = 1.8;
/** the quay's corners (compass bearings round the basin): four straight runs, north end → south end */
const CORNERS = [6, 62, 120, 178, 236];
/** the low amphitheatre behind the quays (east of the basin) */
const AMPHI: V2 = [2.6, -1.2];
/** the crags: north (out of the sea), south (on the point) */
const NORTH: V2 = [-1.9, -3.3];
const SOUTH: V2 = [-2.2, 0.6];
/** the hero looks from this compass bearing; the trough runs that way from the town */
const VIEW_FROM = 100;

const PALE = 0xe8e6e0;
const PALE2 = 0xdcd8cc;
const STONE = 0xd8cfbd;
const PAVING = 0xcfc6b2;
const SLATE = 0x4b4f55;
const CRAG = 0x9d988c;
const LAMP = 0xffc878;

/** compass bearing and radius round a centre (default: the basin's) → local */
const polar = (b: number, r: number, c: V2 = H): V2 => [c[0] + Math.sin(b * DEG) * r, c[1] - Math.cos(b * DEG) * r];
/** house yaw whose front (+z) looks at the basin's centre from compass bearing b */
const toBasin = (b: number): number => -b;

/** the rows of the town on their terraces: radius of the halls' centre line, bearing runs (gaps = stairs) */
const ROWS: { r: number; runs: [number, number][] }[] = [
  {
    r: 2.02,
    runs: [
      [66, 104],
      [112, 150],
      [158, 196],
      [204, 226],
    ],
  },
  {
    r: 2.4,
    runs: [
      [74, 116],
      [124, 162],
      [170, 212],
    ],
  },
  {
    r: 2.78,
    runs: [
      [84, 112],
      [120, 156],
    ],
  },
];

function buildHavens(k: ProxyKit): void {
  // the survey constants behind the stamps and the water anchor must still hold
  const g0 = k.ground(0, 0);
  if (g0 > -0.05) throw new Error(`grey-havens: the display point is not under the sea (local ground ${g0.toFixed(3)}): the water anchor would fall back to the ground`);
  const gq = k.ground(...polar(110, APRON_R - 0.2));
  if (Math.abs(gq - QUAY_Y) > 0.02) throw new Error(`grey-havens: BASE ${BASE} is stale (quay terrace at ${gq.toFixed(3)} above the sea, expected ${QUAY_Y})`);

  let lamps = 0;
  const lamp = (p: V3, intensity = 1): void => {
    if (lamps >= 20) return;
    lamps++;
    k.light(p, { kind: 'lamp', color: LAMP, intensity, radius: 0.012 });
  };

  // ---------------------------------------------------------------- the quay: a paved platform of straight runs
  // inner (water) edge through the corners; the outer edge parallel to it out to the apron's rim; every
  // edge subdivided so the platform's sides follow the ground (its top level at QUAY_TOP: flush with the
  // terrace behind, a wall face down into the water in front)
  const inner = CORNERS.map((b) => polar(b, QUAY_R));
  const outer = CORNERS.map((b) => polar(b, APRON_R));
  const sub = (pts: V2[], step: number): V2[] => {
    const out: V2[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
      for (let j = 0; j < n; j++) out.push([ax + ((bx - ax) * j) / n, az + ((bz - az) * j) / n]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  };
  {
    // the north end runs on to the crag's foot (the arm), so no bare ground shows between them
    const ol = [polar(352, QUAY_R + 0.05), ...sub(inner, 0.1), ...sub([...outer].reverse(), 0.1), polar(352, APRON_R + 0.1)];
    const high = Math.max(...ol.map(([x, z]) => k.ground(x, z)));
    k.extrude('stone', ol, 0.004, {
      followGround: true,
      at: [0, QUAY_TOP - 0.004 - high, 0],
      color: PAVING,
      grain: 0.35,
      lod: 1,
    });
  }
  // the quay edge: a pale coping along every run, a hair proud
  for (let i = 0; i + 1 < inner.length; i++) {
    const [a, b] = [inner[i], inner[i + 1]];
    const yaw = (-Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    k.box('stone', Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.02, 0.012, 0.03, {
      at: [(a[0] + b[0]) / 2, QUAY_TOP - 0.006, (a[1] + b[1]) / 2],
      rot: [0, yaw, 0],
      color: PALE,
      lod: 0,
    });
  }

  /** a wall of `count` round-headed arches from a to b (its face to the right of a→b), standing at y */
  const arcadeWall = (a: V2, b: V2, count: number, hgt: number, y: number, t = 0.03): void => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const yaw = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI - 90;
    const pitch = L / count;
    const aw = pitch * 0.6;
    const holes: V2[][] = [];
    for (let i = 0; i < count; i++) {
      const u = -L / 2 + pitch * (i + 0.5);
      holes.push(archOutline(aw, hgt * 0.5, hgt * 0.78, -0.012, 8).map(([x, v]) => [x + u, v] as V2));
    }
    const outline: V2[] = [
      [-L / 2, 0],
      [L / 2, 0],
      [L / 2, -hgt],
      [-L / 2, -hgt],
    ];
    const c: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const [nx, nz] = [Math.sin(yaw * DEG), Math.cos(yaw * DEG)];
    k.extrude('stone', outline, t, {
      at: [c[0] - (nx * t) / 2, y, c[1] - (nz * t) / 2],
      rot: planeRot(yaw),
      holes,
      color: PALE,
      grain: 0.15,
      lod: 0,
    });
    // a cornice along the top
    k.box('stone', L + 0.01, 0.012, t * 1.7, {
      at: [c[0] + nx * 0.004, y + hgt, c[1] + nz * 0.004],
      rot: [0, yaw, 0],
      color: PALE2,
      lod: 0,
    });
  };

  // ---------------------------------------------------------------- along every run: an arcaded hall fronting the
  // water (a long hall under a low hipped slate roof, its water front a loggia of round arches), stairs down
  // into the water beside it, lamps on the quay edge
  for (let i = 0; i + 1 < inner.length; i++) {
    const [a, b] = [inner[i], inner[i + 1]];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / L;
    const uz = (b[1] - a[1]) / L;
    // the right of a → b looks at the water (the corners run clockwise round the basin)
    const [wx, wz] = [-uz, ux];
    const back = 0.15; // the loggia's face stands this far back from the quay edge
    const hl = L * 0.62;
    const mid = 0.46 + (i % 2) * 0.08; // along the run (fraction), leaving room for the stairs at one end
    const c: V2 = [a[0] + ux * L * mid - wx * back, a[1] + uz * L * mid - wz * back];
    const hgt = 0.15 + (i % 2) * 0.02;
    const yawH = (Math.atan2(wx, wz) * 180) / Math.PI;
    k.house('stone', 'slate', hl, 0.13, hgt, {
      at: [c[0] - wx * 0.085, QUAY_TOP - 0.004, c[1] - wz * 0.085],
      seat: false,
      rot: [0, yawH, 0],
      roof: 'hip',
      pitch: 26,
      overhang: 0.012,
      color: STONE,
      roofColor: SLATE,
      lod: 1,
    });
    const p0: V2 = [c[0] - ux * hl * 0.5, c[1] - uz * hl * 0.5];
    const p1: V2 = [c[0] + ux * hl * 0.5, c[1] + uz * hl * 0.5];
    arcadeWall(p0, p1, Math.max(4, Math.round(hl / 0.085)), hgt, QUAY_TOP - 0.004);
    // stairs down into the water at the run's free end, along the quay face
    const sEnd = mid > 0.5 ? 0.12 : 0.88;
    const s0: V2 = [a[0] + ux * L * sEnd + wx * 0.03, a[1] + uz * L * sEnd + wz * 0.03];
    const dir = mid > 0.5 ? -1 : 1;
    k.stairs(
      'stone',
      [
        [s0[0], QUAY_TOP - 0.002, s0[1]],
        [s0[0] + ux * dir * 0.16, -0.06, s0[1] + uz * dir * 0.16],
      ],
      0.05,
      { stepKm: 0.025, color: PALE2 },
    );
    // lamps on posts along the quay edge
    for (const f of [0.3, 0.7]) {
      const [x, z] = [a[0] + ux * L * f - wx * 0.04, a[1] + uz * L * f - wz * 0.04];
      k.cylinder('stone', 0.004, 0.006, 0.06, {
        at: [x, QUAY_TOP - 0.004, z],
        seg: 6,
        color: PALE,
        lod: 0,
      });
      lamp([x, QUAY_TOP + 0.06, z], 1.0);
    }
  }

  // ---------------------------------------------------------------- slender towers at the quay's ends and corners
  const tower = (p: V2, r: number, h: number, roof: 'spire' | 'dome', base: number, lod: 0 | 1 | 2 = 1): void => {
    k.tower('stone', r, h, {
      at: [p[0], base, p[1]],
      sides: 12,
      taper: 0.14,
      roof,
      roofFam: 'slate',
      roofColor: roof === 'dome' ? 0xc9c2b2 : SLATE,
      roofH: roof === 'spire' ? r * 3.8 : r * 1.1,
      color: PALE,
      lod,
    });
    // a ring of balcony at two-thirds
    k.cylinder('stone', r * 1.35, r * 1.35, 0.012, {
      at: [p[0], base + h * 0.68, p[1]],
      seg: 12,
      color: PALE2,
      lod: 0,
    });
  };
  for (const [b, r, h, roof] of [
    [CORNERS[0], 0.055, 0.5, 'spire'],
    [CORNERS[2], 0.05, 0.4, 'dome'],
    [CORNERS[4], 0.055, 0.55, 'spire'],
  ] as [number, number, number, 'spire' | 'dome'][]) {
    const p = polar(b, QUAY_R + 0.12);
    tower(p, r, h, roof, QUAY_TOP - 0.01);
    const [ox, oz] = [Math.sin(VIEW_FROM * DEG), -Math.cos(VIEW_FROM * DEG)];
    lamp([p[0] + ox * (r + 0.01), QUAY_TOP + h * 0.7, p[1] + oz * (r + 0.01)], 1.2);
  }

  // ---------------------------------------------------------------- the breakwater: a mole from the south crag's
  // foot north across the mouth, a light tower at its head
  {
    const pts: V2[] = [polar(242, QUAY_R + 0.25), polar(266, QUAY_R + 0.62), polar(290, QUAY_R + 0.72)];
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const yaw = (Math.atan2(q[0] - p[0], q[1] - p[1]) * 180) / Math.PI;
      k.box('stone', 0.08, 0.56, L + 0.07, {
        at: [(p[0] + q[0]) / 2, -0.5, (p[1] + q[1]) / 2],
        rot: [0, yaw, 0],
        color: PALE2,
        lod: 1,
      });
    }
    const c = pts[pts.length - 1];
    tower(c, 0.05, 0.34, 'dome', 0.05);
    lamp([c[0], 0.05 + 0.34 + 0.035, c[1]], 1.4);
  }

  // ---------------------------------------------------------------- the crags: tiers of pale rock round them, a tower on each top
  /** the radius round c along bearing b where the ground falls to local height y */
  const levelR = (c: V2, y: number, b: number): number => {
    const [dx, dz] = [Math.sin(b * DEG), -Math.cos(b * DEG)];
    let r = 0.04;
    while (r < 2.5 && k.ground(c[0] + dx * r, c[1] + dz * r) > y) r += 0.01;
    return r;
  };
  // (each tier: the level it rises from, its height, its arcs [from, to] walked with falling bearing — the
  // faces toward the mouth, the basin and the gulf; the arm's root and the shore are left to the turf)
  for (const [c, tiers, towerH] of [
    [
      NORTH,
      [
        [
          0.04,
          1.2,
          [
            [300, 134],
            [66, 20],
          ],
        ],
        [
          1.0,
          0.85,
          [
            [340, 130],
            [70, 0],
          ],
        ],
      ],
      0.6,
    ],
    [
      SOUTH,
      [
        [0.04, 1.15, [[420, 225]]],
        [0.95, 0.8, [[445, 190]]],
      ],
      0.5,
    ],
  ] as [V2, [number, number, [number, number][]][], number][]) {
    // the apex (the warped massif's top: the highest ground near its centre)
    let apex: V2 = c;
    for (let i = 0; i < 49; i++) {
      const p: V2 = [c[0] + ((i % 7) - 3) * 0.06, c[1] + (Math.floor(i / 7) - 3) * 0.06];
      if (k.ground(p[0], p[1]) > k.ground(apex[0], apex[1])) apex = p;
    }
    const top = k.ground(apex[0], apex[1]);
    // tiers: broken rings of bedded rock walked with falling bearing (the face looks out)
    tiers.forEach(([y, hh, arcs], ti) =>
      arcs.forEach(([from, to]) => {
        const path: V2[] = [];
        const hs: number[] = [];
        for (let b = from; b >= to; b -= 10) {
          const r = levelR(c, y, b) + (k.r(1) - 0.5) * 0.06;
          path.push(polar(b, r, c));
          hs.push(hh * (0.75 + 0.5 * k.r(2)));
        }
        k.cliff('weathered', path, hs, {
          color: CRAG,
          shade: 1 - ti * 0.04,
          rough: 0.55,
          strata: 0.75,
          soft: 0.3,
          depth: hh * 0.55,
          overhang: 0.04,
          taper: 0.25,
          lod: ti === 0 ? 1 : 0,
        });
      }),
    );
    // the crown: a rock plinth round the apex, the tower seated below the lowest ground round it, so the
    // terrain mesh (coarser than the bilinear height near a sharp top) never leaves it floating
    let low = top;
    for (let i = 0; i < 8; i++) low = Math.min(low, k.ground(...polar(i * 45, 0.12, apex)));
    const base = low - 0.045;
    const plinth: V2[] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      plinth.push([Math.cos(a) * (0.13 + 0.03 * k.r(6)), Math.sin(a) * (0.13 + 0.03 * k.r(6))]);
    }
    k.extrude('weathered', plinth, top - base + 0.06, {
      at: [apex[0], base, apex[1]],
      taper: 0.45,
      color: CRAG,
      shade: 0.95,
      grain: 0.9,
      lod: 1,
    });
    k.tower('stone', 0.06, towerH + (top - base), {
      at: [apex[0], base, apex[1]],
      sides: 12,
      taper: 0.16,
      roof: 'spire',
      roofFam: 'slate',
      roofColor: SLATE,
      roofH: 0.23,
      color: PALE,
      lod: 2,
    });
    k.cylinder('stone', 0.08, 0.08, 0.012, {
      at: [apex[0], top + towerH * 0.7, apex[1]],
      seg: 12,
      color: PALE2,
      lod: 0,
    });
    lamp([apex[0] + 0.07, top + towerH * 0.75, apex[1]], 1.1);
  }

  // ---------------------------------------------------------------- the town: tall narrow halls shoulder to shoulder
  // in rows on paved terraces stepping up round the basin, stairs in the gaps, a dome or a tower at each end
  let lit = 0;
  ROWS.forEach((row, ri) => {
    row.runs.forEach(([b0, b1], ui) => {
      // each run in pieces of ≈ 12° (two to four halls), every piece its own level terrace stepping with the
      // ground; a piece on ground too steep for a low terrace is left to the turf
      const nP = Math.max(1, Math.round((b1 - b0) / 12));
      for (let pi = 0; pi < nP; pi++) {
        const p0 = b0 + ((b1 - b0) * pi) / nP;
        const p1 = b0 + ((b1 - b0) * (pi + 1)) / nP;
        const fr = row.r - 0.17;
        const br = row.r + 0.15;
        const front: V2[] = [];
        const backE: V2[] = [];
        for (let b = p0; b <= p1 + 1e-6; b += (p1 - p0) / 3) {
          front.push(polar(b, fr));
          backE.push(polar(b, br));
        }
        const band = [...front, ...backE.reverse()];
        const gsB = band.map(([x, z]) => k.ground(x, z));
        const high = Math.max(...gsB);
        if (high - Math.min(...gsB) > 0.24) continue;
        const ty = Math.max(high, QUAY_TOP) + 0.022;
        k.extrude('stone', band, 0.004, { followGround: true, at: [0, ty - 0.004 - high, 0], color: PAVING, shade: 0.94 + 0.04 * ri, grain: 0.4, lod: 0 });
        // halls along the piece (shoulder to shoulder), on the terrace's back half
        let b = p0 + 0.25;
        let i = 0;
        let lastH = 0.24;
        while (b < p1 - 0.25) {
          const w = 0.15 + k.r(3) * 0.08;
          const db = (w / row.r / DEG) * 1.04;
          if (b + db > p1 - 0.2) break;
          const bb = b + db / 2;
          const p = polar(bb, row.r + 0.04);
          const h = 0.2 + k.r(4) * 0.09 + (ri === 0 ? 0 : 0.02);
          lastH = h;
          const d = 0.14 + k.r(5) * 0.03;
          const yaw = toBasin(bb);
          const litHere = lit < 5 && (i + ri + pi) % 5 === 2;
          if (litHere) lit++;
          k.house('stone', 'slate', w, d, h, {
            at: [p[0], ty - 0.004, p[1]],
            seat: false,
            rot: [0, yaw, 0],
            roof: k.r(6) < 0.6 ? 'hip' : 'gable',
            pitch: 36 + k.r(7) * 8,
            overhang: 0.01,
            color: STONE,
            shade: 0.9 + k.r(8) * 0.16,
            roofColor: SLATE,
            roofShade: 0.9 + k.r(9) * 0.2,
            lod: i % 3 === 0 ? 2 : 1,
            ...(litHere ? { windows: { count: 1, on: 1, sides: 1 as const, size: 0.01, color: LAMP, kind: 'window' as const } } : {}),
          });
          // tall arched-window strips on the front (one per bay)
          const [nx, nz] = [Math.sin(yaw * DEG), Math.cos(yaw * DEG)];
          const [rx, rz] = [Math.cos(yaw * DEG), -Math.sin(yaw * DEG)];
          for (let j = 0; j < 2; j++) {
            const u = (j - 0.5) * (w / 2);
            k.box('darkStone', 0.014, h * 0.62, 0.004, { at: [p[0] + rx * u + nx * (d / 2 + 0.001), ty + h * 0.16, p[1] + rz * u + nz * (d / 2 + 0.001)], rot: [0, yaw, 0], color: 0x3a3833, lod: 0 });
          }
          b += db;
          i++;
        }
        // a domed rotunda at the run's start, or a slender tower at its end (only at the rows' ends)
        if (pi === 0 && (ri + ui) % 2 === 0) {
          const q = polar(p0 + 1, row.r + 0.04);
          k.tower('stone', 0.07, lastH + 0.03, { at: [q[0], ty - 0.004, q[1]], sides: 10, roof: 'dome', roofFam: 'stone', roofColor: 0xc9c2b2, roofH: 0.07, color: STONE, lod: 0 });
        }
        if (pi === nP - 1 && (ri + ui) % 2 === 1) {
          const q = polar(p1 - 1, row.r + 0.04);
          k.tower('stone', 0.045, 0.34 + ri * 0.04, { at: [q[0], ty - 0.004, q[1]], sides: 8, taper: 0.12, roof: 'spire', roofFam: 'slate', roofColor: SLATE, roofH: 0.16, color: PALE, lod: 0 });
        }
      }
    });
  });
  // stairs up from the quay apron through the gaps between the runs
  for (const b of [62, 154, 200]) {
    const lo = polar(b, APRON_R - 0.04);
    const hi = polar(b, ROWS[1].r + 0.1);
    k.stairs(
      'stone',
      [
        [lo[0], QUAY_TOP - 0.002, lo[1]],
        [hi[0], Number.NaN, hi[1]],
      ],
      0.06,
      { stepKm: 0.07, color: PAVING },
    );
  }

  // ---------------------------------------------------------------- the white swan-ship, moored in the basin on the
  // sun's path (from the hero camera), broadside on — the diorama exaggerates it (≈ 1 km long, mast ≈ 0.55)
  {
    const S = 2.6;
    const along = 340 * DEG; // the bow looks north-north-west, toward the mouth
    const p = polar(270, 0.42);
    const ax: V2 = [Math.sin(along), -Math.cos(along)];
    const L = 0.38 * S;
    const sec = (w: number, len: number): V2[] => {
      const out: V2[] = [];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const c = Math.cos(a);
        // a slim ellipse, finer towards bow and stern
        out.push([Math.sin(a) * w * (1 - 0.4 * Math.abs(c) ** 1.5), c * len]);
      }
      return out;
    };
    const yawShip = (Math.atan2(ax[0], ax[1]) * 180) / Math.PI;
    k.loft(
      'plaster',
      [
        { outline: sec(0.012 * S, L * 0.4), y: -0.02 * S },
        { outline: sec(0.032 * S, L * 0.48), y: 0.012 * S },
        { outline: sec(0.04 * S, L * 0.5), y: 0.04 * S },
      ],
      { at: [p[0], 0, p[1]], rot: [0, yawShip, 0], color: 0xf2f0ea, lod: 2 },
    );
    // the swan's neck rising from the prow, curving forward and bowing its head
    const prow: V2 = [p[0] + ax[0] * L * 0.48, p[1] + ax[1] * L * 0.48];
    k.loft(
      'plaster',
      [0, 1, 2, 3, 4, 5].map((i) => {
        const t = i / 5;
        const r = 0.011 * S * (1 - t * 0.4);
        const ring: V2[] = Array.from({ length: 6 }, (_, j) => [Math.cos((j / 6) * Math.PI * 2) * r, Math.sin((j / 6) * Math.PI * 2) * r + (Math.sin(t * Math.PI * 0.9) * 0.03 + t * 0.014) * S]);
        return { outline: ring, y: (0.035 + t * 0.08) * S };
      }),
      {
        at: [prow[0], 0, prow[1]],
        rot: [0, yawShip, 0],
        color: 0xf6f4ee,
        lod: 1,
      },
    );
    // the mast and a pale sail
    k.cylinder('wood', 0.004 * S, 0.005 * S, 0.22 * S, {
      at: [p[0], 0.03 * S, p[1]],
      seg: 6,
      color: 0xd8cfb8,
      lod: 1,
    });
    k.box('plaster', 0.004 * S, 0.14 * S, 0.13 * S, {
      at: [p[0] - ax[0] * 0.015 * S, 0.075 * S, p[1] - ax[1] * 0.015 * S],
      rot: [0, yawShip, 0],
      color: 0xf4f0e4,
      lod: 1,
    });
    lamp([prow[0], 0.11 * S, prow[1]], 0.9);
  }
  // trees on the slopes behind the town (pines and beeches of Lindon)
  for (const [b, r] of [
    [40, 3.4],
    [70, 3.5],
    [100, 3.4],
    [125, 3.5],
    [160, 3.3],
    [185, 3.1],
    [215, 2.9],
  ] as [number, number][]) {
    const p = polar(b, r);
    k.tree(b % 2 ? 'conifer' : 'oak', p[0], p[1], {
      crownKm: 0.08 + (b % 3) * 0.02,
      heightKm: b % 2 ? 0.3 : 0.18,
    });
  }
}

/** the woods of Lindon on the rising land round the town (pines and beeches), clear of the halls */
const WOODS: ForestDecl[] = [
  {
    // a band round the east side (bearings 0–215 from the basin), 2.2–9 km beyond the quays (the valley's walls)
    area: {
      polygon: [...Array.from({ length: 23 }, (_, i) => polar(i * (215 / 22), BASIN_R + 9)), ...Array.from({ length: 23 }, (_, i) => polar(215 - i * (215 / 22), BASIN_R + 2.2))],
    },
    density: 24,
    species: [
      {
        kind: 'conifer',
        share: 0.35,
        crownKm: [0.06, 0.1],
        colors: [0x2f4a2c, 0x35512f, 0x2b4428],
      },
      {
        kind: 'oak',
        share: 0.65,
        crownKm: [0.07, 0.12],
        colors: [0x4a6a32, 0x557236, 0x5e7a3a],
      },
    ],
    clump: { scaleKm: 0.9, amount: 0.5 },
    edgeKm: 0.5,
    maxSlopeDeg: 72,
    minY: 0.15,
  },
];

/** the valley floor east of the amphitheatre: [distance from the origin along VIEW_FROM, height above the sea] */
const FLOOR: [number, number][] = [
  [5.5, 0.5],
  [7.5, 0.85],
  [9.5, 1.3],
  [11.5, 1.9],
  [13.5, 2.55],
  [15.5, 3.3],
];
/** the trough under the hero camera: a broad valley east from the amphitheatre (local, from the origin) */
const TROUGH: V2[] = [7.5, 11, 16.5].map((r) => [Math.sin(VIEW_FROM * DEG) * r, -Math.cos(VIEW_FROM * DEG) * r] as V2);

export default defineLandmark({
  id: 'grey-havens',
  placeId: 'grey-havens',
  tier: 'B',
  anchor: 'water',
  // heights relative to the base ground at the origin (BASE above the sea)
  stamps: [
    // the low amphitheatre behind the quays (lowerOnly: the gulf stays)
    {
      kind: 'flatten',
      at: AMPHI,
      radius: 2.4,
      falloff: 2.6,
      height: 0.42 - BASE,
      lowerOnly: true,
    },
    // and its south side (the coast rises steeply there): the town's southern rows stand on the same floor
    { kind: 'flatten', at: polar(180, 2.7), radius: 1.1, falloff: 1.0, height: 0.42 - BASE, lowerOnly: true },
    // the valley east under the hero camera (the coastal rise otherwise hides the harbour below ≈ 25°)
    { kind: 'carve', path: TROUGH, width: 3.0, falloff: 2.0, depth: 1.1 },
    // its floor: rising gently from the amphitheatre (a green valley floor, not a wall, under the hero)
    ...FLOOR.map(([d, y]): LocalStamp => ({ kind: 'flatten', at: [Math.sin(VIEW_FROM * DEG) * d, -Math.cos(VIEW_FROM * DEG) * d], radius: 1.5, falloff: 3.0, height: y - BASE, lowerOnly: true })),
    // the quay terrace cut round the harbour, just above the sea
    {
      kind: 'flatten',
      at: H,
      radius: APRON_R + 0.05,
      falloff: 0.4,
      height: QUAY_Y - BASE,
      lowerOnly: true,
    },
    // the basin: the sea plane fills it
    { kind: 'basin', at: H, radius: BASIN_R, floor: -0.4 - BASE, falloff: 0.3 },
    // the sea floor round the crags (lowerOnly): they rise steep and narrow straight out of the water
    {
      kind: 'flatten',
      at: NORTH,
      radius: 0.9,
      falloff: 0.7,
      height: -0.6 - BASE,
      lowerOnly: true,
    },
    {
      kind: 'flatten',
      at: SOUTH,
      radius: 0.85,
      falloff: 0.7,
      height: -0.6 - BASE,
      lowerOnly: true,
    },
    // the north crag out of the sea, its arm east closing the harbour's north side
    {
      kind: 'massif',
      at: NORTH,
      radius: 0.8,
      summit: 0.75,
      base: -2.75,
      exponent: 1.0,
      dome: 0.25,
      spurs: [
        {
          azimuthDeg: 100,
          lengthKm: 3.0,
          widthKm: 0.8,
          heightFrac: 0.5,
          rootFrac: 0.75,
        },
        {
          azimuthDeg: 300,
          lengthKm: 0.9,
          widthKm: 0.6,
          heightFrac: 0.45,
          rootFrac: 0.8,
        },
      ],
      flankSlope: 3.0,
      rough: { amp: 0.16, scaleKm: 1.6, ridged: true },
      surface: 'rock',
    },
    // the south crag on the point
    {
      kind: 'massif',
      at: SOUTH,
      radius: 0.75,
      summit: 0.6,
      base: -2.4,
      exponent: 1.0,
      dome: 0.25,
      spurs: [
        {
          azimuthDeg: 140,
          lengthKm: 1.5,
          widthKm: 0.8,
          heightFrac: 0.45,
          rootFrac: 0.75,
        },
      ],
      flankSlope: 3.0,
      rough: { amp: 0.14, scaleKm: 1.6, ridged: true },
      surface: 'rock',
    },
  ],
  lodPx: [80, 26],
  vegetationExclusion: [
    { at: H, r: 2.6 },
    { at: AMPHI, r: 1.6 },
    { at: NORTH, r: 0.9 },
    { at: SOUTH, r: 0.9 },
  ],
  forests: WOODS,
  proxy: buildHavens,
  annotation: {
    title: 'The Grey Havens',
    subtitle: 'Mithlond',
    blurb: 'Harbour of the Elves upon the Gulf of Lune, whence the last ships sail into the West.',
  },
  bookmarks: [
    {
      id: 'grey-havens-close',
      distanceKm: 26,
      elevationDeg: 21,
      // (a little south of the trough's axis: the line of sight then clears the crags' shoulders to most of the subject)
      azimuthDeg: VIEW_FROM + 4,
      fov: 15,
      lift: 0.3,
      aimKm: [-0.4, 0.8],
      tod: 18.3,
      compare: ['reference/film/grey-havens/grey-havens-rotk.jpg', 'reference/film/grey-havens/grey-havens-wide.webp', 'reference/concept-art/grey-havens/grey-havens-alan-lee-concept.jpg'],
      note: 'hero (regional, 26 km, the film’s last shot): golden-hour backlight (18.3, the sun low in the west-north-west) from over the valley east of the town — the pale town stepping down to the basin on its terraces, the quays and arcaded halls, the white swan-ship moored on the sun’s path, the towers on the two rock crags framing the mouth, and beyond it the gulf shining under the sun',
    },
  ],
});
