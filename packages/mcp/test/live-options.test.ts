import { DEFAULT_BRIDGE_PORT } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ORIGINS } from '../src/live/bridge';
import { allowedOrigins, bridgePort } from '../src/live/options';

describe('bridge options', () => {
  it('takes the port from --port, then SPON_BRIDGE_PORT, then the default', () => {
    expect(bridgePort([], {})).toBe(DEFAULT_BRIDGE_PORT);
    expect(bridgePort([], { SPON_BRIDGE_PORT: '6001' })).toBe(6001);
    expect(bridgePort(['--port', '6002'], { SPON_BRIDGE_PORT: '6001' })).toBe(6002);
    expect(bridgePort(['--port=0'], {})).toBe(0);
    expect(bridgePort(['--port', 'abc'], {})).toBe(DEFAULT_BRIDGE_PORT);
    expect(bridgePort([], { SPON_BRIDGE_PORT: '70000' })).toBe(DEFAULT_BRIDGE_PORT);
  });

  it('adds SPON_ALLOWED_ORIGINS to the default origins', () => {
    expect(allowedOrigins({})).toEqual(DEFAULT_ORIGINS);
    expect(allowedOrigins({ SPON_ALLOWED_ORIGINS: ' http://a.local:1 ,http://b.local:2,' })).toEqual([...DEFAULT_ORIGINS, 'http://a.local:1', 'http://b.local:2']);
  });
});
