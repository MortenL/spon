import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GeometryRef, JobCommand } from '@sponcam/core';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSession } from '../src/fileSession';
import { ToolLibraryFile } from '../src/library';
import { LiveBridge } from '../src/live/bridge';
import { LiveSession } from '../src/live/liveSession';
import { loadNodeOcct } from '../src/occt';
import { openTab, sessionHandler } from './fakeTab';
import { fixture, tempDir, tool6 } from './helpers';

const bridges: LiveBridge[] = [];
afterEach(async () => {
  await Promise.all(bridges.splice(0).map((b) => b.close()));
});

async function live() {
  const backing = FileSession.create({ name: 'Tab job' }, { library: new ToolLibraryFile(join(tempDir(), 'tools.json')), loadReader: loadNodeOcct, postDate: '2026-01-01' });
  const bridge = new LiveBridge({ port: 0, serverVersion: 'test' });
  bridges.push(bridge);
  const state = await bridge.start();
  if (state.status !== 'listening') throw new Error('bridge did not start');
  const { handle, marked } = sessionHandler(backing);
  const tab = openTab(state.port, { handle });
  await tab.welcomed;
  return { session: new LiveSession(bridge.tab!), backing, tab, marked };
}

describe('LiveSession', () => {
  it('drives the tab: import, apply, run, catalog, boxes, preview and export', async () => {
    const { session, backing, tab } = await live();
    expect(session.kind).toBe('live');
    expect((await session.describe()).kind).toBe('live');
    expect((await session.importModel({ fileName: 'cam-part.dxf', bytes: fixture('cam-part.dxf') })).status).toBe('imported');
    const outline = (await session.catalog())!.contours.find((c) => c.layer === 'OUTLINE')!.ref as GeometryRef;
    const commands: JobCommand[] = [
      { type: 'addTool', tool: tool6 },
      { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'p' },
      { type: 'updateOperation', id: 'p', patch: { geometry: [outline] } },
    ];
    const job = await session.apply(commands, 'Add Profile on C1');
    expect(job.operations.map((o) => o.id)).toEqual(['p']);
    expect(await session.run()).toEqual(await backing.run());
    expect((await session.boxes()).stock).not.toBeNull();
    expect(await session.previewSvg({ view: 'top', operations: ['p'] })).toContain('<svg');
    const exported = await session.exportGcode();
    expect(exported.ok).toBe(true);
    expect(tab.methods).toEqual(expect.arrayContaining(['importModel', 'apply', 'run', 'catalog', 'boxes', 'previewSvg', 'exportGcode']));
  });

  it('passes the tab\'s command errors on', async () => {
    const { session } = await live();
    await expect(session.apply([{ type: 'updateOperation', id: 'nope', patch: { name: 'x' } }])).rejects.toThrow('commands[0] updateOperation: No operation with id nope');
  });

  it('saves to a path on disk, then tells the tab it is saved', async () => {
    const { session, marked } = await live();
    const dir = tempDir();
    const path = await session.save(join(dir, 'tab-job'));
    expect(path).toBe(join(dir, 'tab-job.spon'));
    expect(readFileSync(path, 'utf8')).toBe('spon bytes');
    expect(marked).toEqual([7]);
    await expect(session.save()).rejects.toThrow('This tab has no file yet — give a path');
  });

  it('still reports the path when the tab fails to mark the file saved', async () => {
    const { backing } = await live();
    const base = sessionHandler(backing).handle;
    const bridge = bridges[0];
    const tab = openTab((bridge.state as { port: number }).port, {
      takeover: true,
      handle: (method, p) => { if (method === 'markSaved') throw new Error('boom'); return base(method, p); },
    });
    await tab.welcomed;
    const path = join(tempDir(), 'x.spon');
    await expect(new LiveSession(bridge.tab!).save(path)).resolves.toBe(path);
    expect(readFileSync(path, 'utf8')).toBe('spon bytes');
  });

  it('reaches the tab\'s tool library and programs', async () => {
    const { session } = await live();
    await session.tools.add({ ...tool6, number: 50 });
    expect((await session.tools.list()).some((t) => t.id === 't6')).toBe(true);
    expect((await session.importProgram('drill-arc.nc', fixture('drill-arc.nc'))).name).toBe('drill-arc.nc');
  });
});
