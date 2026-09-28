import { readFileSync } from 'node:fs';
import { type CamGeometry, createJob, faceRefFromTriangle, importFile, pathsToPoints, setModel, setStock, type MeshFaceRef } from '../../src';

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

/** The plate fixture as a job: identity orientation, auto stock with a 5 mm XY margin and no Z margin (program Z 0 = plate top). */
export function plateSetup() {
  const r = importFile('plate-pocket.stl', readFileSync(new URL('./plate-pocket.stl', import.meta.url)));
  if (!r.ok || r.kind !== 'mesh') throw new Error('fixture did not import');
  const geometry: CamGeometry = { kind: 'mesh', mesh: r.mesh, adjacency: r.adjacency, rawPoints: r.mesh.positions };
  let job = setModel(createJob(), { sourceName: 'plate-pocket.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' });
  job = setStock(job, { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 0 } });
  return { job, geometry, mesh: r.mesh };
}

/** A face ref whose seed triangle is up-facing at raw height z and contains raw point (x, y). */
export function faceAt(mesh: CamGeometry & { kind: 'mesh' }, x: number, y: number, z: number): MeshFaceRef {
  const { indices, positions, normals } = mesh.mesh;
  for (let t = 0; t < indices.length / 3; t++) {
    if (normals[t * 3 + 2] < 0.99) continue;
    const v = [0, 1, 2].map((k) => indices[t * 3 + k]);
    if (v.some((i) => Math.abs(positions[i * 3 + 2] - z) > 1e-6)) continue;
    const [a, b, c] = v.map((i) => ({ x: positions[i * 3], y: positions[i * 3 + 1] }));
    const s = (p: typeof a, q: typeof a) => (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x);
    const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
    if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) return faceRefFromTriangle(mesh.mesh, 'm1', t);
  }
  throw new Error(`no face at ${x},${y},${z}`);
}
