import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type BBox, type Job, type JobCommand, OPERATION_LABELS } from '@sponcam/core';
import { z } from 'zod';
import type { ToolContext } from '../context';
import { catalogText, type HandledCatalog } from '../handles';
import { geometryRefSchema, jobCommandSchema, operationPatchSchema, operationTypeSchema } from '../schemas';
import { type JobSession, SessionError } from '../session';
import { type Args, guarded, ok } from './result';

const box = (b: BBox | null) =>
  (b ? `X ${b.min.x.toFixed(3)} to ${b.max.x.toFixed(3)}, Y ${b.min.y.toFixed(3)} to ${b.max.y.toFixed(3)}, Z ${b.min.z.toFixed(3)} to ${b.max.z.toFixed(3)}` : 'none');

/** Finds the tool for add_operation; a library tool is copied into the job by pushing an addTool command. */
async function resolveTool(job: Job, session: JobSession, tool: string | number, commands: JobCommand[]): Promise<string> {
  type Id = { id: string; number: number };
  const find = async (match: (t: Id) => boolean): Promise<string | null> => {
    const inJob = job.tools.find(match);
    if (inJob) return inJob.id;
    const fromLibrary = (await session.tools.list()).find(match);
    if (!fromLibrary) return null;
    commands.push({ type: 'addTool', tool: fromLibrary });
    return fromLibrary.id;
  };
  const found = await find(typeof tool === 'number' ? (t) => t.number === tool : (t) => t.id === tool);
  if (found) return found;
  // "T6" or "6" that is no tool id means T number 6
  const n = typeof tool === 'string' ? /^t?(\d+)$/i.exec(tool.trim()) : null;
  const byNumber = n ? await find((t) => t.number === Number(n[1])) : null;
  if (byNumber) return byNumber;
  throw new SessionError(`No tool ${typeof tool === 'number' ? `T${tool}` : tool} in the job or the library — see list_tools`);
}

const EMPTY = {
  faces: 'No up-facing horizontal faces in this orientation.',
  holes: 'No holes found.',
  slots: 'No slots found.',
  contours: 'No contours (only drawings, DXF or SVG, have contours).',
  all: 'Nothing to pick here (faces must be horizontal and face up).',
};
const describeShape = { filter: z.enum(['faces', 'holes', 'slots', 'contours']).optional().describe('Only list one kind of geometry') };
const applyShape = {
  commands: z.array(jobCommandSchema).min(1).describe('Job commands, applied in order, all or nothing'),
  label: z.string().optional().describe('A short description of the change'),
};
const addOperationShape = {
  type: operationTypeSchema,
  tool: z.union([z.string(), z.number().int()]).describe('A job tool id, a T number, or a library tool id (see list_tools). Library tools are copied into the job.'),
  geometry: z.array(z.union([z.string(), geometryRefSchema])).describe('Handles from describe_geometry (F1, F1.L0, H2, C3, S1) or full geometry refs. Required for every type except face, where an empty list faces the whole stock'),
  params: operationPatchSchema.omit({ geometry: true, toolId: true }).optional().describe('Operation parameters, e.g. { "side": "outside", "tabs": { "enabled": true } }'),
  name: z.string().optional(),
};

export function registerEditTools(server: McpServer, ctx: ToolContext): void {
  const { state } = ctx;

  server.registerTool('describe_geometry', {
    title: 'Describe geometry',
    description: 'What can be machined in the current orientation, with handles: faces F1… (top down), face loops F1.L0…, holes H1…, slots S1…, DXF contours C1…. Program coordinates in mm.',
    inputSchema: describeShape,
  }, guarded('describe_geometry', async (a: Args<typeof describeShape>) => {
    const session = state.requireSession();
    const catalog = await session.catalog();
    if (!catalog) throw new SessionError('The job has no model yet. Use import_model first.');
    const handled = state.handles.assign(catalog);
    const shown: HandledCatalog = a.filter ? { faces: [], holes: [], contours: [], slots: [], [a.filter]: handled[a.filter] } : handled;
    const { model, stock } = await session.boxes();
    const listing = catalogText(shown) || EMPTY[a.filter ?? 'all'];
    return ok(`Model box: ${box(model)}. Stock box: ${box(stock)}.\n${listing}`, { ...shown, modelBox: model, stockBox: stock });
  }));

  server.registerTool('apply_commands', {
    title: 'Apply commands',
    description: 'Edit the job with Spon job commands (orientation, stock, WCS, machine, post, tools, operations, programs). All apply, or none do.',
    inputSchema: applyShape,
  }, guarded('apply_commands', async (a: Args<typeof applyShape>) => {
    const session = state.requireSession();
    const before = await session.job();
    const after = await session.apply(a.commands, a.label);
    const changed = (Object.keys(after) as (keyof Job)[]).filter((k) => after[k] !== before[k]);
    const operations = after.operations.map((o) => ({ id: o.id, name: o.name, type: o.type, enabled: o.enabled }));
    const summary = changed.length ? `Applied ${a.commands.length} command(s). Changed: ${changed.join(', ')}.` : `Applied ${a.commands.length} command(s); nothing changed.`;
    return ok(summary, { changed, operations });
  }));

  server.registerTool('add_operation', {
    title: 'Add operation',
    description: 'Add a profile, pocket, drill, face, chamfer or slot operation with its tool, geometry and parameters in one step. Nothing changes if any part fails.',
    inputSchema: addOperationShape,
  }, guarded('add_operation', async (a: Args<typeof addOperationShape>) => {
    const session = state.requireSession();
    if (a.type !== 'face' && a.geometry.length === 0) throw new SessionError('Pick geometry for this operation');
    const refs = a.geometry.map((g) => state.handles.resolve(g));
    const job = await session.job();
    const commands: JobCommand[] = [];
    const toolId = await resolveTool(job, session, a.tool, commands);
    const id = crypto.randomUUID();
    commands.push(
      { type: 'addOperation', opType: a.type, toolId, id, ...(a.name ? { name: a.name } : {}) },
      { type: 'updateOperation', id, patch: { ...(a.params ?? {}), geometry: refs } },
    );
    const on = a.geometry.map((g) => (typeof g === 'string' ? g.trim().toUpperCase() : g.kind)).join(', ') || 'the stock';
    const after = await session.apply(commands, `Add ${OPERATION_LABELS[a.type]} on ${on}`);
    const op = after.operations.find((o) => o.id === id)!;
    return ok(`Added ${op.name} (${op.id}) on ${on} with tool ${toolId}. Next: generate.`, { operation: op });
  }));
}
