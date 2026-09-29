import type { CadBodySummary, CadFormat, ImportResult, LengthUnit } from '@sponcam/core';
import type { SuccessfulImport } from './geometry';

/** What the import flow does with a worker result. */
export type ImportStep =
  | { kind: 'error'; error: string }
  | { kind: 'chooseBody'; format: CadFormat; bodies: CadBodySummary[] }
  /** `units` null: ask with the units dialog. */
  | { kind: 'ready'; result: SuccessfulImport; units: LengthUnit | null };

export function importStep(result: ImportResult): ImportStep {
  if (!result.ok) return { kind: 'error', error: result.error };
  if (result.kind === 'bodies') return { kind: 'chooseBody', format: result.format, bodies: result.bodies };
  return { kind: 'ready', result, units: result.detectedUnits };
}

/** The body pre-selected in the body dialog: the largest bounding box volume, the first one on ties. */
export function defaultBody(bodies: readonly CadBodySummary[]): number {
  let best = 0;
  let bestVolume = -1;
  bodies.forEach((b, i) => {
    const volume = b.size.x * b.size.y * b.size.z;
    if (volume > bestVolume) {
      best = i;
      bestVolume = volume;
    }
  });
  return best;
}
