/**
 * Dynamically typed facade over three/tsl for shader-graph code.
 *
 * @types/three's generic node types reject many valid TSL compositions (swizzles on attribute
 * nodes, uniform-array elements in arithmetic, mixed scalar/node arguments). Shader modules
 * destructure from `tsl` instead of importing from 'three/tsl' directly; everything else in the
 * project stays strictly typed.
 */
import * as TSL from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tsl: any = TSL;

/** A TSL node value (untyped on purpose — see above). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TslNode = any;
