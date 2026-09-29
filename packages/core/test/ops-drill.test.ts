import { describe, expect, it } from 'vitest';
import { applyCommand, camContext, type DrillOp, drillToolpath, newOperation, type Tool, v2 } from '../src';
import { camPartSetup, geoOf } from './fixtures/camSetup';

const drill6: Tool = {
  id: 'd6', name: '6 mm drill', type: 'drill', number: 3, diameter: 6, cornerRadius: 0, tipAngleDeg: 118, fluteLength: 35, stickout: 45, flutes: 2,
  presets: [{ name: 'Softwood', rpm: 6000, feed: 600, plungeFeed: 300, stepdown: 6, stepoverPct: 50, coolant: 'off' }],
};
const { job, geometry } = camPartSetup(); // stock top 0, bottom −6
const ctx = camContext(applyCommand(job, { type: 'addTool', tool: drill6 }), geometry);
const hole = (x: number, y: number, d = 6, ref = 0) => ({ center: v2(x, y), diameter: d, top: 0, bottom: -6, through: true, ref });
const holes = [hole(15, 15), hole(95, 15), hole(15, 55), hole(95, 55)];
const drillOp = (patch: Partial<DrillOp> = {}): DrillOp =>
  ({ ...(newOperation('drill', { id: 'd', name: 'Drill', tool: drill6, modelKind: 'drawing' }) as DrillOp), ...patch });

describe('drillToolpath', () => {
  it('orders holes nearest-neighbour from the origin and emits one cycle per hole', () => {
    const out = drillToolpath(drillOp({ cycle: 'peck', peck: 2 }), drill6, ctx, geoOf({ holes }));
    expect(out.diagnostics).toEqual([]);
    const cycles = out.toolpath!.moves.filter((m) => m.kind === 'cycle');
    expect(cycles.map((c) => c.kind === 'cycle' && [c.at.x, c.at.y])).toEqual([[15, 15], [15, 55], [95, 55], [95, 15]]);
    expect(cycles[0]).toEqual({ kind: 'cycle', cycle: 'peck', at: v2(15, 15), top: 0, bottom: -6, r: 2, retract: 5, peck: 2, dwell: 0.5, feed: 300 });
    expect(out.toolpath!.moves.slice(0, 2)).toEqual([{ kind: 'rapid', to: { x: 15, y: 15, z: 15 } }, { kind: 'rapid', to: { x: 15, y: 15, z: 5 } }]);
    expect(out.toolpath!.moves.at(-1)).toEqual({ kind: 'rapid', to: { x: 95, y: 15, z: 15 } });
  });

  it('checks the tool against the hole size and applies the diameter filter', () => {
    const big = drillToolpath(drillOp(), { ...drill6, diameter: 8 }, ctx, geoOf({ holes }));
    expect(big.toolpath).toBeNull();
    expect(big.diagnostics[0]).toMatchObject({ severity: 'error', code: 'tool-too-large' });
    const small = drillToolpath(drillOp(), { ...drill6, diameter: 5 }, ctx, geoOf({ holes }));
    expect(small.diagnostics.map((d) => d.code)).toEqual(['tool-undersize']);
    expect(small.toolpath).not.toBeNull();
    const filtered = drillToolpath(drillOp({ diameterFilter: { min: 7, max: 9 } }), drill6, ctx, geoOf({ holes }));
    expect(filtered.diagnostics).toMatchObject([{ severity: 'error', code: 'no-geometry' }]);
    const some = drillToolpath(drillOp({ diameterFilter: { min: 7, max: 9 } }), drill6, ctx, geoOf({ holes: [...holes, hole(50, 30, 8)] }));
    expect(some.toolpath!.moves.filter((m) => m.kind === 'cycle')).toHaveLength(1);
  });
});
