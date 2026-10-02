import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createJob, decideImport, importFile, importModel, importStep, modelFilePath, modelSummary, newModelRef, setModel, toModelGeometry,
} from '../src';

const bytes = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/svg/${name}`, import.meta.url)));
const noReader = async () => {
  throw new Error('the OCCT reader must not load for SVG');
};

describe('SVG in the import pipeline', () => {
  it('imports an absolute-unit SVG as a drawing in mm with its scale', async () => {
    const r = await importModel('part.svg', bytes('inkscape.svg'), {}, noReader);
    if (!r.ok || r.kind !== 'drawing') throw new Error('expected a drawing');
    expect(r.detectedUnits).toBe('mm');
    expect(r.svgScale).toBeCloseTo(25.4 / 96, 12);
    const step = importStep(r);
    const d = decideImport(step);
    if (d.status !== 'ready') throw new Error(`expected ready, got ${d.status}`);
    const model = newModelRef('part.svg', d.geometry, d.units, 'b1');
    expect(model).toMatchObject({ format: 'svg', importUnits: 'mm', kind: 'drawing' });
    expect(model.svgScale).toBeCloseTo(25.4 / 96, 12);
    const job = setModel(createJob(), model);
    expect(modelFilePath(job.model!)).toBe('models/b1.svg');
    expect(modelSummary(job.model)).toMatchObject({ format: 'svg' });
  });

  it('asks for a scale for px SVGs and re-reads with the choice', async () => {
    const ask = importFile('art.svg', bytes('illustrator.svg'));
    expect(ask).toMatchObject({ ok: true, kind: 'needsScale' });
    expect(decideImport(importStep(ask))).toMatchObject({ status: 'needsScale', suggestedDpi: 96 });
    const r = await importModel('art.svg', bytes('illustrator.svg'), { svgScale: { dpi: 72 } }, noReader);
    if (!r.ok || r.kind !== 'drawing') throw new Error('expected a drawing');
    expect(toModelGeometry(r)).toMatchObject({ kind: 'drawing', svgScale: 25.4 / 72 });
    // the stored number reproduces the same drawing (review focus 3)
    const again = importFile('art.svg', bytes('illustrator.svg'), { svgScale: r.svgScale });
    expect(again).toEqual(r);
  });
});
