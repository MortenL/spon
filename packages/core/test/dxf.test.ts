import { describe, expect, it } from 'vitest';
import { type ArcSegment, type LineSegment, segmentEnd, segmentStart, type Vec2 } from '../src/geometry/path2d';
import { countEntityTypes, DxfParseError, parseDxf } from '../src/import/dxf/dxf';
import { arc, circle, dxfText, type Entity, hatch, insert, line, lwpolyline, polyline, text } from './fixtures/dxfBuilder';

const near = (a: Vec2, b: Vec2, eps = 1e-9) => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
const layer = (result: ReturnType<typeof parseDxf>, name: string) => {
  const found = result.drawing.layers.find((l) => l.name === name);
  if (!found) throw new Error(`layer ${name} missing`);
  return found;
};

describe('parseDxf: entities', () => {
  it('imports LINE', () => {
    const r = parseDxf(dxfText({ entities: [line('A', 0, 0, 10, 0)] }));
    const seg = layer(r, 'A').paths[0].segments[0] as LineSegment;
    expect(seg).toEqual({ kind: 'line', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } });
  });

  it('imports ARC as a counter-clockwise arc', () => {
    const r = parseDxf(dxfText({ entities: [arc('A', 0, 0, 5, 0, 90)] }));
    const seg = layer(r, 'A').paths[0].segments[0] as ArcSegment;
    expect(seg.startAngle).toBeCloseTo(0, 12);
    expect(seg.sweep).toBeCloseTo(Math.PI / 2, 12);
  });

  it('imports ARC that crosses 0°', () => {
    const r = parseDxf(dxfText({ entities: [arc('A', 0, 0, 5, 270, 90)] }));
    expect((layer(r, 'A').paths[0].segments[0] as ArcSegment).sweep).toBeCloseTo(Math.PI, 12);
  });

  it('imports CIRCLE as a closed full arc', () => {
    const path = layer(parseDxf(dxfText({ entities: [circle('A', 1, 2, 3)] })), 'A').paths[0];
    expect(path.closed).toBe(true);
    expect((path.segments[0] as ArcSegment).sweep).toBeCloseTo(2 * Math.PI, 12);
  });

  it('imports a closed LWPOLYLINE with a bulge', () => {
    const path = layer(parseDxf(dxfText({ entities: [lwpolyline('A', [[0, 0, 1], [10, 0], [10, 10]], true)] })), 'A').paths[0];
    expect(path.closed).toBe(true);
    expect(path.segments.map((s) => s.kind)).toEqual(['arc', 'line', 'line']);
    expect(near(segmentEnd(path.segments[2]), { x: 0, y: 0 })).toBe(true);
  });

  it('imports POLYLINE with VERTEX entities', () => {
    const path = layer(parseDxf(dxfText({ entities: [polyline('A', [[0, 0], [5, 0, 0.5], [5, 5]], false)] })), 'A').paths[0];
    expect(path.closed).toBe(false);
    expect(path.segments.map((s) => s.kind)).toEqual(['line', 'arc']);
  });

  it('mirrors OCS entities with extrusion (0, 0, -1)', () => {
    const seg = layer(parseDxf(dxfText({ entities: [arc('A', 1, 2, 3, 0, 90, -1)] })), 'A').paths[0].segments[0] as ArcSegment;
    expect(near(seg.center, { x: -1, y: 2 })).toBe(true);
    expect(seg.sweep).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('mirrors CIRCLE with extrusion (0, 0, -1), which the built-in dxf-parser handler would drop', () => {
    const r = parseDxf(dxfText({ entities: [circle('HOLES', 1, 2, 3, -1)] }));
    const seg = layer(r, 'HOLES').paths[0].segments[0] as ArcSegment;
    expect(near(seg.center, { x: -1, y: 2 })).toBe(true);
    expect(seg.radius).toBeCloseTo(3, 12);
  });

  it('keeps CIRCLE on its layer and skips paper-space circles', () => {
    const paper: Entity = [...circle('P', 0, 0, 1), [67, 1]];
    const r = parseDxf(dxfText({ entities: [circle('HOLES', 0, 0, 1), paper] }));
    expect(r.drawing.layers.map((l) => l.name)).toEqual(['HOLES']);
    expect(r.warnings).toContain('Ignored 1 paper-space entity');
  });
});

describe('parseDxf: blocks', () => {
  const block = { name: 'B1', base: [5, 0] as [number, number], entities: [line('0', 5, 0, 6, 0)] };

  it('expands INSERT with translation, rotation and scale about the block base point', () => {
    const r = parseDxf(dxfText({ blocks: [block], entities: [insert('L3', 'B1', 100, 0, { sx: 2, sy: 2, rotDeg: 90 })] }));
    const seg = layer(r, 'L3').paths[0].segments[0];
    expect(near(segmentStart(seg), { x: 100, y: 0 })).toBe(true);
    expect(near(segmentEnd(seg), { x: 100, y: 2 })).toBe(true);
  });

  it('expands nested INSERTs', () => {
    const outer = { name: 'OUTER', base: [0, 0] as [number, number], entities: [insert('0', 'B1', 10, 0)] };
    const r = parseDxf(dxfText({ blocks: [block, outer], entities: [insert('TOP', 'OUTER', 0, 0, { rotDeg: 90 })] }));
    const seg = layer(r, 'TOP').paths[0].segments[0];
    expect(near(segmentStart(seg), { x: 0, y: 10 })).toBe(true);
    expect(near(segmentEnd(seg), { x: 0, y: 11 })).toBe(true);
  });

  it('keeps block entities on their own layer unless they are on layer 0', () => {
    const own = { name: 'B2', base: [0, 0] as [number, number], entities: [line('OWN', 0, 0, 1, 0), line('0', 0, 0, 0, 1)] };
    const r = parseDxf(dxfText({ blocks: [own], entities: [insert('HOST', 'B2', 0, 0)] }));
    expect(r.drawing.layers.map((l) => l.name).sort()).toEqual(['HOST', 'OWN']);
  });

  it('flattens arcs in non-uniformly scaled blocks and mirrors arcs in negatively scaled ones', () => {
    const arcs = { name: 'ARCS', base: [0, 0] as [number, number], entities: [arc('0', 0, 0, 10, 0, 180)] };
    const stretched = parseDxf(dxfText({ blocks: [arcs], entities: [insert('S', 'ARCS', 0, 0, { sx: 2, sy: 1 })] }));
    expect(layer(stretched, 'S').paths[0].segments.every((s) => s.kind === 'line')).toBe(true);
    const mirrored = parseDxf(dxfText({ blocks: [arcs], entities: [insert('M', 'ARCS', 0, 0, { sx: -1, sy: 1 })] }));
    const seg = layer(mirrored, 'M').paths[0].segments[0] as ArcSegment;
    expect(seg.kind).toBe('arc');
    expect(seg.sweep).toBeCloseTo(-Math.PI, 12);
  });

  it('warns about missing blocks', () => {
    const r = parseDxf(dxfText({ entities: [line('A', 0, 0, 1, 0), insert('A', 'NOPE', 0, 0)] }));
    expect(r.warnings).toContain('Block "NOPE" is referenced but not defined');
  });
});

describe('parseDxf: metadata and warnings', () => {
  it('detects units from $INSUNITS', () => {
    const entities = [line('A', 0, 0, 1, 0)];
    expect(parseDxf(dxfText({ insunits: 4, entities })).detectedUnits).toBe('mm');
    expect(parseDxf(dxfText({ insunits: 1, entities })).detectedUnits).toBe('in');
    expect(parseDxf(dxfText({ insunits: 6, entities })).detectedUnits).toBeNull();
    expect(parseDxf(dxfText({ entities })).detectedUnits).toBeNull();
  });

  it('takes layer colours from the layer table', () => {
    const r = parseDxf(dxfText({ layers: [{ name: 'RED', aci: 1 }], entities: [line('RED', 0, 0, 1, 0), line('NOTABLE', 0, 0, 1, 0)] }));
    expect(layer(r, 'RED').color).toBe(0xff0000);
    expect(layer(r, 'NOTABLE').color).toBe(0xffffff);
  });

  it('counts skipped entity types, including ones dxf-parser drops silently', () => {
    const src = dxfText({ entities: [line('A', 0, 0, 1, 0), text('A', 'x'), text('A', 'y'), hatch('A'), polyline('A', [[0, 0], [1, 1]], false)] });
    expect(countEntityTypes(src)).toEqual(new Map([['LINE', 1], ['TEXT', 2], ['HATCH', 1], ['POLYLINE', 1]]));
    const [warning] = parseDxf(src).warnings;
    expect(warning).toMatch(/^Skipped 3 unsupported entities: /);
    expect(warning).toContain('TEXT ×2');
    expect(warning).toContain('HATCH ×1');
  });

  it('warns about non-zero Z', () => {
    const r = parseDxf(dxfText({ entities: [line('A', 0, 0, 1, 0, 5)] }));
    expect(r.warnings).toContain('1 entity had non-zero Z and was projected to XY');
  });

  it('rejects files without supported geometry', () => {
    expect(() => parseDxf(dxfText({ entities: [text('A', 'only text')] }))).toThrow(DxfParseError);
    expect(() => parseDxf('hello')).toThrow(DxfParseError);
  });
});
