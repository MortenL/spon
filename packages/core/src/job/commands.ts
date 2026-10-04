import { newOperation, OPERATION_LABELS } from '../cam/defaults';
import type { Operation, OperationPatch, OperationType, TabSettings } from '../cam/types';
import type { Vec3 } from '../geometry/vec3';
import { type ThreadSpec, type ThreadStandard, threadRow } from '../thread/table';
import type { PostSettings } from '../post/types';
import { BUNDLED_FONT_IDS, newTextItem, TEXT_ANCHORS, type TextItem, type TextPatch } from '../text/types';
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
  | { type: 'addText'; id?: string; patch?: TextPatch }
  | { type: 'updateText'; id: string; patch: TextPatch }
  | { type: 'removeText'; id: string }
  | { type: 'moveText'; id: string; delta: -1 | 1 }
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
  vcarve: [...COMMON_KEYS, 'maxDepth', 'stepdown', 'inlay'],
  vplug: [...COMMON_KEYS, 'inlayDepth', 'startDepth', 'glueGap', 'stepdown'],
  thread: [...COMMON_KEYS, 'kind', 'thread', 'hand', 'length', 'allowance', 'passes', 'springPass', 'direction', 'feedCompensation'],
  vclear: [...COMMON_KEYS, 'sourceId', 'stepoverPct', 'stepdown', 'direction', 'entry'],
};
const ENUMS: Readonly<Record<string, Partial<Record<OperationType, readonly string[]>>>> = {
  side: { profile: ['outside', 'inside', 'on'], chamfer: ['auto', 'outside', 'inside'] },
  openSide: { profile: ['left', 'on', 'right'], chamfer: ['left', 'right'] },
  direction: { profile: ['climb', 'conventional'], pocket: ['climb', 'conventional'], face: ['climb', 'conventional'], chamfer: ['climb', 'conventional'], slot: ['climb', 'conventional'], vclear: ['climb', 'conventional'], thread: ['climb', 'conventional'] },
  depthMode: { engrave: ['depth', 'width'] },
  area: { face: ['stock', 'picked'] },
  pattern: { face: ['zigzag', 'spiral'] },
  strategy: { slot: ['auto', 'toolWidth', 'wider', 'trochoidal'] },
  squareEnds: { slot: ['inside', 'endWall', 'dogbone'] },
  kind: { thread: ['internal', 'external'] },
  hand: { thread: ['right', 'left'] },
};
const NESTED = new Set(['heights', 'feeds', 'entry', 'leads', 'tabs', 'trochoidal']);
const POSITIVE = ['stepdown', 'peck', 'width', 'depth', 'lineWidth', 'inlayDepth', 'startDepth', 'glueGap', 'length'];
const NON_NEGATIVE = ['stockRadial', 'stockAxial', 'dwellSeconds', 'overlap', 'tipOffset'];

function findOp(job: Job, id: string): Operation {
  const op = job.operations.find((o) => o.id === id);
  if (!op) throw new CommandError(`No operation with id ${id}`);
  return op;
}

const TEXT_KEYS = ['name', 'text', 'font', 'size', 'letterSpacing', 'lineSpacing', 'align', 'fit', 'position', 'anchor', 'angle', 'mirror', 'arc', 'surface'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const positive = (v: unknown): boolean => typeof v === 'number' && v > 0 && Number.isFinite(v);

function findText(job: Job, id: string): TextItem {
  const t = job.texts.find((x) => x.id === id);
  if (!t) throw new CommandError(`No text with id ${id}`);
  return t;
}

function patchText(text: TextItem, patch: TextPatch): TextItem {
  const next: Record<string, unknown> = { ...text };
  for (const [key, value] of Object.entries(patch) as [string, unknown][]) {
    if (key === 'id') throw new CommandError('"id" cannot be changed');
    if (!TEXT_KEYS.includes(key)) throw new CommandError(`"${key}" is not a text setting`);
    if (key === 'size' || key === 'lineSpacing') {
      if (!positive(value)) throw new CommandError(`${key} must be greater than 0`);
    } else if (key === 'letterSpacing' || key === 'angle') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new CommandError(`${key} must be a finite number`);
    } else if (key === 'align') {
      if (value !== 'left' && value !== 'center' && value !== 'right') throw new CommandError('align must be one of left, center, right');
    } else if (key === 'anchor') {
      if (!TEXT_ANCHORS.includes(value as never)) throw new CommandError(`anchor must be one of ${TEXT_ANCHORS.join(', ')}`);
    } else if (key === 'text') {
      if (typeof value !== 'string') throw new CommandError('text must be a string');
    } else if (key === 'name') {
      if (typeof value !== 'string' || value.trim() === '') throw new CommandError('name must not be empty');
    } else if (key === 'mirror') {
      if (typeof value !== 'boolean') throw new CommandError('mirror must be true or false');
    } else if (key === 'position') {
      if (!isObj(value) || typeof value.x !== 'number' || typeof value.y !== 'number' || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
        throw new CommandError('position.x and position.y must be finite numbers');
      }
    } else if (key === 'fit') {
      if (value !== null) {
        if (!isObj(value) || !positive(value.width)) throw new CommandError('fit.width must be greater than 0');
        if (value.height !== null && !positive(value.height)) throw new CommandError('fit.height must be greater than 0');
      }
    } else if (key === 'arc') {
      if (value !== null) {
        if (!isObj(value) || !positive(value.radius)) throw new CommandError('arc.radius must be greater than 0');
        if (value.side !== 'outside' && value.side !== 'inside') throw new CommandError('arc.side must be one of outside, inside');
      }
    } else if (key === 'font') {
      const ok = isObj(value) && ((value.kind === 'bundled' && BUNDLED_FONT_IDS.includes(value.id as never)) || (value.kind === 'file' && typeof value.blobId === 'string' && typeof value.name === 'string'));
      if (!ok) throw new CommandError(`font must be a bundled font (${BUNDLED_FONT_IDS.join(', ')}) or a file with blobId and name`);
    } else if (key === 'surface') {
      if (!isObj(value) || (value.from !== 'stockTop' && value.from !== 'face')) throw new CommandError('surface.from must be one of stockTop, face');
      if (value.from === 'face' && !isObj(value.face)) throw new CommandError('surface.face is required when surface.from is face');
    }
    next[key] = structuredClone(value);
  }
  return next as unknown as TextItem;
}

const replaceText = (job: Job, text: TextItem): Job => ({ ...job, texts: job.texts.map((t) => (t.id === text.id ? text : t)) });

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

function checkInlay(v: unknown): void {
  if (!isObj(v)) throw new CommandError('inlay must be an object');
  if (!positive(v.startDepth)) throw new CommandError('inlay.startDepth must be greater than 0');
  if (!positive(v.glueGap)) throw new CommandError('inlay.glueGap must be greater than 0');
  if (typeof v.margin !== 'number' || !(v.margin >= 0) || !Number.isFinite(v.margin)) throw new CommandError('inlay.margin must be 0 or more');
  const b = v.plugBoard;
  if (!isObj(b) || !positive(b.x) || !positive(b.y) || !positive(b.z)) throw new CommandError('inlay.plugBoard must be greater than 0 in x, y and z');
  if (typeof v.plugFileName !== 'string') throw new CommandError('inlay.plugFileName must be a string');
}

const THREAD_STANDARDS = ['iso-coarse', 'iso-fine', 'unc', 'unf', 'custom'] as const;

/** Validates a thread spec; a table standard takes its dimensions from the table. */
function checkThread(v: unknown): ThreadSpec {
  if (!isObj(v)) throw new CommandError('thread must be an object');
  const standard = v.standard as ThreadStandard;
  if (!THREAD_STANDARDS.includes(standard)) throw new CommandError(`thread.standard must be one of ${THREAD_STANDARDS.join(', ')}`);
  if (standard !== 'custom') {
    const row = typeof v.size === 'string' ? threadRow(standard, v.size) : null;
    if (!row) throw new CommandError(`Unknown thread size ${String(v.size)}`);
    return { standard, size: row.size, majorDiameter: row.majorDiameter, pitch: row.pitch, angle: row.angle };
  }
  if (v.size !== null) throw new CommandError('A custom thread has no size');
  if (!positive(v.majorDiameter)) throw new CommandError('thread.majorDiameter must be greater than 0');
  if (!positive(v.pitch)) throw new CommandError('thread.pitch must be greater than 0');
  if (typeof v.angle !== 'number' || !(v.angle > 0 && v.angle < 180)) throw new CommandError('thread.angle must be between 0 and 180 degrees');
  return { standard, size: null, majorDiameter: v.majorDiameter as number, pitch: v.pitch as number, angle: v.angle };
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
    } else if (key === 'stepdown' && (op.type === 'vcarve' || op.type === 'vplug') && value === null) {
      // null = one pass
    } else if (POSITIVE.includes(key) && !((value as number) > 0 && Number.isFinite(value))) throw new CommandError(`${key} must be greater than 0`);
    if (key === 'maxDepth' && value !== null && !((value as number) > 0 && Number.isFinite(value))) throw new CommandError('maxDepth must be greater than 0');
    if (key === 'sourceId' && typeof value !== 'string') throw new CommandError('sourceId must be a string');
    if (NON_NEGATIVE.includes(key) && !((value as number) >= 0 && Number.isFinite(value))) throw new CommandError(`${key} must not be negative`);
    if ((key === 'stepoverPct' || key === 'finishStepoverPct') && !((value as number) > 0 && (value as number) <= 100)) throw new CommandError(`${key} must be in (0, 100]`);
    if (key === 'angleDeg' && !Number.isFinite(value)) throw new CommandError('angleDeg must be a finite number');
    if (key === 'passes' && !(Number.isInteger(value) && (value as number) >= 1)) throw new CommandError('passes must be a whole number, 1 or more');
    if (key === 'allowance' && !(typeof value === 'number' && Number.isFinite(value))) throw new CommandError('allowance must be a finite number');
    if ((key === 'springPass' || key === 'feedCompensation') && typeof value !== 'boolean') throw new CommandError(`${key} must be true or false`);
    if (key === 'thread') { next.thread = checkThread(value); continue; }
    if (key === 'toolId') checkTool(job, value as string | null);
    if (key === 'trochoidal') {
      const v = value as { stepPct?: number };
      if ('stepPct' in v && !((v.stepPct as number) > 0 && (v.stepPct as number) <= 100)) throw new CommandError('trochoidal.stepPct must be in (0, 100]');
    }
    if (key === 'tabs') checkTabs(value as Partial<TabSettings>);
    if (key === 'inlay') {
      // undefined or null removes the inlay settings
      if (value === undefined || value === null) { delete next.inlay; continue; }
      checkInlay(value);
    }
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
    case 'addText': {
      const id = c.id ?? crypto.randomUUID();
      if (job.texts.some((t) => t.id === id)) throw new CommandError(`A text with id ${id} already exists`);
      // Commands cannot see model geometry: an auto stock centres at the origin until the app re-centres it.
      const position = job.stock.mode === 'fixed' ? { x: job.stock.size.x / 2, y: job.stock.size.y / 2 } : { x: 0, y: 0 };
      const text = patchText(newTextItem(id, `Text ${job.texts.length + 1}`, position), c.patch ?? {});
      return { ...job, texts: [...job.texts, text] };
    }
    case 'updateText': return replaceText(job, patchText(findText(job, c.id), c.patch));
    case 'removeText': findText(job, c.id); return { ...job, texts: job.texts.filter((t) => t.id !== c.id) };
    case 'moveText': {
      const i = job.texts.indexOf(findText(job, c.id));
      const j = i + c.delta;
      if (j < 0 || j >= job.texts.length) return job;
      const texts = [...job.texts];
      [texts[i], texts[j]] = [texts[j], texts[i]];
      return { ...job, texts };
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
