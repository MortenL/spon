import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCommands, BUNDLED_FONTS, createJob, FontFileError, FontStore, loadBundledFont, parseFontFile, parseJhf } from '../src';
import { testFontBytes } from './fixtures/testFont';

describe('fonts', () => {
  it('parses an uploaded font and reads glyphs in font units, y up', () => {
    const f = parseFontFile(testFontBytes(), 'TestSans.otf');
    expect(f).toMatchObject({ kind: 'outline', name: 'TestSans.otf', unitsPerEm: 1000, capHeight: 700 });
    const o = f.glyph('O', 1)!;
    expect(o.advance).toBe(700);
    expect(o.loops).toHaveLength(2);
    const ys = o.loops[0].map((p) => p.y);
    expect(Math.min(...ys)).toBeCloseTo(0, 6);
    expect(Math.max(...ys)).toBeCloseTo(700, 6);
    expect(f.glyph('Z', 1)).toBeNull();
    expect(f.kerning('A', 'V')).toBe(0);
  });

  it('refuses woff2 and unreadable bytes', () => {
    expect(() => parseFontFile(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]), 'x.woff2')).toThrow('WOFF2 fonts are not supported; use TTF, OTF or WOFF');
    expect(() => parseFontFile(new Uint8Array([1, 2, 3, 4, 5]), 'x.ttf')).toThrow(FontFileError);
    expect(() => parseFontFile(new Uint8Array([1, 2, 3, 4, 5]), 'x.ttf')).toThrow("This font file can't be read");
  });

  it('loads every bundled font, with the spec character set in the outline fonts', async () => {
    for (const { id, kind } of BUNDLED_FONTS) {
      const f = await loadBundledFont(id);
      expect(f.kind).toBe(kind);
      expect(f.capHeight).toBeGreaterThan(0);
      expect(f.glyph('H', 1)).not.toBeNull();
    }
    const sans = await loadBundledFont('sans');
    const missing = [...'AZaz09°±Ø×–—‘’“”•€ÆÅØæåø'].filter((ch) => !sans.glyph(ch, 1));
    expect(missing).toEqual([]);
    const curve = sans.glyph('O', 0.5)!;
    expect(curve.loops).toHaveLength(2);
    expect(sans.name).toBe('Inter');
    expect((await loadBundledFont('serif')).name).toBe('Roboto Slab');
  });

  it('flattens curves finer for a smaller tolerance', async () => {
    const sans = await loadBundledFont('sans');
    const n = (tol: number) => sans.glyph('O', tol)!.loops[0].length;
    expect(n(0.5)).toBeGreaterThan(n(20));
  });

  it('reads Hershey strokes as open polylines', async () => {
    const h = await loadBundledFont('hersheySans');
    expect(h).toMatchObject({ kind: 'singleLine', unitsPerEm: 32 });
    expect(h.capHeight).toBe(21);
    const g = h.glyph('H', 0.1)!;
    expect(g.loops).toEqual([]);
    expect(g.strokes).toHaveLength(3); // two verticals and the bar
    expect(Math.max(...g.strokes.flat().map((p) => p.y))).toBeCloseTo(21, 6);
    expect(h.glyph('é', 0.1)).toBeNull();
  });

  it('parses jhf records, including wrapped ones, pen lifts and dots', () => {
    const t = parseJhf(['  699  1JZ', '  714  9MWRFRT RRYQZR[SZRY', '  900  2JZRR', '  901  3JZRF', 'RT', ''].join('\n'));
    expect(t.glyphs[' ']).toEqual({ left: -8, right: 8, strokes: [] });
    expect(t.glyphs['!'].strokes).toEqual([[[0, -12], [0, 2]], [[0, 7], [-1, 8], [0, 9], [1, 8], [0, 7]]]);
    expect(t.glyphs['"'].strokes).toEqual([[[0, 0]]]);
    expect(t.glyphs['#'].strokes).toEqual([[[0, -12], [0, 2]]]);
  });

  it('reads kerning from the font', async () => {
    const serif = await loadBundledFont('serif');
    expect(serif.kerning('A', 'V')).toBeLessThan(0);
    expect(serif.kerning('A', '\u0001')).toBe(0);
  });

  it('generated Hershey tables match parseJhf on the source files', async () => {
    for (const [id, file] of [['hersheySans', 'rowmans'], ['hersheyDuplex', 'rowmand'], ['hersheyScript', 'scripts']] as const) {
      const table = parseJhf(readFileSync(new URL(`../assets/hershey/${file}.jhf`, import.meta.url), 'utf8'));
      const generated = (await import(`../src/text/bundled/${id}.ts`)).default;
      expect(Object.keys(table.glyphs)).toHaveLength(95);
      expect(generated).toEqual(table);
    }
  });

  it('FontStore loads what a job needs and reports missing blobs', async () => {
    const job = applyCommands(createJob(), [
      { type: 'addText', id: 'a', patch: { font: { kind: 'file', blobId: 'f1', name: 'T.otf' } } },
      { type: 'addText', id: 'b', patch: { font: { kind: 'file', blobId: 'gone', name: 'G.ttf' } } },
      { type: 'addText', id: 'c', patch: { font: { kind: 'file', blobId: 'bad', name: 'B.ttf' } } },
      { type: 'addText', id: 'd' },
    ]);
    const store = new FontStore();
    await store.ensure(job, { f1: testFontBytes(), bad: new Uint8Array([1, 2, 3]) });
    expect(store.status(job.texts[0].font)).toBe('ok');
    expect(store.status(job.texts[1].font)).toBe('missing');
    expect(store.status(job.texts[2].font)).toBe('unreadable');
    expect(store.get(job.texts[3].font)?.name).toBe('Inter');
    await store.ensure(job, { f1: testFontBytes(), gone: testFontBytes(), bad: new Uint8Array([1, 2, 3]) });
    expect(store.status(job.texts[1].font)).toBe('ok');
  });
});
