import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OcctLoader } from '@sponcam/core';
import type { FileSessionOptions } from './fileSession';
import type { LiveBridge } from './live/bridge';
import { LiveSession } from './live/liveSession';
import { SessionError, type ToolLibraryAccess } from './session';
import { ServerState } from './state';

export interface ServerDeps {
  /** Relative tool paths resolve against this directory (the server's working directory). */
  cwd: string;
  library: ToolLibraryAccess;
  loadReader: OcctLoader;
  rasterize(svg: string): Promise<Uint8Array>;
  /** A fixed date for posted file headers (tests). */
  postDate?: string;
  /** The live bridge; null or absent: file sessions only. */
  bridge?: LiveBridge | null;
}

export interface ToolContext {
  deps: ServerDeps;
  state: ServerState;
  resolvePath(path: string): string;
  /** Reads a file by a tool path; errors name the absolute path. */
  readInput(path: string): Promise<{ path: string; bytes: Uint8Array }>;
  sessionOptions(): FileSessionOptions;
  /** The open job's tool library, or the headless library file when no job is open. */
  library(): ToolLibraryAccess;
}

export function createContext(deps: ServerDeps): ToolContext {
  const state = new ServerState();
  // a live session whose tab disconnected or was replaced is no longer a session
  deps.bridge?.onTabGone((tab) => {
    if (state.session instanceof LiveSession && state.session.tab === tab) state.clear();
  });
  const resolvePath = (path: string) => resolve(deps.cwd, path);
  return {
    deps,
    state,
    resolvePath,
    async readInput(path) {
      const abs = resolvePath(path);
      try {
        return { path: abs, bytes: new Uint8Array(await readFile(abs)) };
      } catch (err) {
        throw new SessionError(`Could not read ${abs}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    sessionOptions: () => ({ library: deps.library, loadReader: deps.loadReader, ...(deps.postDate ? { postDate: deps.postDate } : {}) }),
    library: () => state.session?.tools ?? deps.library,
  };
}
