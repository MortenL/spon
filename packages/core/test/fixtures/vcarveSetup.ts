import {
  applyCommands, camContext, type CamGeometry, createJob, drawingPathToProgram, flattenPath, type OperationType, type Path2D, pathsToPoints, PipelineCache,
  type Poly, unionPolys,
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

/** Paths flattened into polygons (program coordinates). */
export const polysOf = (paths: Path2D[]): Poly[] => paths.map((p) => flattenPath(p, 0.001));

/** Convex hull (counter-clockwise) of two circles: the footprint of a cone moved along a straight segment. */
function coneHull(a: { x: number; y: number }, ra: number, b: { x: number; y: number }, rb: number): Poly {
  const n = 32;
  const pts: { x: number; y: number }[] = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    if (ra > 0) pts.push({ x: a.x + ra * Math.cos(t), y: a.y + ra * Math.sin(t) });
    if (rb > 0) pts.push({ x: b.x + rb * Math.cos(t), y: b.y + rb * Math.sin(t) });
  }
  pts.sort((p, q) => p.x - q.x || p.y - q.y);
  const cross = (o: { x: number; y: number }, p: { x: number; y: number }, q: { x: number; y: number }) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const half = (list: typeof pts) => {
    const h: typeof pts = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 1e-12) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/**
 * The surface footprint of a V-bit's moves: each feed segment's cone swept along it (surface radius = depth x tan half).
 * Runs of moves that keep their direction (within 3 degrees, at most 1 mm) are swept as one segment, which keeps the union small.
 */
export function vSwept(tp: Toolpath, top: number, tanHalf: number): Poly[] {
  const out: Poly[] = [];
  type P = { x: number; y: number; z: number };
  let prev: P | null = null;
  let anchor: P | null = null;
  let dir = 0, len = 0;
  const flush = () => {
    if (anchor && prev && (prev.z < top - 1e-6 || anchor.z < top - 1e-6)) {
      const hull = coneHull(anchor, Math.max(0, (top - anchor.z) * tanHalf), prev, Math.max(0, (top - prev.z) * tanHalf));
      if (hull.length >= 3) out.push(hull);
    }
    anchor = null;
    len = 0;
  };
  for (const m of tp.moves) {
    if (m.kind === 'cycle' || m.kind === 'rapid') { flush(); prev = m.kind === 'cycle' ? null : m.to; continue; }
    if (!prev) { prev = m.to; continue; }
    const d = Math.atan2(m.to.y - prev.y, m.to.x - prev.x), l = Math.hypot(m.to.x - prev.x, m.to.y - prev.y);
    if (anchor) {
      const turn = Math.abs(Math.atan2(Math.sin(d - dir), Math.cos(d - dir)));
      if (l > 1e-9 && (turn > (3 * Math.PI) / 180 || len + l > 1)) flush();
    }
    if (!anchor) { anchor = prev; dir = d; }
    len += l;
    prev = m.to;
  }
  flush();
  return unionPolys(out, []);
}
