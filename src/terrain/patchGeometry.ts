import { BufferAttribute, InstancedBufferGeometry } from 'three/webgpu';

/**
 * One (N+1)^2 grid in [0,1]^2 plus a skirt ring (attribute `skirt` = 1) that hangs below the
 * patch edges to hide sub-texel cracks between neighbouring LODs.
 */
export function createPatchGeometry(N: number): InstancedBufferGeometry {
  const verts = (N + 1) * (N + 1);
  const skirtVerts = 4 * (N + 1);
  const grid = new Float32Array((verts + skirtVerts) * 2);
  const skirt = new Float32Array(verts + skirtVerts);
  const pos = new Float32Array((verts + skirtVerts) * 3); // placeholder; real position comes from positionNode
  let v = 0;
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      grid[v * 2] = i / N;
      grid[v * 2 + 1] = j / N;
      pos[v * 3] = i / N;
      pos[v * 3 + 2] = j / N;
      v++;
    }
  const indices: number[] = [];
  const idx = (i: number, j: number) => j * (N + 1) + i;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const a = idx(i, j);
      const b = idx(i + 1, j);
      const c = idx(i, j + 1);
      const d = idx(i + 1, j + 1);
      // alternate diagonals for a more isotropic mesh
      if ((i + j) % 2 === 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, c, d, a, d, b);
    }
  // skirts: for each edge, duplicate edge vertices with skirt = 1 and stitch a strip
  const edges: [number, number][][] = [
    Array.from({ length: N + 1 }, (_, i) => [i, 0] as [number, number]),
    Array.from({ length: N + 1 }, (_, i) => [N, i] as [number, number]),
    Array.from({ length: N + 1 }, (_, i) => [N - i, N] as [number, number]),
    Array.from({ length: N + 1 }, (_, i) => [0, N - i] as [number, number]),
  ];
  for (const edge of edges) {
    const start = v;
    for (const [i, j] of edge) {
      grid[v * 2] = i / N;
      grid[v * 2 + 1] = j / N;
      pos[v * 3] = i / N;
      pos[v * 3 + 2] = j / N;
      skirt[v] = 1;
      v++;
    }
    for (let k = 0; k < N; k++) {
      const top0 = idx(edge[k][0], edge[k][1]);
      const top1 = idx(edge[k + 1][0], edge[k + 1][1]);
      const bot0 = start + k;
      const bot1 = start + k + 1;
      // outward-facing winding (edges are traversed clockwise when seen from +Y with -Z north)
      indices.push(top0, top1, bot0, top1, bot1, bot0);
    }
  }
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('grid', new BufferAttribute(grid, 2));
  g.setAttribute('skirt', new BufferAttribute(skirt, 1));
  g.setIndex(indices);
  return g;
}
