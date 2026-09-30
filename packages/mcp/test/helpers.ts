import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tool } from '@sponcam/core';

export const fixturePath = (name: string): string => fileURLToPath(new URL(`../../core/test/fixtures/${name}`, import.meta.url));
export const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(fixturePath(name)));
export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'spon-mcp-'));

export const tool6: Tool = {
  id: 't6', name: '6 mm flat', type: 'flat', number: 1, diameter: 6, cornerRadius: 0, tipAngleDeg: 0, fluteLength: 20, stickout: 30, flutes: 2,
  presets: [{ name: 'Softwood', rpm: 18000, feed: 2000, plungeFeed: 600, stepdown: 3, stepoverPct: 45, coolant: 'off' }],
};
