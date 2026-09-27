import { DEFAULT_MACHINE_PRESET, machinePreset } from '../job/machine';
import type { Job } from '../job/types';
import { SponFileError } from './errors';

export const CURRENT_SCHEMA_VERSION = 2;

export type Migration = (job: Record<string, unknown>) => Record<string, unknown>;

/** MIGRATIONS[n] upgrades a schemaVersion-n job to n + 1. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // v1 → v2 (Milestone 2): machine profile and program list
  1: (job) => ({ ...job, machine: machinePreset(DEFAULT_MACHINE_PRESET), programs: [] }),
};

export function migrateJob(raw: unknown, migrations: Readonly<Record<number, Migration>> = MIGRATIONS, current = CURRENT_SCHEMA_VERSION): Job {
  if (typeof raw !== 'object' || raw === null) throw new SponFileError('job.json does not contain a job');
  let job = raw as Record<string, unknown>;
  let version = job.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new SponFileError('job.json has no valid schemaVersion');
  }
  if (version > current) {
    throw new SponFileError(`This job was saved by a newer version of Spon (schema ${version}; this app supports up to ${current})`);
  }
  while (version < current) {
    const migrate = migrations[version];
    if (!migrate) throw new SponFileError(`No migration from schema ${version}`);
    version += 1;
    job = { ...migrate(job), schemaVersion: version };
  }
  assertJobShape(job);
  return job as unknown as Job;
}

function assertJobShape(job: Record<string, unknown>): void {
  const stock = job.stock as { mode?: unknown } | undefined;
  const wcs = job.wcs as { anchor?: unknown; offset?: unknown } | undefined;
  const ok =
    typeof job.id === 'string' &&
    typeof job.name === 'string' &&
    (job.displayUnits === 'mm' || job.displayUnits === 'in') &&
    (job.model === null || typeof job.model === 'object') &&
    typeof stock === 'object' && stock !== null && (stock.mode === 'auto' || stock.mode === 'fixed') &&
    typeof wcs === 'object' && wcs !== null && typeof wcs.anchor === 'object' && typeof wcs.offset === 'object' &&
    typeof job.machine === 'object' && job.machine !== null && Array.isArray(job.programs);
  if (!ok) throw new SponFileError('job.json is not a valid job');
}
