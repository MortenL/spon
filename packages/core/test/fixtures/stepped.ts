import type { Mesh } from '../../src';
import { steppedData } from './steppedData.mjs';

/**
 * A closed box stack in mm: a base slab 60 x 40 x 10 (z 0..10) with a boss 20 x 20 x 10 on top (x 20..40, y 10..30,
 * z 10..20). The overlap between the boss bottom and the slab top is omitted; slab faces are split along the boss
 * footprint so the surface is watertight. Triangles are wound with outward normals.
 */
export function steppedMesh(): Mesh {
  const { pos, idx } = steppedData();
  const positions = Float32Array.from(pos);
  const indices = Uint32Array.from(idx);
  const normals = new Float32Array(indices.length);
  for (let t = 0; t < indices.length / 3; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => indices[t * 3 + k] * 3);
    const u = [0, 1, 2].map((k) => positions[b + k] - positions[a + k]);
    const w = [0, 1, 2].map((k) => positions[c + k] - positions[a + k]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    for (let k = 0; k < 3; k++) normals[t * 3 + k] = n[k] / len;
  }
  return { positions, indices, normals };
}
