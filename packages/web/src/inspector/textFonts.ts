import { BUNDLED_FONTS, type FontRef, type TextItem } from '@sponcam/core';

export interface FontOption { value: string; label: string; font: FontRef; singleLine: boolean }
export interface FontGroup { id: 'outline' | 'singleLine' | 'job'; label: string; options: FontOption[] }

export const LOAD_FONT_VALUE = '__load__';

/** The select value of a font: `bundled:<id>` or `file:<blobId>`. */
export const fontValue = (font: FontRef): string => (font.kind === 'bundled' ? `bundled:${font.id}` : `file:${font.blobId}`);

/** The font's name as shown to the user: the family for bundled fonts, the file name for uploads. */
export function fontDisplayName(font: FontRef): string {
  return font.kind === 'bundled' ? (BUNDLED_FONTS.find((f) => f.id === font.id)?.family ?? font.id) : font.name;
}

/** Dropdown groups: the bundled outline and single-line fonts, then uploaded fonts used in the job (one per blob id). */
export function fontGroups(texts: readonly Pick<TextItem, 'font'>[]): FontGroup[] {
  const bundled = (kind: 'outline' | 'singleLine'): FontOption[] =>
    BUNDLED_FONTS.filter((f) => f.kind === kind).map((f) => {
      const font: FontRef = { kind: 'bundled', id: f.id };
      return { value: fontValue(font), label: f.family, font, singleLine: kind === 'singleLine' };
    });
  const inJob = new Map<string, FontOption>();
  for (const { font } of texts) {
    if (font.kind === 'file' && !inJob.has(font.blobId)) inJob.set(font.blobId, { value: fontValue(font), label: font.name, font, singleLine: false });
  }
  const groups: FontGroup[] = [
    { id: 'outline', label: 'Outline', options: bundled('outline') },
    { id: 'singleLine', label: 'Single-line', options: bundled('singleLine') },
  ];
  if (inJob.size) groups.push({ id: 'job', label: 'In this job', options: [...inJob.values()] });
  return groups;
}

/** The font behind a select value, or null. */
export function fontFromValue(value: string, texts: readonly Pick<TextItem, 'font'>[]): FontRef | null {
  for (const g of fontGroups(texts)) for (const o of g.options) if (o.value === value) return o.font;
  return null;
}
