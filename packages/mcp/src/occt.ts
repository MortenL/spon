import { createRequire } from 'node:module';
import type { OcctReader } from '@sponcam/core';
import { debugLog } from './log';

// named so it never clashes with the esbuild banner's `require` (see scripts/build.mjs)
const requireFromHere = createRequire(import.meta.url);
let reader: Promise<OcctReader> | null = null;

/**
 * Loads occt-import-js (LGPL-2.1) once per process, unmodified, from node_modules; the Emscripten glue finds its
 * .wasm next to itself. It is never bundled. Emscripten's print hooks go to stderr (debug only): its default is stdout, which carries the MCP protocol. A failed load is forgotten, so the next file tries again.
 */
export function loadNodeOcct(): Promise<OcctReader> {
  if (!reader) {
    const loading = Promise.resolve().then(() => (requireFromHere('occt-import-js') as (mod: object) => Promise<OcctReader>)({ print: (s: string) => debugLog(s), printErr: (s: string) => debugLog(s) }));
    loading.catch(() => {
      if (reader === loading) reader = null;
    });
    reader = loading;
  }
  return reader;
}
