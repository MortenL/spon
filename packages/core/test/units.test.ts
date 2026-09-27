import { describe, expect, it } from 'vitest';
import { formatLength, fromDisplay, parseLength, toDisplay } from '../src/units/units';

describe('units', () => {
  it('converts between mm and inches', () => {
    expect(toDisplay(25.4, 'in')).toBe(1);
    expect(fromDisplay(2, 'in')).toBeCloseTo(50.8, 12);
    expect(toDisplay(12.5, 'mm')).toBe(12.5);
  });

  it('round-trips display values', () => {
    for (const mm of [0, 0.001, 1, 12.7, 1234.5678, -3.3]) {
      for (const unit of ['mm', 'in'] as const) {
        expect(fromDisplay(toDisplay(mm, unit), unit)).toBeCloseTo(mm, 9);
      }
    }
  });

  it('formats with per-unit precision and never shows -0', () => {
    expect(formatLength(12.3456, 'mm')).toBe('12.35');
    expect(formatLength(25.4, 'in', { withUnit: true })).toBe('1.0000 in');
    expect(formatLength(-0.001, 'mm')).toBe('0.00');
  });

  it('parses plain numbers in display units, accepting decimal commas', () => {
    expect(parseLength('12.5', 'mm')).toBe(12.5);
    expect(parseLength('0.5', 'in')).toBeCloseTo(12.7, 12);
    expect(parseLength(' 3,25 ', 'mm')).toBe(3.25);
    expect(parseLength('.5', 'mm')).toBe(0.5);
    expect(parseLength('-2', 'mm')).toBe(-2);
  });

  it('honours explicit unit suffixes', () => {
    expect(parseLength('10mm', 'in')).toBe(10);
    expect(parseLength('1 in', 'mm')).toBeCloseTo(25.4, 12);
    expect(parseLength('2"', 'mm')).toBeCloseTo(50.8, 12);
  });

  it('rejects invalid input', () => {
    for (const text of ['', 'abc', '1.2.3', '5 cm', '--1']) {
      expect(parseLength(text, 'mm')).toBeNull();
    }
  });

  it('is stable under format → parse → format', () => {
    const again = parseLength(formatLength(12.3456, 'in'), 'in');
    expect(again).not.toBeNull();
    expect(formatLength(again!, 'in')).toBe(formatLength(12.3456, 'in'));
  });
});
