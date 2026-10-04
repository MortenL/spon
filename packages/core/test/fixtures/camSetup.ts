import { readFileSync } from 'node:fs';
import {
  type CamGeometry, createJob, faceRefFromTriangle, importFile, type Move, pathsToPoints, type Path2D, type ResolvedGeometry, setModel, setStock,
  type MeshFaceRef, type Tool,
} from '../../src';

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

export const tool6: Tool = {
  id: 't6', name: '6 mm flat', type: 'flat', number: 1, diameter: 6, cornerRadius: 0, tipAngleDeg: 0, fluteLength: 20, stickout: 30, flutes: 2,
  presets: [{ name: 'Softwood', rpm: 18000, feed: 2000, plungeFeed: 600, stepdown: 3, stepoverPct: 45, coolant: 'off' }],
};

/** A ResolvedGeometry built by hand (contours, shapes or holes in program coordinates). */
export function geoOf(parts: Partial<Pick<ResolvedGeometry, 'contours' | 'shapes' | 'holes' | 'bosses' | 'slots'>>): ResolvedGeometry {
  return { contours: [], shapes: [], holes: [], bosses: [], slots: [], diagnostics: [], sagitta: 0, faceZ: () => null, ...parts };
}

export type CutMove = Extract<Move, { kind: 'line' | 'arc' }>;
/** Feed moves (lines and arcs) of a move list. */
export const cutMoves = (moves: readonly Move[]): CutMove[] => moves.filter((m): m is CutMove => m.kind === 'line' || m.kind === 'arc');

/** Rectangle contour in program coordinates, counter-clockwise. */
export function rectPath(x0: number, y0: number, x1: number, y1: number): Path2D {
  const p = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  return { closed: true, segments: p.map((from, i) => ({ kind: 'line' as const, from, to: p[(i + 1) % 4] })) };
}
