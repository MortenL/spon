export type LengthUnit = 'mm' | 'in';

export const MM_PER_INCH = 25.4;

/** Multiply a value expressed in `unit` by this to get millimetres. */
export function unitScale(unit: LengthUnit): number {
  return unit === 'in' ? MM_PER_INCH : 1;
}

export function toDisplay(mm: number, unit: LengthUnit): number {
  return mm / unitScale(unit);
}

export function fromDisplay(value: number, unit: LengthUnit): number {
  return value * unitScale(unit);
}

export function displayDecimals(unit: LengthUnit): number {
  return unit === 'in' ? 4 : 2;
}

export function formatLength(mm: number, unit: LengthUnit, opts: { withUnit?: boolean } = {}): string {
  const decimals = displayDecimals(unit);
  let text = toDisplay(mm, unit).toFixed(decimals);
  if (Number(text) === 0) text = (0).toFixed(decimals); // avoid "-0.00"
  return opts.withUnit ? `${text} ${unit}` : text;
}

const LENGTH_PATTERN = /^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*(mm|in|")?$/i;

/**
 * Parses user input given in display units. An explicit `mm`, `in` or `"` suffix overrides the display unit.
 * Returns millimetres, or null when the text is not a length.
 */
export function parseLength(text: string, unit: LengthUnit): number | null {
  const match = LENGTH_PATTERN.exec(text.trim());
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  const suffix = match[2]?.toLowerCase();
  const inputUnit: LengthUnit = suffix === 'mm' ? 'mm' : suffix === 'in' || suffix === '"' ? 'in' : unit;
  return fromDisplay(value, inputUnit);
}
