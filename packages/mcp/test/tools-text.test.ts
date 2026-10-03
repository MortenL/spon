import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testFontBytes } from '../../core/test/fixtures/testFont';
import { connect, data, text } from './connect';

type Diag = { code: string; severity: string };
const codes = (g: Record<string, any>): string[] => g.operations.flatMap((o: { diagnostics: Diag[] }) => o.diagnostics.map((d) => d.code));

async function signJob() {
  const t = await connect();
  await t.call('new_job', { name: 'Sign' });
  await t.call('apply_commands', { commands: [{ type: 'setStock', stock: { mode: 'fixed', size: { x: 120, y: 50, z: 10 }, modelOffset: { x: 0, y: 0, z: 0 } } }] });
  return t;
}

describe('text and font tools', () => {
  it('engraves a V-carved sign from text and exports it', async () => {
    const t = await signJob();
    const fonts = data(await t.call('list_fonts'));
    expect(fonts.bundled).toHaveLength(6);
    expect(fonts.inJob).toEqual([]);
    const added = await t.call('add_text', { text: 'SPON', size: 30, position: { x: 10, y: 10 } });
    expect(added.isError).toBeFalsy();
    const textId = data(added).id as string;
    const carve = await t.call('add_operation', { type: 'vcarve', tool: 'starter-vbit-90', geometry: [{ kind: 'text', textId }], params: { maxDepth: 3 } });
    expect(carve.isError).toBeFalsy();
    const generated = data(await t.call('generate'));
    expect(generated.operations.flatMap((o: { diagnostics: Diag[] }) => o.diagnostics).filter((d: Diag) => d.severity === 'error')).toEqual([]);
    expect(generated.files.length).toBeGreaterThan(0);
    const exported = await t.call('export_gcode', { dir: 'out' });
    expect(exported.isError).toBeFalsy();
    expect(readdirSync(join(t.dir, 'out')).length).toBeGreaterThan(0);
    expect((await t.call('render_preview')).isError).toBeFalsy();
  });

  it('loads an uploaded font under a fresh blob id and uses it', async () => {
    const t = await signJob();
    writeFileSync(join(t.dir, 'Test.ttf'), testFontBytes());
    const loaded = await t.call('load_font', { path: 'Test.ttf' });
    expect(loaded.isError).toBeFalsy();
    const font = data(loaded).font;
    expect(font).toMatchObject({ kind: 'file', name: 'Test.ttf' });
    expect(font.blobId).toMatch(/^font-[0-9a-f-]{36}$/);
    const again = data(await t.call('load_font', { path: 'Test.ttf' })).font;
    expect(again.blobId).not.toBe(font.blobId);
    const textId = data(await t.call('add_text', { text: 'HOA' })).id as string;
    expect((await t.call('update_text', { id: textId, patch: { font } })).isError).toBeFalsy();
    expect(data(await t.call('list_fonts')).inJob).toEqual([{ blobId: font.blobId, name: 'Test.ttf', usedBy: [textId] }]);
    await t.call('add_operation', { type: 'engrave', tool: 'starter-vbit-90', geometry: [{ kind: 'text', textId }], params: { depth: 1 } });
    const generated = data(await t.call('generate'));
    expect(codes(generated)).not.toContain('font-missing');
    expect(generated.operations[0].status).not.toBe('error');
  });

  it('refuses a woff2 font with the exact message', async () => {
    const t = await signJob();
    writeFileSync(join(t.dir, 'x.woff2'), new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]));
    const r = await t.call('load_font', { path: 'x.woff2' });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('WOFF2 fonts are not supported; use TTF, OTF or WOFF');
  });

  it('keeps the text and the uploaded font through save and reopen', async () => {
    const t = await signJob();
    writeFileSync(join(t.dir, 'Test.ttf'), testFontBytes());
    const font = data(await t.call('load_font', { path: 'Test.ttf' })).font;
    const textId = data(await t.call('add_text', { text: 'HOA', font })).id as string;
    await t.call('add_operation', { type: 'engrave', tool: 'starter-vbit-90', geometry: [{ kind: 'text', textId }], params: { depth: 1 } });
    expect((await t.call('save_job', { path: 'sign' })).isError).toBeFalsy();
    expect(existsSync(join(t.dir, 'sign.spon'))).toBe(true);
    const r = await connect({}, []);
    // reopen in a fresh server
    const reopened = await r.call('open_job', { path: join(t.dir, 'sign.spon') });
    expect(reopened.isError).toBeFalsy();
    expect(data(await r.call('get_job', { section: 'texts' })).texts).toHaveLength(1);
    const generated = data(await r.call('generate'));
    expect(codes(generated)).not.toContain('font-missing');
  });

  it('updates and removes texts, and reports command errors', async () => {
    const t = await signJob();
    const id = data(await t.call('add_text', { id: 'my-text', text: 'A' })).id;
    expect(id).toBe('my-text');
    const bad = await t.call('update_text', { id, patch: { size: 0 } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain('size');
    expect((await t.call('update_text', { id, patch: { size: 12 } })).isError).toBeFalsy();
    expect((await t.call('remove_text', { id })).isError).toBeFalsy();
    expect(text(await t.call('remove_text', { id }))).toContain(id);
  });
});
