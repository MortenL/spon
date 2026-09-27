import { vec3 } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { formatPoint, formatSize } from './format';

describe('format', () => {
  it('formats sizes in display units', () => {
    expect(formatSize(vec3(20, 10, 5), 'mm')).toBe('20.00 × 10.00 × 5.00 mm');
    expect(formatSize(vec3(25.4, 50.8, 0), 'in')).toBe('1.0000 × 2.0000 × 0.0000 in');
  });

  it('formats points without negative zero', () => {
    expect(formatPoint(vec3(0, -0, 12), 'mm')).toBe('X 0.00 · Y 0.00 · Z 12.00 mm');
  });
});
