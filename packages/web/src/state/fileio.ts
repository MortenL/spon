import { SPON_MIME } from '@sponcam/core';

const JOB_TYPES: FilePickerAcceptType[] = [{ description: 'Spon job', accept: { [SPON_MIME]: ['.spon'] } }];
const OPEN_TYPES: FilePickerAcceptType[] = [
  { description: 'Spon job or model', accept: { 'application/octet-stream': ['.spon', '.stl', '.step', '.stp', '.iges', '.igs', '.dxf'] } },
];

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '_').trim();
  return cleaned || 'Untitled';
}

export function supportsFsAccess(): boolean {
  return typeof window.showSaveFilePicker === 'function' && typeof window.showOpenFilePicker === 'function';
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

/** Returns null when the user cancels the picker. */
export async function pickSaveHandle(suggestedName: string): Promise<FileSystemFileHandle | null> {
  try {
    return await window.showSaveFilePicker!({ suggestedName, types: JOB_TYPES });
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

export async function writeToHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(bytes.slice()); // slice() gives the ArrayBuffer-backed view the DOM typings expect
  await writable.close();
}

export function downloadBytes(fileName: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: SPON_MIME }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Returns null when the user cancels the picker. */
export async function pickOpenFile(): Promise<{ file: File; handle: FileSystemFileHandle } | null> {
  try {
    const [handle] = await window.showOpenFilePicker!({ types: OPEN_TYPES });
    return { file: await handle.getFile(), handle };
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}
