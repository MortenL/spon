import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportToolLibrary } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { connect, data, text } from './connect';
import { tool6 } from './helpers';

describe('library tools', () => {
  it('lists, filters, adds and imports tools', async () => {
    const { call, dir } = await connect();
    const all = data(await call('list_tools')).tools as { source: string; type: string; id: string }[];
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((t) => t.source === 'library')).toBe(true);
    expect((data(await call('list_tools', { type: 'drill' })).tools as { type: string }[]).every((t) => t.type === 'drill')).toBe(true);
    expect((await call('add_library_tool', { tool: { ...tool6, id: 'mine', number: 90 } })).isError).toBeFalsy();
    expect((data(await call('list_tools', { query: '6 MM FLAT' })).tools as { id: string }[]).some((t) => t.id === 'mine')).toBe(true);
    writeFileSync(join(dir, 'lib.json'), exportToolLibrary([{ ...tool6, id: 'imported', number: 91 }]));
    expect(text(await call('import_tool_library', { path: 'lib.json' }))).toContain('Imported 1 new and 0 updated tool(s)');
  });

  it('lists job tools before library tools', async () => {
    const { call } = await connect();
    await call('new_job');
    await call('apply_commands', { commands: [{ type: 'addTool', tool: tool6 }] });
    const tools = data(await call('list_tools')).tools as { source: string; id: string }[];
    expect(tools[0]).toMatchObject({ source: 'job', id: 't6' });
  });
});
