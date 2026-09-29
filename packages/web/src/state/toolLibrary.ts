import {
  exportToolLibrary, importFusionLibrary, importToolLibrary, type OperationType, starterLibrary, type Tool, validateTool,
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
  toolLibraryStore.setState({ tools: all.sort((a, b) => a.number - b.number || a.name.localeCompare(b.name)), loaded: true });
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

export async function saveLibraryTool(tool: Tool): Promise<void> {
  if (!validateTool(tool)) throw new Error('The tool has invalid values');
  await (await db()).put('tools', tool, tool.id);
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

export async function importLibraryFile(
  file: File,
): Promise<{ added: number; updated: number; skipped: { name: string; reason: string }[] }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const isSpon = !file.name.toLowerCase().endsWith('.tools') && text.includes('"spon-tools"');
  const result = isSpon ? { tools: importToolLibrary(text), skipped: [] } : importFusionLibrary(bytes, file.name);
  const d = await db();
  const existingIds = new Set(await d.getAllKeys('tools'));
  const tx = d.transaction('tools', 'readwrite');
  for (const t of result.tools) await tx.store.put(t, t.id);
  await tx.done;
  await refresh();
  const updated = result.tools.filter((t) => existingIds.has(t.id)).length;
  return { added: result.tools.length - updated, updated, skipped: result.skipped };
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
