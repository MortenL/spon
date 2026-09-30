import { basename } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from '../context';
import { toolSchema } from '../schemas';
import { type Args, guarded, ok } from './result';

const listShape = {
  query: z.string().optional().describe('Text in the name, vendor or product id'),
  type: z.enum(['flat', 'ball', 'bull', 'vbit', 'drill', 'chamfer']).optional(),
  diameter: z.number().optional().describe('Diameter in mm (±0.01)'),
};
const addShape = { tool: toolSchema.describe('A complete tool; lengths in mm, feeds in mm/min') };
const importShape = { path: z.string().describe('A Spon tool library .json, or a Fusion 360 library .json / .tools') };

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
    description: 'Import tools from a Spon library or a Fusion 360 library into the tool library. Taken T numbers are renumbered.',
    inputSchema: importShape,
  }, guarded('import_tool_library', async (a: Args<typeof importShape>) => {
    const input = await ctx.readInput(a.path);
    const result = await ctx.library().importFile(basename(input.path), input.bytes, input.path);
    const lines = [
      `Imported ${result.added} new and ${result.updated} updated tool(s) from ${input.path}.`,
      ...result.notes,
      ...result.skipped.map((s) => `Skipped ${s.name}: ${s.reason}`),
    ];
    return ok(lines.join('\n'), { ...result });
  }));
}
