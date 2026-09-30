import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { exportToolLibrary, importToolLibrary, mergeToolLibrary, parseToolLibraryFile, sortTools, starterLibrary, type Tool, validateTool } from '@sponcam/core';
import { type LibraryImportResult, SessionError, type ToolLibraryAccess } from './session';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function defaultLibraryPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.SPON_TOOL_LIBRARY || join(homedir(), '.spon', 'tools.json');
}

/** The headless tool library: a Spon library JSON file (the web app's export format), seeded with the starter tools. */
export class ToolLibraryFile implements ToolLibraryAccess {
  /** Every read-modify-write runs one at a time, so concurrent calls never lose each other's changes. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(readonly path: string) {}

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  list(): Promise<Tool[]> {
    return this.serial(() => this.read());
  }

  private async read(): Promise<Tool[]> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new SessionError(`Could not read the tool library ${this.path}: ${message(err)}`);
      const seeded = sortTools(starterLibrary());
      await this.write(seeded);
      return seeded;
    }
    try {
      return sortTools(importToolLibrary(text));
    } catch (err) {
      throw new SessionError(`The tool library ${this.path} is not valid: ${message(err)}`);
    }
  }

  add(tool: Tool): Promise<void> {
    if (!validateTool(tool)) throw new SessionError('The tool has invalid values');
    return this.serial(async () => {
      const tools = await this.read();
      const other = tools.find((t) => t.id !== tool.id && t.number === tool.number);
      if (other) throw new SessionError(`T${tool.number} is already used by "${other.name}"`);
      await this.write(sortTools([...tools.filter((t) => t.id !== tool.id), tool]));
    });
  }

  /** `fileName` picks the format; `label` (default the file name) is what errors call the file. */
  importFile(fileName: string, bytes: Uint8Array, label = fileName): Promise<LibraryImportResult> {
    return this.serial(async () => {
      let parsed: ReturnType<typeof parseToolLibraryFile>;
      try {
        parsed = parseToolLibraryFile(bytes, fileName);
      } catch (err) {
        throw new SessionError(`Could not read the tool library file ${label}: ${message(err)}`);
      }
      const merge = mergeToolLibrary(await this.read(), parsed.tools);
      await this.write(merge.library);
      return { added: merge.added, updated: merge.updated, skipped: parsed.skipped, notes: merge.notes };
    });
  }

  /** Writes a temporary file and renames it over the library, so a crash never leaves half a file. */
  private async write(tools: readonly Tool[]): Promise<void> {
    const tmp = `${this.path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(tmp, exportToolLibrary(tools));
      await rename(tmp, this.path);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw new SessionError(`Could not write the tool library ${this.path}: ${message(err)}`);
    }
  }
}
