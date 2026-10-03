import type { OperationType, TextItem } from '@sponcam/core';
import { isSingleLine } from '@/state/texts';

const TEXT_OPERATIONS: readonly OperationType[] = ['profile', 'pocket', 'engrave', 'vcarve'];

/** The texts the Geometry tab offers for an operation type: single-line texts only for engraving, none for other types. */
export function listedTexts<T extends Pick<TextItem, 'font'>>(type: OperationType, texts: readonly T[]): T[] {
  if (!TEXT_OPERATIONS.includes(type)) return [];
  return texts.filter((t) => type === 'engrave' || !isSingleLine(t.font));
}
