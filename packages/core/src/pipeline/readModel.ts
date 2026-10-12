import { CAD_LABEL, cadImport, type OcctResult, unmeshedFaces } from '../import/cad';
import type { SvgScale } from '../import/svg/svg';
import { cadFormat, type ImportResult, importFile } from '../import/importFile';

/**
 * Tessellation settings. Fixed, so the same file always gives the same triangles (face references depend on it).
 * The 0.01 mm chord sets the accuracy. The angle is a coarse cap: at 0.5° the reader spent minutes on freeform
 * (B-spline) faces and then left them without triangles.
 */
export const OCCT_PARAMS = {
  linearUnit: 'millimeter',
  linearDeflectionType: 'absolute_value',
  linearDeflection: 0.01,
  angularDeflection: (5 * Math.PI) / 180,
} as const;

/**
 * The second try when OCCT_PARAMS leave faces without triangles. Only that file reads with it, and the same file always
 * does, so a reopened job gets the same triangles.
 */
export const OCCT_FALLBACK_PARAMS = {
  linearUnit: 'millimeter',
  linearDeflectionType: 'absolute_value',
  linearDeflection: 0.05,
  angularDeflection: (15 * Math.PI) / 180,
} as const;

export type OcctParams = typeof OCCT_PARAMS | typeof OCCT_FALLBACK_PARAMS;

/** The occt-import-js (LGPL-2.1) functions Spon calls. Core never imports the reader; callers inject a loader. */
export interface OcctReader {
  ReadStepFile(bytes: Uint8Array, params: OcctParams): OcctResult;
  ReadIgesFile(bytes: Uint8Array, params: OcctParams): OcctResult;
}

export type OcctLoader = () => Promise<OcctReader>;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** How to read a model: which STEP/IGES body, and an SVG's scale. */
export interface ImportOptions {
  body?: number;
  svgScale?: SvgScale;
}

/** Reads a model file. STEP/IGES go through the injected reader (loaded on first use); STL and DXF never touch it. */
export async function importModel(fileName: string, bytes: Uint8Array, options: ImportOptions, loadReader: OcctLoader): Promise<ImportResult> {
  const format = cadFormat(fileName);
  if (!format) return importFile(fileName, bytes, { svgScale: options.svgScale });
  let reader: OcctReader;
  try {
    reader = await loadReader();
  } catch (err) {
    return { ok: false, error: `Could not load the ${CAD_LABEL[format]} reader: ${message(err)}` };
  }
  const read = (params: OcctParams): OcctResult => {
    try {
      return format === 'step' ? reader.ReadStepFile(bytes, params) : reader.ReadIgesFile(bytes, params);
    } catch {
      return { success: false }; // the WASM reader aborts on some malformed files
    }
  };
  const fine = read(OCCT_PARAMS);
  const missing = unmeshedFaces(fine.meshes ?? []);
  if (!fine.success || missing === 0) return cadImport(fine, format, options.body);
  // the mesher gave up on some faces: a coarser mesh is better than a model with holes, but only if it has fewer
  const coarse = read(OCCT_FALLBACK_PARAMS);
  if (!coarse.success || unmeshedFaces(coarse.meshes ?? []) >= missing) return cadImport(fine, format, options.body);
  const result = cadImport(coarse, format, options.body);
  if (result.ok && result.kind === 'mesh') {
    result.warnings.unshift(`Some faces could not be meshed at ${OCCT_PARAMS.linearDeflection} mm, so the model was meshed at ${OCCT_FALLBACK_PARAMS.linearDeflection} mm`);
  }
  return result;
}
