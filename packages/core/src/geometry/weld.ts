import type { Mesh } from './mesh';

/** Compacts mesh positions to remove unreferenced vertices and remaps indices. */
function compactVertices(
  positions: number[],
  indices: number[],
  normals: number[],
): [Float32Array, Uint32Array, Float32Array] {
  const vertexCount = positions.length / 3;
  const used = new Uint8Array(vertexCount);
  const remap = new Int32Array(vertexCount);

  // Mark used vertices
  for (const idx of indices) {
    used[idx] = 1;
  }

  // Build remap array and compacted positions
  const compactedPositions: number[] = [];
  let newIndex = 0;
  for (let i = 0; i < vertexCount; i++) {
    if (used[i]) {
      remap[i] = newIndex;
      compactedPositions.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      newIndex++;
    }
  }

  // Remap indices
  const remappedIndices = indices.map((idx) => remap[idx]);

  return [Float32Array.from(compactedPositions), Uint32Array.from(remappedIndices), Float32Array.from(normals)];
}

/**
 * Converts a triangle soup into an indexed mesh by snapping vertices to a grid of `tolerance` (a spatial hash).
 * Recomputes per-triangle normals from the winding and drops zero-area triangles; `kept[i]` is the soup triangle
 * that output triangle `i` came from.
 */
export function weldTriangles(soup: Float32Array, tolerance = 1e-4): { mesh: Mesh; degenerateRemoved: number; kept: Uint32Array } {
  const inv = 1 / tolerance;
  const lookup = new Map<string, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const kept: number[] = [];
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
    kept.push(t / 9);
  }

  const [compactedPositions, compactedIndices, compactedNormals] = compactVertices(positions, indices, normals);

  return {
    mesh: { positions: compactedPositions, indices: compactedIndices, normals: compactedNormals },
    degenerateRemoved,
    kept: Uint32Array.from(kept),
  };
}
