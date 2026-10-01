import type { AddressInfo } from 'node:net';
import { BRIDGE_CLOSE, BRIDGE_PROTOCOL, BUSY_MESSAGE, type HelloParams, REPLACED_MESSAGE } from '@sponcam/core';
import { type WebSocket, WebSocketServer } from 'ws';
import { debugLog, log } from '../log';
import { DEFAULT_TIMEOUTS, TabConnection, type Timeouts } from './connection';

/** A saveBytes reply carries a whole .spon base64-encoded; the web app accepts models up to 200 MB. */
export const MAX_PAYLOAD_BYTES = 512 * 1024 * 1024;

export const DEFAULT_ORIGINS: string[] = [5173, 4173, 5198, 5199].flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]);

export interface BridgeOptions {
  port: number;
  allowedOrigins?: readonly string[];
  timeouts?: Timeouts;
  serverVersion: string;
  helloTimeoutMs?: number;
}

export type BridgeState =
  | { status: 'starting' }
  | { status: 'listening'; port: number }
  | { status: 'unavailable'; reason: string }
  | { status: 'closed' };

/** The WebSocket server the browser tab connects to: loopback only, allowed origins only, one tab at a time. */
export class LiveBridge {
  state: BridgeState = { status: 'starting' };
  tab: TabConnection | null = null;
  private server: WebSocketServer | null = null;
  private readonly origins: Set<string>;
  private readonly goneListeners: ((tab: TabConnection) => void)[] = [];

  constructor(private readonly options: BridgeOptions) {
    this.origins = new Set(options.allowedOrigins ?? DEFAULT_ORIGINS);
  }

  start(): Promise<BridgeState> {
    return new Promise((resolve) => {
      const server = new WebSocketServer({
        host: '127.0.0.1', port: this.options.port, maxPayload: MAX_PAYLOAD_BYTES,
        // browsers always send a truthful Origin; no Origin means a non-browser client, which is refused too
        verifyClient: (info: { origin?: string }) => info.origin !== undefined && this.origins.has(info.origin),
      });
      server.once('listening', () => {
        this.server = server;
        this.state = { status: 'listening', port: (server.address() as AddressInfo).port };
        server.on('error', (err) => log(`live bridge error: ${err.message}`));
        log(`live bridge listening on ws://127.0.0.1:${this.state.port}`);
        resolve(this.state);
      });
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (this.state.status !== 'starting') return;
        const reason = err.code === 'EADDRINUSE' ? `port ${this.options.port} in use` : err.message;
        this.state = { status: 'unavailable', reason };
        log(`live bridge unavailable: ${reason}`);
        server.close();
        resolve(this.state);
      });
      server.on('connection', (socket) => this.accept(socket));
    });
  }

  describe(): string {
    switch (this.state.status) {
      case 'listening': return `listening on ws://127.0.0.1:${this.state.port}`;
      case 'unavailable': return `live bridge unavailable: ${this.state.reason}`;
      default: return `live bridge ${this.state.status}`;
    }
  }

  /** Called when a tab's connection ends (closed, lost or replaced). */
  onTabGone(listener: (tab: TabConnection) => void): void {
    this.goneListeners.push(listener);
  }

  async close(): Promise<void> {
    this.tab?.close(1001, 'Server closing');
    const server = this.server;
    this.server = null;
    this.state = { status: 'closed' };
    if (!server) return;
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    // a frozen tab or a socket that never said hello would keep close() waiting for ws's 30 s timeout
    for (const client of server.clients) client.terminate();
    await closed;
  }

  private accept(socket: WebSocket): void {
    const timer = setTimeout(() => socket.close(1008, 'Expected hello'), this.options.helloTimeoutMs ?? 10_000);
    // ws emits 'error' on an invalid frame; with no listener that would crash the process
    socket.on('error', (err) => debugLog(`socket error before hello: ${err.message}`));
    socket.once('close', () => clearTimeout(timer));
    socket.once('message', (data) => {
      clearTimeout(timer);
      let hello: HelloParams | null = null;
      try {
        const msg = JSON.parse(String(data));
        if (msg.method === 'hello') hello = msg.params as HelloParams;
      } catch {
        // not JSON: refused below
      }
      if (!hello) {
        socket.close(1008, 'Expected hello');
        return;
      }
      if (hello.protocol !== BRIDGE_PROTOCOL) {
        log(`refused a tab speaking bridge protocol ${hello.protocol} (this server speaks ${BRIDGE_PROTOCOL})`);
        socket.close(BRIDGE_CLOSE.protocolMismatch, `Bridge protocol mismatch: server ${BRIDGE_PROTOCOL}, tab ${hello.protocol}. Reload the tab or update the server.`);
        return;
      }
      if (this.tab?.open && !hello.takeover) {
        socket.close(BRIDGE_CLOSE.busy, BUSY_MESSAGE);
        return;
      }
      const previous = this.tab;
      const tab = new TabConnection(socket, hello, this.options.timeouts ?? DEFAULT_TIMEOUTS);
      this.tab = tab;
      tab.onClose(() => {
        if (this.tab === tab) this.tab = null;
        for (const listener of this.goneListeners) listener(tab);
      });
      previous?.close(BRIDGE_CLOSE.replaced, REPLACED_MESSAGE);
      tab.notify('welcome', { protocol: BRIDGE_PROTOCOL, server: this.options.serverVersion });
      log(`tab connected: "${hello.title}"`);
    });
  }
}
