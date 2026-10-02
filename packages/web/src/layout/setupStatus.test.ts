import { createJob, type Job, type ModelGeometry, QUAT_IDENTITY, quatFromAxisAngle, setModel, setStock, setWcs, vec3 } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { originLabel, setupStatus, upAxisLabel } from './setupStatus';

// Placement only reads rawPoints, so the geometry carries the corner points and an empty mesh/drawing.
function corners(x: number, y: number, z: number): Float32Array {
  const pts: number[] = [];
  for (const cx of [0, x]) for (const cy of [0, y]) for (const cz of [0, z]) pts.push(cx, cy, cz);
  return new Float32Array(pts);
}

/** A 20 × 10 × 5 mm box model in auto stock. */
function meshJob(): { job: Job; geometry: ModelGeometry } {
  const job = setStock(setModel(createJob(), { sourceName: 'box.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' }), {
    mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 0 },
  });
  return { job, geometry: { kind: 'mesh', rawPoints: corners(20, 10, 5) } as unknown as ModelGeometry };
}

/** A 40 × 30 mm drawing in auto stock. */
function drawingJob(): { job: Job; geometry: ModelGeometry } {
  const job = setStock(setModel(createJob(), { sourceName: 'a.dxf', blobId: 'd1', kind: 'drawing', importUnits: 'mm' }), {
    mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 5 },
  });
  return { job, geometry: { kind: 'drawing', drawing: { layers: [] }, rawPoints: new Float32Array([0, 0, 0, 40, 30, 0]) } as ModelGeometry };
}

describe('setupStatus', () => {
  it('no model, no fixed stock: everything is empty and the summary says No model', () => {
    const s = setupStatus(createJob(), null);
    expect(s.steps).toEqual({ model: { state: 'empty' }, orientation: { state: 'empty' }, stock: { state: 'empty' }, origin: { state: 'empty' } });
    expect(s.summary).toEqual([{ id: 'model', text: 'No model' }]);
  });

  it('a spoilboard (fixed stock, no model) is fine for stock and origin', () => {
    const job = setStock(createJob(), { mode: 'fixed', size: vec3(600, 400, 18), modelOffset: vec3(0, 0, 0) });
    const s = setupStatus(job, null);
    expect(s.steps.stock).toEqual({ state: 'ok' });
    expect(s.steps.origin).toEqual({ state: 'ok' });
    expect(s.steps.model.state).toBe('empty');
    expect(s.summary.map((p) => p.id)).toEqual(['model', 'stock', 'origin']);
    expect(s.summary[1].text).toBe('fixed stock 600.00 × 400.00 × 18.00 mm');
  });

  it('a model in auto stock is fine everywhere', () => {
    const { job, geometry } = meshJob();
    const s = setupStatus(job, geometry);
    for (const id of ['model', 'orientation', 'stock', 'origin'] as const) expect(s.steps[id]).toEqual({ state: 'ok' });
    expect(s.summary.map((p) => p.id)).toEqual(['model', 'orientation', 'stock', 'origin']);
    expect(s.summary[1].text).toBe('Z up');
  });

  it('fixed stock the model sticks out of needs attention', () => {
    const { job, geometry } = meshJob();
    const small = setStock(job, { mode: 'fixed', size: vec3(15, 10, 5), modelOffset: vec3(0, 0, 0) });
    expect(setupStatus(small, geometry).steps.stock).toEqual({ state: 'attention', reason: 'The model sticks out of the stock' });
  });

  it('an origin offset outside the stock needs attention', () => {
    const { job, geometry } = meshJob();
    const out = setWcs(job, { offset: vec3(-50, 0, 0) });
    expect(setupStatus(out, geometry).steps.origin).toEqual({ state: 'attention', reason: 'The work origin is outside the stock' });
  });

  it('a drawing is checked in X and Y only', () => {
    const { job, geometry } = drawingJob();
    const fixed = setStock(job, { mode: 'fixed', size: vec3(50, 40, 3), modelOffset: vec3(5, 5, 0) });
    expect(setupStatus(fixed, geometry).steps.stock).toEqual({ state: 'ok' });
  });
});

describe('labels', () => {
  it('names the up axis, or custom', () => {
    expect(upAxisLabel(QUAT_IDENTITY)).toBe('Z up');
    expect(upAxisLabel(quatFromAxisAngle(vec3(1, 0, 0), 90))).toBe('Y up');
    expect(upAxisLabel(quatFromAxisAngle(vec3(1, 0, 0), 180))).toBe('−Z up');
    expect(upAxisLabel(quatFromAxisAngle(vec3(0, 1, 0), -90))).toBe('X up');
    expect(upAxisLabel(quatFromAxisAngle(vec3(1, 0, 0), 30))).toBe('custom');
  });
  it('describes the origin in words', () => {
    expect(originLabel({ anchor: { x: 'min', y: 'min', z: 'top' }, offset: vec3(0, 0, 0), workOffset: 'G54' })).toBe('origin front-left, top (G54)');
    expect(originLabel({ anchor: { x: 'center', y: 'center', z: 'bottom' }, offset: vec3(0, 0, 0), workOffset: 'G55' })).toBe('origin centre, bottom (G55)');
    expect(originLabel({ anchor: { x: 'max', y: 'max', z: 'top' }, offset: vec3(1, 0, 0), workOffset: 'G54' })).toBe('origin back-right, top + offset (G54)');
  });
});
