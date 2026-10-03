import {
  applyCommands, buildAdjacency, camContext, type CamGeometry, createJob, describeGeometry, differencePolys, drawingPathToProgram, flattenPath, type Move, offsetPolys, type Path2D,
  pathsToPoints, PipelineCache, type Poly, polysArea, programContext, runPipeline, setModel, setStock, sweepPolylines, type Tool, type Toolpath, type Vec2, weldTriangles,
} from '../../src';
import { tool6 } from './camSetup';
import { type Pt, terracedTriangles } from './terraced.mjs';

/** A drawing job with one Slot operation over every path of layer 0 (each path picked once). */
export function drawingSlotJob(paths: Path2D[], patch: Record<string, unknown>, tool: Tool = tool6) {
  const geometry: CamGeometry = { kind: 'drawing', drawing: { layers: [{ name: 'S', color: 0xffffff, paths }] }, rawPoints: pathsToPoints(paths) };
  let job = setModel(createJob(), { sourceName: 's.dxf', blobId: 'd1', kind: 'drawing', importUnits: 'mm' });
  job = setStock(job, { mode: 'auto', margin: { xy: 20, zTop: 0, zBottom: 40 } });
  job = applyCommands(job, [
    { type: 'addTool', tool },
    { type: 'addOperation', opType: 'slot', toolId: tool.id, id: 's' },
    { type: 'updateOperation', id: 's', patch: { geometry: paths.map((_, path) => ({ kind: 'dxfPath', blobId: 'd1', layer: 0, path })), ...patch } as never },
  ]);
  const cam = camContext(job, geometry);
  const { run, toolpaths } = runPipeline(job, geometry as never, programContext(job, geometry as never), new PipelineCache(), { date: '2026-01-01' });
  return {
    job, cam, geometry, diagnostics: run.results[0].diagnostics, tp: toolpaths[0] as Toolpath | undefined,
    /** A drawn path in program coordinates. */
    program: (i: number) => drawingPathToProgram(cam, paths[i]),
  };
}

type Arc = Extract<Move, { kind: 'arc' }>;
function arcPoints(from: Vec2, m: Arc): Vec2[] {
  const r = Math.hypot(from.x - m.center.x, from.y - m.center.y);
  const a0 = Math.atan2(from.y - m.center.y, from.x - m.center.x);
  const a1 = Math.atan2(m.to.y - m.center.y, m.to.x - m.center.x);
  let sweep = m.ccw ? a1 - a0 : a0 - a1;
  sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (sweep < 1e-9) sweep = 2 * Math.PI;
  // 0.02 rad, or coarser on small circles (chord error 0.002 mm): trochoidal slots have hundreds of tiny loops
  const da = Math.max(0.02, 2 * Math.acos(Math.max(0, 1 - 0.002 / Math.max(r, 1e-6))));
  const n = Math.max(8, Math.ceil(sweep / da));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((m.ccw ? 1 : -1) * sweep * i) / n;
    return { x: m.center.x + r * Math.cos(a), y: m.center.y + r * Math.sin(a) };
  });
}

/** XY polylines of the feed moves (lines and tessellated arcs) that run at height z. */
export function cutsAt(tp: Toolpath, z: number): { points: Vec2[]; closed: false }[] {
  const out: { points: Vec2[]; closed: false }[] = [];
  let prev: { x: number; y: number; z: number } | null = null;
  for (const m of tp.moves) {
    if (m.kind === 'cycle') { prev = null; continue; }
    if (prev && m.kind !== 'rapid' && Math.abs(m.to.z - z) < 1e-6 && Math.abs(prev.z - z) < 1e-6) {
      out.push({ points: m.kind === 'arc' ? arcPoints(prev, m) : [prev, m.to], closed: false });
    }
    prev = m.to;
  }
  return out;
}

/** The area the tool (radius r) swept at height z. */
export const sweptAt = (tp: Toolpath, z: number, r: number): Poly[] => sweepPolylines(cutsAt(tp, z), r, 0.005);

/** Area of `a` not covered by `b`, ignoring slivers thinner than 0.05 mm (sweep and flattening error). */
export const uncovered = (a: Poly[], b: Poly[]): number => polysArea(offsetPolys(offsetPolys(differencePolys(a, b), -0.025, 0.005), 0.025, 0.005));

/**
 * Area of `swept` outside `allowed`, ignoring slivers thinner than 0.005 mm (the sweep's own chord error is 0.005 at most). Callers
 * pass an allowed area that is the exact target grown by at most 0.005, so an overcut of 0.02 mm or more shows up.
 */
export const overcut = (swept: Poly[], allowed: Poly[]): number => polysArea(offsetPolys(offsetPolys(differencePolys(swept, allowed), -0.0025, 0.001), 0.0025, 0.001));

/** The outline of a round-ended slot of width w around a centreline (program coordinates). */
export const slotOutline = (centre: Path2D, w: number): Poly[] =>
  sweepPolylines([{ points: flattenPath(centre, 0.001), closed: centre.closed }], w / 2, 0.005);

/** Feed moves that drop straight down below `top` (a plunge). */
export const plunges = (tp: Toolpath, top: number) => {
  const out: Move[] = [];
  tp.moves.forEach((m, i) => {
    const prev = tp.moves[i - 1];
    const p = prev && prev.kind !== 'cycle' ? prev.to : undefined;
    if (p && m.kind === 'line' && m.to.z < top - 1e-6 && m.to.z < p.z - 1e-6 && Math.hypot(m.to.x - p.x, m.to.y - p.y) < 1e-6) out.push(m);
  });
  return out;
};

/** A mesh job of a terraced part (identity orientation, auto stock 5 mm around in XY, flush top and bottom). */
export function terracedSetup(outer: Pt[], top: number, cuts: { poly: Pt[]; z: number }[]) {
  const { mesh } = weldTriangles(Float32Array.from(terracedTriangles(outer, top, cuts).flat()));
  const geometry: CamGeometry = { kind: 'mesh', mesh, adjacency: buildAdjacency(mesh), rawPoints: mesh.positions };
  const job = setStock(setModel(createJob(), { sourceName: 'part.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 0 } });
  return { job, geometry, mesh, catalog: () => describeGeometry(job, geometry) };
}
