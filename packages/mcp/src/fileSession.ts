import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  addProgram, applyCommand, applyMachinePreset, type BBox, bboxOfPoints, bboxSize, type BlobMap, camContext, type CamRun, CommandError, createJob,
  defaultBody, defaultPostSettings, type DialectId, exportInputFromRun, exportProblems, type GeometryCatalog, importModel, importStep, type Job,
  type JobCommand, type MachinePresetName, type ModelGeometry, modelFilePath, type OcctLoader, PipelineCache, type PipelineResult, placementFor,
  type PreviewOptions, previewInput, type ProgramRef, programContext, readSpon, renderPreviewSvg, runPipeline, setModel, SPON_EXTENSION,
  suggestedUnits, toModelGeometry, vec3, writeSpon,
} from '@sponcam/core';
import {
  type ExportOutcome, type ImportOutcome, type JobSession, type ModelInput, SessionError, type SessionInfo, type ToolLibraryAccess,
} from './session';

export interface FileSessionOptions { library: ToolLibraryAccess; loadReader: OcctLoader; postDate?: string }
export interface NewJobOptions { name?: string; machinePreset?: MachinePresetName; dialect?: DialectId }

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A job held in memory, loaded from and saved to a .spon file. There is no undo: reopen, or issue new commands. */
export class FileSession implements JobSession {
  readonly kind = 'file' as const;
  readonly tools: ToolLibraryAccess;
  private readonly cache = new PipelineCache();
  private last: { job: Job; geometry: ModelGeometry | null; result: PipelineResult } | null = null;

  private constructor(
    private current: Job,
    private blobs: BlobMap,
    private geometry: ModelGeometry | null,
    private path: string | null,
    private dirty: boolean,
    private readonly options: FileSessionOptions,
  ) {
    this.tools = options.library;
  }

  static create(opts: NewJobOptions, options: FileSessionOptions): FileSession {
    let job = createJob(opts.name ?? 'Untitled');
    if (opts.machinePreset) job = applyMachinePreset(job, opts.machinePreset);
    if (opts.dialect) job = { ...job, post: defaultPostSettings(opts.dialect) };
    return new FileSession(job, {}, null, null, false, options);
  }

  /** Opens a .spon file (absolute path) and re-reads its model exactly as the web app does. */
  static async open(path: string, options: FileSessionOptions): Promise<FileSession> {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(path));
    } catch (err) {
      throw new SessionError(`Could not read ${path}: ${message(err)}`);
    }
    let job: Job;
    let blobs: BlobMap;
    try {
      ({ job, blobs } = readSpon(bytes));
    } catch (err) {
      throw new SessionError(`${path}: ${message(err)}`);
    }
    let geometry: ModelGeometry | null = null;
    if (job.model) {
      const step = importStep(await importModel(modelFilePath(job.model), blobs[job.model.blobId], job.model.body, options.loadReader));
      if (step.kind === 'error') throw new SessionError(`Could not load the job's model: ${step.error}`);
      if (step.kind === 'chooseBody') throw new SessionError("Could not load the job's model: the file has several bodies and the job does not say which one");
      geometry = toModelGeometry(step.result);
    }
    return new FileSession(job, blobs, geometry, path, false, options);
  }

  async describe(): Promise<SessionInfo> {
    const m = this.current.model;
    return {
      kind: 'file', name: this.current.name, path: this.path, dirty: this.dirty,
      model: m ? { sourceName: m.sourceName, kind: m.kind, format: m.format ?? (m.kind === 'mesh' ? 'stl' : 'dxf'), body: m.body ?? null } : null,
      operations: this.current.operations.length,
    };
  }

  async job(): Promise<Job> {
    return this.current;
  }

  async apply(commands: readonly JobCommand[]): Promise<Job> {
    let next = this.current;
    commands.forEach((c, i) => {
      try {
        next = applyCommand(next, c);
      } catch (err) {
        throw new CommandError(`commands[${i}] ${c.type}: ${message(err)}`);
      }
    });
    if (next !== this.current) {
      this.current = next;
      this.dirty = true;
    }
    return this.current;
  }

  async importModel(input: ModelInput): Promise<ImportOutcome> {
    const step = importStep(await importModel(input.fileName, input.bytes, input.body, this.options.loadReader));
    if (step.kind === 'error') return { status: 'error', error: step.error };
    if (step.kind === 'chooseBody') return { status: 'needsBody', bodies: step.bodies, suggested: defaultBody(step.bodies) };
    const geometry = toModelGeometry(step.result);
    const units = step.units ?? input.units;
    if (!units) {
      const raw = bboxOfPoints(geometry.rawPoints);
      return { status: 'needsUnits', suggested: suggestedUnits(step.result), rawSize: raw ? bboxSize(raw) : vec3(0, 0, 0) };
    }
    const affected = this.current.operations.filter((op) => op.geometry.length > 0).length;
    const blobId = crypto.randomUUID();
    const source = geometry.kind === 'mesh' ? geometry.source : undefined;
    const oldBlob = this.current.model?.blobId;
    this.current = setModel(this.current, {
      sourceName: input.fileName, blobId, kind: geometry.kind, importUnits: units, ...(source ? { format: source.format, body: source.body } : {}),
    });
    this.blobs = { ...Object.fromEntries(Object.entries(this.blobs).filter(([id]) => id !== oldBlob)), [blobId]: input.bytes };
    this.geometry = geometry;
    this.dirty = true;
    const placement = placementFor(this.current.model!, geometry);
    const warnings = [...step.result.warnings];
    if (affected) warnings.push(`${affected} operation(s) referred to the previous model; their geometry no longer resolves`);
    return { status: 'imported', kind: geometry.kind, size: placement ? bboxSize(placement.bbox) : vec3(0, 0, 0), units, warnings };
  }

  private pipeline(): PipelineResult {
    if (this.last && this.last.job === this.current && this.last.geometry === this.geometry) return this.last.result;
    const opts = this.options.postDate ? { date: this.options.postDate } : {};
    const result = runPipeline(this.current, this.geometry, programContext(this.current, this.geometry), this.cache, opts);
    this.last = { job: this.current, geometry: this.geometry, result };
    return result;
  }

  async run(): Promise<CamRun> {
    return this.pipeline().run;
  }

  async catalog(): Promise<GeometryCatalog | null> {
    return this.cache.catalogFor(this.current, this.geometry);
  }

  async boxes(): Promise<{ model: BBox | null; stock: BBox | null }> {
    const ctx = camContext(this.current, this.geometry);
    return { model: ctx.model, stock: ctx.stock };
  }

  async previewSvg(options: PreviewOptions): Promise<string> {
    return renderPreviewSvg(previewInput(this.current, this.geometry, this.pipeline()), options);
  }

  async save(path?: string): Promise<string> {
    const target = path ?? this.path;
    if (!target) throw new SessionError('This job has not been saved yet — give a path');
    const file = extname(target).toLowerCase() === SPON_EXTENSION ? target : `${target}${SPON_EXTENSION}`;
    try {
      await writeFile(file, writeSpon(this.current, this.blobs));
    } catch (err) {
      throw new SessionError(`Could not write ${file}: ${message(err)}`);
    }
    this.path = file;
    this.dirty = false;
    return file;
  }

  async exportGcode(): Promise<ExportOutcome> {
    const run = this.pipeline().run;
    const { errors, warnings } = exportProblems(exportInputFromRun(this.current, run));
    if (errors.length) return { ok: false, errors, warnings };
    return { ok: true, files: run.files.map((f) => ({ name: f.name, text: f.text })), warnings };
  }

  async importProgram(fileName: string, bytes: Uint8Array): Promise<ProgramRef> {
    const blobId = crypto.randomUUID();
    this.blobs = { ...this.blobs, [blobId]: bytes };
    this.current = addProgram(this.current, { name: fileName, blobId });
    this.dirty = true;
    return this.current.programs.at(-1)!;
  }
}
