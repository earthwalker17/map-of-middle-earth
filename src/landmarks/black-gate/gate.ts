import { Euler, Matrix4 } from 'three/webgpu';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';

/**
 * The Morannon's kit geometry (local: x east, z south, the gate at the origin, the plain in front at −z;
 * the pass floor is level at y ≈ 0 for |x| < 7, the ridges rise steeply beyond).
 *
 *  - the wall: an iron rampart 3.6 km high (≈ 0.58 of the Towers' shelves, 6.2 above the floor) closing
 *    the whole pass — its top stays LEVEL while its foot follows the ground, so at both ends it dies into
 *    the rising rock of the ridges under the Towers. A battered talus along its foot; broad, deep
 *    prow-fronted buttresses every 2 km (0.5 km wide, raked back ≈ 16°, their tops tucked under the hood:
 *    a rhythm of masses, not of posts); between them, three rows of massive iron plates 1.4 km wide hung
 *    like armour scales (each tilted out at its lower edge over the row below), iron, soot or rust-brown
 *    per plate, rivet bosses along their edges, a whole-bay plated slab behind them for mid distance; the
 *    crest flares out in a continuous plated hood of dark metal (the film's hooked top), a few raked
 *    spikes on its lip.
 *  - the gate: two leaves 4.8 high (well above the wall) of dark metal (roughness 0.4: a sheen in the
 *    afternoon sun), each a heavy slab with a raised frame, three banded tiers of panels in relief, rows
 *    of great rivet bosses and forward spikes, under a spiked lintel and a crest of five iron fangs (the
 *    central one 4.8 high) between two gate towers 6.3 high in the Towers' language: battered stepped
 *    bases, vertical ribs, banded collars, spiked merlons and fire bowls.
 *  - the Towers of the Teeth on their shelves high on the flanks: a stepped, battered octagonal plinth
 *    (its foot following the rock), eight buttress fins flaring onto it, a broad banded fin-bundle shaft
 *    (r 0.82, 5.4 high), a flared collar, a lantern and a crown of spikes round a central spire — ≈ 9.4
 *    high, standing clear above the crags.
 *  - crags: fractured basalt round the front of each Tower's knob (two stepped bands of kit cliff, low
 *    enough that their skylines read as broken ledges, not spires) and along the ridge flanks facing the
 *    pass, flat-topped broken blocks on the crests, scree fans at their feet — none on the Towers or the
 *    wall; a great stepped outcrop on the plain in front (the hero's repoussoir).
 *  - braziers (fire, night gate): the gate towers, the wall walk, the Towers' lanterns.
 *
 * Iron parts use the 'iron' family (metallic, roughness 0.5: the specular ambient keeps them from going
 * black in shade) in the research palette #292b25…#3a3b35; masonry on 'weathered' / 'darkStone'.
 */

const IRON = 0x3a3b35;
const IRON_DARK = 0x2e2f2a;
const IRON_HI = 0x4a4a43;
const RUST = 0x5a4130;
const SOOT = 0x21221f;
const TALUS = 0x3a3936;
const TOWER = 0x3e3f3b;
const TOWER_DARK = 0x323330;
const SPIKE = 0x2b2c28;
const ROCK = 0x3a3936;
const ROCK2 = 0x302f2d;

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
const SINK = 0.02;

/** the wall's level top (local y; the pass floor is ≈ 0) */
export const WALL_TOP = 3.6;
/** wall thickness at the foot and at the top */
const T0 = 1.0;
const T1 = 0.55;
/** the battered talus along the front: height and run */
const TALUS_H = 0.9;
const TALUS_RUN = 0.55;
/** buttress spacing along the wall */
const BAY = 2.0;
/** gate: leaf height, half width of the opening, gate-tower centre */
const LEAF_H = 4.8;
const GATE_HW = 1.5;
const GT_X = 2.05;

/** the west half, from the flank of the west ridge (under the Tower) to the west gate tower */
const WEST: V2[] = [
  [-8.5, -1.55],
  [-7.9, -1.1],
  [-6.8, -0.3],
  [-5.2, 0.08],
  [-3.2, 0.15],
  [-GT_X, 0],
];

/** the Towers of the Teeth: shelf centres (local) — stamped shelves in index.ts */
export const TOWERS: V2[] = [
  [-8.6, -1.8],
  [8.6, -1.8],
];

/** the ridges' crest lines (local) — the stamps in index.ts; the crags follow them */
export const WEST_RIDGE: V2[] = [
  [-11.6, -4.8],
  [-11.2, -1],
  [-11.7, 4],
  [-13.8, 10],
  [-17.4, 17],
  [-21, 25],
];
export const EAST_RIDGE: V2[] = [
  [11.6, -4.8],
  [11.2, -1],
  [11.7, 4],
  [14.4, 9],
  [20.5, 12.5],
  [28, 14.5],
];

/** fin-bundle section: `n` flat-topped fins, fin i's tip at angle phase + i·τ/n */
function finSection(n: number, rIn: number, rOut: number, w: number, phase = 0): V2[] {
  const pts: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU;
    const v = a - Math.PI / n;
    pts.push([Math.cos(v) * rIn, Math.sin(v) * rIn]);
    pts.push([Math.cos(a - w) * rOut, Math.sin(a - w) * rOut]);
    pts.push([Math.cos(a + w) * rOut, Math.sin(a + w) * rOut]);
  }
  return pts;
}

/** a regular n-gon of radius r */
function ngon(n: number, r: number, phase = 0): V2[] {
  return Array.from({ length: n }, (_, i): V2 => [Math.cos(phase + (i / n) * TAU) * r, Math.sin(phase + (i / n) * TAU) * r]);
}

/** Euler (deg) tilting +y by `t` rad toward the horizontal direction at angle `phi` (x = cos, z = sin) */
function tilt(phi: number, t: number): V3 {
  const rz = -Math.asin(Math.sin(t) * Math.cos(phi));
  const rx = Math.atan2(Math.sin(t) * Math.sin(phi), Math.cos(t));
  return [rx * DEG, 0, rz * DEG];
}

/** Euler XYZ (deg) of Ry(yaw)·Rx(pitch): a part pitched about its own x axis, then turned by yaw */
function yawPitch(yawDeg: number, pitchDeg: number): V3 {
  const m = new Matrix4().makeRotationY(yawDeg / DEG).multiply(new Matrix4().makeRotationX(pitchDeg / DEG));
  const e = new Euler().setFromRotationMatrix(m, 'XYZ');
  return [e.x * DEG, e.y * DEG, e.z * DEG];
}

/** arc-length sampler of a polyline: point + unit direction at distance t */
function sampler(path: V2[]): { len: number; at: (t: number) => { p: V2; d: V2 } } {
  const segs: { a: V2; b: V2; l: number; s: number }[] = [];
  let len = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const l = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
    segs.push({ a: path[i], b: path[i + 1], l, s: len });
    len += l;
  }
  return {
    len,
    at: (t: number) => {
      const sg = segs.find((q) => t <= q.s + q.l) ?? segs[segs.length - 1];
      const f = sg.l > 0 ? Math.min(1, Math.max(0, (t - sg.s) / sg.l)) : 0;
      const d: V2 = [(sg.b[0] - sg.a[0]) / (sg.l || 1), (sg.b[1] - sg.a[1]) / (sg.l || 1)];
      return { p: [sg.a[0] + (sg.b[0] - sg.a[0]) * f, sg.a[1] + (sg.b[1] - sg.a[1]) * f], d };
    },
  };
}

/** a rectangle outline u0..u1 (along x) × v0..v1 (along z) */
const rect = (u0: number, u1: number, v0: number, v1: number): V2[] => [
  [u0, v0],
  [u1, v0],
  [u1, v1],
  [u0, v1],
];

/**
 * A frame on the wall line at `p` with direction `d`: the front normal `f` (towards the plain, −z), the
 * along-wall axis `u` (so that a loft / box placed with `yaw` has local +x = u and local −z = front), and
 * a point helper (s along the wall, v towards the front).
 */
function frame(p: V2, d: V2): { f: V2; u: V2; yaw: number; pt: (s: number, v: number) => V2 } {
  // the front normal: the one of ±(−d.z, d.x) with −z
  let f: V2 = [-d[1], d[0]];
  if (f[1] > 0) f = [-f[0], -f[1]];
  const u: V2 = [-f[1], f[0]];
  const yaw = -Math.atan2(u[1], u[0]) * DEG;
  return { f, u, yaw, pt: (s, v) => [p[0] + u[0] * s + f[0] * v, p[1] + u[1] * s + f[1] * v] };
}

/** lowest ground under a set of points */
function minG(k: ProxyKit, pts: V2[]): number {
  return Math.min(...pts.map(([x, z]) => k.ground(x, z)));
}

/** the highest ground under a ring of radius r round (x, z) */
function maxGround(k: ProxyKit, x: number, z: number, r: number): number {
  let m = k.ground(x, z);
  for (let j = 0; j < 16; j++) {
    const a = (j / 16) * TAU;
    m = Math.max(m, k.ground(x + Math.cos(a) * r, z + Math.sin(a) * r));
  }
  return m;
}

/**
 * a brazier: an iron bowl on a short stem with a flame and a fire light, base at (x, y, z). Night-gated
 * (the film shows no fires on the gate by day). Near-black paint at high strength: the glow material's
 * albedo is the paint × 0.25, so by day the flame is a dark ember, not a red cone.
 */
function brazier(k: ProxyKit, x: number, y: number, z: number, s = 1): void {
  k.cylinder('iron', 0.035 * s, 0.06 * s, 0.16 * s, { at: [x, y, z], seg: 6, color: IRON_DARK, lod: 0 });
  k.cylinder('iron', 0.16 * s, 0.08 * s, 0.1 * s, { at: [x, y + 0.16 * s, z], seg: 8, color: IRON_DARK, lod: 0 });
  k.cone('emissive', 0.11 * s, 0.3 * s, { at: [x, y + 0.23 * s, z], seg: 6, color: 0x3a1004, glow: { gate: 'night', strength: 14, flicker: 0.3 }, lod: 0 });
  k.light([x, y + 0.36 * s, z], { kind: 'fire', gate: 'night', color: 0xff9a3c, intensity: 1.8, radius: 0.09 * s });
}

/** a spiked crown: `n` spikes leaning out round radius r at height y, plus an optional central spire */
function spikeCrown(k: ProxyKit, x: number, z: number, y: number, r: number, n: number, h: number, spire: number, base = 0.07): void {
  for (let j = 0; j < n; j++) {
    const a = (j / n) * TAU + 0.2;
    const big = j % 2 === 0;
    k.cone('iron', big ? base : base * 0.75, h * (big ? 1 : 0.62) * (0.88 + 0.24 * k.r()), {
      at: [x + Math.cos(a) * r, y - 0.05, z + Math.sin(a) * r],
      rot: tilt(a, big ? 0.2 : 0.38),
      seg: 4,
      color: SPIKE,
      lod: big ? 1 : 0,
    });
  }
  if (spire > 0) k.cone('darkStone', r * 0.42, spire, { at: [x, y - 0.05, z], seg: 6, color: TOWER_DARK, faceted: true });
}

// ------------------------------------------------------------------------------------------- the wall

/** paint of a plate: mostly iron, some sooty (more on the higher rows), a fair share rust-brown */
function platePaint(k: ProxyKit, row: number): { color: number; shade: number } {
  const r = k.r();
  if (r < 0.2) return { color: RUST, shade: 0.9 + 0.2 * k.r() };
  if (r < 0.38 + 0.1 * row) return { color: SOOT, shade: 0.9 + 0.2 * k.r() };
  return { color: r < 0.75 ? IRON : IRON_HI, shade: 0.88 + 0.24 * k.r() };
}

/** the plate rows of a bay: [bottom, top] above the pass floor (the hood starts at WALL_TOP − 0.5) */
const ROWS: [number, number][] = [
  [0.9, 1.78],
  [1.68, 2.52],
  [2.42, 3.16],
];
/** the hood: a plated cornice leaning out from WALL_TOP − 0.5 */
const HOOD_Y = WALL_TOP - 0.5;
const HOOD_L = 0.7;
const HOOD_DEG = 50;

/** one half of the wall (its path runs from the ridge flank to its gate tower) */
function wallHalf(k: ProxyKit, path: V2[]): void {
  const s = sampler(path);
  // ---- the body and the talus, in straight runs of ≤ 0.5 km following the ground at the foot; the top
  // stays level at WALL_TOP (where the rising rock comes within 0.4 of it the wall has ended)
  const nSeg = Math.ceil(s.len / 0.5);
  for (let i = 0; i < nSeg; i++) {
    const t0 = (i / nSeg) * s.len;
    const t1 = ((i + 1) / nSeg) * s.len;
    const a = s.at(t0).p;
    const b = s.at(t1).p;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d: V2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const fr = frame(mid, d);
    const hl = L / 2 + T0 / 2;
    const base = minG(k, [fr.pt(-hl, T0 / 2), fr.pt(hl, T0 / 2), fr.pt(-hl, -T0 / 2), fr.pt(hl, -T0 / 2), mid]) - SINK;
    const h = WALL_TOP - base;
    if (h < 0.4) continue;
    k.loft(
      'iron',
      [
        { outline: rect(-hl, hl, -T0 / 2, T0 / 2), y: 0 },
        { outline: rect(-hl, hl, -T1 / 2, T1 / 2), y: h },
      ],
      { at: [mid[0], base, mid[1]], rot: [0, fr.yaw, 0], color: IRON_DARK, shade: 0.95 + 0.1 * k.r() },
    );
    // the talus: a battered skirt of dark masonry along the front foot (local −z = front)
    const th = Math.min(TALUS_H, h - 0.3);
    if (th > 0.15) {
      const tb = minG(k, [fr.pt(-hl, T0 / 2 + TALUS_RUN), fr.pt(hl, T0 / 2 + TALUS_RUN), fr.pt(0, T0 / 2 + TALUS_RUN)]) - SINK;
      const yb = Math.min(base, tb);
      k.loft(
        'weathered',
        [
          { outline: rect(-hl, hl, -(T0 / 2 + TALUS_RUN), -T0 / 2 + 0.1), y: 0 },
          { outline: rect(-hl, hl, -(T0 / 2 + 0.04), -T0 / 2 + 0.1), y: base - yb + th },
        ],
        { at: [mid[0], yb, mid[1]], rot: [0, fr.yaw, 0], color: TALUS, shade: 0.92 + 0.12 * k.r() },
      );
    }
  }
  // the front face's offset from the wall line at height y above a base (battered)
  const faceAt = (yAbove: number, h: number) => T0 / 2 - ((T0 - T1) / 2) * (yAbove / h);
  // ---- buttresses (from the gate tower outwards, every BAY): broad, deep prow-fronted piers raked back
  // ≈ 16° up the face, their tops tucked under the hood's lip so the hood runs on over them — no caps,
  // no spikes of their own (a rhythm of masses, not of posts)
  const nb = Math.floor((s.len - 0.6) / BAY);
  for (let j = 1; j <= nb; j++) {
    const t = s.len - j * BAY;
    const { p, d } = s.at(t);
    const fr = frame(p, d);
    const base = minG(k, [fr.pt(-0.25, 0), fr.pt(0.25, 0), fr.pt(0, T0 / 2 + 1.1), fr.pt(0, T0 / 2 + 0.5)]) - SINK;
    const h = WALL_TOP - base;
    if (h < 1.0) continue;
    // (u along the wall, v towards the front) → loft (x, z) = (u, −v)
    const prow = (w: number, back: number, front: number): V2[] =>
      [
        [-w, back],
        [w, back],
        [w, front - w * 0.8],
        [0, front],
        [-w, front - w * 0.8],
      ].map(([u, v]): V2 => [u, -v]);
    const hy = HOOD_Y - base;
    k.loft(
      'iron',
      [
        { outline: prow(0.25, -0.1, T0 / 2 + 1.1), y: 0 },
        { outline: prow(0.235, -0.1, faceAt(hy * 0.5, h) + 0.72), y: hy * 0.5 },
        { outline: prow(0.22, -0.1, faceAt(hy, h) + 0.4), y: hy },
        { outline: prow(0.21, -0.1, faceAt(hy, h) + 0.46), y: h - 0.08 },
      ],
      { at: [p[0], base, p[1]], rot: [0, fr.yaw, 0], color: IRON, shade: 0.95 + 0.12 * k.r() },
    );
  }
  // ---- each bay between two buttresses: three rows of massive armour plates, each hung from its top
  // edge on the battered face and tilted out at its lower edge over the row below (one plate per row,
  // 1.4 km wide; iron, soot or rust), a ring of rivet bosses; behind them a whole-bay plated slab (the
  // plates' read at mid distance, LOD1); over the bay the hood, running on unbroken over the buttresses
  for (let j = 0; j <= nb; j++) {
    const t = s.len - (j + 0.5) * BAY;
    if (t < 0.4) continue;
    const { p, d } = s.at(t);
    const fr = frame(p, d);
    const w = BAY - 0.56;
    const footG = minG(k, [fr.pt(-w / 2, T0 / 2), fr.pt(w / 2, T0 / 2), fr.pt(0, T0 / 2)]);
    const base = minG(k, [fr.pt(-w / 2, 0), fr.pt(w / 2, 0), fr.pt(-w / 2, T0 / 2), fr.pt(w / 2, T0 / 2), p]) - SINK;
    const h = WALL_TOP - base;
    if (h < 1.2) continue;
    // the slab under the plates (pitched with the batter)
    const y0s = Math.max(ROWS[0][0], footG + 0.35);
    const y1s = ROWS[2][1];
    if (y1s - y0s > 0.4) {
      const batter = (Math.atan2((T0 - T1) / 2, h) * 180) / Math.PI;
      const sv = fr.pt(0, faceAt(y0s - base, h) + 0.022);
      k.box('iron', w, (y1s - y0s) / Math.cos((batter * Math.PI) / 180), 0.04, { at: [sv[0], y0s, sv[1]], rot: yawPitch(fr.yaw, batter), color: IRON_HI, shade: 0.9, lod: 1 });
    }
    ROWS.forEach(([y0, y1], row) => {
      if (y0 < footG + 0.35) return;
      const ph = y1 - y0;
      const out = 0.1;
      const pitch = Math.atan2(out, ph) * DEG;
      // the plate's top edge sits on the face at y1; its base centre (pivot) is `out` further out at y0
      const vTop = faceAt(y1 - base, h) + 0.03;
      const at = fr.pt(0, vTop + out);
      const { color, shade } = platePaint(k, row);
      k.box('iron', w, Math.hypot(ph, out), 0.07, { at: [at[0], y0, at[1]], rot: yawPitch(fr.yaw, pitch), color, shade, lod: 0 });
      // rivet bosses along its upper and lower edges (on the tilted outer face), hero range
      const vFace = (y: number) => vTop + out - (out * (y - y0)) / ph + 0.035;
      for (const y of [y0 + 0.08, y1 - 0.09])
        for (let i = 0; i < 9; i++) {
          const q = fr.pt((i / 8 - 0.5) * (w - 0.12), vFace(y));
          k.cone('iron', 0.045, 0.05, { at: [q[0], y, q[1]], rot: yawPitch(fr.yaw, -90), seg: 4, color: IRON_HI, lod: 0 });
        }
    });
    // the hood: the wall's crest flares out over the face (the film's hooked top), a plated cornice of
    // dark metal leaning out 50°, the full bay long so it runs on over the buttresses; two raked spikes
    // at irregular places along its lip
    const hb = fr.pt(0, faceAt(HOOD_Y - base, h) - 0.02);
    k.box('metal', BAY + 0.02, HOOD_L, 0.09, { at: [hb[0], HOOD_Y, hb[1]], rot: yawPitch(fr.yaw, -HOOD_DEG), color: IRON, shade: 0.9 + 0.15 * k.r(), lod: 1 });
    const lipV = faceAt(HOOD_Y - base, h) - 0.02 + HOOD_L * Math.sin((HOOD_DEG * Math.PI) / 180);
    const lipY = HOOD_Y + HOOD_L * Math.cos((HOOD_DEG * Math.PI) / 180);
    for (const c of [-0.3 + 0.12 * k.r(), 0.18 + 0.15 * k.r()]) {
      const q = fr.pt(c * BAY, lipV - 0.03);
      k.cone('iron', 0.08, 0.3 + 0.12 * k.r(), { at: [q[0], lipY - 0.06, q[1]], seg: 4, rot: yawPitch(fr.yaw, -35), color: SPIKE, lod: 0 });
    }
  }
}

// ------------------------------------------------------------------------------------------- the gate

/**
 * one leaf of the gate: x0..x1 along local x, front face at z = zf, foot at y = gy. Dark metal (the
 * 'metal' family, roughness 0.4: the afternoon sun gives the leaves, frame and rails a sheen), rivets iron.
 */
function leaf(k: ProxyKit, x0: number, x1: number, zf: number, gy: number): void {
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  const D = 0.36;
  k.box('metal', w, LEAF_H, D, { at: [cx, gy, zf + D / 2], color: IRON_DARK });
  // the raised frame: stiles at both edges, four heavy bands (rails) across
  for (const e of [x0 + 0.08, x1 - 0.08]) k.box('metal', 0.16, LEAF_H - 0.02, 0.12, { at: [e, gy + 0.01, zf - 0.05], color: IRON, lod: 1 });
  const rails = [0.12, 1.65, 3.15, LEAF_H - 0.25];
  for (const y of rails) k.box('metal', w - 0.04, 0.22, 0.16, { at: [cx, gy + y, zf - 0.07], color: IRON_HI, shade: 0.9, lod: 1 });
  // panels in relief between the rails (two per tier, the seam between them a dark recess)
  for (let r = 0; r + 1 < rails.length; r++) {
    const y0 = rails[r] + 0.26;
    const y1 = rails[r + 1] - 0.04;
    for (const side of [-1, 1]) {
      const pw = (w - 0.4) / 2 - 0.04;
      const px = cx + side * (pw / 2 + 0.04);
      k.box('metal', pw, y1 - y0, 0.07, { at: [px, gy + y0, zf - 0.03], color: r === 1 ? IRON : IRON_HI, shade: 0.85 + 0.2 * k.r(), lod: 0 });
    }
  }
  // great rivet bosses along the rails
  for (const y of rails)
    for (let i = 0; i < 6; i++) {
      const x = x0 + 0.18 + ((w - 0.36) * i) / 5;
      k.cone('iron', 0.065, 0.09, { at: [x, gy + y + 0.11, zf - 0.15], rot: [-90, 0, 0], seg: 6, color: IRON_HI, lod: 0 });
    }
  // forward spikes on the middle rails
  for (const y of [rails[1], rails[2]])
    for (const e of [0.28, 0.72]) k.cone('iron', 0.07, 0.42, { at: [x0 + w * e, gy + y + 0.11, zf - 0.15], rot: [-90, 0, 0], seg: 4, color: SPIKE, lod: 0 });
}

/**
 * A gate tower at x in the Towers of the Teeth's language: a prow-fronted shaft on a battered, stepped
 * base, vertical ribs up its faces and the prow, two banded collars, and a crown of spiked merlons round
 * its top; its foot at the ground. Returns its top (local y).
 */
function gateTower(k: ProxyKit, x: number): number {
  const P: V2[] = [
    [-0.55, 0.75],
    [0.55, 0.75],
    [0.55, -0.85],
    [0, -1.25],
    [-0.55, -0.85],
  ];
  const sec = (s: number): V2[] => P.map(([u, v]): V2 => [u * s, v * s]);
  const g0 =
    minG(k, [
      [x - 0.7, -1.5],
      [x + 0.7, -1.5],
      [x, 0.9],
      [x, 0],
    ]) - SINK;
  const H = 6.3 - g0;
  // the shaft over a battered, stepped base
  k.loft(
    'iron',
    [
      { outline: sec(1.34), y: 0 },
      { outline: sec(1.16), y: 0.75 },
      { outline: sec(1.2), y: 0.82 },
      { outline: sec(1.04), y: 1.35 },
      { outline: sec(0.94), y: H * 0.72 },
      { outline: sec(1.0), y: H * 0.78 },
      { outline: sec(0.9), y: H },
    ],
    { at: [x, g0, 0], color: IRON },
  );
  // vertical ribs: two up each side face and one up each front face of the prow, from the base's top
  // to the upper collar (proud of the face, following its taper)
  const rib = (a: V2, b: V2, f: number) => {
    // a point f of the way a → b on the section, pushed out along the face normal
    const nx = -(b[1] - a[1]);
    const nz = b[0] - a[0];
    const nl = Math.hypot(nx, nz) || 1;
    const px = a[0] + (b[0] - a[0]) * f;
    const pz = a[1] + (b[1] - a[1]) * f;
    const tx = (b[0] - a[0]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
    const tz = (b[1] - a[1]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
    const ring = (s: number, out: number): V2[] => {
      const cx = px * s + (nx / nl) * out;
      const cz = pz * s + (nz / nl) * out;
      return [
        [cx - tx * 0.05 - (nx / nl) * 0.06, cz - tz * 0.05 - (nz / nl) * 0.06],
        [cx + tx * 0.05 - (nx / nl) * 0.06, cz + tz * 0.05 - (nz / nl) * 0.06],
        [cx + tx * 0.04, cz + tz * 0.04],
        [cx - tx * 0.04, cz - tz * 0.04],
      ];
    };
    k.loft(
      'iron',
      [
        { outline: ring(1.04, 0.09), y: 1.35 },
        { outline: ring(0.94, 0.08), y: H * 0.72 },
      ],
      { at: [x, g0, 0], color: IRON_HI, shade: 0.92, lod: 0 },
    );
  };
  // (edges 1 and 4: the side faces; 2 and 3: the prow's front faces; outward normal (−dz, dx))
  for (const [i, f] of [
    [1, 0.3],
    [1, 0.7],
    [4, 0.3],
    [4, 0.7],
    [2, 0.5],
    [3, 0.5],
  ] as const)
    rib(P[i], P[(i + 1) % P.length], f);
  // two banded collars
  for (const yb of [H * 0.36, H * 0.56]) k.loft('iron', [{ outline: sec(1.02), y: 0 }, { outline: sec(1.02), y: 0.14 }], { at: [x, g0 + yb, 0], color: IRON_HI, shade: 0.9, lod: 0 });
  // the crown: spiked merlons round the top's outline
  const top = g0 + H;
  const ring = sec(0.9);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.4));
    for (let j = 0; j < n; j++) {
      const f = (j + 0.5) / n;
      const mx = x + a[0] + (b[0] - a[0]) * f;
      const mz = a[1] + (b[1] - a[1]) * f;
      const yaw = (-Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      k.box('iron', 0.2, 0.26, 0.16, { at: [mx, top - 0.02, mz], rot: [0, yaw, 0], color: IRON, lod: 0 });
      k.cone('iron', 0.06, 0.34 + 0.14 * k.r(), { at: [mx, top + 0.22, mz], seg: 4, rot: [0, 45, 0], color: SPIKE, lod: 0 });
    }
  }
  return top;
}

/** the gate: two leaves under a spiked lintel between two gate towers */
function buildGateway(k: ProxyKit): void {
  const gy = Math.min(k.ground(-GATE_HW, -0.4), k.ground(GATE_HW, -0.4), k.ground(0, -0.4)) - SINK;
  const zf = -0.3;
  leaf(k, -GATE_HW, -0.02, zf, gy);
  leaf(k, 0.02, GATE_HW, zf, gy);
  // the dark gap between the leaves
  k.box('darkStone', 0.05, LEAF_H, 0.3, { at: [0, gy, zf + 0.05], color: 0x111210 });
  // the lintel and its spikes
  k.box('metal', 2 * GATE_HW + 0.5, 0.7, 1.1, { at: [0, gy + LEAF_H, zf + 0.42], color: IRON });
  k.box('metal', 2 * GATE_HW + 0.6, 0.14, 1.2, { at: [0, gy + LEAF_H + 0.05, zf + 0.42], color: IRON_HI, shade: 0.9, lod: 0 });
  for (let j = 0; j < 9; j++) {
    const x = -GATE_HW + (j * 2 * GATE_HW) / 8;
    if (Math.abs(x) < 1.0) continue;
    k.cone('iron', 0.1, j % 2 ? 0.45 : 0.75, { at: [x, gy + LEAF_H + 0.66, zf - 0.02], seg: 4, rot: [0, 45, 0], color: SPIKE, lod: 0 });
  }
  // the gate's crown: five great iron blades over the lintel (the tallest, central one 4.8 high),
  // leaning a little apart — the Morannon's fang crest
  const blade = (x: number, h: number, w: number, lean: number) => {
    const sec = (hw: number, y: number, dx: number): { outline: V2[]; y: number } => ({
      outline: [
        [dx - hw, 0.12],
        [dx + hw, 0.12],
        [dx + hw * 0.5, -0.22],
        [dx - hw * 0.5, -0.22],
      ],
      y,
    });
    k.loft('metal', [sec(w, 0, 0), sec(w * 0.72, h * 0.45, lean * 0.45), sec(w * 0.4, h * 0.8, lean * 0.8), sec(0.03, h, lean)], {
      at: [x, gy + LEAF_H + 0.62, zf + 0.35],
      color: IRON,
    });
  };
  blade(0, 4.8, 0.44, 0);
  for (const s of [-1, 1]) blade(s * 0.85, 2.7, 0.3, s * 0.45);
  for (const s of [-1, 1]) blade(s * 1.5, 1.6, 0.22, s * 0.4);
  for (const s of [-1, 1]) {
    const top = gateTower(k, s * GT_X);
    brazier(k, s * GT_X, top - 0.04, -0.1, 1.4);
  }
}

// ---------------------------------------------------------------------------- the Towers of the Teeth

/** the tooth-tower shaft: height, taper and twist */
const SHAFT_H = 5.4;
const shaftScale = (yy: number) => 1 - 0.2 * (yy / SHAFT_H);
const shaftTwist = (yy: number) => 6 * (yy / SHAFT_H);
/** fin-tip radius of the shaft at its foot */
const SHAFT_R = 0.82;

/**
 * A Tower of the Teeth on its shelf at (x, z): a stepped, battered octagonal plinth on the shelf (its foot
 * following the rock), eight buttress fins flaring from the shaft down onto the plinth's edge, a broad
 * banded fin-bundle shaft, a flared collar, a lantern and a crown of spikes round a central spire.
 */
function toothTower(k: ProxyKit, x: number, z: number, face: number): void {
  // the stepped, battered plinth: a ground-following octagon, then two battered drums
  k.extrude('weathered', ngon(8, 1.3, Math.PI / 8), 0.25, { at: [x, 0, z], followGround: true, color: TALUS, shade: 0.95 });
  const y0 = maxGround(k, x, z, 1.3) + 0.25;
  k.loft(
    'darkStone',
    [
      { outline: ngon(8, 1.15, Math.PI / 8), y: -0.05 },
      { outline: ngon(8, 1.05, Math.PI / 8), y: 0.4 },
      { outline: ngon(8, 1.1, Math.PI / 8), y: 0.45 },
      { outline: ngon(8, 0.98, Math.PI / 8), y: 0.85 },
    ],
    { at: [x, y0, z], color: TOWER, shade: 0.95 },
  );
  const yb = y0 + 0.8;
  // eight buttress fins flaring from the shaft onto the plinth (their feet on the drums' top step)
  for (let j = 0; j < 8; j++) {
    const a = (j / 8) * TAU;
    const dir: V2 = [Math.cos(a), Math.sin(a)];
    const sec = (l0: number, l1: number, y: number): { outline: V2[]; y: number } => ({ outline: rect(l0, l1, -0.07, 0.07), y });
    const yaw = -Math.atan2(dir[1], dir[0]) * DEG;
    k.loft('darkStone', [sec(0.6, 1.25, 0), sec(0.6, 1.02, 0.9), sec(0.6, 0.86, 2.4)], { at: [x, y0 + 0.4, z], rot: [0, yaw, 0], color: TOWER_DARK, shade: 0.95 + 0.1 * k.r() });
  }
  // the shaft: a broad fin bundle, slightly twisted and tapered
  const fins = finSection(8, SHAFT_R * 0.74, SHAFT_R, 0.1, 0);
  k.loft(
    'darkStone',
    [0, 0.6, 1.3, 2.1, 3.0, 3.9, 4.7, SHAFT_H].map((yy) => ({ outline: fins, y: yy, rotDeg: shaftTwist(yy), scale: shaftScale(yy) })),
    { at: [x, yb, z], color: TOWER },
  );
  k.cylinder('darkStone', SHAFT_R * 0.6, SHAFT_R * 0.78, SHAFT_H, { at: [x, yb, z], seg: 8, color: TOWER_DARK, lod: 1 });
  // horizontal bands proud of the fins, with weathered (paler / darker) courses between
  const band = finSection(8, SHAFT_R * 0.8, SHAFT_R * 1.08, 0.13, 0);
  for (const yy of [1.25, 2.55, 3.85]) {
    k.loft(
      'darkStone',
      [
        { outline: band, y: 0, rotDeg: shaftTwist(yy), scale: shaftScale(yy) },
        { outline: band, y: 0.15, rotDeg: shaftTwist(yy + 0.15), scale: shaftScale(yy + 0.15) },
      ],
      { at: [x, yb + yy, z], color: TOWER_DARK, shade: 0.92, lod: 0 },
    );
  }
  // the collar, the lantern and the crown
  const yc = yb + SHAFT_H;
  const rc = SHAFT_R * shaftScale(SHAFT_H);
  k.lathe(
    'darkStone',
    [
      [rc * 0.9, 0],
      [rc * 1.45, 0.24],
      [rc * 1.45, 0.36],
      [rc * 1.05, 0.42],
    ],
    { at: [x, yc, z], seg: 8, color: TOWER_DARK, lod: 1 },
  );
  const lantern = finSection(8, rc * 0.78, rc * 1.08, 0.12, 0.2);
  k.loft(
    'darkStone',
    [
      { outline: lantern, y: 0, rotDeg: 6 },
      { outline: lantern, y: 0.55, rotDeg: 8, scale: 1.12 },
      { outline: lantern, y: 0.95, rotDeg: 10, scale: 1.32 },
    ],
    { at: [x, yc + 0.4, z], color: TOWER, lod: 1 },
  );
  const yt = yc + 0.4 + 0.95;
  spikeCrown(k, x, z, yt, rc * 1.3, 12, 1.05, 1.7, 0.09);
  // window slits facing the plain (−z) and the gate, two lit at night
  for (let j = 0; j < 3; j++) {
    const yy = 1.9 + j * 1.3;
    const a = ((270 + (j === 1 ? 35 * face : 0) - shaftTwist(yy)) * Math.PI) / 180;
    const r = SHAFT_R * 0.74 * shaftScale(yy) + 0.02;
    const p: V3 = [x + Math.cos(a) * r, yb + yy, z + Math.sin(a) * r];
    k.box('emissive', 0.07, 0.3, 0.05, { at: p, rot: [0, -a * DEG + 90, 0], color: 0x3a1206, glow: { gate: 'night', strength: 7 }, lod: 0 });
    if (j > 0) k.light([x + Math.cos(a) * (r + 0.06), yb + yy + 0.15, z + Math.sin(a) * (r + 0.06)], { kind: 'window', gate: 'night', color: 0xe08a3a, intensity: 0.8, radius: 0.04 });
  }
  // a fire on a lantern fin facing the plain
  const af = ((262 + 6) * Math.PI) / 180;
  brazier(k, x + Math.cos(af) * rc * 1.25, yt - 0.04, z + Math.sin(af) * rc * 1.25, 1.3);
}

// ----------------------------------------------------------------------------------------------- crags

/**
 * A broken basalt block: an irregular 6-sided prism, a little battered, leaning slightly, its top cut
 * FLAT (a fractured column head — never a point), with a lower stepped block against one side; its foot
 * sunk below the lowest ground under it.
 */
function basaltBlock(k: ProxyKit, x: number, z: number, h: number, r: number, lean: number, leanDir: number): void {
  const piece = (cx: number, cz: number, hh: number, rr: number) => {
    const n = 6;
    const base: V2[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + k.r() * 0.5;
      const q = rr * (0.75 + 0.4 * k.r());
      base.push([Math.cos(a) * q, Math.sin(a) * q]);
    }
    const lx = Math.cos(leanDir) * lean * hh;
    const lz = Math.sin(leanDir) * lean * hh;
    let g = k.ground(cx, cz);
    for (const [u, v] of base) g = Math.min(g, k.ground(cx + u, cz + v));
    k.loft(
      'weathered',
      [
        { outline: base, y: 0 },
        { outline: base.map(([u, v]): V2 => [u * 0.93 + lx * 0.6, v * 0.93 + lz * 0.6]), y: hh * 0.6 },
        { outline: base.map(([u, v]): V2 => [u * 0.86 + lx, v * 0.86 + lz]), y: hh },
      ],
      { at: [cx, g - 0.1 * hh - SINK, cz], color: k.r() < 0.5 ? ROCK : ROCK2, shade: 0.85 + 0.3 * k.r(), lod: 0 },
    );
  };
  piece(x, z, h, r);
  const a = leanDir + Math.PI * (0.6 + 0.8 * k.r());
  piece(x + Math.cos(a) * r * 0.9, z + Math.sin(a) * r * 0.9, h * (0.45 + 0.2 * k.r()), r * 0.7);
}

/** scree: a fan of small boulders at (x, z) spreading `spread` km toward the direction `dir` */
function scree(k: ProxyKit, x: number, z: number, dir: number, spread: number, n: number, keep: (x: number, z: number) => boolean): void {
  for (let i = 0; i < n; i++) {
    const a = dir + (k.r() - 0.5) * 1.4;
    const d = spread * Math.sqrt(k.r());
    const bx = x + Math.cos(a) * d;
    const bz = z + Math.sin(a) * d;
    if (!keep(bx, bz)) continue;
    k.rock('weathered', 0.08 + 0.12 * k.r(), { at: [bx, 0, bz], seat: true, color: ROCK2, lump: 0.6, squash: 0.5, detail: 0, lod: 0 });
  }
}

/**
 * Fractured basalt along a ridge crest line: on its nose and the flanks facing the plain, broken rock
 * bands (kit cliffs facing the pass side, low enough that their jagged skylines stay broken steps, not
 * spires), flat-topped broken blocks along the crest and scree fans at the bands' feet — nothing within
 * reach of the Towers or the wall's end.
 */
function crags(k: ProxyKit, ridge: V2[], side: number): void {
  const s = sampler(ridge);
  const keep = (x: number, z: number) => Math.hypot(x - side * 8.6, z + 1.8) > 2.6 && !(Math.abs(x) < 9.2 && z > -2.6 && z < 0.8);
  const faces: { path: V2[]; h: number }[] = [];
  for (const [t0, t1, off, h] of [
    [0.0, 3.6, 1.6, 1.3],
    [4.8, 9.5, 2.2, 1.1],
    [10.5, 14, 2.6, 0.9],
  ] as const) {
    const pts: V2[] = [];
    for (let t = t0; t <= t1 + 1e-6; t += 0.4) {
      const { p, d } = s.at(t);
      // offset toward the pass (inner side: x toward 0)
      const nx = -d[1] * side;
      const nz = d[0] * side;
      const sgn = nx * -side > 0 ? 1 : -1;
      pts.push([p[0] + nx * off * sgn, p[1] + nz * off * sgn]);
    }
    // split into runs of kept points (never bridge across the Towers' zone)
    let run: V2[] = [];
    for (const q of [...pts, null]) {
      if (q && keep(q[0], q[1])) run.push(q);
      else {
        if (run.length >= 3) faces.push({ path: run, h });
        run = [];
      }
    }
  }
  for (const f of faces) {
    // walking so that the right-hand side faces the pass (x toward 0)
    let path = f.path;
    const a = path[0];
    const b = path[path.length - 1];
    const rx = -(b[1] - a[1]);
    if (rx * -side < 0) path = [...path].reverse();
    k.cliff('weathered', path, path.map(() => f.h * (0.85 + 0.3 * k.r())), { color: ROCK, rough: 0.7, strata: 0.8, depth: 1.0, soft: 0.25, overhang: 0.12, taper: 0.3 });
    // scree fans at the foot on the pass side
    for (let i = 0; i < path.length; i += 2) scree(k, path[i][0] + side * -0.3, path[i][1], side < 0 ? 0 : Math.PI, 0.7, 3, keep);
  }
  // flat-topped broken blocks along the crest and nose (where the ground is highest across the ridge)
  for (let t = 0.4; t < Math.min(s.len, 13); t += 1.4 + 1.2 * k.r()) {
    const { p, d } = s.at(t);
    let best = p;
    let hb = -1e9;
    for (let q = -1.6; q <= 1.6; q += 0.4) {
      const c: V2 = [p[0] - d[1] * q, p[1] + d[0] * q];
      const h = k.ground(c[0], c[1]);
      if (h > hb) {
        hb = h;
        best = c;
      }
    }
    const count = 1 + Math.floor(k.r() * 2);
    for (let i = 0; i < count; i++) {
      const a = k.r() * TAU;
      const rr = 0.2 + 0.6 * k.r();
      const x = best[0] + Math.cos(a) * rr;
      const z = best[1] + Math.sin(a) * rr;
      if (!keep(x, z)) continue;
      const h = 0.35 + 0.35 * k.r();
      basaltBlock(k, x, z, h, 0.22 + 0.12 * k.r(), 0.06 + 0.06 * k.r(), Math.atan2(-side * d[0], side * d[1]) + (k.r() - 0.5));
    }
  }
}

/**
 * Fractured rock round the front of a Tower's knob (the steep fall from its shelf to the pass floor):
 * two stepped bands of kit cliff on arcs round the shelf (the lower at 2.6 km, the upper at 1.85 km,
 * each about half the fall it spans, so their jagged skylines read as broken ledges — not as tall
 * spires), from behind the wall line round the pass side and the plain side, faces looking out; scree
 * fans on the pass floor below.
 */
function knobCrag(k: ProxyKit, c: V2, side: number): void {
  // compass bearings (0 = the plain, −z; 90 = +x): the west knob (side −1) faces the pass at 90
  const from = side < 0 ? 160 : 200;
  const to = side < 0 ? -50 : 410;
  const n = 24;
  const shelf = k.ground(c[0], c[1]);
  for (const [r0, f, cap] of [
    [2.6, 0.5, 2.0],
    [1.85, 0.6, 2.2],
  ] as const) {
    const pts: V2[] = [];
    for (let i = 0; i <= n; i++) {
      // walk with the face to the right = outward: counter-clockwise (bearing decreasing) round the centre
      const bDeg = side < 0 ? from + ((to - from) * i) / n : to + ((from - to) * i) / n;
      const b = (bDeg * Math.PI) / 180;
      const r = r0 + 0.18 * Math.sin(i * 1.7 + side + r0);
      pts.push([c[0] + Math.sin(b) * r, c[1] - Math.cos(b) * r]);
    }
    // half (or 0.6) of the fall from the shelf to the band's foot, capped: the kit's skyline reaches at most
    // ≈ 1.3 × this, never above the shelf
    const hs = pts.map(([x, z]) => Math.min(cap, Math.max(0.5, f * (shelf - k.ground(x, z)))));
    k.cliff('weathered', pts, hs, { color: ROCK, rough: 0.7, strata: 0.8, depth: 1.2, soft: 0.2, overhang: 0.1, taper: 0.4 });
  }
  // scree fans at its foot on the pass and plain sides
  for (let i = 0; i < 16; i++) {
    const b = ((side < 0 ? -40 + 170 * k.r() : 40 - 170 * k.r()) * Math.PI) / 180;
    const r = 2.8 + 0.9 * k.r();
    const x = c[0] + Math.sin(b) * r;
    const z = c[1] - Math.cos(b) * r;
    if (z > -0.6 && Math.abs(x) < 8.5) continue;
    k.rock('weathered', 0.1 + 0.16 * k.r(), { at: [x, 0, z], seat: true, color: ROCK2, lump: 0.6, squash: 0.55, detail: 1, lod: 0 });
  }
}

/**
 * A great outcrop of fractured basalt on the Dagorlad in the right foreground of the hero (14 km out in
 * front of the gate, a little west of its axis): a stepped butte — a lower broken face 1.5 high round its
 * front, an upper one set back on it, a lower band round its back — strata and overhanging brows, flat-
 * topped blocks round it and a scree fan at its foot toward the road: the dark repoussoir under the west
 * Tower. Faces look toward local bearing ≈ 35° (the hero camera); bearings: 0 = −z (the plain), 90 = +x.
 */
function outcrop(k: ProxyKit): void {
  const c: V2 = [-1.4, -14.0];
  /** an arc round c from bearing b0 to b1 at radius r, walked with bearings decreasing (face outward) */
  const arcPts = (b0: number, b1: number, r: number, n: number, wob: number): V2[] => {
    const pts: V2[] = [];
    for (let i = n; i >= 0; i--) {
      const b = ((b0 + ((b1 - b0) * i) / n) * Math.PI) / 180;
      const rr = r + wob * Math.sin(i * 1.3 + r);
      pts.push([c[0] + Math.sin(b) * rr, c[1] - Math.cos(b) * rr]);
    }
    return pts;
  };
  const g = k.ground(c[0], c[1]);
  const front = arcPts(-60, 130, 1.3, 16, 0.15);
  k.cliff('weathered', front, front.map((_, i) => 1.15 + 0.35 * Math.sin((i / 16) * Math.PI)), { color: ROCK, rough: 0.65, strata: 0.9, depth: 1.8, soft: 0.25, overhang: 0.14, taper: 0.45 });
  const upper = arcPts(-30, 100, 0.75, 10, 0.1);
  k.cliff('weathered', upper, upper.map((_, i) => 1.0 + 0.3 * Math.sin((i / 10) * Math.PI)), { at: [0, g + 1.05, 0], followGround: false, color: ROCK2, rough: 0.6, strata: 0.9, depth: 1.2, soft: 0.25, overhang: 0.1, taper: 0.35, lod: 0 });
  const back = arcPts(140, 300, 1.1, 10, 0.12);
  k.cliff('weathered', back, 0.9, { color: ROCK2, rough: 0.6, strata: 0.6, depth: 1.4, soft: 0.25, taper: 0.3, lod: 0 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + k.r();
    const r = 1.6 + 0.4 * k.r();
    basaltBlock(k, c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, 0.25 + 0.3 * k.r(), 0.2 + 0.1 * k.r(), 0.05, a);
  }
  // scree toward the camera (bearing 35°: x + sin, z − cos)
  const sb = (35 * Math.PI) / 180;
  scree(k, c[0] + Math.sin(sb) * 1.5, c[1] - Math.cos(sb) * 1.5, Math.atan2(-Math.cos(sb), Math.sin(sb)), 1.0, 12, () => true);
}

export function buildGate(k: ProxyKit): void {
  // ---- the wall: the west half and its mirror
  wallHalf(k, WEST);
  wallHalf(
    k,
    WEST.map(([x, z]) => [-x, z] as V2),
  );
  // ---- the gate
  buildGateway(k);
  // ---- braziers on the wall walk either side of the gate
  for (const s of [-1, 1]) for (const x of [3.6, 5.6]) brazier(k, s * x, WALL_TOP - 0.03, 0.12, 1.2);
  // ---- the Towers of the Teeth, high on the flanks
  toothTower(k, TOWERS[0][0], TOWERS[0][1], 1);
  toothTower(k, TOWERS[1][0], TOWERS[1][1], -1);
  // ---- crags under the Towers, on the ridge noses and crests; the outcrop on the plain
  knobCrag(k, TOWERS[0], -1);
  knobCrag(k, TOWERS[1], 1);
  crags(k, WEST_RIDGE, -1);
  crags(k, EAST_RIDGE, 1);
  outcrop(k);
}
