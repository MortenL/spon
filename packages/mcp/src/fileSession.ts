import { readFile } from 'node:fs/promises';
import {
  addProgram, applyCommands, applyMachinePreset, EMPTY_FONTS, type BlobMap, type Boxes, camContext, createJob, decideImport, defaultPostSettings, type DialectId,
  exportOutcome, type GeometryCatalog, importedOutcome, importModel, importStep, type Job, type JobCommand, type MachinePresetName, type ModelGeometry,
  modelFilePath, modelSummary, newModelRef, type OcctLoader, operationsWithGeometry, PipelineCache, type PipelineResult, type PreviewOptions,
  previewInput, type ProgramRef, programContext, readSpon, renderPreviewSvg, type RunReport, runPipeline, runReport, setModel, toModelGeometry, writeSpon,
} from '@sponcam/core';
import { withSponExtension, writeFileAtomic } from './files';
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
  private last: { job: Job; geometry: ModelGeometry | null; result: PipelineResult; report: RunReport } | null = null;

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
      const step = importStep(await importModel(modelFilePath(job.model), blobs[job.model.blobId], { body: job.model.body, svgScale: job.model.svgScale }, options.loadReader));
      if (step.kind === 'error') throw new SessionError(`${path}: Could not load the job's model: ${step.error}`);
      if (step.kind === 'chooseBody') throw new SessionError(`${path}: Could not load the job's model: the file has several bodies and the job does not say which one`);
      if (step.kind === 'needsScale') throw new SessionError(`${path}: Could not load the job's model: the SVG's scale is missing`);
      geometry = toModelGeometry(step.result);
    }
    return new FileSession(job, blobs, geometry, path, false, options);
  }

  async describe(): Promise<SessionInfo> {
    return { kind: 'file', name: this.current.name, path: this.path, dirty: this.dirty, model: modelSummary(this.current.model), operations: this.current.operations.length };
  }

  async job(): Promise<Job> {
    return this.current;
  }

  async apply(commands: readonly JobCommand[]): Promise<Job> {
    const next = applyCommands(this.current, commands);
    if (next !== this.current) {
      this.current = next;
      this.dirty = true;
    }
    return this.current;
  }

  async importModel(input: ModelInput): Promise<ImportOutcome> {
    const step = importStep(await importModel(input.fileName, input.bytes, { body: input.body, svgScale: input.svgScale }, this.options.loadReader));
    const decision = decideImport(step, input.units);
    if (decision.status !== 'ready') return decision;
    const affected = operationsWithGeometry(this.current);
    const blobId = crypto.randomUUID();
    const oldBlob = this.current.model?.blobId;
    this.current = setModel(this.current, newModelRef(input.fileName, decision.geometry, decision.units, blobId));
    this.blobs = { ...Object.fromEntries(Object.entries(this.blobs).filter(([id]) => id !== oldBlob)), [blobId]: input.bytes };
    this.geometry = decision.geometry;
    this.dirty = true;
    return importedOutcome(this.current, decision.geometry, decision.units, decision.warnings, affected);
  }

  private pipeline(): { result: PipelineResult; report: RunReport } {
    if (this.last && this.last.job === this.current && this.last.geometry === this.geometry) return this.last;
    const opts = this.options.postDate ? { date: this.options.postDate } : {};
    const result = runPipeline(this.current, this.geometry, programContext(this.current, this.geometry), this.cache, opts, EMPTY_FONTS);
    this.last = { job: this.current, geometry: this.geometry, result, report: runReport(this.current, result.run) };
    return this.last;
  }

  async run(): Promise<RunReport> {
    return this.pipeline().report;
  }

  async catalog(): Promise<GeometryCatalog | null> {
    return this.cache.catalogFor(this.current, this.geometry);
  }

  async boxes(): Promise<Boxes> {
    const ctx = camContext(this.current, this.geometry);
    return { model: ctx.model, stock: ctx.stock };
  }

  async previewSvg(options: PreviewOptions): Promise<string> {
    return renderPreviewSvg(previewInput(this.current, this.geometry, this.pipeline().result), options);
  }

  async save(path?: string): Promise<string> {
    const target = path ?? this.path;
    if (!target) throw new SessionError('This job has not been saved yet — give a path');
    const file = withSponExtension(target);
    try {
      await writeFileAtomic(file, writeSpon(this.current, this.blobs));
    } catch (err) {
      throw new SessionError(`Could not write ${file}: ${message(err)}`);
    }
    this.path = file;
    this.dirty = false;
    return file;
  }

  async exportGcode(): Promise<ExportOutcome> {
    return exportOutcome(this.pipeline().report);
  }

  async importProgram(fileName: string, bytes: Uint8Array): Promise<ProgramRef> {
    const blobId = crypto.randomUUID();
    this.blobs = { ...this.blobs, [blobId]: bytes };
    this.current = addProgram(this.current, { name: fileName, blobId });
    this.dirty = true;
    return this.current.programs.at(-1)!;
  }
}
