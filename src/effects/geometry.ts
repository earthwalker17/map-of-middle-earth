import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from 'three/webgpu';
import type { FallRecord, V3 } from '../landmarks/records.ts';
import { BEAM, FALLS, MIST } from './presets.ts';

/**
 * Static geometry of the EffectsSystem (built once at init, pure functions of the world records):
 * waterfall ribbons + plunge-foam discs, mist cards, beams. Animation lives in the materials (env.tFx).
 */

export type HeightFn = (x: number, z: number) => number;

/** what a fall hands on to the particles: its spray source */
export interface FallSpray {
  landmark: string;
  /** world plunge point */
  p: V3;
  /** horizontal unit vector away from the cliff */
  out: [number, number];
  /** spray size, km */
  scale: number;
  seed: number;
  /** a wide fall (Rauros) also raises a tall mist column over its foot: its scale (0 = none) */
  column: number;
}

/** run / drop of a two-point fall at and above which it is draped on the ground (a ribbon down a slope) */
const DRAPE_RUN = 0.2;

const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Catmull-Rom (uniform) through the path's points, `n + 1` samples; a 2-point path is its segment. */
function resample(path: V3[], n: number): V3[] {
  if (path.length === 2) return Array.from({ length: n + 1 }, (_, i) => lerp3(path[0], path[1], i / n));
  const out: V3[] = [];
  const m = path.length - 1;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * m;
    const k = Math.min(m - 1, Math.floor(s));
    const t = s - k;
    const p0 = path[Math.max(0, k - 1)];
    const p1 = path[k];
    const p2 = path[k + 1];
    const p3 = path[Math.min(m, k + 2)];
    const t2 = t * t;
    const t3 = t2 * t;
    const c = (j: number) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
    out.push([c(0), c(1), c(2)]);
  }
  return out;
}

/**
 * Waterfall ribbons (two curtain layers: a white core and a wider, fainter veil a little in front) along
 * each fall's path, kept clear of the ground (a fall that meets its slope slides down it as a cascade), and
 * a plunge-foam disc at the foot. Returns the geometry (null without falls) and the spray sources.
 */
export function buildFalls(falls: FallRecord[], heightAt: HeightFn, waterAt: (x: number, z: number) => number | null = () => null): { geometry: BufferGeometry | null; sprays: FallSpray[] } {
  const pos: number[] = [];
  const nrm: number[] = [];
  const fa: number[] = [];
  const fb: number[] = [];
  const side: number[] = [];
  const tan: number[] = [];
  const idx: number[] = [];
  const sprays: FallSpray[] = [];
  const S = FALLS.segments;
  const COLS = 5;
  // index of a drawn fall (fallT.w: its key-visibility slot in the material, EffectsSystem.fallRefs order)
  let index = -1;
  for (const [fi, f] of falls.entries()) {
    if (f.path.length < 2 || !(f.width > 0)) continue;
    index++;
    const lip = f.path[0];
    const footIn = f.path[f.path.length - 1];
    const drop = Math.max(0.01, lip[1] - footIn[1]);
    const run = Math.hypot(footIn[0] - lip[0], footIn[2] - lip[2]);
    // horizontal flow direction (lip → foot); a vertical drop takes the downhill direction at the lip
    let dx = footIn[0] - lip[0];
    let dz = footIn[2] - lip[2];
    let dl = Math.hypot(dx, dz);
    if (dl < 0.02) {
      const e = 0.05;
      dx = heightAt(lip[0] - e, lip[2]) - heightAt(lip[0] + e, lip[2]);
      dz = heightAt(lip[0], lip[2] - e) - heightAt(lip[0], lip[2] + e);
      dl = Math.hypot(dx, dz);
      if (dl < 1e-6) {
        dx = 1;
        dz = 0;
        dl = 1;
      }
    }
    dx /= dl;
    dz /= dl;
    // width axis: horizontal, across the flow
    const wx = -dz;
    const wz = dx;
    // a two-point path that runs far over its drop is a ribbon fall down a slope (lip and foot on the
    // ground, research: Rivendell's walls): it is draped on the ground (a little wider: seen along the wall
    // it would read as a thread); a steep one (Rauros) or an authored curve (Henneth Annûn's curtain) hangs
    // free along its path — never below the ground
    const drape = f.path.length === 2 && run / drop >= DRAPE_RUN;
    const width = f.width * (drape ? FALLS.drapeWiden : 1);
    // clearance: the curtain turns part-way to the camera (FALLS.facing), its edges must stay out of the rock
    const clear = 0.015 + 0.06 * width + (drape ? 0.5 * FALLS.facing * width : 0);
    const pts = resample(f.path, S).map((p) => {
      const g = heightAt(p[0], p[2]) + clear;
      return [p[0], drape ? g : Math.max(p[1], g), p[2]] as V3;
    });
    // arc length along the path (km from the lip)
    const arc = [0];
    for (let i = 1; i <= S; i++) arc.push(arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
    const L = arc[S];
    const seed = ((f.seed >>> 0) % 997) / 997;
    for (let layer = 0; layer < 2; layer++) {
      const base = pos.length / 3;
      const wk = layer === 0 ? 1 : FALLS.veil;
      for (let i = 0; i <= S; i++) {
        const t = i / S;
        const p = pts[i];
        // tangent and the curtain's outward normal (perpendicular to the width axis and the tangent)
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(S, i + 1)];
        let tx = b[0] - a[0];
        let ty = b[1] - a[1];
        let tz = b[2] - a[2];
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl;
        ty /= tl;
        tz /= tl;
        // n = w × t with w = (wx, 0, wz), oriented away from the cliff (along the flow)
        let nx = -wz * ty;
        let ny = wz * tx - wx * tz;
        let nz = wx * ty;
        if (nx * dx + nz * dz < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        // falls spread a little as they drop; the veil hangs in front of the core. The vertex sits on the
        // axis; its offset across (fallW) is turned toward the camera in the vertex stage
        const half = (width * wk * (1 + 0.3 * t)) / 2;
        const off = layer === 0 ? 0 : 0.012 + 0.03 * width * (0.5 + t);
        for (let j = 0; j < COLS; j++) {
          const u = j / (COLS - 1);
          const s = (u - 0.5) * 2 * half;
          pos.push(p[0] + nx * off, p[1] + ny * off, p[2] + nz * off);
          side.push(wx * s, 0, wz * s);
          tan.push(tx, ty, tz, index);
          nrm.push(nx, ny, nz);
          fa.push(u, arc[i], L, layer);
          fb.push(width * wk, seed + layer * 0.21, width, 0);
        }
      }
      for (let i = 0; i < S; i++)
        for (let j = 0; j < COLS - 1; j++) {
          const v0 = base + i * COLS + j;
          idx.push(v0, v0 + COLS, v0 + 1, v0 + 1, v0 + COLS, v0 + COLS + 1);
        }
    }
    // plunge foam: a disc of rings at the foot, on the water / ground there
    const foot = pts[S];
    // (the authored foot is the plunge pool's surface; a draped fall's foot is on the ground)
    // (a landmark pool or a lake over the foot: the foam floats on its surface)
    const fy = Math.max(drape ? foot[1] : footIn[1], heightAt(foot[0], foot[2]), waterAt(foot[0], foot[2]) ?? -1e9) + 0.006;
    const R = FALLS.foam * (0.6 * width + 0.045 * drop);
    const RING = FALLS.foamRings;
    const SEC = FALLS.foamSectors;
    const fBase = pos.length / 3;
    const fcx = foot[0] + dx * R * 0.25;
    const fcz = foot[2] + dz * R * 0.25;
    for (let r = 0; r <= RING; r++)
      for (let s = 0; s <= SEC; s++) {
        const rr = r / RING;
        const an = (s / SEC) * Math.PI * 2;
        pos.push(fcx + Math.cos(an) * R * rr, fy, fcz + Math.sin(an) * R * rr);
        side.push(0, 0, 0);
        tan.push(0, 0, 0, index);
        nrm.push(0, 1, 0);
        fa.push(rr, s / SEC, 1, 2);
        fb.push(R * 2, seed, R, R);
      }
    for (let r = 0; r < RING; r++)
      for (let s = 0; s < SEC; s++) {
        const v0 = fBase + r * (SEC + 1) + s;
        idx.push(v0, v0 + SEC + 1, v0 + 1, v0 + 1, v0 + SEC + 1, v0 + SEC + 2);
      }
    sprays.push({ landmark: f.landmark, p: [foot[0], fy + 0.01, foot[2]], out: [dx, dz], scale: Math.max(Math.min(FALLS.sprayWidth * width, FALLS.sprayMax), FALLS.sprayDrop * drop), seed: (f.seed ^ (0x9e3779b9 + fi)) >>> 0, column: width >= FALLS.columnWidth ? FALLS.column * width : 0 });
  }
  if (!idx.length) return { geometry: null, sprays };
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.setAttribute('fallA', new Float32BufferAttribute(fa, 4));
  g.setAttribute('fallB', new Float32BufferAttribute(fb, 4));
  g.setAttribute('fallW', new Float32BufferAttribute(side, 3));
  g.setAttribute('fallT', new Float32BufferAttribute(tan, 4));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  // the vertices sit on the axes: the curtains' half-widths reach beyond them
  if (g.boundingSphere) g.boundingSphere.radius += Math.max(...falls.map((f) => f.width)) * FALLS.veil * FALLS.drapeWiden;
  return { geometry: g, sprays };
}

/** a mist card in world space (a 'mist' emitter: a band from `at` to `to`, half-width `scale`) */
export interface MistCard {
  at: V3;
  to?: V3;
  halfWidth: number;
  opacity: number;
  /** linear tint */
  tint: V3;
  seed: number;
}

/**
 * Mist cards: MIST.layers stacked horizontal grids per card (the base at the card's height, the next
 * layers MIST spacing above), each vertex with the ground height under it (preview's soft edge).
 */
export function buildMist(cards: MistCard[], heightAt: HeightFn): BufferGeometry | null {
  if (!cards.length) return null;
  const pos: number[] = [];
  const ma: number[] = [];
  const mb: number[] = [];
  const mc: number[] = [];
  const mi: number[] = [];
  const idx: number[] = [];
  const [GX, GZ] = MIST.grid;
  for (const [ci, c] of cards.entries()) {
    const to = c.to ?? c.at;
    let ax = to[0] - c.at[0];
    let az = to[2] - c.at[2];
    const len = Math.hypot(ax, az);
    if (len < 1e-6) {
      ax = 1;
      az = 0;
    } else {
      ax /= len;
      az /= len;
    }
    const half = len / 2 + c.halfWidth;
    const cx = (c.at[0] + to[0]) / 2;
    const cz = (c.at[2] + to[2]) / 2;
    const y0 = c.at[1];
    const dy = (to[1] - c.at[1]) / 2;
    const spacing = Math.min(MIST.maxSpacing, MIST.spacing * c.halfWidth);
    const L = MIST.layers;
    for (let l = 0; l < L; l++) {
      const base = pos.length / 3;
      const lt = L > 1 ? l / (L - 1) : 0;
      for (let j = 0; j <= GZ; j++)
        for (let i = 0; i <= GX; i++) {
          const u = (i / GX) * 2 - 1;
          const v = (j / GZ) * 2 - 1;
          const x = cx + ax * u * half - az * v * c.halfWidth;
          const z = cz + az * u * half + ax * v * c.halfWidth;
          const y = y0 + dy * (u + 1) + l * spacing;
          pos.push(x, y, z);
          ma.push(u, v, lt, heightAt(x, z));
          mb.push(c.tint[0], c.tint[1], c.tint[2], (c.opacity * MIST.opacity) / Math.sqrt(L));
          mc.push(spacing, c.halfWidth, ((c.seed >>> 0) % 1000) / 1000 + l * 0.29, lt);
          mi.push(ci);
        }
      for (let j = 0; j < GZ; j++)
        for (let i = 0; i < GX; i++) {
          const v0 = base + j * (GX + 1) + i;
          idx.push(v0, v0 + GX + 1, v0 + 1, v0 + 1, v0 + GX + 1, v0 + GX + 2);
        }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('mistA', new Float32BufferAttribute(ma, 4));
  g.setAttribute('mistB', new Float32BufferAttribute(mb, 4));
  g.setAttribute('mistC', new Float32BufferAttribute(mc, 4));
  // the card's index: its key-visibility slot in the material (EffectsSystem, per frame)
  g.setAttribute('mistI', new Float32BufferAttribute(mi, 1));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** a beam in world space ('beam' emitter: from `p` to `to`) */
export interface BeamDecl {
  from: V3;
  to: V3;
  /** HDR colour (linear × radiance) */
  color: V3;
  /** glow / core half-widths, km */
  glow: number;
  core: number;
  /** materials/gates.ts code */
  gate: number;
}

/** Beams: a strip along each axis (the vertex stage turns it to face the camera around the axis). */
export function buildBeams(beams: BeamDecl[]): BufferGeometry | null {
  if (!beams.length) return null;
  const pos: number[] = [];
  const ba: number[] = [];
  const bb: number[] = [];
  const bc: number[] = [];
  const idx: number[] = [];
  const S = BEAM.segments;
  for (const b of beams) {
    const dx = b.to[0] - b.from[0];
    const dy = b.to[1] - b.from[1];
    const dz = b.to[2] - b.from[2];
    const L = Math.hypot(dx, dy, dz) || 1;
    const base = pos.length / 3;
    for (let i = 0; i <= S; i++) {
      const t = i / S;
      for (const side of [-1, 1]) {
        pos.push(b.from[0] + dx * t, b.from[1] + dy * t, b.from[2] + dz * t);
        ba.push(side, t, b.glow, b.gate);
        bb.push(dx / L, dy / L, dz / L, b.core);
        bc.push(b.color[0], b.color[1], b.color[2], L);
      }
    }
    for (let i = 0; i < S; i++) {
      const v0 = base + i * 2;
      idx.push(v0, v0 + 2, v0 + 1, v0 + 1, v0 + 2, v0 + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('beamA', new Float32BufferAttribute(ba, 4));
  g.setAttribute('beamB', new Float32BufferAttribute(bb, 4));
  g.setAttribute('beamC', new Float32BufferAttribute(bc, 4));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  return g;
}
