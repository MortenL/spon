import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bboxOfPoints, bboxSize, type Drawing, pathsToPoints, segmentEnd, segmentStart } from '../src';
import { parseSvg, resolveSvgScale, SvgParseError } from '../src/import/svg/svg';
import { svgViewport } from '../src/import/svg/units';
import { parseXml } from '../src/import/svg/xml';
import { expectWithin } from './fixtures/perf';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/svg/${name}`, import.meta.url), 'utf8');
const size = (d: Drawing) => bboxSize(bboxOfPoints(pathsToPoints(d.layers.flatMap((l) => l.paths)))!);
const names = (d: Drawing) => d.layers.map((l) => l.name);
const drawing = (r: ReturnType<typeof parseSvg>) => {
  if (r.kind !== 'drawing') throw new Error(`expected a drawing, got ${r.kind}`);
  return r;
};

describe('svgViewport', () => {
  it('maps the viewBox to px and knows absolute units', () => {
    const vp = svgViewport(parseXml('<svg width="100mm" height="50mm" viewBox="0 0 100 50"/>'));
    expect(vp.absolute).toBe(true);
    expect(vp.size!.x).toBeCloseTo(377.95, 2);
    expect(vp.userToPx.a).toBeCloseTo(96 / 25.4, 9);
    const px = svgViewport(parseXml('<svg viewBox="10 20 30 40"/>'));
    expect(px).toMatchObject({ absolute: false, size: { x: 30, y: 40 }, userToPx: { a: 1, e: -10, f: -20 } });
    const meet = svgViewport(parseXml('<svg width="200" height="100" viewBox="0 0 100 100"/>'));
    expect(meet.userToPx).toMatchObject({ a: 1, d: 1, e: 50, f: 0 }); // xMidYMid meet
    const none = svgViewport(parseXml('<svg width="200" height="100" viewBox="0 0 100 100" preserveAspectRatio="none"/>'));
    expect(none.userToPx).toMatchObject({ a: 2, d: 1 });
  });
});

describe('parseSvg', () => {
  it('reads an Inkscape file: mm size, nested layers, hidden layer skipped, no prompt', () => {
    const r = drawing(parseSvg(fixture('inkscape.svg')));
    expect(r.svgScale).toBeCloseTo(25.4 / 96, 12);
    expect(names(r.drawing)).toEqual(['Cut', 'Cut/Holes', 'Engrave']);
    const s = size(r.drawing);
    expect(s.x).toBeCloseTo(90, 3);
    expect(s.y).toBeCloseTo(40, 3);
    const cut = r.drawing.layers[0];
    expect(cut.paths).toHaveLength(1);
    expect(cut.paths[0].closed).toBe(true);
    expect(cut.paths[0].segments.filter((x) => x.kind === 'arc')).toHaveLength(4); // rounded corners stay arcs
    expect(r.drawing.layers[1].paths.every((p) => p.closed && p.segments.every((x) => x.kind === 'arc'))).toBe(true);
    expect(r.drawing.layers[2].paths.map((p) => p.closed)).toEqual([false, false]);
  });

  it('flips Y so the drawing reads as it looks on screen (review focus 2)', () => {
    const r = drawing(parseSvg(fixture('inkscape.svg')));
    // the "L" is drawn from (30,40) up to (30,10) then right to (45,10) in SVG (y down):
    // in the drawing its first point is low and the corner is high, and the foot points +X at the top
    const l = r.drawing.layers[2].paths[0];
    const a = segmentStart(l.segments[0]), corner = segmentEnd(l.segments[0]), b = segmentEnd(l.segments[1]);
    expect(corner.y).toBeGreaterThan(a.y);
    expect(b.x).toBeGreaterThan(corner.x);
    expect(b.y).toBeCloseTo(corner.y, 9);
  });

  it('groups Illustrator shapes by their <style> class colours and asks for a scale (review focus 1)', () => {
    const ask = parseSvg(fixture('illustrator.svg'));
    if (ask.kind !== 'needsScale') throw new Error('expected needsScale');
    expect(ask.rawSize.x).toBeCloseTo(126, 6);
    expect(ask.rawSize.y).toBeCloseTo(54, 6);
    const r = drawing(parseSvg(fixture('illustrator.svg'), { svgScale: { dpi: 72 } }));
    expect(r.svgScale).toBeCloseTo(25.4 / 72, 12);
    expect(names(r.drawing)).toEqual(['#ff0000', '#0000ff']);
    expect(r.drawing.layers.map((l) => l.color)).toEqual([0xff0000, 0x0000ff]);
    expect(size(r.drawing).x).toBeCloseTo((126 * 25.4) / 72, 6);
    expect(r.warnings).toContain('1 text element was skipped — convert text to paths before exporting');
  });

  it('resolves the scale choices', () => {
    expect(resolveSvgScale({ dpi: 96 }, { x: 10, y: 10 })).toBeCloseTo(25.4 / 96, 12);
    expect(resolveSvgScale({ width: 50 }, { x: 200, y: 10 })).toBeCloseTo(0.25, 12);
    expect(resolveSvgScale(0.5, { x: 1, y: 1 })).toBe(0.5);
    const r = drawing(parseSvg(fixture('illustrator.svg'), { svgScale: { width: 252 } }));
    expect(size(r.drawing).x).toBeCloseTo(252, 6);
  });

  it('reads Affinity-style files: percent sizes, group transforms, rgb() colours', () => {
    const r = drawing(parseSvg(fixture('affinity.svg'), { svgScale: { dpi: 96 } }));
    expect(names(r.drawing)).toEqual(['#eb0000']);
    expect(r.drawing.layers[0].paths).toHaveLength(2);
    expect(size(r.drawing).x).toBeCloseTo((160 * 25.4) / 96, 6);
  });

  it('reads a CAD export with true arcs and an open line', () => {
    const r = drawing(parseSvg(fixture('cad.svg')));
    expect(names(r.drawing)).toEqual(['#000000']);
    const paths = r.drawing.layers[0].paths;
    expect(paths.map((p) => p.closed)).toEqual([true, true, false]);
    expect(paths[1].segments.every((s) => s.kind === 'arc')).toBe(true);
  });

  it('reads web artwork: fills, nested transforms, use/symbol; skips image, text and clip with warnings', () => {
    const r = drawing(parseSvg(fixture('artwork.svg'), { svgScale: 1 }));
    expect(names(r.drawing)).toEqual(['#333333', '#000000', '#ee4444']);
    const star = r.drawing.layers[1].paths[0];
    expect(star.closed).toBe(true);
    expect(star.segments).toHaveLength(10);
    expect(r.warnings).toEqual(expect.arrayContaining([
      '1 text element was skipped — convert text to paths before exporting',
      '1 embedded image was skipped',
      'Clip paths and masks were ignored; the full shapes were imported',
    ]));
  });

  it('fails clearly on non-SVG and empty files', () => {
    expect(() => parseSvg('<html></html>')).toThrow(new SvgParseError('Not an SVG file'));
    expect(() => parseSvg('<svg><g>')).toThrow(/Not a valid SVG file: Unclosed <g> at line 1/);
    expect(() => parseSvg('<svg width="10mm" height="10mm"><text>x</text></svg>')).toThrow(/^No shapes found in this SVG/);
  });

  describe('robustness', () => {
    const svg = (body: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
    const count = (r: ReturnType<typeof drawing>) => r.drawing.layers.reduce((n, l) => n + l.paths.length, 0);

    it('ignores circular <use> references and warns', () => {
      const r = drawing(parseSvg(svg('<g id="g"><rect width="5" height="5"/><use href="#g" x="2"/></g>'), { svgScale: 1 }));
      expect(count(r)).toBe(1);
      expect(r.warnings).toContain('1 circular reference was ignored');
    });

    it('does not blow up on exponentially self-referencing groups', () => {
      const t = Date.now();
      const r = drawing(parseSvg(svg('<g id="g"><rect width="5" height="5"/><use href="#g"/><use href="#g"/><use href="#g"/></g>'), { svgScale: 1 }));
      expectWithin(Date.now() - t, 1000);
      expect(count(r)).toBe(1);
      expect(r.warnings).toContain('3 circular references were ignored');
    });

    it('keeps the drawing in place when there is no viewport to flip about', () => {
      const r = drawing(parseSvg(svg('<rect x="10" y="10" width="20" height="5"/>'), { svgScale: 1 }));
      const box = bboxOfPoints(pathsToPoints(r.drawing.layers.flatMap((l) => l.paths)))!;
      expect(box.min.y).toBeCloseTo(10, 6);
      expect(box.max.y).toBeCloseTo(15, 6);
    });

    it('applies the symbol own style to its children', () => {
      const r = drawing(parseSvg(svg('<symbol id="s" fill="#ff0000"><rect width="5" height="5"/></symbol><use href="#s"/>'), { svgScale: 1 }));
      expect(names(r.drawing)).toEqual(['#ff0000']);
    });

    it('warns about clip paths set through style, and foreign objects', () => {
      const r = drawing(parseSvg(svg('<rect width="5" height="5" style="clip-path:url(#c)"/><foreignObject width="5" height="5"/>'), { svgScale: 1 }));
      expect(r.warnings).toContain('Clip paths and masks were ignored; the full shapes were imported');
      expect(r.warnings).toContain('1 foreign object was skipped');
    });

    it('walks only the first usable child of a switch', () => {
      const r = drawing(parseSvg(svg('<switch><foreignObject width="5" height="5"/><g><rect width="5" height="5"/></g><g><rect width="9" height="9"/></g></switch>'), { svgScale: 1 }));
      expect(r.drawing.layers.reduce((a, l) => a + l.paths.length, 0)).toBe(1);
      expect(r.warnings.some((w) => w.includes('foreign'))).toBe(false);
    });

    it('does not count hidden text', () => {
      const r = drawing(parseSvg(svg('<rect width="5" height="5"/><text style="display:none">x</text>'), { svgScale: 1 }));
      expect(r.warnings.some((w) => w.includes('text element'))).toBe(false);
    });
  });
});
