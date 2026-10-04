import { describe, expect, it } from 'vitest';
import { connect, data, text } from './connect';

type Row = { standard: string; size: string };
type Gen = { operations: { status: string; diagnostics: { severity: string; code: string; message: string }[] }[] };

describe('thread tools', () => {
  it('lists the thread table, all rows or one standard', async () => {
    const { call } = await connect();
    const all = data(await call('list_threads')).threads as Row[];
    const unc = data(await call('list_threads', { standard: 'unc' })).threads as Row[];
    expect(all.length).toBeGreaterThan(unc.length);
    expect(unc.length).toBeGreaterThan(0);
    expect(unc.every((r) => r.standard === 'unc')).toBe(true);
    expect(all.some((r) => r.standard === 'iso-coarse' && r.size === 'M8')).toBe(true);
    expect(text(await call('list_threads', { standard: 'iso-coarse' }))).toContain('M8');
    // the text rounds, the structured rows keep the raw values (25.4 / 13)
    const half = await call('list_threads', { standard: 'unc' });
    expect(text(half)).toContain('pitch 1.9538 mm');
    expect(text(half)).not.toMatch(/\d\.\d{5,}/);
    expect((data(half).threads as { pitch: number }[]).some((r) => String(r.pitch).length > 8)).toBe(true);
  });

  it('threads the hole internally, then the boss externally', async () => {
    const { call } = await connect({}, ['thread-plate.stl']);
    await call('new_job');
    await call('import_model', { path: 'thread-plate.stl', units: 'mm' });
    const geo = await call('describe_geometry');
    expect(text(geo)).toMatch(/^B1 boss ⌀20\.000 at /m);
    expect(text(geo)).toMatch(/^H1 ⌀6\.8/m);
    expect(data(geo).bosses).toHaveLength(1);
    expect(text(await call('describe_geometry', { filter: 'bosses' }))).not.toMatch(/^H\d/m);
    expect(text(await call('describe_geometry', { filter: 'holes' }))).not.toMatch(/^B\d/m);

    const tool = data(await call('list_tools', { query: 'Thread mill 60' })).tools as { id: string }[];
    const toolId = tool[0].id;
    const added = await call('add_operation', { type: 'thread', tool: toolId, geometry: ['H1'], params: { thread: { standard: 'iso-coarse', size: 'M8', majorDiameter: 8, pitch: 1.25, angle: 60 }, length: 6 } });
    expect(added.isError).toBeFalsy();
    const op = data(added).operation as { id: string; kind: string };
    expect(op.kind).toBe('internal');
    const gen = data(await call('generate')) as Gen;
    expect(gen.operations[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);

    const ext = await call('add_operation', { type: 'thread', tool: toolId, geometry: ['B1'], params: { kind: 'external', thread: { standard: 'iso-coarse', size: 'M20', majorDiameter: 20, pitch: 2.5, angle: 60 }, length: 6 } });
    expect(ext.isError).toBeFalsy();
    expect(data(ext).operation).toMatchObject({ kind: 'external', geometry: [{ kind: 'meshBoss' }] });
    const gen2 = data(await call('generate')) as Gen;
    expect(gen2.operations[1].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('refuses a boss handle for an internal thread', async () => {
    const { call } = await connect({}, ['thread-plate.stl']);
    await call('new_job');
    await call('import_model', { path: 'thread-plate.stl', units: 'mm' });
    await call('describe_geometry');
    await call('add_operation', { type: 'thread', tool: 'starter-thread-sp6', geometry: ['B1'] });
    const gen = data(await call('generate')) as Gen;
    expect(gen.operations[0].diagnostics.map((d) => d.code)).toContain('wrong-geometry');
  });

  it('starts with the length of the picked boss or hole unless one is given', async () => {
    const { call } = await connect({}, ['thread-plate.stl']);
    await call('new_job');
    await call('import_model', { path: 'thread-plate.stl', units: 'mm' });
    await call('describe_geometry');
    const boss = await call('add_operation', { type: 'thread', tool: 'starter-thread-sp6', geometry: ['B1'], params: { kind: 'external' } });
    expect(data(boss).operation).toMatchObject({ length: 8 }); // the Z 18 boss on the Z 10 plate
    const hole = await call('add_operation', { type: 'thread', tool: 'starter-thread-sp6', geometry: ['H1'] });
    expect(data(hole).operation).toMatchObject({ length: 10 });
    const given = await call('add_operation', { type: 'thread', tool: 'starter-thread-sp6', geometry: ['B1'], params: { kind: 'external', length: 5 } });
    expect(data(given).operation).toMatchObject({ length: 5 });
  });

  it('takes a table thread by standard and size alone', async () => {
    const { call } = await connect({}, ['thread-plate.stl']);
    await call('new_job');
    await call('import_model', { path: 'thread-plate.stl', units: 'mm' });
    await call('describe_geometry');
    const added = await call('add_operation', { type: 'thread', tool: 'starter-thread-sp6', geometry: ['H1'], params: { thread: { standard: 'iso-coarse', size: 'M8' } } });
    expect(added.isError).toBeFalsy();
    expect(data(added).operation).toMatchObject({ thread: { size: 'M8', majorDiameter: 8, pitch: 1.25, angle: 60 } });
    const custom = await call('add_operation', { type: 'thread', tool: 'starter-thread-sp6', geometry: ['H1'], params: { thread: { standard: 'custom', size: null } } });
    expect(custom.isError).toBe(true);
    expect(text(custom)).toContain('thread.majorDiameter must be greater than 0');
  });
});
