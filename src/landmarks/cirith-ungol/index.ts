import { valueNoise } from '../../core/rng.ts';
import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';
import type { LocalStamp } from '../types.ts';
import { defineLandmark } from '../types.ts';

/**
 * Cirith Ungol, the Pass of the Spider (research §12; the RotK tower still, Alan Lee's "Cirith Ungol",
 * the Weta bigature): the Tower of Cirith Ungol, a tall, narrow dark tower of three stepped tiers, each a
 * faceted core gripped by deep vertical buttress ribs that run on above the tier as jagged teeth (the
 * film's serrated silhouette), up to a cracked crown; it stands on a sheer rock pedestal on a pinnacle on
 * the Mordor side of the Cleft, with a lower walled bastion; a few narrow ember slits; the Stairs — a dark
 * zig-zag cut up the western cliff from the head of the Morgul vale to the Cleft; three red lights (night).
 * Silhouetted against the Mordor glow (the sky's glow is an S4 effect; until then a warm haze spot over
 * the pass, looks.json).
 *
 * Local frame: heading 0 (x east, z south). The display point is on the broad crest plateau of the Ephel
 * Dúath (≈ 26.5) where it breaks east into Mordor (falling ≈ 1 unit per km beyond x ≈ 2); the Morgulduin
 * rises ≈ 8 km to the west-south-west. Stamps (relative to the base ground at the display point): the
 * crest of the range as a jagged sharp ridge running north–south west of the display point, broken by the
 * Cleft (a narrow V notch) at z ≈ 0; the tower's pinnacle east of the Cleft (a small steep massif standing
 * clear of the crest, with a spur falling towards Mordor); the sheer faces are kit geometry seated on them.
 */
const CREST_X = -1.2;
/** the pinnacle (tower foot) east of the Cleft */
const PIN: V2 = [1.35, 0.55];
const PIN_TOP = 3.9;
/** the sheer rock pedestal the tower stands on rises this far above the pinnacle's crown */
const PEDESTAL = 1.0;
/** tower palette: the film's #161916 (under a dim sky), lifted so the ribs keep shading in moonlight */
const TOWER = 0x5b635d;
const TOWER_DARK = 0x4a514c;
const ROCK = 0x4a4e49;
const STAIR = 0x2b2d2a;
const STAIR_EDGE = 0x666862;
const RED = 0xff3b1c;
/** deep Orc-fire red of the ember slits (dark paint, no white core: the glow's hot core only warms it) */
const EMBER = 0x6e1804;

const STAMPS: LocalStamp[] = [
  // the crest of the Ephel Dúath: a sharp, jagged ridge broken by the Cleft — a narrow V between two
  // shoulders a kilometre either side of it
  {
    kind: 'ridge',
    path: [
      [CREST_X - 0.6, -9],
      [CREST_X - 0.2, -5],
      [CREST_X, -2],
      [CREST_X + 0.05, -0.9],
      [CREST_X + 0.1, 0.1],
      [CREST_X + 0.05, 1.1],
      [CREST_X, 2.2],
      [CREST_X - 0.3, 5.5],
      [CREST_X - 0.8, 9],
    ],
    height: [1.2, 3.4, 3.9, 3.7, 0.3, 3.7, 3.7, 3.3, 1.2],
    halfWidth: 1.9,
    profile: 'sharp',
    rough: { amp: 1.2, scaleKm: 1.6, ridged: true },
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
    flankSlope: 3.4,
    rough: { amp: 0.45, scaleKm: 1.6, ridged: true },
    surface: 'rock',
  },
];

/** a regular `n`-gon of radius `r` turned by `rotDeg` */
function ngon(r: number, n: number, rotDeg: number): V2[] {
  return Array.from({ length: n }, (_, j): V2 => {
    const a = ((j / n) * 360 + rotDeg) * (Math.PI / 180);
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
}

/** an ember slit: its local centre and outward normal (for the fire lights) */
interface Slit {
  at: V3;
  n: V2;
}

/**
 * The tower: three stepped tiers, each a faceted eight-sided core gripped by eight deep buttress ribs
 * (deeper than a quarter of the tier's radius, flared at the foot) that run on above the tier as jagged
 * teeth; a ledge where each tier steps back; on the top tier the ribs rise into a cracked crown of uneven
 * spikes broken low on the south-west. Two or three narrow ember slits per tier in the core faces between
 * the ribs. Returns the top of the shaft and the slits.
 */
function buildTower(k: ProxyKit, at: V2, y0: number): { top: number; slits: Slit[] } {
  const tiers: { r: number; h: number; rot: number; bw: number; slits: number[] }[] = [
    { r: 0.52, h: 0.95, rot: 0, bw: 0.07, slits: [1, 4, 6] },
    { r: 0.41, h: 0.9, rot: 10, bw: 0.06, slits: [2, 5] },
    { r: 0.31, h: 1.35, rot: 20, bw: 0.05, slits: [0, 3, 5] },
  ];
  const slits: Slit[] = [];
  let y = y0 - 0.06;
  tiers.forEach((t, i) => {
    const rc = t.r * 0.64;
    const top = i === tiers.length - 1;
    // the core: an eight-sided prism (the ribs on its corners, its faces between them), tapering a little
    k.loft(
      'darkStone',
      [
        { outline: ngon(rc, 8, t.rot), y: 0 },
        { outline: ngon(rc * 0.93, 8, t.rot), y: t.h },
      ],
      { at: [at[0], y, at[1]], color: i === 2 ? TOWER : TOWER_DARK },
    );
    // the buttress ribs: radial blades from inside the core out to the tier's radius (flared at the foot),
    // each running on above the tier as a tooth whose outer edge slopes back (uneven heights)
    for (let j = 0; j < 8; j++) {
      const a = ((j * 45 + t.rot) * Math.PI) / 180;
      const yaw = (-a * 180) / Math.PI;
      const tooth = top ? (j === 5 || j === 6 ? 0.05 + 0.05 * k.r(300 + j) : 0.22 + 0.36 * k.r(300 + j)) : 0.08 + 0.12 * k.r(310 + i * 8 + j);
      const rib = (r0: number, r1: number, yy: number) => ({
        outline: [
          [r0, -t.bw / 2],
          [r1, -t.bw / 2],
          [r1, t.bw / 2],
          [r0, t.bw / 2],
        ] as V2[],
        y: yy,
      });
      k.loft(
        'darkStone',
        [rib(rc * 0.8, t.r * 1.1, 0), rib(rc * 0.8, t.r * 0.98, t.h * 0.3), rib(rc * 0.75, t.r * 0.9, t.h), rib(rc * 0.75, rc * 0.93 + 0.04, t.h + tooth)],
        { at: [at[0], y, at[1]], rot: [0, yaw, 0], color: TOWER, shade: 0.9 + 0.2 * k.r(330 + i * 8 + j), lod: i > 0 && j % 2 === 1 ? 0 : undefined },
      );
    }
    // ember slits: narrow, deep red, in the core faces between the ribs (night)
    for (const f of t.slits) {
      const a = ((f * 45 + 22.5 + t.rot) * Math.PI) / 180;
      const sy = t.h * (0.42 + 0.18 * k.r(340 + i * 8 + f));
      // the core face's apothem at that height (the prism tapers from rc to 0.93 rc)
      const ap = rc * (1 - 0.07 * (sy / t.h)) * Math.cos(Math.PI / 8);
      const n: V2 = [Math.cos(a), Math.sin(a)];
      const sh = 0.14 + 0.06 * k.r(350 + i * 8 + f);
      k.box('emissive', 0.008, sh, 0.022, { at: [at[0] + n[0] * (ap + 0.002), y + sy - sh / 2, at[1] + n[1] * (ap + 0.002)], rot: [0, -a * (180 / Math.PI), 0], color: EMBER, glow: { strength: 2.2, gate: 'night' }, lod: 0 });
      slits.push({ at: [at[0] + n[0] * (ap + 0.006), y + sy, at[1] + n[1] * (ap + 0.006)], n });
    }
    // the ledge where the next tier steps back: a flat parapet ring
    if (!top) {
      k.lathe(
        'darkStone',
        [
          [t.r * 0.4, 0],
          [t.r * 0.86, 0],
          [t.r * 0.86, 0.05],
          [t.r * 0.4, 0.05],
        ],
        { at: [at[0], y + t.h - 0.02, at[1]], seg: 8, color: TOWER_DARK, lod: 0 },
      );
    }
    y += t.h;
  });
  // the crown's broken rim between the teeth
  const tt = tiers[2];
  k.lathe(
    'darkStone',
    [
      [tt.r * 0.5, 0],
      [tt.r * 0.62, 0],
      [tt.r * 0.62, 0.07],
      [tt.r * 0.5, 0.07],
    ],
    { at: [at[0], y - 0.02, at[1]], seg: 8, color: TOWER, lod: 0 },
  );
  return { top: y, slits };
}

/** points of a zig-zag stair up a slope from `a` to `b` (local x, z): `legs` legs of varying length */
function zigzag(k: ProxyKit, a: V2, b: V2, legs: number): V2[] {
  const pts: V2[] = [a];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L = Math.hypot(dx, dz);
  const ux = dx / L;
  const uz = dz / L;
  let t = 0;
  for (let i = 1; i < legs; i++) {
    // uneven rises between the turns, wider swings low down
    t += (1 / legs) * (0.6 + 0.8 * k.r(400 + i));
    const tt = Math.min(0.97, t);
    const side = (i % 2 ? 1 : -1) * (0.12 + 0.16 * k.r(420 + i)) * (1 - 0.45 * tt);
    pts.push([a[0] + ux * L * tt - uz * side, a[1] + uz * L * tt + ux * side]);
  }
  pts.push(b);
  return pts;
}

export default defineLandmark({
  id: 'cirith-ungol',
  placeId: 'cirith-ungol',
  tier: 'B',
  stamps: STAMPS,
  proxy: (k) => {
    // ---- the pedestal: a sheer, jagged rock column rising PEDESTAL above the pinnacle's crown, its foot
    // sunk into the flanks — a loft through ragged sections, each jittered on its own (jointed rock with
    // broken facets, not a turned column)
    const ringMin = (r: number) => Math.min(...Array.from({ length: 16 }, (_, j) => k.ground(PIN[0] + Math.cos((j / 16) * Math.PI * 2) * r, PIN[1] + Math.sin((j / 16) * Math.PI * 2) * r)));
    const crown = k.ground(PIN[0], PIN[1]);
    const foot = crown + PEDESTAL;
    const y0 = ringMin(0.85) - 0.25;
    const rag = (R: number, f: number, seed: number): V2[] =>
      Array.from({ length: 13 }, (_, j): V2 => {
        const a = ((j + 0.35 * (valueNoise(j * 1.3, f * 3.1, seed + 7) - 0.5)) / 13) * Math.PI * 2;
        const rr = R * (0.72 + 0.45 * valueNoise(j * 0.9, f * 2.3, seed)) * (j % 3 === 0 ? 0.86 : 1);
        return [Math.cos(a) * rr, Math.sin(a) * rr];
      });
    const H = foot - y0;
    const fr = [0, 0.18, 0.42, 0.66, 0.86, 1];
    const rad = [0.9, 0.8, 0.72, 0.68, 0.64, 0.6];
    k.loft(
      'weathered',
      fr.map((f, i) => ({ outline: rag(rad[i], f, 71), y: f * H, rotDeg: 7 * i })),
      { at: [PIN[0], y0, PIN[1]], color: ROCK },
    );
    // its faces: faceted rock bands (kit cliffs) wrapped round the column in three overlapping arcs, their
    // jagged crests at the pedestal's top, strata and gullies breaking the flanks
    for (let i = 0; i < 3; i++) {
      const arc: V2[] = Array.from({ length: 7 }, (_, j): V2 => {
        // walking anticlockwise seen from above (the face looks right of the walking direction (−dz, dx):
        // outwards)
        const a = ((i * 120 + 75 - (j / 6) * 150) * Math.PI) / 180;
        const r = 0.7 + 0.08 * valueNoise(i * 3.1 + j * 0.7, 0.5, 91);
        return [PIN[0] + Math.cos(a) * r, PIN[1] + Math.sin(a) * r];
      });
      const hs = arc.map(([x, z]) => foot + 0.04 - k.ground(x, z));
      k.cliff('weathered', arc, hs, { depth: 0.45, rough: 0.55, strata: 0.6, soft: 0.3, overhang: -0.05, taper: 0.18, color: ROCK });
    }
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
    k.wallPath('darkStone', court, 0.12, 0.05, { closed: true, at: [0, courtTop - 0.01, 0], color: TOWER, crenel: { w: 0.03, h: 0.04, gap: 0.03, lod: 0 }, lod: 0 });
    const bt: V2 = [bc[0] + 0.3, bc[1] - 0.12];
    k.tower('darkStone', 0.13, 0.42, { at: [bt[0], courtTop - 0.01, bt[1]], sides: 8, roof: 'crenel', color: TOWER, lod: 0 });
    // ---- the tower, stepped on the pedestal
    const { slits } = buildTower(k, PIN, foot);
    // ---- the Stairs: a dark groove of steps cut up the western flank of the crest to the Cleft, winding
    // in uneven switchbacks, a lighter worn edge on their outer side (no light: the film's stairs are
    // barely visible)
    const path = zigzag(k, [CREST_X - 3.3, 0.3], [CREST_X - 0.4, 0.15], 10);
    path.push([CREST_X + 0.1, 0.1]);
    const P3 = (q: V2): V3 => [q[0], Number.NaN, q[1]];
    k.stairs('weathered', path.map(P3), 0.055, { stepKm: 0.045, color: STAIR });
    // the worn outer edge: the same flight offset to the right of each leg
    const edge: V2[] = path.map((q, i) => {
      const a = path[Math.max(0, i - 1)];
      const b = path[Math.min(path.length - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [q[0] - ((b[1] - a[1]) / l) * 0.034, q[1] + ((b[0] - a[0]) / l) * 0.034];
    });
    k.stairs('weathered', edge.map(P3), 0.012, { stepKm: 0.045, color: STAIR_EDGE });
    // ---- three red lights (night): two on ember slits high in the tower, one at the bastion tower's face
    const hi = [...slits].sort((p, q) => q.at[1] - p.at[1]);
    for (const sl of [hi[0], hi[3]]) k.light([sl.at[0] + sl.n[0] * 0.01, sl.at[1], sl.at[2] + sl.n[1] * 0.01], { color: RED, intensity: 0.7, radius: 0.02, kind: 'fire', gate: 'night' });
    const bn: V2 = [-0.94, -0.34];
    k.light([bt[0] + bn[0] * 0.14, courtTop + 0.25, bt[1] + bn[1] * 0.14], { color: RED, intensity: 0.6, radius: 0.018, kind: 'fire', gate: 'night' });
  },
  lookOverride: 'mordor',
  annotation: { title: 'Cirith Ungol', subtitle: 'The Pass of the Spider', blurb: 'The secret stair into Mordor, watched by the Tower and haunted by Shelob.' },
  bookmarks: [
    {
      id: 'cirith-ungol-close',
      distanceKm: 32,
      elevationDeg: 14,
      azimuthDeg: 268,
      fov: 18,
      lift: 3.6,
      aimKm: [1.0, -0.5],
      tod: 21.0,
      dayOfYear: 78,
      note: 'night (19 March, a week after Frodo and Sam climbed the Stairs: a waxing gibbous moon 55° up in the south-south-west rakes the western faces from the left), from high over the head of the Morgul vale (west): the ribbed tower on its pinnacle beyond the Cleft, the Stairs threading up the western flank, the Mordor plain behind in a warm haze (the real Mordor glow is S4); turned so Mount Doom and its plume stay out of the tower\'s backdrop; the horizon is kept out of frame: rays skimming Mordor leave the board',
    },
  ],
});
