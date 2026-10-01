import { DEFAULT_BRIDGE_PORT } from '@sponcam/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export type BridgeStatus = 'off' | 'connecting' | 'connected';
export interface BridgeView { status: BridgeStatus; message: string | null }

/** Always loaded and tiny: the status bar reads it. The client itself loads on first enable. */
export const bridgeStatus = createStore<BridgeView>(() => ({ status: 'off', message: null }));
export const useBridgeStatus = (): BridgeView => useStore(bridgeStatus);

export const ENABLED_KEY = 'spon.bridge.enabled';
export const PORT_KEY = 'spon.bridge.port';

export function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSetting(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the bridge just won't be remembered
  }
}

export const bridgeEnabled = (): boolean => readSetting(ENABLED_KEY) === '1';

export function bridgeUrl(): string {
  const port = Number(readSetting(PORT_KEY));
  return `ws://127.0.0.1:${Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_BRIDGE_PORT}`;
}

/** Turns the bridge on or off and remembers it. `takeover`: an explicit click takes the connection from another tab. */
export async function setBridgeEnabled(on: boolean, takeover: boolean): Promise<void> {
  writeSetting(ENABLED_KEY, on ? '1' : null);
  const { bridgeController } = await import('./controller');
  if (on) bridgeController.start(takeover);
  else bridgeController.stop();
}

/** On startup: reconnects if the user left the bridge on. Never takes over another tab. */
export function resumeBridge(): void {
  if (bridgeEnabled()) void setBridgeEnabled(true, false);
}
