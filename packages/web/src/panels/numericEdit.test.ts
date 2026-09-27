import { describe, expect, it } from 'vitest';
import { resolveNumericEdit } from './numericEdit';

const parse = (t: string) => {
  const n = Number(t);
  return t.trim() !== '' && Number.isFinite(n) ? n : null;
};

describe('resolveNumericEdit', () => {
  it('commits nothing when the text is untouched, even though the display is rounded', () => {
    // 10 mm shown in inches: re-parsing "0.3937" would give 9.99998 mm
    expect(resolveNumericEdit('0.3937', '0.3937', 0.39370078740157477, parse)).toBeNull();
  });

  it('returns the parsed value for a valid edit', () => {
    expect(resolveNumericEdit('12.5', '10', 10, parse)).toBe(12.5);
  });

  it('returns null for invalid input', () => {
    expect(resolveNumericEdit('abc', '10', 10, parse)).toBeNull();
  });

  it('returns null when the edit parses to the current value', () => {
    expect(resolveNumericEdit('10.000', '10', 10, parse)).toBeNull();
  });
});
