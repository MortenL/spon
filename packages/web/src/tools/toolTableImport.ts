import type { LibraryImportResult } from '@sponcam/core';

export function importSummary({ added, updated, skipped, notes }: LibraryImportResult): { title: string; description: string | undefined } {
  const total = added + updated;
  const updatedPart = updated > 0 ? ` (${updated} updated)` : '';
  const details = [...skipped.map((s) => `${s.name}: ${s.reason}`), ...notes];
  return {
    title: `Imported ${total} tool${total === 1 ? '' : 's'}${updatedPart}; ${skipped.length} skipped`,
    description: details.length ? details.join('\n') : undefined,
  };
}
