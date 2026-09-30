import type { ProxyKit } from '../kit/ProxyKit.ts';
import type { V2, V3 } from '../records.ts';
import { BRIDGE_END, C, GATE, GATE_OUT, TOWER, WALL } from './layout.ts';

/**
 * The corpse-light. The curtain walls, their towers and the fin buttresses are the 'emissiveGreen'
 * family built from lofts (which take the per-part `glow` strength): lit albedo ¼ of the paint plus an
 * always-on emission of paint × strength, so at night the walls read green-lit from within (the film's
 * #508264, brightest #7bad85) while by day they are a dark green-grey. The spiked parapet is a brighter
 * green line; the houses inside are lit stone under dark slate with green windows; the gatehouse is dark
 * between the glowing blades, its mouth burning.
 */
const WALL_PAINT = 0x508264;
const WALL_STRENGTH = 0.26;
const FIN_PAINT = 0x5a8f70;
const FIN_STRENGTH = 0.2;
const PARAPET_PAINT = 0x7bad85;
const PARAPET_STRENGTH = 0.9;
const HOUSE = [0x5d746a, 0x637a70, 0x566d63, 0x687f75];
const ROOF = [0x243230, 0x2a3836, 0x202b29];
const SLATE = 0x243230;
const GATE_STONE = 0x3e524b;
const BRIDGE_STONE = 0x74857e;
const POST = 0x2c3633;
/** corpse-light green of the windows (magic lights) */
const GREEN = 0x8ff0b0;
/** sink of seated parts (ProxyKit.SINK) */
const SINK = 0.02;

const DEG = 180 / Math.PI;

/** outward unit direction from the city centre */
function outward(p: V2): V2 {
  const dx = p[0] - C[0];
  const dz = p[1] - C[1];
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

/**
 * A battered, glowing wall segment a → b: `h` tall, `t` thick at the foot and `tt` at the top, its ends
 * run on by t/2 to close the corners, seated on the lowest ground under it; a row of lit spikes along its
 * top (LOD0). Returns the height of the wall top.
 */
function wallSeg(k: ProxyKit, a: V2, b: V2, h: number, t: number, tt: number, shade: number, spikes: boolean): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L = Math.hypot(dx, dz);
  const ux = dx / L;
  const uz = dz / L;
  const yaw = -Math.atan2(dz, dx) * DEG;
  const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const hl = L / 2 + t / 2;
  const rect = (hw: number): V2[] => [
    [-hl, -hw],
    [hl, -hw],
    [hl, hw],
    [-hl, hw],
  ];
  k.loft(
    'emissiveGreen',
    [
      { outline: rect(t / 2), y: 0 },
      { outline: rect(tt / 2), y: h },
    ],
    { at: [mid[0], 0, mid[1]], rot: [0, yaw, 0], seat: true, color: WALL_PAINT, shade, glow: { strength: WALL_STRENGTH } },
  );
  // the kit seats the loft on the lowest ground under its foot corners and centre
  const nx = -uz;
  const nz = ux;
  const corners: V2[] = [
    [mid[0] - ux * hl - nx * (t / 2), mid[1] - uz * hl - nz * (t / 2)],
    [mid[0] + ux * hl - nx * (t / 2), mid[1] + uz * hl - nz * (t / 2)],
    [mid[0] + ux * hl + nx * (t / 2), mid[1] + uz * hl + nz * (t / 2)],
    [mid[0] - ux * hl + nx * (t / 2), mid[1] - uz * hl + nz * (t / 2)],
    mid,
  ];
  const top = Math.min(...corners.map(([x, z]) => k.ground(x, z))) - SINK + h;
  if (spikes) {
    const n = Math.floor(L / 0.07);
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n - 0.5;
      k.cone('emissiveGreen', 0.016, 0.065, { at: [mid[0] + ux * s * L, top - 0.005, mid[1] + uz * s * L], seg: 4, rot: [0, yaw + 45, 0], color: PARAPET_PAINT, glow: { strength: PARAPET_STRENGTH }, lod: 0 });
    }
  }
  return top;
}

/** a glowing faceted wall tower with a dark slate spire, seated */
function wallTower(k: ProxyKit, p: V2, r: number, h: number, spireH: number): void {
  const pts: V2[] = Array.from({ length: 6 }, (_, j): V2 => [p[0] + Math.cos((j / 6) * Math.PI * 2) * r, p[1] + Math.sin((j / 6) * Math.PI * 2) * r]);
  const base = Math.min(...[...pts, p].map(([x, z]) => k.ground(x, z))) - SINK;
  k.lathe(
    'emissiveGreen',
    [
      [r, 0],
      [r * 0.86, h],
    ],
    { at: [p[0], 0, p[1]], seg: 6, seat: true, color: WALL_PAINT, shade: 1.08, glow: { strength: WALL_STRENGTH } },
  );
  k.cone('slate', r * 1.06, spireH, { at: [p[0], base + h, p[1]], seg: 6, color: SLATE });
}

/**
 * A wedge fin buttress (the film's steep, fin-like walls): a thin glowing blade `t` thick, `len` long at
 * its foot (from the wall outwards along `dir`), rising to a point `h` above its foot over the wall line.
 */
export function fin(k: ProxyKit, at: V2, dir: V2, len: number, h: number, t: number, shade = 1, lod?: 0 | 1 | 2): void {
  const yaw = -Math.atan2(dir[1], dir[0]) * DEG;
  const sec = (l0: number, l1: number, y: number) => ({
    outline: [
      [l0, -t / 2],
      [l1, -t / 2],
      [l1, t / 2],
      [l0, t / 2],
    ] as V2[],
    y,
  });
  k.loft('emissiveGreen', [sec(-0.08, len, 0), sec(-0.08, len * 0.45, h * 0.55), sec(-0.06, len * 0.08, h * 0.92), sec(-0.05, -0.02, h)], {
    at: [at[0], 0, at[1]],
    rot: [0, yaw, 0],
    seat: true,
    color: FIN_PAINT,
    shade,
    glow: { strength: FIN_STRENGTH },
    lod,
  });
}

/** A green window light on a wall face (local km), lifted off the face by 6 m. */
function windowLight(k: ProxyKit, p: V3, n: V2, intensity = 2, radius = 0.03): void {
  k.light([p[0] + n[0] * 0.006, p[1], p[2] + n[1] * 0.006], { color: GREEN, intensity, radius, kind: 'magic' });
}

/**
 * The walled city: battered glowing curtain walls with spiked parapets and spired towers round the shelf,
 * fin buttresses standing out from them (two great blades flanking the fanged gate), an inner ring round
 * the Tower's keep, tall steep-roofed houses packed up towards it, a few slender spires; green window
 * lights (at most `maxWindows`).
 */
export function buildCity(k: ProxyKit, maxWindows: number): void {
  // ---- the curtain wall (open at the gate) and its towers
  for (let i = 0; i + 1 < WALL.length; i++) wallSeg(k, WALL[i], WALL[i + 1], 0.62, 0.17, 0.1, 0.92 + 0.16 * k.r(40 + i), true);
  WALL.forEach((p, i) => {
    if (i === 0 || i === WALL.length - 1) return;
    const tall = i % 2 === 1;
    wallTower(k, p, tall ? 0.13 : 0.1, tall ? 1.05 : 0.8, tall ? 0.55 : 0.4);
  });
  // fin buttresses: from the wall line outwards, between the towers (uneven heights)
  for (let i = 0; i + 1 < WALL.length; i++) {
    const a = WALL[i];
    const b = WALL[i + 1];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nf = Math.max(1, Math.round(segLen / 0.4));
    for (let j = 0; j < nf; j++) {
      const t = (j + 0.5) / nf;
      const p: V2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      // skip the fins right beside the gate (the great blades stand there)
      if (Math.hypot(p[0] - GATE[0], p[1] - GATE[1]) < 0.35) continue;
      const d = outward(p);
      const h = 0.8 + 0.35 * k.r(10 + i * 7 + j);
      fin(k, [p[0] - d[0] * 0.06, p[1] - d[1] * 0.06], d, 0.24 + 0.1 * k.r(11 + i * 7 + j), h, 0.05, 0.85 + 0.3 * k.r(12 + i * 7 + j), 0);
    }
  }
  // ---- the gate: two great blades flanking a tall dark gatehouse with a fanged, burning mouth
  const side: V2 = [GATE_OUT[1], -GATE_OUT[0]];
  for (const s of [-1, 1]) {
    const at: V2 = [GATE[0] + side[0] * s * 0.19, GATE[1] + side[1] * s * 0.19];
    fin(k, at, GATE_OUT, 0.5, 1.75, 0.07, 1.15);
  }
  const gy = k.ground(GATE[0], GATE[1]);
  const gyaw = -Math.atan2(side[1], side[0]) * DEG;
  k.house('stone', 'slate', 0.3, 0.2, 0.62, { at: [GATE[0], 0, GATE[1]], rot: [0, gyaw, 0], roof: 'gable', pitch: 62, overhang: 0.01, color: GATE_STONE, roofColor: SLATE });
  const mouth: V3 = [GATE[0] + GATE_OUT[0] * 0.101, gy, GATE[1] + GATE_OUT[1] * 0.101];
  k.box('darkStone', 0.13, 0.32, 0.01, { at: mouth, rot: [0, gyaw, 0], color: 0x0c1412 });
  k.box('emissiveGreen', 0.11, 0.25, 0.006, { at: [mouth[0] + GATE_OUT[0] * 0.004, gy, mouth[2] + GATE_OUT[1] * 0.004], rot: [0, gyaw, 0], color: 0x2f7a4c, glow: { strength: 1.0 } });
  for (const s of [-1, 0, 1]) k.cone('stone', 0.012, s ? 0.07 : 0.05, { at: [mouth[0] + GATE_OUT[0] * 0.008 + side[0] * s * 0.04, gy + 0.32, mouth[2] + GATE_OUT[1] * 0.008 + side[1] * s * 0.04], rot: [180, 0, 0], seg: 4, color: 0x9aa89f });
  windowLight(k, [mouth[0], gy + 0.12, mouth[2]], GATE_OUT, 2.5, 0.05);

  // ---- the inner ring round the Tower's keep
  const inner: V2[] = Array.from({ length: 12 }, (_, j): V2 => {
    const a = (j / 12) * Math.PI * 2;
    const r = 0.8 + 0.06 * Math.sin(3 * a + 0.7);
    return [TOWER[0] + Math.cos(a) * r, TOWER[1] + Math.sin(a) * r];
  });
  inner.forEach((p, i) => {
    wallSeg(k, p, inner[(i + 1) % inner.length], 0.5, 0.14, 0.09, 0.9 + 0.12 * k.r(60 + i), true);
    if (i % 3 === 0) wallTower(k, p, 0.08, 0.8, 0.4);
  });

  // ---- houses: tall, steep-roofed, packed and rising towards the keep; the street from the gate to the
  // inner ring kept clear
  const street: V2[] = [
    [GATE[0] - 0.06, GATE[1] - 0.1],
    [GATE[0] + 0.06, GATE[1] - 0.1],
    [TOWER[0] + 0.08, TOWER[1] + 0.75],
    [TOWER[0] - 0.08, TOWER[1] + 0.75],
  ];
  const inset = WALL.map((p): V2 => {
    const d = outward(p);
    return [p[0] - d[0] * 0.2, p[1] - d[1] * 0.2];
  });
  let lit = 0;
  k.scatter(
    { polygon: inset },
    170,
    (i, x, z, u) => {
      const dT = Math.hypot(x - TOWER[0], z - TOWER[1]);
      const near = Math.max(0, 1 - (dT - 0.85) / 0.9);
      const w = 0.09 + 0.1 * u;
      const d = 0.07 + 0.06 * k.r(100 + i);
      const h = 0.14 + 0.14 * k.r(200 + i) + 0.22 * near;
      const yaw = -Math.atan2(z - C[1], x - C[0]) * DEG + 90 + (k.r(300 + i) - 0.5) * 30;
      k.house('stone', 'slate', w, d, h, {
        at: [x, 0, z],
        rot: [0, yaw, 0],
        roof: u < 0.25 ? 'hip' : 'gable',
        pitch: 58 + 8 * k.r(400 + i),
        overhang: 0.008,
        color: HOUSE[i % HOUSE.length],
        shade: 0.85 + 0.3 * k.r(500 + i),
        roofColor: ROOF[i % ROOF.length],
        dig: 0.3,
        lod: 0,
      });
      // green windows on some of the houses, on the face turned out of the city
      if (lit < maxWindows && k.r(600 + i) < 0.34) {
        const yr = (yaw * Math.PI) / 180;
        // the house's +z face (the kit's yaw turns local x towards −z)
        const n: V2 = [Math.sin(yr), Math.cos(yr)];
        windowLight(k, [x + n[0] * (d / 2), k.ground(x, z) + h * 0.6, z + n[1] * (d / 2)], n, 1.4 + 0.8 * u, 0.022);
        lit++;
      }
    },
    { minSpacing: 0.15, avoid: [street, { at: TOWER, r: 0.95 }] },
  );
  // a few slender spires among the houses
  k.scatter(
    { polygon: inset },
    9,
    (i, x, z, u) => {
      k.tower('stone', 0.05 + 0.03 * u, 0.6 + 0.45 * u, { at: [x, 0, z], seat: true, sides: 6, taper: 0.2, roof: 'spire', roofFam: 'slate', roofColor: SLATE, roofH: 0.35 + 0.2 * u, color: HOUSE[i % HOUSE.length], lod: 0 });
    },
    { minSpacing: 0.55, avoid: [street, { at: TOWER, r: 0.95 }] },
  );
}

/**
 * The bridge over the Morgulduin from the gate to the road on the south bank: a long arched causeway,
 * its parapets lined with dark gargoyle posts whose heads catch the corpse-light.
 */
export function buildBridge(k: ProxyKit, padY: number): void {
  const a: V3 = [GATE[0] + GATE_OUT[0] * 0.12, padY + 0.04, GATE[1] + GATE_OUT[1] * 0.12];
  const b: V3 = [BRIDGE_END[0], k.ground(BRIDGE_END[0], BRIDGE_END[1]) + 0.04, BRIDGE_END[1]];
  const width = 0.13;
  k.bridge('stone', a, b, { width, arches: 7, deck: 0.07, color: BRIDGE_STONE });
  // posts along both parapets
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const dir: V2 = [(b[0] - a[0]) / L, (b[2] - a[2]) / L];
  const nrm: V2 = [-dir[1], dir[0]];
  const n = Math.floor(L / 0.22);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const y = a[1] + (b[1] - a[1]) * t;
    for (const s of [-1, 1]) {
      const px = a[0] + (b[0] - a[0]) * t + nrm[0] * s * (width / 2 - 0.012);
      const pz = a[2] + (b[2] - a[2]) * t + nrm[1] * s * (width / 2 - 0.012);
      k.box('stone', 0.022, 0.035, 0.022, { at: [px, y, pz], color: POST, lod: 0 });
      k.cone('emissiveGreen', 0.013, 0.05, { at: [px, y + 0.035, pz], seg: 4, color: PARAPET_PAINT, glow: { strength: 0.5 }, lod: 0 });
    }
  }
}
