import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { connect, data } from './connect';

const yWords = (nc: string) => [...nc.matchAll(/\bY(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));

describe('WCS axis switches', () => {
  it('export_gcode follows setWcs axes: reverseY negates the posted Y values', async () => {
    const { call } = await connect({}, ['cam-part.dxf']);
    await call('new_job', { name: 'Part' });
    await call('import_model', { path: 'cam-part.dxf' });
    const catalog = data(await call('describe_geometry'));
    const outline = catalog.contours.find((c: { layer: string }) => c.layer === 'OUTLINE').handle;
    await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: [outline] });

    const plain = data(await call('export_gcode', { dir: 'plain' })).paths as string[];
    const applied = await call('apply_commands', { commands: [{ type: 'setWcs', patch: { axes: { reverseY: true } } }] });
    expect(applied.isError).toBeFalsy();
    const flipped = data(await call('export_gcode', { dir: 'flipped' })).paths as string[];

    const a = yWords(readFileSync(plain[0], 'utf8'));
    const b = yWords(readFileSync(flipped[0], 'utf8'));
    expect(a.length).toBeGreaterThan(5);
    expect(b).toHaveLength(a.length);
    a.forEach((v, i) => expect(b[i]).toBeCloseTo(-v, 6));
    expect(a.some((v) => v !== 0)).toBe(true);
  });
});
