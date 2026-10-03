import { describe, expect, it } from 'vitest';
import { autoPanelSuppressed, withoutAutoPanel } from './autoPanelGate';

describe('withoutAutoPanel', () => {
  it('suppresses automatic switches only while the callback runs, even when it throws', () => {
    expect(autoPanelSuppressed()).toBe(false);
    withoutAutoPanel(() => expect(autoPanelSuppressed()).toBe(true));
    expect(() => withoutAutoPanel(() => { throw new Error('x'); })).toThrow('x');
    expect(autoPanelSuppressed()).toBe(false);
  });
});
