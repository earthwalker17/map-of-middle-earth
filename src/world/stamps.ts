/**
 * Terrain stamps: analytic height edits declared as data by landmarks (and places.json).
 * Composited in TypeScript on top of the baked base heightfield — landmark tuning never needs a
 * re-bake. All positions/sizes are world units (km); heights are world units (exaggerated).
 */
export type Vec2 = [number, number];

interface StampBase {
  /** blend weight 0..1 (default 1) */
  strength?: number;
}

/** Level the ground to `height` (or the local median when 'auto') inside radius, smooth falloff. */
export interface FlattenStamp extends StampBase {
  kind: 'flatten';
  at: Vec2;
  radius: number;
  falloff: number;
  height?: number | 'auto';
}

/** Add `amount` inside radius with a smooth dome profile (negative = depression). */
export interface RaiseStamp extends StampBase {
  kind: 'raise';
  at: Vec2;
  radius: number;
  amount: number;
}

/**
 * Volcano-like cone to an absolute summit height, optional crater. The profile is applied to the
 * height ABOVE `base` (the ground the landmark stands on): base + (summit − base)·tᵉ.
 */
export interface ConeStamp extends StampBase {
  kind: 'cone';
  at: Vec2;
  radius: number;
  summit: number;
  /** absolute height the profile starts from (defaults to 0 = sea level) */
  base?: number;
  /** 1 = straight cone, >1 concave (steeper top) */
  exponent?: number;
  craterRadius?: number;
  craterDepth?: number;
}

/** Plateau/mesa: raise to at least `height` with a steep rim. */
export interface PlateauStamp extends StampBase {
  kind: 'plateau';
  at: Vec2;
  radius: number;
  height: number;
  rim: number;
}

/** Carve a channel/gorge along a polyline to depth below the local surface. */
export interface CarveStamp extends StampBase {
  kind: 'carve';
  path: Vec2[];
  width: number;
  depth: number;
  falloff: number;
}

export type Stamp = FlattenStamp | RaiseStamp | ConeStamp | PlateauStamp | CarveStamp;

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function distToSegment(px: number, pz: number, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2)) : 0;
  const qx = a[0] + t * dx - px;
  const qz = a[1] + t * dz - pz;
  return Math.hypot(qx, qz);
}

/** World-space bounding box [minX, minZ, maxX, maxZ] of a stamp's influence. */
export function stampBounds(s: Stamp): [number, number, number, number] {
  switch (s.kind) {
    case 'flatten': {
      const r = s.radius + s.falloff;
      return [s.at[0] - r, s.at[1] - r, s.at[0] + r, s.at[1] + r];
    }
    case 'raise':
    case 'cone':
      return [s.at[0] - s.radius, s.at[1] - s.radius, s.at[0] + s.radius, s.at[1] + s.radius];
    case 'plateau': {
      const r = s.radius + s.rim;
      return [s.at[0] - r, s.at[1] - r, s.at[0] + r, s.at[1] + r];
    }
    case 'carve': {
      const r = s.width / 2 + s.falloff;
      const xs = s.path.map((p) => p[0]);
      const zs = s.path.map((p) => p[1]);
      return [Math.min(...xs) - r, Math.min(...zs) - r, Math.max(...xs) + r, Math.max(...zs) + r];
    }
  }
}

/**
 * Apply one stamp to height `h` at world (x, z). `ctx.auto` supplies the resolved height for
 * 'auto' flatten stamps.
 */
export function applyStamp(s: Stamp, x: number, z: number, h: number, ctx: { auto: number }): number {
  const w = s.strength ?? 1;
  switch (s.kind) {
    case 'flatten': {
      const d = Math.hypot(x - s.at[0], z - s.at[1]);
      const k = 1 - smooth(s.radius, s.radius + s.falloff, d);
      const target = s.height === undefined || s.height === 'auto' ? ctx.auto : s.height;
      return h + (target - h) * k * w;
    }
    case 'raise': {
      const d = Math.hypot(x - s.at[0], z - s.at[1]) / s.radius;
      if (d >= 1) return h;
      const k = Math.cos(d * Math.PI * 0.5) ** 2;
      return h + s.amount * k * w;
    }
    case 'cone': {
      const d = Math.hypot(x - s.at[0], z - s.at[1]);
      if (d >= s.radius) return h;
      const t = 1 - d / s.radius;
      const base = s.base ?? 0;
      let cone = base + (s.summit - base) * Math.pow(t, s.exponent ?? 1.3);
      if (s.craterRadius && d < s.craterRadius) {
        const c = 1 - d / s.craterRadius;
        cone -= (s.craterDepth ?? 0) * Math.sqrt(c);
      }
      // blend the cone foot into the terrain: never lower the ground
      const foot = smooth(0, 0.18, t);
      return h + (Math.max(h, cone) - h) * foot * w;
    }
    case 'plateau': {
      const d = Math.hypot(x - s.at[0], z - s.at[1]);
      const k = 1 - smooth(s.radius, s.radius + s.rim, d);
      return h + Math.max(0, s.height - h) * k * w;
    }
    case 'carve': {
      let d = Number.POSITIVE_INFINITY;
      for (let i = 0; i + 1 < s.path.length; i++) d = Math.min(d, distToSegment(x, z, s.path[i], s.path[i + 1]));
      const k = 1 - smooth(s.width / 2, s.width / 2 + s.falloff, d);
      return h - s.depth * k * w;
    }
  }
}
