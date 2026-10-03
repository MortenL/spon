import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connect, data, text } from './connect';

type Diag = { code: string; severity: string };

async function signJob(tool = 'starter-vbit-60') {
  const t = await connect();
  await t.call('new_job', { name: 'Sign' });
  await t.call('apply_commands', { commands: [{ type: 'setStock', stock: { mode: 'fixed', size: { x: 120, y: 50, z: 10 }, modelOffset: { x: 0, y: 0, z: 0 } } }] });
  const textId = data(await t.call('add_text', { text: 'SPON', size: 30, position: { x: 10, y: 10 } })).id as string;
  // a flat tool in the job, to become the clearing tool
  expect((await t.call('add_operation', { type: 'face', tool: 'starter-flat-6', geometry: [] })).isError).toBeFalsy();
  const carve = await t.call('add_operation', { type: 'vcarve', tool, geometry: [{ kind: 'text', textId }] });
  expect(carve.isError).toBeFalsy();
  const opId = (data(carve).id ?? data(carve).operationId ?? data(carve).operation?.id) as string;
  return { t, textId, opId };
}

describe('make_inlay', () => {
  it('creates the pocket here and writes a plug job that generates cleanly', async () => {
    const { t, opId } = await signJob();
    const r = await t.call('make_inlay', { operationId: opId, plugPath: 'plug.spon' });
    expect(r.isError, text(r)).toBeFalsy();
    const out = data(r);
    expect(out.plugPath).toBe(join(t.dir, 'plug.spon'));
    expect(out.H).toBeCloseTo(5.5);
    expect(out.baseChanges.length).toBeGreaterThan(0);
    const job = data(await t.call('get_job')).job as { operations: { id: string; type: string; maxDepth?: number; inlay?: { plugFileName: string } }[] };
    const carve = job.operations.find((o) => o.id === opId)!;
    expect(carve.maxDepth).toBe(4);
    expect(carve.inlay?.plugFileName).toBe('plug.spon');
    expect(job.operations.some((o) => o.type === 'vclear')).toBe(true);
    await t.call('save_job', { path: 'base.spon' });
    expect((await t.call('open_job', { path: 'plug.spon' })).isError).toBeFalsy();
    const g = data(await t.call('generate'));
    expect(g.operations.flatMap((o: { diagnostics: Diag[] }) => o.diagnostics).filter((d: Diag) => d.severity === 'error')).toEqual([]);
  });

  it('refuses an existing plug file without update', async () => {
    const { t, opId } = await signJob();
    expect((await t.call('make_inlay', { operationId: opId, plugPath: 'plug.spon' })).isError).toBeFalsy();
    const again = await t.call('make_inlay', { operationId: opId, plugPath: 'plug.spon' });
    expect(again.isError).toBe(true);
    expect(text(again)).toBe(`${join(t.dir, 'plug.spon')} exists; pass update: true to update it`);
  });

  it('updates the plug job after the base text changes', async () => {
    const { t, textId, opId } = await signJob();
    await t.call('make_inlay', { operationId: opId, plugPath: 'plug.spon' });
    await t.call('update_text', { id: textId, patch: { text: 'SIGN' } });
    const r = await t.call('make_inlay', { operationId: opId, plugPath: 'plug.spon', update: true });
    expect(r.isError, text(r)).toBeFalsy();
    await t.call('save_job', { path: 'base.spon' });
    await t.call('open_job', { path: 'plug.spon' });
    const job = data(await t.call('get_job')).job as { texts: { text: string; mirror: boolean }[] };
    expect(job.texts).toHaveLength(1);
    expect(job.texts[0]).toMatchObject({ text: 'SIGN', mirror: true });
  });

  it('refuses a V-carve with a flat tool', async () => {
    const { t, opId } = await signJob('starter-flat-3');
    const r = await t.call('make_inlay', { operationId: opId, plugPath: 'plug.spon' });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('Inlays need a V-bit');
    expect(existsSync(join(t.dir, 'plug.spon'))).toBe(false);
  });
});
