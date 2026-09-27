import { describe, expect, it } from 'vitest';
import { safeFileName } from './fileio';

describe('safeFileName', () => {
  it('replaces characters that Windows forbids and falls back to Untitled', () => {
    expect(safeFileName('Bracket v2')).toBe('Bracket v2');
    expect(safeFileName('a/b:c*?')).toBe('a_b_c_');
    expect(safeFileName('  ')).toBe('Untitled');
  });
});
