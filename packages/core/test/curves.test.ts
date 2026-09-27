import { describe, expect, it } from 'vitest';
import { segmentStart, tessellatePath, type Vec2 } from '../src/geometry/path2d';
import { ellipseToPath, evalBSpline, flattenCurve, splineToPath } from '../src/import/dxf/curves';
import { parseDxf } from '../src/import/dxf/dxf';
import { dxfText, ellipse, type Entity, insert, spline, splineFit } from './fixtures/dxfBuilder';

const bezier2 = (p0: Vec2, p1: Vec2, p2: Vec2, t: number): Vec2 => ({
  x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
  y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y,
});

describe('flattenCurve', () => {
  it('stays within tolerance of a circle', () => {
    const pts = flattenCurve((t) => ({ x: 10 * Math.cos(t), y: 10 * Math.sin(t) }), 0, Math.PI, 0.01);
    for (let i = 1; i < pts.length; i++) {
      const mid = { x: (pts[i - 1].x + pts[i].x) / 2, y: (pts[i - 1].y + pts[i].y) / 2 };
      expect(10 - Math.hypot(mid.x, mid.y)).toBeLessThanOrEqual(0.01);
    }
    expect(pts[0]).toEqual({ x: 10, y: 0 });
  });
});

describe('evalBSpline', () => {
  const ctrl = [{ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }];

  it('matches a quadratic Bézier for a clamped degree-2 spline with 3 control points', () => {
    for (const t of [0, 0.25, 0.5, 0.9, 1]) {
      const p = evalBSpline(2, [0, 0, 0, 1, 1, 1], ctrl, t);
      const q = bezier2(ctrl[0], ctrl[1], ctrl[2], t);
      expect(p.x).toBeCloseTo(q.x, 12);
      expect(p.y).toBeCloseTo(q.y, 12);
    }
  });

  it('passes through the control points of a degree-1 spline', () => {
    const p = evalBSpline(1, [0, 0, 1, 2, 2], ctrl, 1);
    expect(p).toEqual({ x: 5, y: 10 });
  });

  it('evaluates a rational quadratic quarter circle exactly', () => {
    const arc = [{ x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const weights = [1, Math.SQRT1_2, 1];
    for (const t of [0, 0.1, 0.33, 0.5, 0.77, 1]) {
      const p = evalBSpline(2, [0, 0, 0, 1, 1, 1], arc, t, weights);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 12);
    }
    // without weights the same control polygon is a parabola that bulges outside the circle
    const p = evalBSpline(2, [0, 0, 0, 1, 1, 1], arc, 0.5);
    expect(Math.hypot(p.x, p.y)).toBeGreaterThan(10.5);
  });
});

describe('ellipseToPath', () => {
  it('flattens a full ellipse into a closed path with the right extents', () => {
    const path = ellipseToPath({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 0, 2 * Math.PI, 0.01);
    expect(path.closed).toBe(true);
    const pts = tessellatePath(path);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(10, 6);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(5, 2);
  });

  it('flattens a half ellipse into an open path from the start parameter', () => {
    const path = ellipseToPath({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 0, Math.PI, 0.01);
    expect(path.closed).toBe(false);
    expect(segmentStart(path.segments[0])).toEqual({ x: 10, y: 0 });
  });
});

describe('splineToPath', () => {
  it('uses fit points when there are no control points', () => {
    const { path, note } = splineToPath(3, [], [], [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }], 0.01);
    expect(path?.segments.length).toBe(2);
    expect(note).toMatch(/fit points/);
  });

  it('returns no path for an unusable spline', () => {
    expect(splineToPath(3, [], [], [], 0.01).path).toBeNull();
  });
});

describe('parseDxf: curves', () => {
  it('imports ELLIPSE and SPLINE entities', () => {
    const r = parseDxf(dxfText({
      entities: [
        ellipse('E', 0, 0, 10, 0, 0.5, 0, Math.PI),
        spline('S', 2, [0, 0, 0, 1, 1, 1], [[0, 0], [5, 10], [10, 0]]),
        splineFit('F', 3, [[0, 0], [5, 5], [10, 0]]),
      ],
    }));
    expect(r.drawing.layers.map((l) => l.name)).toEqual(['E', 'S', 'F']);
    const sPoints = tessellatePath(r.drawing.layers[1].paths[0]);
    expect(sPoints[0]).toEqual({ x: 0, y: 0 });
    expect(sPoints.at(-1)).toEqual({ x: 10, y: 0 });
    expect(r.warnings.some((w) => w.includes('fit points'))).toBe(true);
  });

  it('reads SPLINE weights (dropped by the built-in handler) and keeps rational arcs on their circle', () => {
    const r = parseDxf(dxfText({
      entities: [spline('R', 2, [0, 0, 0, 1, 1, 1], [[10, 0], [10, 10], [0, 10]], [1, Math.SQRT1_2, 1])],
    }));
    const pts = tessellatePath(r.drawing.layers[0].paths[0]);
    expect(pts.length).toBeGreaterThan(8);
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 9);
    expect(r.warnings).toEqual([]);
  });

  it('mirrors a partial ELLIPSE whose extrusion is -Z (the minor axis flips; dxf-parser drops 210-230)', () => {
    const up = parseDxf(dxfText({ entities: [ellipse('E', 0, 0, 10, 0, 0.5, 0, Math.PI)] }));
    const down = parseDxf(dxfText({ entities: [ellipse('E', 0, 0, 10, 0, 0.5, 0, Math.PI, -1)] }));
    // the point at t = π/2 is the one with x = 0
    const mid = (r: ReturnType<typeof parseDxf>) =>
      tessellatePath(r.drawing.layers[0].paths[0]).reduce((best, p) => (Math.abs(p.x) < Math.abs(best.x) ? p : best));
    expect(mid(up).x).toBeCloseTo(0, 6);
    expect(mid(up).y).toBeCloseTo(5, 6);
    expect(mid(down).x).toBeCloseTo(0, 6);
    expect(mid(down).y).toBeCloseTo(-5, 6);
    const downPts = tessellatePath(down.drawing.layers[0].paths[0]);
    expect(downPts[0].x).toBeCloseTo(10, 9);
    expect(downPts.at(-1)!.x).toBeCloseTo(-10, 9);
    expect(down.warnings).toEqual([]);
  });

  it('keeps a full ELLIPSE with -Z extrusion at the same extents', () => {
    const r = parseDxf(dxfText({ entities: [ellipse('E', 0, 0, 10, 0, 0.5, 0, 2 * Math.PI, -1)] }));
    const pts = tessellatePath(r.drawing.layers[0].paths[0]);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(10, 6);
    expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(-10, 6);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(5, 2);
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(-5, 2);
    expect(r.warnings).toEqual([]);
  });

  it('notes a tilted ELLIPSE extrusion', () => {
    const tilted: Entity = ellipse('E', 0, 0, 10, 0, 0.5, 0, 2 * Math.PI)
      .flatMap((g): Entity => (g[0] === 31 ? [g, [210, 1], [220, 0], [230, 1]] : [g]));
    const r = parseDxf(dxfText({ entities: [tilted] }));
    expect(r.warnings).toContain('Some entities have a tilted extrusion direction and were projected to XY');
  });

  it('keeps the world-space chord tolerance for an ELLIPSE inside a scaled block', () => {
    const r = parseDxf(dxfText({
      blocks: [{ name: 'EB', base: [0, 0], entities: [ellipse('0', 0, 0, 10, 0, 0.5, 0, 2 * Math.PI)] }],
      entities: [insert('BIG', 'EB', 0, 0, { sx: 10, sy: 10 })],
    }));
    const pts = tessellatePath(r.drawing.layers[0].paths[0]);
    const direct = tessellatePath(ellipseToPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5, 0, 2 * Math.PI, 0.01));
    expect(pts.length).toBeGreaterThanOrEqual(direct.length * 0.9);
  });

  it('keeps the world-space chord tolerance for a SPLINE inside a scaled block', () => {
    const r = parseDxf(dxfText({
      blocks: [{
        name: 'SB',
        base: [0, 0],
        entities: [spline('0', 2, [0, 0, 0, 1, 1, 1], [[10, 0], [10, 10], [0, 10]], [1, Math.SQRT1_2, 1])],
      }],
      entities: [insert('BIG', 'SB', 0, 0, { sx: 10, sy: 10 })],
    }));
    const pts = tessellatePath(r.drawing.layers[0].paths[0]);
    expect(pts.length).toBeGreaterThan(8);
  });
});
