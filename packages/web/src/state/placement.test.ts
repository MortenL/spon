import type { ModelRef } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { placementFor } from './placement';
import type { ModelGeometry } from './store';

const geometry = (): ModelGeometry => ({ kind: 'drawing', drawing: { layers: [] }, rawPoints: new Float32Array([0, 0, 0, 10, 20, 0]) });
const model = (): ModelRef => ({
  sourceName: 'p.dxf', blobId: 'b1', kind: 'drawing', importUnits: 'mm', transform: { base: { x: 0, y: 0, z: 0, w: 1 }, zDeg: 0 },
});

describe('placementFor', () => {
  it('returns the same placement object for the same model and geometry', () => {
    const m = model();
    const g = geometry();
    const first = placementFor(m, g);
    expect(first).not.toBeNull();
    expect(placementFor(m, g)).toBe(first);
  });

  it('recomputes when the model or the geometry object changes', () => {
    const m = model();
    const g = geometry();
    const first = placementFor(m, g);
    const edited = { ...m, transform: { ...m.transform, zDeg: 90 } };
    expect(placementFor(edited, g)).not.toBe(first);
    expect(placementFor(m, geometry())).not.toBe(first);
    expect(placementFor(edited, g)!.bbox.max.x).toBeCloseTo(10, 9);
  });

  it('caches a null placement for empty geometry', () => {
    const empty: ModelGeometry = { kind: 'drawing', drawing: { layers: [] }, rawPoints: new Float32Array() };
    expect(placementFor(model(), empty)).toBeNull();
  });
});
