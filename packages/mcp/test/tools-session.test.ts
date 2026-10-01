import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connect, data, text } from './connect';

describe('session tools', () => {
  it('describes a live session by its tab', async () => {
    const { statusText } = await import('../src/tools/session');
    expect(statusText({ kind: 'live', name: 'Bracket', path: 'bracket.spon', dirty: true, model: null, operations: 2 }))
      .toBe('Live tab: job "Bracket" (bracket.spon), unsaved changes. Model: none. Operations: 2.');
    expect(statusText({ kind: 'live', name: 'New', path: null, dirty: false, model: null, operations: 0 }))
      .toBe('Live tab: job "New" (no file yet). Model: none. Operations: 0.');
  });

  it('registers the session tools', async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['status', 'new_job', 'open_job', 'save_job', 'import_model', 'get_job', 'import_program']));
  });

  it('says when no job is open', async () => {
    const { call } = await connect();
    expect(text(await call('status'))).toBe('No job open. Use new_job, open_job or use_live_tab.');
    const r = await call('get_job');
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('No job open. Use new_job, open_job or use_live_tab.');
  });

  it('imports by a relative path and names absolute paths in errors (review focus 1)', async () => {
    const { call, dir } = await connect({}, ['cam-part.dxf']);
    await call('new_job', { name: 'Part' });
    const imported = await call('import_model', { path: 'cam-part.dxf' });
    expect(imported.isError).toBeFalsy();
    expect(data(imported).status).toBe('imported');
    expect(text(imported)).toContain('Imported cam-part.dxf as a drawing');
    const missing = await call('import_model', { path: 'nope.stl' });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain(`Could not read ${join(dir, 'nope.stl')}`);
    const badDir = await call('save_job', { path: join('no-such-dir', 'part') });
    expect(badDir.isError).toBe(true);
    expect(text(badDir)).toContain(join(dir, 'no-such-dir', 'part.spon'));
    const saved = await call('save_job', { path: 'part' });
    expect(data(saved).path).toBe(join(dir, 'part.spon'));
    expect(existsSync(join(dir, 'part.spon'))).toBe(true);
  });

  it('refuses to switch away from unsaved changes unless told to discard them', async () => {
    const { call } = await connect({}, ['cam-part.dxf']);
    await call('new_job');
    expect((await call('new_job')).isError).toBeFalsy(); // an untouched job has nothing to lose
    await call('import_model', { path: 'cam-part.dxf' });
    const refused = await call('new_job');
    expect(refused.isError).toBe(true);
    expect(text(refused)).toBe('The current job has unsaved changes — save_job first, or pass discard: true');
    expect((await call('new_job', { discard: true })).isError).toBeFalsy();
  });

  it('asks for units and bodies', async () => {
    const { call } = await connect({}, ['plate-pocket.stl', 'two-bodies.step']);
    await call('new_job');
    expect(data(await call('import_model', { path: 'plate-pocket.stl' })).status).toBe('needsUnits');
    expect(data(await call('import_model', { path: 'plate-pocket.stl', units: 'mm' })).status).toBe('imported');
    const bodies = await call('import_model', { path: 'two-bodies.step' });
    expect(data(bodies).status).toBe('needsBody');
    expect(text(bodies)).toContain('Call import_model again with body');
    expect(data(await call('import_model', { path: 'two-bodies.step', body: 1 })).status).toBe('imported');
  });

  it('opens a saved job and reads sections of it', async () => {
    const { call } = await connect({}, ['cam-part.dxf']);
    await call('new_job', { name: 'Saved' });
    await call('import_model', { path: 'cam-part.dxf' });
    await call('save_job', { path: 'saved' });
    await call('new_job', { name: 'Other' });
    const opened = await call('open_job', { path: 'saved.spon' });
    expect(data(opened).session).toMatchObject({ name: 'Saved', dirty: false, model: { sourceName: 'cam-part.dxf' } });
    expect(data(await call('get_job', { section: 'tools' }))).toEqual({ tools: [] });
    expect(data(await call('get_job')).job.name).toBe('Saved');
  });

  it('adds a G-code program', async () => {
    const { call } = await connect({}, ['drill-arc.nc']);
    await call('new_job');
    expect(data(await call('import_program', { path: 'drill-arc.nc' })).program).toMatchObject({ name: 'drill-arc.nc' });
  });

  it('tells a DXF import to set the stock thickness (finding 4)', async () => {
    const { call } = await connect({}, ['cam-part.dxf']);
    await call('new_job');
    expect(text(await call('import_model', { path: 'cam-part.dxf' }))).toContain('setStock');
  });
});
