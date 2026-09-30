import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
  constructor(readonly path: string) {}

  async list(): Promise<Tool[]> {
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

  async add(tool: Tool): Promise<void> {
    if (!validateTool(tool)) throw new SessionError('The tool has invalid values');
    const tools = await this.list();
    const other = tools.find((t) => t.id !== tool.id && t.number === tool.number);
    if (other) throw new SessionError(`T${tool.number} is already used by "${other.name}"`);
    await this.write(sortTools([...tools.filter((t) => t.id !== tool.id), tool]));
  }

  async importFile(fileName: string, bytes: Uint8Array): Promise<LibraryImportResult> {
    const parsed = parseToolLibraryFile(bytes, fileName);
    const merge = mergeToolLibrary(await this.list(), parsed.tools);
    await this.write(merge.library);
    return { added: merge.added, updated: merge.updated, skipped: parsed.skipped, notes: merge.notes };
  }

  /** Writes a temporary file and renames it over the library, so a crash never leaves half a file. */
  private async write(tools: readonly Tool[]): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.${process.pid}.tmp`;
      await writeFile(tmp, exportToolLibrary(tools));
      await rename(tmp, this.path);
    } catch (err) {
      throw new SessionError(`Could not write the tool library ${this.path}: ${message(err)}`);
    }
  }
}
