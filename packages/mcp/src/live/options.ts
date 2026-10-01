import { DEFAULT_BRIDGE_PORT } from '@sponcam/core';
import { log } from '../log';
import { DEFAULT_ORIGINS } from './bridge';

const valid = (n: number) => Number.isInteger(n) && n >= 0 && n <= 65535;

/** `--port <n>` or `--port=<n>`, then SPON_BRIDGE_PORT, then 5197. Port 0 picks any free port (tests). */
export function bridgePort(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  let raw: string | undefined;
  argv.forEach((arg, i) => {
    if (arg === '--port') raw = argv[i + 1];
    else if (arg.startsWith('--port=')) raw = arg.slice('--port='.length);
  });
  raw ??= env.SPON_BRIDGE_PORT;
  if (raw === undefined || raw === '') return DEFAULT_BRIDGE_PORT;
  const port = Number(raw);
  if (valid(port)) return port;
  log(`ignoring bridge port "${raw}"; using ${DEFAULT_BRIDGE_PORT}`);
  return DEFAULT_BRIDGE_PORT;
}

export function allowedOrigins(env: NodeJS.ProcessEnv): string[] {
  const extra = (env.SPON_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...DEFAULT_ORIGINS, ...extra];
}
