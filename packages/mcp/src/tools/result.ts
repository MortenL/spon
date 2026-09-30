import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import { debugLog } from '../log';

export type Args<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;

export const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function ok(text: string, data?: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text }], ...(data ? { structuredContent: data } : {}) };
}

export function failure(err: unknown): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message(err) }] };
}

/** Runs a tool body; anything it throws becomes an isError result, never a protocol error. */
export function guarded<A>(name: string, body: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    debugLog(`${name} ${JSON.stringify(args)}`);
    try {
      return await body(args);
    } catch (err) {
      debugLog(`${name} failed: ${message(err)}`);
      return failure(err);
    }
  };
}
