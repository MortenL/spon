import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ServerDeps } from '../src/server';
import { connect, data, text } from './connect';

async function profiled(overrides: Partial<ServerDeps> = {}) {
  const t = await connect(overrides, ['cam-part.dxf']);
  await t.call('new_job', { name: 'Part' });
  await t.call('import_model', { path: 'cam-part.dxf' });
  const catalog = data(await t.call('describe_geometry'));
  const outline = catalog.contours.find((c: { layer: string }) => c.layer === 'OUTLINE').handle;
  const op = data(await t.call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: [outline] })).operation;
  return { ...t, op };
}

describe('output tools', () => {
  it('generates and summarises every operation and file', async () => {
    const { call, op } = await profiled();
    const r = await call('generate');
    const d = data(r);
    expect(d.operations[0].id).toBe(op.id);
    expect(['ok', 'warning']).toContain(d.operations[0].status);
    expect(d.files).toHaveLength(1);
    expect(d.cycleSeconds).toBeGreaterThan(0);
    expect(d.export.errors).toEqual([]);
    expect(text(r)).toContain('Cycle time');
  });

  it('lists tabs per contour in the generate summary', async () => {
    const { call, op } = await profiled();
    const tabs = { enabled: true, shape: 'rect', width: 4, height: 2, placement: 'count', count: 4, spacing: 50, manual: [] };
    await call('apply_commands', { commands: [{ type: 'updateOperation', id: op.id, patch: { tabs } }] });
    const d = data(await call('generate'));
    const listed = d.operations[0].tabs;
    expect(d.operations[0].tabsSkipped).toBe(0);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ refIndex: 0, manual: false });
    expect(listed[0].t).toHaveLength(4);
    expect(text(await call('generate'))).toContain('tabs: 4 on 1 contour');
    await call('apply_commands', { commands: [{ type: 'updateOperation', id: op.id, patch: { tabs: { ...tabs, enabled: false } } }] });
    expect(data(await call('generate')).operations[0].tabs).toEqual([]);
  });

  it('writes posted files and writes nothing while there are errors', async () => {
    const { call, dir } = await profiled();
    const written = await call('export_gcode', { dir: 'out' });
    expect(written.isError).toBeFalsy();
    const paths = data(written).paths as string[];
    expect(paths[0].startsWith(join(dir, 'out'))).toBe(true);
    expect(readFileSync(paths[0], 'utf8')).toContain('Spon 2026-01-01');
    await call('apply_commands', { commands: [{ type: 'addOperation', opType: 'pocket', toolId: null, id: 'empty' }] });
    const blocked = await call('export_gcode', { dir: 'out2' });
    expect(blocked.isError).toBe(true);
    expect(text(blocked)).toContain('Export blocked by errors:');
    expect(existsSync(join(dir, 'out2'))).toBe(false);
  });

  it('pages through posted G-code', async () => {
    const { call } = await profiled();
    const name = data(await call('generate')).files[0].name;
    const first = data(await call('get_gcode'));
    expect(first).toMatchObject({ file: name, from: 1 });
    expect(first.to - first.from + 1).toBeLessThanOrEqual(400);
    expect(data(await call('get_gcode', { file: name, lines: [2, 3] })).text.split('\n')).toHaveLength(2);
    expect((await call('get_gcode', { file: 'nope.nc' })).isError).toBe(true);
  });

  it('renders a preview through the rasteriser', async () => {
    const svgs: string[] = [];
    const { call } = await profiled({ rasterize: async (svg) => { svgs.push(svg); return new Uint8Array([137, 80, 78, 71]); } });
    const r = await call('render_preview', { view: 'iso' });
    expect(r.content[0]).toEqual({ type: 'image', mimeType: 'image/png', data: Buffer.from([137, 80, 78, 71]).toString('base64') });
    expect(svgs[0]).toContain('<g id="op-0"');
    expect(text(await call('render_preview', { operations: ['nope'] }))).toBe('No operation with id nope');
  });

  it('exposes the job, the catalog and posted G-code as resources', async () => {
    const { client, call } = await profiled();
    await call('generate');
    const job = await client.readResource({ uri: 'spon://job' });
    expect(JSON.parse((job.contents[0] as { text: string }).text).name).toBe('Part');
    const catalog = await client.readResource({ uri: 'spon://catalog' });
    expect(JSON.parse((catalog.contents[0] as { text: string }).text).contours[0].handle).toBe('C1');
    const gcode = (await client.listResources()).resources.find((r) => r.uri.startsWith('spon://gcode/'))!;
    expect(((await client.readResource({ uri: gcode.uri })).contents[0] as { text: string }).text).toContain('Spon 2026-01-01');
  });

  it('sends instructions and the basics prompt', async () => {
    const { client } = await connect();
    expect(client.getInstructions()).toContain('describe_geometry');
    const prompt = await client.getPrompt({ name: 'spon-cam-basics' });
    expect((prompt.messages[0].content as { text: string }).text).toContain('import_model');
  });

  it('rejects a reversed G-code range (finding 7)', async () => {
    const { call } = await profiled();
    await call('generate');
    const r = await call('get_gcode', { lines: [5, 2] });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('lines must be [from, to] with from <= to');
  });

  it('counts the operations actually drawn and returns them as structured content (finding 11)', async () => {
    const { call, op } = await profiled();
    await call('apply_commands', { commands: [{ type: 'setOperationEnabled', id: op.id, enabled: false }] });
    const none = await call('render_preview', { operations: [op.id] });
    expect(text(none)).toContain('with 0 operation(s)');
    expect(data(none)).toEqual({ view: 'top', operations: [] });
    await call('apply_commands', { commands: [{ type: 'setOperationEnabled', id: op.id, enabled: true }] });
    const one = await call('render_preview', { view: 'iso' });
    expect(text(one)).toContain('with 1 operation(s)');
    expect(data(one)).toEqual({ view: 'iso', operations: [op.id] });
  });

  it('reports a gouge as an error and refuses to export it', async () => {
    const { call, dir } = await connect({}, ['stepped.stl']);
    await call('new_job', { name: 'Stepped' });
    await call('import_model', { path: 'stepped.stl', units: 'mm' });
    const faces = data(await call('describe_geometry', { filter: 'faces' })).faces as { handle: string; z: number }[];
    const top = faces[0]; // faces are listed top down: the boss top
    const added = await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: [top.handle + '.L0'] });
    expect(added.isError).toBeFalsy();
    const generated = data(await call('generate'));
    expect(generated.operations[0].status).toBe('error');
    expect(JSON.stringify(generated.operations[0].diagnostics)).toContain('gouge');
    const blocked = await call('export_gcode', { dir: 'out' });
    expect(blocked.isError).toBe(true);
    expect(text(blocked)).toContain('Export blocked by errors:');
    expect(text(blocked)).toContain('Cuts into the model by up to');
    expect(existsSync(join(dir, 'out'))).toBe(false);
  });

  it('refuses to export a square-ended slot until squareEnds is set', async () => {
    const { call } = await connect({}, ['slot-plate.stl']);
    await call('new_job');
    await call('import_model', { path: 'slot-plate.stl', units: 'mm' });
    const handle = /^(S\d+) slot 8 × 40/m.exec(text(await call('describe_geometry')))![1];
    const op = data(await call('add_operation', { type: 'slot', tool: 'starter-flat-6', geometry: [handle] })).operation;
    const blocked = await call('export_gcode', { dir: 'out' });
    expect(blocked.isError).toBe(true);
    expect(text(blocked)).toContain('Choose how square slot ends are cut');
    const updated = await call('apply_commands', { commands: [{ type: 'updateOperation', id: op.id, patch: { squareEnds: 'inside' } }] });
    expect(updated.isError).toBeFalsy();
    const written = await call('export_gcode', { dir: 'out' });
    expect(written.isError).toBeFalsy();
  });
});
