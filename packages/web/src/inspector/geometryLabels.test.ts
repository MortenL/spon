import type { GeometryRef } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { refLabel, sameRef, toggleRef } from './geometryLabels';

const face = { kind: 'meshFace' as const, blobId: 'm', seed: 7, normal: { x: 0, y: 0, z: 1 }, point: { x: 0, y: 0, z: 0 } };
const catalog = {
  faces: [{ ref: face, z: -4, area: 600, loops: [{ index: 0, kind: 'outer' as const, length: 100, circle: null }, { index: 1, kind: 'hole' as const, length: 18.8, circle: { center: { x: 30, y: 30 }, diameter: 6 } }] }],
  contours: [], slots: [],
  bosses: [{ ref: { kind: 'meshBoss' as const, face }, center: { x: 40, y: 20 }, diameter: 20, top: 0 }],
  holes: [{ ref: { kind: 'meshHole' as const, face, loop: 1 }, center: { x: 30, y: 30 }, diameter: 6, top: -4, bottom: -7, through: false }],
};

describe('geometry labels', () => {
  it('describes references in the job units', () => {
    // formatLength uses 2 decimals for mm (no unit suffix); see units/units.ts displayDecimals.
    expect(refLabel({ kind: 'dxfPath', blobId: 'd', layer: 1, path: 3 }, null, ['OUTLINE', 'POCKET'], 'mm')).toBe('POCKET · path 4');
    expect(refLabel(face, catalog, null, 'mm')).toBe('Face at Z -4.00');
    expect(refLabel({ kind: 'meshHole', face, loop: 1 }, catalog, null, 'mm')).toBe('Hole Ø6.00 at (30.00, 30.00)');
    expect(refLabel({ kind: 'meshLoop', face, loop: 0 }, catalog, null, 'mm')).toBe('Edge loop 1 of face at Z -4.00');
    expect(refLabel({ kind: 'meshBoss', face }, catalog, null, 'mm')).toBe('Boss Ø20.00');
    expect(refLabel({ kind: 'meshBoss', face: { ...face, seed: 99 } }, catalog, null, 'mm')).toBe('Boss (not found)');
    expect(refLabel({ ...face, seed: 99 }, catalog, null, 'mm')).toBe('Face (not found)');
  });

  it('compares and toggles references', () => {
    const a: GeometryRef = { kind: 'dxfPath', blobId: 'd', layer: 0, path: 0 };
    expect(sameRef(a, { ...a })).toBe(true);
    expect(sameRef({ kind: 'meshLoop', face, loop: 0 }, { kind: 'meshLoop', face: { ...face }, loop: 1 })).toBe(false);
    expect(toggleRef([a], { ...a })).toEqual([]);
    expect(toggleRef([], a)).toEqual([a]);
  });
});
