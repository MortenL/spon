import { CAD_LABEL, cadFormat, cadImport, type ImportResult, importFile, type OcctResult } from '@sponcam/core';
import { loadOcct, OCCT_PARAMS, type OcctReader } from './occtReader';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Reads a model file. STEP/IGES go through the OCCT reader (loaded on first use); STL and DXF never touch it. */
export async function importModel(fileName: string, bytes: Uint8Array, body?: number): Promise<ImportResult> {
  const format = cadFormat(fileName);
  if (!format) return importFile(fileName, bytes);
  let reader: OcctReader;
  try {
    reader = await loadOcct();
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
