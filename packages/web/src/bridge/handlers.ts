import {
  type BridgeMethod, type BridgeParams, type BridgeResult, camContext, exportOutcome, fromBase64, modelSummary, runReport, type SessionInfo, toBase64,
} from '@sponcam/core';
import { toast } from 'sonner';
import { camCatalog, camPreviewSvg, waitForCamRun } from '../state/cam';
import { importModelOutcome, markSavedIfCurrent, saveToCurrentHandle, sponBytesForSave } from '../state/documents';
import { importProgramBytes } from '../state/programs';
import { appStore } from '../state/store';
import { importLibraryBytes, listLibraryTools, saveLibraryTool } from '../state/toolLibrary';

export type Handlers = { [M in BridgeMethod]: (params: BridgeParams<M>) => Promise<BridgeResult<M>> };

const s = () => appStore.getState();

function describe(): SessionInfo {
  const { job, dirty, fileHandle } = s();
  return { kind: 'live', name: job.name, path: fileHandle?.name ?? null, dirty, model: modelSummary(job.model), operations: job.operations.length };
}

async function currentReport() {
  const { job, run } = await waitForCamRun();
  return runReport(job, run);
}

/** What the tab does for each request from the MCP server. */
export const handlers: Handlers = {
  describe: async () => describe(),
  job: async () => s().job,
  apply: async ({ commands, label }) => {
    const before = s().job;
    s().dispatchBatch(commands);
    if (s().job !== before) toast(`Claude: ${label}`);
    return s().job;
  },
  importModel: ({ fileName, bytes, units, body, svgScale }) => importModelOutcome(fileName, fromBase64(bytes), { units, body, svgScale }),
  run: () => currentReport(),
  catalog: () => camCatalog(),
  boxes: async () => {
    const ctx = camContext(s().job, s().geometry);
    return { model: ctx.model, stock: ctx.stock };
  },
  previewSvg: (options) => camPreviewSvg(options),
  save: async () => ({ name: await saveToCurrentHandle() }),
  saveBytes: async () => {
    const { bytes, token } = sponBytesForSave();
    return { bytes: toBase64(bytes), token };
  },
  markSaved: async ({ token }) => ({ saved: markSavedIfCurrent(token) }),
  exportGcode: async () => exportOutcome(await currentReport()),
  importProgram: async ({ fileName, bytes }) => {
    const program = await importProgramBytes(fileName, fromBase64(bytes));
    if (!program) throw new Error(`Could not add ${fileName} to the job`);
    toast(`Claude: added the program ${fileName}`);
    return program;
  },
  'tools.list': () => listLibraryTools(),
  'tools.add': async ({ tool }) => {
    await saveLibraryTool(tool);
    return {};
  },
  'tools.import': ({ fileName, bytes, units }) => importLibraryBytes(fileName, fromBase64(bytes), units),
};
