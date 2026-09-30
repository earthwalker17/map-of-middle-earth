import { valueNoise } from '../../core/rng.ts';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';
import type { LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';

/**
 * Cirith Ungol, the Pass of the Spider (research §12; the RotK tower still, Alan Lee's "Cirith Ungol",
 * the Weta bigature): the Tower of Cirith Ungol, a tall, narrow, many-faceted dark tower of vertical fins
 * with a cracked, jagged crown, stepped down a rock pinnacle on the Mordor side of the Cleft with a lower
 * walled bastion; the Stairs — a thin zig-zag thread of steps cut up the western cliff from the head of
 * the Morgul vale to the Cleft, faintly lit green from below; three red lights. Silhouetted against the
 * Mordor glow (the sky's glow is an S4 effect).
 *
 * Local frame: heading 0 (x east, z south). The display point is on the broad crest plateau of the Ephel
 * Dúath (≈ 26.5) where it breaks east into Mordor (falling ≈ 1 unit per km beyond x ≈ 2); the Morgulduin
 * rises ≈ 8 km to the west-south-west. Stamps (relative to the base ground at the display point): the
 * crest of the range as a jagged sharp ridge running north–south west of the display point, broken by the
 * Cleft (a notch) at z ≈ 0; the tower's pinnacle east of the Cleft (a small steep massif with a spur
 * falling towards Mordor); the sheer upper faces are kit cliffs seated on them.
 */
const CREST_X = -1.2;
/** the pinnacle (tower foot) east of the Cleft */
const PIN: V2 = [1.35, 0.55];
const PIN_TOP = 3.4;
/** the sheer rock pedestal the tower stands on rises this far above the pinnacle's crown */
const PEDESTAL = 1.1;
/** tower palette: the film's #161916 (under a dim sky), lifted so the fins keep shading in moonlight */
const TOWER = 0x454c47;
const TOWER_DARK = 0x3a403c;
const ROCK = 0x4d514c;
const STAIR_GLOW = 0x0f2a1c;
const RED = 0xff3b1c;
/** dim Orc-fire red of the slits between the tower's fins */
const EMBER = 0x8a2a10;

const STAMPS: LocalStamp[] = [
  // the crest of the Ephel Dúath, broken by the Cleft
  {
    kind: 'ridge',
    path: [
      [CREST_X - 0.6, -9],
      [CREST_X - 0.2, -5],
      [CREST_X, -2],
      [CREST_X + 0.1, 0.1],
      [CREST_X, 2.2],
      [CREST_X - 0.3, 5.5],
      [CREST_X - 0.8, 9],
    ],
    height: [1.2, 3.3, 3.8, 1.2, 3.6, 3.3, 1.2],
    halfWidth: 2.4,
    profile: 'sharp',
    rough: { amp: 1.0, scaleKm: 1.8, ridged: true },
    surface: 'rock',
  },
  // the tower's pinnacle, a spur falling east towards Mordor and a shoulder to the south
  {
    kind: 'massif',
    at: PIN,
    radius: 1.35,
    summit: PIN_TOP,
    base: 0,
    exponent: 0.9,
    dome: 0.35,
    spurs: [
      { azimuthDeg: 95, lengthKm: 2.4, widthKm: 0.9, heightFrac: 0.4, rootFrac: 0.7 },
      { azimuthDeg: 205, lengthKm: 1.7, widthKm: 0.8, heightFrac: 0.35, rootFrac: 0.6 },
      { azimuthDeg: 330, lengthKm: 1.4, widthKm: 0.8, heightFrac: 0.3, rootFrac: 0.55 },
    ],
    flankSlope: 3.2,
    rough: { amp: 0.45, scaleKm: 1.6, ridged: true },
    surface: 'rock',
  },
];

/**
 * A finned section of the tower: `n` fins of radius `r` with recesses of radius `r·k` between them, a
 * ragged outline (each fin a little different, seeded).
 */
function finSection(r: number, n: number, k: number, seed: number, y: number): V2[] {
  const out: V2[] = [];
  for (let j = 0; j < 2 * n; j++) {
    const a = (j / (2 * n)) * Math.PI * 2;
    const fin = j % 2 === 0;
    const jit = 1 + 0.12 * (valueNoise(j * 0.7, y * 0.9, seed) - 0.5);
    const rr = (fin ? r : r * k) * jit;
    out.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return out;
}

/** a circle of `n` points, radius `r` */
function ring(r: number, n: number): V2[] {
  return Array.from({ length: n }, (_, j): V2 => [Math.cos((j / n) * Math.PI * 2) * r, Math.sin((j / n) * Math.PI * 2) * r]);
}

/**
 * The tower: three stepped finned tiers (each narrower, turned a little on the one below, with a ledge
 * where they step) up to a cracked crown — fins running on up as jagged teeth of uneven height, broken
 * low on one side. Returns the local height of the top of the shaft.
 */
function buildTower(k: ProxyKit, at: V2, y0: number): number {
  const tiers: { r: number; h: number; k: number; rot: number }[] = [
    { r: 0.52, h: 0.95, k: 0.72, rot: 0 },
    { r: 0.4, h: 0.9, k: 0.68, rot: 8 },
    { r: 0.3, h: 1.35, k: 0.62, rot: 16 },
  ];
  let y = y0 - 0.06;
  tiers.forEach((t, i) => {
    const n = 10;
    k.loft(
      'darkStone',
      [
        { outline: finSection(t.r, n, t.k, 30 + i, y), y: 0, rotDeg: t.rot },
        { outline: finSection(t.r * 0.93, n, t.k, 30 + i, y + t.h * 0.5), y: t.h * 0.55, rotDeg: t.rot + 1 },
        { outline: finSection(t.r * 0.86, n, t.k, 30 + i, y + t.h), y: t.h, rotDeg: t.rot + 2 },
      ],
      { at: [at[0], y, at[1]], color: i === 2 ? TOWER : TOWER_DARK },
    );
    // Orc-fires inside: a dim red core showing as slits between the fins in a band of the tier (the
    // 'emissive' family, night-gated; the recess radius is t.k·r, the core a little outside it)
    const b0 = 0.35 + 0.1 * i;
    const b1 = b0 + 0.22;
    k.loft(
      'emissive',
      [
        { outline: ring(t.r * (t.k + 0.1) * (1 - 0.14 * b0), 20), y: t.h * b0, rotDeg: t.rot + 9 },
        { outline: ring(t.r * (t.k + 0.1) * (1 - 0.14 * b1), 20), y: t.h * b1, rotDeg: t.rot + 9 },
      ],
      { at: [at[0], y, at[1]], color: EMBER, glow: { strength: 0.9 } },
    );
    // the ledge where the next tier steps back: a flat parapet ring
    if (i < tiers.length - 1) {
      k.lathe(
        'darkStone',
        [
          [t.r * 0.4, 0],
          [t.r * 0.9, 0],
          [t.r * 0.9, 0.06],
          [t.r * 0.4, 0.06],
        ],
        { at: [at[0], y + t.h - 0.02, at[1]], seg: 10, color: TOWER_DARK },
      );
    }
    y += t.h;
  });
  // the cracked crown: every fin runs on up as a tooth, uneven, broken low on the south-west
  const top = tiers[2];
  const R = top.r * 0.86;
  for (let j = 0; j < 10; j++) {
    const a = ((j / 10) * 360 - (top.rot + 2)) * (Math.PI / 180);
    const broken = j >= 5 && j <= 6;
    const h = broken ? 0.08 + 0.06 * k.r(300 + j) : 0.22 + 0.32 * k.r(300 + j);
    const lean = 6 + 8 * k.r(320 + j);
    const ax = Math.cos(a);
    const az = Math.sin(a);
    k.cone('darkStone', 0.06, h, { at: [at[0] + ax * R * 0.95, y - 0.04, at[1] + az * R * 0.95], rot: [lean * az, 0, -lean * ax], seg: 4, color: TOWER });
  }
  return y;
}

export default defineLandmark({
  id: 'cirith-ungol',
  placeId: 'cirith-ungol',
  tier: 'B',
  stamps: STAMPS,
  proxy: (k) => {
    // ---- the pedestal: a sheer, jagged rock column rising PEDESTAL above the pinnacle's crown, its foot
    // sunk into the flanks (a loft through ragged sections, like jointed rock — not a turned column)
    const ringMin = (r: number) => Math.min(...Array.from({ length: 16 }, (_, j) => k.ground(PIN[0] + Math.cos((j / 16) * Math.PI * 2) * r, PIN[1] + Math.sin((j / 16) * Math.PI * 2) * r)));
    const crown = k.ground(PIN[0], PIN[1]);
    const foot = crown + PEDESTAL;
    const y0 = ringMin(0.85) - 0.25;
    const rag = (R: number, y: number, seed: number): V2[] =>
      Array.from({ length: 14 }, (_, j): V2 => {
        const a = (j / 14) * Math.PI * 2;
        const rr = R * (0.82 + 0.3 * valueNoise(j * 0.9, y * 1.7, seed)) * (j % 2 ? 0.9 : 1);
        return [Math.cos(a) * rr, Math.sin(a) * rr];
      });
    const H = foot - y0;
    k.loft(
      'weathered',
      [
        { outline: rag(0.86, 0, 71), y: 0 },
        { outline: rag(0.74, 0.35 * H, 71), y: 0.35 * H, rotDeg: 6 },
        { outline: rag(0.66, 0.75 * H, 71), y: 0.75 * H, rotDeg: 11 },
        { outline: rag(0.6, H, 71), y: H, rotDeg: 14 },
      ],
      { at: [PIN[0], y0, PIN[1]], color: ROCK },
    );
    // ---- the bastion: a walled court lower down the eastern spur, towards Mordor
    const bc: V2 = [PIN[0] + 1.25, PIN[1] + 0.1];
    const court: V2[] = Array.from({ length: 9 }, (_, j): V2 => {
      const a = (j / 9) * Math.PI * 2;
      const r = 0.36 + 0.06 * Math.cos(2 * a);
      return [bc[0] + Math.cos(a) * r * 1.2, bc[1] + Math.sin(a) * r * 0.8];
    });
    // its platform's flat top stands 0.2 above the highest ground under it (extrude followGround)
    const courtTop = Math.max(...court.map(([x, z]) => k.ground(x, z))) + 0.2;
    k.extrude('darkStone', court, 0.2, { followGround: true, color: TOWER_DARK });
    k.wallPath('darkStone', court, 0.12, 0.05, { closed: true, at: [0, courtTop - 0.01, 0], color: TOWER, crenel: { w: 0.03, h: 0.04, gap: 0.03, lod: 0 } });
    k.tower('darkStone', 0.13, 0.42, { at: [bc[0] + 0.3, courtTop - 0.01, bc[1] - 0.12], sides: 8, roof: 'crenel', color: TOWER });
    // ---- the tower, stepped on the pedestal
    const topY = buildTower(k, PIN, foot);
    // ---- the Stairs: straight, then winding, up the western flank of the crest to the Cleft; cut dark
    // into the rock and faintly lit green from below (emissiveGreen at the preset strength: its paint sets
    // the glow)
    const stairs: V3[] = [];
    const x0 = CREST_X - 3.2;
    const x1 = CREST_X - 0.35;
    const legs = 7;
    for (let i = 0; i <= legs; i++) {
      const t = i / legs;
      const x = x0 + (x1 - x0) * t;
      const z = 0.25 + (i % 2 === 0 ? -0.22 : 0.22) * (1 - 0.5 * t);
      stairs.push([x, Number.NaN, z]);
    }
    stairs.push([CREST_X + 0.1, Number.NaN, 0.1]);
    k.stairs('emissiveGreen', stairs, 0.06, { stepKm: 0.05, color: STAIR_GLOW });
    // ---- three red lights: two windows high in the tower, one at the bastion gate
    // (on the surface: a recess of the top tier facing west, the edge of a fin on the north)
    k.light([PIN[0] - 0.17, topY - 0.35, PIN[1]], { color: RED, intensity: 2.5, radius: 0.03, kind: 'fire', gate: 'always' });
    k.light([PIN[0], topY - 1.3, PIN[1] - 0.31], { color: RED, intensity: 2, radius: 0.03, kind: 'fire', gate: 'always' });
    k.light([bc[0] + 0.3 + 0.13, courtTop + 0.3, bc[1] - 0.12], { color: RED, intensity: 2, radius: 0.03, kind: 'fire', gate: 'always' });
  },
  lookOverride: 'mordor',
  annotation: { title: 'Cirith Ungol', subtitle: 'The Pass of the Spider', blurb: 'The secret stair into Mordor, watched by the Tower and haunted by Shelob.' },
  bookmarks: [
    {
      id: 'cirith-ungol-close',
      distanceKm: 35,
      elevationDeg: 24,
      azimuthDeg: 250,
      fov: 28,
      lift: 2,
      aimKm: [1.0, -0.5],
      tod: 21.0,
      dayOfYear: 78,
      note: 'night (19 March, a week after Frodo and Sam climbed the Stairs: a waxing gibbous moon 55° up in the south-south-west rakes the western faces from the left), from high over the head of the Morgul vale (west-south-west): the finned tower on its pinnacle beyond the Cleft, the Stairs threading up the western flank, the Mordor plain behind (Mount Doom beyond it; its glow is S4) — the horizon is kept out of frame: rays skimming Mordor leave the board',
    },
  ],
});
