import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FontStore, InlayError, makePlugJob, readSpon, writeSpon } from '@sponcam/core';
import { z } from 'zod';
import type { ToolContext } from '../context';
import { loadModelGeometry } from '../fileSession';
import { writeFileAtomic } from '../files';
import { SessionError } from '../session';
import { type Args, guarded, ok } from './result';

const DEFAULTS = { inlayDepth: 4, startDepth: 2, glueGap: 0.5, margin: 10 };

const makeInlayShape = {
  operationId: z.string().describe('The base V-carve operation (id from get_job)'),
  inlayDepth: z.number().optional().describe('D: the pocket depth in the base, mm (default: 4)'),
  startDepth: z.number().optional().describe('S: how far the plug is cut below its flat top before it meets the pocket, mm (default: 2)'),
  glueGap: z.number().optional().describe('g: the space left at the pocket floor for glue, mm; smaller than D (default: 0.5)'),
  margin: z.number().optional().describe('Border around the shapes for the default plug board, mm (default: 10)'),
  plugBoard: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional().describe('Plug stock size in mm (default: the shapes grown by margin, H + 2 thick)'),
  plugPath: z.string().describe('Where to write the plug job (.spon)'),
  clearingToolId: z.string().nullable().optional().describe('Job tool id of a flat or bull-nose tool for the clearing (default: the first such tool in the job; null: none)'),
  update: z.boolean().optional().describe('Update an existing plug file at plugPath instead of refusing to overwrite it'),
};

export function registerInlayTools(server: McpServer, ctx: ToolContext): void {
  const { state } = ctx;

  server.registerTool('make_inlay', {
    title: 'Make inlay',
    description: 'Make an inlay from a V-carve: set the V-carve to depth D, add a clearing of its pocket here, and write a mirrored plug job to plugPath. Open the plug job with open_job. Pass update: true to refresh an existing plug file after editing the base.',
    inputSchema: makeInlayShape,
  }, guarded('make_inlay', async (a: Args<typeof makeInlayShape>) => {
    const session = state.requireSession();
    const plugPath = ctx.resolvePath(a.plugPath);
    let existing: { job: ReturnType<typeof readSpon>['job']; blobs: ReturnType<typeof readSpon>['blobs'] } | undefined;
    try {
      const bytes = new Uint8Array(await readFile(plugPath));
      if (!a.update) throw new SessionError(`${plugPath} exists; pass update: true to update it`);
      try {
        existing = readSpon(bytes);
      } catch (err) {
        throw new SessionError(`${plugPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } catch (err) {
      if (err instanceof SessionError) throw err;
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new SessionError(`Could not read ${plugPath}: ${err instanceof Error ? err.message : String(err)}`);
      if (a.update) throw new SessionError(`Could not read ${plugPath}: no such file`);
    }

    const { job: base, blobs } = readSpon(await session.spon());
    const geometry = await loadModelGeometry(base, blobs, ctx.deps.loadReader, 'The open job');
    const fonts = new FontStore();
    try {
      await fonts.ensure(base, blobs);
    } catch (err) {
      throw new SessionError(`Could not load a bundled font: ${err instanceof Error ? err.message : String(err)}`);
    }
    const carve = base.operations.find((o) => o.id === a.operationId);
    const stored = carve?.type === 'vcarve' ? carve.inlay : undefined;
    const clearingToolId = a.clearingToolId !== undefined ? a.clearingToolId
      : base.tools.find((t) => t.type === 'flat')?.id ?? base.tools.find((t) => t.type === 'bull')?.id ?? null;
    let result;
    try {
      result = makePlugJob(base, geometry, fonts, blobs, a.operationId, {
        inlayDepth: a.inlayDepth ?? (carve?.type === 'vcarve' && stored ? carve.maxDepth ?? DEFAULTS.inlayDepth : DEFAULTS.inlayDepth),
        startDepth: a.startDepth ?? stored?.startDepth ?? DEFAULTS.startDepth,
        glueGap: a.glueGap ?? stored?.glueGap ?? DEFAULTS.glueGap,
        margin: a.margin ?? stored?.margin ?? DEFAULTS.margin,
        ...(a.plugBoard ? { plugBoard: a.plugBoard } : {}),
        plugFileName: basename(plugPath),
        clearingToolId,
      }, existing);
    } catch (err) {
      if (err instanceof InlayError) throw new SessionError(err.message);
      throw err;
    }
    // plug file first: a bad path then leaves the base job untouched
    try {
      await writeFileAtomic(plugPath, writeSpon(result.plug.job, result.plug.blobs));
    } catch (err) {
      throw new SessionError(`Could not write ${plugPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      await session.apply(result.base, 'Make inlay');
    } catch (err) {
      throw new SessionError(`The plug file ${plugPath} was written, but the base job was not changed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const data = { plugPath, H: result.H, plugBoard: result.plugBoard, baseChanges: result.base };
    return ok(`${existing ? 'Updated' : 'Wrote'} the plug job ${plugPath} (plug height ${result.H.toFixed(2)} mm, board ${result.plugBoard.x.toFixed(1)} x ${result.plugBoard.y.toFixed(1)} x ${result.plugBoard.z.toFixed(1)} mm). The base V-carve is now ${result.base.length} change(s) richer. Next: save this job if you want to keep the pocket, then open_job the plug job.`, data);
  }));
}
