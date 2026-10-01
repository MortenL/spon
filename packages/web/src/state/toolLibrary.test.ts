import 'fake-indexeddb/auto';
import { exportToolLibrary, starterLibrary } from '@sponcam/core';
import { openDB } from 'idb';
import { describe, expect, it, vi } from 'vitest';
import { defaultToolFor, deleteLibraryTool, importLibraryBytes, importLibraryFile, listLibraryTools, loadToolLibrary, resetStarterLibrary, saveLibraryTool, toolLibraryStore } from './toolLibrary';

vi.mock('idb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('idb')>();
  return { ...actual, openDB: vi.fn(actual.openDB) };
});

const tools = () => toolLibraryStore.getState().tools;

describe('tool library database', () => {
  it('retries opening the database after a failure', async () => {
    vi.mocked(openDB).mockRejectedValueOnce(new Error('boom'));
    await expect(loadToolLibrary()).rejects.toThrow('boom');
    await loadToolLibrary();
    expect(toolLibraryStore.getState().loaded).toBe(true);
  });
});

describe('tool library', () => {
  it('seeds the starter library once, then keeps user changes', async () => {
    await loadToolLibrary();
    expect(tools().map((t) => t.id)).toEqual(starterLibrary().map((t) => t.id));
    await deleteLibraryTool('starter-flat-3');
    await saveLibraryTool({ ...starterLibrary()[1], id: 'mine', name: 'My 6 mm', number: 20 });
    await loadToolLibrary();
    expect(tools().some((t) => t.id === 'starter-flat-3')).toBe(false);
    expect(tools().at(-1)?.id).toBe('mine'); // sorted by T number
    await resetStarterLibrary();
    expect(tools().some((t) => t.id === 'starter-flat-3')).toBe(true);
    expect(tools().some((t) => t.id === 'mine')).toBe(true);
  });

  it('imports Spon and Fusion files', async () => {
    await loadToolLibrary();
    const spon = new File([exportToolLibrary([{ ...starterLibrary()[0], id: 'imported', number: 30 }])], 'lib.json');
    expect(await importLibraryFile(spon)).toEqual({ added: 1, updated: 0, skipped: [], notes: [] });
    expect(await importLibraryFile(spon)).toEqual({ added: 0, updated: 1, skipped: [], notes: [] });
    const fusion = new File([JSON.stringify({ data: [{ type: 'probe', description: 'Probe' }] })], 'f.json');
    expect(await importLibraryFile(fusion)).toEqual({ added: 0, updated: 0, skipped: [{ name: 'Probe', reason: 'Unsupported tool type "probe"' }], notes: [] });
  });

  it('refuses to save a tool with a T number another library tool has', async () => {
    await loadToolLibrary();
    const flat3 = tools().find((t) => t.id === 'starter-flat-3')!;
    await expect(saveLibraryTool({ ...flat3, id: 'dup', name: 'Dup', number: 2 })).rejects.toThrow(/T2/);
    expect(tools().some((t) => t.id === 'dup')).toBe(false);
    await saveLibraryTool({ ...flat3, name: 'Renamed 3 mm' }); // saving a tool over itself keeps its number
    expect(tools().find((t) => t.id === 'starter-flat-3')?.name).toBe('Renamed 3 mm');
  });

  it('renumbers imported tools whose T number is taken, and says so', async () => {
    await loadToolLibrary();
    const a = { ...starterLibrary()[0], id: 'imp-a', name: 'Imported A', number: 2 }; // T2 is the starter 6 mm flat
    const b = { ...starterLibrary()[0], id: 'imp-b', name: 'Imported B', number: 2 };
    const res = await importLibraryFile(new File([exportToolLibrary([a, b])], 'lib.json'));
    expect(res.added).toBe(2);
    const numbers = tools().map((t) => t.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(res.notes).toHaveLength(2);
    expect(res.notes[0]).toMatch(/Imported A.*T2.*T\d+/);
  });

  it('lists and imports for the live bridge', async () => {
    await loadToolLibrary();
    const listed = await listLibraryTools();
    expect(listed.map((t) => t.id)).toEqual(tools().map((t) => t.id));
    const mine = { ...starterLibrary()[1], id: 'bridge-tool', name: 'Bridge 6 mm', number: 77 };
    const result = await importLibraryBytes('lib.json', new TextEncoder().encode(exportToolLibrary([mine])));
    expect(result.added).toBe(1);
    expect((await listLibraryTools()).some((t) => t.id === 'bridge-tool')).toBe(true);
  });

  it('picks default tools per operation type', () => {
    const lib = starterLibrary();
    expect(defaultToolFor('pocket', lib)?.id).toBe('starter-flat-6');
    expect(defaultToolFor('drill', lib)?.id).toBe('starter-drill-6');
    expect(defaultToolFor('drill', lib.filter((t) => t.type !== 'drill'))).toBeNull();
  });
});
