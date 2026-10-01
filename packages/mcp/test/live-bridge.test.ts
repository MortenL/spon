import { connect } from 'node:net';
import { BRIDGE_CLOSE, REPLACED_MESSAGE } from '@sponcam/core';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORIGINS, LiveBridge } from '../src/live/bridge';
import { openTab } from './fakeTab';

const bridges: LiveBridge[] = [];
async function started(options: Partial<ConstructorParameters<typeof LiveBridge>[0]> = {}) {
  const bridge = new LiveBridge({ port: 0, serverVersion: 'test', ...options });
  bridges.push(bridge);
  const state = await bridge.start();
  if (state.status !== 'listening') throw new Error(`bridge did not start: ${JSON.stringify(state)}`);
  return { bridge, port: state.port };
}
const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
};

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((b) => b.close()));
});

describe('LiveBridge', () => {
  it('allows the dev, preview and test origins by default', () => {
    expect(DEFAULT_ORIGINS).toEqual(expect.arrayContaining(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://localhost:5198', 'http://127.0.0.1:5199']));
  });

  it('refuses unknown and missing origins, accepts allowed and extra ones', async () => {
    const { port } = await started({ allowedOrigins: [...DEFAULT_ORIGINS, 'http://spon.local:8080'] });
    expect(await openTab(port, { origin: 'http://evil.example' }).opened).toBe(false);
    expect(await openTab(port, { origin: null }).opened).toBe(false);
    const extra = openTab(port, { origin: 'http://spon.local:8080' });
    await extra.welcomed;
    extra.socket.close();
  });

  it('closes a tab that speaks another protocol', async () => {
    const { bridge, port } = await started();
    const tab = openTab(port, { protocol: 2 });
    const { code, reason } = await tab.closed;
    expect(code).toBe(BRIDGE_CLOSE.protocolMismatch);
    expect(reason).toContain('protocol');
    expect(bridge.tab).toBeNull();
  });

  it('keeps the first tab unless the second one takes over', async () => {
    const { bridge, port } = await started();
    const gone: unknown[] = [];
    bridge.onTabGone((t) => gone.push(t));
    const first = openTab(port, { title: 'First' });
    await first.welcomed;
    const auto = openTab(port);
    expect(await auto.closed).toEqual({ code: BRIDGE_CLOSE.busy, reason: 'Another Spon tab is connected' });
    expect(bridge.tab?.title).toBe('First');
    const firstTab = bridge.tab;
    const second = openTab(port, { takeover: true, title: 'Second' });
    await second.welcomed;
    expect(await first.closed).toEqual({ code: BRIDGE_CLOSE.replaced, reason: REPLACED_MESSAGE });
    expect(bridge.tab?.title).toBe('Second');
    expect(gone).toEqual([firstTab]);
  });

  it('sends requests and settles them with results and errors', async () => {
    const { bridge, port } = await started();
    const tab = openTab(port, {
      handle: (method, params) => {
        if (method === 'apply') throw new Error('commands[0] updateOperation: No operation with id nope');
        return { echo: method, params };
      },
    });
    await tab.welcomed;
    expect(await bridge.tab!.request('describe', {})).toEqual({ echo: 'describe', params: {} });
    await expect(bridge.tab!.request('apply', { commands: [], label: 'x' })).rejects.toThrow('commands[0] updateOperation: No operation with id nope');
  });

  it('times out a silent tab, with the long timeout for importModel only (review focus 4)', async () => {
    const { bridge, port } = await started({ timeouts: { normal: 50, long: 400 } });
    const tab = openTab(port, { handle: () => new Promise(() => {}) });
    await tab.welcomed;
    await expect(bridge.tab!.request('job', {})).rejects.toThrow('The tab did not answer within 0.05 s');
    const started_ = Date.now();
    await expect(bridge.tab!.request('importModel', { fileName: 'a.stl', bytes: '' })).rejects.toThrow('The tab did not answer within 0.4 s');
    expect(Date.now() - started_).toBeGreaterThanOrEqual(350);
  });

  it('fails a pending request when the tab disconnects (review focus 5)', async () => {
    const { bridge, port } = await started();
    const tab = openTab(port, { handle: () => new Promise(() => {}) });
    await tab.welcomed;
    const pending = bridge.tab!.request('run', {});
    tab.socket.terminate();
    await expect(pending).rejects.toThrow('Tab disconnected');
    await until(() => bridge.tab === null);
  });

  it('tracks the tab title and dirty flag', async () => {
    const { bridge, port } = await started();
    const tab = openTab(port, { title: 'Before' });
    await tab.welcomed;
    tab.send({ jsonrpc: '2.0', method: 'jobChanged', params: { title: 'After', dirty: true } });
    await until(() => bridge.tab?.title === 'After');
    expect(bridge.tab!.dirty).toBe(true);
  });

  it('reports a port in use and keeps running without live (review focus 3)', async () => {
    const { port } = await started();
    const second = new LiveBridge({ port, serverVersion: 'test' });
    bridges.push(second);
    expect(await second.start()).toEqual({ status: 'unavailable', reason: `port ${port} in use` });
    expect(second.describe()).toBe(`live bridge unavailable: port ${port} in use`);
  });

  it('closes a socket that never says hello', async () => {
    const { port } = await started({ helloTimeoutMs: 50 });
    const { WebSocket } = await import('ws');
    const silent = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'http://localhost:5173' });
    const code = await new Promise<number>((resolve) => silent.once('close', (c) => resolve(c)));
    expect(code).toBe(1008);
  });

  it('survives an invalid frame before hello and still accepts a tab', async () => {
    const { bridge, port } = await started();
    const raw = connect(port, '127.0.0.1');
    raw.on('error', () => {});
    const upgrade = [
      'GET / HTTP/1.1', `Host: 127.0.0.1:${port}`, 'Upgrade: websocket', 'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version: 13', 'Origin: http://localhost:5173', '', '',
    ].join('\r\n');
    raw.write(upgrade);
    await new Promise<void>((resolve) => raw.once('data', () => resolve()));
    raw.write(Buffer.from([0x81, 0x01, 0x41])); // unmasked client text frame: protocol error
    await new Promise<void>((resolve) => { raw.once('close', () => resolve()); setTimeout(resolve, 500); });
    raw.destroy();
    const tab = openTab(port);
    await tab.welcomed;
    expect(bridge.tab).not.toBeNull();
  });

  it('ignores malformed messages from a connected tab', async () => {
    const { bridge, port } = await started();
    const tab = openTab(port);
    await tab.welcomed;
    tab.socket.send('null');
    tab.socket.send('"text"');
    tab.socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'jobChanged' }));
    expect(await bridge.tab!.request('describe', {})).toEqual({});
    expect(bridge.tab!.title).toBe('Tab job');
  });
});
