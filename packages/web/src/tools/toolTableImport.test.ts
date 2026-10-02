import { describe, expect, it } from 'vitest';
import { importSummary } from './toolTableImport';

describe('tool import summary', () => {
  it('counts, lists skipped lines, renumbering and guesses', () => {
    const s = importSummary({
      added: 6, updated: 1,
      skipped: [{ name: 'line 9', reason: 'no diameter (D)' }],
      notes: ['Starter 6 mm flat moved from T3 to T21', 'T2 Spiralbohrer: drill (from the comment)'],
    });
    expect(s.title).toBe('Imported 7 tools (1 updated); 1 skipped');
    expect(s.description).toBe('line 9: no diameter (D)\nStarter 6 mm flat moved from T3 to T21\nT2 Spiralbohrer: drill (from the comment)');
    expect(importSummary({ added: 1, updated: 0, skipped: [], notes: [] })).toEqual({ title: 'Imported 1 tool; 0 skipped', description: undefined });
  });
});
