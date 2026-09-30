import type { CameraState } from '../core/types.ts';
import type { ShotSpec } from '../core/Timeline.ts';
import type { World } from '../world/World.ts';

export interface OrbitSpec {
  place?: string;
  /** ME-GIS km [x, y] */
  targetKm?: [number, number];
  distanceKm: number;
  elevationDeg: number;
  /** compass direction from target to camera (0 = north, 90 = east, 180 = south) */
  azimuthDeg: number;
  fov?: number;
  /** extra height of the look-at point above ground */
  lift?: number;
  /** aim offset from the place / target, ME-GIS km [east, north] (off-centre framing, rule of thirds) */
  aimKm?: [number, number];
  /** camera roll around the view axis, degrees */
  roll?: number;
}

export type ShotCamera = CameraState | { orbit: OrbitSpec };

export interface ShotSpecInput extends Omit<ShotSpec, 'camera'> {
  camera: ShotCamera;
}

export function orbitCamera(world: World, o: OrbitSpec): CameraState {
  let x: number;
  let z: number;
  if (o.place) {
    const p = world.place(o.place);
    x = p.x;
    z = p.z;
  } else if (o.targetKm) {
    [x, z] = world.spec.kmToWorld(o.targetKm[0], o.targetKm[1]);
  } else throw new Error('orbit needs place or targetKm');
  if (o.aimKm) {
    x += o.aimKm[0];
    z -= o.aimKm[1];
  }
  const ty = Math.max(0, world.heights.sample(x, z)) + (o.lift ?? 0);
  const el = (o.elevationDeg * Math.PI) / 180;
  const az = (o.azimuthDeg * Math.PI) / 180;
  const hd = o.distanceKm * Math.cos(el);
  return {
    position: [x + Math.sin(az) * hd, ty + o.distanceKm * Math.sin(el), z - Math.cos(az) * hd],
    target: [x, ty, z],
    fov: o.fov ?? 35,
    ...(o.roll ? { roll: o.roll } : {}),
  };
}

export function resolveShot(world: World, s: ShotSpecInput): ShotSpec {
  const cam = 'orbit' in s.camera ? orbitCamera(world, s.camera.orbit) : s.camera;
  return { ...s, camera: cam };
}
