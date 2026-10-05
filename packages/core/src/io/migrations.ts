import { DEFAULT_MACHINE_PRESET, machinePreset } from '../job/machine';
import type { Job } from '../job/types';
import { defaultPostSettings } from '../post/types';
import { SponFileError } from './errors';

export const CURRENT_SCHEMA_VERSION = 9;

export type Migration = (job: Record<string, unknown>) => Record<string, unknown>;

/** MIGRATIONS[n] upgrades a schemaVersion-n job to n + 1. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // v1 → v2 (Milestone 2): machine profile and program list
  1: (job) => ({ ...job, machine: machinePreset(DEFAULT_MACHINE_PRESET), programs: [] }),
  // v2 → v3 (Milestone 3): tools, operations, post settings, tolerance; stored programs are imported
  2: (job) => ({
    ...job,
    programs: (Array.isArray(job.programs) ? job.programs : []).map((p) => ({ ...(p as object), source: 'imported' })),
    tools: [],
    operations: [],
    post: defaultPostSettings('grbl'),
    tolerance: 0.002,
  }),
  // v3 → v4 (Milestone 4.1): profiles get a side for open chains; "on" keeps the old behaviour
  3: (job) => ({
    ...job,
    operations: (Array.isArray(job.operations) ? job.operations : []).map((op) =>
      (op as { type?: unknown }).type === 'profile' ? { openSide: 'on', ...(op as object) } : op),
  }),
  // v4 → v5 (Milestone 4.2): facing and chamfer operations exist; nothing to change in older jobs
  4: (job) => job,
  // v5 → v6 (Milestone 4.4b): texts
  5: (job) => ({ ...job, texts: [] }),
  // v6 → v7 (Milestone 4.4c): inlays; nothing to change in older jobs
  6: (job) => job,
  // v7 → v8 (Milestone 4.5): thread milling; nothing to change in older jobs
  7: (job) => job,
  // v8 → v9: the machine profile allows cuts 0.5 mm into the spoilboard (a through profile breaks through by 0.2 mm)
  8: (job) => ({ ...job, machine: { spoilboardAllowance: 0.5, ...(job.machine as object) } }),
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
    typeof job.machine === 'object' && job.machine !== null && Array.isArray(job.programs) &&
    Array.isArray(job.tools) && Array.isArray(job.operations) && Array.isArray(job.texts) &&
    typeof job.post === 'object' && job.post !== null && typeof job.tolerance === 'number';
  if (!ok) throw new SponFileError('job.json is not a valid job');
}
