import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportToolLibrary, importToolLibrary, starterLibrary } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { defaultLibraryPath, ToolLibraryFile } from '../src/library';
import { tempDir, tool6 } from './helpers';

describe('ToolLibraryFile', () => {
  it('seeds a missing library with the starter tools', async () => {
    const path = join(tempDir(), 'nested', 'tools.json');
    const tools = await new ToolLibraryFile(path).list();
    expect(tools.map((t) => t.id).sort()).toEqual(starterLibrary().map((t) => t.id).sort());
    expect(importToolLibrary(readFileSync(path, 'utf8'))).toHaveLength(tools.length);
  });

  it('adds tools, refuses a taken T number and leaves no temporary files', async () => {
    const dir = tempDir();
    const lib = new ToolLibraryFile(join(dir, 'tools.json'));
    const taken = (await lib.list())[0];
    await expect(lib.add({ ...tool6, id: 'mine', number: taken.number })).rejects.toThrow(`T${taken.number} is already used by "${taken.name}"`);
    await lib.add({ ...tool6, id: 'mine', number: 99 });
    expect((await lib.list()).some((t) => t.id === 'mine')).toBe(true);
    expect(readdirSync(dir)).toEqual(['tools.json']);
  });

  it('imports a Spon library file', async () => {
    const lib = new ToolLibraryFile(join(tempDir(), 'tools.json'));
    const result = await lib.importFile('lib.json', new TextEncoder().encode(exportToolLibrary([{ ...tool6, id: 'x', number: 77 }])));
    expect(result).toEqual({ added: 1, updated: 0, skipped: [], notes: [] });
    expect((await lib.list()).find((t) => t.id === 'x')?.number).toBe(77);
  });

  it('names the file when the library is invalid', async () => {
    const path = join(tempDir(), 'tools.json');
    writeFileSync(path, '{ nope');
    await expect(new ToolLibraryFile(path).list()).rejects.toThrow(path);
  });

  it('defaults to ~/.spon/tools.json unless SPON_TOOL_LIBRARY is set', () => {
    expect(defaultLibraryPath({ SPON_TOOL_LIBRARY: '/x/y.json' })).toBe('/x/y.json');
    expect(defaultLibraryPath({}).replace(/\\/g, '/')).toMatch(/\/\.spon\/tools\.json$/);
  });
});
