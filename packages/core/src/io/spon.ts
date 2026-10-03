import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Job, ModelRef, ProgramRef } from '../job/types';
import { fontBlobPath } from '../text/types';
import { SponFileError } from './errors';
import { migrateJob } from './migrations';

export const SPON_EXTENSION = '.spon';
export const SPON_MIME = 'application/x-spon+zip';

export function modelFilePath(model: ModelRef): string {
  return `models/${model.blobId}.${model.format ?? (model.kind === 'mesh' ? 'stl' : 'dxf')}`;
}

/** Blob bytes keyed by blobId. */
export type BlobMap = Record<string, Uint8Array>;

export function programFilePath(program: ProgramRef): string {
  return `programs/${program.blobId}.nc`;
}

/** Every blob the job references: the model (if any) first, then programs in list order. */
export function jobBlobIds(job: Job): string[] {
  return blobPaths(job).map(([blobId]) => blobId);
}

/** Uploaded fonts of the job's texts, deduplicated by blobId. */
function fontBlobPaths(job: Job): [blobId: string, path: string][] {
  const seen = new Map<string, string>();
  for (const t of job.texts) if (t.font.kind === 'file' && !seen.has(t.font.blobId)) seen.set(t.font.blobId, fontBlobPath(t.font.blobId, t.font.name));
  return [...seen];
}

function blobPaths(job: Job): [blobId: string, path: string][] {
  return [
    ...(job.model ? [[job.model.blobId, modelFilePath(job.model)] as [string, string]] : []),
    ...job.programs.map((p): [string, string] => [p.blobId, programFilePath(p)]),
    ...fontBlobPaths(job),
  ];
}

/** Zip with job.json plus the original bytes of the model and every program. Blobs the job doesn't reference are ignored. */
export function writeSpon(job: Job, blobs: BlobMap): Uint8Array {
  const files: Record<string, Uint8Array> = { 'job.json': strToU8(JSON.stringify(job, null, 2)) };
  for (const [blobId, path] of blobPaths(job)) {
    const bytes = blobs[blobId];
    if (!bytes) throw new SponFileError(`Missing data for ${path}`);
    files[path] = bytes;
  }
  return zipSync(files, { level: 6 });
}

export function readSpon(bytes: Uint8Array): { job: Job; blobs: BlobMap } {
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
  const blobs: BlobMap = {};
  for (const [blobId, path] of blobPaths(job)) {
    const data = files[path];
    if (!data) throw new SponFileError(`${path} is missing from the job file`);
    blobs[blobId] = data;
  }
  return { job, blobs };
}
