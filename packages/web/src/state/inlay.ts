import {
  applyCommands, type BlobMap, FontStore, type InlaySettings, type JobCommand, makePlugJob, type MakeInlayInput, readSpon, SPON_EXTENSION, type Tool, writeSpon,
} from '@sponcam/core';
import { createElement } from 'react';
import { toast } from 'sonner';
import { defaultClearingTool } from '../inspector/vcarveInfo';
import { openFile, openViaPicker } from './documents';
import { downloadBytes, pickOpenFile, pickSaveHandle, safeFileName, supportsFsAccess, writeToHandle } from './fileio';
import { appStore } from './store';

const state = () => appStore.getState();

export type InlayValues = Pick<MakeInlayInput, 'inlayDepth' | 'startDepth' | 'glueGap' | 'margin' | 'plugBoard'>;
export type InlayOutcome = { status: 'done'; H: number } | { status: 'cancelled' } | { status: 'error'; message: string };

/** A FontStore holding the fonts of the job's texts, from the store's font bytes (main thread). */
export async function inlayFonts(): Promise<FontStore> {
  const fonts = new FontStore();
  await fonts.ensure(state().job, state().fontBytes);
  return fonts;
}

/** The blobs a .spon save of the current job carries. */
export function currentBlobs(): BlobMap {
  const { job, modelBytes, programBytes, fontBytes } = state();
  const blobs: BlobMap = { ...programBytes, ...fontBytes };
  if (job.model && modelBytes) blobs[job.model.blobId] = modelBytes;
  return blobs;
}

/** Picks an existing file: the File System Access picker, else a transient file input. Null on cancel. */
async function pickPlugFile(): Promise<{ file: File; handle: FileSystemFileHandle | null } | null> {
  if (supportsFsAccess()) return pickOpenFile();
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = SPON_EXTENSION;
    input.onchange = () => resolve(input.files?.[0] ? { file: input.files[0], handle: null } : null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function openPlugJob(handle: FileSystemFileHandle | null): void {
  void (async () => {
    try {
      if (handle) await openFile(await handle.getFile(), handle);
      else await openViaPicker();
    } catch (err) {
      toast.error(`Could not open the plug job: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();
}

/**
 * Makes (or updates) the plug job of a V-carve. Order: compute, save the plug file, and only then change the base
 * (one undo step), so a cancelled save leaves the job as it was.
 */
export async function runInlay(
  vcarveId: string, values: InlayValues, opts: { library: readonly Tool[]; update?: boolean },
): Promise<InlayOutcome> {
  try {
    const first = state().job;
    if (!first.operations.some((o) => o.id === vcarveId && o.type === 'vcarve')) return { status: 'error', message: 'Inlays need a V-carve operation' };

    let picked: { file: File; handle: FileSystemFileHandle | null } | null = null;
    let existing: { job: ReturnType<typeof readSpon>['job']; blobs: BlobMap } | undefined;
    if (opts.update) {
      picked = await pickPlugFile();
      if (!picked) return { status: 'cancelled' };
      existing = readSpon(new Uint8Array(await picked.file.arrayBuffer()));
    }
    const suggested = `${safeFileName(first.name)} plug${SPON_EXTENSION}`;
    const plugFileName = picked ? picked.file.name : suggested;

    // read the job again: it may have been edited while a picker was open
    const job = state().job;
    if (!job.operations.some((o) => o.id === vcarveId && o.type === 'vcarve')) return { status: 'error', message: 'Inlays need a V-carve operation' };
    // the clearing tool joins the job in the same batch, so compute against the job with it added
    const needsClearing = !job.operations.some((o) => o.enabled && o.type === 'vclear' && o.sourceId === vcarveId);
    const tool = needsClearing ? defaultClearingTool(job, opts.library) : null;
    const prelude: JobCommand[] = tool && !job.tools.some((t) => t.id === tool.id) ? [{ type: 'addTool', tool }] : [];
    const prepared = prelude.length ? applyCommands(job, prelude) : job;

    const result = makePlugJob(
      prepared, state().geometry, await inlayFonts(), currentBlobs(), vcarveId,
      { ...values, plugFileName, clearingToolId: tool?.id ?? null }, existing,
    );
    const bytes = writeSpon(result.plug.job, result.plug.blobs);

    let chosen: string;
    if (picked) {
      chosen = picked.file.name;
      if (picked.handle) {
        await writeToHandle(picked.handle, bytes);
        chosen = picked.handle.name;
      } else downloadBytes(chosen, bytes);
    } else if (supportsFsAccess()) {
      const handle = await pickSaveHandle(suggested);
      if (!handle) return { status: 'cancelled' };
      await writeToHandle(handle, bytes);
      chosen = handle.name;
      picked = { file: new File([], chosen), handle };
    } else {
      chosen = suggested;
      downloadBytes(chosen, bytes);
    }

    const inlay = result.base.flatMap((c) => (c.type === 'updateOperation' && c.id === vcarveId && c.patch.inlay ? [c.patch.inlay as InlaySettings] : []))[0];
    state().dispatchBatch([
      ...prelude, ...result.base,
      ...(inlay ? [{ type: 'updateOperation' as const, id: vcarveId, patch: { inlay: { ...inlay, plugFileName: chosen } } }] : []),
    ]);

    const handle = picked?.handle ?? null;
    toast.success('Plug job saved', {
      action: createElement('button', {
        'data-testid': 'inlay-open-plug', className: 'ml-auto rounded bg-primary px-2 py-1 text-xs text-primary-foreground', onClick: () => openPlugJob(handle),
      }, 'Open plug job'),
    });
    return { status: 'done', H: result.H };
  } catch (err) {
    // InlayError and CommandError messages are meant for the user; anything else (I/O, a corrupt file) shows its own message
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
