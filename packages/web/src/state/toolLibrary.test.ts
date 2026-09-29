import 'fake-indexeddb/auto';
import { exportToolLibrary, starterLibrary } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { defaultToolFor, deleteLibraryTool, importLibraryFile, loadToolLibrary, resetStarterLibrary, saveLibraryTool, toolLibraryStore } from './toolLibrary';

const tools = () => toolLibraryStore.getState().tools;

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
    expect(await importLibraryFile(spon)).toEqual({ imported: 1, skipped: [] });
    const fusion = new File([JSON.stringify({ data: [{ type: 'probe', description: 'Probe' }] })], 'f.json');
    expect(await importLibraryFile(fusion)).toEqual({ imported: 0, skipped: [{ name: 'Probe', reason: 'Unsupported tool type "probe"' }] });
  });

  it('picks default tools per operation type', () => {
    const lib = starterLibrary();
    expect(defaultToolFor('pocket', lib)?.id).toBe('starter-flat-6');
    expect(defaultToolFor('drill', lib)?.id).toBe('starter-drill-6');
    expect(defaultToolFor('drill', lib.filter((t) => t.type !== 'drill'))).toBeNull();
  });
});
