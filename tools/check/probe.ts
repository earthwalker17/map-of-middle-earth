/**
 * CPU camera probe v2 (no GPU, no lock) — ray-marches a shot over the baked world + landmark stamp layer
 * and measures its framing, for designing bookmarks / shot lists without spending a render and for the
 * bookmark gates in `pnpm check` (tools/check/bookmarks.ts).
 *
 * Every ray is classified:
 *  - terrain / water — hits the slab top (water where a lake or the sea covers the ground)
 *  - sky   — leaves above the horizon (dy ≥ 0) without touching the slab
 *  - void  — misses the slab while looking down (the studio backdrop around the floating board)
 *  - edge  — enters the slab box through a side face below the terrain (the strata cut face)
 * `topVoid` is the void + edge share of the top 15 % of rows (a hero shot must show sky or land there).
 * The subject is measured from the landmark build (geometry bounds) united with its terrain stamps
 * (massifs, cones, raises: the mountain IS the landmark for Erebor / Mount Doom), projected at the
 * reference frame (1600×900 by default).
 */
import type { CameraState } from '../../src/core/types.ts';
import type { ShotSpecInput } from '../../src/camera/shots.ts';
import type { World } from '../../src/world/World.ts';
import type { Stamp } from '../../src/world/stamps.ts';
import type { BuiltLandmark } from '../../src/landmarks/records.ts';
import type { LandmarkDefinition } from '../../src/landmarks/types.ts';
import { bakedDir, loadWorld, ROOT } from './baked.ts';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

/** bottom of the plinth (src/diorama/slabSpec.ts plinthBottom) and a ceiling above every summit */
const SLAB_BOTTOM = -44.6;
const SLAB_TOP = 90;

export interface SubjectBox {
  id: string;
  min: [number, number, number];
  max: [number, number, number];
}

export interface ProbeContext {
  world: World;
  landmarks: LandmarkDefinition[];
  built: BuiltLandmark[];
  stamps: Stamp[];
  /** composite ground height */
  H(x: number, z: number): number;
  /** water surface (lake level, 0 over the sea) or −99 where there is none */
  WL(x: number, z: number): number;
  /** subject box per landmark id (geometry bounds ∪ raising stamps) */
  subjects: Map<string, SubjectBox>;
  resolve(shot: ShotSpecInput): CameraState;
}

export interface ProbeSubject {
  id: string;
  /** projected extent in px at the reference frame */
  pxH: number;
  pxW: number;
  /** fraction of the subject's sample points with a clear line of sight */
  visible: number;
  /** NDC y of the subject top / bottom (±1 = frame edge) */
  topNdcY: number;
  bottomNdcY: number;
  /** NDC x of the subject centre */
  centerNdcX: number;
}

export interface ProbeResult {
  id: string;
  clearKm: number;
  sky: number;
  void: number;
  edge: number;
  topVoid: number;
  near: number;
  water: number;
  terrain: number;
  /** worst terrain height above the camera→target sight line (> 0 = blocked): to target ground + 0.3, to the subject's upper body */
  losGround: number;
  losMid: number;
  distanceKm: number;
  subject?: ProbeSubject;
  others: ProbeSubject[];
}

export interface ProbeOptions {
  subject?: string;
  others?: string[];
  grid?: [number, number];
  refW?: number;
  refH?: number;
}

const mod = (p: string) => pathToFileURL(join(ROOT, p)).href;

/** Load the world (memory-guarded), composite stamps, build landmark records (no geometry kept). */
export async function createProbeContext(
  dir = bakedDir(),
  preloaded?: { world: World; landmarks: LandmarkDefinition[]; stamps: Stamp[] },
): Promise<ProbeContext> {
  const { world, landmarks, stamps } = preloaded ?? (await loadWorld(dir));
  const { buildLandmarks } = (await import(mod('src/landmarks/build.ts'))) as typeof import('../../src/landmarks/build.ts');
  const { landmarkStamps } = (await import(mod('src/landmarks/world.ts'))) as typeof import('../../src/landmarks/world.ts');
  const { stampBounds } = (await import(mod('src/world/stamps.ts'))) as typeof import('../../src/world/stamps.ts');
  const { resolveShot } = (await import(mod('src/camera/shots.ts'))) as typeof import('../../src/camera/shots.ts');
  const built = await buildLandmarks(world, landmarks, { geometry: false });
  const spec = world.spec;
  const H = (x: number, z: number) => world.heights.sample(x, z);

  // water level raster (1 km) so ray marching stays cheap
  const gw = Math.ceil(spec.xMax - spec.xMin);
  const gh = Math.ceil(spec.zMax - spec.zMin);
  const wl = new Float32Array(gw * gh).fill(-99);
  const inside = (r: [number, number][], x: number, z: number) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, zi] = r[i];
      const [xj, zj] = r[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  for (const l of world.lakes) {
    if (l.level === null) continue;
    const ring = l.ring as [number, number][];
    const xs = ring.map((q) => q[0]);
    const zs = ring.map((q) => q[1]);
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++)
      for (let z = Math.floor(Math.min(...zs)); z <= Math.ceil(Math.max(...zs)); z++) {
        const i = x - Math.floor(spec.xMin);
        const j = z - Math.floor(spec.zMin);
        if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
        if (inside(ring, x + 0.5, z + 0.5)) wl[j * gw + i] = l.level;
      }
  }
  const WL = (x: number, z: number) => {
    const i = Math.floor(x - Math.floor(spec.xMin));
    const j = Math.floor(z - Math.floor(spec.zMin));
    if (i < 0 || j < 0 || i >= gw || j >= gh) return -99;
    const v = wl[j * gw + i];
    return v > -99 ? v : 0; // the sea plane covers everything below 0
  };

  // subject boxes: geometry bounds ∪ the landmark's raising stamps (sampled composite heights)
  const subjects = new Map<string, SubjectBox>();
  for (const b of built) {
    const [cx, , cz] = b.bounds.center;
    const r = Math.max(b.bounds.r, 0.3);
    const min: [number, number, number] = [cx - r, b.origin[1], cz - r];
    const max: [number, number, number] = [cx + r, b.origin[1] + Math.max(b.bounds.h, 0.3), cz + r];
    for (const s of landmarkStamps(world, [b.def])) {
      if (s.kind === 'flatten' || s.kind === 'carve') continue;
      if ('lowerOnly' in s && s.lowerOnly) continue;
      const [x0, z0, x1, z1] = stampBounds(s);
      // the stamp's own raised body (composite − base ground): cells lifted by ≥ 25 % of the maximum lift,
      // so natural mountains inside the stamp bounds (Mindolluin behind Minas Tirith) do not count
      const n = 24;
      const lift: number[] = [];
      const hs: number[] = [];
      for (let i = 0; i <= n; i++)
        for (let j = 0; j <= n; j++) {
          const x = x0 + ((x1 - x0) * i) / n;
          const z = z0 + ((z1 - z0) * j) / n;
          const h = H(x, z);
          hs.push(h);
          lift.push(h - world.heights.sample(x, z, 'base'));
        }
      const maxLift = Math.max(...lift);
      if (maxLift < 0.3) continue;
      let top = -Infinity;
      let foot = Infinity;
      let bx0 = Infinity;
      let bx1 = -Infinity;
      let bz0 = Infinity;
      let bz1 = -Infinity;
      for (let i = 0; i <= n; i++)
        for (let j = 0; j <= n; j++) {
          const k = i * (n + 1) + j;
          if (lift[k] < 0.25 * maxLift) continue;
          const x = x0 + ((x1 - x0) * i) / n;
          const z = z0 + ((z1 - z0) * j) / n;
          top = Math.max(top, hs[k]);
          foot = Math.min(foot, hs[k] - lift[k]);
          bx0 = Math.min(bx0, x);
          bx1 = Math.max(bx1, x);
          bz0 = Math.min(bz0, z);
          bz1 = Math.max(bz1, z);
        }
      min[0] = Math.min(min[0], bx0);
      min[2] = Math.min(min[2], bz0);
      max[0] = Math.max(max[0], bx1);
      max[2] = Math.max(max[2], bz1);
      max[1] = Math.max(max[1], top);
      // the body stands on its base ground (a crater-floor origin must not cut the mountain off)
      min[1] = Math.min(min[1], foot);
    }
    subjects.set(b.id, { id: b.id, min, max });
  }

  return { world, landmarks, built, stamps, H, WL, subjects, resolve: (s) => resolveShot(world, s).camera };
}

/** ray vs axis-aligned box: [tEnter, tExit] or null */
function rayBox(o: number[], d: number[], lo: number[], hi: number[]): [number, number] | null {
  let t0 = 0;
  let t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < lo[a] || o[a] > hi[a]) return null;
      continue;
    }
    let ta = (lo[a] - o[a]) / d[a];
    let tb = (hi[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

/** Probe one camera. */
export function probeCamera(ctx: ProbeContext, id: string, cam: CameraState, o: ProbeOptions = {}): ProbeResult {
  const { H, WL, world } = ctx;
  const spec = world.spec;
  const [W, Hh] = o.grid ?? [48, 27];
  const refW = o.refW ?? 1600;
  const refH = o.refH ?? 900;
  const aspect = refW / refH;
  const [px, py, pz] = cam.position;
  const [tx, ty, tz] = cam.target;
  let fx = tx - px;
  let fy = ty - py;
  let fz = tz - pz;
  const dist = Math.hypot(fx, fy, fz);
  fx /= dist;
  fy /= dist;
  fz /= dist;
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const tanV = Math.tan((cam.fov * Math.PI) / 360);
  const tanH = tanV * aspect;
  const lo = [spec.xMin, SLAB_BOTTOM, spec.zMin];
  const hi = [spec.xMax, SLAB_TOP, spec.zMax];
  const edgeTop = (x: number, z: number) => Math.max(H(Math.min(Math.max(x, spec.xMin + 0.01), spec.xMax - 0.01), Math.min(Math.max(z, spec.zMin + 0.01), spec.zMax - 0.01)), 0);

  let sky = 0;
  let voidN = 0;
  let edge = 0;
  let near = 0;
  let water = 0;
  let terrain = 0;
  let topBad = 0;
  let topN = 0;
  for (let j = 0; j < Hh; j++)
    for (let i = 0; i < W; i++) {
      const sx = ((i + 0.5) / W) * 2 - 1;
      const sy = 1 - ((j + 0.5) / Hh) * 2;
      let dx = fx + rx * sx * tanH + ux * sy * tanV;
      let dy = fy + uy * sy * tanV;
      let dz = fz + rz * sx * tanH + uz * sy * tanV;
      const dl = Math.hypot(dx, dy, dz);
      dx /= dl;
      dy /= dl;
      dz /= dl;
      const isTop = j < Hh * 0.15;
      if (isTop) topN++;
      let cls: 'sky' | 'void' | 'edge' | 'terrain' | 'water' = dy >= 0 ? 'sky' : 'void';
      let hitT = -1;
      const box = rayBox([px, py, pz], [dx, dy, dz], lo, hi);
      if (box) {
        const [t0, t1] = box;
        const ex = px + dx * t0;
        const ey = py + dy * t0;
        const ez = pz + dz * t0;
        const onSide = t0 > 0 && (Math.abs(ex - spec.xMin) < 1e-6 || Math.abs(ex - spec.xMax) < 1e-6 || Math.abs(ez - spec.zMin) < 1e-6 || Math.abs(ez - spec.zMax) < 1e-6);
        if (onSide && ey < edgeTop(ex, ez)) cls = 'edge';
        else
          for (let t = Math.max(t0, 0.05); t <= t1; t += Math.max(0.05, t * 0.008)) {
            const x = px + dx * t;
            const y = py + dy * t;
            const z = pz + dz * t;
            const hh = H(x, z);
            const ww = WL(x, z);
            if (y < Math.max(hh, ww)) {
              hitT = t;
              cls = ww > hh ? 'water' : 'terrain';
              break;
            }
          }
      }
      if (cls === 'sky') sky++;
      else if (cls === 'void') voidN++;
      else if (cls === 'edge') edge++;
      else {
        if (cls === 'water') water++;
        else terrain++;
        if (hitT < dist * 0.6) near++;
      }
      if (isTop && (cls === 'void' || cls === 'edge')) topBad++;
    }
  const N = W * Hh;

  const proj = (x: number, y: number, z: number): [number, number, number] => {
    const vx = x - px;
    const vy = y - py;
    const vz = z - pz;
    const zf = vx * fx + vy * fy + vz * fz;
    return [(vx * rx + vz * rz) / zf / tanH, (vx * ux + vy * uy + vz * uz) / zf / tanV, zf];
  };
  const blocked = (x: number, y: number, z: number) => {
    let worst = -Infinity;
    for (let s = 0.02; s < 0.985; s += 0.005) {
      const qx = px + (x - px) * s;
      const qz = pz + (z - pz) * s;
      const qy = py + (y - py) * s;
      worst = Math.max(worst, H(qx, qz) - qy);
    }
    return worst;
  };
  const measure = (sid: string): ProbeSubject | undefined => {
    const b = ctx.subjects.get(sid);
    if (!b) return undefined;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    let behind = false;
    for (const X of [b.min[0], b.max[0]])
      for (const Y of [b.min[1], b.max[1]])
        for (const Z of [b.min[2], b.max[2]]) {
          const [nx, ny, zf] = proj(X, Y, Z);
          if (zf <= 0.01) behind = true;
          x0 = Math.min(x0, nx);
          x1 = Math.max(x1, nx);
          y0 = Math.min(y0, ny);
          y1 = Math.max(y1, ny);
        }
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;
    const midY = (b.min[1] + b.max[1]) / 2;
    // occlusion samples: the top, and the box sides at 60 % height (never the interior: for a massif or
    // a cone the box centre lies inside the mountain)
    const y60 = b.min[1] + 0.6 * (b.max[1] - b.min[1]);
    const pts: [number, number, number][] = [
      [cx, b.max[1], cz],
      [b.min[0], y60, cz],
      [b.max[0], y60, cz],
      [cx, y60, b.min[2]],
      [cx, y60, b.max[2]],
    ];
    const visible = pts.filter((p) => blocked(p[0], p[1] + 0.05, p[2]) < 0).length / pts.length;
    const cxN = proj(cx, midY, cz)[0];
    // clip the extent to the frame so a subject larger than the frame reports the visible part
    const cl = (v: number) => Math.min(1, Math.max(-1, v));
    return {
      id: sid,
      pxH: behind ? 0 : ((cl(y1) - cl(y0)) / 2) * refH,
      pxW: behind ? 0 : ((cl(x1) - cl(x0)) / 2) * refW,
      visible,
      topNdcY: y1,
      bottomNdcY: y0,
      centerNdcX: cxN,
    };
  };
  const subj = o.subject ? measure(o.subject) : undefined;
  const sb = o.subject ? ctx.subjects.get(o.subject) : undefined;
  const losGround = blocked(tx, H(tx, tz) + 0.3, tz);
  // line of sight to the subject's upper body (90 % of its height, on its axis): towers, citadels, summits
  const losMid = sb ? blocked((sb.min[0] + sb.max[0]) / 2, sb.min[1] + 0.9 * (sb.max[1] - sb.min[1]), (sb.min[2] + sb.max[2]) / 2) : losGround;
  return {
    id,
    clearKm: py - Math.max(H(px, pz), WL(px, pz)),
    sky: sky / N,
    void: voidN / N,
    edge: edge / N,
    topVoid: topN ? topBad / topN : 0,
    near: near / N,
    water: water / N,
    terrain: terrain / N,
    losGround,
    losMid,
    distanceKm: dist,
    subject: subj,
    others: (o.others ?? []).map(measure).filter((x): x is ProbeSubject => !!x),
  };
}

/** Probe a shot spec (orbit or explicit camera). */
export function probeShot(ctx: ProbeContext, shot: ShotSpecInput, o: ProbeOptions = {}): ProbeResult {
  return probeCamera(ctx, shot.id, ctx.resolve(shot), o);
}

/** Every landmark bookmark as a shot (same conversion as the page: src/app/boot.ts landmarkShots). */
export function bookmarkShots(landmarks: LandmarkDefinition[]): { def: LandmarkDefinition; shot: ShotSpecInput; suffix: string }[] {
  const out: { def: LandmarkDefinition; shot: ShotSpecInput; suffix: string }[] = [];
  for (const def of landmarks)
    for (const b of def.bookmarks ?? []) {
      const { id, tod, dayOfYear, weather, fStop, events, compare, note, expect: _e, ...orbit } = b;
      void events;
      void dayOfYear;
      void weather;
      void fStop;
      void compare;
      void note;
      out.push({ def, suffix: id.startsWith(`${def.id}-`) ? id.slice(def.id.length + 1) : id, shot: { id, tod: tod ?? 15, camera: { orbit: { place: def.placeId, ...orbit } } } });
    }
  return out;
}

/** One-line human summary of a probe result. */
export function fmtProbe(r: ProbeResult): string {
  const p = (v: number) => `${(v * 100).toFixed(0)}%`.padStart(4);
  const s = r.subject;
  const subj = s ? `subject ${s.pxH.toFixed(0).padStart(4)}×${s.pxW.toFixed(0).padStart(4)}px vis ${p(s.visible)} top ${s.topNdcY.toFixed(2)} bot ${s.bottomNdcY.toFixed(2)} x ${s.centerNdcX.toFixed(2)}` : '';
  const others = r.others.map((q) => `${q.id} ${q.pxH.toFixed(0)}px(${q.centerNdcX.toFixed(2)},${q.topNdcY.toFixed(2)}) vis ${p(q.visible)}`).join(' · ');
  return (
    `${r.id.padEnd(24)} d ${r.distanceKm.toFixed(0).padStart(4)} clear ${r.clearKm.toFixed(1).padStart(5)} sky ${p(r.sky)} void ${p(r.void)} edge ${p(r.edge)} topVoid ${p(r.topVoid)} ` +
    `near ${p(r.near)} water ${p(r.water)} losG ${r.losGround.toFixed(2).padStart(6)} losM ${r.losMid.toFixed(2).padStart(6)} ${subj}${others ? '  | ' + others : ''}`
  );
}
