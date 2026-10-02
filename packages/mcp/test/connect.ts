import { copyFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolLibraryFile } from '../src/library';
import { loadNodeOcct } from '../src/occt';
import { createSponServer, type ServerDeps } from '../src/server';
import { fixturePath, tempDir } from './helpers';

/** A server and client joined in memory, working in a fresh temporary directory holding copies of `files`. */
export async function connect(overrides: Partial<ServerDeps> = {}, files: string[] = []) {
  const dir = tempDir();
  for (const f of files) copyFileSync(fixturePath(f), join(dir, basename(f)));
  const deps: ServerDeps = {
    cwd: dir, library: new ToolLibraryFile(join(dir, 'tools.json')), loadReader: loadNodeOcct,
    rasterize: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), postDate: '2026-01-01', ...overrides,
  };
  const server = createSponServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'spon-test', version: '0.0.0' });
  await client.connect(clientTransport);
  /** Argument validation failures, which the SDK may throw instead of returning, come back as isError results too. */
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> => {
    try {
      return (await client.callTool({ name, arguments: args })) as CallToolResult;
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }] };
    }
  };
  return { client, call, dir, deps };
}

export const text = (r: CallToolResult): string => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
export const data = <T = Record<string, any>>(r: CallToolResult): T => r.structuredContent as T;
