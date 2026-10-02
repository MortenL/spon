import {
  exportToolLibrary, type LibraryImportResult, importToolFile, type LengthUnit, type OperationType, sortTools, starterLibrary, type Tool, validateTool,
} from '@sponcam/core';
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

interface ToolDb extends DBSchema {
  tools: { key: string; value: Tool };
  meta: { key: string; value: boolean };
}

let connection: Promise<IDBPDatabase<ToolDb>> | null = null;
const db = () =>
  (connection ??= openDB<ToolDb>('spon-tools', 1, {
    upgrade(d) {
      d.createObjectStore('tools');
      d.createObjectStore('meta');
    },
  }).catch((err: unknown) => {
    // Don't cache a failed open forever: let the next call retry.
    connection = null;
    throw err;
  }));

export const toolLibraryStore = createStore<{ tools: Tool[]; loaded: boolean }>(() => ({ tools: [], loaded: false }));
export const useToolLibrary = (): Tool[] => useStore(toolLibraryStore, (s) => s.tools);

async function refresh(): Promise<void> {
  const all = await (await db()).getAll('tools');
  toolLibraryStore.setState({ tools: sortTools(all), loaded: true });
}

/** Seeds the starter library on first run only; later calls just refresh the in-memory store from IndexedDB. */
export async function loadToolLibrary(): Promise<void> {
  const d = await db();
  if (!(await d.get('meta', 'seeded'))) {
    const tx = d.transaction(['tools', 'meta'], 'readwrite');
    for (const t of starterLibrary()) await tx.objectStore('tools').put(t, t.id);
    await tx.objectStore('meta').put(true, 'seeded');
    await tx.done;
  }
  await refresh();
}

/** Thrown when a saved tool's T number belongs to another library tool. */
export class ToolNumberTakenError extends Error {
  override name = 'ToolNumberTakenError';
}

export async function saveLibraryTool(tool: Tool): Promise<void> {
  if (!validateTool(tool)) throw new Error('The tool has invalid values');
  const d = await db();
  const other = (await d.getAll('tools')).find((t) => t.id !== tool.id && t.number === tool.number);
  if (other) throw new ToolNumberTakenError(`T${tool.number} is already used by "${other.name}"`);
  await d.put('tools', tool, tool.id);
  await refresh();
}

export async function deleteLibraryTool(id: string): Promise<void> {
  await (await db()).delete('tools', id);
  await refresh();
}

/** Restores the starter tools (overwriting edits to them); user tools are kept. */
export async function resetStarterLibrary(): Promise<void> {
  const tx = (await db()).transaction('tools', 'readwrite');
  for (const t of starterLibrary()) await tx.store.put(t, t.id);
  await tx.done;
  await refresh();
}

export async function listLibraryTools(): Promise<Tool[]> {
  return sortTools(await (await db()).getAll('tools'));
}

export async function importLibraryBytes(fileName: string, bytes: Uint8Array, units?: LengthUnit): Promise<LibraryImportResult> {
  const d = await db();
  const result = importToolFile(await d.getAll('tools'), bytes, fileName, units);
  const tx = d.transaction('tools', 'readwrite');
  for (const t of result.incoming) await tx.store.put(t, t.id);
  await tx.done;
  await refresh();
  return { added: result.added, updated: result.updated, skipped: result.skipped, notes: result.notes };
}

export async function importLibraryFile(file: File, units?: LengthUnit): ReturnType<typeof importLibraryBytes> {
  return importLibraryBytes(file.name, new Uint8Array(await file.arrayBuffer()), units);
}

export function exportLibraryFile(): void {
  const blob = new Blob([exportToolLibrary(toolLibraryStore.getState().tools)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'spon-tools.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Profile and pocket default to the 6 mm starter flat (or the first flat/bull/ball tool); drill defaults to the 6 mm starter drill. */
export function defaultToolFor(type: OperationType, tools: readonly Tool[]): Tool | null {
  if (type === 'drill') return tools.find((t) => t.id === 'starter-drill-6') ?? tools.find((t) => t.type === 'drill') ?? null;
  return tools.find((t) => t.id === 'starter-flat-6') ?? tools.find((t) => t.type === 'flat' || t.type === 'bull' || t.type === 'ball') ?? null;
}
