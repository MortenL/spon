import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './context';
import { SessionError } from './session';

/** Read-only views of the open job. Reading the catalog assigns handles, like describe_geometry. */
export function registerResources(server: McpServer, ctx: ToolContext): void {
  const { state } = ctx;
  const json = (uri: URL, value: unknown) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }] });

  server.registerResource('job', 'spon://job', { title: 'Open job', mimeType: 'application/json' },
    async (uri) => json(uri, await state.requireSession().job()));

  server.registerResource('catalog', 'spon://catalog', { title: 'Geometry catalog with handles', mimeType: 'application/json' },
    async (uri) => {
      const catalog = await state.requireSession().catalog();
      return json(uri, catalog ? state.handles.assign(catalog) : null);
    });

  server.registerResource('gcode', new ResourceTemplate('spon://gcode/{file}', {
    list: async () => {
      if (!state.session) return { resources: [] };
      const run = await state.session.run();
      return { resources: run.files.map((f) => ({ uri: `spon://gcode/${encodeURIComponent(f.name)}`, name: f.name, mimeType: 'text/plain' })) };
    },
  }), { title: 'Posted G-code', mimeType: 'text/plain' }, async (uri, { file }) => {
    const name = decodeURIComponent(String(file));
    const posted = (await state.requireSession().run()).files.find((f) => f.name === name);
    if (!posted) throw new SessionError(`No posted file ${name}`);
    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: posted.text }] };
  });
}
