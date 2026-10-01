import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSession } from '../src/fileSession';
import { ToolLibraryFile } from '../src/library';
import { LiveBridge } from '../src/live/bridge';
import { loadNodeOcct } from '../src/occt';
import { connect, data, text } from './connect';
import { openTab, sessionHandler } from './fakeTab';
import { tempDir } from './helpers';

const bridges: LiveBridge[] = [];
afterEach(async () => {
  await Promise.all(bridges.splice(0).map((b) => b.close()));
});

async function withBridge(port = 0) {
  const bridge = new LiveBridge({ port, serverVersion: 'test' });
  bridges.push(bridge);
  await bridge.start();
  return bridge;
}
function backingTab(bridge: LiveBridge, title = 'Tab job') {
  if (bridge.state.status !== 'listening') throw new Error('bridge is not listening');
  const backing = FileSession.create({ name: title }, { library: new ToolLibraryFile(join(tempDir(), 'tools.json')), loadReader: loadNodeOcct, postDate: '2026-01-01' });
  return openTab(bridge.state.port, { title, handle: sessionHandler(backing).handle });
}
const until = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 200 && !(await check()); i++) await new Promise((r) => setTimeout(r, 10));
  expect(await check()).toBe(true);
};

describe('live tools', () => {
  it('reports the bridge and asks for a tab', async () => {
    const bridge = await withBridge();
    const { call } = await connect({ bridge });
    const status = await call('status');
    expect(data(status)).toMatchObject({ session: null, liveTab: null, bridge: bridge.describe() });
    const none = await call('use_live_tab');
    expect(none.isError).toBe(true);
    expect(text(none)).toBe('No Spon tab is connected. In the Spon web app, click "Claude" in the status bar to connect.');
  });

  it('drives a connected tab through the usual tools', async () => {
    const bridge = await withBridge();
    const { call } = await connect({ bridge }, ['cam-part.dxf']);
    const tab = backingTab(bridge);
    await tab.welcomed;
    const used = await call('use_live_tab');
    expect(text(used)).toContain('Live tab: job "Tab job"');
    expect(data(await call('status')).liveTab).toEqual({ title: 'Tab job', dirty: false });
    expect(data(await call('import_model', { path: 'cam-part.dxf' })).status).toBe('imported');
    await call('apply_commands', { commands: [{ type: 'setStock', stock: { mode: 'auto', margin: { xy: 5, zTop: 1, zBottom: 6 } } }], label: 'Stock' });
    const catalog = data(await call('describe_geometry')) as { contours: { handle: string; layer: string }[] };
    const outline = catalog.contours.filter((c) => c.layer === 'OUTLINE').map((c) => c.handle);
    const added = await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: outline });
    expect(added.isError).toBeFalsy();
    const generated = data(await call('generate')) as { operations: { status: string }[] };
    expect(generated.operations.map((o) => o.status)).not.toContain('error');
    expect((await call('render_preview')).content[0].type).toBe('image');
    expect(tab.methods).toEqual(expect.arrayContaining(['apply', 'run', 'catalog', 'previewSvg', 'tools.list']));
  });

  it('never refuses to leave a live tab, and leaves a dirty file job only with discard', async () => {
    const bridge = await withBridge();
    const { call } = await connect({ bridge }, ['cam-part.dxf']);
    const tab = backingTab(bridge);
    await tab.welcomed;
    await call('new_job');
    await call('import_model', { path: 'cam-part.dxf' });
    expect(text(await call('use_live_tab'))).toBe('The current job has unsaved changes — save_job first, or pass discard: true');
    expect((await call('use_live_tab', { discard: true })).isError).toBeFalsy();
    expect((await call('new_job')).isError).toBeFalsy();
  });

  it('drops the session when the tab goes, and headless keeps working (review focus 5)', async () => {
    const bridge = await withBridge();
    const { call } = await connect({ bridge });
    const tab = backingTab(bridge);
    await tab.welcomed;
    await call('use_live_tab');
    tab.socket.close();
    await until(async () => text(await call('status')).startsWith('No job open. Use new_job, open_job or use_live_tab.'));
    expect(text(await call('get_job'))).toBe('No job open. Use new_job, open_job or use_live_tab.');
    expect((await call('new_job')).isError).toBeFalsy();
  });

  it('explains a bridge that could not start (review focus 3)', async () => {
    const first = await withBridge();
    if (first.state.status !== 'listening') throw new Error('first bridge did not start');
    const second = await withBridge(first.state.port);
    const { call } = await connect({ bridge: second });
    const r = await call('use_live_tab');
    expect(text(r)).toBe(`The live bridge is unavailable: port ${first.state.port} in use`);
    expect(text(await call('status'))).toContain(`live bridge unavailable: port ${first.state.port} in use`);
    expect((await call('new_job')).isError).toBeFalsy();
  });
});
