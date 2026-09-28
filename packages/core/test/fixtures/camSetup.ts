import { readFileSync } from 'node:fs';
import { type CamGeometry, createJob, importFile, pathsToPoints, setModel, setStock } from '../../src';

/** The CAM part drawing as a job: auto stock with a 5 mm margin and 6 mm thickness. */
export function camPartSetup() {
  const r = importFile('cam-part.dxf', readFileSync(new URL('./cam-part.dxf', import.meta.url)));
  if (!r.ok || r.kind !== 'drawing') throw new Error('fixture did not import');
  const geometry: CamGeometry = { kind: 'drawing', drawing: r.drawing, rawPoints: pathsToPoints(r.drawing.layers.flatMap((l) => l.paths)) };
  let job = setModel(createJob(), { sourceName: 'cam-part.dxf', blobId: 'd1', kind: 'drawing', importUnits: 'mm' });
  job = setStock(job, { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 6 } });
  const layer = (name: string) => r.drawing.layers.findIndex((l) => l.name === name);
  return { job, geometry, drawing: r.drawing, layer };
}
