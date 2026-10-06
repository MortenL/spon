import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, win32 } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BBox } from '@sponcam/core';
import { z } from 'zod';
import type { ToolContext } from '../context';
import { SessionError } from '../session';
import { type Args, guarded, message, ok } from './result';

export const MAX_GCODE_LINES = 400;

/** File names come from the tab over the socket: only a plain file name may be joined onto the output folder. */
export function safeOutputName(name: string): string {
  if (!name || name.includes('..') || basename(name) !== name || win32.basename(name) !== name) throw new SessionError(`Refusing to write ${name}: not a plain file name`);
  return name;
}

const fmtTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
};
const range = (b: BBox) =>
  `X ${b.min.x.toFixed(3)} to ${b.max.x.toFixed(3)}, Y ${b.min.y.toFixed(3)} to ${b.max.y.toFixed(3)}, Z ${b.min.z.toFixed(3)} to ${b.max.z.toFixed(3)}`;
const union = (a: BBox | null, b: BBox): BBox => (a
  ? {
    min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
    max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
  }
  : b);

function tabsLine(tabs: { t: number[]; manual: boolean }[], skipped: number): string {
  const n = tabs.reduce((sum, c) => sum + c.t.length, 0);
  const manual = tabs.filter((c) => c.manual).length;
  return `${n} on ${tabs.length} contour${tabs.length === 1 ? '' : 's'}${manual ? ` (${manual} manual)` : ''}${skipped ? `, ${skipped} skipped` : ''}`;
}

const previewShape = {
  view: z.enum(['top', 'front', 'iso']).optional().describe('Default top'),
  operations: z.array(z.string()).optional().describe('Operation ids to show (default: all enabled)'),
  size: z.number().int().min(256).max(2048).optional().describe('Long edge in pixels (default 1024)'),
};
const gcodeShape = {
  file: z.string().optional().describe('A file name from generate (default: the first)'),
  lines: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional().describe(`First and last line, 1-based; at most ${MAX_GCODE_LINES} lines per call`),
};
const exportShape = { dir: z.string().describe('Folder for the posted files (created if missing)') };

export function registerOutputTools(server: McpServer, ctx: ToolContext): void {
  const { state } = ctx;

  server.registerTool('generate', {
    title: 'Generate',
    description: 'Generate and post every operation. Returns each operation status and diagnostics, the posted files, cycle time, toolpath extents against the stock, and whether export is possible.',
    inputSchema: {},
  }, guarded('generate', async () => {
    const session = state.requireSession();
    const job = await session.job();
    const run = await session.run();
    const { stock } = await session.boxes();
    const results = new Map(run.results.map((r) => [r.operationId, r]));
    const operations = job.operations.map((op) => {
      const r = results.get(op.id);
      const diagnostics = (r?.diagnostics ?? []).map(({ severity, code, message: text }) => ({ severity, code, message: text }));
      const status = !op.enabled ? 'disabled' : diagnostics.some((d) => d.severity === 'error') ? 'error' : diagnostics.some((d) => d.severity === 'warning') ? 'warning' : 'ok';
      const tabs = r?.tabs ?? [];
      const tabsSkipped = diagnostics.filter((d) => d.code === 'tab-skipped').reduce((n, d) => n + (Number.parseInt(d.message, 10) || 0), 0);
      return { id: op.id, name: op.name, type: op.type, status, diagnostics, heights: r?.heights ?? null, tabs, tabsSkipped };
    });
    const files = run.files.map((f) => ({ name: f.name, lines: f.lineCount, tools: f.tools, seconds: f.seconds }));
    const cycleSeconds = files.reduce((t, f) => t + f.seconds, 0);
    let extents: BBox | null = null;
    for (const f of run.files) if (f.extents) extents = union(extents, f.extents);
    const verdict = run.export;
    const lines = [
      ...operations.map((o) => `${o.status.toUpperCase()} ${o.name} (${o.type}, ${o.id})${o.tabs.length || o.tabsSkipped ? `
  tabs: ${tabsLine(o.tabs, o.tabsSkipped)}` : ''}${o.diagnostics.map((d) => `\n  ${d.severity}: ${d.message}`).join('')}`),
      ...files.map((f) => `${f.name}: ${f.lines} lines, ${f.tools.length ? `T${f.tools.join(', T')}` : 'no tool change'}, ${fmtTime(f.seconds)}`),
      `Cycle time ${fmtTime(cycleSeconds)}.`,
      extents ? `Toolpath extents: ${range(extents)}.` : 'No toolpaths.',
      stock ? `Stock: ${range(stock)}.` : 'No stock (import a model).',
      verdict.errors.length
        ? `Export blocked by ${verdict.errors.length} error(s):\n${verdict.errors.map((e) => `- ${e}`).join('\n')}`
        : `Ready to export${verdict.warnings.length ? ` with ${verdict.warnings.length} warning(s) to tell the user about` : ''}.`,
    ];
    return ok(lines.join('\n'), { operations, files, cycleSeconds, extents, stock, export: verdict });
  }));

  server.registerTool('render_preview', {
    title: 'Render preview',
    description: 'A PNG line drawing of the stock, model and toolpaths: feeds solid, rapids dashed, one colour per operation, red hatching where the tool cannot reach.',
    inputSchema: previewShape,
  }, guarded('render_preview', async (a: Args<typeof previewShape>) => {
    const session = state.requireSession();
    const job = await session.job();
    for (const id of a.operations ?? []) if (!job.operations.some((o) => o.id === id)) throw new SessionError(`No operation with id ${id}`);
    const view = a.view ?? 'top';
    const png = await ctx.deps.rasterize(await session.previewSvg({ view, size: a.size, operations: a.operations }));
    const drawn = job.operations.filter((o) => o.enabled && (!a.operations || a.operations.includes(o.id))).map((o) => o.id);
    return {
      content: [
        { type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' },
        { type: 'text', text: `${view} view of "${job.name}" with ${drawn.length} operation(s).` },
      ],
      structuredContent: { view, operations: drawn },
    };
  }));

  server.registerTool('get_gcode', {
    title: 'Get G-code',
    description: `Posted G-code text, at most ${MAX_GCODE_LINES} lines per call.`,
    inputSchema: gcodeShape,
  }, guarded('get_gcode', async (a: Args<typeof gcodeShape>) => {
    const run = await state.requireSession().run();
    if (!run.files.length) throw new SessionError('Nothing has been posted: add operations with geometry first');
    const file = a.file ? run.files.find((f) => f.name === a.file) : run.files[0];
    if (!file) throw new SessionError(`No posted file ${a.file}. Files: ${run.files.map((f) => f.name).join(', ')}`);
    const all = file.text.split('\n');
    if (all.at(-1) === '') all.pop();
    if (a.lines && a.lines[1] < a.lines[0]) throw new SessionError('lines must be [from, to] with from <= to');
    const from = a.lines?.[0] ?? 1;
    if (from > all.length) throw new SessionError(`${file.name} has ${all.length} lines`);
    const to = Math.min(all.length, a.lines?.[1] ?? Infinity, from + MAX_GCODE_LINES - 1);
    const text = all.slice(from - 1, to).join('\n');
    return ok(`${file.name}, lines ${from} to ${to} of ${all.length}:\n${text}`, { file: file.name, from, to, total: all.length, text });
  }));

  server.registerTool('export_gcode', {
    title: 'Export G-code',
    description: 'Write the posted files into a folder. Refused while there are errors; warnings are returned and must be passed on to the user.',
    inputSchema: exportShape,
  }, guarded('export_gcode', async (a: Args<typeof exportShape>) => {
    const outcome = await state.requireSession().exportGcode();
    if (!outcome.ok) {
      const warnings = outcome.warnings.length ? ['Warnings:', ...outcome.warnings.map((w) => `- ${w}`)] : [];
      throw new SessionError(['Export blocked by errors:', ...outcome.errors.map((e) => `- ${e}`), ...warnings].join('\n'));
    }
    const dir = ctx.resolvePath(a.dir);
    try {
      await mkdir(dir, { recursive: true });
    } catch (err) {
      throw new SessionError(`Could not create ${dir}: ${message(err)}`);
    }
    const paths: string[] = [];
    for (const f of outcome.files) {
      const path = join(dir, safeOutputName(f.name));
      try {
        await writeFile(path, f.text);
      } catch (err) {
        throw new SessionError(`Could not write ${path}: ${message(err)}`);
      }
      paths.push(path);
    }
    const lines = [`Wrote ${paths.length} file(s):`, ...paths.map((p) => `- ${p}`)];
    if (outcome.warnings.length) lines.push('Tell the user about these warnings:', ...outcome.warnings.map((w) => `- ${w}`));
    return ok(lines.join('\n'), { paths, warnings: outcome.warnings });
  }));
}
