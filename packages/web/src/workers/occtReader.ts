import type { OcctResult } from '@sponcam/core';

/** Tessellation settings. Fixed, so the same file always gives the same triangles (face references depend on it). */
export const OCCT_PARAMS = {
  linearUnit: 'millimeter',
  linearDeflectionType: 'absolute_value',
  linearDeflection: 0.01,
  angularDeflection: (0.5 * Math.PI) / 180,
} as const;

export type OcctParams = typeof OCCT_PARAMS;

export interface OcctReader {
  ReadStepFile(bytes: Uint8Array, params: OcctParams): OcctResult;
  ReadIgesFile(bytes: Uint8Array, params: OcctParams): OcctResult;
}

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
