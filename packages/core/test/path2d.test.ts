import { describe, expect, it } from 'vitest';
import {
  type ArcSegment, arcStepCount, pathsToPoints, segmentEnd, segmentStart, tessellatePath, tessellateSegment,
} from '../src/geometry/path2d';
import {
  AFFINE_IDENTITY, affineApply, affineMaxStretch, affineMultiply, affineRotate, affineScale, affineTranslate, isSimilarity,
} from '../src/import/dxf/affine2d';
import { bulgeSegment, polylineToPath, transformSegment } from '../src/import/dxf/entities';

const near = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-9) =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

describe('path2d', () => {
  const quarter: ArcSegment = { kind: 'arc', center: { x: 0, y: 0 }, radius: 10, startAngle: 0, sweep: Math.PI / 2 };

  it('reports arc end points from start angle and signed sweep', () => {
    expect(near(segmentStart(quarter), { x: 10, y: 0 })).toBe(true);
    expect(near(segmentEnd(quarter), { x: 0, y: 10 })).toBe(true);
    expect(near(segmentEnd({ ...quarter, sweep: -Math.PI / 2 }), { x: 0, y: -10 })).toBe(true);
  });

  it('tessellates arcs within the chord tolerance', () => {
    const tol = 0.01;
    const full: ArcSegment = { ...quarter, sweep: 2 * Math.PI };
    const pts = tessellateSegment(full, tol);
    expect(pts.length).toBe(arcStepCount(10, 2 * Math.PI, tol) + 1);
    expect(near(pts[0], pts[pts.length - 1])).toBe(true);
    for (let i = 1; i < pts.length; i++) {
      const mid = { x: (pts[i - 1].x + pts[i].x) / 2, y: (pts[i - 1].y + pts[i].y) / 2 };
      expect(10 - Math.hypot(mid.x, mid.y)).toBeLessThanOrEqual(tol + 1e-12);
    }
  });

  it('joins segment points without duplicating shared corners', () => {
    const path = polylineToPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], false);
    expect(tessellatePath(path)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(Array.from(pathsToPoints([path]))).toEqual([0, 0, 0, 10, 0, 0, 10, 10, 0]);
  });
});

describe('affine2d', () => {
  it('applies the right-hand transform first', () => {
    const m = affineMultiply(affineTranslate(100, 0), affineRotate(Math.PI / 2));
    expect(near(affineApply(m, { x: 1, y: 0 }), { x: 100, y: 1 })).toBe(true);
  });

  it('recognises similarity transforms', () => {
    expect(isSimilarity(AFFINE_IDENTITY)).toBe(true);
    expect(isSimilarity(affineMultiply(affineRotate(0.3), affineScale(2, 2)))).toBe(true);
    expect(isSimilarity(affineScale(-1, 1))).toBe(true);
    expect(isSimilarity(affineScale(2, 1))).toBe(false);
  });

  it('computes the exact maximum stretch (largest singular value)', () => {
    expect(affineMaxStretch(AFFINE_IDENTITY)).toBeCloseTo(1, 12);
    expect(affineMaxStretch(affineScale(2, 1))).toBeCloseTo(2, 12);
    expect(affineMaxStretch(affineMultiply(affineRotate(Math.PI / 4), affineScale(2, 1)))).toBeCloseTo(2, 12);
    expect(affineMaxStretch(affineMultiply(affineScale(2, 1), affineRotate(Math.PI / 4)))).toBeCloseTo(2, 12);
    expect(affineMaxStretch(affineMultiply(affineRotate(0.3), affineScale(3, 3)))).toBeCloseTo(3, 12);
    expect(affineMaxStretch(affineScale(-1, 0.5))).toBeCloseTo(1, 12);
  });
});

describe('DXF entity geometry', () => {
  it('turns bulge 1 into a counter-clockwise semicircle below the chord', () => {
    const arc = bulgeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 1) as ArcSegment;
    expect(arc.kind).toBe('arc');
    expect(near(arc.center, { x: 5, y: 0 })).toBe(true);
    expect(arc.radius).toBeCloseTo(5, 12);
    expect(arc.sweep).toBeCloseTo(Math.PI, 12);
    expect(near(tessellateSegment(arc, 0.001)[0], { x: 0, y: 0 })).toBe(true);
    const mid = { x: arc.center.x + arc.radius * Math.cos(arc.startAngle + arc.sweep / 2), y: arc.center.y + arc.radius * Math.sin(arc.startAngle + arc.sweep / 2) };
    expect(near(mid, { x: 5, y: -5 })).toBe(true);
    expect(near(segmentEnd(arc), { x: 10, y: 0 })).toBe(true);
  });

  it('turns a negative quarter bulge into a clockwise 90° arc', () => {
    const arc = bulgeSegment({ x: 0, y: 0 }, { x: 10, y: 10 }, -Math.tan(Math.PI / 8)) as ArcSegment;
    expect(arc.sweep).toBeCloseTo(-Math.PI / 2, 12);
    expect(near(segmentEnd(arc), { x: 10, y: 10 })).toBe(true);
  });

  it('keeps arcs exact under similarity transforms and flips direction when mirrored', () => {
    const arc: ArcSegment = { kind: 'arc', center: { x: 1, y: 2 }, radius: 3, startAngle: 0, sweep: Math.PI / 2 };
    const [mirrored] = transformSegment(arc, affineScale(-1, 1), 0.01) as ArcSegment[];
    expect(mirrored.kind).toBe('arc');
    expect(near(mirrored.center, { x: -1, y: 2 })).toBe(true);
    expect(mirrored.sweep).toBeCloseTo(-Math.PI / 2, 12);
    expect(near(segmentStart(mirrored), { x: -4, y: 2 })).toBe(true);
    expect(near(segmentEnd(mirrored), { x: -1, y: 5 })).toBe(true);
  });

  it('flattens arcs under non-uniform scale', () => {
    const arc: ArcSegment = { kind: 'arc', center: { x: 0, y: 0 }, radius: 10, startAngle: 0, sweep: Math.PI };
    const out = transformSegment(arc, affineScale(2, 1), 0.01);
    expect(out.length).toBeGreaterThan(10);
    expect(out.every((s) => s.kind === 'line')).toBe(true);
    for (const s of out) {
      const p = segmentStart(s);
      expect((p.x / 20) ** 2 + (p.y / 10) ** 2).toBeCloseTo(1, 9); // on the stretched ellipse
    }
  });
});
