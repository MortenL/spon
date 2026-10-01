import type { ImportOutcome } from '../bridge/protocol';
import { bboxOfPoints, bboxSize } from '../geometry/bbox';
import { vec3 } from '../geometry/vec3';
import type { Job } from '../job/types';
import type { NewModel } from '../job/update';
import type { LengthUnit } from '../units/units';
import { defaultBody, type ImportStep } from './importFlow';
import { type ModelGeometry, placementFor, suggestedUnits, toModelGeometry } from './model';

/** An import that can go ahead, or the outcome that tells the caller what is missing. */
export type ImportDecision =
  | { status: 'ready'; geometry: ModelGeometry; units: LengthUnit; warnings: string[] }
  | Exclude<ImportOutcome, { status: 'imported' }>;

/** Decides a reader result without asking anyone: the MCP server and the live bridge answer needsUnits / needsBody instead of opening a dialog. */
export function decideImport(step: ImportStep, units?: LengthUnit): ImportDecision {
  if (step.kind === 'error') return { status: 'error', error: step.error };
  if (step.kind === 'chooseBody') return { status: 'needsBody', bodies: step.bodies, suggested: defaultBody(step.bodies) };
  const geometry = toModelGeometry(step.result);
  const chosen = step.units ?? units;
  if (!chosen) {
    const raw = bboxOfPoints(geometry.rawPoints);
    return { status: 'needsUnits', suggested: suggestedUnits(step.result), rawSize: raw ? bboxSize(raw) : vec3(0, 0, 0) };
  }
  return { status: 'ready', geometry, units: chosen, warnings: [...step.result.warnings] };
}

export function newModelRef(fileName: string, geometry: ModelGeometry, units: LengthUnit, blobId: string): NewModel {
  const source = geometry.kind === 'mesh' ? geometry.source : undefined;
  return { sourceName: fileName, blobId, kind: geometry.kind, importUnits: units, ...(source ? { format: source.format, body: source.body } : {}) };
}

/** Operations that pick geometry; importing a new model breaks their references. */
export function operationsWithGeometry(job: Job): number {
  return job.operations.filter((op) => op.geometry.length > 0).length;
}

/** The `imported` outcome for `job` after its model was set from `geometry`; `affected` comes from operationsWithGeometry before the import. */
export function importedOutcome(job: Job, geometry: ModelGeometry, units: LengthUnit, warnings: readonly string[], affected: number): ImportOutcome {
  const placement = job.model ? placementFor(job.model, geometry) : null;
  const all = [...warnings];
  if (affected) all.push(`${affected} operation(s) referred to the previous model; their geometry no longer resolves`);
  return { status: 'imported', kind: geometry.kind, size: placement ? bboxSize(placement.bbox) : vec3(0, 0, 0), units, warnings: all };
}
