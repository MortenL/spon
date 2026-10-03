let suppressed = 0;
/** Runs `fn` (synchronously) without automatic panel switches, e.g. the startup restore, which must keep the remembered panel. */
export function withoutAutoPanel<T>(fn: () => T): T {
  suppressed++;
  try { return fn(); } finally { suppressed--; }
}
export const autoPanelSuppressed = (): boolean => suppressed > 0;
