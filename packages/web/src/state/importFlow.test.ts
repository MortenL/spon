import { readFileSync } from 'node:fs';
import { cadImport, importFile, type OcctResult } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { defaultBody, importStep } from './importFlow';

const recorded = (name: string): OcctResult => JSON.parse(readFileSync(new URL(`../../../core/test/fixtures/${name}.occt.json`, import.meta.url), 'utf8'));
const STL = new TextEncoder().encode(['solid t', 'facet normal 0 0 1', 'outer loop', 'vertex 0 0 0', 'vertex 2 0 0', 'vertex 0 1 0', 'endloop', 'endfacet', 'endsolid t'].join('\n'));

describe('importStep', () => {
  it('asks for a body only when a file has several', () => {
    expect(importStep(cadImport(recorded('two-bodies.step'), 'step'))).toMatchObject({ kind: 'chooseBody', format: 'step' });
    const single = importStep(cadImport(recorded('box-hole.step'), 'step'));
    expect(single).toMatchObject({ kind: 'ready', units: 'mm' }); // STEP carries units: no units dialog
    const chosen = importStep(cadImport(recorded('two-bodies.step'), 'step', 0));
    expect(chosen).toMatchObject({ kind: 'ready', units: 'mm' });
  });

  it('asks for units for STL and passes errors through', () => {
    expect(importStep(importFile('t.stl', STL))).toMatchObject({ kind: 'ready', units: null });
    expect(importStep({ ok: false, error: 'No solid bodies found' })).toEqual({ kind: 'error', error: 'No solid bodies found' });
  });
});

describe('defaultBody', () => {
  it('picks the body with the largest bounding box, the first on ties', () => {
    const b = (x: number, y: number, z: number) => ({ name: '', triangles: 12, size: { x, y, z } });
    expect(defaultBody([b(10, 10, 5), b(40, 20, 10)])).toBe(1);
    expect(defaultBody([b(1, 1, 1), b(1, 1, 1)])).toBe(0);
    expect(defaultBody([])).toBe(0);
  });
});
