import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { expect, test } from '@playwright/test';

const MCP = path.resolve(import.meta.dirname, '../../mcp');
const DIST = path.join(MCP, 'dist', 'spon-mcp.js');
const FIXTURES = path.resolve(import.meta.dirname, '../../core/test/fixtures');
const PORT = 5196;
const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');

test.beforeAll(() => {
  execFileSync(process.execPath, [path.join(MCP, 'scripts', 'build.mjs')], { cwd: MCP, stdio: 'pipe' });
});

test('Claude drives the open tab: each tool call is one undo step, the preview renders, closing the tab is reported', async ({ page }) => {
  test.setTimeout(120_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spon-live-'));
  fs.copyFileSync(path.join(FIXTURES, 'cam-part.dxf'), path.join(dir, 'cam-part.dxf'));
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
  const transport = new StdioClientTransport({
    command: process.execPath, args: [DIST, '--port', String(PORT)], cwd: dir, env: { ...env, SPON_TOOL_LIBRARY: path.join(dir, 'tools.json') }, stderr: 'pipe',
  });
  const client = new Client({ name: 'spon-live-e2e', version: '0.0.0' });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
    if (r.isError) throw new Error(`${name}: ${text(r)}`);
    return r;
  };
  try {
    await page.addInitScript((port) => localStorage.setItem('spon.bridge.port', String(port)), PORT);
    await page.goto('/');
    await page.getByTestId('bridge-toggle').click();
    await expect(page.getByTestId('bridge-toggle')).toHaveAttribute('data-status', 'connected');

    await call('use_live_tab');
    await call('import_model', { path: 'cam-part.dxf' });
    await call('apply_commands', { commands: [{ type: 'setStock', stock: { mode: 'auto', margin: { xy: 5, zTop: 1, zBottom: 6 } } }], label: 'Stock 6 mm' });
    await expect(page.getByText('Claude: Stock 6 mm')).toBeVisible();
    const catalog = (await call('describe_geometry')).structuredContent as { contours: { handle: string; layer: string }[] };
    const outline = catalog.contours.filter((c) => c.layer === 'OUTLINE').map((c) => c.handle);
    await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: outline, params: { tabs: { enabled: true } } });
    await expect(page.locator('[data-testid^="op-row-"]')).toHaveCount(1);
    await expect(page.getByText(/Claude: Add Profile on/)).toBeVisible();

    const generated = (await call('generate')).structuredContent as { operations: { status: string }[] };
    expect(generated.operations.map((o) => o.status)).not.toContain('error');
    const image = (await call('render_preview', { view: 'iso' })).content[0];
    expect(image.type === 'image' && Array.from(Buffer.from(image.data, 'base64').subarray(0, 4))).toEqual([137, 80, 78, 71]);

    // one Ctrl+Z undoes the whole add_operation call
    await page.locator('body').press('Control+z');
    await expect(page.locator('[data-testid^="op-row-"]')).toHaveCount(0);
    expect((await call('get_job', { section: 'operations' })).structuredContent).toEqual({ operations: [] });

    await page.close();
    await expect.poll(async () => text((await client.callTool({ name: 'status', arguments: {} })) as CallToolResult)).toContain('No job open');
    expect((await client.callTool({ name: 'new_job', arguments: {} })).isError).toBeFalsy();
  } finally {
    await client.close();
  }
});
