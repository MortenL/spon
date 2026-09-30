import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { machinePreset, parseProgram } from '@sponcam/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { fixturePath, tempDir } from './helpers';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(PKG, 'dist', 'spon-mcp.js');

beforeAll(() => {
  execFileSync(process.execPath, [join(PKG, 'scripts', 'build.mjs')], { cwd: PKG, stdio: 'pipe' });
}, 120_000);

describe('spon-mcp over stdio', () => {
  it('keeps occt-import-js out of the bundle', () => {
    const bundle = readFileSync(DIST, 'utf8');
    expect(bundle.startsWith('#!/usr/bin/env node')).toBe(true);
    expect(bundle).toMatch(/requireFromHere\d*\("occt-import-js"\)/);
    expect(bundle).not.toContain('occt-import-js.wasm');
  });

  it('keeps the stream clean when reading IGES (occt-import-js prints to stdout by default)', async () => {
    const dir = tempDir();
    copyFileSync(fixturePath('box.iges'), join(dir, 'box.iges'));
    const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
    const transport = new StdioClientTransport({
      command: process.execPath, args: [DIST], cwd: dir, env: { ...env, SPON_TOOL_LIBRARY: join(dir, 'tools.json') }, stderr: 'pipe',
    });
    const errors: Error[] = [];
    const client = new Client({ name: 'spon-e2e', version: '0.0.0' });
    client.onerror = (e) => errors.push(e);
    transport.onerror = (e) => errors.push(e);
    await client.connect(transport);
    try {
      await client.callTool({ name: 'new_job', arguments: { name: 'Iges' } });
      const r = (await client.callTool({ name: 'import_model', arguments: { path: 'box.iges' } })) as CallToolResult;
      expect(r.isError).toBeFalsy();
      await client.callTool({ name: 'session_info', arguments: {} });
      expect(errors.map((e) => e.message)).toEqual([]);
    } finally {
      await client.close();
    }
  }, 120_000);

  it('runs the Milestone 3 flow: DXF → profile with tabs, pocket, drill → GRBL → export and save', async () => {
    const dir = tempDir();
    copyFileSync(fixturePath('cam-part.dxf'), join(dir, 'cam-part.dxf'));
    const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
    const transport = new StdioClientTransport({
      command: process.execPath, args: [DIST], cwd: dir, env: { ...env, SPON_TOOL_LIBRARY: join(dir, 'tools.json') }, stderr: 'pipe',
    });
    const client = new Client({ name: 'spon-e2e', version: '0.0.0' });
    await client.connect(transport);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
      if (r.isError) throw new Error(`${name}: ${r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')}`);
      return r;
    };
    try {
      await call('new_job', { name: 'Part', dialect: 'grbl' });
      await call('import_model', { path: 'cam-part.dxf' });
      // a DXF is flat: give it 6 mm of stock under the drawing, as the web app's Milestone 3 e2e does
      await call('apply_commands', { commands: [{ type: 'setStock', stock: { mode: 'auto', margin: { xy: 5, zTop: 1, zBottom: 6 } } }] });
      const catalog = (await call('describe_geometry')).structuredContent as { contours: { handle: string; layer: string }[] };
      const on = (layer: string) => catalog.contours.filter((c) => c.layer === layer).map((c) => c.handle);
      await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: on('OUTLINE'), params: { tabs: { enabled: true } } });
      await call('add_operation', { type: 'pocket', tool: 'starter-flat-6', geometry: on('POCKET') });
      await call('add_operation', { type: 'drill', tool: 'starter-drill-6', geometry: on('HOLES') });
      const generated = (await call('generate')).structuredContent as { operations: { status: string }[]; export: { errors: string[] } };
      expect(generated.operations.filter((o) => o.status === 'error')).toEqual([]);
      expect(generated.export.errors).toEqual([]);
      const { paths } = (await call('export_gcode', { dir: 'out' })).structuredContent as { paths: string[] };
      expect(paths.length).toBeGreaterThan(0);
      for (const p of paths) {
        const parsed = parseProgram(new Uint8Array(readFileSync(p)), { profile: machinePreset('Hobby GRBL router'), stock: null, jobWorkOffset: 'G54' });
        expect(parsed.interpretDiagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      }
      await call('save_job', { path: 'part' });
      expect(existsSync(join(dir, 'part.spon'))).toBe(true);
      const image = (await call('render_preview', { view: 'iso' })).content[0];
      expect(image.type === 'image' && Array.from(Buffer.from(image.data, 'base64').subarray(0, 4))).toEqual([137, 80, 78, 71]);
    } finally {
      await client.close();
    }
  }, 120_000);
});
