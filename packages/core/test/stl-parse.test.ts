import { describe, expect, it } from 'vitest';
import { isBinaryStl, parseStlTriangles, StlParseError } from '../src/import/stl';
import { asciiStl, binaryStl, boxTriangles } from './fixtures/stlBuilders';

const box = boxTriangles(20, 10, 5);

describe('parseStlTriangles', () => {
  it('parses binary STL', () => {
    const tris = parseStlTriangles(binaryStl(box));
    expect(tris.length).toBe(12 * 9);
    expect(Array.from(tris.slice(0, 9))).toEqual(box[0]);
  });

  it('parses ASCII STL', () => {
    const tris = parseStlTriangles(asciiStl(box));
    expect(tris.length).toBe(12 * 9);
    expect(Array.from(tris.slice(9, 18))).toEqual(box[1]);
  });

  it('treats a binary file whose header starts with "solid" as binary', () => {
    const bytes = binaryStl(box, 'solid exported-by-some-cad');
    expect(isBinaryStl(bytes)).toBe(true);
    expect(parseStlTriangles(bytes).length).toBe(12 * 9);
  });

  it('rejects truncated binary data', () => {
    const bytes = binaryStl(box).slice(0, 84 + 50 * 5);
    expect(() => parseStlTriangles(bytes)).toThrow(StlParseError);
  });

  it('rejects files with no triangles', () => {
    expect(() => parseStlTriangles(binaryStl([]))).toThrow(StlParseError);
    expect(() => parseStlTriangles(new TextEncoder().encode('solid empty\nendsolid empty'))).toThrow(StlParseError);
  });

  it('rejects garbage', () => {
    expect(() => parseStlTriangles(new TextEncoder().encode('hello world'))).toThrow(StlParseError);
  });
});
