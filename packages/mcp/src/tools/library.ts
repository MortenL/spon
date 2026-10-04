import { basename } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from '../context';
import { SessionError } from '../session';
import { isToolTableFile, listThreads } from '@sponcam/core';
import { lengthUnitSchema, toolSchema } from '../schemas';
import { type Args, guarded, ok } from './result';

const listShape = {
  query: z.string().optional().describe('Text in the name, vendor or product id'),
  type: z.enum(['flat', 'ball', 'bull', 'vbit', 'drill', 'chamfer', 'threadmill']).optional(),
  diameter: z.number().optional().describe('Diameter in mm (±0.01)'),
};
const threadsShape = { standard: z.enum(['iso-coarse', 'iso-fine', 'unc', 'unf']).optional().describe('Only this standard') };
const addShape = { tool: toolSchema.describe('A complete tool; lengths in mm, feeds in mm/min') };
const importShape = {
  path: z.string().describe('A Spon tool library .json, a Fusion 360 library .json / .tools, or a LinuxCNC tool table .tbl'),
  units: lengthUnitSchema.optional().describe("LinuxCNC tool tables (.tbl) only: the machine's units"),
};

/** Rounded for the text listing (the structured data keeps the raw values). */
const round = (x: number, decimals: number) => Number(x.toFixed(decimals));

export function registerLibraryTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool('list_tools', {
    title: 'List tools',
    description: "Tools in the open job, then the tool library. Use a tool's id or T number in add_operation.",
    inputSchema: listShape,
  }, guarded('list_tools', async (a: Args<typeof listShape>) => {
    const job = ctx.state.session ? await ctx.state.session.job() : null;
    const rows = [
      ...(job?.tools ?? []).map((t) => ({ source: 'job' as const, ...t })),
      ...(await ctx.library().list()).map((t) => ({ source: 'library' as const, ...t })),
    ];
    const q = a.query?.toLowerCase();
    const tools = rows.filter((t) =>
      (!q || [t.name, t.vendor ?? '', t.productId ?? ''].some((s) => s.toLowerCase().includes(q)))
      && (!a.type || t.type === a.type)
      && (a.diameter === undefined || Math.abs(t.diameter - a.diameter) <= 0.01));
    const text = tools.length
      ? tools.map((t) => `[${t.source}] T${t.number} ${t.name} — ${t.type} ⌀${t.diameter} mm, id ${t.id}${t.presets.length ? `; presets: ${t.presets.map((p) => p.name).join(', ')}` : ''}`).join('\n')
      : 'No tools match.';
    return ok(text, { tools });
  }));

  server.registerTool('list_threads', {
    title: 'List threads',
    description: 'The standard thread table (ISO coarse and fine, UNC, UNF): size, major diameter, pitch and flank angle, in mm. Use a row in a thread operation as params.thread { standard, size, majorDiameter, pitch, angle }.',
    inputSchema: threadsShape,
  }, guarded('list_threads', async (a: Args<typeof threadsShape>) => {
    const threads = listThreads(a.standard);
    return ok(threads.map((t) => `${t.standard} ${t.size}: ⌀${round(t.majorDiameter, 3)} mm, pitch ${round(t.pitch, 4)} mm, ${t.angle}°`).join('\n'), { threads });
  }));

  server.registerTool('add_library_tool', {
    title: 'Add library tool',
    description: 'Add a tool to the tool library, or replace the one with the same id. T numbers must stay unique.',
    inputSchema: addShape,
  }, guarded('add_library_tool', async (a: Args<typeof addShape>) => {
    await ctx.library().add(a.tool);
    return ok(`Added T${a.tool.number} ${a.tool.name} (${a.tool.id}) to the tool library.`, { tool: a.tool });
  }));

  server.registerTool('import_tool_library', {
    title: 'Import tool library',
    description: 'Import tools from a Spon library, a Fusion 360 library or a LinuxCNC tool table (.tbl, needs units) into the tool library. Taken T numbers are renumbered.',
    inputSchema: importShape,
  }, guarded('import_tool_library', async (a: Args<typeof importShape>) => {
    if (isToolTableFile(a.path) && !a.units) throw new SessionError('A LinuxCNC tool table has no units — call import_tool_library again with units: "mm" or "in"');
    const input = await ctx.readInput(a.path);
    const result = await ctx.library().importFile(basename(input.path), input.bytes, { label: input.path, units: a.units });
    const lines = [
      `Imported ${result.added} new and ${result.updated} updated tool(s) from ${input.path}.`,
      ...result.notes,
      ...result.skipped.map((s) => `Skipped ${s.name}: ${s.reason}`),
    ];
    return ok(lines.join('\n'), { ...result });
  }));
}
