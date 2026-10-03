import { camContext, type CamGeometry } from '../cam/context';
import { resolveGeometry } from '../cam/features/resolve';
import { shapePolys } from '../cam/ops/vcarve';
import { plugShapeLoops } from '../cam/ops/vplug';
import type { GeometryRef, VCarveOp, VPlugOp } from '../cam/types';
import { differencePolys, polysArea, unionPolys } from '../geometry/offset/clipper';
import type { Vec2 } from '../geometry/path2d';
import { importFile } from '../import/importFile';
import { shapesToSvg } from '../import/svg/write';
import { applyCommands, type JobCommand } from '../job/commands';
import { createJob } from '../job/defaults';
import type { BlobMap } from '../io/spon';
import type { Job } from '../job/types';
import { setModel } from '../job/update';
import type { FontSet } from '../text/fonts';
import type { TextItem } from '../text/types';
import type { Tool } from '../tools/types';
import { addClearingCommands } from './inlayCommands';

export class InlayError extends Error {
  override name = 'InlayError';
}

export interface MakeInlayInput {
  inlayDepth: number;
  startDepth: number;
  glueGap: number;
  margin: number;
  plugBoard?: { x: number; y: number; z: number };
  plugFileName: string;
  clearingToolId: string | null;
}
export interface PlugJobResult {
  base: JobCommand[];
  plug: { job: Job; blobs: BlobMap };
  H: number;
  plugBoard: { x: number; y: number; z: number };
  /** Things the user should know that don't stop the plug job (shown by the web and MCP). */
  warnings: string[];
}

const SVG_NAME = 'inlay shapes.svg';
const PLUG_ID = 'plug';
const PLUG_CLEAR_ID = 'plug-clear';

const findCarve = (base: Job, id: string): VCarveOp => {
  const op = base.operations.find((o) => o.id === id);
  if (!op || op.type !== 'vcarve') throw new InlayError('Inlays need a V-carve operation');
  return op;
};

const boundsOf = (loops: readonly Vec2[][]) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of loops) for (const p of l) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
};

/** mm²: shapes overlapping by less (flattening noise where they only touch) are not reported. */
const OVERLAP_AREA = 0.01;

/** The V-carve's merged shapes (all references) and those of its non-text references, in program coordinates. */
function carveShapes(base: Job, geometry: CamGeometry | null, fonts: FontSet, op: VCarveOp) {
  const ctx = camContext(base, geometry, fonts);
  const geo = resolveGeometry(op, ctx);
  const all = plugShapeLoops(geo, ctx.tolerance);
  if (!all.length) throw new InlayError(`${op.name} has no closed outlines to inlay`);
  const others = op.geometry.filter((g) => g.kind !== 'text');
  const drawn = others.length ? plugShapeLoops(resolveGeometry({ ...op, geometry: others }, ctx), ctx.tolerance) : [];
  // the V-carve cuts each shape on its own, but the plug follows their union: where shapes overlap, the pocket is smaller than the plug
  // (an island that crosses its outline, which is how overlapping drawn paths can resolve, counts as an overlap too)
  let overlap = false;
  const regions = geo.shapes.map((sh) => {
    const [outer, ...islands] = shapePolys(sh.shape, ctx.tolerance);
    const region = differencePolys([outer], islands);
    if (Math.abs(polysArea([outer, ...islands]) - polysArea(region)) > OVERLAP_AREA) overlap = true;
    return region;
  });
  if (regions.reduce((sum, r) => sum + polysArea(r), 0) - polysArea(unionPolys(regions.flat())) > OVERLAP_AREA) overlap = true;
  return { ctx, all, drawn, overlap };
}

const boardFor = (b: { w: number; h: number }, margin: number, H: number) => ({ x: b.w + 2 * margin, y: b.h + 2 * margin, z: H + 2 });

/** The plug board: the mirrored shapes' bounds grown by `margin` on each side in X and Y, and `H + 2` thick. */
export function defaultPlugBoard(base: Job, geometry: CamGeometry | null, vcarveId: string, fonts: FontSet, margin: number, H: number): { x: number; y: number; z: number } {
  const b = boundsOf(carveShapes(base, geometry, fonts, findCarve(base, vcarveId)).all);
  return boardFor(b, margin, H);
}

/**
 * Whether a plug board (a stored one, say) still holds the plug: its X and Y hold the walls M ⊕ S·tan(α) of the V-carve's
 * current shapes, and it is at least H thick. Throws an InlayError when the V-carve has no closed outlines.
 */
export function plugBoardFits(
  base: Job, geometry: CamGeometry | null, vcarveId: string, fonts: FontSet, board: { x: number; y: number; z: number },
  settings: Pick<MakeInlayInput, 'inlayDepth' | 'startDepth' | 'glueGap'>,
): boolean {
  const carve = findCarve(base, vcarveId);
  const vbit = base.tools.find((t) => t.id === carve.toolId);
  const R = vbit?.type === 'vbit' ? settings.startDepth * Math.tan((vbit.tipAngleDeg * Math.PI) / 360) : 0;
  const b = boundsOf(carveShapes(base, geometry, fonts, carve).all);
  const H = settings.inlayDepth - settings.glueGap + settings.startDepth;
  return board.x >= b.w + 2 * R - 1e-9 && board.y >= b.h + 2 * R - 1e-9 && board.z >= H - 1e-9;
}

function checkSettings(tool: Tool | undefined, input: MakeInlayInput): void {
  if (!tool || tool.type !== 'vbit') throw new InlayError('Inlays need a V-bit');
  const { inlayDepth: D, startDepth: S, glueGap: g } = input;
  if (![D, S, g].every((v) => Number.isFinite(v) && v > 0)) throw new InlayError('Set the inlay depth, start depth and glue gap to positive values');
  if (!(g < D)) throw new InlayError('The glue gap must be smaller than the inlay depth');
}

/**
 * Spec §4: the commands that prepare the base V-carve for an inlay, and the plug job (new, or `existing` updated)
 * holding the mirrored shapes, the plug and its clearing.
 */
export function makePlugJob(
  base: Job, geometry: CamGeometry | null, fonts: FontSet, blobs: BlobMap, vcarveId: string, input: MakeInlayInput,
  existing?: { job: Job; blobs: BlobMap },
): PlugJobResult {
  const carve = findCarve(base, vcarveId);
  const vbit = base.tools.find((t) => t.id === carve.toolId);
  checkSettings(vbit, input);
  const { inlayDepth: D, startDepth: S, glueGap: g } = input;
  const H = D - g + S;
  if (existing && !existing.job.operations.some((o) => o.type === 'vplug')) throw new InlayError('This job is not a plug job');
  if (input.clearingToolId !== null && !base.tools.some((t) => t.id === input.clearingToolId)) throw new InlayError('The clearing tool is not in the job');
  // spec §4: the plug is cleared with the base clearing's tool when no tool is given
  const baseClearing = base.operations.find((o) => o.enabled && o.type === 'vclear' && o.sourceId === vcarveId);
  const clearToolId = input.clearingToolId ?? baseClearing?.toolId ?? null;
  const clearTool = clearToolId === null ? null : base.tools.find((t) => t.id === clearToolId) ?? null;

  const { ctx, all, drawn, overlap } = carveShapes(base, geometry, fonts, carve);
  const box = boundsOf(all);
  const plugBoard = input.plugBoard ?? boardFor(box, input.margin, H);
  if (plugBoard.z < H) throw new InlayError(`The plug board is thinner than the plug (${H.toFixed(2)} mm)`);
  if (plugBoard.x < box.w - 1e-9 || plugBoard.y < box.h - 1e-9) throw new InlayError(`The plug board is smaller than the shapes (${box.w.toFixed(2)} × ${box.h.toFixed(2)} mm)`);
  const warnings = overlap ? [`Shapes of ${carve.name} overlap; the plug follows their union, so it will not fit where they overlap`] : [];

  // base commands
  const baseCmds: JobCommand[] = [{
    type: 'updateOperation', id: vcarveId,
    patch: { maxDepth: D, inlay: { startDepth: S, glueGap: g, margin: input.margin, plugBoard, plugFileName: input.plugFileName } },
  }];
  if (!base.operations.some((o) => o.enabled && o.type === 'vclear' && o.sourceId === vcarveId)) {
    baseCmds.push(...addClearingCommands(base, vcarveId, input.clearingToolId, crypto.randomUUID()));
  }

  // Clarification 4: mirror in X about the shapes' bounds centre, then put that centre at the plug stock's centre.
  // Base program coordinates -> plug stock coordinates (min corner = 0).
  const sMin = ctx.stock?.min ?? { x: 0, y: 0 };
  const toPlug = (p: Vec2): Vec2 => ({ x: plugBoard.x / 2 - (p.x - box.cx), y: plugBoard.y / 2 + (p.y - box.cy) });
  const baseStock = (p: Vec2): Vec2 => ({ x: p.x + sMin.x, y: p.y + sMin.y });
  const textIds = [...new Set(carve.geometry.flatMap((r) => (r.kind === 'text' ? [r.textId] : [])))];
  const baseTexts = textIds.flatMap((id) => base.texts.find((t) => t.id === id) ?? []);

  let job: Job;
  let outBlobs: BlobMap;
  if (existing) {
    job = existing.job;
    outBlobs = { ...existing.blobs };
    const plugOps = job.operations.filter((o): o is VPlugOp => o.type === 'vplug');
    const old = new Set(plugOps.flatMap((o) => o.geometry.flatMap((r) => (r.kind === 'text' ? [r.textId] : []))));
    job = applyCommands(job, [...old].filter((id) => job.texts.some((t) => t.id === id)).map((id) => ({ type: 'removeText' as const, id })));
    const model = job.model;
    if (model && plugOps.some((o) => o.geometry.some((r) => r.kind === 'dxfPath' && r.blobId === model.blobId))) {
      delete outBlobs[model.blobId];
      job = { ...job, model: null };
    }
  } else {
    job = { ...createJob(`${base.name} plug`), displayUnits: base.displayUnits, machine: structuredClone(base.machine), post: structuredClone(base.post), tolerance: base.tolerance };
    outBlobs = {};
  }

  // the drawn shapes as one SVG model
  const refs: GeometryRef[] = [];
  let modelOffset = { x: 0, y: 0, z: 0 };
  if (drawn.length) {
    // relative to the plug stock centre; mirroring reverses each loop's winding
    const placed = drawn.map((l) => l.map((p) => {
      const q = toPlug(p);
      return { x: q.x - plugBoard.x / 2, y: q.y - plugBoard.y / 2 };
    }).reverse());
    const pb = boundsOf(placed);
    const svg = shapesToSvg(placed.map((l) => l.map((p) => ({ x: p.x - pb.minX, y: p.y - pb.minY }))));
    const bytes = new TextEncoder().encode(svg);
    const imported = importFile(SVG_NAME, bytes, { svgScale: 1 });
    if (!imported.ok || imported.kind !== 'drawing' || imported.drawing.layers.length !== 1) throw new InlayError('The inlay shapes could not be written as an SVG');
    const blobId = crypto.randomUUID();
    outBlobs[blobId] = bytes;
    job = setModel(job, { sourceName: SVG_NAME, blobId, kind: 'drawing', importUnits: 'mm', format: 'svg', svgScale: 1 });
    imported.drawing.layers[0].paths.forEach((_, path) => refs.push({ kind: 'dxfPath', blobId, layer: 0, path }));
    // the placement centres the drawing at the scene origin, so the stock's min corner is at -size/2 - offset;
    // the drawing's centre must land at (board/2 + its centre relative to the board centre)
    modelOffset = { x: (plugBoard.x - pb.w) / 2 + pb.cx, y: (plugBoard.y - pb.h) / 2 + pb.cy, z: 0 };
  }

  // copied texts (mirrored)
  const taken = new Set(job.texts.map((t) => t.id));
  let counter = 0;
  const newId = () => {
    do counter++; while (taken.has(`plug-text-${counter}`));
    return `plug-text-${counter}`;
  };
  const textCmds: JobCommand[] = [];
  for (const t of baseTexts) {
    const id = newId();
    const { id: _id, ...rest } = structuredClone(t) as TextItem;
    // positions are stock coordinates; the arc centre is the position, so it is mirrored the same way
    textCmds.push({ type: 'addText', id, patch: { ...rest, mirror: !t.mirror, surface: { from: 'stockTop' }, angle: 0 - t.angle, position: toPlug(baseStock(t.position)) } });
    refs.push({ kind: 'text', textId: id });
    if (t.font.kind === 'file' && blobs[t.font.blobId]) outBlobs[t.font.blobId] = blobs[t.font.blobId];
  }

  const tools = [vbit!, ...(clearTool ? [clearTool] : [])].filter((t, i, a) => a.findIndex((u) => u.id === t.id) === i);
  // tools: the same id is updated in place (keeping the plug's own number); a new one takes its number unless another tool has it
  const toolCmds: JobCommand[] = [];
  const numbers = new Set(job.tools.map((t) => t.number));
  for (const t of tools) {
    const { id, number, ...rest } = structuredClone(t);
    if (job.tools.some((u) => u.id === id)) {
      toolCmds.push({ type: 'updateTool', id, patch: rest });
    } else {
      let n = number;
      while (numbers.has(n)) n++;
      numbers.add(n);
      toolCmds.push({ type: 'addTool', tool: { ...rest, id, number: n } });
    }
  }
  const plugFields = { inlayDepth: D, startDepth: S, glueGap: g };
  job = applyCommands(job, [
    { type: 'setStock', stock: { mode: 'fixed', size: { ...plugBoard }, modelOffset } },
    ...toolCmds,
    ...textCmds,
  ]);
  if (existing) {
    job = applyCommands(job, job.operations.filter((o) => o.type === 'vplug').map((o) => ({
      type: 'updateOperation' as const, id: o.id, patch: { ...plugFields, toolId: vbit!.id, geometry: refs },
    })));
    const first = job.operations.find((o) => o.type === 'vplug')!;
    if (!job.operations.some((o) => o.enabled && o.type === 'vclear' && o.sourceId === first.id)) {
      let clearId = PLUG_CLEAR_ID;
      for (let n = 2; job.operations.some((o) => o.id === clearId); n++) clearId = `${PLUG_CLEAR_ID}-${n}`;
      job = applyCommands(job, addClearingCommands(job, first.id, clearTool?.id ?? null, clearId));
    }
  } else {
    job = applyCommands(job, [
      { type: 'addOperation', opType: 'vplug', toolId: vbit!.id, id: PLUG_ID },
      { type: 'updateOperation', id: PLUG_ID, patch: { ...plugFields, geometry: refs } },
    ]);
    job = applyCommands(job, addClearingCommands(job, PLUG_ID, clearTool?.id ?? null, PLUG_CLEAR_ID));
  }
  return { base: baseCmds, plug: { job, blobs: outBlobs }, H, plugBoard, warnings };
}
