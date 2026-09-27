import { describe, expect, it } from 'vitest';
import { buildAdjacency } from '../src/geometry/adjacency';
import { nearestTriangleEdge, triangleCount, triangleNormal } from '../src/geometry/mesh';
import { v3near, vec3 } from '../src/geometry/vec3';
import { weldTriangles } from '../src/geometry/weld';
import { importStl, suggestStlUnits } from '../src/import/stl';
import { binaryStl, boxTriangles, soup } from './fixtures/stlBuilders';

describe('weldTriangles', () => {
  it('merges shared corners of a box into 8 vertices', () => {
    const { mesh, degenerateRemoved } = weldTriangles(soup(boxTriangles(20, 10, 5)));
    expect(mesh.positions.length / 3).toBe(8);
    expect(triangleCount(mesh)).toBe(12);
    expect(degenerateRemoved).toBe(0);
  });

  it('merges vertices closer than the tolerance', () => {
    const tris = [[0, 0, 0, 1, 0, 0, 0, 1, 0], [0.00001, 0, 0, 0, 1, 0, 0, 0, 1]];
    expect(weldTriangles(soup(tris)).mesh.positions.length / 3).toBe(4);
  });

  it('recomputes outward face normals from the winding', () => {
    const { mesh } = weldTriangles(soup(boxTriangles(20, 10, 5)));
    expect(v3near(triangleNormal(mesh, 0), vec3(0, 0, -1))).toBe(true); // bottom
    expect(v3near(triangleNormal(mesh, 2), vec3(0, 0, 1))).toBe(true); // top
    expect(v3near(triangleNormal(mesh, 4), vec3(0, -1, 0))).toBe(true); // front
  });

  it('drops degenerate triangles and counts them', () => {
    const tris = [
      ...boxTriangles(1, 1, 1),
      [0, 0, 0, 0, 0, 0, 1, 1, 1], // repeated vertex
      [0, 0, 0, 1, 1, 1, 2, 2, 2], // collinear
    ];
    const { mesh, degenerateRemoved } = weldTriangles(soup(tris));
    expect(triangleCount(mesh)).toBe(12);
    expect(degenerateRemoved).toBe(2);
  });
});

describe('buildAdjacency', () => {
  it('links every edge of a closed box', () => {
    const { mesh } = weldTriangles(soup(boxTriangles(20, 10, 5)));
    const adj = buildAdjacency(mesh);
    expect(adj.openEdges).toBe(0);
    expect(adj.nonManifoldEdges).toBe(0);
    expect(Array.from(adj.neighbors).every((n) => n >= 0)).toBe(true);
    // the two bottom triangles share their diagonal
    expect(Array.from(adj.neighbors.slice(0, 3))).toContain(1);
  });

  it('counts open edges', () => {
    const { mesh } = weldTriangles(soup([[0, 0, 0, 1, 0, 0, 0, 1, 0]]));
    expect(buildAdjacency(mesh).openEdges).toBe(3);
  });

  it('counts non-manifold edges shared by more than two triangles', () => {
    const tris = [[0, 0, 0, 1, 0, 0, 0, 1, 0], [1, 0, 0, 0, 0, 0, 0, -1, 0], [0, 0, 0, 1, 0, 0, 0, 0, 1]];
    const adj = buildAdjacency(weldTriangles(soup(tris)).mesh);
    expect(adj.nonManifoldEdges).toBe(1);
    expect(adj.openEdges).toBe(6);
  });
});

describe('nearestTriangleEdge', () => {
  it('returns the edge of the triangle closest to a point', () => {
    const { mesh } = weldTriangles(soup([[0, 0, 0, 10, 0, 0, 0, 10, 0]]));
    const [a, b] = nearestTriangleEdge(mesh, 0, vec3(5, 0.5, 0));
    expect([a, b]).toEqual([vec3(0, 0, 0), vec3(10, 0, 0)]);
    const [c, d] = nearestTriangleEdge(mesh, 0, vec3(0.2, 5, 0));
    expect([c, d]).toEqual([vec3(0, 10, 0), vec3(0, 0, 0)]);
  });
});

describe('importStl', () => {
  it('produces a mesh, adjacency and diagnostics without warnings for a clean box', () => {
    const result = importStl(binaryStl(boxTriangles(20, 10, 5)));
    expect(result.diagnostics).toEqual({ triangles: 12, vertices: 8, degenerateRemoved: 0, openEdges: 0, nonManifoldEdges: 0 });
    expect(result.warnings).toEqual([]);
  });

  it('warns about open meshes and removed triangles', () => {
    const tris = [...boxTriangles(20, 10, 5).slice(2), [0, 0, 0, 0, 0, 0, 1, 1, 1]];
    const result = importStl(binaryStl(tris));
    expect(result.warnings).toEqual(['Removed 1 degenerate triangle', 'Mesh is not closed: 4 open edges']);
  });

  it('suggests inches only when the part is under 10 units on every axis', () => {
    expect(suggestStlUnits(importStl(binaryStl(boxTriangles(2, 1, 0.5))).mesh)).toBe('in');
    expect(suggestStlUnits(importStl(binaryStl(boxTriangles(20, 1, 0.5))).mesh)).toBe('mm');
  });
});
