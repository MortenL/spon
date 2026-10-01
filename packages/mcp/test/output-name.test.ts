import { describe, expect, it } from 'vitest';
import { safeOutputName } from '../src/tools/output';

describe('safeOutputName', () => {
  it('accepts plain file names', () => {
    expect(safeOutputName('part-1.nc')).toBe('part-1.nc');
  });

  it.each(['', '..', '../x.nc', 'a/b.nc', String.raw`a\b.nc`, '/etc/passwd', String.raw`C:\x.nc`])('refuses %j', (name) => {
    expect(() => safeOutputName(name)).toThrow(`Refusing to write ${name}: not a plain file name`);
  });
});
