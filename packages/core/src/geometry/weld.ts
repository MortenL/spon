import type { Mesh } from './mesh';

/**
 * Converts a triangle soup into an indexed mesh by snapping vertices to a grid of `tolerance` (a spatial hash).
 * Recomputes per-triangle normals from the winding and drops zero-area triangles.
 */
export function weldTriangles(soup: Float32Array, tolerance = 1e-4): { mesh: Mesh; degenerateRemoved: number } {
  const inv = 1 / tolerance;
  const lookup = new Map<string, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  let degenerateRemoved = 0;
  const corner = [0, 0, 0];

  for (let t = 0; t + 8 < soup.length; t += 9) {
    for (let k = 0; k < 3; k++) {
      const x = soup[t + k * 3], y = soup[t + k * 3 + 1], z = soup[t + k * 3 + 2];
      const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
      let index = lookup.get(key);
      if (index === undefined) {
        index = positions.length / 3;
        positions.push(x, y, z);
        lookup.set(key, index);
      }
      corner[k] = index;
    }
    const [a, b, c] = corner;
    if (a === b || b === c || a === c) {
      degenerateRemoved++;
      continue;
    }
    const e1x = positions[b * 3] - positions[a * 3], e1y = positions[b * 3 + 1] - positions[a * 3 + 1], e1z = positions[b * 3 + 2] - positions[a * 3 + 2];
    const e2x = positions[c * 3] - positions[a * 3], e2y = positions[c * 3 + 1] - positions[a * 3 + 1], e2z = positions[c * 3 + 2] - positions[a * 3 + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len <= 1e-12) {
      degenerateRemoved++;
      continue;
    }
    indices.push(a, b, c);
    normals.push(nx / len, ny / len, nz / len);
  }

  return {
    mesh: { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), normals: Float32Array.from(normals) },
    degenerateRemoved,
  };
}
