import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Job, ModelRef } from '../job/types';
import { SponFileError } from './errors';
import { migrateJob } from './migrations';

export const SPON_EXTENSION = '.spon';
export const SPON_MIME = 'application/x-spon+zip';

export function modelFilePath(model: ModelRef): string {
  return `models/${model.blobId}.${model.kind === 'mesh' ? 'stl' : 'dxf'}`;
}

/** Zip containing job.json and, when the job has a model, the original model file bytes. */
export function writeSpon(job: Job, modelBytes: Uint8Array | null): Uint8Array {
  const files: Record<string, Uint8Array> = { 'job.json': strToU8(JSON.stringify(job, null, 2)) };
  if (job.model) {
    if (!modelBytes) throw new SponFileError('The job has a model but no model data to save');
    files[modelFilePath(job.model)] = modelBytes;
  }
  return zipSync(files, { level: 6 });
}

export function readSpon(bytes: Uint8Array): { job: Job; modelBytes: Uint8Array | null } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new SponFileError('Not a Spon job file (invalid zip)');
  }
  const jobJson = files['job.json'];
  if (!jobJson) throw new SponFileError('Not a Spon job file (job.json missing)');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(jobJson));
  } catch {
    throw new SponFileError('job.json is not valid JSON');
  }
  const job = migrateJob(raw);
  if (!job.model) return { job, modelBytes: null };
  const path = modelFilePath(job.model);
  const modelBytes = files[path];
  if (!modelBytes) throw new SponFileError(`${path} is missing from the job file`);
  return { job, modelBytes };
}
