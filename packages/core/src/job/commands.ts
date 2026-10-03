import { newOperation, OPERATION_LABELS } from '../cam/defaults';
import type { Operation, OperationPatch, OperationType, TabSettings } from '../cam/types';
import type { Vec3 } from '../geometry/vec3';
import type { PostSettings } from '../post/types';
import type { Tool } from '../tools/types';
import type { LengthUnit } from '../units/units';
import type { MachinePresetName } from './machine';
import { applyMachinePreset, type MachinePatch, moveProgram, removeProgram, setMachineProfile, setProgramInTimeline } from './programs';
import type { Job, Stock, Wcs } from './types';
import { layFlat, renameJob, resetOrientation, rotateQuarter, setDisplayUnits, setImportUnits, setStock, setWcs, setZSpin } from './update';

export type JobCommand =
  | { type: 'renameJob'; name: string }
  | { type: 'setDisplayUnits'; unit: LengthUnit }
  | { type: 'setImportUnits'; unit: LengthUnit }
  | { type: 'rotateQuarter'; axis: 'x' | 'y'; direction: 1 | -1 }
  | { type: 'layFlat'; rawNormal: Vec3 }
  | { type: 'setZSpin'; degrees: number }
  | { type: 'resetOrientation' }
  | { type: 'setStock'; stock: Stock }
  | { type: 'setWcs'; patch: Partial<Wcs> }
  | { type: 'setMachineProfile'; patch: MachinePatch }
  | { type: 'applyMachinePreset'; name: MachinePresetName }
  | { type: 'moveProgram'; id: string; delta: -1 | 1 }
  | { type: 'setProgramInTimeline'; id: string; inTimeline: boolean }
  | { type: 'removeProgram'; id: string }
  | { type: 'addOperation'; opType: OperationType; toolId: string | null; id?: string; name?: string }
  | { type: 'updateOperation'; id: string; patch: OperationPatch }
  | { type: 'removeOperation'; id: string }
  | { type: 'duplicateOperation'; id: string; newId?: string }
  | { type: 'moveOperation'; id: string; delta: -1 | 1 }
  | { type: 'setOperationEnabled'; id: string; enabled: boolean }
  | { type: 'addTool'; tool: Tool }
  | { type: 'updateTool'; id: string; patch: Partial<Omit<Tool, 'id'>> }
  | { type: 'removeTool'; id: string }
  | { type: 'setPost'; patch: Partial<PostSettings> }
  | { type: 'setTolerance'; tolerance: number };

export class CommandError extends Error {
  override name = 'CommandError';
}

const COMMON_KEYS = ['name', 'enabled', 'toolId', 'feeds', 'heights', 'geometry'];
const OP_KEYS: Readonly<Record<OperationType, readonly string[]>> = {
  profile: [...COMMON_KEYS, 'side', 'openSide', 'direction', 'stepdown', 'stockRadial', 'stockAxial', 'finishPass', 'entry', 'leads', 'tabs'],
  pocket: [...COMMON_KEYS, 'direction', 'stepdown', 'stepoverPct', 'stockRadial', 'stockAxial', 'finishWalls', 'finishFloor', 'entry'],
  drill: [...COMMON_KEYS, 'cycle', 'peck', 'dwellSeconds', 'diameterFilter'],
  face: [...COMMON_KEYS, 'area', 'overlap', 'pattern', 'angleDeg', 'stepoverPct', 'oneWay', 'direction', 'stepdown', 'finishPass', 'finishStepoverPct'],
  chamfer: [...COMMON_KEYS, 'side', 'openSide', 'direction', 'width', 'tipOffset', 'stepdown'],
  slot: [...COMMON_KEYS, 'strategy', 'width', 'direction', 'stepdown', 'stepoverPct', 'stockRadial', 'stockAxial', 'finishWalls', 'entry', 'trochoidal', 'squareEnds'],
  engrave: [...COMMON_KEYS, 'depthMode', 'depth', 'lineWidth', 'stepdown'],
  vcarve: [...COMMON_KEYS, 'maxDepth', 'stepdown'],
  vclear: [...COMMON_KEYS, 'sourceId', 'stepoverPct', 'stepdown', 'direction', 'entry'],
};
const ENUMS: Readonly<Record<string, Partial<Record<OperationType, readonly string[]>>>> = {
  side: { profile: ['outside', 'inside', 'on'], chamfer: ['auto', 'outside', 'inside'] },
  openSide: { profile: ['left', 'on', 'right'], chamfer: ['left', 'right'] },
  direction: { profile: ['climb', 'conventional'], pocket: ['climb', 'conventional'], face: ['climb', 'conventional'], chamfer: ['climb', 'conventional'], slot: ['climb', 'conventional'], vclear: ['climb', 'conventional'] },
  depthMode: { engrave: ['depth', 'width'] },
  area: { face: ['stock', 'picked'] },
  pattern: { face: ['zigzag', 'spiral'] },
  strategy: { slot: ['auto', 'toolWidth', 'wider', 'trochoidal'] },
  squareEnds: { slot: ['inside', 'endWall', 'dogbone'] },
};
const NESTED = new Set(['heights', 'feeds', 'entry', 'leads', 'tabs', 'trochoidal']);
const POSITIVE = ['stepdown', 'peck', 'width', 'depth', 'lineWidth'];
const NON_NEGATIVE = ['stockRadial', 'stockAxial', 'dwellSeconds', 'overlap', 'tipOffset'];

function findOp(job: Job, id: string): Operation {
  const op = job.operations.find((o) => o.id === id);
  if (!op) throw new CommandError(`No operation with id ${id}`);
  return op;
}

function checkTool(job: Job, toolId: string | null): Tool | null {
  if (toolId === null) return null;
  const tool = job.tools.find((t) => t.id === toolId);
  if (!tool) throw new CommandError(`No tool with id ${toolId} in this job`);
  return tool;
}

/** Two different tools with the same T number would post without a tool change between them. */
function checkToolNumber(job: Job, id: string, number: number): void {
  const other = job.tools.find((t) => t.id !== id && t.number === number);
  if (other) throw new CommandError(`T${number} is already used by "${other.name}" in this job`);
}

function checkTabs(t: Partial<TabSettings>): void {
  if ('spacing' in t && !((t.spacing as number) > 0 && Number.isFinite(t.spacing))) throw new CommandError('Tab spacing must be greater than 0');
  if ('count' in t && !((t.count as number) >= 1 && Number.isFinite(t.count))) throw new CommandError('Tab count must be at least 1');
  if ('width' in t && !((t.width as number) > 0 && Number.isFinite(t.width))) throw new CommandError('Tab width must be greater than 0');
}

function patchOperation(job: Job, op: Operation, patch: OperationPatch): Operation {
  const allowed = OP_KEYS[op.type];
  const next: Record<string, unknown> = { ...op };
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.includes(key)) throw new CommandError(`"${key}" does not apply to a ${op.type} operation`);
    const allowedValues = ENUMS[key]?.[op.type];
    if (allowedValues && !(key === 'squareEnds' && value === null) && !allowedValues.includes(value as string)) throw new CommandError(`${key} must be one of ${allowedValues.join(', ')}`);
    // a chamfer's stepdown may be 0 (one pass)
    if (key === 'stepdown' && op.type === 'chamfer') {
      if (!((value as number) >= 0 && Number.isFinite(value))) throw new CommandError('stepdown must not be negative');
    } else if (key === 'stepdown' && op.type === 'vcarve' && value === null) {
      // null = one pass
    } else if (POSITIVE.includes(key) && !((value as number) > 0 && Number.isFinite(value))) throw new CommandError(`${key} must be greater than 0`);
    if (key === 'maxDepth' && value !== null && !((value as number) > 0 && Number.isFinite(value))) throw new CommandError('maxDepth must be greater than 0');
    if (key === 'sourceId' && typeof value !== 'string') throw new CommandError('sourceId must be a string');
    if (NON_NEGATIVE.includes(key) && !((value as number) >= 0 && Number.isFinite(value))) throw new CommandError(`${key} must not be negative`);
    if ((key === 'stepoverPct' || key === 'finishStepoverPct') && !((value as number) > 0 && (value as number) <= 100)) throw new CommandError(`${key} must be in (0, 100]`);
    if (key === 'angleDeg' && !Number.isFinite(value)) throw new CommandError('angleDeg must be a finite number');
    if (key === 'toolId') checkTool(job, value as string | null);
    if (key === 'trochoidal') {
      const v = value as { stepPct?: number };
      if ('stepPct' in v && !((v.stepPct as number) > 0 && (v.stepPct as number) <= 100)) throw new CommandError('trochoidal.stepPct must be in (0, 100]');
    }
    if (key === 'tabs') checkTabs(value as Partial<TabSettings>);
    next[key] = NESTED.has(key) ? { ...(op as unknown as Record<string, object>)[key], ...(value as object) } : value;
  }
  return next as unknown as Operation;
}

const replaceOp = (job: Job, op: Operation): Job => ({ ...job, operations: job.operations.map((o) => (o.id === op.id ? op : o)) });

export function applyCommand(job: Job, c: JobCommand): Job {
  switch (c.type) {
    case 'renameJob': return renameJob(job, c.name);
    case 'setDisplayUnits': return setDisplayUnits(job, c.unit);
    case 'setImportUnits': return setImportUnits(job, c.unit);
    case 'rotateQuarter': return rotateQuarter(job, c.axis, c.direction);
    case 'layFlat': return layFlat(job, c.rawNormal);
    case 'setZSpin': return setZSpin(job, c.degrees);
    case 'resetOrientation': return resetOrientation(job);
    case 'setStock': return setStock(job, c.stock);
    case 'setWcs': return setWcs(job, c.patch);
    case 'setMachineProfile': return setMachineProfile(job, c.patch);
    case 'applyMachinePreset': return applyMachinePreset(job, c.name);
    case 'moveProgram': return moveProgram(job, c.id, c.delta);
    case 'setProgramInTimeline': return setProgramInTimeline(job, c.id, c.inTimeline);
    case 'removeProgram': return removeProgram(job, c.id);
    case 'addOperation': {
      const tool = checkTool(job, c.toolId);
      const id = c.id ?? crypto.randomUUID();
      if (job.operations.some((o) => o.id === id)) throw new CommandError(`An operation with id ${id} already exists`);
      const n = job.operations.filter((o) => o.type === c.opType).length + 1;
      const op = newOperation(c.opType, { id, name: c.name ?? `${OPERATION_LABELS[c.opType]} ${n}`, tool, modelKind: job.model?.kind ?? null });
      return { ...job, operations: [...job.operations, op] };
    }
    case 'updateOperation': return replaceOp(job, patchOperation(job, findOp(job, c.id), c.patch));
    case 'removeOperation': findOp(job, c.id); return { ...job, operations: job.operations.filter((o) => o.id !== c.id) };
    case 'duplicateOperation': {
      const op = findOp(job, c.id);
      const id = c.newId ?? crypto.randomUUID();
      if (job.operations.some((o) => o.id === id)) throw new CommandError(`An operation with id ${id} already exists`);
      const copy = { ...structuredClone(op), id, name: `${op.name} copy` };
      const i = job.operations.indexOf(op);
      return { ...job, operations: [...job.operations.slice(0, i + 1), copy, ...job.operations.slice(i + 1)] };
    }
    case 'moveOperation': {
      const i = job.operations.indexOf(findOp(job, c.id));
      const j = i + c.delta;
      if (j < 0 || j >= job.operations.length) return job;
      const operations = [...job.operations];
      [operations[i], operations[j]] = [operations[j], operations[i]];
      return { ...job, operations };
    }
    case 'setOperationEnabled': {
      const op = findOp(job, c.id);
      return op.enabled === c.enabled ? job : replaceOp(job, { ...op, enabled: c.enabled });
    }
    case 'addTool':
      if (job.tools.some((t) => t.id === c.tool.id)) throw new CommandError(`A tool with id ${c.tool.id} is already in the job`);
      checkToolNumber(job, c.tool.id, c.tool.number);
      return { ...job, tools: [...job.tools, structuredClone(c.tool)] };
    case 'updateTool': {
      const tool = checkTool(job, c.id)!;
      if (c.patch.number !== undefined) checkToolNumber(job, tool.id, c.patch.number);
      return { ...job, tools: job.tools.map((t) => (t === tool ? { ...t, ...c.patch, id: t.id } : t)) };
    }
    case 'removeTool': {
      checkTool(job, c.id);
      const user = job.operations.find((o) => o.toolId === c.id);
      if (user) throw new CommandError(`Tool is used by operation "${user.name}"`);
      return { ...job, tools: job.tools.filter((t) => t.id !== c.id) };
    }
    case 'setPost': return { ...job, post: { ...job.post, ...c.patch } };
    case 'setTolerance':
      if (!(c.tolerance > 0 && c.tolerance <= 1)) throw new CommandError('tolerance must be in (0, 1] mm');
      return { ...job, tolerance: c.tolerance };
  }
}

/** Applies commands in order, all or none; a failure names the command: `commands[2] updateOperation: …`. */
export function applyCommands(job: Job, commands: readonly JobCommand[]): Job {
  let next = job;
  commands.forEach((c, i) => {
    try {
      next = applyCommand(next, c);
    } catch (err) {
      throw new CommandError(`commands[${i}] ${c.type}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return next;
}
