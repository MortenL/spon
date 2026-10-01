import {
  BRIDGE_IMPORT_TIMEOUT_MS, BRIDGE_TIMEOUT_MS, type BridgeMethod, type BridgeParams, type BridgeResult, type HelloParams, type JobChangedParams,
} from '@sponcam/core';
import type { WebSocket } from 'ws';
import { debugLog } from '../log';
import { SessionError } from '../session';

export interface Timeouts { normal: number; long: number }
export const DEFAULT_TIMEOUTS: Timeouts = { normal: BRIDGE_TIMEOUT_MS, long: BRIDGE_IMPORT_TIMEOUT_MS };

interface Pending { resolve(value: unknown): void; reject(err: Error): void; timer: ReturnType<typeof setTimeout> }

/** One connected tab: JSON-RPC requests out, responses and jobChanged notifications in. */
export class TabConnection {
  title: string;
  dirty: boolean;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closedReason: string | null = null;
  private readonly closeListeners: (() => void)[] = [];

  constructor(private readonly socket: WebSocket, hello: HelloParams, private readonly timeouts: Timeouts = DEFAULT_TIMEOUTS) {
    this.title = hello.title;
    this.dirty = hello.dirty;
    socket.on('message', (data) => this.receive(String(data)));
    socket.on('close', () => this.closed('Tab disconnected'));
    socket.on('error', (err) => debugLog(`tab socket error: ${err.message}`));
  }

  get open(): boolean {
    return this.closedReason === null;
  }

  request<M extends BridgeMethod>(method: M, params: BridgeParams<M>): Promise<BridgeResult<M>> {
    if (this.closedReason) return Promise.reject(new SessionError(this.closedReason));
    const id = this.nextId++;
    const ms = method === 'importModel' ? this.timeouts.long : this.timeouts.normal;
    debugLog(`→ tab ${method} #${id}`);
    return new Promise<BridgeResult<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SessionError(`The tab did not answer within ${ms / 1000} s`));
      }, ms);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  notify(method: string, params: unknown): void {
    if (this.open) this.socket.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

  close(code: number, reason: string): void {
    this.socket.close(code, reason);
    this.closed('Tab disconnected');
  }

  private receive(text: string): void {
    let msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(text);
    } catch {
      debugLog('tab sent a message that is not JSON');
      return;
    }
    if (typeof msg.id === 'number' && !msg.method) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new SessionError(msg.error.message ?? 'The tab reported an error'));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'jobChanged') {
      const { title, dirty } = msg.params as JobChangedParams;
      this.title = title;
      this.dirty = dirty;
    }
  }

  private closed(reason: string): void {
    if (this.closedReason) return;
    this.closedReason = reason;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new SessionError(reason));
    }
    this.pending.clear();
    for (const listener of this.closeListeners) listener();
  }
}
