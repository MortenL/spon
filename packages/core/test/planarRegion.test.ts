import { describe, expect, it } from 'vitest';
import { buildAdjacency } from '../src/geometry/adjacency';
import { planarRegion, regionNormal } from '../src/geometry/planarRegion';
import { v3near, vec3 } from '../src/geometry/vec3';
import { weldTriangles } from '../src/geometry/weld';
import { boxTriangles, cylinderTriangles, soup, type Tri } from './fixtures/stlBuilders';

function meshOf(tris: Tri[]) {
  const { mesh } = weldTriangles(soup(tris));
  return { mesh, adjacency: buildAdjacency(mesh) };
}

describe('planarRegion', () => {
  it('selects both triangles of a box face', () => {
    const { mesh, adjacency } = meshOf(boxTriangles(20, 10, 5));
    expect(planarRegion(mesh, adjacency, 4).sort()).toEqual([4, 5]); // front face
    expect(v3near(regionNormal(mesh, [4, 5]), vec3(0, -1, 0))).toBe(true);
  });

  it('selects the whole flat cap of a cylinder but not the curved wall', () => {
    const segments = 32;
    const { mesh, adjacency } = meshOf(cylinderTriangles(10, 5, segments));
    const cap = planarRegion(mesh, adjacency, 0);
    expect(cap.length).toBe(segments);
    expect(cap.every((t) => t < segments)).toBe(true);
    expect(v3near(regionNormal(mesh, cap), vec3(0, 0, 1))).toBe(true);
  });

  it('stops at wall facets that differ by more than the angle tolerance', () => {
    const segments = 32;
    const { mesh, adjacency } = meshOf(cylinderTriangles(10, 5, segments));
    const firstWall = 2 * segments;
    expect(planarRegion(mesh, adjacency, firstWall).sort((a, b) => a - b)).toEqual([firstWall, firstWall + 1]);
  });

  it('rejects a nearly parallel neighbour whose far vertex leaves the plane by more than 0.01', () => {
    // second triangle is tilted ~0.5° (inside the angle tolerance) so its far corner rises 0.087 mm
    const lift = 10 * Math.tan((0.5 * Math.PI) / 180);
    const tilted: Tri[] = [[0, 0, 0, 10, 0, 0, 10, 10, 0], [0, 0, 0, 10, 10, 0, 0, 10, lift]];
    const a = meshOf(tilted);
    expect(planarRegion(a.mesh, a.adjacency, 0)).toEqual([0]);

    const almostFlat: Tri[] = [[0, 0, 0, 10, 0, 0, 10, 10, 0], [0, 0, 0, 10, 10, 0, 0, 10, 0.005]];
    const b = meshOf(almostFlat);
    expect(planarRegion(b.mesh, b.adjacency, 0).sort()).toEqual([0, 1]);
  });
});
