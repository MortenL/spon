import { DEFAULT_BRIDGE_PORT } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { bridgeEnabled, bridgeStatus, bridgeUrl, readSetting, writeSetting } from './status';

describe('bridge settings', () => {
  it('works without localStorage (node, private windows) and starts off', () => {
    expect(() => writeSetting('spon.bridge.enabled', '1')).not.toThrow();
    expect(readSetting('spon.bridge.enabled')).toBeNull();
    expect(bridgeEnabled()).toBe(false);
    expect(bridgeUrl()).toBe(`ws://127.0.0.1:${DEFAULT_BRIDGE_PORT}`);
    expect(bridgeStatus.getState()).toEqual({ status: 'off', message: null });
  });
});
