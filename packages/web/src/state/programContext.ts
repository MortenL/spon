import { type Job, type ProgramContext, stockBox, v3sub, type Vec3, vec3, wcsPoint } from '@sponcam/core';
import { placementFor } from './placement';
import type { ModelGeometry } from './store';

function stockAndOrigin(job: Job, geometry: ModelGeometry | null) {
  const placement = job.model && geometry ? placementFor(job.model, geometry) : null;
  const box = stockBox(job, placement);
  const origin = box ? wcsPoint(job.wcs, box) : null;
  return { box, origin };
}

/** Where program zero sits in the scene: the job's WCS point, or the machine origin without stock. */
export function programOrigin(job: Job, geometry: ModelGeometry | null): Vec3 {
  return stockAndOrigin(job, geometry).origin ?? vec3(0, 0, 0);
}

/** Analysis context: machine profile, job work offset, and the stock in program coordinates. */
export function programContext(job: Job, geometry: ModelGeometry | null): ProgramContext {
  const { box, origin } = stockAndOrigin(job, geometry);
  return {
    profile: job.machine,
    stock: box && origin ? { min: v3sub(box.min, origin), max: v3sub(box.max, origin) } : null,
    jobWorkOffset: job.wcs.workOffset,
  };
}
