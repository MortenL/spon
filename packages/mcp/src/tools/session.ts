import { basename } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Vec3 } from '@sponcam/core';
import { z } from 'zod';
import type { ToolContext } from '../context';
import { FileSession } from '../fileSession';
import { LiveSession } from '../live/liveSession';
import { dialectSchema, lengthUnitSchema, machinePresetSchema } from '../schemas';
import { type ImportOutcome, SessionError, type SessionInfo } from '../session';
import { NO_JOB } from '../state';
import { type Args, guarded, ok } from './result';

const size = (v: Vec3) => `${v.x.toFixed(2)} × ${v.y.toFixed(2)} × ${v.z.toFixed(2)}`;

export function statusText(info: SessionInfo): string {
  const model = info.model ? `${info.model.sourceName} (${info.model.format}${info.model.body !== null ? `, body ${info.model.body}` : ''})` : 'none';
  const head = info.kind === 'live'
    ? `Live tab: job "${info.name}" (${info.path ?? 'no file yet'})`
    : `Job "${info.name}" (${info.path ?? 'not saved yet'})`;
  return `${head}${info.dirty ? ', unsaved changes' : ''}. Model: ${model}. Operations: ${info.operations}.`;
}

function importText(name: string, o: Exclude<ImportOutcome, { status: 'error' }>): string {
  switch (o.status) {
    case 'imported':
      return [
        `Imported ${name} as a ${o.kind}, ${size(o.size)} mm (file units: ${o.units}).`,
        ...o.warnings.map((w) => `Warning: ${w}`),
        o.kind === 'drawing'
          ? 'This drawing is flat: set the stock thickness with apply_commands setStock (margin zBottom), then describe_geometry.'
          : 'Next: orient and set up with apply_commands if needed, then describe_geometry.',
      ].join('\n');
    case 'needsUnits':
      return `${name} does not say which units it uses. In file units it measures ${size(o.rawSize)}; ${o.suggested} looks likely. Call import_model again with units ("mm" or "in").`;
    case 'needsScale': {
      const mm = (dpi: number) => `${((o.rawSize.x * 25.4) / dpi).toFixed(1)} × ${((o.rawSize.y * 25.4) / dpi).toFixed(1)} mm`;
      return `${name} does not say how large it is: its content measures ${o.rawSize.x.toFixed(1)} × ${o.rawSize.y.toFixed(1)} px. `
        + `That is ${mm(96)} at 96 dpi (CSS, Inkscape, Affinity) or ${mm(72)} at 72 dpi (Illustrator). `
        + 'Call import_model again with svgDpi: 96 or 72, or svgWidth: <mm>.';
    }
    case 'needsBody':
      return [
        `${name} has ${o.bodies.length} bodies:`,
        ...o.bodies.map((b, i) => `${i}: ${b.name} — ${b.triangles} triangles, ${size(b.size)} mm`),
        `Call import_model again with body (the largest is ${o.suggested}).`,
      ].join('\n');
  }
}

const SECTIONS = ['operations', 'tools', 'stock', 'wcs', 'machine', 'post', 'model', 'programs', 'texts'] as const;

const newJobShape = {
  name: z.string().optional().describe('Job name'),
  machinePreset: machinePresetSchema.optional(),
  dialect: dialectSchema.optional().describe('Post-processor dialect (default grbl)'),
  discard: z.boolean().optional().describe('Drop unsaved changes to the current job'),
};
const openJobShape = { path: z.string().describe('A .spon file'), discard: z.boolean().optional().describe('Drop unsaved changes to the current job') };
const useLiveShape = { discard: z.boolean().optional().describe('Drop unsaved changes to the current file job') };
const saveJobShape = { path: z.string().optional().describe('Where to save; .spon is added. Required for the first save.') };
const importModelShape = {
  path: z.string().describe('An STL, STEP/STP, IGES/IGS, DXF or SVG file'),
  units: lengthUnitSchema.optional().describe('Only used when the file does not declare its units (STL, DXF without $INSUNITS)'),
  body: z.number().int().min(0).optional().describe('Which body of a multi-body STEP file'),
  svgDpi: z.union([z.literal(96), z.literal(72)]).optional().describe('SVG without real-world units: 96 (CSS, Inkscape, Affinity) or 72 (Illustrator) px per inch'),
  svgWidth: z.number().positive().optional().describe('SVG without real-world units: scale so the drawing is this wide (mm)'),
};
const getJobShape = { section: z.enum(SECTIONS).optional().describe('Return one part of the job instead of all of it') };
const importProgramShape = { path: z.string().describe('A G-code file (.nc, .ngc, .gcode, .tap, .cnc)') };

export function registerSessionTools(server: McpServer, ctx: ToolContext): void {
  const { state } = ctx;

  server.registerTool('status', {
    title: 'Status',
    description: 'The open job: its file, unsaved changes, model and number of operations.',
    inputSchema: {},
  }, guarded('status', async () => {
    const info = state.session ? await state.session.describe() : null;
    const bridge = ctx.deps.bridge;
    const tab = bridge?.tab ?? null;
    const liveTab = tab ? { title: tab.title, dirty: tab.dirty } : null;
    const bridgeText = bridge ? bridge.describe() : 'live bridge off';
    const lines = [
      info ? statusText(info) : NO_JOB,
      tab ? `A Spon tab is connected: "${tab.title}"${info?.kind === 'live' ? '' : ' (use_live_tab to drive it)'}.` : `No Spon tab connected (${bridgeText}).`,
    ];
    return ok(lines.join('\n'), { session: info, liveTab, bridge: bridgeText });
  }));

  server.registerTool('new_job', {
    title: 'New job',
    description: 'Start a new job in memory; save it with save_job. Refused while the open job has unsaved changes, unless discard is true.',
    inputSchema: newJobShape,
  }, guarded('new_job', async (a: Args<typeof newJobShape>) => {
    await state.ensureCanSwitch(a.discard);
    state.use(FileSession.create(a, ctx.sessionOptions()));
    const info = await state.requireSession().describe();
    return ok(`${statusText(info)}\nNext: import_model.`, { session: info });
  }));

  server.registerTool('open_job', {
    title: 'Open job',
    description: 'Open a .spon job file. Refused while the open job has unsaved changes, unless discard is true.',
    inputSchema: openJobShape,
  }, guarded('open_job', async (a: Args<typeof openJobShape>) => {
    await state.ensureCanSwitch(a.discard);
    state.use(await FileSession.open(ctx.resolvePath(a.path), ctx.sessionOptions()));
    const info = await state.requireSession().describe();
    return ok(`${statusText(info)}\nNext: describe_geometry or generate.`, { session: info });
  }));

  server.registerTool('use_live_tab', {
    title: 'Use live tab',
    description: 'Drive the job open in the Spon web app tab. Every change shows there and is one undo step. Refused while a file job has unsaved changes, unless discard is true.',
    inputSchema: useLiveShape,
  }, guarded('use_live_tab', async (a: Args<typeof useLiveShape>) => {
    const bridge = ctx.deps.bridge;
    if (!bridge || bridge.state.status !== 'listening') {
      throw new SessionError(`The live bridge is unavailable${bridge?.state.status === 'unavailable' ? `: ${bridge.state.reason}` : ''}`);
    }
    const tab = bridge.tab;
    if (!tab) throw new SessionError('No Spon tab is connected. In the Spon web app, click "Claude" in the status bar to connect.');
    await state.ensureCanSwitch(a.discard);
    if (!tab.open) throw new SessionError('Tab disconnected');
    state.use(new LiveSession(tab));
    const info = await state.requireSession().describe();
    return ok(`${statusText(info)}\nEvery change appears in the tab and is one undo step there.`, { session: info });
  }));

  server.registerTool('save_job', {
    title: 'Save job',
    description: 'Save the job as a .spon file (the model and programs are stored inside it).',
    inputSchema: saveJobShape,
  }, guarded('save_job', async (a: Args<typeof saveJobShape>) => {
    const path = await state.requireSession().save(a.path === undefined ? undefined : ctx.resolvePath(a.path));
    return ok(`Saved ${path}`, { path });
  }));

  server.registerTool('import_model', {
    title: 'Import model',
    description: 'Load a model into the job (replacing any model). Answers needsUnits, needsBody or needsScale (SVG) when it needs a choice; call again with it.',
    inputSchema: importModelShape,
  }, guarded('import_model', async (a: Args<typeof importModelShape>) => {
    const session = state.requireSession();
    const input = await ctx.readInput(a.path);
    const name = basename(input.path);
    if (a.svgDpi !== undefined && a.svgWidth !== undefined) throw new SessionError('Give svgDpi or svgWidth, not both');
    const svgScale = a.svgDpi !== undefined ? { dpi: a.svgDpi } : a.svgWidth !== undefined ? { width: a.svgWidth } : undefined;
    const outcome = await session.importModel({ fileName: name, bytes: input.bytes, units: a.units, body: a.body, svgScale });
    if (outcome.status === 'error') throw new SessionError(`Could not import ${input.path}: ${outcome.error}`);
    if (outcome.status === 'imported') state.handles.clear();
    return ok(importText(name, outcome), { ...outcome });
  }));

  server.registerTool('get_job', {
    title: 'Get job',
    description: 'The job as JSON (lengths in mm), or one section of it.',
    inputSchema: getJobShape,
  }, guarded('get_job', async (a: Args<typeof getJobShape>) => {
    const job = await state.requireSession().job();
    if (!a.section) return ok(JSON.stringify(job, null, 2), { job });
    const value = job[a.section];
    return ok(JSON.stringify(value, null, 2), { [a.section]: value });
  }));

  server.registerTool('import_program', {
    title: 'Import G-code program',
    description: "Add an existing G-code file to the job's program list (for analysis and playback in the web app).",
    inputSchema: importProgramShape,
  }, guarded('import_program', async (a: Args<typeof importProgramShape>) => {
    const session = state.requireSession();
    const input = await ctx.readInput(a.path);
    const program = await session.importProgram(basename(input.path), input.bytes);
    return ok(`Added the program ${program.name} (${program.id}) to the job.`, { program });
  }));
}
