import { describe, expect, it } from 'vitest';
import { layoutText, pathArea, loadBundledFont, newTextItem, parseFontFile, type LoadedFont, type TextItem, type TextLayout } from '../src';
import { testFontBytes } from './fixtures/testFont';

const font = parseFontFile(testFontBytes(), 'TestSans.otf');
// The test font has no kerning table (opentype.js cannot write one), so wrap it with a kerning pair A-V of -100 units.
const kernedFont: LoadedFont = {
  kind: font.kind, name: font.name, unitsPerEm: font.unitsPerEm, capHeight: font.capHeight,
  glyph: (ch, tol) => font.glyph(ch, tol),
  kerning: (a, b) => (a === 'A' && b === 'V' ? -100 : 0),
};
const item = (patch: Partial<TextItem>): TextItem => ({ ...newTextItem('t', 'Text 1', { x: 0, y: 0 }), text: 'H', anchor: 'bottomLeft', ...patch });
const w = (l: TextLayout) => l.bounds!.max.x - l.bounds!.min.x;
const h = (l: TextLayout) => l.bounds!.max.y - l.bounds!.min.y;
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('text layout', () => {
  it('scales by cap height', () => {
    const l = layoutText(item({ size: 7 }), font, 0.01);
    near(h(l), 7);              // H is exactly cap height
    near(w(l), 6);              // 600 units × 7/700
    expect(l.shapes).toHaveLength(1);
  });

  it('applies letter spacing and kerning', () => {
    const base = layoutText(item({ size: 7, text: 'HH' }), font, 0.01);
    near(w(base), 6 + 7);       // second H starts one advance (7 mm) later
    near(w(layoutText(item({ size: 7, text: 'HH', letterSpacing: 2 }), font, 0.01)), 15);
    const av = layoutText(item({ size: 7, text: 'AV' }), kernedFont, 0.01);
    near(w(layoutText(item({ size: 7, text: 'AV' }), font, 0.01)), 13);
    near(w(av), 13 - 1);        // kerning −100 units = −1 mm
  });

  it('stacks lines and aligns them', () => {
    const t = 'HH\nH';
    const left = layoutText(item({ size: 7, text: t, align: 'left', lineSpacing: 2 }), font, 0.01);
    near(h(left), 7 + 14);      // second baseline 2 × 7 mm lower
    const right = layoutText(item({ size: 7, text: t, align: 'right' }), font, 0.01);
    const centre = layoutText(item({ size: 7, text: t, align: 'center' }), font, 0.01);
    // Left edge of the last line's ink: the shapes whose bottom is the block's bottom.
    const lowLeftX = (l: TextLayout) => {
      const pts = (sh: TextLayout['shapes'][number]) => sh.outer.segments.map((g) => (g.kind === 'line' ? g.from : { x: NaN, y: NaN }));
      const low = l.shapes.filter((sh) => Math.min(...pts(sh).map((p) => p.y)) < l.bounds!.min.y + 1e-6);
      return Math.min(...low.flatMap((sh) => pts(sh).map((p) => p.x)));
    };
    near(lowLeftX(right) - lowLeftX(left), 7);
    near(lowLeftX(centre) - lowLeftX(left), 3.5);
  });

  it('keeps blank lines and reports empty text', () => {
    near(h(layoutText(item({ size: 7, text: 'H\n\nH', lineSpacing: 1 }), font, 0.01)), 7 + 14);
    expect(layoutText(item({ text: '  \n ' }), font, 0.01)).toMatchObject({ error: 'text-empty', shapes: [], bounds: null });
  });

  it('fits into a box, never scaling up', () => {
    const l = layoutText(item({ size: 7, text: 'HHHH', fit: { width: 13, height: null } }), font, 0.01);
    near(w(l), 13);
    near(w(layoutText(item({ size: 7, text: 'H', fit: { width: 100, height: 100 } }), font, 0.01)), 6);
    near(h(layoutText(item({ size: 7, text: 'H', fit: { width: 100, height: 3.5 } }), font, 0.01)), 3.5);
    expect(layoutText(item({ size: 7, text: 'HHHH', fit: { width: 2, height: null } }), font, 0.01).error).toBe('text-fit');
  });

  it('puts each anchor at the position, then rotates and mirrors about it', () => {
    const at = (anchor: TextItem['anchor']) => layoutText(item({ size: 7, anchor, position: { x: 100, y: 50 } }), font, 0.01).bounds!;
    expect(at('bottomLeft').min).toEqual({ x: 100, y: 50 });
    near(at('center').min.x, 97); near(at('center').min.y, 46.5);
    near(at('topRight').max.x, 100); near(at('topRight').max.y, 50);
    const r = layoutText(item({ size: 7, angle: 90, position: { x: 100, y: 50 } }), font, 0.01).bounds!;
    near(r.max.x, 100); near(r.min.x, 93); near(r.min.y, 50); near(r.max.y, 56);
    const m = layoutText(item({ size: 7, mirror: true, position: { x: 100, y: 50 } }), font, 0.01).bounds!;
    near(m.max.x, 100); near(m.min.x, 94);
  });

  it('places glyphs on an arc, outside clockwise and inside counter-clockwise', () => {
    const glyphCentres = (l: TextLayout) => l.shapes.map((s) => {
      const pts = s.outer.segments.map((g) => (g.kind === 'line' ? g.from : { x: NaN, y: NaN }));
      return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
    });
    const out = layoutText(item({ size: 7, text: 'HHH', arc: { radius: 50, side: 'outside' }, position: { x: 0, y: 0 } }), font, 0.01);
    const oc = glyphCentres(out).sort((a, b) => a.x - b.x);
    expect(oc).toHaveLength(3);
    // middle glyph straddles the top: ink centre radius = 50 + 3.5 (half the cap height above the baseline)
    near(Math.hypot(oc[1].x, oc[1].y), 53.5); near(oc[1].x, 0);
    // reading order left→right runs clockwise: the left glyph has the larger angle
    expect(Math.atan2(oc[0].y, oc[0].x)).toBeGreaterThan(Math.atan2(oc[2].y, oc[2].x));
    const inn = layoutText(item({ size: 7, text: 'HHH', arc: { radius: 50, side: 'inside' } }), font, 0.01);
    const ic = glyphCentres(inn).sort((a, b) => a.x - b.x);
    near(Math.hypot(ic[1].x, ic[1].y), 46.5); expect(ic[1].y).toBeLessThan(0);
    expect(layoutText(item({ size: 7, arc: { radius: 6, side: 'outside' } }), font, 0.01).error).toBe('text-arc');
    expect(layoutText(item({ size: 7, text: 'H\nH', lineSpacing: 2, arc: { radius: 18, side: 'outside' } }), font, 0.01).error).toBe('text-arc'); // second line radius 4
  });

  it('outputs outer CCW and islands CW, also when mirrored', () => {
    for (const mirror of [false, true]) {
      const o = layoutText(item({ size: 7, text: 'O', mirror }), font, 0.01);
      expect(pathArea(o.shapes[0].outer)).toBeGreaterThan(0);
      expect(pathArea(o.shapes[0].islands[0])).toBeLessThan(0);
    }
  });

  it('turns each arc glyph to follow the circle', () => {
    const R = 50;
    const radii = (l: TextLayout) => l.shapes.map((sh) => {
      const pts = sh.outer.segments.map((g) => (g.kind === 'line' ? g.from : { x: NaN, y: NaN })).map((p) => ({ ...p, r: Math.hypot(p.x, p.y) }));
      const low = [...pts].sort((a, b) => a.r - b.r).slice(0, 2); // the two baseline corners of an outside glyph
      return low.map((p) => p.r);
    });
    const out = layoutText(item({ size: 7, text: 'HHH', arc: { radius: R, side: 'outside' } }), font, 0.01);
    // glyph corners sit at x = +-3 on the baseline, so the baseline corners are at radius sqrt(R^2 + 9) and are not on a rotated-away line
    for (const r of radii(out).flat()) expect(Math.abs(r - Math.hypot(R, 3))).toBeLessThan(0.01);
    // inside: the baseline corners again sit at sqrt(R^2 + 9), the top corners 7 mm nearer the centre
    const inside = layoutText(item({ size: 7, text: 'HHH', arc: { radius: R, side: 'inside' } }), font, 0.01);
    for (const sh of inside.shapes) {
      const rs = sh.outer.segments.map((g) => (g.kind === 'line' ? Math.hypot(g.from.x, g.from.y) : NaN));
      expect(Math.abs(Math.max(...rs) - Math.hypot(R, 3))).toBeLessThan(0.01);
      expect(Math.abs(Math.min(...rs) - Math.hypot(R - 7, 3))).toBeLessThan(0.01);
    }
  });

  it('aligns arc text from the top: left runs clockwise from it, right ends at it', () => {
    const centres = (align: 'left' | 'right') => layoutText(item({ size: 7, text: 'HHH', align, arc: { radius: 50, side: 'outside' } }), font, 0.01)
      .shapes.map((sh) => { const p = sh.outer.segments.map((g) => (g.kind === 'line' ? g.from : { x: NaN, y: NaN })); return p.reduce((a, q) => a + q.x, 0) / p.length; });
    for (const x of centres('left')) expect(x).toBeGreaterThanOrEqual(-1e-6);
    for (const x of centres('right')) expect(x).toBeLessThanOrEqual(1e-6);
  });

  it('puts a second arc line on a smaller radius and fits before arcing', () => {
    const l = layoutText(item({ size: 7, text: 'H\nH', lineSpacing: 2, arc: { radius: 40, side: 'outside' } }), font, 0.01);
    expect(l.error).toBeNull();
    const rc = l.shapes.map((sh) => {
      const p = sh.outer.segments.map((g) => (g.kind === 'line' ? g.from : { x: NaN, y: NaN }));
      const cx = p.reduce((a, q) => a + q.x, 0) / p.length, cy = p.reduce((a, q) => a + q.y, 0) / p.length;
      return Math.hypot(cx, cy);
    }).sort((a, b) => a - b);
    near(rc[1], 40 + 3.5);
    near(rc[0], 40 - 14 + 3.5);
    const f = layoutText(item({ size: 7, text: 'HHHH', fit: { width: 13.5, height: null }, arc: { radius: 50, side: 'outside' } }), font, 0.01);
    expect(f.error).toBeNull();
    // fit scales the straight block by 0.5 first, so every glyph is 3.5 mm tall (radial extent, within the small curvature effect)
    for (const s of f.shapes) {
      const rs = s.outer.segments.map((g) => (g.kind === 'line' ? Math.hypot(g.from.x, g.from.y) : NaN));
      expect(Math.max(...rs) - Math.min(...rs)).toBeGreaterThan(3.4);
      expect(Math.max(...rs) - Math.min(...rs)).toBeLessThan(3.6);
    }
  });

  it('never produces NaN geometry from a NaN fit', () => {
    const l = layoutText(item({ size: 7, fit: { width: NaN, height: null } }), font, 0.01);
    expect(l.error).toBe('text-fit');
    expect(l.shapes).toEqual([]);
  });

  it('unions overlapping contours and keeps counters as islands', async () => {
    const o = layoutText(item({ size: 7, text: 'O' }), font, 0.01);
    expect(o.shapes).toHaveLength(1);
    expect(o.shapes[0].islands).toHaveLength(1);
    const overlap = layoutText(item({ size: 7, text: 'HH', letterSpacing: -3 }), font, 0.01); // boxes overlap by 2 mm
    expect(overlap.shapes).toHaveLength(1);
    const sans = await loadBundledFont('sans');
    const b = layoutText(item({ text: 'B', font: { kind: 'bundled', id: 'sans' } }), sans, 0.01);
    expect(b.shapes).toHaveLength(1);
    expect(b.shapes[0].islands).toHaveLength(2);
  });

  it('skips and lists missing characters without NaN', () => {
    const l = layoutText(item({ size: 7, text: 'H😀\tZH' }), font, 0.01);
    expect(l.missing).toEqual(['😀', '\t', 'Z']);
    expect(l.shapes).toHaveLength(2);
    expect(l.shapes.flatMap((s) => s.outer.segments).every((g) => g.kind !== 'line' || (Number.isFinite(g.from.x) && Number.isFinite(g.to.y)))).toBe(true);
  });

  it('lays out single-line fonts as strokes', async () => {
    const hs = await loadBundledFont('hersheySans');
    const l = layoutText(item({ size: 21, text: 'H', font: { kind: 'bundled', id: 'hersheySans' } }), hs, 0.01);
    expect(l.shapes).toEqual([]);
    expect(l.strokes).toHaveLength(3);
    expect(l.strokes.every((p) => !p.closed)).toBe(true);
    near(h(l), 21);
  });

  it('is fast enough for a paragraph and caches', async () => {
    const bold = await loadBundledFont('sansBold');
    const text = ['The quick brown fox jumps over the lazy dog 0123456789 ÆØÅ æøå!', 'Pack my box with five dozen liquor jugs, then sign it.', 'Sphinx of black quartz, judge my vow. 1234567890 °±×'].join('\n').repeat(1).padEnd(200, 'x');
    const it0 = item({ text, size: 12, font: { kind: 'bundled', id: 'sansBold' } });
    let t = performance.now();
    layoutText(it0, bold, 0.002);
    expect(performance.now() - t).toBeLessThan(300);
    t = performance.now();
    layoutText(it0, bold, 0.002);
    expect(performance.now() - t).toBeLessThan(5);
    const line = item({ text: 'Spon CAM: text in Spon, 40 characters!!', font: { kind: 'bundled', id: 'sans' } });
    const sans = await loadBundledFont('sans');
    t = performance.now();
    layoutText(line, sans, 0.002);
    expect(performance.now() - t).toBeLessThan(50);
  });
});
