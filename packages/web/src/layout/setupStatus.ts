import {
  bboxSize, type BBox, formatLength, type Job, type ModelGeometry, placementFor, type Quat, quatRotate, stockBox, vec3, wcsPoint,
} from '@sponcam/core';

export type StepId = 'model' | 'orientation' | 'stock' | 'origin';
export interface StepState { state: 'ok' | 'empty' | 'attention'; reason?: string }
/** Problem-only dot of the Text panel: attention when any laid-out text has an error. */
export function textStatus(texts: readonly { diagnostics: readonly { severity: string }[] }[]): StepState {
  return texts.some((t) => t.diagnostics.some((d) => d.severity === 'error')) ? { state: 'attention', reason: 'A text has a problem' } : OK;
}

export interface SummaryPart { id: StepId; text: string }
export interface SetupStatus { steps: Record<StepId, StepState>; summary: SummaryPart[] }

const EPS = 0.001; // mm
const OK: StepState = { state: 'ok' };
const EMPTY: StepState = { state: 'empty' };

/** Which model axis points up after the base orientation (the Z spin does not change it), or 'custom'. */
export function upAxisLabel(base: Quat): string {
  const up = quatRotate({ x: -base.x, y: -base.y, z: -base.z, w: base.w }, vec3(0, 0, 1));
  for (const [axis, v] of [['X', up.x], ['Y', up.y], ['Z', up.z]] as const) {
    if (Math.abs(Math.abs(v) - 1) < 1e-6) return `${v < 0 ? '−' : ''}${axis} up`;
  }
  return 'custom';
}

const X_WORD = { min: 'left', center: '', max: 'right' } as const;
const Y_WORD = { min: 'front', center: '', max: 'back' } as const;

export function originLabel(wcs: Job['wcs']): string {
  const xy = [Y_WORD[wcs.anchor.y], X_WORD[wcs.anchor.x]].filter(Boolean).join('-') || 'centre';
  const moved = wcs.offset.x !== 0 || wcs.offset.y !== 0 || wcs.offset.z !== 0 ? ' + offset' : '';
  return `origin ${xy}, ${wcs.anchor.z}${moved} (${wcs.workOffset})`;
}

const contains = (outer: BBox, inner: BBox, withZ: boolean) =>
  inner.min.x >= outer.min.x - EPS && inner.min.y >= outer.min.y - EPS && inner.max.x <= outer.max.x + EPS && inner.max.y <= outer.max.y + EPS &&
  (!withZ || (inner.min.z >= outer.min.z - EPS && inner.max.z <= outer.max.z + EPS));
const inside = (box: BBox, p: { x: number; y: number; z: number }) =>
  p.x >= box.min.x - EPS && p.x <= box.max.x + EPS && p.y >= box.min.y - EPS && p.y <= box.max.y + EPS && p.z >= box.min.z - EPS && p.z <= box.max.z + EPS;

const sizeText = (box: BBox, units: Job['displayUnits']) => {
  const s = bboxSize(box);
  return `${formatLength(s.x, units)} × ${formatLength(s.y, units)} × ${formatLength(s.z, units)} ${units}`;
};

/** Spec §4.4–4.5: per-step dots and the summary line, from the job alone (nothing is stored). */
export function setupStatus(job: Job, geometry: ModelGeometry | null): SetupStatus {
  const placement = job.model && geometry ? placementFor(job.model, geometry) : null;
  const stock = stockBox(job, placement);
  const steps: Record<StepId, StepState> = { model: OK, orientation: OK, stock: OK, origin: OK };
  const summary: SummaryPart[] = [];

  if (!job.model) {
    steps.model = EMPTY;
    steps.orientation = EMPTY;
    summary.push({ id: 'model', text: 'No model' });
    if (!stock) return { steps: { ...steps, stock: EMPTY, origin: EMPTY }, summary };
    summary.push({ id: 'stock', text: `fixed stock ${sizeText(stock, job.displayUnits)}` });
  } else {
    summary.push({ id: 'model', text: job.model.sourceName });
    summary.push({ id: 'orientation', text: upAxisLabel(job.model.transform.base) });
    if (stock) summary.push({ id: 'stock', text: sizeText(stock, job.displayUnits) });
    if (placement && stock && job.stock.mode === 'fixed' && !contains(stock, placement.bbox, job.model.kind !== 'drawing')) {
      steps.stock = { state: 'attention', reason: 'The model sticks out of the stock' };
    }
  }
  if (stock) {
    summary.push({ id: 'origin', text: originLabel(job.wcs) });
    if (!inside(stock, wcsPoint(job.wcs, stock))) steps.origin = { state: 'attention', reason: 'The work origin is outside the stock' };
  }
  return { steps, summary };
}
