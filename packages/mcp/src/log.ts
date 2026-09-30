/** Stdout carries the MCP protocol, so everything the server says goes to stderr. */
export function log(message: string): void {
  process.stderr.write(`[spon-mcp] ${message}\n`);
}

export function debugLog(message: string): void {
  if (process.env.SPON_MCP_LOG === 'debug') log(message);
}
