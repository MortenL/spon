import { BRIDGE_PROTOCOL } from '@sponcam/core';
import { WebSocket } from 'ws';

export type Handle = (method: string, params: any) => unknown;

export interface FakeTabOptions {
  /** null: send no Origin header. Default http://localhost:5173. */
  origin?: string | null;
  protocol?: number;
  takeover?: boolean;
  title?: string;
  handle?: Handle;
}

export interface FakeTab {
  socket: WebSocket;
  /** true once the WebSocket opened, false if the handshake was refused. */
  opened: Promise<boolean>;
  /** Resolves on the server's welcome. */
  welcomed: Promise<void>;
  closed: Promise<{ code: number; reason: string }>;
  methods: string[];
  send(message: unknown): void;
}

/** A browser tab, played by a Node WebSocket: says hello, answers requests with `handle`, replies with JSON-RPC errors when it throws. */
export function openTab(port: number, options: FakeTabOptions = {}): FakeTab {
  const origin = options.origin === undefined ? 'http://localhost:5173' : options.origin;
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, origin === null ? {} : { origin });
  const methods: string[] = [];
  const send = (message: unknown) => socket.send(JSON.stringify(message));
  let welcome!: () => void;
  const welcomed = new Promise<void>((resolve) => { welcome = resolve; });
  const opened = new Promise<boolean>((resolve) => {
    socket.once('open', () => resolve(true));
    socket.once('error', () => resolve(false));
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  socket.on('open', () => send({
    jsonrpc: '2.0', method: 'hello',
    params: { protocol: options.protocol ?? BRIDGE_PROTOCOL, app: 'fake-tab', title: options.title ?? 'Tab job', dirty: false, takeover: options.takeover ?? false },
  }));
  socket.on('message', async (data) => {
    const msg = JSON.parse(String(data));
    if (msg.method === 'welcome') return welcome();
    if (msg.id === undefined || !msg.method) return;
    methods.push(msg.method);
    try {
      const result = await (options.handle ?? (() => ({})))(msg.method, msg.params);
      send({ jsonrpc: '2.0', id: msg.id, result: result ?? {} });
    } catch (err) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: err instanceof Error ? err.message : String(err) } });
    }
  });
  return { socket, opened, welcomed, closed, methods, send };
}
