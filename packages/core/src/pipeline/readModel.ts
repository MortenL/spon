import { CAD_LABEL, cadImport, type OcctResult } from '../import/cad';
import { cadFormat, type ImportResult, importFile } from '../import/importFile';

/** Tessellation settings. Fixed, so the same file always gives the same triangles (face references depend on it). */
export const OCCT_PARAMS = {
  linearUnit: 'millimeter',
  linearDeflectionType: 'absolute_value',
  linearDeflection: 0.01,
  angularDeflection: (0.5 * Math.PI) / 180,
} as const;

export type OcctParams = typeof OCCT_PARAMS;

/** The occt-import-js (LGPL-2.1) functions Spon calls. Core never imports the reader; callers inject a loader. */
export interface OcctReader {
  ReadStepFile(bytes: Uint8Array, params: OcctParams): OcctResult;
  ReadIgesFile(bytes: Uint8Array, params: OcctParams): OcctResult;
}

export type OcctLoader = () => Promise<OcctReader>;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Reads a model file. STEP/IGES go through the injected reader (loaded on first use); STL and DXF never touch it. */
export async function importModel(fileName: string, bytes: Uint8Array, body: number | undefined, loadReader: OcctLoader): Promise<ImportResult> {
  const format = cadFormat(fileName);
  if (!format) return importFile(fileName, bytes);
  let reader: OcctReader;
  try {
    reader = await loadReader();
  } catch (err) {
    return { ok: false, error: `Could not load the ${CAD_LABEL[format]} reader: ${message(err)}` };
  }
  let result: OcctResult;
  try {
    result = format === 'step' ? reader.ReadStepFile(bytes, OCCT_PARAMS) : reader.ReadIgesFile(bytes, OCCT_PARAMS);
  } catch {
    result = { success: false }; // the WASM reader aborts on some malformed files
  }
  return cadImport(result, format, body);
}
