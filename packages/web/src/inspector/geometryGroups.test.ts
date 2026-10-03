import type { TextItem } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { listedTexts } from './geometryGroups';

const t = (id: string, fontId: 'sans' | 'hersheySans'): Pick<TextItem, 'id' | 'font'> => ({ id, font: { kind: 'bundled', id: fontId } });
const uploaded: Pick<TextItem, 'id' | 'font'> = { id: 'u', font: { kind: 'file', blobId: 'b', name: 'My.ttf' } };
const texts = [t('a', 'sans'), t('b', 'hersheySans'), uploaded];

describe('listedTexts', () => {
  it('lists outline texts only for profile, pocket and vcarve', () => {
    for (const type of ['profile', 'pocket', 'vcarve'] as const) expect(listedTexts(type, texts).map((x) => x.id)).toEqual(['a', 'u']);
  });
  it('lists single-line texts only for engrave', () => {
    expect(listedTexts('engrave', texts).map((x) => x.id)).toEqual(['a', 'b', 'u']);
  });
  it('lists nothing for drill, face, chamfer, slot and vclear', () => {
    for (const type of ['drill', 'face', 'chamfer', 'slot', 'vclear'] as const) expect(listedTexts(type, texts)).toEqual([]);
  });
});
