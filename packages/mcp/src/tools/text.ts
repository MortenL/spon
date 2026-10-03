import { basename } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BUNDLED_FONTS } from '@sponcam/core';
import { z } from 'zod';
import type { ToolContext } from '../context';
import { textPatchSchema } from '../schemas';
import { type Args, guarded, ok } from './result';

const addTextShape = { id: z.string().optional().describe('Text id (default: generated)'), ...textPatchSchema.shape };
const updateTextShape = { id: z.string(), patch: textPatchSchema };
const removeTextShape = { id: z.string() };
const loadFontShape = { path: z.string().describe('An outline font file: .ttf, .otf or .woff (.woff2 is refused)') };

export function registerTextTools(server: McpServer, ctx: ToolContext): void {
  const { state } = ctx;

  server.registerTool('list_fonts', {
    title: 'List fonts',
    description: 'The bundled fonts (id, family, kind outline or singleLine) and the uploaded fonts used by the job’s texts, with the ids of the texts that use each.',
    inputSchema: {},
  }, guarded('list_fonts', async () => {
    const job = await state.requireSession().job();
    const byBlob = new Map<string, { blobId: string; name: string; usedBy: string[] }>();
    for (const t of job.texts) {
      if (t.font.kind !== 'file') continue;
      const entry = byBlob.get(t.font.blobId) ?? { blobId: t.font.blobId, name: t.font.name, usedBy: [] };
      entry.usedBy.push(t.id);
      byBlob.set(t.font.blobId, entry);
    }
    const bundled = BUNDLED_FONTS.map(({ id, family, kind }) => ({ id, family, kind }));
    const inJob = [...byBlob.values()];
    const lines = [
      'Bundled fonts:',
      ...bundled.map((f) => `- ${f.id}: ${f.family} (${f.kind})`),
      inJob.length ? 'Uploaded fonts in the job:' : 'No uploaded fonts in the job.',
      ...inJob.map((f) => `- ${f.name} (${f.blobId}), used by ${f.usedBy.join(', ')}`),
    ];
    return ok(lines.join('\n'), { bundled, inJob });
  }));

  server.registerTool('load_font', {
    title: 'Load font',
    description: 'Check a font file and keep it with the job. Returns a font ref to use as a text’s font (add_text or update_text); the font is saved in the .spon file once a text uses it.',
    inputSchema: loadFontShape,
  }, guarded('load_font', async (a: Args<typeof loadFontShape>) => {
    const session = state.requireSession();
    const input = await ctx.readInput(a.path);
    const font = await session.loadFont(basename(input.path), input.bytes);
    return ok(`Loaded ${font.name} as ${font.blobId}. Use this ref as a text's font.`, { font });
  }));

  server.registerTool('add_text', {
    title: 'Add text',
    description: 'Add a text to the job (stock coordinates, mm from the stock’s min corner). Machine it by giving an operation geometry [{ "kind": "text", "textId": <id> }].',
    inputSchema: addTextShape,
  }, guarded('add_text', async (a: Args<typeof addTextShape>) => {
    const { id: given, ...patch } = a;
    const id = given ?? crypto.randomUUID();
    const session = state.requireSession();
    if (!patch.position) {
      // like the web app: centre on the stock (its size / 2 in stock coordinates, whatever the work origin)
      const { stock } = await session.boxes();
      if (stock) patch.position = { x: (stock.max.x - stock.min.x) / 2, y: (stock.max.y - stock.min.y) / 2 };
    }
    await session.apply([{ type: 'addText', id, patch }], 'Add text');
    return ok(`Added the text ${id}. Next: add_operation with geometry [{ "kind": "text", "textId": "${id}" }].`, { id });
  }));

  server.registerTool('update_text', {
    title: 'Update text',
    description: 'Change fields of a text.',
    inputSchema: updateTextShape,
  }, guarded('update_text', async (a: Args<typeof updateTextShape>) => {
    await state.requireSession().apply([{ type: 'updateText', id: a.id, patch: a.patch }], 'Edit text');
    return ok(`Updated the text ${a.id}.`, { id: a.id });
  }));

  server.registerTool('remove_text', {
    title: 'Remove text',
    description: 'Remove a text. Operations that picked it keep the reference and report ref-missing ("The picked text no longer exists") until you pick other geometry.',
    inputSchema: removeTextShape,
  }, guarded('remove_text', async (a: Args<typeof removeTextShape>) => {
    await state.requireSession().apply([{ type: 'removeText', id: a.id }], 'Remove text');
    return ok(`Removed the text ${a.id}.`, { id: a.id });
  }));
}
