/**
 * Decides what a numeric field commits when editing ends: the parsed value, or null for nothing.
 * Untouched text (still the formatted display) commits nothing, because the display is rounded and
 * re-parsing it would drift the value and create a spurious undo entry.
 */
export function resolveNumericEdit(
  text: string, formatted: string, value: number, parse: (text: string) => number | null,
): number | null {
  if (text === formatted) return null;
  const next = parse(text);
  if (next === null || Math.abs(next - value) <= 1e-9) return null;
  return next;
}
