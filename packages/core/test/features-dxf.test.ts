import { describe, expect, it } from 'vitest';
import { camContext, chainPaths, circleOf, drawingPath, drawingPathToProgram, nearestDxfPath, nestLoops, pathArea, setZSpin, v2 } from '../src';
import { camPartSetup } from './fixtures/camSetup';

describe('CAM context for a drawing', () => {
  it('puts the drawing on the stock top with program zero at the stock corner', () => {
    const { job, geometry } = camPartSetup();
    const ctx = camContext(job, geometry);
    expect(ctx.origin).toEqual({ x: -55, y: -35, z: 0 });
    expect(ctx.stock).toEqual({ min: { x: 0, y: 0, z: -6 }, max: { x: 110, y: 70, z: 0 } });
    expect(ctx.model).toEqual({ min: { x: 5, y: 5, z: 0 }, max: { x: 105, y: 65, z: 0 } });
    expect(ctx.tolerance).toBe(0.002);
  });

  it('maps drawing paths into program coordinates, including the Z spin', () => {
    const { job, geometry, drawing, layer } = camPartSetup();
    const hole = drawingPath(drawing, layer('HOLES'), 0)!;
    expect(circleOf(drawingPathToProgram(camContext(job, geometry), hole))).toEqual({ center: { x: 15, y: 15 }, diameter: 6 });
    const spun = camContext(setZSpin(job, 90), geometry);
    const c = circleOf(drawingPathToProgram(spun, hole))!;
    // spun 90°: stock is 70 × 110; the hole at raw (10,10) lands at program (55, 15)
    expect(c.center.x).toBeCloseTo(55, 9);
    expect(c.center.y).toBeCloseTo(15, 9);
  });
});

describe('chaining and nesting', () => {
  it('chains loose lines into one closed loop and keeps circles closed', () => {
    const { drawing, layer } = camPartSetup();
    const { closed, open } = chainPaths(drawing.layers[layer('POCKET')].paths, 0.002);
    expect(open).toEqual([]);
    expect(closed).toHaveLength(2);
    expect(closed.map((p) => Math.abs(pathArea(p))).sort((a, b) => a - b)[1]).toBeCloseTo(800, 6);
  });

  it('leaves unconnected pieces open', () => {
    const { drawing, layer } = camPartSetup();
    const lines = drawing.layers[layer('POCKET')].paths.slice(0, 3);
    const { closed, open } = chainPaths(lines, 0.002);
    expect(closed).toEqual([]);
    expect(open).toHaveLength(1);
    expect(open[0].segments).toHaveLength(3);
  });

  it('nests loops into outers (CCW) with islands (CW)', () => {
    const { drawing, layer } = camPartSetup();
    const { closed } = chainPaths(drawing.layers[layer('POCKET')].paths, 0.002);
    const shapes = nestLoops(closed, 0.002);
    expect(shapes).toHaveLength(1);
    expect(pathArea(shapes[0].outer)).toBeCloseTo(800, 6);
    expect(shapes[0].islands).toHaveLength(1);
    expect(pathArea(shapes[0].islands[0])).toBeLessThan(0);
    const all = nestLoops([...closed, ...drawing.layers[layer('OUTLINE')].paths], 0.002);
    // outline > pocket (island of the outline) > circle (a new outer inside the pocket's hole)
    expect(all).toHaveLength(2);
  });
});

describe('picking DXF paths', () => {
  it('finds the nearest path within range, skipping hidden layers', () => {
    const { job, geometry, layer } = camPartSetup();
    const ctx = camContext(job, geometry);
    expect(nearestDxfPath(ctx, v2(18.2, 15), 1)).toEqual({ kind: 'dxfPath', blobId: 'd1', layer: layer('HOLES'), path: 0 });
    expect(nearestDxfPath(ctx, v2(5.3, 30), 1)).toEqual({ kind: 'dxfPath', blobId: 'd1', layer: layer('OUTLINE'), path: 0 });
    expect(nearestDxfPath(ctx, v2(15, 15), 1)).toBeNull();
    expect(nearestDxfPath(ctx, v2(18.2, 15), 1, new Set(['HOLES']))).toBeNull();
  });
});
