import { type GeometryRef, type LengthUnit, type ThreadSpec } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import {
  kindSwitchPatch, parseToothAngle, pitchFromTpi, pitchToTpi, sizeOptions, threadReadouts, THREAD_STANDARD_OPTIONS,
} from './threadInfo';

const face = { kind: 'meshFace' as const, blobId: 'b', seed: 1, normal: { x: 0, y: 0, z: 1 }, point: { x: 0, y: 0, z: 5 } };
const m8: ThreadSpec = { standard: 'iso-coarse', size: 'M8', majorDiameter: 8, pitch: 1.25, angle: 60 };

describe('thread options', () => {
  it('lists the sizes of each standard', () => {
    expect(THREAD_STANDARD_OPTIONS.map((o) => o.value)).toEqual(['iso-coarse', 'iso-fine', 'unc', 'unf', 'custom']);
    expect(sizeOptions('iso-coarse')).toContain('M8');
    expect(sizeOptions('iso-coarse')).not.toContain('M8x1');
    expect(sizeOptions('iso-fine')).toContain('M8x1');
    expect(sizeOptions('unc')).toContain('1/4-20');
    expect(sizeOptions('unf')).toContain('1/4-28');
    expect(sizeOptions('custom')).toEqual([]);
  });
});

describe('TPI', () => {
  it('converts 20 TPI to 1.27 mm and back', () => {
    expect(pitchFromTpi(20)).toBeCloseTo(1.27, 10);
    expect(pitchToTpi(1.27)).toBeCloseTo(20, 10);
  });
});

describe('threadReadouts', () => {
  it('formats the M8 read-outs in mm jobs', () => {
    const r = threadReadouts(m8, 'internal', 'mm');
    expect(r.minor).toBe('6.65 mm');
    expect(r.depth).toBe('0.68 mm');
    expect(r.tapDrill).toBe('6.8 mm');
  });
  it('formats lengths in inch jobs but the tap drill in mm', () => {
    const r = threadReadouts(m8, 'internal', 'in' as LengthUnit);
    expect(r.minor).toBe('0.2617 in');
    expect(r.tapDrill).toBe('6.8 mm');
  });
  it('uses the external depth and has no tap drill for external threads', () => {
    const r = threadReadouts(m8, 'external', 'mm');
    expect(r.minor).toBe('6.47 mm');
    expect(r.tapDrill).toBeNull();
  });
});

describe('kindSwitchPatch', () => {
  const hole: GeometryRef = { kind: 'meshHole', face, loop: 1 };
  const boss: GeometryRef = { kind: 'meshBoss', face };
  it('drops hole refs when changing to external', () => {
    expect(kindSwitchPatch('external', [hole, boss])).toEqual({ kind: 'external', geometry: [boss] });
  });
  it('drops boss refs when changing to internal', () => {
    expect(kindSwitchPatch('internal', [hole, boss])).toEqual({ kind: 'internal', geometry: [hole] });
  });
});

describe('parseToothAngle', () => {
  it('accepts only angles strictly between 0 and 180', () => {
    expect(parseToothAngle('60')).toBe(60);
    expect(parseToothAngle('29,5')).toBe(29.5);
    expect(parseToothAngle('0')).toBeNull();
    expect(parseToothAngle('180')).toBeNull();
    expect(parseToothAngle('-5')).toBeNull();
    expect(parseToothAngle('abc')).toBeNull();
  });
});
