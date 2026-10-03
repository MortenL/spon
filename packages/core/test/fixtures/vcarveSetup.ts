import {
  applyCommands, camContext, type CamGeometry, createJob, drawingPathToProgram, type OperationType, type Path2D, pathsToPoints, PipelineCache,
  programContext, runPipeline, setModel, setStock, type Tool, type Toolpath,
} from '../../src';
import { tool6 } from './camSetup';

/** A drawing job with one operation of `opType` over every path of layer 0 (each path picked once). */
export function drawingJob(paths: Path2D[], opType: OperationType, patch: Record<string, unknown>, tool: Tool = tool6) {
  const geometry: CamGeometry = { kind: 'drawing', drawing: { layers: [{ name: 'S', color: 0xffffff, paths }] }, rawPoints: pathsToPoints(paths) };
  let job = setModel(createJob(), { sourceName: 's.dxf', blobId: 'd1', kind: 'drawing', importUnits: 'mm' });
  job = setStock(job, { mode: 'auto', margin: { xy: 20, zTop: 0, zBottom: 40 } });
  job = applyCommands(job, [
    { type: 'addTool', tool },
    { type: 'addOperation', opType, toolId: tool.id, id: 'o' },
    { type: 'updateOperation', id: 'o', patch: { geometry: paths.map((_, path) => ({ kind: 'dxfPath', blobId: 'd1', layer: 0, path })), ...patch } as never },
  ]);
  const cam = camContext(job, geometry);
  const { run, toolpaths } = runPipeline(job, geometry as never, programContext(job, geometry as never), new PipelineCache(), { date: '2026-01-01' });
  return {
    job, cam, geometry, diagnostics: run.results[0].diagnostics, tp: toolpaths[0] as Toolpath | undefined,
    /** A drawn path in program coordinates. */
    program: (i: number) => drawingPathToProgram(cam, paths[i]),
  };
}
