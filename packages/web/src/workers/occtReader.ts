import type { OcctReader } from '@sponcam/core';

let reader: Promise<OcctReader> | null = null;

/**
 * Loads occt-import-js (LGPL-2.1, unmodified) and its WebAssembly once per worker. Both are dynamic imports, so nothing
 * is downloaded until the first STEP/IGES file. A failed load is forgotten, so the next file tries again.
 */
export function loadOcct(): Promise<OcctReader> {
  if (!reader) {
    const loading = Promise.all([import('occt-import-js'), import('occt-import-js/dist/occt-import-js.wasm?url')])
      .then(([mod, wasm]) => mod.default({ locateFile: () => wasm.default }) as Promise<OcctReader>);
    loading.catch(() => {
      if (reader === loading) reader = null;
    });
    reader = loading;
  }
  return reader;
}
