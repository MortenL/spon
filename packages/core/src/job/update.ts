import { quatConjugate, quatFromAxisAngle, quatFromUnitVectors, quatMultiply, quatNormalize, quatRotate } from '../geometry/quat';
import { v3normalize, v3sub, type Vec3, vec3, X_AXIS, Y_AXIS, Z_AXIS } from '../geometry/vec3';
import type { ModelKind } from '../import/importFile';
import type { LengthUnit } from '../units/units';
import { identityTransform } from './defaults';
import { normalizeDegrees } from './orientation';
import type { Job, ModelTransform, Stock, Wcs } from './types';

export interface NewModel {
  sourceName: string;
  blobId: string;
  kind: ModelKind;
  importUnits: LengthUnit;
  format?: 'stl' | 'step' | 'iges' | 'svg';
  body?: number;
  svgScale?: number;
}

export function renameJob(job: Job, name: string): Job {
  const trimmed = name.trim();
  return trimmed && trimmed !== job.name ? { ...job, name: trimmed } : job;
}

export function setDisplayUnits(job: Job, unit: LengthUnit): Job {
  return unit === job.displayUnits ? job : { ...job, displayUnits: unit };
}

export function setModel(job: Job, model: NewModel): Job {
  return { ...job, model: { ...model, transform: identityTransform() } };
}

export function setImportUnits(job: Job, unit: LengthUnit): Job {
  if (!job.model || job.model.importUnits === unit) return job;
  return { ...job, model: { ...job.model, importUnits: unit } };
}

function updateTransform(job: Job, update: (t: ModelTransform) => ModelTransform, meshOnly: boolean): Job {
  if (!job.model || (meshOnly && job.model.kind !== 'mesh')) return job;
  const next = update(job.model.transform);
  return next === job.model.transform ? job : { ...job, model: { ...job.model, transform: next } };
}

/** Rotates the part 90° about the machine X or Y axis as currently seen (i.e. after the Z spin). */
export function rotateQuarter(job: Job, axis: 'x' | 'y', direction: 1 | -1): Job {
  return updateTransform(job, (t) => {
    const spin = quatFromAxisAngle(Z_AXIS, t.zDeg);
    const turn = quatFromAxisAngle(axis === 'x' ? X_AXIS : Y_AXIS, 90 * direction);
    // want turn · spin · base = spin · base'  ⇒  base' = spin⁻¹ · turn · spin · base
    const base = quatMultiply(quatConjugate(spin), quatMultiply(turn, quatMultiply(spin, t.base)));
    return { ...t, base: quatNormalize(base) };
  }, true);
}

/** Rotates `base` so that a face with the given raw-model normal points straight down. */
export function layFlat(job: Job, rawNormal: Vec3): Job {
  return updateTransform(job, (t) => {
    const n = v3normalize(quatRotate(t.base, rawNormal));
    const align = quatFromUnitVectors(n, vec3(0, 0, -1));
    return { ...t, base: quatNormalize(quatMultiply(align, t.base)) };
  }, true);
}

export function setZSpin(job: Job, degrees: number): Job {
  return updateTransform(job, (t) => ({ ...t, zDeg: normalizeDegrees(degrees) }), false);
}

/** Spins about Z by the smallest angle that makes the raw edge a→b parallel to machine X. */
export function alignEdgeToX(job: Job, rawA: Vec3, rawB: Vec3): Job {
  return updateTransform(job, (t) => {
    const d = quatRotate(t.base, v3sub(rawB, rawA));
    if (Math.hypot(d.x, d.y) < 1e-9) return t;
    const seen = (Math.atan2(d.y, d.x) * 180) / Math.PI + t.zDeg;
    let delta = normalizeDegrees(-seen);
    if (delta > 90) delta -= 180;
    else if (delta < -90) delta += 180;
    return { ...t, zDeg: normalizeDegrees(t.zDeg + delta) };
  }, true);
}

export function resetOrientation(job: Job): Job {
  return updateTransform(job, () => identityTransform(), false);
}

export function setStock(job: Job, stock: Stock): Job {
  return { ...job, stock };
}

export function setWcs(job: Job, patch: Partial<Wcs>): Job {
  return { ...job, wcs: { ...job.wcs, ...patch } };
}
