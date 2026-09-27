import { type ImportResult, importFile, importResultTransferables } from '@sponcam/core';
import * as Comlink from 'comlink';

const api = {
  import(fileName: string, bytes: Uint8Array): ImportResult {
    const result = importFile(fileName, bytes);
    return Comlink.transfer(result, importResultTransferables(result));
  },
};

export type ImportWorkerApi = typeof api;

Comlink.expose(api);
