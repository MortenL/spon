import { BRIDGE_CLOSE, BRIDGE_IMPORT_TIMEOUT_MS, BRIDGE_TIMEOUT_MS, BUSY_MESSAGE, type HelloParams, type JobChangedParams } from '@sponcam/core';
import type { BridgeStatus } from './status';

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: ((code: number, reason: string) => void) | null;
}

/** The browser WebSocket behind the SocketLike shape. */
export function browserSocket(url: string): SocketLike {
  const ws = new WebSocket(url);
  const socket: SocketLike = {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    onopen: null, onmessage: null, onclose: null,
  };
  ws.onopen = () => socket.onopen?.();
  ws.onmessage = (e) => socket.onmessage?.(String(e.data));
  ws.onclose = (e) => socket.onclose?.(e.code, e.reason);
  return socket;
}

export interface ClientOptions {
  url(): string;
  open(url: string): SocketLike;
  handlers: Record<string, ((params: any) => Promise<unknown>) | undefined>;
  hello(): Omit<HelloParams, 'takeover'>;
  onStatus(status: BridgeStatus, message: string | null): void;
  /** The server ended the connection for good (replaced by another tab, or a protocol mismatch). */
  onStopped(message: string): void;
  subscribeJob(listener: (params: JobChangedParams) => void): () => void;
  schedule?(fn: () => void, ms: number): () => void;
  /** The clock used to drop requests that waited longer than the server's timeout. */
  now?(): number;
}

const MIN_DELAY = 1000;
const MAX_DELAY = 10_000;
const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/** Connects the tab to the MCP server's bridge and answers its requests one at a time. */
export class BridgeClient {
  private enabled = false;
  private socket: SocketLike | null = null;
  private delay = MIN_DELAY;
  private cancelRetry: (() => void) | null = null;
  private unsubscribeJob: (() => void) | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: ClientOptions) {}

  start(takeover: boolean): void {
    this.stopSocket();
    this.enabled = true;
    this.delay = MIN_DELAY;
    this.connect(takeover);
  }

  stop(): void {
    this.enabled = false;
    this.stopSocket();
    this.options.onStatus('off', null);
  }

  private stopSocket(): void {
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.unsubscribeJob?.();
    this.unsubscribeJob = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.close(1000, 'Disconnected');
    }
  }

  private connect(takeover: boolean, message: string | null = null): void {
    this.options.onStatus('connecting', message);
    const socket = this.options.open(this.options.url());
    this.socket = socket;
    const send = (msg: unknown) => socket.send(JSON.stringify(msg));
    socket.onopen = () => send({ jsonrpc: '2.0', method: 'hello', params: { ...this.options.hello(), takeover } });
    socket.onmessage = (data) => this.receive(socket, data, send);
    socket.onclose = (code, reason) => this.closed(socket, code, reason);
  }

  private receive(socket: SocketLike, data: string, send: (msg: unknown) => void): void {
    let msg: { id?: number; method?: string; params?: unknown };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.method === 'welcome') {
      this.delay = MIN_DELAY;
      this.unsubscribeJob?.();
      this.unsubscribeJob = this.options.subscribeJob((params) => send({ jsonrpc: '2.0', method: 'jobChanged', params }));
      this.options.onStatus('connected', null);
      return;
    }
    if (typeof msg.id !== 'number' || !msg.method) return;
    const { id, method, params } = msg;
    const arrived = (this.options.now ?? Date.now)();
    this.queue = this.queue.then(async () => {
      // the server has already given up on a request from a dead connection or one that waited past its timeout
      if (socket !== this.socket) return;
      const limit = method === 'importModel' ? BRIDGE_IMPORT_TIMEOUT_MS : BRIDGE_TIMEOUT_MS;
      if ((this.options.now ?? Date.now)() - arrived >= limit) return;
      const handler = this.options.handlers[method];
      if (!handler) {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method ${method}` } });
        return;
      }
      try {
        send({ jsonrpc: '2.0', id, result: await handler(params ?? {}) });
      } catch (err) {
        send({ jsonrpc: '2.0', id, error: { code: -32000, message: err instanceof Error ? err.message : String(err) } });
      }
    }).catch(() => {});
  }

  private closed(socket: SocketLike, code: number, reason: string): void {
    if (socket !== this.socket) return;
    this.socket = null;
    this.unsubscribeJob?.();
    this.unsubscribeJob = null;
    if (!this.enabled) return;
    if (code === BRIDGE_CLOSE.replaced || code === BRIDGE_CLOSE.protocolMismatch) {
      this.enabled = false;
      this.options.onStopped(reason);
      return;
    }
    const message = code === BRIDGE_CLOSE.busy ? BUSY_MESSAGE : null;
    this.options.onStatus('connecting', message);
    const delay = this.delay;
    this.delay = Math.min(this.delay * 2, MAX_DELAY);
    this.cancelRetry = (this.options.schedule ?? defaultSchedule)(() => {
      this.cancelRetry = null;
      if (this.enabled) this.connect(false, message);
    }, delay);
  }
}
