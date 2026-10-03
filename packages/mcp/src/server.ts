import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createContext, type ServerDeps } from './context';
import { INSTRUCTIONS } from './instructions';
import { registerResources } from './resources';
import { registerEditTools } from './tools/edit';
import { registerLibraryTools } from './tools/library';
import { registerOutputTools } from './tools/output';
import { registerSessionTools } from './tools/session';
import { registerTextTools } from './tools/text';
import { VERSION } from './version';

export type { ServerDeps } from './context';

export function createSponServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: 'spon', version: VERSION }, { instructions: INSTRUCTIONS });
  const ctx = createContext(deps);
  registerSessionTools(server, ctx);
  registerEditTools(server, ctx);
  registerTextTools(server, ctx);
  registerOutputTools(server, ctx);
  registerLibraryTools(server, ctx);
  registerResources(server, ctx);
  server.registerPrompt('spon-cam-basics', {
    title: 'Spon CAM basics',
    description: 'How to drive Spon: units, geometry handles and the usual order of tools.',
  }, () => ({ messages: [{ role: 'user', content: { type: 'text', text: INSTRUCTIONS } }] }));
  return server;
}
