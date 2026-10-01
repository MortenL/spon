import type { Adjacency } from '../geometry/adjacency';
import type { Mesh, MeshDiagnostics } from '../geometry/mesh';
import { pathsToPoints } from '../geometry/path2d';
import { v3sub, type Vec3, vec3 } from '../geometry/vec3';
import type { ProgramContext } from '../gcode/program';
import type { Drawing } from '../import/dxf/dxf';
import type { CadSource, ImportResult } from '../import/importFile';
import { suggestStlUnits } from '../import/stl';
import { computePlacement, type Placement, stockBox, wcsPoint } from '../job/derive';
import type { Job, ModelRef } from '../job/types';
import type { LengthUnit } from '../units/units';

/** The loaded model as the web app and the MCP server keep it (a CamGeometry plus import details). */
export type ModelGeometry =
  | { kind: 'mesh'; mesh: Mesh; adjacency: Adjacency; diagnostics: MeshDiagnostics; rawPoints: Float32Array; source?: CadSource }
  | { kind: 'drawing'; drawing: Drawing; rawPoints: Float32Array; svgScale?: number };

export type SuccessfulImport = Extract<ImportResult, { ok: true; kind: 'mesh' | 'drawing' }>;

export function toModelGeometry(result: SuccessfulImport): ModelGeometry {
  if (result.kind === 'mesh') {
    return {
      kind: 'mesh', mesh: result.mesh, adjacency: result.adjacency, diagnostics: result.diagnostics, rawPoints: result.mesh.positions,
      ...(result.source ? { source: result.source } : {}),
    };
  }
  return {
    kind: 'drawing', drawing: result.drawing, rawPoints: pathsToPoints(result.drawing.layers.flatMap((l) => l.paths)),
    ...(result.svgScale !== undefined ? { svgScale: result.svgScale } : {}),
  };
}

/** Units to pre-select in the units dialog: detected units if any, else a guess from the size. */
export function suggestedUnits(result: SuccessfulImport): LengthUnit {
  if (result.detectedUnits) return result.detectedUnits;
  return result.kind === 'mesh' ? suggestStlUnits(result.mesh) : 'mm';
}

// ModelRef objects are replaced on every edit and geometry on every load, so identity caching is exact
const cache = new WeakMap<ModelRef, WeakMap<ModelGeometry, Placement | null>>();

/** The model's placement, computed once per (model, geometry) pair and shared by every caller. */
export function placementFor(model: ModelRef, geometry: ModelGeometry): Placement | null {
  let byGeometry = cache.get(model);
  if (!byGeometry) {
    byGeometry = new WeakMap();
    cache.set(model, byGeometry);
  }
  if (byGeometry.has(geometry)) return byGeometry.get(geometry) ?? null;
  const placement = computePlacement(model, geometry.rawPoints);
  byGeometry.set(geometry, placement);
  return placement;
}

function stockAndOrigin(job: Job, geometry: ModelGeometry | null) {
  const placement = job.model && geometry ? placementFor(job.model, geometry) : null;
  const box = stockBox(job, placement);
  const origin = box ? wcsPoint(job.wcs, box) : null;
  return { box, origin };
}

/** Where program zero sits in the scene: the job's WCS point, or the machine origin without stock. */
export function programOrigin(job: Job, geometry: ModelGeometry | null): Vec3 {
  return stockAndOrigin(job, geometry).origin ?? vec3(0, 0, 0);
}

/** Analysis context: machine profile, job work offset, and the stock in program coordinates. */
export function programContext(job: Job, geometry: ModelGeometry | null): ProgramContext {
  const { box, origin } = stockAndOrigin(job, geometry);
  return {
    profile: job.machine,
    stock: box && origin ? { min: v3sub(box.min, origin), max: v3sub(box.max, origin) } : null,
    jobWorkOffset: job.wcs.workOffset,
  };
}
