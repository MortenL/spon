import { BRIDGE_CLOSE, BRIDGE_PROTOCOL, REPLACED_MESSAGE } from '@sponcam/core';
import { describe, expect, it, vi } from 'vitest';
import { BridgeClient, type ClientOptions, type SocketLike } from './client';

class FakeSocket implements SocketLike {
  sent: any[] = [];
  closedWith: [number?, string?] | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: ((code: number, reason: string) => void) | null = null;
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close(code?: number, reason?: string) { this.closedWith = [code, reason]; }
  serverSays(msg: unknown) { this.onmessage?.(JSON.stringify(msg)); }
}

function setup(handlers: ClientOptions['handlers'] = {}) {
  const sockets: FakeSocket[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const statuses: [string, string | null][] = [];
  const stopped: string[] = [];
  let jobListener: ((p: { title: string; dirty: boolean }) => void) | null = null;
  const client = new BridgeClient({
    url: () => 'ws://127.0.0.1:5197',
    open: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    handlers,
    hello: () => ({ protocol: BRIDGE_PROTOCOL, app: 'spon-web', title: 'Job', dirty: false }),
    onStatus: (status, message) => statuses.push([status, message]),
    onStopped: (message) => stopped.push(message),
    subscribeJob: (listener) => { jobListener = listener; return () => { jobListener = null; }; },
    schedule: (fn, ms) => { timers.push({ fn, ms }); return () => {}; },
  });
  const connect = (i = sockets.length - 1) => { sockets[i].onopen?.(); sockets[i].serverSays({ jsonrpc: '2.0', method: 'welcome', params: { protocol: 1, server: 'x' } }); };
  return { client, sockets, timers, statuses, stopped, connect, job: (p: { title: string; dirty: boolean }) => jobListener?.(p) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('BridgeClient', () => {
  it('says hello with takeover on an explicit start, then reports connected', () => {
    const { client, sockets, statuses, connect } = setup();
    client.start(true);
    sockets[0].onopen?.();
    expect(sockets[0].sent[0]).toEqual({ jsonrpc: '2.0', method: 'hello', params: { protocol: BRIDGE_PROTOCOL, app: 'spon-web', title: 'Job', dirty: false, takeover: true } });
    connect(0);
    expect(statuses.at(-1)).toEqual(['connected', null]);
  });

  it('answers requests one at a time, in order, with results or errors', async () => {
    let releaseFirst!: () => void;
    const order: string[] = [];
    const { client, sockets, connect } = setup({
      job: async () => { order.push('job:start'); await new Promise<void>((r) => { releaseFirst = r; }); order.push('job:end'); return { name: 'J' }; },
      describe: async () => { order.push('describe'); return { kind: 'live' }; },
      apply: async () => { throw new Error('commands[0] updateOperation: No operation with id x'); },
    } as never);
    client.start(false);
    connect();
    const s = sockets[0];
    s.serverSays({ jsonrpc: '2.0', id: 1, method: 'job', params: {} });
    s.serverSays({ jsonrpc: '2.0', id: 2, method: 'describe', params: {} });
    s.serverSays({ jsonrpc: '2.0', id: 3, method: 'apply', params: {} });
    s.serverSays({ jsonrpc: '2.0', id: 4, method: 'nope', params: {} });
    await flush();
    expect(order).toEqual(['job:start']);
    releaseFirst();
    await flush();
    await flush();
    expect(order).toEqual(['job:start', 'job:end', 'describe']);
    expect(s.sent.slice(1)).toEqual([
      { jsonrpc: '2.0', id: 1, result: { name: 'J' } },
      { jsonrpc: '2.0', id: 2, result: { kind: 'live' } },
      { jsonrpc: '2.0', id: 3, error: { code: -32000, message: 'commands[0] updateOperation: No operation with id x' } },
      { jsonrpc: '2.0', id: 4, error: { code: -32601, message: 'Unknown method nope' } },
    ]);
  });

  it('reconnects with backoff from 1 s to 10 s, never taking over', () => {
    const { client, sockets, timers, statuses } = setup();
    client.start(true);
    for (let i = 0; i < 6; i++) {
      sockets.at(-1)!.onclose?.(1006, '');
      timers.at(-1)!.fn();
    }
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
    sockets.at(-1)!.onopen?.();
    expect(sockets.at(-1)!.sent[0].params.takeover).toBe(false);
    expect(statuses.at(-1)?.[0]).toBe('connecting');
  });

  it('resets the backoff after a successful connection', () => {
    const { client, sockets, timers, connect } = setup();
    client.start(false);
    sockets[0].onclose?.(1006, '');
    timers[0].fn();
    connect(1);
    sockets[1].onclose?.(1006, '');
    expect(timers.map((t) => t.ms)).toEqual([1000, 1000]);
  });

  it('keeps retrying while another tab holds the slot', () => {
    const { client, sockets, timers, statuses, stopped } = setup();
    client.start(false);
    sockets[0].onclose?.(BRIDGE_CLOSE.busy, 'Another Spon tab is connected');
    expect(timers).toHaveLength(1);
    expect(statuses.at(-1)).toEqual(['connecting', 'Another Spon tab is connected']);
    expect(stopped).toEqual([]);
  });

  it('stops for good when replaced or on a protocol mismatch', () => {
    for (const [code, reason] of [[BRIDGE_CLOSE.replaced, REPLACED_MESSAGE], [BRIDGE_CLOSE.protocolMismatch, 'Bridge protocol mismatch: server 1, tab 2.']] as const) {
      const { client, sockets, timers, stopped, connect } = setup();
      client.start(false);
      connect();
      sockets[0].onclose?.(code, reason);
      expect(timers).toEqual([]);
      expect(stopped).toEqual([reason]);
    }
  });

  it('sends jobChanged while connected, and stops cleanly', () => {
    const { client, sockets, timers, statuses, connect, job } = setup();
    client.start(false);
    connect();
    job({ title: 'Renamed', dirty: true });
    expect(sockets[0].sent.at(-1)).toEqual({ jsonrpc: '2.0', method: 'jobChanged', params: { title: 'Renamed', dirty: true } });
    client.stop();
    expect(sockets[0].closedWith).toEqual([1000, 'Disconnected']);
    sockets[0].onclose?.(1000, 'Disconnected');
    expect(timers).toEqual([]);
    expect(statuses.at(-1)).toEqual(['off', null]);
    job({ title: 'After', dirty: false });
    expect(sockets[0].sent.at(-1).params.title).toBe('Renamed');
  });
});

describe('BridgeClient with no handler for a request', () => {
  it('does not throw on malformed messages', () => {
    const { client, sockets, connect } = setup();
    client.start(false);
    connect();
    expect(() => sockets[0].onmessage?.('not json')).not.toThrow();
    vi.restoreAllMocks();
  });
});
