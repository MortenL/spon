import { describe, expect, it } from 'vitest';
import { AFFINE_IDENTITY, affineScale, type Affine2D } from '../src/import/dxf/affine2d';
import { segmentEnd, segmentStart, type Path2D } from '../src/geometry/path2d';
import { parsePathData } from '../src/import/svg/pathData';
import { shapeToPathData } from '../src/import/svg/shapes';
import { parseTransform } from '../src/import/svg/transform';
import { parseXml } from '../src/import/svg/xml';

const ends = (p: Path2D) => [segmentStart(p.segments[0]), segmentEnd(p.segments[p.segments.length - 1])];
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};
const kinds = (p: Path2D) => p.segments.map((s) => s.kind);

describe('parseTransform', () => {
  it('composes in SVG order (rightmost applies first)', () => {
    const m = parseTransform('translate(10, 5) scale(2)') as Affine2D;
    expect(m).toMatchObject({ a: 2, d: 2, e: 10, f: 5 });
    const r = parseTransform('rotate(90 10 0)') as Affine2D;
    expect(r.a).toBeCloseTo(0);
    expect(r.e).toBeCloseTo(10);
    expect(r.f).toBeCloseTo(-10);
    expect(parseTransform('matrix(1 0 0 1 3 4)')).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 3, f: 4 });
    expect(parseTransform('skewX(45)')!.c).toBeCloseTo(1);
    expect(parseTransform(undefined)).toEqual(AFFINE_IDENTITY);
    expect(parseTransform('scale(1 2 3)')).toBeNull();
    expect(parseTransform('wobble(3)')).toBeNull();
  });
});

describe('parsePathData', () => {
  it('reads absolute and relative lines, H/V and Z', () => {
    const { paths, error } = parsePathData('M10 10 h 20 v10 H10 z m 50 0 l 5 5 5-5', AFFINE_IDENTITY, 0.01);
    expect(error).toBeNull();
    expect(paths).toHaveLength(2);
    expect(paths[0].closed).toBe(true);
    expect(kinds(paths[0])).toEqual(['line', 'line', 'line', 'line']);
    expect(paths[1].closed).toBe(false);
    const [s, e] = ends(paths[1]);
    close(s, { x: 60, y: 10 });
    close(e, { x: 70, y: 10 });
  });

  it('reads compact numbers and arc flags without separators', () => {
    const { paths, error } = parsePathData('M0,0L.5.5 1e1-1e-1a5 5 0 016 6', AFFINE_IDENTITY, 0.01);
    expect(error).toBeNull();
    const segs = paths[0].segments;
    close(segmentEnd(segs[1]), { x: 10, y: -0.1 });
    close(segmentEnd(segs[segs.length - 1]), { x: 16, y: 5.9 });
  });

  it('keeps circular arcs as arcs under a similarity and flattens them otherwise', () => {
    const circle = 'M10 0 A10 10 0 1 1 -10 0 A10 10 0 1 1 10 0 Z';
    const round = parsePathData(circle, affineScale(2, -2), 0.01).paths[0];
    expect(kinds(round)).toEqual(['arc', 'arc']);
    expect(round.segments[0].kind === 'arc' && round.segments[0].radius).toBeCloseTo(20);
    const squashed = parsePathData(circle, affineScale(2, 1), 0.01).paths[0];
    expect(squashed.segments.length).toBeGreaterThan(2);
    for (const s of squashed.segments) {
      const p = segmentStart(s);
      expect((p.x / 20) ** 2 + (p.y / 10) ** 2).toBeCloseTo(1, 2);
    }
  });

  it('flattens Béziers within tolerance and refits arcs', () => {
    // a quarter circle drawn as a cubic: refitted to arcs, ends exact
    const k = 0.5522847498;
    const { paths } = parsePathData(`M10 0 C10 ${10 * k} ${10 * k} 10 0 10`, AFFINE_IDENTITY, 0.01);
    const [s, e] = ends(paths[0]);
    close(s, { x: 10, y: 0 });
    close(e, { x: 0, y: 10 });
    expect(paths[0].segments.some((x) => x.kind === 'arc')).toBe(true);
    // S and T reflect the previous control point
    const st = parsePathData('M0 0 Q 5 10 10 0 T 20 0 M0 0 C0 5 5 5 5 0 S 10 -5 10 0', AFFINE_IDENTITY, 0.01).paths;
    close(ends(st[0])[1], { x: 20, y: 0 });
    close(ends(st[1])[1], { x: 10, y: 0 });
  });

  it('keeps what it read before a syntax error', () => {
    const r = parsePathData('M0 0 L10 0 L 10 ? 20', AFFINE_IDENTITY, 0.01);
    expect(r.paths).toHaveLength(1);
    expect(r.error).toMatch(/Unexpected/);
  });
});

describe('shapeToPathData', () => {
  const el = (xml: string) => parseXml(xml);
  it('converts basic shapes', () => {
    expect(shapeToPathData(el('<rect x="1" y="2" width="10" height="5"/>'))).toBe('M1 2 H11 V7 H1 Z');
    expect(shapeToPathData(el('<rect width="10" height="10" rx="2"/>'))).toContain('A2 2 0 0 1');
    expect(shapeToPathData(el('<circle cx="5" cy="5" r="2"/>'))).toBe('M7 5 A2 2 0 1 1 3 5 A2 2 0 1 1 7 5 Z');
    expect(shapeToPathData(el('<line x1="0" y1="0" x2="3" y2="4"/>'))).toBe('M0 0 L3 4');
    expect(shapeToPathData(el('<polygon points="0,0 10,0 10,10"/>'))).toBe('M0 0 L10 0 L10 10 Z');
    expect(shapeToPathData(el('<polyline points="0 0 10 0"/>'))).toBe('M0 0 L10 0');
    expect(shapeToPathData(el('<rect width="0" height="5"/>'))).toBeNull();
    expect(shapeToPathData(el('<text>hi</text>'))).toBeNull();
  });
});

describe('parsePathData arc edge cases', () => {
  it('handles mixed-case arcs, glued flags, degenerate arcs, junk and mirroring', () => {
    const a = parsePathData('M0 0 A5 5 0 0 1 10 0 a5 5 0 0 1 10 0', AFFINE_IDENTITY, 0.01);
    expect(a.error).toBeNull();
    expect(kinds(a.paths[0])).toEqual(['arc', 'arc']);
    close(ends(a.paths[0])[1], { x: 20, y: 0 });
    const b = parsePathData('M0 0a5 5 0 1010 0', AFFINE_IDENTITY, 0.01);
    expect(b.error).toBeNull();
    close(ends(b.paths[0])[1], { x: 10, y: 0 });
    const c = parsePathData('M3 4 A5 5 0 0 1 3 4 L10 4', AFFINE_IDENTITY, 0.01).paths[0];
    expect(kinds(c)).toEqual(['line']);
    close(ends(c)[0], { x: 3, y: 4 });
    close(ends(c)[1], { x: 10, y: 4 });
    const d = parsePathData('M0 0 A 5 5 0 0 1 10 0 ? 4', AFFINE_IDENTITY, 0.01);
    expect(d.error).toMatch(/Unexpected/);
    expect(d.paths).toHaveLength(1);
    expect(kinds(d.paths[0])).toEqual(['arc']);
    const e = parsePathData('M10 0 A10 10 0 0 1 0 10', affineScale(1, -1), 0.01).paths[0];
    const arc = e.segments[0];
    expect(arc.kind === 'arc' && arc.sweep).toBeLessThan(0);
    close(ends(e)[1], { x: 0, y: -10 });
  });
});
