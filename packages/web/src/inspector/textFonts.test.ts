import { describe, expect, it } from 'vitest';
import { fontDisplayName, fontFromValue, fontGroups, fontValue } from './textFonts';

const file = (blobId: string, name: string) => ({ font: { kind: 'file' as const, blobId, name } });

describe('font dropdown model', () => {
  it('groups the bundled fonts and marks single-line ones', () => {
    const groups = fontGroups([]);
    expect(groups.map((g) => g.id)).toEqual(['outline', 'singleLine']);
    expect(groups[0].options.map((o) => o.value)).toEqual(['bundled:sans', 'bundled:sansBold', 'bundled:serif']);
    expect(groups[0].options.every((o) => !o.singleLine)).toBe(true);
    expect(groups[1].options.map((o) => o.value)).toEqual(['bundled:hersheySans', 'bundled:hersheyDuplex', 'bundled:hersheyScript']);
    expect(groups[1].options.every((o) => o.singleLine)).toBe(true);
  });

  it('lists uploaded fonts of the job once per blob id', () => {
    const texts = [file('b1', 'Brush.ttf'), file('b2', 'Slab.otf'), file('b1', 'Brush.ttf'), { font: { kind: 'bundled' as const, id: 'sans' as const } }];
    const job = fontGroups(texts).find((g) => g.id === 'job')!;
    expect(job.label).toBe('In this job');
    expect(job.options.map((o) => [o.value, o.label])).toEqual([['file:b1', 'Brush.ttf'], ['file:b2', 'Slab.otf']]);
  });

  it('maps values back to fonts and names', () => {
    const texts = [file('b1', 'Brush.ttf')];
    expect(fontFromValue('file:b1', texts)).toEqual(texts[0].font);
    expect(fontFromValue('bundled:serif', texts)).toEqual({ kind: 'bundled', id: 'serif' });
    expect(fontFromValue('nope', texts)).toBeNull();
    expect(fontValue(texts[0].font)).toBe('file:b1');
    expect(fontDisplayName({ kind: 'bundled', id: 'serif' })).toBe('Roboto Slab');
    expect(fontDisplayName(texts[0].font)).toBe('Brush.ttf');
  });
});
