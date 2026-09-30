import { describe, expect, it } from 'vitest';
import { connect, data, text } from './connect';
import { tool6 } from './helpers';

async function dxfJob() {
  const t = await connect({}, ['cam-part.dxf']);
  await t.call('new_job', { name: 'Part' });
  await t.call('import_model', { path: 'cam-part.dxf' });
  return t;
}
const handleOn = (catalog: { contours: { handle: string; layer: string }[] }, layer: string) => catalog.contours.find((c) => c.layer === layer)!.handle;

describe('editing tools', () => {
  it('asks for a model before describing geometry', async () => {
    const { call } = await connect();
    await call('new_job');
    expect(text(await call('describe_geometry'))).toBe('The job has no model yet. Use import_model first.');
  });

  it('describes geometry with handles and filters it', async () => {
    const { call } = await dxfJob();
    const all = await call('describe_geometry');
    expect(text(all)).toMatch(/^C1 contour on layer/m);
    expect(data(all).stockBox).not.toBeNull();
    const holes = data(await call('describe_geometry', { filter: 'holes' }));
    expect(holes.contours).toEqual([]);
    expect(holes.holes.length).toBeGreaterThan(0);
  });

  it('adds an operation with a library tool, handles and params', async () => {
    const { call } = await dxfJob();
    const outline = handleOn(data(await call('describe_geometry')), 'OUTLINE');
    const added = await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: [outline], params: { tabs: { enabled: true } } });
    expect(added.isError).toBeFalsy();
    expect(data(added).operation).toMatchObject({ type: 'profile', toolId: 'starter-flat-6', tabs: { enabled: true } });
    expect(data(added).operation.geometry).toHaveLength(1);
    const tools = data(await call('get_job', { section: 'tools' })).tools;
    expect(tools.map((t: { id: string }) => t.id)).toEqual(['starter-flat-6']);
    const byNumber = await call('add_operation', { type: 'profile', tool: tools[0].number, geometry: [outline.toLowerCase()] });
    expect(data(byNumber).operation.toolId).toBe('starter-flat-6');
    expect(data(await call('get_job', { section: 'tools' })).tools).toHaveLength(1);
  });

  it('rejects a stale handle after a new import (review focus 3)', async () => {
    const { call } = await dxfJob();
    const outline = handleOn(data(await call('describe_geometry')), 'OUTLINE');
    await call('import_model', { path: 'cam-part.dxf' });
    const r = await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: [outline] });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe(`Unknown handle ${outline} — call describe_geometry for the current list`);
  });

  it('applies nothing when a library tool clashes with a job T number (review focus 4)', async () => {
    const { call, deps } = await dxfJob();
    const starter = (await deps.library.list()).find((t) => t.id === 'starter-flat-6')!;
    expect((await call('apply_commands', { commands: [{ type: 'addTool', tool: { ...tool6, id: 'mine', number: starter.number } }] })).isError).toBeFalsy();
    const outline = handleOn(data(await call('describe_geometry')), 'OUTLINE');
    const r = await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: [outline] });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain(`commands[0] addTool: T${starter.number} is already used by "${tool6.name}"`);
    expect(data(await call('get_job', { section: 'operations' })).operations).toEqual([]);
  });

  it('names an unknown tool', async () => {
    const { call } = await dxfJob();
    const outline = handleOn(data(await call('describe_geometry')), 'OUTLINE');
    expect(text(await call('add_operation', { type: 'profile', tool: 'nope', geometry: [outline] }))).toBe('No tool nope in the job or the library — see list_tools');
  });

  it('applies commands atomically and reports what changed', async () => {
    const { call } = await dxfJob();
    const done = await call('apply_commands', { commands: [{ type: 'renameJob', name: 'Bracket' }, { type: 'setPost', patch: { dialect: 'linuxcnc' } }] });
    expect(data(done).changed).toEqual(['name', 'post']);
    const bad = await call('apply_commands', { commands: [{ type: 'renameJob', name: 'X' }, { type: 'removeOperation', id: 'nope' }] });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toBe('commands[1] removeOperation: No operation with id nope');
    expect(data(await call('get_job')).job.name).toBe('Bracket');
  });

  it('rejects unknown operation parameters', async () => {
    const { call } = await dxfJob();
    const outline = handleOn(data(await call('describe_geometry')), 'OUTLINE');
    const r = await call('add_operation', { type: 'pocket', tool: 'starter-flat-6', geometry: [outline], params: { stepovr: 40 } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('stepovr');
  });

  it('retries a "T6" string as T number 6 (finding 3)', async () => {
    const { call } = await dxfJob();
    const outline = handleOn(data(await call('describe_geometry')), 'OUTLINE');
    const number = (await data(await call('add_operation', { type: 'profile', tool: 6, geometry: [outline] })).operation.toolId) as string;
    for (const tool of ['T6', 't6', '6']) {
      const r = await call('add_operation', { type: 'profile', tool, geometry: [outline] });
      expect(r.isError, text(r)).toBeFalsy();
      expect(data(r).operation.toolId).toBe(number);
    }
  });

  it('words the empty result by filter (finding 8)', async () => {
    const { call } = await dxfJob();
    expect(text(await call('describe_geometry', { filter: 'faces' }))).toContain('No up-facing horizontal faces in this orientation.');
    const stl = await connect({}, ['box-20x10x5.stl']);
    await stl.call('new_job');
    await stl.call('import_model', { path: 'box-20x10x5.stl', units: 'mm' });
    expect(text(await stl.call('describe_geometry', { filter: 'holes' }))).toContain('No holes found.');
    expect(text(await stl.call('describe_geometry', { filter: 'holes' }))).toContain('No holes found.');
    expect(text(await stl.call('describe_geometry', { filter: 'contours' }))).toContain('No contours (only DXF drawings have contours).');
  });
});
