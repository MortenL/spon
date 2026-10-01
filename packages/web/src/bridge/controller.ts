import { BRIDGE_PROTOCOL } from '@sponcam/core';
import { appStore } from '../state/store';
import { BridgeClient, browserSocket } from './client';
import { handlers } from './handlers';
import { bridgeStatus, bridgeUrl, ENABLED_KEY, writeSetting } from './status';

/** Loaded on first enable (see setBridgeEnabled): the client, the handlers and the socket stay out of the main bundle until then. */
const client = new BridgeClient({
  url: bridgeUrl,
  open: browserSocket,
  handlers,
  hello: () => ({ protocol: BRIDGE_PROTOCOL, app: 'spon-web', title: appStore.getState().job.name, dirty: appStore.getState().dirty }),
  onStatus: (status, message) => bridgeStatus.setState({ status, message }),
  onStopped: (message) => {
    writeSetting(ENABLED_KEY, null);
    bridgeStatus.setState({ status: 'off', message });
  },
  subscribeJob: (listener) => appStore.subscribe((s, prev) => {
    if (s.job.name !== prev.job.name || s.dirty !== prev.dirty) listener({ title: s.job.name, dirty: s.dirty });
  }),
});

export const bridgeController = {
  start: (takeover: boolean) => client.start(takeover),
  stop: () => client.stop(),
};
