import {
  type Boxes, type ExportOutcome, fromBase64, type GeometryCatalog, type ImportOutcome, type Job, type JobCommand, type PreviewOptions, type ProgramRef,
  type RunReport, type SessionInfo, toBase64,
} from '@sponcam/core';
import { withSponExtension, writeFileAtomic } from '../files';
import { type JobSession, type ModelInput, SessionError, type ToolLibraryAccess, type UploadedFontRef } from '../session';
import { debugLog } from '../log';
import type { TabConnection } from './connection';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The job open in the browser tab. Every call is a request to the tab; each apply is one undo step there. */
export class LiveSession implements JobSession {
  readonly kind = 'live' as const;
  readonly tools: ToolLibraryAccess;

  constructor(readonly tab: TabConnection) {
    this.tools = {
      list: () => tab.request('tools.list', {}),
      add: async (tool) => {
        await tab.request('tools.add', { tool });
      },
      importFile: (fileName, bytes, options) => tab.request('tools.import', { fileName, bytes: toBase64(bytes), ...(options?.units ? { units: options.units } : {}) }),
    };
  }

  describe(): Promise<SessionInfo> {
    return this.tab.request('describe', {});
  }

  job(): Promise<Job> {
    return this.tab.request('job', {});
  }

  async spon(): Promise<Uint8Array> {
    return fromBase64((await this.tab.request('saveBytes', {})).bytes);
  }

  apply(commands: readonly JobCommand[], label?: string): Promise<Job> {
    return this.tab.request('apply', { commands: [...commands], label: label ?? `${commands.length} change(s)` });
  }

  importModel(input: ModelInput): Promise<ImportOutcome> {
    return this.tab.request('importModel', {
      fileName: input.fileName, bytes: toBase64(input.bytes),
      ...(input.units ? { units: input.units } : {}), ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.svgScale !== undefined ? { svgScale: input.svgScale } : {}),
    });
  }

  run(): Promise<RunReport> {
    return this.tab.request('run', {});
  }

  catalog(): Promise<GeometryCatalog | null> {
    return this.tab.request('catalog', {});
  }

  boxes(): Promise<Boxes> {
    return this.tab.request('boxes', {});
  }

  previewSvg(options: PreviewOptions): Promise<string> {
    return this.tab.request('previewSvg', { ...options, ...(options.operations ? { operations: [...options.operations] } : {}) });
  }

  /** Without a path: the tab writes through its own file handle and its file name comes back. With a path: the server writes the tab's bytes. */
  async save(path?: string): Promise<string> {
    if (path === undefined) return (await this.tab.request('save', {})).name;
    const { bytes, token } = await this.tab.request('saveBytes', {});
    const file = withSponExtension(path);
    try {
      await writeFileAtomic(file, fromBase64(bytes));
    } catch (err) {
      throw new SessionError(`Could not write ${file}: ${message(err)}`);
    }
    try {
      await this.tab.request('markSaved', { token });
    } catch (err) {
      // the file is on disk; the tab just keeps showing unsaved changes
      debugLog(`markSaved failed after writing ${file}: ${message(err)}`);
    }
    return file;
  }

  exportGcode(): Promise<ExportOutcome> {
    return this.tab.request('exportGcode', {});
  }

  importProgram(fileName: string, bytes: Uint8Array): Promise<ProgramRef> {
    return this.tab.request('importProgram', { fileName, bytes: toBase64(bytes) });
  }

  async loadFont(fileName: string, bytes: Uint8Array): Promise<UploadedFontRef> {
    return (await this.tab.request('loadFont', { fileName, bytes: toBase64(bytes) })).font;
  }
}
