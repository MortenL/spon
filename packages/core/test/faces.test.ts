import { describe, expect, it } from 'vitest';
import { buildAdjacency, faceRegion, faceTriangles, type Mesh, planarRegion, weldTriangles } from '../src';

/** A 2 × 1 strip of two unit squares (two triangles each); `lift` tilts the second square up to z = 1 at x = 2. */
function strip(faceIds?: number[], lift = 0): { mesh: Mesh; adjacency: ReturnType<typeof buildAdjacency> } {
  const { mesh } = weldTriangles(new Float32Array([
    0, 0, 0, 1, 0, 0, 1, 1, 0,
    0, 0, 0, 1, 1, 0, 0, 1, 0,
    1, 0, 0, 2, 0, lift, 2, 1, lift,
    1, 0, 0, 2, 1, lift, 1, 1, 0,
  ]));
  if (faceIds) mesh.faceIds = Uint32Array.from(faceIds);
  return { mesh, adjacency: buildAdjacency(mesh) };
}
const sorted = (a: number[]) => [...a].sort((x, y) => x - y);

describe('faceTriangles', () => {
  it('returns every triangle with the seed face id', () => {
    const { mesh } = strip([0, 0, 1, 1]);
    expect(faceTriangles(mesh, 2)).toEqual([2, 3]);
    expect(faceTriangles(mesh, 1)).toEqual([0, 1]);
  });

  it('is just the seed on a mesh without face ids', () => {
    expect(faceTriangles(strip().mesh, 3)).toEqual([3]);
  });
});

describe('faceRegion', () => {
  it('keeps two coplanar faces that share an edge apart', () => {
    const { mesh, adjacency } = strip([0, 0, 1, 1]);
    expect(sorted(planarRegion(mesh, adjacency, 0))).toEqual([0, 1, 2, 3]);
    expect(sorted(faceRegion(mesh, adjacency, 0))).toEqual([0, 1]);
    expect(sorted(faceRegion(mesh, adjacency, 3))).toEqual([2, 3]);
  });

  it('falls back to the planar region without face ids or on a face that is not flat', () => {
    const flat = strip();
    expect(sorted(faceRegion(flat.mesh, flat.adjacency, 0))).toEqual([0, 1, 2, 3]);
    const bent = strip([0, 0, 0, 0], 1); // one "face" that bends 45° along x = 1
    expect(sorted(faceRegion(bent.mesh, bent.adjacency, 0))).toEqual([0, 1]);
  });
});
