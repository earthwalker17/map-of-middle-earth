/**
 * Film captions (S5): timeline captions → CaptionDef (text, world anchor, side, visible window), their reveal
 * curve, and the pinhole projection the TitleSystem and the film checks share (pure math, no three.js).
 *
 * Anchors: a place / pass label hangs over its landmark's display position at ground + 0.6 × the landmark's
 * built bounds height (BuiltLandmark, when the compiler is given the build), else ground + 0.5 km;
 * `anchorLiftKm` overrides the height above the ground. The label's side is picked at compile time from the
 * anchor's projection at the middle of its window: an anchor in the upper third of the frame takes the
 * label below it, otherwise above (the free sky / land above the subject).
 */
import type { CameraState } from '../core/types.ts';
import type { BuiltLandmark } from '../landmarks/records.ts';
import type { LandmarkDefinition } from '../landmarks/types.ts';
import type { World } from '../world/World.ts';
import { smoothstep } from './curves.ts';
import type { BeatJson, CaptionDef, CaptionJson, HoldJson, MoveJson } from './schema.ts';

/** Caption defaults per kind: [in, out, fadeIn, fadeOut] (beat-relative; negative out = from the end). */
export const CAPTION_DEFAULTS: Record<CaptionJson['kind'], [number, number, number, number]> = {
  title: [1.5, -1.5, 1.5, 1.2],
  place: [0.8, -0.6, 0.7, 0.6],
  pass: [0.4, -0.4, 0.5, 0.4],
  end: [1, -1, 1.2, 1.2],
  fade: [0, -0, 0, 0],
};

/** anchor height above the ground without a landmark build, km */
export const ANCHOR_LIFT_KM = 0.5;
/** share of the landmark's built height the anchor sits at */
export const ANCHOR_HEIGHT_SHARE = 0.6;

/**
 * Project a world point through a pinhole camera (CameraState: position, target, vertical fov, roll as
 * Engine.applyState applies it). Returns NDC [x, y] (±1 = frame edges, y up) and the depth along the view
 * axis (≤ 0 = behind the camera).
 */
export function projectToNdc(camera: CameraState, p: readonly [number, number, number] | readonly number[], aspect: number): [number, number, number] {
  const [px, py, pz] = camera.position;
  let fx = camera.target[0] - px;
  let fy = camera.target[1] - py;
  let fz = camera.target[2] - pz;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = forward × world up, up = right × forward (three.js lookAt with up = +Y)
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const vx = p[0] - px;
  const vy = p[1] - py;
  const vz = p[2] - pz;
  const depth = vx * fx + vy * fy + vz * fz;
  let cx = vx * rx + vz * rz;
  let cy = vx * ux + vy * uy + vz * uz;
  if (camera.roll) {
    // the camera turns by +roll about its back axis (rotateZ): view coordinates turn by −roll
    const r = (camera.roll * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const x2 = cx * c + cy * s;
    cy = -cx * s + cy * c;
    cx = x2;
  }
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  const d = Math.abs(depth) > 1e-9 ? depth : 1e-9;
  return [cx / d / (tanV * aspect), cy / d / tanV, depth];
}

/** Caption visibility 0..1 at film time t (smoothstep fades inside the window). */
export function captionReveal(c: CaptionDef, t: number): number {
  if (t < c.t0 || t > c.t1) return 0;
  const a = c.fadeIn > 0 ? smoothstep((t - c.t0) / c.fadeIn) : 1;
  const b = c.fadeOut > 0 ? 1 - smoothstep((t - (c.t1 - c.fadeOut)) / c.fadeOut) : 1;
  return Math.min(a, b);
}

export interface CaptionInputs {
  world: World;
  landmarks: LandmarkDefinition[];
  /** the landmark build (page: always; Node: `{ geometry: false }`); absent → anchors at ground + 0.5 km */
  built?: BuiltLandmark[];
  beats: BeatJson[];
  t0s: number[];
  durs: number[];
  /** the film camera at t (side selection) */
  cameraAt(t: number): CameraState;
  aspect?: number;
}

/** Anchor of a landmark label in world units. */
export function captionAnchor(world: World, def: LandmarkDefinition, built: BuiltLandmark[] | undefined, liftKm?: number): [number, number, number] {
  const p = world.place(def.placeId);
  const ground = Math.max(0, world.heights.sample(p.x, p.z));
  if (liftKm !== undefined) return [p.x, ground + liftKm, p.z];
  const b = built?.find((x) => x.id === def.id);
  if (b) return [p.x, b.origin[1] + ANCHOR_HEIGHT_SHARE * b.bounds.h, p.z];
  return [p.x, ground + ANCHOR_LIFT_KM, p.z];
}

export function compileCaptions(inp: CaptionInputs): CaptionDef[] {
  const { world, beats, t0s, durs } = inp;
  const aspect = inp.aspect ?? 16 / 9;
  const out: CaptionDef[] = [];
  beats.forEach((b, i) => {
    (b.captions ?? []).forEach((c, ci) => {
      const [din, dout, dfi, dfo] = CAPTION_DEFAULTS[c.kind];
      const bt0 = t0s[i];
      const bt1 = bt0 + durs[i];
      // beat-relative seconds; negative = from the beat's end (an `out` default of −0 = the beat's end)
      const rel = (v: number | undefined, dflt: number, isOut: boolean) => {
        const x = v ?? dflt;
        return x < 0 || (isOut && Object.is(x, -0)) ? bt1 + x : bt0 + x;
      };
      const id = `${(b as HoldJson).hold ?? (b as MoveJson).move}:${c.kind}:${ci}`;
      const def: CaptionDef = { id, kind: c.kind, t0: rel(c.in, din, false), t1: rel(c.out, dout, true), fadeIn: c.fadeIn ?? dfi, fadeOut: c.fadeOut ?? dfo };
      if (c.kind === 'place' || c.kind === 'pass') {
        const lm = inp.landmarks.find((l) => l.id === c.landmark);
        if (!lm) throw new Error(`film: caption landmark '${c.landmark}' unknown`);
        def.title = c.text ?? lm.annotation.title;
        if (c.kind === 'place' && c.sub !== false) def.sub = c.sub ?? lm.annotation.subtitle;
        if (c.kind === 'pass' && typeof c.sub === 'string') def.sub = c.sub;
        def.anchor = captionAnchor(world, lm, inp.built, c.anchorLiftKm);
        if (c.side) def.side = c.side;
        else {
          const [, ny, depth] = projectToNdc(inp.cameraAt((def.t0 + def.t1) / 2), def.anchor, aspect);
          def.side = depth > 0 && ny > 1 / 3 ? 'below' : 'above';
        }
      } else {
        if (c.text) def.title = c.text;
        if (typeof c.sub === 'string') def.sub = c.sub;
        if (c.lines) def.lines = c.lines;
      }
      out.push(def);
    });
  });
  return out;
}
