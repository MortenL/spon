import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createContext, type ServerDeps } from './context';
import { INSTRUCTIONS } from './instructions';
import { registerEditTools } from './tools/edit';
import { registerSessionTools } from './tools/session';
import { VERSION } from './version';

export type { ServerDeps } from './context';

export function createSponServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: 'spon', version: VERSION }, { instructions: INSTRUCTIONS });
  const ctx = createContext(deps);
  registerSessionTools(server, ctx);
  registerEditTools(server, ctx);
  server.registerPrompt('spon-cam-basics', {
    title: 'Spon CAM basics',
    description: 'How to drive Spon: units, geometry handles and the usual order of tools.',
  }, () => ({ messages: [{ role: 'user', content: { type: 'text', text: INSTRUCTIONS } }] }));
  return server;
}
