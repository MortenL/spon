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
    expect(text(await stl.call('describe_geometry', { filter: 'contours' }))).toContain('No contours (only drawings, DXF or SVG, have contours).');
  });

  it('reverses a whole open line when a later handle has a trailing !', async () => {
    const firstXY = async (reverseSecond: boolean) => {
      const { call } = await connect({}, ['svg/two-pieces.svg']);
      await call('new_job');
      await call('import_model', { path: 'two-pieces.svg' });
      await call('apply_commands', { commands: [{ type: 'setStock', stock: { mode: 'auto', margin: { xy: 10, zTop: 0, zBottom: 6 } } }] });
      const described = await call('describe_geometry');
      expect(text(described)).toContain('from (');
      const [a, b] = data(described).contours.map((c: { handle: string }) => c.handle);
      const added = await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: [a, reverseSecond ? `${b}!` : b], params: { openSide: 'left' } });
      expect(added.isError).toBeFalsy();
      await call('generate');
      const lines = (data(await call('get_gcode')).text as string).split(/\r?\n/);
      return /X(\S+) Y(\S+)/.exec(lines.find((l) => /^X\S+ Y\S+/.test(l))!)!.slice(1, 3).join(',');
    };
    expect(await firstXY(true)).not.toBe(await firstXY(false));
  });

  it('profiles an open line on its right with a reversed handle', async () => {
    const { call } = await connect({}, ['svg/cad.svg']);
    await call('new_job');
    await call('import_model', { path: 'cad.svg' });
    await call('apply_commands', { commands: [{ type: 'setStock', stock: { mode: 'auto', margin: { xy: 10, zTop: 0, zBottom: 6 } } }] });
    const catalog = data(await call('describe_geometry')) as { contours: { handle: string; closed: boolean }[] };
    const open = catalog.contours.find((c) => !c.closed)!;
    const added = await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: [`${open.handle}!`], params: { openSide: 'right' } });
    expect(added.isError).toBeFalsy();
    expect(data(added).operation).toMatchObject({ openSide: 'right', geometry: [{ reverse: true }] });
    const gen = data(await call('generate')) as { operations: { status: string }[] };
    expect(gen.operations[0].status).not.toBe('error');
  });

  it('faces a spoilboard with no model and requires geometry for other types', async () => {
    const { call } = await connect();
    await call('new_job');
    await call('apply_commands', { commands: [{ type: 'setStock', stock: { mode: 'fixed', size: { x: 300, y: 200, z: 20 }, modelOffset: { x: 0, y: 0, z: 0 } } }] });
    const face = await call('add_operation', { type: 'face', tool: 'starter-flat-6', geometry: [], params: { heights: { bottom: { from: 'stockTop', offset: -0.5 } } } });
    expect(face.isError).toBeFalsy();
    expect(data(face).operation).toMatchObject({ type: 'face', area: 'stock' });
    const generated = data(await call('generate'));
    expect(generated.operations[0].status).not.toBe('error');
    const bare = await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: [] });
    expect(bare.isError).toBe(true);
    expect(text(bare)).toContain('Pick geometry for this operation');
  });

  it('chamfers a drawing outline with a chamfer tool', async () => {
    const { call } = await dxfJob();
    await call('add_library_tool', { tool: { ...tool6, id: 'chamfer-90', name: '90 degree chamfer mill', type: 'chamfer', number: 20, diameter: 12, tipAngleDeg: 90, fluteLength: 6, stickout: 25 } });
    const outline = handleOn(data(await call('describe_geometry')), 'OUTLINE');
    const added = await call('add_operation', { type: 'chamfer', tool: 'chamfer-90', geometry: [outline], params: { width: 0.5 } });
    expect(added.isError).toBeFalsy();
    expect(data(added).operation).toMatchObject({ type: 'chamfer', width: 0.5 });
    const generated = data(await call('generate'));
    expect(generated.operations[0].status).not.toBe('error');
    expect(generated.export.errors).toEqual([]);
  });

  it('sets an engraving depth through apply_commands and sees it in the G-code', async () => {
    const { call } = await dxfJob();
    const outline = handleOn(data(await call('describe_geometry')), 'OUTLINE');
    const added = await call('add_operation', { type: 'engrave', tool: 'starter-flat-6', geometry: [outline], params: { depth: 0.7 } });
    expect(added.isError).toBeFalsy();
    const id = data(added).operation.id as string;
    expect(data(added).operation).toMatchObject({ type: 'engrave', depth: 0.7 });
    const patched = await call('apply_commands', { commands: [{ type: 'updateOperation', id, patch: { depth: 0.45, stepdown: 1 } }] });
    expect(patched.isError).toBeFalsy();
    await call('generate');
    const gcode = data(await call('get_gcode')).text as string;
    expect(gcode).toMatch(/Z-0\.45/);
    expect(gcode).not.toMatch(/Z-0\.7/);
  });

  describe('V-carve and clearing', () => {
    async function carveJob(maxDepth: number | null) {
      const t = await dxfJob();
      const outline = handleOn(data(await t.call('describe_geometry')), 'OUTLINE');
      const carve = await t.call('add_operation', { type: 'vcarve', tool: 'starter-vbit-90', geometry: [outline], params: { maxDepth } });
      expect(carve.isError).toBeFalsy();
      const carveId = data(carve).operation.id as string;
      const clear = await t.call('add_operation', { type: 'vclear', tool: 'starter-flat-6', geometry: [], params: { sourceId: carveId } });
      expect(clear.isError).toBeFalsy();
      expect(data(clear).operation).toMatchObject({ type: 'vclear', sourceId: carveId });
      return t;
    }

    it('places the clearing before its V-carve in the same batch', async () => {
      const { call } = await carveJob(1);
      const ops = data(await call('get_job', { section: 'operations' })).operations as { type: string }[];
      expect(ops.map((o) => o.type)).toEqual(['vclear', 'vcarve']);
    });

    it('generates and exports a V-carve with its clearing', async () => {
      const { call } = await carveJob(1);
      const generated = await call('generate');
      expect(generated.isError).toBeFalsy();
      expect(data(generated).export.errors).toEqual([]);
      expect((data(generated).operations as { status: string }[]).map((o) => o.status)).not.toContain('error');
      const exported = await call('export_gcode', { dir: 'out' });
      expect(exported.isError).toBeFalsy();
    });

    it('refuses to export a clearing whose V-carve has no max depth', async () => {
      const { call } = await carveJob(null);
      await call('generate');
      const exported = await call('export_gcode', { dir: 'out' });
      expect(exported.isError).toBe(true);
      expect(text(exported)).toContain('Set a max depth on');
    });
  });

  describe('slots', () => {
    async function slotPlate() {
      const t = await connect({}, ['slot-plate.stl']);
      await t.call('new_job');
      await t.call('import_model', { path: 'slot-plate.stl', units: 'mm' });
      return t;
    }
    const handleOf = (listing: string, shape: string) => new RegExp(`^(S\\d+) slot ${shape}`, 'm').exec(listing)![1];

    it('lists recognised slots with handles and filters them', async () => {
      const { call } = await slotPlate();
      const all = text(await call('describe_geometry'));
      expect(all).toMatch(/^S\d+ slot 6\.5 × 13\.5 \(line, round\/round\) at \(-?[\d.]+, -?[\d.]+\) → \(-?[\d.]+, -?[\d.]+\), z -11\.000 to -1\.000, through$/m);
      expect(all).toMatch(/^S\d+ slot 8 × 40 \(line, square\/square\)/m);
      const only = await call('describe_geometry', { filter: 'slots' });
      expect(text(only).split(/\n/).filter((l) => l.startsWith('S'))).toHaveLength(2);
      expect(text(only)).not.toMatch(/^F\d/m);
      expect(data(only).slots).toHaveLength(2);
    });

    it('says so when there are no slots', async () => {
      const { call } = await dxfJob();
      expect(text(await call('describe_geometry', { filter: 'slots' }))).toContain('No slots found.');
    });

    it('cuts a recognised slot', async () => {
      const { call } = await slotPlate();
      const handle = handleOf(text(await call('describe_geometry')), '6\\.5 × 13\\.5');
      const added = await call('add_operation', { type: 'slot', tool: 'starter-flat-6', geometry: [handle], params: { stepdown: 2 } });
      expect(added.isError).toBeFalsy();
      const generated = await call('generate');
      expect(generated.isError).toBeFalsy();
      expect(data(generated).export.errors).toEqual([]);
      const gen = data(generated) as { operations: { status: string; diagnostics: unknown[] }[]; files: { lines: number }[]; extents: unknown };
      expect(gen.operations[0].status).not.toBe('error');
      expect(gen.files.length).toBeGreaterThan(0);
      expect(gen.files[0].lines).toBeGreaterThan(10);
      expect(gen.extents).not.toBeNull();
    });
  });
});
