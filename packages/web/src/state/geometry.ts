import { type ImportResult, type LengthUnit, pathsToPoints, suggestStlUnits } from '@sponcam/core';
import type { ModelGeometry } from './store';

export type SuccessfulImport = Extract<ImportResult, { ok: true }>;

export function toModelGeometry(result: SuccessfulImport): ModelGeometry {
  if (result.kind === 'mesh') {
    return { kind: 'mesh', mesh: result.mesh, adjacency: result.adjacency, diagnostics: result.diagnostics, rawPoints: result.mesh.positions };
  }
  return { kind: 'drawing', drawing: result.drawing, rawPoints: pathsToPoints(result.drawing.layers.flatMap((l) => l.paths)) };
}

/** Units to pre-select in the units dialog: detected units if any, else a guess from the size. */
export function suggestedUnits(result: SuccessfulImport): LengthUnit {
  if (result.detectedUnits) return result.detectedUnits;
  return result.kind === 'mesh' ? suggestStlUnits(result.mesh) : 'mm';
}
